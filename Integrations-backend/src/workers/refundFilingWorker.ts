/**
 * Refund Filing Worker
 * Automated background worker for filing disputes via Amazon SP-API (mock for MVP)
 * Runs every 5 minutes, files cases ready for submission, polls for status updates
 * Handles retry logic with stronger evidence for denied cases
 * 
 * MULTI-TENANT: Processes each tenant's data in isolation using tenant-scoped queries
 * 
 * ANTI-DETECTION: Uses jittered delays between submissions to mimic human behavior
 * Amazon bans robotic patterns (e.g., exact 5-minute intervals). Jitter makes us look human.
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import { createTenantScopedQueryById } from '../database/tenantScopedClient';
import refundFilingService, { FilingRequest, FilingResult, CaseStatus } from '../services/refundFilingService';
import featureFlagService from '../services/featureFlagService';


/**
 * VELOCITY LIMIT JITTER
 * Sleep for a random duration between min and max seconds.
 * This prevents Amazon's pattern recognition from detecting bot behavior.
 * 
 * Example: getJitter(180, 420) returns 180-420 seconds (3-7 minutes)
 * One claim in 3 min, next in 7 min, next in 4 min = looks human
 */
function getJitterMs(minSeconds: number = 180, maxSeconds: number = 420): number {
  const jitterSeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
  return jitterSeconds * 1000;
}

async function sleepWithJitter(minSeconds: number = 180, maxSeconds: number = 420): Promise<void> {
  const jitterMs = getJitterMs(minSeconds, maxSeconds);
  const jitterSeconds = jitterMs / 1000;
  logger.debug(` [REFUND FILING] Sleeping for ${jitterSeconds.toFixed(0)}s (jitter: ${minSeconds}-${maxSeconds}s)`);
  await new Promise(resolve => setTimeout(resolve, jitterMs));
}

// Retry logic with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(` [REFUND FILING] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
          error: error.message,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export interface FilingStats {
  processed: number;
  filed: number;
  failed: number;
  skipped: number; // Skipped due to duplicates or other reasons
  statusUpdated: number;
  retried: number;
  errors: string[];
}

class RefundFilingWorker {
  private schedule: string = '*/5 * * * *'; // Every 5 minutes
  private statusPollingSchedule: string = '*/10 * * * *'; // Every 10 minutes
  private cronJob: cron.ScheduledTask | null = null;
  private statusPollingJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;

  /**
  * THROTTLE CONFIGURATION
  * Prevents flood-like behavior that triggers Amazon's bot detection
  * These values are conservative - can be increased after testing
  */
  private static readonly THROTTLE_CONFIG = {
    MAX_PER_RUN: 3, // Only process 3 claims per 5-minute run
    MAX_PER_HOUR: 12, // Max 12 claims per hour (soft limit)
    MAX_PER_DAY: 100, // Daily ceiling (for reference)
    MAX_PER_SELLER_PER_DAY: 10, // Per-seller limit to prevent one seller exhausting quota
  };

  /**
   * CLAIM AMOUNT VALIDATION
   * Cross-validate claim amount against parsed invoice total.
   * If claim amount differs from invoice by more than this %, flag for review.
   * 
   * This catches LLM hallucinations (reading "10 units" as "100 units").
   */
  private static readonly AMOUNT_VARIANCE_THRESHOLD = 0.15; // 15% variance allowed

  /**
  * HIGH-VALUE CLAIM APPROVAL
  * LLMs can hallucinate - reading "10 units" as "100 units" on blurry documents.
  * To prevent fraud accusations from Amazon, high-value claims require human approval.
  * 
  * Rule: Claims over this threshold are flagged 'pending_approval' instead of auto-submitted.
  */
  private static readonly HIGH_VALUE_THRESHOLD = 500; // USD - ceiling; claims above this require manual approval

  /**
  * MINIMUM ROI THRESHOLD
  * Don't waste the 10-claim-per-day quota on sub-$25 discrepancies.
  * At 20% commission, a $25 claim nets Margin $5.00 minimum.
  * Below this, cost-of-filing exceeds expected return.
  */
  private static readonly MIN_FILING_THRESHOLD = 25.00; // USD

  /**
  * DIMENSION / WEIGHT FEE CLAIM TYPES
  * These claim types require physical dimension proof (spec sheets, GS1, Cubiscan).
  * Agent 7 has no way to attach such proof, so route to pending_approval for manual review.
  */
  private static readonly DIMENSION_CLAIM_TYPES = [
    'weight_fee', 'dimension_fee', 'weight_fee_overcharge',
    'size_tier_error', 'measurement_fee', 'dimensional_weight'
  ];

  /**
  * KILL SWITCH - DANGEROUS DOCUMENT PATTERNS
  * CRITICAL SAFETY FEATURE: Prevents credit notes, returns, and refunds from being submitted to Amazon.
  * 
  * The Risk: If Agent 7 submits a "Credit Note" (you owe money) as an "Invoice" (proof of ownership),
  * Amazon will flag for FRAUD and immediately ban the Seller Account. Funds frozen. Game over.
  * 
  * Rule: If filename contains credit, return, refund, or similar terms, QUARANTINE the case.
  * These documents must NEVER reach Amazon.
  */
  private static readonly DANGEROUS_DOCUMENT_PATTERNS = [
    'credit',
    'credit_note',
    'credit-note',
    'creditnote',
    'return',
    'returned',
    'refund',
    'refunded',
    'rma', // Return Merchandise Authorization
    'reversal',
    'chargeback',
    'debit_note',
    'adjustment',
  ];

  /**
   * CONTENT-BASED DETECTION PATTERNS
   * These phrases appear INSIDE credit notes, returns, and refunds.
   * Used when the filename doesn't reveal the document type.
   * 
   * Example: "invoice_12345.pdf" looks safe but contains "We have credited your account"
   */
  private static readonly DANGEROUS_CONTENT_PATTERNS = [
    // Credit note indicators
    'credit note', 'credit memo', 'credit advice',
    'we have credited', 'credited to your account', 'amount credited',
    'this is a credit', 'credit issued',

    // Return indicators
    'return authorization', 'return merchandise authorization', 'rma number',
    'return to sender', 'returned goods', 'goods returned',
    'return request approved', 'please return',

    // Refund indicators
    'refund confirmation', 'refund issued', 'refund processed',
    'we have refunded', 'your refund', 'refund amount',
    'refund request', 'refund approved',

    // Chargeback/dispute indicators
    'chargeback notification', 'dispute resolution',
    'amount reversed', 'reversal notification',

    // Debit note indicators (opposite of invoice)
    'debit note', 'debit memo', 'we are debiting',
  ];

  /**
  * Start the worker
  */
  start(): void {
    if (this.cronJob) {
      logger.warn(' [REFUND FILING] Worker already started');
      return;
    }

    logger.info(' [REFUND FILING] Starting Refund Filing Worker', {
      schedule: this.schedule,
      statusPollingSchedule: this.statusPollingSchedule
    });

    // Schedule filing job (every 5 minutes)
    this.cronJob = cron.schedule(this.schedule, async () => {
      if (this.isRunning) {
        logger.debug('⏸️ [REFUND FILING] Previous run still in progress, skipping');
        return;
      }

      this.isRunning = true;
      try {
        await this.runFilingForAllTenants();
      } catch (error: any) {
        logger.error(' [REFUND FILING] Error in filing job', { error: error.message });
      } finally {
        this.isRunning = false;
      }
    });

    // Schedule status polling job (every 10 minutes)
    this.statusPollingJob = cron.schedule(this.statusPollingSchedule, async () => {
      if (this.isRunning) {
        logger.debug('⏸️ [REFUND FILING] Previous run still in progress, skipping status polling');
        return;
      }

      this.isRunning = true;
      try {
        await this.pollCaseStatuses();
      } catch (error: any) {
        logger.error(' [REFUND FILING] Error in status polling job', { error: error.message });
      } finally {
        this.isRunning = false;
      }
    });

    logger.info(' [REFUND FILING] Worker started successfully');
  }

