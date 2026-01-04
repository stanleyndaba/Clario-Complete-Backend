/**
 * Refund Filing Worker
 * Automated background worker for filing disputes via Amazon SP-API (mock for MVP)
 * Runs every 5 minutes, files cases ready for submission, polls for status updates
 * Handles retry logic with stronger evidence for denied cases
 * 
 * ANTI-DETECTION: Uses jittered delays between submissions to mimic human behavior
 * Amazon bans robotic patterns (e.g., exact 5-minute intervals). Jitter makes us look human.
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import refundFilingService, { FilingRequest, FilingResult, CaseStatus } from '../services/refundFilingService';

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
  logger.debug(`⏳ [REFUND FILING] Sleeping for ${jitterSeconds.toFixed(0)}s (jitter: ${minSeconds}-${maxSeconds}s)`);
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
        logger.warn(`🔄 [REFUND FILING] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
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
    MAX_PER_RUN: 3,        // Only process 3 claims per 5-minute run
    MAX_PER_HOUR: 12,      // Max 12 claims per hour (soft limit)
    MAX_PER_DAY: 100,      // Daily ceiling (for reference)
  };

  /**
   * Start the worker
   */
  start(): void {
    if (this.cronJob) {
      logger.warn('⚠️ [REFUND FILING] Worker already started');
      return;
    }

    logger.info('🚀 [REFUND FILING] Starting Refund Filing Worker', {
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
        logger.error('❌ [REFUND FILING] Error in filing job', { error: error.message });
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
        logger.error('❌ [REFUND FILING] Error in status polling job', { error: error.message });
      } finally {
        this.isRunning = false;
      }
    });

    logger.info('✅ [REFUND FILING] Worker started successfully');
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
    logger.info('🛑 [REFUND FILING] Worker stopped');
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
        logger.warn('⚠️ [REFUND FILING] Could not check hourly filings, proceeding with caution', {
          error: error.message
        });
        return 0; // Assume 0 if we can't check (fail open, but log it)
      }

      return count || 0;
    } catch (error: any) {
      logger.warn('⚠️ [REFUND FILING] Error checking hourly filings', { error: error.message });
      return 0;
    }
  }

  /**
   * Run filing for all tenants
   */
  async runFilingForAllTenants(): Promise<FilingStats> {
    const stats: FilingStats = {
      processed: 0,
      filed: 0,
      failed: 0,
      statusUpdated: 0,
      retried: 0,
      errors: []
    };

    try {
      logger.info('📝 [REFUND FILING] Starting filing run for all tenants');

      // THROTTLE CHECK: Hourly rate limit
      const filingsLastHour = await this.getFilingsInLastHour();
      const remainingHourlyQuota = RefundFilingWorker.THROTTLE_CONFIG.MAX_PER_HOUR - filingsLastHour;

      if (remainingHourlyQuota <= 0) {
        logger.info('🛑 [REFUND FILING] Hourly quota reached, skipping this run', {
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

      logger.info('📊 [REFUND FILING] Throttle check passed', {
        filingsLastHour,
        remainingHourlyQuota,
        maxThisRun
      });

      // Get cases ready for filing (filing_status = 'pending' or 'retrying')
      // Only get cases that have evidence documents linked (via dispute_evidence_links)
      // Note: order_id, asin, sku come from detection_results.evidence JSONB, not dispute_cases
      const { data: casesToFile, error } = await supabaseAdmin
        .from('dispute_cases')
        .select(`
          id, 
          seller_id, 
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
        .limit(maxThisRun); // THROTTLE: Only fetch what we're allowed to process

      if (error) {
        // If the error is about no rows, that's fine - just means no cases with evidence
        if (error.message?.includes('0 rows') || error.code === 'PGRST116') {
          logger.debug('ℹ️ [REFUND FILING] No cases with evidence ready for filing');
          return stats;
        }
        logger.error('❌ [REFUND FILING] Failed to get cases to file', { error: error.message });
        stats.errors.push(`Failed to get cases: ${error.message}`);
        return stats;
      }

      if (!casesToFile || casesToFile.length === 0) {
        logger.debug('ℹ️ [REFUND FILING] No cases with evidence ready for filing');
        return stats;
      }

      logger.info(`📋 [REFUND FILING] Found ${casesToFile.length} cases with evidence ready for filing`);

      // Process each case
      for (const disputeCase of casesToFile) {
        try {
          stats.processed++;

          // Evidence documents are already joined - extract from the query result
          const evidenceLinksFromQuery = (disputeCase as any).dispute_evidence_links || [];
          const evidenceIds = evidenceLinksFromQuery.map((link: any) => link.evidence_document_id);

          // Double-check we have evidence (should always be true due to !inner join)
          if (evidenceIds.length === 0) {
            logger.debug('ℹ️ [REFUND FILING] Skipping case without evidence', {
              disputeId: disputeCase.id
            });
            continue;
          }

          // Extract order details from detection_results.evidence JSONB
          const detectionEvidence = (disputeCase as any).detection_results?.evidence || {};
          const orderId = detectionEvidence.order_id || '';
          const asin = detectionEvidence.asin || undefined;
          const sku = detectionEvidence.sku || undefined;

          // Get detection result for confidence score
          const { data: detectionResult } = await supabaseAdmin
            .from('detection_results')
            .select('match_confidence')
            .eq('id', disputeCase.detection_result_id)
            .single();

          const confidenceScore = detectionResult?.match_confidence || 0.85;

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
            logger.info('🔄 [REFUND FILING] Retrying with stronger evidence', {
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

          // File the dispute
          const result = await retryWithBackoff(
            () => refundFilingService.fileDispute(filingRequest),
            3,
            2000
          );

          if (result.success) {
            // Update case status
            await this.updateCaseAfterFiling(disputeCase.id, result);
            stats.filed++;
          } else {
            // Handle failure
            await this.handleFilingFailure(disputeCase.id, disputeCase.seller_id, result, disputeCase.retry_count || 0);
            stats.failed++;
            stats.errors.push(`Case ${disputeCase.id}: ${result.error_message}`);
          }

        } catch (error: any) {
          logger.error('❌ [REFUND FILING] Error processing case', {
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

      logger.info('✅ [REFUND FILING] Filing run completed', stats);
      return stats;

    } catch (error: any) {
      logger.error('❌ [REFUND FILING] Fatal error in filing run', { error: error.message });
      stats.errors.push(`Fatal error: ${error.message}`);
      return stats;
    }
  }

  /**
   * Poll case statuses from Amazon
   */
  async pollCaseStatuses(): Promise<void> {
    try {
      logger.info('🔍 [REFUND FILING] Starting case status polling');

      // Get cases that have been filed but not yet closed
      const { data: filedCases, error } = await supabaseAdmin
        .from('dispute_cases')
        .select('id, seller_id, filing_status')
        .eq('filing_status', 'filed')
        .not('status', 'in', '(approved,rejected,closed)')
        .limit(100);

      if (error) {
        logger.error('❌ [REFUND FILING] Failed to get filed cases', { error: error.message });
        return;
      }

      if (!filedCases || filedCases.length === 0) {
        logger.debug('ℹ️ [REFUND FILING] No filed cases to poll');
        return;
      }

      logger.info(`📋 [REFUND FILING] Polling status for ${filedCases.length} cases`);

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
            logger.debug('⚠️ [REFUND FILING] No submission ID found for case', {
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

            // If denied, mark for retry with stronger evidence
            if (statusResult.status === 'denied' && submission.status !== 'denied') {
              const rejectionReason = statusResult.error || statusResult.resolution || 'Unknown reason';
              logger.warn('⚠️ [REFUND FILING] Case denied, marking for retry', {
                disputeId: disputeCase.id,
                rejectionReason: rejectionReason
              });

              // 🎯 AGENT 11 INTEGRATION: Process rejection for learning
              try {
                const learningWorker = (await import('./learningWorker')).default;
                await learningWorker.processRejection(
                  disputeCase.seller_id,
                  disputeCase.id,
                  rejectionReason,
                  statusResult.amazon_case_id
                );
              } catch (learnError: any) {
                logger.warn('⚠️ [REFUND FILING] Failed to process rejection for learning', {
                  error: learnError.message
                });
              }

              // 🎯 AGENT 11 INTEGRATION: Log filing denial event
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
                logger.warn('⚠️ [REFUND FILING] Failed to log event', {
                  error: logError.message
                });
              }

              await this.markForRetry(disputeCase.id, disputeCase.seller_id);
            }
          }

        } catch (error: any) {
          logger.error('❌ [REFUND FILING] Error polling case status', {
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

      logger.info('✅ [REFUND FILING] Status polling completed');

    } catch (error: any) {
      logger.error('❌ [REFUND FILING] Fatal error in status polling', { error: error.message });
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
        logger.error('❌ [REFUND FILING] Failed to update case after filing', {
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

        logger.info('✅ [REFUND FILING] Case filed successfully', {
          disputeId,
          submissionId: result.submission_id,
          amazonCaseId: result.amazon_case_id
        });

        // 🎯 AGENT 11 INTEGRATION: Log filing event
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
          logger.warn('⚠️ [REFUND FILING] Failed to log event', {
            error: logError.message
          });
        }

        // 🎯 AGENT 10 INTEGRATION: Notify when case is filed
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
          logger.warn('⚠️ [REFUND FILING] Failed to send notification', {
            error: notifError.message
          });
        }
      }

    } catch (error: any) {
      logger.error('❌ [REFUND FILING] Error updating case after filing', {
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

      logger.warn('🔄 [REFUND FILING] Marking case for retry', {
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

      logger.error('❌ [REFUND FILING] Max retries exceeded for case', {
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

      // 🎯 AGENT 8 INTEGRATION: Mark for recovery detection when approved
      if (newStatus === 'approved' && previousStatus !== 'approved') {
        updates.recovery_status = 'pending';
        logger.info('📝 [REFUND FILING] Case approved, marked for recovery detection by Agent 8', {
          disputeId
        });

        // Fetch case data for logging and notifications
        const { data: caseData } = await supabaseAdmin
          .from('dispute_cases')
          .select('seller_id, claim_amount, currency, provider_case_id')
          .eq('id', disputeId)
          .single();

        // 🎯 AGENT 11 INTEGRATION: Log approval event
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
          logger.warn('⚠️ [REFUND FILING] Failed to log event', {
            error: logError.message
          });
        }

        // 🎯 AGENT 10 INTEGRATION: Notify when refund is approved
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
          logger.warn('⚠️ [REFUND FILING] Failed to send notification', {
            error: notifError.message
          });
        }
      }

      const { error } = await supabaseAdmin
        .from('dispute_cases')
        .update(updates)
        .eq('id', disputeId);

      if (error) {
        logger.error('❌ [REFUND FILING] Failed to update case status', {
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

        logger.info('✅ [REFUND FILING] Case status updated', {
          disputeId,
          status: statusResult.status
        });

        // Trigger recovery detection immediately if approved (non-blocking)
        if (newStatus === 'approved' && disputeCase?.seller_id) {
          this.triggerRecoveryDetection(disputeId, disputeCase.seller_id).catch((error: any) => {
            logger.warn('⚠️ [REFUND FILING] Failed to trigger recovery detection (non-critical)', {
              disputeId,
              error: error.message
            });
          });
        }
      }

    } catch (error: any) {
      logger.error('❌ [REFUND FILING] Error updating case status', {
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
      logger.debug('⚠️ [REFUND FILING] Recovery detection triggered (will retry in next run)', {
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

        logger.info('🔄 [REFUND FILING] Marked case for retry with stronger evidence', {
          disputeId,
          retryCount: currentRetryCount + 1
        });
      } else {
        logger.warn('⚠️ [REFUND FILING] Max retries exceeded, not retrying', {
          disputeId,
          retryCount: currentRetryCount
        });
      }

    } catch (error: any) {
      logger.error('❌ [REFUND FILING] Error marking case for retry', {
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

      logger.debug('📝 [REFUND FILING] Error logged', {
        disputeId,
        userId,
        errorMessage
      });

    } catch (error: any) {
      logger.error('❌ [REFUND FILING] Failed to log error', {
        disputeId,
        error: error.message
      });
    }
  }
}

// Export singleton instance
const refundFilingWorker = new RefundFilingWorker();
export default refundFilingWorker;