  /**
  * Stop the worker
  */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.statusPollingJob) {
      this.statusPollingJob.stop();
      this.statusPollingJob = null;
    }
    logger.info(' [REFUND FILING] Worker stopped');
  }

  /**
  * Check how many claims have been filed in the last hour
  * Used to enforce hourly rate limits
  */
  private async getFilingsInLastHour(): Promise<number> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { count, error } = await supabaseAdmin
        .from('dispute_submissions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', oneHourAgo);

      if (error) {
        logger.warn(' [REFUND FILING] Could not check hourly filings, proceeding with caution', {
          error: error.message
        });
        return 0; // Assume 0 if we can't check (fail open, but log it)
      }

      return count || 0;
    } catch (error: any) {
      logger.warn(' [REFUND FILING] Error checking hourly filings', { error: error.message });
      return 0;
    }
  }

  /**
  * DUPLICATE PREVENTION: Check if order already has an active claim
  * This is CRITICAL to prevent Amazon from flagging as "Abuse of Seller Support"
  * 
  * Logic:
  * 1. Check dispute_cases for any case with same order_id
  * 2. If status is NOT closed/approved/rejected, there's an active case
  * 3. Do NOT file a new case - wait for the existing one to resolve
  * 
  * @param orderId The Amazon order ID to check
   * @param sellerId The seller/user ID (for scoping)
   * @param excludeCaseId Optional case ID to exclude (current case being processed)
   * @returns true if there's an active case, false if safe to file
   */
  private async hasActiveClaimForOrder(orderId: string, sellerId: string, excludeCaseId?: string): Promise<boolean> {
    if (!orderId) {
      // No order ID means we can't check for duplicates - log warning but allow
      logger.warn(' [REFUND FILING] No order_id provided, cannot check for duplicates');
      return false;
    }

    try {
      // Query for any active case (not closed, not approved, not rejected) for this order
      // We need to join with detection_results to check evidence->order_id
      const { data: activeCases, error } = await supabaseAdmin
        .from('dispute_cases')
        .select(`
 id,
 status,
 filing_status,
 detection_results!inner (
 evidence
 )
 `)
        .eq('seller_id', sellerId)
        .not('status', 'in', '(closed,approved,rejected)')
        .not('filing_status', 'in', '(failed)');

      if (error) {
        logger.warn(' [REFUND FILING] Could not check for duplicates, proceeding with caution', {
          orderId,
          error: error.message
        });
        return false; // Fail open - if we can't check, proceed but log it
      }

      if (!activeCases || activeCases.length === 0) {
        return false; // No active cases, safe to file
      }

      // Check if any active case matches this order_id
      for (const activeCase of activeCases) {
        if (excludeCaseId && activeCase.id === excludeCaseId) {
          continue; // Skip the current case
        }
        const caseOrderId = (activeCase as any).detection_results?.evidence?.order_id;
        if (caseOrderId === orderId) {
          logger.warn(' [REFUND FILING] DUPLICATE DETECTED - Active case exists for order', {
            orderId,
            existingCaseId: activeCase.id,
            existingStatus: activeCase.status,
            existingFilingStatus: activeCase.filing_status
          });
          return true; // Duplicate found!
        }
      }

      return false; // No matching order_id in active cases

    } catch (error: any) {
      logger.warn(' [REFUND FILING] Error checking for duplicates', {
        orderId,
        error: error.message
      });
      return false; // Fail open
    }
  }

  /**
  * DOUBLE-DIP PREVENTION: Check if item was already reimbursed
  * This is CRITICAL to prevent filing claims for items Amazon already paid for
  * 
  * Amazon may auto-reimburse without seller noticing. Filing again = "Theft" accusation.
  * 
  * Logic:
  * 1. Check financial_events for event_type = 'reimbursement'
  * 2. Match by order_id, sku, or asin
  * 3. If found in last 6 months, skip filing
  * 
  * @param orderId Amazon order ID
  * @param sku Amazon SKU
  * @param asin Amazon ASIN
  * @param sellerId Seller/user ID
  * @returns true if already reimbursed, false if safe to file
  */
  private async wasAlreadyReimbursed(
    orderId: string,
    sku: string | undefined,
    asin: string | undefined,
    sellerId: string,
    shipmentId?: string
  ): Promise<boolean> {
    // Need at least one identifier to check
    if (!orderId && !sku && !asin) {
      logger.warn(' [REFUND FILING] No identifiers for reimbursement check, proceeding with caution');
      return false;
    }

    try {
      // Check for reimbursements in the last 6 months
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      // Build query - check by order_id first (most reliable)
      let query = supabaseAdmin
        .from('financial_events')
        .select('id, amazon_order_id, amazon_sku, amount, event_date')
        .eq('seller_id', sellerId)
        .eq('event_type', 'reimbursement')
        .gte('event_date', sixMonthsAgo.toISOString());

      // Match by order_id if available
      if (orderId) {
        query = query.eq('amazon_order_id', orderId);
      } else if (sku) {
        // Fallback to SKU
        query = query.eq('amazon_sku', sku);
      }
      // Note: asin match would require querying raw_payload JSONB, skip for now

      const { data: reimbursements, error } = await query.limit(1);

      // P6: Secondary check by shipment_id in raw_payload JSONB (catches FC sweep credits)
      if (!error && (!reimbursements || reimbursements.length === 0) && shipmentId) {
        const { data: shipmentReimbs } = await supabaseAdmin
          .from('financial_events')
          .select('id')
          .eq('seller_id', sellerId)
          .eq('event_type', 'reimbursement')
          .gte('event_date', sixMonthsAgo.toISOString())
          .or(`raw_payload->>'shipment_id'.eq.${shipmentId},raw_payload->>'ShipmentId'.eq.${shipmentId}`)
          .limit(1);
        if (shipmentReimbs && shipmentReimbs.length > 0) {
          logger.warn(' [REFUND FILING] ALREADY REIMBURSED by shipment_id - Amazon credited this shipment', {
            orderId, shipmentId
          });
          return true;
        }
      }

      if (error) {
        logger.warn(' [REFUND FILING] Could not check reimbursement history, proceeding with caution', {
          orderId,
          error: error.message
        });
        return false; // Fail open
      }

      if (reimbursements && reimbursements.length > 0) {
        const reimbursement = reimbursements[0];
        logger.warn(' [REFUND FILING] ALREADY REIMBURSED - Amazon already paid for this item', {
          orderId,
          sku,
          reimbursementId: reimbursement.id,
          reimbursementAmount: reimbursement.amount,
          reimbursementDate: reimbursement.event_date
        });
        return true; // Already reimbursed!
      }

      return false; // No prior reimbursement found, safe to file

    } catch (error: any) {
      logger.warn(' [REFUND FILING] Error checking reimbursement history', {
        orderId,
        error: error.message
      });
      return false; // Fail open
    }
  }

  /**
   * KILL SWITCH: Check if evidence documents contain dangerous files
   * Credit notes, returns, refunds etc. MUST NEVER be submitted to Amazon
   * 
   * @param evidenceIds Array of evidence document IDs
   * @param sellerId Seller/user ID
   * @returns Object with hasDangerous flag and list of dangerous filenames
   */
  private async hasDangerousDocuments(
    evidenceIds: string[],
    sellerId: string
  ): Promise<{ hasDangerous: boolean; dangerousFilenames: string[] }> {
    if (!evidenceIds || evidenceIds.length === 0) {
      return { hasDangerous: false, dangerousFilenames: [] };
    }

    try {
      // Query evidence documents by IDs
      const { data: documents, error } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, filename')
        .in('id', evidenceIds)
        .eq('seller_id', sellerId);

      if (error) {
        logger.warn('[WARN] [REFUND FILING] Could not check document filenames, proceeding with caution', {
          error: error.message
        });
        return { hasDangerous: false, dangerousFilenames: [] }; // Fail open but log
      }

      if (!documents || documents.length === 0) {
        return { hasDangerous: false, dangerousFilenames: [] };
      }

      const dangerousFilenames: string[] = [];

      // Check each document filename against dangerous patterns
      for (const doc of documents) {
        const filename = (doc.filename || '').toLowerCase();
        console.log(`DEBUG: Checking filename "${filename}" against patterns...`);

        for (const pattern of RefundFilingWorker.DANGEROUS_DOCUMENT_PATTERNS) {
          if (filename.includes(pattern)) {
            console.log(`DEBUG: DANGEROUS PATTERN "${pattern}" MATCHED in "${filename}"`);
            dangerousFilenames.push(doc.filename);
            break; // No need to check more patterns for this file
          }
        }
      }

      return {
        hasDangerous: dangerousFilenames.length > 0,
        dangerousFilenames
      };

    } catch (error: any) {
      logger.warn('[WARN] [REFUND FILING] Error checking document filenames', {
        error: error.message
      });
      return { hasDangerous: false, dangerousFilenames: [] }; // Fail open
    }
  }

  /**
   * CONTENT-BASED KILL SWITCH: Check if evidence documents contain dangerous content
   * This scans the ACTUAL TEXT inside documents, not just filenames.
   * 
   * Catches cases like: "invoice_12345.pdf" that actually contains "CREDIT NOTE" text inside.
   * 
   * Uses on-demand parsing if document hasn't been parsed yet.
   * 
   * @param evidenceIds Array of evidence document IDs
   * @param sellerId Seller/user ID
   * @returns Object with hasDangerous flag and list of dangerous findings
   */
  private async hasDangerousContent(
    evidenceIds: string[],
    sellerId: string
  ): Promise<{ hasDangerous: boolean; dangerousFindings: Array<{ filename: string; pattern: string }> }> {
    if (!evidenceIds || evidenceIds.length === 0) {
      return { hasDangerous: false, dangerousFindings: [] };
    }

    const dangerousFindings: Array<{ filename: string; pattern: string }> = [];

    try {
      // Import document parsing service for on-demand parsing
      const documentParsingService = (await import('../services/documentParsingService')).default;

      // Query evidence documents with parsed content
      const { data: documents, error } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, filename, raw_text, extracted')
        .in('id', evidenceIds)
        .eq('seller_id', sellerId);

      if (error) {
        logger.warn('[WARN] [REFUND FILING] Could not fetch documents for content check', {
          error: error.message
        });
        return { hasDangerous: false, dangerousFindings: [] }; // Fail open but log
      }

      if (!documents || documents.length === 0) {
        return { hasDangerous: false, dangerousFindings: [] };
      }

      // Check each document's content
      for (const doc of documents) {
        let rawText: string | undefined = (doc as any).raw_text;

        // Try to get from extracted if raw_text is empty
        if (!rawText) {
          const extracted = (doc as any).extracted || {};
          rawText = extracted.raw_text || extracted.text;
        }

        // If no parsed content, try on-demand parsing
        if (!rawText && doc.id) {
          try {
            logger.info('[REFUND FILING] Document not parsed, triggering on-demand parsing', {
              documentId: doc.id,
              filename: doc.filename
            });

            const parsedData = await documentParsingService.parseDocumentWithRetry(doc.id, sellerId, 2);
            if (parsedData?.raw_text) {
              rawText = parsedData.raw_text;
            }
          } catch (parseError: any) {
            logger.warn('[WARN] [REFUND FILING] On-demand parsing failed, skipping content check for doc', {
              documentId: doc.id,
              error: parseError.message
            });
            // Continue to next document - don't block entire filing
          }
        }

        // If we have raw text, check for dangerous patterns
        if (rawText) {
          const textLower = rawText.toLowerCase();

          for (const pattern of RefundFilingWorker.DANGEROUS_CONTENT_PATTERNS) {
            if (textLower.includes(pattern)) {
              dangerousFindings.push({
                filename: doc.filename || 'unknown',
                pattern: pattern
              });
              logger.warn('[CRITICAL] [REFUND FILING] DANGEROUS CONTENT DETECTED in document', {
                documentId: doc.id,
                filename: doc.filename,
                detectedPattern: pattern,
                reason: 'Document content contains credit/refund/return language'
              });
              break; // One match is enough to flag this document
            }
          }
        }
      }

      return {
        hasDangerous: dangerousFindings.length > 0,
        dangerousFindings
      };

    } catch (error: any) {
      logger.warn('[WARN] [REFUND FILING] Error checking document content', {
        error: error.message
      });
      return { hasDangerous: false, dangerousFindings: [] }; // Fail open
    }
  }

  /**
   * PER-SELLER DAILY LIMIT: Check how many claims a specific seller has filed today
   * Prevents one seller from exhausting the tenant's daily quota
   * 
   * @param sellerId The seller/user ID
   * @param tenantId The tenant ID
   * @returns Number of filings for this seller in the last 24 hours
   */
  private async getFilingsInLastDayForSeller(sellerId: string, tenantId: string): Promise<number> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { count, error } = await supabaseAdmin
        .from('dispute_cases')
        .select('*', { count: 'exact', head: true })
        .eq('seller_id', sellerId)
        .eq('tenant_id', tenantId)
        .in('filing_status', ['filed', 'submitted', 'filing'])
        .gte('updated_at', oneDayAgo);

      if (error) {
        logger.warn('[WARN] [REFUND FILING] Could not check seller daily filings', {
          sellerId,
          error: error.message
        });
        return 0; // Fail open
      }

      return count || 0;
    } catch (error: any) {
      logger.warn('[WARN] [REFUND FILING] Error checking seller daily filings', {
        sellerId,
        error: error.message
      });
      return 0; // Fail open
    }
  }

  /**
   * CLAIM AMOUNT VALIDATION: Cross-validate claim amount against parsed invoice total
   * Catches LLM hallucinations where detection claims $1000 but invoice shows $100.
   * 
   * @param claimAmount The amount we're about to claim
   * @param evidenceIds Evidence document IDs
   * @param sellerId Seller/user ID
   * @returns Object with isValid flag, invoice amount found, and variance
   */
  private async validateClaimAmount(
    claimAmount: number,
    evidenceIds: string[],
    sellerId: string
  ): Promise<{ isValid: boolean; invoiceAmount?: number; variance?: number; reason?: string }> {
    if (!claimAmount || claimAmount <= 0) {
      return { isValid: true, reason: 'No claim amount to validate' };
    }

    if (!evidenceIds || evidenceIds.length === 0) {
      return { isValid: true, reason: 'No evidence to cross-validate' };
    }

    try {
      // Get parsed content from evidence documents
      const { data: documents, error } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, filename, parsed_content')
        .in('id', evidenceIds)
        .eq('seller_id', sellerId);

      if (error || !documents || documents.length === 0) {
        return { isValid: true, reason: 'Could not retrieve documents for validation' };
      }

      // Look for total_amount in parsed content
      let foundInvoiceAmount: number | undefined;
      let sourceFilename: string | undefined;

      for (const doc of documents) {
        const parsedContent = doc.parsed_content as any;
        if (parsedContent?.total_amount && typeof parsedContent.total_amount === 'number') {
          foundInvoiceAmount = parsedContent.total_amount;
          sourceFilename = doc.filename;
          break; // Use first valid amount found
        }
      }

      // If no invoice amount found, we can't validate - allow to proceed
      if (foundInvoiceAmount === undefined) {
        return { isValid: true, reason: 'No invoice total found in parsed documents' };
      }

      // Calculate variance
      const variance = Math.abs(claimAmount - foundInvoiceAmount) / foundInvoiceAmount;

      if (variance > RefundFilingWorker.AMOUNT_VARIANCE_THRESHOLD) {
        logger.warn('[WARN] [REFUND FILING] CLAIM AMOUNT MISMATCH - Variance exceeds threshold', {
          claimAmount,
          invoiceAmount: foundInvoiceAmount,
          variance: `${(variance * 100).toFixed(1)}%`,
          threshold: `${(RefundFilingWorker.AMOUNT_VARIANCE_THRESHOLD * 100)}%`,
          sourceDocument: sourceFilename
        });

        return {
          isValid: false,
          invoiceAmount: foundInvoiceAmount,
          variance,
          reason: `Claim amount ($${claimAmount}) differs from invoice ($${foundInvoiceAmount}) by ${(variance * 100).toFixed(1)}%`
        };
      }

      return {
        isValid: true,
        invoiceAmount: foundInvoiceAmount,
        variance,
        reason: 'Amount validated successfully'
      };

    } catch (error: any) {
      logger.warn('[WARN] [REFUND FILING] Error validating claim amount', {
        error: error.message
      });
      return { isValid: true, reason: 'Validation error - allowing to proceed' }; // Fail open
    }
  }

  /**
   * P3 — INVOICE DATE VALIDATION
   * Rejects claims where the invoice is dated AFTER the shipment was created.
   * Amazon's document forensics team flags this as forged evidence.
   */
  private async validateInvoiceDate(
    evidenceIds: string[],
    sellerId: string,
    disputeCase: any
  ): Promise<{ isValid: boolean; reason?: string }> {
    try {
      if (!evidenceIds || evidenceIds.length === 0) {
        return { isValid: true, reason: 'No evidence to validate dates against' };
      }

      // Get shipment creation date from detection evidence
      const detectionEvidence = disputeCase.detection_results?.evidence || {};
      const shipmentId = detectionEvidence.shipment_id || detectionEvidence.fba_shipment_id;

      if (!shipmentId) {
        return { isValid: true, reason: 'No shipment_id available for date comparison' };
      }

      // Fetch the shipment creation date
      const { data: shipment } = await supabaseAdmin
        .from('fba_shipments')
        .select('created_at, shipment_id')
        .eq('shipment_id', shipmentId)
        .eq('seller_id', sellerId)
        .single();

      if (!shipment?.created_at) {
        return { isValid: true, reason: 'Shipment date not found, skipping date validation' };
      }

      const shipmentCreatedAt = new Date(shipment.created_at);

      // Fetch parsed invoice dates from linked evidence documents
      const { data: docs } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, filename, parsed_content, parsed_metadata')
        .in('id', evidenceIds)
        .eq('seller_id', sellerId);

      if (!docs || docs.length === 0) {
        return { isValid: true, reason: 'No parsed evidence documents found' };
      }

      for (const doc of docs) {
        const parsed = doc.parsed_content || doc.parsed_metadata || {};
        // Try various date field names used by different parsers
        const rawDate = parsed.invoice_date || parsed.date || parsed.document_date || parsed.issued_date;
        if (!rawDate) continue;

        const invoiceDate = new Date(rawDate);
        if (isNaN(invoiceDate.getTime())) continue;

        // FAIL: Invoice date is AFTER the shipment was created
        if (invoiceDate > shipmentCreatedAt) {
          logger.error('[REFUND FILING] INVOICE DATE TRAP — Invoice post-dates shipment creation', {
            disputeId: disputeCase.id,
            invoiceDate: invoiceDate.toISOString(),
            shipmentCreatedAt: shipmentCreatedAt.toISOString(),
            invoiceFile: doc.filename,
            shipmentId
          });
          return {
            isValid: false,
            reason: `Invoice "${doc.filename}" is dated ${invoiceDate.toDateString()} — AFTER shipment creation (${shipmentCreatedAt.toDateString()}). Amazon will flag this as forged.`
          };
        }
      }

      return { isValid: true, reason: 'Invoice dates validated' };

    } catch (error: any) {
      logger.warn('[REFUND FILING] Error validating invoice date, allowing to proceed', { error: error.message });
      return { isValid: true, reason: 'Date validation error — proceeding with caution' };
    }
  }

  /**
   * P7 — REJECTION CLASSIFIER
   * Categorises Amazon's denial reason string to determine the smartest retry strategy.
   * Prevents wasting retry budget on cases that are already resolved or unfixable.
   */
  private classifyRejection(reason: string): 'evidence_needed' | 'already_resolved' | 'wrong_claim_type' | 'unknown' {
    const lower = (reason || '').toLowerCase();
    if (lower.includes('already') || lower.includes('reimbursed') || lower.includes('credited') || lower.includes('resolved') || lower.includes('paid')) {
      return 'already_resolved';
    }
    if (lower.includes('invoice') || lower.includes('proof') || lower.includes('documentation') || lower.includes('evidence') || lower.includes('provide') || lower.includes('additional')) {
      return 'evidence_needed';
    }
    if (lower.includes('wrong') || lower.includes('incorrect') || lower.includes('does not match') || lower.includes('ineligible') || lower.includes('not eligible')) {
      return 'wrong_claim_type';
    }
    return 'unknown';
  }

  /**
   * P9 — POD KEYWORD VALIDATION
   * Checks if documents classified as PODs contain delivery-confirmation keywords
   * in their parsed text. Flags PODs that are empty or content-free.
   */
  private async validatePodEvidence(
    evidenceIds: string[],
    sellerId: string
  ): Promise<{ hasValidPod: boolean; weakPods: string[] }> {
    const POD_KEYWORDS = ['delivered', 'received by', 'signed', 'signature', 'proof of delivery', 'pod confirmed', 'delivery confirmed'];
    const weakPods: string[] = [];

    try {
      const { data: docs } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, filename, doc_type, parsed_content, extracted')
        .in('id', evidenceIds)
        .eq('seller_id', sellerId);

      if (!docs) return { hasValidPod: true, weakPods: [] };

      for (const doc of docs) {
        const filenameNorm = (doc.filename || '').toLowerCase();
        const docTypeNorm = (doc.doc_type || '').toLowerCase();
        const isPod = filenameNorm.includes('pod') ||
          filenameNorm.includes('proof_of_delivery') ||
          filenameNorm.includes('proof-of-delivery') ||
          docTypeNorm.includes('pod') ||
          docTypeNorm.includes('delivery');
        if (!isPod) continue;

        const textContent = JSON.stringify(doc.parsed_content || doc.extracted || '').toLowerCase();
        const hasDeliveryKeyword = POD_KEYWORDS.some(kw => textContent.includes(kw));

        if (!hasDeliveryKeyword) {
          weakPods.push(doc.filename || doc.id);
          logger.warn('[REFUND FILING] POD document has no delivery-confirmation keywords', {
            docId: doc.id,
            filename: doc.filename
          });
        }
      }
    } catch (error: any) {
      logger.warn('[REFUND FILING] Error validating POD evidence', { error: error.message });
    }

    return { hasValidPod: weakPods.length === 0, weakPods };
  }

  async runFilingForAllTenants(): Promise<FilingStats> {

    const stats: FilingStats = {
      processed: 0,
      filed: 0,
      failed: 0,
      skipped: 0,
      statusUpdated: 0,
      retried: 0,
      errors: []
    };

    try {
      logger.info(' [REFUND FILING] Starting filing run for all tenants');

      // P5: GLOBAL KILL SWITCH — Check feature flag before ANY filing
      // Toggle 'agent7_filing_enabled' to false in feature_flags table to halt all filing instantly.
      const filingEnabled = await featureFlagService.isEnabled('agent7_filing_enabled', 'system');
      if (!filingEnabled) {
        logger.warn('🛑 [REFUND FILING] GLOBAL KILL SWITCH ACTIVE — agent7_filing_enabled=false. All filing halted.');
        return stats;
      }

      // MULTI-TENANT: Get all active tenants first
      const { data: tenants, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('id, name, status')
        .in('status', ['active', 'trialing'])
        .is('deleted_at', null);

      if (tenantError) {
        logger.error(' [REFUND FILING] Failed to get active tenants', { error: tenantError.message });
        stats.errors.push(`Failed to get tenants: ${tenantError.message}`);
        return stats;
      }

      if (!tenants || tenants.length === 0) {
        logger.debug('[INFO] [REFUND FILING] No active tenants found');
        return stats;
      }

      logger.info(` [REFUND FILING] Processing ${tenants.length} active tenants`);

      // MULTI-TENANT: Process each tenant in isolation
      for (const tenant of tenants) {
        try {
          const tenantStats = await this.runFilingForTenant(tenant.id);
          stats.processed += tenantStats.processed;
          stats.filed += tenantStats.filed;
          stats.failed += tenantStats.failed;
          stats.skipped += tenantStats.skipped;
          stats.retried += tenantStats.retried;
          stats.errors.push(...tenantStats.errors);
        } catch (error: any) {
          logger.error(' [REFUND FILING] Error processing tenant', {
            tenantId: tenant.id,
            tenantName: tenant.name,
            error: error.message
          });
          stats.errors.push(`Tenant ${tenant.id}: ${error.message}`);
        }
      }

      logger.info(' [REFUND FILING] Filing run completed for all tenants', stats);
      return stats;

    } catch (error: any) {
      logger.error(' [REFUND FILING] Fatal error in filing run', { error: error.message });
      stats.errors.push(`Fatal error: ${error.message}`);
      return stats;
    }
  }

  /**
   * MULTI-TENANT: Run filing for a specific tenant
   * All database queries are scoped to this tenant only
   */
  async runFilingForTenant(tenantId: string): Promise<FilingStats> {
    const stats: FilingStats = {
      processed: 0,
      filed: 0,
      failed: 0,
      skipped: 0,
      statusUpdated: 0,
      retried: 0,
      errors: []
    };

    // THROTTLE CHECK: Hourly rate limit (per-tenant)
    const filingsLastHour = await this.getFilingsInLastHourForTenant(tenantId);
    const remainingHourlyQuota = RefundFilingWorker.THROTTLE_CONFIG.MAX_PER_HOUR - filingsLastHour;

    if (remainingHourlyQuota <= 0) {
      logger.info(' [REFUND FILING] Hourly quota reached for tenant, skipping', {
        tenantId,
        filingsLastHour,
        maxPerHour: RefundFilingWorker.THROTTLE_CONFIG.MAX_PER_HOUR
      });
      return stats;
    }

    // Calculate how many we can process this run (min of per-run limit and remaining quota)
    const maxThisRun = Math.min(
      RefundFilingWorker.THROTTLE_CONFIG.MAX_PER_RUN,
      remainingHourlyQuota
    );

    logger.info(' [REFUND FILING] Throttle check passed for tenant', {
      tenantId,
      filingsLastHour,
      remainingHourlyQuota,
      maxThisRun
    });

    // MULTI-TENANT: Get cases for this tenant only using tenant-scoped query
    const tenantQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');

    const { data: casesToFile, error } = await tenantQuery
      .select(`
        id, 
        seller_id, 
        tenant_id,
        detection_result_id, 
        case_type, 
        claim_amount, 
        currency, 
        status, 
        filing_status, 
        retry_count,
        detection_results!inner (
          evidence
        ),
        dispute_evidence_links!inner (
          evidence_document_id
        )
      `)
      .in('filing_status', ['pending', 'retrying'])
      .or('status.eq.pending,status.eq.submitted')
      .limit(maxThisRun);

    if (error) {
      if (error.message?.includes('0 rows') || error.code === 'PGRST116') {
        logger.debug('[INFO] [REFUND FILING] No cases with evidence ready for filing', { tenantId });
        return stats;
      }
      logger.error(' [REFUND FILING] Failed to get cases to file', { tenantId, error: error.message });
      stats.errors.push(`Failed to get cases: ${error.message}`);
      return stats;
    }

    if (!casesToFile || casesToFile.length === 0) {
      logger.debug('[INFO] [REFUND FILING] No cases with evidence ready for filing', { tenantId });
      return stats;
    }

    logger.info(` [REFUND FILING] Found ${casesToFile.length} cases with evidence ready for filing`, { tenantId });
    console.log(`\nDEBUG: Found ${casesToFile.length} cases for tenant ${tenantId}`);

    // Process each case
    for (const disputeCase of casesToFile) {
      try {
        stats.processed++;

        // Evidence documents are already joined - extract from the query result
        logger.info(` [DEBUG] Processing case ${disputeCase.id}`, {
          keys: Object.keys(disputeCase),
          evidenceLinkRaw: (disputeCase as any).dispute_evidence_links,
          detectionResultRaw: (disputeCase as any).detection_results
        });

        const evidenceLinksFromQuery = (disputeCase as any).dispute_evidence_links || [];
        const evidenceIds = Array.isArray(evidenceLinksFromQuery)
          ? evidenceLinksFromQuery.map((link: any) => link.evidence_document_id)
          : [(evidenceLinksFromQuery as any).evidence_document_id].filter(Boolean);

        logger.info(` [DEBUG] Case ${disputeCase.id} evidenceIds:`, { evidenceIds });

        // Double-check we have evidence (should always be true due to !inner join)
        if (evidenceIds.length === 0) {
          logger.debug('[INFO] [REFUND FILING] Skipping case without evidence', {
            disputeId: disputeCase.id
          });
          continue;
        }

        // KILL SWITCH LAYER 1: Check for dangerous filenames (credit notes, returns, refunds)
        // These MUST NEVER be submitted to Amazon - instant fraud flag
        const dangerousDocCheck = await this.hasDangerousDocuments(evidenceIds, disputeCase.seller_id);
        if (dangerousDocCheck.hasDangerous) {
          logger.warn('[CRITICAL] [REFUND FILING] DANGEROUS FILENAME DETECTED - Quarantining case', {
            disputeId: disputeCase.id,
            dangerousFilenames: dangerousDocCheck.dangerousFilenames,
            reason: 'Filename contains credit/return/refund keywords - fraud risk'
          });
          stats.skipped++;

          // Quarantine this case - it must NEVER be auto-submitted (tenant-scoped)
          const quarantineQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
          const { error: qErr } = await quarantineQuery
            .update({
              filing_status: 'quarantined_dangerous_doc',
              updated_at: new Date().toISOString()
            })
            .eq('id', disputeCase.id);

          if (qErr) {
            logger.error('[ERROR] [REFUND FILING] Failed to quarantine dangerous case', { disputeId: disputeCase.id, error: qErr.message });
          } else {
            console.log(`DEBUG: Successfully quarantined case ${disputeCase.id}`);
          }

          continue; // Skip to next case - this one is quarantined
        }

        // KILL SWITCH LAYER 2: Check document CONTENT for dangerous patterns
        // This catches cases like "invoice_12345.pdf" that contains "CREDIT NOTE" inside
        const dangerousContentCheck = await this.hasDangerousContent(evidenceIds, disputeCase.seller_id);
        if (dangerousContentCheck.hasDangerous) {
          logger.warn('[CRITICAL] [REFUND FILING] DANGEROUS CONTENT DETECTED - Quarantining case', {
            disputeId: disputeCase.id,
            dangerousFindings: dangerousContentCheck.dangerousFindings,
            reason: 'Document content contains credit/refund/return language'
          });
          stats.skipped++;

          // Quarantine this case - it must NEVER be auto-submitted (tenant-scoped)
          const quarantineQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
          const { error: qErr } = await quarantineQuery
            .update({
              filing_status: 'quarantined_dangerous_doc',
              metadata: {
                quarantine_reason: 'dangerous_content',
                dangerous_findings: dangerousContentCheck.dangerousFindings
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', disputeCase.id);

          if (qErr) {
            logger.error('[ERROR] [REFUND FILING] Failed to quarantine dangerous content case', { disputeId: disputeCase.id, error: qErr.message });
          } else {
            console.log(`DEBUG: Successfully quarantined dangerous content case ${disputeCase.id}`);
          }

          continue; // Skip to next case - this one is quarantined
        }

        // Extract order details from detection_results.evidence JSONB
        const detectionEvidence = (disputeCase as any).detection_results?.evidence || {};
        const orderId = detectionEvidence.order_id || '';
        const asin = detectionEvidence.asin || undefined;
        const sku = detectionEvidence.sku || undefined;

        // DUPLICATE PREVENTION: Check if this order already has an active case
        // This is CRITICAL - filing duplicates = Amazon support abuse flag
        if (orderId) {
          const hasDuplicate = await this.hasActiveClaimForOrder(orderId, disputeCase.seller_id, disputeCase.id);
          if (hasDuplicate) {
            logger.info('[SKIP] [REFUND FILING] Skipping case - duplicate claim exists for order', {
              disputeId: disputeCase.id,
              orderId
            });
            stats.skipped++;

            // Mark this case as duplicate to prevent future processing (tenant-scoped)
            const duplicateQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
            const { error: dErr } = await duplicateQuery
              .update({
                filing_status: 'duplicate_blocked',
                updated_at: new Date().toISOString()
              })
              .eq('id', disputeCase.id);

            if (dErr) {
              logger.error('[ERROR] [REFUND FILING] Failed to mark case as duplicate', { disputeId: disputeCase.id, error: dErr.message });
            } else {
              console.log(`DEBUG: Successfully marked duplicate case ${disputeCase.id}`);
            }

            continue; // Skip to next case
          }
        }

        // DOUBLE-DIP PREVENTION: Check if item was already reimbursed
        // Filing for something Amazon already paid = "Theft" accusation
        // P6: Now also checks by shipment_id to catch FC sweep / General Adjustment credits
        const shipmentId = detectionEvidence.shipment_id || detectionEvidence.fba_shipment_id;
        const alreadyReimbursed = await this.wasAlreadyReimbursed(
          orderId,
          sku,
          asin,
          disputeCase.seller_id,
          shipmentId
        );
        if (alreadyReimbursed) {
          logger.info('[SKIP] [REFUND FILING] Skipping case - item already reimbursed by Amazon', {
            disputeId: disputeCase.id,
            orderId,
            sku,
            shipmentId
          });
          stats.skipped++;

          // Mark this case to prevent future processing (tenant-scoped)
          const reimbursedQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
          const { error: rErr } = await reimbursedQuery
            .update({
              filing_status: 'already_reimbursed',
              updated_at: new Date().toISOString()
            })
            .eq('id', disputeCase.id);

          if (rErr) {
            logger.error('[ERROR] [REFUND FILING] Failed to mark case as already reimbursed', { disputeId: disputeCase.id, error: rErr.message });
          } else {
            console.log(`DEBUG: Successfully marked reimbursed case ${disputeCase.id}`);
          }

          continue; // Skip to next case
        }

        // Get detection result for confidence score (tenant-scoped)
        const detectionQuery = createTenantScopedQueryById(tenantId, 'detection_results');
        const { data: detectionResult } = await detectionQuery
          .select('match_confidence')
          .eq('id', disputeCase.detection_result_id)
          .single();

        const confidenceScore = detectionResult?.match_confidence || 0.85;

        // Get claim amount for validation checks
        const claimAmount = parseFloat(disputeCase.claim_amount?.toString() || '0');

        // PER-SELLER DAILY LIMIT: Prevent one seller from exhausting tenant quota
        const sellerFilingsToday = await this.getFilingsInLastDayForSeller(disputeCase.seller_id, tenantId);
        if (sellerFilingsToday >= RefundFilingWorker.THROTTLE_CONFIG.MAX_PER_SELLER_PER_DAY) {
          logger.info('[SKIP] [REFUND FILING] Seller daily limit reached', {
            disputeId: disputeCase.id,
            sellerId: disputeCase.seller_id,
            filedToday: sellerFilingsToday,
            maxPerSellerPerDay: RefundFilingWorker.THROTTLE_CONFIG.MAX_PER_SELLER_PER_DAY
          });
          stats.skipped++;
          continue; // Skip this case - seller hit their daily limit
        }

        // P4: MINIMUM ROI THRESHOLD — Skip claims under $25
        // At 10 claims/day/seller, every slot is worth protecting.
        // A $25 floor ensures minimum $5 return at 20% commission.
        if (claimAmount < RefundFilingWorker.MIN_FILING_THRESHOLD) {
          logger.info('[SKIP] [REFUND FILING] Claim below minimum filing threshold', {
            disputeId: disputeCase.id,
            claimAmount,
            threshold: RefundFilingWorker.MIN_FILING_THRESHOLD
          });
          stats.skipped++;
          await supabaseAdmin.from('dispute_cases').update({
            filing_status: 'skipped_low_value',
            updated_at: new Date().toISOString()
          }).eq('id', disputeCase.id);
          continue;
        }

        // P10: DIMENSION / WEIGHT FEE GATE — Route to manual review
        // Agent 7 has no independent physical dimension proof (spec sheets, GS1, Cubiscan).
        // Auto-filing dimension claims without proof = guaranteed denial.
        if (RefundFilingWorker.DIMENSION_CLAIM_TYPES.includes((disputeCase.case_type || '').toLowerCase())) {
          logger.warn('[SKIP] [REFUND FILING] Dimension/weight claim requires manual review — no spec sheet proof available', {
            disputeId: disputeCase.id,
            caseType: disputeCase.case_type
          });
          stats.skipped++;
          await supabaseAdmin.from('dispute_cases').update({
            filing_status: 'pending_approval',
            status: 'needs_dimension_proof',
            updated_at: new Date().toISOString()
          }).eq('id', disputeCase.id);
          continue;
        }

        // P3: INVOICE DATE VALIDATION — Reject future-dated invoices
        // An invoice dated after the shipment creation date = automatic fraud flag from Amazon.
        const dateValidation = await this.validateInvoiceDate(evidenceIds, disputeCase.seller_id, disputeCase);
        if (!dateValidation.isValid) {
          logger.error('[BLOCK] [REFUND FILING] INVOICE DATE TRAP — Blocking filing to prevent fraud accusation', {
            disputeId: disputeCase.id,
            reason: dateValidation.reason
          });
          stats.skipped++;
          await supabaseAdmin.from('dispute_cases').update({
            filing_status: 'blocked_invalid_date',
            metadata: { block_reason: dateValidation.reason },
            updated_at: new Date().toISOString()
          }).eq('id', disputeCase.id);
          continue;
        }

        // P9: POD KEYWORD VALIDATION — Flag PODs without delivery-confirmation text
        // A blank PDF named "pod_123.pdf" has no evidentiary value.
        const podValidation = await this.validatePodEvidence(evidenceIds, disputeCase.seller_id);
        if (!podValidation.hasValidPod) {
          logger.warn('[WARN] [REFUND FILING] Weak POD evidence detected — routing to manual review', {
            disputeId: disputeCase.id,
            weakPods: podValidation.weakPods
          });
          stats.skipped++;
          await supabaseAdmin.from('dispute_cases').update({
            filing_status: 'pending_approval',
            metadata: { approval_reason: 'weak_pod_evidence', weak_pods: podValidation.weakPods },
            updated_at: new Date().toISOString()
          }).eq('id', disputeCase.id);
          continue;
        }

        // CLAIM AMOUNT VALIDATION: Cross-check against parsed invoice total
        // Catches LLM hallucinations where detection says $1000 but invoice shows $100
        const amountValidation = await this.validateClaimAmount(claimAmount, evidenceIds, disputeCase.seller_id);
        if (!amountValidation.isValid) {
          logger.warn('[WARN] [REFUND FILING] CLAIM AMOUNT MISMATCH - Flagging for review', {
            disputeId: disputeCase.id,
            claimAmount,
            invoiceAmount: amountValidation.invoiceAmount,
            variance: amountValidation.variance,
            reason: amountValidation.reason
          });
          stats.skipped++;

          // Flag for manual review due to amount mismatch
          const mismatchQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
          const { error: mErr } = await mismatchQuery
            .update({
              filing_status: 'pending_approval',
              metadata: {
                approval_reason: 'amount_mismatch',
                claim_amount: claimAmount,
                invoice_amount: amountValidation.invoiceAmount,
                variance: amountValidation.variance
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', disputeCase.id);

          if (mErr) {
            logger.error('[ERROR] [REFUND FILING] Failed to mark case for approval due to amount mismatch', { disputeId: disputeCase.id, error: mErr.message });
          } else {
            console.log(`DEBUG: Successfully marked amount mismatch case ${disputeCase.id} for approval`);
          }

          continue; // Skip to next case - needs human review
        }

        // HIGH-VALUE CLAIM CHECK: Require human approval for large claims
        // LLMs can hallucinate (read 10 units as 100), causing fraud accusations
        // Claims over threshold must be manually reviewed before submission
        if (claimAmount > RefundFilingWorker.HIGH_VALUE_THRESHOLD) {
          logger.warn(' [REFUND FILING] HIGH-VALUE CLAIM - Requires manual approval', {
            disputeId: disputeCase.id,
            claimAmount: claimAmount,
            threshold: RefundFilingWorker.HIGH_VALUE_THRESHOLD,
            currency: disputeCase.currency || 'USD'
          });
          stats.skipped++;

          // Mark for manual approval instead of auto-filing (tenant-scoped)
          const approvalQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
          const { error: aErr } = await approvalQuery
            .update({
              filing_status: 'pending_approval',
              updated_at: new Date().toISOString()
            })
            .eq('id', disputeCase.id);

          if (aErr) {
            logger.error('[ERROR] [REFUND FILING] Failed to mark case for approval', { disputeId: disputeCase.id, error: aErr.message });
          } else {
            console.log(`DEBUG: Successfully marked high-value case ${disputeCase.id} for approval`);
          }

          continue; // Skip to next case - human must approve this one
        }

        // Prepare filing request
        const filingRequest: FilingRequest = {
          dispute_id: disputeCase.id,
          user_id: disputeCase.seller_id,
          order_id: orderId,
          asin: asin,
          sku: sku,
          claim_type: disputeCase.case_type,
          amount_claimed: parseFloat(disputeCase.claim_amount?.toString() || '0'),
          currency: disputeCase.currency || 'USD',
          evidence_document_ids: evidenceIds,
          confidence_score: confidenceScore
        };

        // Check if this is a retry (need stronger evidence)
        if (disputeCase.filing_status === 'retrying' && disputeCase.retry_count > 0) {
          logger.info(' [REFUND FILING] Retrying with stronger evidence', {
            disputeId: disputeCase.id,
            retryCount: disputeCase.retry_count
          });

          // Collect stronger evidence
          const strongerEvidenceIds = await refundFilingService.collectStrongerEvidence(
            disputeCase.id,
            disputeCase.seller_id
          );

          if (strongerEvidenceIds.length > evidenceIds.length) {
            filingRequest.evidence_document_ids = strongerEvidenceIds;
            stats.retried++;
          }
        }
        // 🎯 AGENT 7: Automated Submission Protocol
        // Use the new Automator to handle the full filing loop autonomously
        const automator = (await import('../services/AmazonSubmissionAutomator')).default;

        try {
          const amazonCaseId = await automator.executeFullSubmission(disputeCase.id, disputeCase.seller_id);
          if (amazonCaseId) {
            logger.info(`🎯 [AGENT 7] Fully autonomous submission complete`, { disputeId: disputeCase.id, amazonCaseId });
            stats.filed++;
          }
        } catch (automatorError: any) {
          logger.error(`❌ [AGENT 7] Automator failed, falling back to legacy filing`, { disputeId: disputeCase.id, error: automatorError.message });

          // Legacy Fallback
          const filingResult = await retryWithBackoff(() => refundFilingService.fileDispute(filingRequest));
          if (filingResult.success) {
            await this.updateCaseAfterFiling(disputeCase.id, filingResult);
            stats.filed++;
          } else {
            await this.handleFilingFailure(disputeCase.id, disputeCase.seller_id, filingResult, disputeCase.retry_count || 0);
            stats.failed++;
            stats.errors.push(`Case ${disputeCase.id}: ${filingResult.error_message || 'Filing failed'}`);
          }
        }
      } catch (error: any) {
        logger.error(' [REFUND FILING] Error processing case', {
          disputeId: disputeCase.id,
          error: error.message
        });
        await this.logError(disputeCase.id, disputeCase.seller_id, error.message);
        stats.failed++;
        stats.errors.push(`Case ${disputeCase.id}: ${error.message}`);
      }

      // VELOCITY LIMIT: Jittered delay between submissions (180-420 seconds = 3-7 minutes)
      // This mimics human behavior and avoids Amazon's pattern detection
      // A fixed interval (e.g., exactly 5 min) looks robotic; random intervals look human
      if (casesToFile.indexOf(disputeCase) < casesToFile.length - 1) {
        await sleepWithJitter(180, 420);
      }
    }

    logger.info(' [REFUND FILING] Tenant filing run completed', { tenantId, stats });
    return stats;
  }

  /**
   * MULTI-TENANT: Get filings in last hour for a specific tenant
   */
  private async getFilingsInLastHourForTenant(tenantId: string): Promise<number> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const tenantQuery = createTenantScopedQueryById(tenantId, 'dispute_submissions');

      const { count, error } = await tenantQuery
        .select('*', { count: 'exact', head: true })
        .gte('created_at', oneHourAgo);

      if (error) {
        logger.warn(' [REFUND FILING] Could not check hourly filings for tenant', {
          tenantId,
          error: error.message
        });
        return 0;
      }

      return count || 0;
    } catch (error: any) {
      logger.warn(' [REFUND FILING] Error checking hourly filings for tenant', { tenantId, error: error.message });
      return 0;
    }
  }

  /**
   * Poll case statuses from Amazon
   * MULTI-TENANT: Processes each tenant in isolation
   */
  async pollCaseStatuses(): Promise<void> {
    try {
      logger.info(' [REFUND FILING] Starting case status polling');

      // Get cases that have been filed but not yet closed
      const { data: filedCases, error } = await supabaseAdmin
        .from('dispute_cases')
        .select('id, seller_id, filing_status')
        .eq('filing_status', 'filed')
        .not('status', 'in', '(approved,rejected,closed)')
        .limit(100);

      if (error) {
        logger.error(' [REFUND FILING] Failed to get filed cases', { error: error.message });
        return;
      }

      if (!filedCases || filedCases.length === 0) {
        logger.debug('[INFO] [REFUND FILING] No filed cases to poll');
        return;
      }

      logger.info(` [REFUND FILING] Polling status for ${filedCases.length} cases`);

      // Get submission IDs for these cases
      for (const disputeCase of filedCases) {
        try {
          const { data: submission } = await supabaseAdmin
            .from('dispute_submissions')
            .select('id, submission_id, status')
            .eq('dispute_id', disputeCase.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (!submission || !submission.submission_id) {
            logger.debug(' [REFUND FILING] No submission ID found for case', {
              disputeId: disputeCase.id
            });
            continue;
          }

          // Check status from Amazon
          const statusResult = await refundFilingService.checkCaseStatus(
            submission.submission_id,
            disputeCase.seller_id
          );

          if (statusResult.success) {
            // Update case status
            await this.updateCaseStatus(disputeCase.id, statusResult);

            // P8: PENDING ACTION DETECTION — Detect when Amazon requests more information
            // Amazon sometimes keeps a case 'in_progress' but adds a message like
            // "Please provide additional documentation". Without reading the message, we'd
            // miss it entirely and the case would silently expire.
            if (statusResult.status === 'in_progress' && statusResult.resolution) {
              const resolutionText = (statusResult.resolution || '').toLowerCase();
              const needsInfo = resolutionText.includes('additional') ||
                resolutionText.includes('provide') ||
                resolutionText.includes('information') ||
                resolutionText.includes('documentation') ||
                resolutionText.includes('required');
              if (needsInfo) {
                logger.warn('🔔 [REFUND FILING] Amazon requesting more information — notifying seller and triggering stronger evidence retry', {
                  disputeId: disputeCase.id,
                  message: statusResult.resolution
                });
                try {
                  const { default: notificationHelper } = await import('../services/notificationHelper');
                  const { NotificationType, NotificationPriority, NotificationChannel } = await import('../notifications/models/notification');
                  await notificationHelper.notifyUser(
                    disputeCase.seller_id,
                    NotificationType.USER_ACTION_REQUIRED,
                    '⚠️ Amazon Needs More Information',
                    `Amazon is requesting additional information for your claim${statusResult.amazon_case_id ? ` (Case ${statusResult.amazon_case_id})` : ''}: "${statusResult.resolution}". We are auto-supplementing evidence and resubmitting.`,
                    NotificationPriority.URGENT,
                    NotificationChannel.IN_APP,
                    { disputeId: disputeCase.id, amazonCaseId: statusResult.amazon_case_id }
                  );
                } catch (notifErr: any) {
                  logger.warn(' [REFUND FILING] Failed to send pending-action notification', { error: notifErr.message });
                }
                // Auto-supplement evidence and retry
                await this.markForRetry(disputeCase.id, disputeCase.seller_id);
              }
            }

            // If denied, mark for retry with stronger evidence
            if (statusResult.status === 'denied' && submission.status !== 'denied') {
              const rejectionReason = statusResult.error || statusResult.resolution || 'Unknown reason';
              logger.warn(' [REFUND FILING] Case denied, marking for retry', {
                disputeId: disputeCase.id,
                rejectionReason: rejectionReason
              });

              // AGENT 11 INTEGRATION: Process rejection for learning
              try {
                const learningWorker = (await import('./learningWorker')).default;
                await learningWorker.processRejection(
                  disputeCase.seller_id,
                  disputeCase.id,
                  rejectionReason,
                  statusResult.amazon_case_id
                );
              } catch (learnError: any) {
                logger.warn(' [REFUND FILING] Failed to process rejection for learning', {
                  error: learnError.message
                });
              }

              // AGENT 11 INTEGRATION: Log filing denial event
              try {
                const agentEventLogger = (await import('../services/agentEventLogger')).default;
                await agentEventLogger.logRefundFiling({
                  userId: disputeCase.seller_id,
                  disputeId: disputeCase.id,
                  success: false,
                  status: 'denied',
                  rejectionReason: rejectionReason,
                  amazonCaseId: statusResult.amazon_case_id,
                  duration: 0
                });
              } catch (logError: any) {
                logger.warn(' [REFUND FILING] Failed to log event', {
                  error: logError.message
                });
              }

              // P7: SMART REJECTION CLASSIFIER
              // Route based on denial category rather than blindly retrying every denial.
              const rejectionCategory = this.classifyRejection(rejectionReason);
              logger.info(' [REFUND FILING] Rejection classified', {
                disputeId: disputeCase.id,
                rejectionCategory,
                rejectionReason
              });

              if (rejectionCategory === 'already_resolved') {
                // Amazon says it's already paid — mark FAILED, don't waste retry budget
                logger.warn(' [REFUND FILING] Rejection: already resolved — marking FAILED, no retry', { disputeId: disputeCase.id });
                await supabaseAdmin.from('dispute_cases').update({
                  filing_status: 'failed',
                  status: 'closed_already_resolved',
                  updated_at: new Date().toISOString()
                }).eq('id', disputeCase.id);

              } else if (rejectionCategory === 'wrong_claim_type') {
                // Claim type mismatch — needs human to re-categorise, don't auto-retry
                logger.warn(' [REFUND FILING] Rejection: wrong claim type — routing to manual review', { disputeId: disputeCase.id });
                await supabaseAdmin.from('dispute_cases').update({
                  filing_status: 'pending_approval',
                  metadata: { approval_reason: 'wrong_claim_type', rejection_reason: rejectionReason },
                  updated_at: new Date().toISOString()
                }).eq('id', disputeCase.id);

              } else {
                // evidence_needed or unknown — retry with stronger evidence (original behaviour)
                await this.markForRetry(disputeCase.id, disputeCase.seller_id);
              }

              // 🔔 NOTIFICATION: Tell the user their claim was denied
              try {
                const { default: notificationHelper } = await import('../services/notificationHelper');
                const { NotificationType, NotificationPriority, NotificationChannel } = await import('../notifications/models/notification');
                await notificationHelper.notifyUser(
                  disputeCase.seller_id,
                  NotificationType.CLAIM_DENIED,
                  'Claim Update: Under Review',
                  `Amazon has requested additional review for your claim${statusResult.amazon_case_id ? ` (Case ${statusResult.amazon_case_id})` : ''}. Reason: ${rejectionReason}. We're strengthening the evidence for resubmission.`,
                  NotificationPriority.HIGH,
                  NotificationChannel.IN_APP,
                  {
                    disputeId: disputeCase.id,
                    amazonCaseId: statusResult.amazon_case_id,
                    rejectionReason,
                    action: 'retry_with_stronger_evidence'
                  }
                );
              } catch (notifError: any) {
                logger.warn('⚠️ [REFUND FILING] Failed to send rejection notification', {
                  error: notifError.message
                });
              }
            }
          }

        } catch (error: any) {
          logger.error(' [REFUND FILING] Error polling case status', {
            disputeId: disputeCase.id,
            error: error.message
          });
        }

        // VELOCITY LIMIT: Jittered delay between status polls (30-90 seconds)
        // Less aggressive than filing, but still randomized to avoid patterns
        if (filedCases.indexOf(disputeCase) < filedCases.length - 1) {
          await sleepWithJitter(30, 90);
        }
      }

      logger.info(' [REFUND FILING] Status polling completed');

    } catch (error: any) {
      logger.error(' [REFUND FILING] Fatal error in status polling', { error: error.message });
    }
  }

  /**
  * Update case after successful filing
  */
  private async updateCaseAfterFiling(disputeId: string, result: FilingResult): Promise<void> {
    try {
      const updates: any = {
        filing_status: 'filed',
        status: 'auto_submitted',
        updated_at: new Date().toISOString()
      };

      if (result.amazon_case_id) {
        updates.provider_case_id = result.amazon_case_id;
      }

      const { error } = await supabaseAdmin
        .from('dispute_cases')
        .update(updates)
        .eq('id', disputeId);

      if (error) {
        logger.error(' [REFUND FILING] Failed to update case after filing', {
          disputeId,
          error: error.message
        });
      } else {
        // Create submission record
        const { data: disputeCase } = await supabaseAdmin
          .from('dispute_cases')
          .select('seller_id')
          .eq('id', disputeId)
          .single();

        await supabaseAdmin
          .from('dispute_submissions')
          .insert({
            dispute_id: disputeId,
            user_id: disputeCase?.seller_id,
            submission_id: result.submission_id,
            amazon_case_id: result.amazon_case_id,
            status: result.status,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        logger.info(' [REFUND FILING] Case filed successfully', {
          disputeId,
          submissionId: result.submission_id,
          amazonCaseId: result.amazon_case_id
        });

        // AGENT 11 INTEGRATION: Log filing event
        try {
          const agentEventLogger = (await import('../services/agentEventLogger')).default;
          await agentEventLogger.logRefundFiling({
            userId: disputeCase.seller_id,
            disputeId,
            success: true,
            status: 'filed',
            amazonCaseId: result.amazon_case_id,
            duration: 0
          });
        } catch (logError: any) {
          logger.warn(' [REFUND FILING] Failed to log event', {
            error: logError.message
          });
        }

        // AGENT 10 INTEGRATION: Notify when case is filed
        try {
          const notificationHelper = (await import('../services/notificationHelper')).default;
          await notificationHelper.notifyCaseFiled(disputeCase.seller_id, {
            disputeId,
            caseId: result.submission_id,
            amazonCaseId: result.amazon_case_id,
            claimAmount: disputeCase.claim_amount || 0,
            currency: disputeCase.currency || 'usd',
            status: 'filed'
          });
        } catch (notifError: any) {
          logger.warn(' [REFUND FILING] Failed to send notification', {
            error: notifError.message
          });
        }
      }

    } catch (error: any) {
      logger.error(' [REFUND FILING] Error updating case after filing', {
        disputeId,
        error: error.message
      });
    }
  }

  /**
  * Handle filing failure
  */
  private async handleFilingFailure(
    disputeId: string,
    userId: string,
    result: FilingResult,
    currentRetryCount: number
  ): Promise<void> {
    const maxRetries = 3;
    const newRetryCount = currentRetryCount + 1;

    if (newRetryCount < maxRetries) {
      // Mark for retry
      await supabaseAdmin
        .from('dispute_cases')
        .update({
          filing_status: 'retrying',
          retry_count: newRetryCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', disputeId);

      logger.warn(' [REFUND FILING] Marking case for retry', {
        disputeId,
        retryCount: newRetryCount,
        maxRetries
      });
    } else {
      // Max retries exceeded
      await supabaseAdmin
        .from('dispute_cases')
        .update({
          filing_status: 'failed',
          retry_count: newRetryCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', disputeId);

      logger.error(' [REFUND FILING] Max retries exceeded for case', {
        disputeId,
        retryCount: newRetryCount
      });
    }

    await this.logError(disputeId, userId, result.error_message || 'Filing failed', newRetryCount, maxRetries);
  }

  /**
  * Update case status from polling
  */
  private async updateCaseStatus(disputeId: string, statusResult: CaseStatus): Promise<void> {
    try {
      const statusMap: Record<string, string> = {
        'open': 'auto_submitted',
        'in_progress': 'auto_submitted',
        'approved': 'approved',
        'denied': 'rejected',
        'closed': 'closed'
      };

      const newStatus = statusMap[statusResult.status] || 'auto_submitted';
      const previousStatus = await this.getCurrentStatus(disputeId);

      const { data: disputeCase } = await supabaseAdmin
        .from('dispute_cases')
        .select('seller_id, recovery_status')
        .eq('id', disputeId)
        .single();

      const updates: any = {
        status: newStatus,
        updated_at: new Date().toISOString()
      };

      // AGENT 8 INTEGRATION: Mark for recovery detection when approved
      if (newStatus === 'approved' && previousStatus !== 'approved') {
        updates.recovery_status = 'pending';
        logger.info(' [REFUND FILING] Case approved, marked for recovery detection by Agent 8', {
          disputeId
        });

        // Fetch case data for logging and notifications
        const { data: caseData } = await supabaseAdmin
          .from('dispute_cases')
          .select('seller_id, claim_amount, currency, provider_case_id')
          .eq('id', disputeId)
          .single();

        // AGENT 11 INTEGRATION: Log approval event
        try {
          const agentEventLogger = (await import('../services/agentEventLogger')).default;
          await agentEventLogger.logRefundFiling({
            userId: caseData?.seller_id || disputeCase?.seller_id || '',
            disputeId,
            success: true,
            status: 'approved',
            amazonCaseId: statusResult.amazon_case_id || caseData?.provider_case_id,
            duration: 0
          });
        } catch (logError: any) {
          logger.warn(' [REFUND FILING] Failed to log event', {
            error: logError.message
          });
        }

        // AGENT 10 INTEGRATION: Notify when refund is approved
        try {
          const notificationHelper = (await import('../services/notificationHelper')).default;

          if (caseData) {
            await notificationHelper.notifyRefundApproved(caseData.seller_id, {
              disputeId,
              amazonCaseId: statusResult.amazon_case_id || caseData.provider_case_id,
              claimAmount: caseData.claim_amount || 0,
              currency: caseData.currency || 'usd',
              approvedAmount: statusResult.amount_approved || 0
            });
          }
        } catch (notifError: any) {
          logger.warn(' [REFUND FILING] Failed to send notification', {
            error: notifError.message
          });
        }
      }

      const { error } = await supabaseAdmin
        .from('dispute_cases')
        .update(updates)
        .eq('id', disputeId);

      if (error) {
        logger.error(' [REFUND FILING] Failed to update case status', {
          disputeId,
          error: error.message
        });
      } else {
        // Update submission status
        await supabaseAdmin
          .from('dispute_submissions')
          .update({
            status: statusResult.status,
            updated_at: new Date().toISOString()
          })
          .eq('dispute_id', disputeId);

        logger.info(' [REFUND FILING] Case status updated', {
          disputeId,
          status: statusResult.status
        });

        // Trigger recovery detection immediately if approved (non-blocking)
        if (newStatus === 'approved' && disputeCase?.seller_id) {
          this.triggerRecoveryDetection(disputeId, disputeCase.seller_id).catch((error: any) => {
            logger.warn(' [REFUND FILING] Failed to trigger recovery detection (non-critical)', {
              disputeId,
              error: error.message
            });
          });
        }
      }

    } catch (error: any) {
      logger.error(' [REFUND FILING] Error updating case status', {
        disputeId,
        error: error.message
      });
    }
  }

  /**
  * Get current status of dispute case
  */
  private async getCurrentStatus(disputeId: string): Promise<string | null> {
    try {
      const { data } = await supabaseAdmin
        .from('dispute_cases')
        .select('status')
        .eq('id', disputeId)
        .single();

      return data?.status || null;
    } catch {
      return null;
    }
  }

  /**
  * Trigger recovery detection for approved case (Agent 8)
  */
  private async triggerRecoveryDetection(disputeId: string, userId: string): Promise<void> {
    try {
      const { default: recoveriesWorker } = await import('./recoveriesWorker');
      await recoveriesWorker.processRecoveryForCase(disputeId, userId);
    } catch (error: any) {
      // Non-critical - recovery worker will pick it up in next run
      logger.debug(' [REFUND FILING] Recovery detection triggered (will retry in next run)', {
        disputeId,
        error: error.message
      });
    }
  }

  /**
  * Mark case for retry with stronger evidence
  */
  private async markForRetry(disputeId: string, userId: string): Promise<void> {
    try {
      const { data: caseData } = await supabaseAdmin
        .from('dispute_cases')
        .select('retry_count')
        .eq('id', disputeId)
        .single();

      const currentRetryCount = caseData?.retry_count || 0;
      const maxRetries = 3;

      if (currentRetryCount < maxRetries) {
        await supabaseAdmin
          .from('dispute_cases')
          .update({
            filing_status: 'retrying',
            retry_count: currentRetryCount + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', disputeId);

        logger.info(' [REFUND FILING] Marked case for retry with stronger evidence', {
          disputeId,
          retryCount: currentRetryCount + 1
        });
      } else {
        logger.warn(' [REFUND FILING] Max retries exceeded, not retrying', {
          disputeId,
          retryCount: currentRetryCount
        });
      }

    } catch (error: any) {
      logger.error(' [REFUND FILING] Error marking case for retry', {
        disputeId,
        error: error.message
      });
    }
  }

  /**
  * Log filing error
  */
  private async logError(
    disputeId: string,
    userId: string,
    errorMessage: string,
    retryCount: number = 0,
    maxRetries: number = 3
  ): Promise<void> {
    try {
      await supabaseAdmin
        .from('refund_filing_errors')
        .insert({
          user_id: userId,
          dispute_id: disputeId,
          error_type: 'filing_error',
          error_message: errorMessage,
          retry_count: retryCount,
          max_retries: maxRetries,
          created_at: new Date().toISOString()
        });

      logger.debug(' [REFUND FILING] Error logged', {
        disputeId,
        userId,
        errorMessage
      });

    } catch (error: any) {
      logger.error(' [REFUND FILING] Failed to log error', {
        disputeId,
        error: error.message
      });
    }
  }
}

// Export singleton instance
const refundFilingWorker = new RefundFilingWorker();
export default refundFilingWorker;

