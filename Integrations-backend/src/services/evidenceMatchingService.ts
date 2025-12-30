/**
 * Evidence Matching Service
 * Wraps Python API evidence matching endpoints with retry logic and error handling
 */

import axios, { AxiosError } from 'axios';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import smartPromptService from './smartPromptService';
import { buildPythonServiceAuthHeader } from '../utils/pythonServiceAuth';

export interface MatchingResult {
  dispute_id: string;
  evidence_document_id: string;
  rule_score: number;
  ml_score?: number;
  final_confidence: number;
  match_type: string;
  matched_fields: string[];
  reasoning: string;
  action_taken: 'auto_submit' | 'smart_prompt' | 'no_action';
}

export interface MatchingJobResponse {
  matches: number;
  auto_submits: number;
  smart_prompts: number;
  results?: MatchingResult[];
}

export interface ClaimData {
  claim_id: string;
  claim_type: string;
  amount: number;
  confidence: number;
  currency: string;
  evidence?: any;
  discovery_date?: string;
  deadline_date?: string;
  sku?: string;
  asin?: string;
  order_id?: string;
}

class EvidenceMatchingService {
  private pythonApiUrl: string;
  private maxRetries: number = 3;
  private baseDelay: number = 2000; // 2 seconds
  private autoSubmitThreshold: number = 0.85;
  private smartPromptThreshold: number = 0.5;
  private readonly BATCH_SIZE = 1000; // Process 1000 claims per batch for large datasets
  private syncLogCallback?: (log: {
    type: 'info' | 'success' | 'warning' | 'error' | 'progress';
    category: 'matching';
    message: string;
    count?: number;
  }) => void;

  constructor() {
    // Get Python API URL from environment
    const pythonApiUrl = process.env.PYTHON_API_URL || 'https://clario-complete-backend-7tgl.onrender.com';
    this.pythonApiUrl = pythonApiUrl;

    // Get thresholds from environment (optional)
    if (process.env.EVIDENCE_CONFIDENCE_AUTO) {
      this.autoSubmitThreshold = parseFloat(process.env.EVIDENCE_CONFIDENCE_AUTO);
    }
    if (process.env.EVIDENCE_CONFIDENCE_PROMPT) {
      this.smartPromptThreshold = parseFloat(process.env.EVIDENCE_CONFIDENCE_PROMPT);
    }

    logger.info('🔗 [EVIDENCE MATCHING] Service initialized', {
      pythonApiUrl: this.pythonApiUrl,
      autoSubmitThreshold: this.autoSubmitThreshold,
      smartPromptThreshold: this.smartPromptThreshold
    });
  }

  /**
   * Set sync log callback for real-time progress updates
   */
  setSyncLogCallback(callback: (log: {
    type: 'info' | 'success' | 'warning' | 'error' | 'progress';
    category: 'matching';
    message: string;
    count?: number;
  }) => void): void {
    this.syncLogCallback = callback;
  }

  /**
   * Send sync log message if callback is set
   */
  private sendSyncLog(type: 'info' | 'success' | 'warning' | 'error' | 'progress', message: string, count?: number): void {
    if (this.syncLogCallback) {
      this.syncLogCallback({ type, category: 'matching', message, count });
    }
  }

  private buildServiceHeaders(
    userId: string,
    context: string,
    extraHeaders: Record<string, string> = {}
  ): Record<string, string> {
    const headers: Record<string, string> = { ...extraHeaders };
    headers.Authorization = buildPythonServiceAuthHeader({
      userId,
      metadata: {
        source: `integrations:${context}`
      }
    });
    return headers;
  }

  /**
   * Run evidence matching for a user
   * Matches claims against parsed documents by ASIN/SKU
   */
  async runMatchingForUser(userId: string, claims?: ClaimData[]): Promise<MatchingJobResponse> {
    logger.info('🔄 [EVIDENCE MATCHING] Running matching for user', {
      userId,
      claimsCount: claims?.length || 0
    });

    // Use local ASIN/SKU matching
    return this.matchClaimsToDocuments(userId, claims || []);
  }

  /**
   * Match claims against parsed documents by Order ID, ASIN, or SKU
   * Primary matching method - no external API dependency
   * Uses 'extracted' column (not parsed_metadata) for document data
   */
  private async matchClaimsToDocuments(userId: string, claims: ClaimData[]): Promise<MatchingJobResponse> {
    logger.info('🔍 [EVIDENCE MATCHING] Matching claims to documents', { userId, claimsCount: claims.length });

    try {
      // Get documents with extracted data for user
      // Documents are stored with 'user_id' column (not 'seller_id') by Document Library
      // Support multiple parser_status values: completed, extracted, etc.
      const { data: documents, error: docError } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, filename, extracted, parsed_metadata, raw_text, storage_path, parser_status')
        .eq('user_id', userId);

      if (docError) {
        logger.error('❌ [EVIDENCE MATCHING] Failed to fetch documents', { error: docError.message });
        return { matches: 0, auto_submits: 0, smart_prompts: 0, results: [] };
      }

      if (!documents || documents.length === 0) {
        logger.warn('⚠️ [EVIDENCE MATCHING] No documents found for user', { userId });
        return { matches: 0, auto_submits: 0, smart_prompts: 0, results: [] };
      }

      logger.info('📄 [EVIDENCE MATCHING] Found documents', { userId, docCount: documents.length });

      // Build document index by Order ID, ASIN, and SKU
      const docOrderIds: Map<string, any[]> = new Map();
      const docAsins: Map<string, any[]> = new Map();
      const docSkus: Map<string, any[]> = new Map();

      for (const doc of documents) {
        // Get extracted data from either 'extracted' or 'parsed_metadata' column
        let extracted = doc.extracted || doc.parsed_metadata;
        if (typeof extracted === 'string') {
          try {
            extracted = JSON.parse(extracted);
          } catch {
            extracted = {};
          }
        }
        extracted = extracted || {};

        // Also try to extract order IDs from raw_text
        const rawText = doc.raw_text || '';
        const orderIdRegex = /\b\d{3}-\d{7}-\d{7}\b/g;
        const rawOrderIds = rawText.match(orderIdRegex) || [];

        // Combine extracted order_ids with any found in raw_text
        const orderIds = [...new Set([
          ...(extracted.order_ids || []),
          ...rawOrderIds
        ])];

        // Handle both plural (asins) and singular (asin) forms - normalize to uppercase
        const asinArray: string[] = [];
        if (extracted.asins && Array.isArray(extracted.asins)) {
          asinArray.push(...extracted.asins.map((a: string) => String(a).toUpperCase().trim()));
        }
        if (extracted.asin) {
          const singleAsin = String(extracted.asin).toUpperCase().trim();
          if (singleAsin && !asinArray.includes(singleAsin)) {
            asinArray.push(singleAsin);
          }
        }

        // Handle both plural (skus) and singular (sku) forms
        const skuArray: string[] = [];
        if (extracted.skus && Array.isArray(extracted.skus)) {
          skuArray.push(...extracted.skus.map((s: string) => String(s).toUpperCase().trim()));
        }
        if (extracted.sku) {
          const singleSku = String(extracted.sku).toUpperCase().trim();
          if (singleSku && !skuArray.includes(singleSku)) {
            skuArray.push(singleSku);
          }
        }

        // Index by order ID
        for (const orderId of orderIds) {
          const normalizedOrderId = orderId.trim();
          if (!docOrderIds.has(normalizedOrderId)) docOrderIds.set(normalizedOrderId, []);
          docOrderIds.get(normalizedOrderId)!.push(doc);
        }

        // Index by ASIN (normalized to uppercase)
        for (const asin of asinArray) {
          if (!docAsins.has(asin)) docAsins.set(asin, []);
          docAsins.get(asin)!.push(doc);
        }

        // Index by SKU (normalized to uppercase)
        for (const sku of skuArray) {
          if (!docSkus.has(sku)) docSkus.set(sku, []);
          docSkus.get(sku)!.push(doc);
        }
      }

      logger.info('📋 [EVIDENCE MATCHING] Built document index', {
        docCount: documents.length,
        uniqueOrderIds: docOrderIds.size,
        uniqueAsins: docAsins.size,
        uniqueSkus: docSkus.size
      });

      // Also fetch claims with related_event_ids from database if not provided
      let claimsToMatch = claims;
      if (claims.length === 0) {
        const { data: dbClaims } = await supabaseAdmin
          .from('detection_results')
          .select('id, anomaly_type, estimated_value, currency, evidence, confidence_score, related_event_ids')
          .eq('seller_id', userId);

        if (dbClaims) {
          claimsToMatch = dbClaims.map((d: any) => ({
            claim_id: d.id,
            claim_type: d.anomaly_type || 'unknown',
            amount: d.estimated_value || 0,
            confidence: d.confidence_score || 0.5,
            currency: d.currency || 'USD',
            evidence: d.evidence || {},
            related_event_ids: d.related_event_ids || []
          }));
        }
      }

      // Match claims against documents
      const results: MatchingResult[] = [];
      let matchCount = 0;
      let autoSubmitCount = 0;
      let smartPromptCount = 0;

      for (const claim of claimsToMatch) {
        const claimEvidence = typeof claim.evidence === 'string' ? JSON.parse(claim.evidence) : (claim.evidence || {});
        // Normalize ASIN and SKU to uppercase to match indexed documents
        const rawAsin = claim.asin || claimEvidence.asin;
        const rawSku = claim.sku || claimEvidence.sku;
        const claimAsin = rawAsin ? String(rawAsin).toUpperCase().trim() : null;
        const claimSku = rawSku ? String(rawSku).toUpperCase().trim() : null;
        const claimOrderId = claim.order_id || claimEvidence.order_id;

        // Get order IDs from related_event_ids (array of order IDs)
        const relatedEventIds: string[] = (claim as any).related_event_ids || [];

        let matchedDocs: any[] = [];
        let matchType = '';
        let matchedId = '';

        // Try Order ID match first (highest priority)
        if (claimOrderId && docOrderIds.has(claimOrderId)) {
          matchedDocs = docOrderIds.get(claimOrderId)!;
          matchType = 'order_id';
          matchedId = claimOrderId;
        }
        // Then try related_event_ids (order IDs from claims)
        else if (relatedEventIds.length > 0) {
          for (const eventId of relatedEventIds) {
            if (docOrderIds.has(eventId)) {
              matchedDocs = docOrderIds.get(eventId)!;
              matchType = 'order_id';
              matchedId = eventId;
              break;
            }
          }
        }
        // Then try ASIN match
        else if (claimAsin && docAsins.has(claimAsin)) {
          matchedDocs = docAsins.get(claimAsin)!;
          matchType = 'asin';
          matchedId = claimAsin;
        }
        // Finally try SKU match
        else if (claimSku && docSkus.has(claimSku)) {
          matchedDocs = docSkus.get(claimSku)!;
          matchType = 'sku';
          matchedId = claimSku;
        }

        if (matchedDocs.length > 0) {
          matchCount++;
          const bestDoc = matchedDocs[0];
          const confidence = matchType === 'order_id' ? 0.95 : 0.85; // Higher confidence for order ID match

          // Determine action based on confidence
          if (confidence >= this.autoSubmitThreshold) {
            autoSubmitCount++;
          } else if (confidence >= this.smartPromptThreshold) {
            smartPromptCount++;
          }

          results.push({
            dispute_id: claim.claim_id,
            evidence_document_id: bestDoc.id,
            rule_score: confidence,
            final_confidence: confidence,
            match_type: matchType,
            matched_fields: [`${matchType}:${matchedId}`],
            reasoning: `Exact ${matchType.toUpperCase().replace('_', ' ')} match found in document ${bestDoc.filename}`,
            action_taken: confidence >= this.autoSubmitThreshold ? 'auto_submit' : 'smart_prompt'
          });

          logger.info('✅ [EVIDENCE MATCHING] Found match', {
            claimId: claim.claim_id,
            matchType,
            matchedId,
            documentId: bestDoc.id,
            filename: bestDoc.filename,
            confidence
          });
        }
      }

      logger.info('📊 [EVIDENCE MATCHING] Local matching complete', {
        claims: claimsToMatch.length,
        matches: matchCount,
        autoSubmits: autoSubmitCount,
        smartPrompts: smartPromptCount
      });

      return {
        matches: matchCount,
        auto_submits: autoSubmitCount,
        smart_prompts: smartPromptCount,
        results
      };

    } catch (error: any) {
      logger.error('❌ [EVIDENCE MATCHING] Local matching failed', { error: error.message, stack: error.stack });
      return { matches: 0, auto_submits: 0, smart_prompts: 0, results: [] };
    }
  }

  /**
   * Run matching with retry logic and batch processing for large datasets
   * Handles 429 (rate limit) errors with longer backoff
   */
  async runMatchingWithRetry(
    userId: string,
    claims?: ClaimData[],
    maxRetries: number = 3
  ): Promise<MatchingJobResponse> {
    // If no claims provided, fetch them from the database
    if (!claims || claims.length === 0) {
      logger.info('🔄 [EVIDENCE MATCHING] No claims provided, fetching from database', { userId });

      try {
        // Fetch claims from detection_results that have linked dispute_cases
        const { data: detections, error } = await supabaseAdmin
          .from('detection_results')
          .select(`
            id,
            seller_id,
            anomaly_type,
            estimated_value,
            currency,
            evidence,
            confidence_score,
            claim_number,
            dispute_cases!inner(id, status)
          `)
          .eq('seller_id', userId)
          .in('dispute_cases.status', ['pending', 'submitted']);

        if (error) {
          logger.warn('⚠️ [EVIDENCE MATCHING] Error fetching claims, trying simpler query', { error: error.message });

          // Fallback: simpler query without join
          const { data: simpleDetections } = await supabaseAdmin
            .from('detection_results')
            .select('id, seller_id, anomaly_type, estimated_value, currency, evidence, confidence_score, claim_number')
            .eq('seller_id', userId)
            .not('evidence', 'is', null);

          if (simpleDetections && simpleDetections.length > 0) {
            claims = simpleDetections.map((d: any) => {
              const ev = typeof d.evidence === 'string' ? JSON.parse(d.evidence) : (d.evidence || {});
              return {
                claim_id: d.id,
                claim_type: d.anomaly_type || 'unknown',
                amount: d.estimated_value || 0,
                confidence: d.confidence_score || 0.5,
                currency: d.currency || 'USD',
                evidence: ev,
                asin: ev.asin,
                sku: ev.sku,
                order_id: ev.order_id
              };
            });
          }
        } else if (detections && detections.length > 0) {
          claims = detections.map((d: any) => {
            const ev = typeof d.evidence === 'string' ? JSON.parse(d.evidence) : (d.evidence || {});
            return {
              claim_id: d.id,
              claim_type: d.anomaly_type || 'unknown',
              amount: d.estimated_value || 0,
              confidence: d.confidence_score || 0.5,
              currency: d.currency || 'USD',
              evidence: ev,
              asin: ev.asin,
              sku: ev.sku,
              order_id: ev.order_id
            };
          });
        }

        logger.info('📋 [EVIDENCE MATCHING] Fetched claims from database', {
          userId,
          claimsCount: claims?.length || 0
        });

      } catch (fetchError: any) {
        logger.error('❌ [EVIDENCE MATCHING] Failed to fetch claims', { error: fetchError.message });
      }
    }

    // If still no claims, return empty result
    if (!claims || claims.length === 0) {
      this.sendSyncLog('warning', 'No claims found for matching');
      return { matches: 0, auto_submits: 0, smart_prompts: 0, results: [] };
    }

    // Batch processing for large datasets
    const needsBatching = claims.length > this.BATCH_SIZE;
    const totalBatches = needsBatching ? Math.ceil(claims.length / this.BATCH_SIZE) : 1;

    this.sendSyncLog('info', `Assessing ${claims.length.toLocaleString()} claims for evidence matching...`);

    if (needsBatching) {
      this.sendSyncLog('info', `Processing ${claims.length.toLocaleString()} claims in ${totalBatches} batches...`);
    } else {
      this.sendSyncLog('info', `Processing ${claims.length.toLocaleString()} claims...`);
    }

    const allResults: MatchingResult[] = [];
    let totalMatches = 0;
    let totalAutoSubmits = 0;
    let totalSmartPrompts = 0;

    // Process claims in batches
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * this.BATCH_SIZE;
      const batchEnd = Math.min(batchStart + this.BATCH_SIZE, claims.length);
      const batchClaims = claims.slice(batchStart, batchEnd);

      if (needsBatching) {
        this.sendSyncLog('progress', `Processing batch ${batchIndex + 1}/${totalBatches} (${batchStart + 1}-${batchEnd} of ${claims.length.toLocaleString()})...`);
      }

      let lastError: any;
      let batchResult: MatchingJobResponse | null = null;

      // Retry logic for this batch
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          batchResult = await this.runMatchingForUser(userId, batchClaims);
          break; // Success - break out of retry loop
        } catch (error: any) {
          lastError = error;
          const statusCode = error.response?.status;

          // Check if it's a rate limit error (429)
          if (statusCode === 429) {
            const retryAfter = error.response?.headers?.['retry-after'];
            const delay = retryAfter ? parseInt(retryAfter) * 1000 : 30000;

            logger.warn(`⏳ [EVIDENCE MATCHING] Rate limited (429), waiting ${delay}ms before retry`, {
              userId,
              attempt: attempt + 1,
              maxRetries,
              retryAfter,
              batchIndex: batchIndex + 1
            });

            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }

          // For other errors, use standard exponential backoff
          if (attempt < maxRetries) {
            const delay = this.baseDelay * Math.pow(2, attempt);
            logger.warn(`🔄 [EVIDENCE MATCHING] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
              userId,
              error: error.message,
              statusCode,
              delay,
              batchIndex: batchIndex + 1
            });
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!batchResult) {
        this.sendSyncLog('error', `Batch ${batchIndex + 1} failed after all retries: ${lastError?.message}`);
        logger.error('❌ [EVIDENCE MATCHING] Batch failed after all retries', {
          userId,
          batchIndex: batchIndex + 1,
          error: lastError?.message
        });
        // Continue with next batch instead of failing completely
        continue;
      }

      // Accumulate results
      if (batchResult.results) {
        allResults.push(...batchResult.results);
      }
      totalMatches += batchResult.matches || 0;
      totalAutoSubmits += batchResult.auto_submits || 0;
      totalSmartPrompts += batchResult.smart_prompts || 0;

      if (needsBatching && batchIndex < totalBatches - 1) {
        this.sendSyncLog('info', `Batch ${batchIndex + 1}/${totalBatches} complete: ${batchResult.matches || 0} matches found`);
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    this.sendSyncLog('success', `[COMPLETE] Matched evidence for ${totalMatches.toLocaleString()} claims (${totalAutoSubmits} auto-submitted, ${totalSmartPrompts} smart prompts)`);

    return {
      matches: totalMatches,
      auto_submits: totalAutoSubmits,
      smart_prompts: totalSmartPrompts,
      results: allResults
    };
  }

  /**
   * Process matching results and route based on confidence thresholds
   */
  async processMatchingResults(
    userId: string,
    results: MatchingResult[]
  ): Promise<{
    autoSubmitted: number;
    smartPromptsCreated: number;
    held: number;
  }> {
    const stats = {
      autoSubmitted: 0,
      smartPromptsCreated: 0,
      held: 0
    };

    for (const result of results) {
      try {
        if (result.final_confidence >= this.autoSubmitThreshold) {
          // Auto-submit (>= 0.85)
          await this.handleAutoSubmit(userId, result);
          stats.autoSubmitted++;
        } else if (result.final_confidence >= this.smartPromptThreshold) {
          // Smart prompt (0.5 - 0.85)
          await this.handleSmartPrompt(userId, result);
          stats.smartPromptsCreated++;
        } else {
          // Hold (< 0.5)
          await this.handleHold(userId, result);
          stats.held++;
        }
      } catch (error: any) {
        logger.error('❌ [EVIDENCE MATCHING] Failed to process result', {
          userId,
          resultId: result.dispute_id,
          error: error.message
        });
      }
    }

    return stats;
  }

  /**
   * Handle auto-submit (confidence >= 0.85)
   * Marks case for filing by Agent 7 (Refund Filing Worker)
   */
  private async handleAutoSubmit(userId: string, result: MatchingResult): Promise<void> {
    try {
      logger.info('✅ [EVIDENCE MATCHING] Auto-submitting high-confidence match', {
        userId,
        disputeId: result.dispute_id,
        evidenceId: result.evidence_document_id,
        confidence: result.final_confidence
      });

      // Store evidence link
      await this.storeEvidenceLink(result, 'auto_match');

      // Update detection result status
      await this.updateDetectionResultStatus(result.dispute_id, 'disputed', result.final_confidence);

      // 🎯 AGENT 7 INTEGRATION: Mark case for filing
      // Agent 7 (Refund Filing Worker) will pick up cases with filing_status = 'pending'
      const { supabaseAdmin } = await import('../database/supabaseClient');
      const { error: updateError } = await supabaseAdmin
        .from('dispute_cases')
        .update({
          filing_status: 'pending',
          status: 'evidence_linked',
          updated_at: new Date().toISOString()
        })
        .eq('id', result.dispute_id);

      if (updateError) {
        logger.error('❌ [EVIDENCE MATCHING] Failed to mark case for filing', {
          disputeId: result.dispute_id,
          error: updateError.message
        });
      } else {
        logger.info('📝 [EVIDENCE MATCHING] Case marked for filing by Agent 7', {
          disputeId: result.dispute_id
        });

        // 🎯 AGENT 10 INTEGRATION: Notify when evidence is matched
        try {
          const notificationHelper = (await import('../services/notificationHelper')).default;
          const { data: disputeCase } = await supabaseAdmin
            .from('dispute_cases')
            .select('claim_amount, currency')
            .eq('id', result.dispute_id)
            .single();

          if (disputeCase) {
            await notificationHelper.notifyEvidenceFound(userId, {
              documentId: result.evidence_document_id,
              source: 'unknown' as 'gmail' | 'outlook' | 'drive' | 'dropbox',
              fileName: 'Evidence Document',
              parsed: true,
              matchFound: true,
              disputeId: result.dispute_id
            });
          }
        } catch (notifError: any) {
          logger.warn('⚠️ [EVIDENCE MATCHING] Failed to send notification', {
            error: notifError.message
          });
        }
      }

      // Call auto-submit endpoint (if exists) - non-critical
      try {
        const endpoint = `${this.pythonApiUrl}/api/internal/evidence/auto-submit`;
        await axios.post(
          endpoint,
          {
            dispute_id: result.dispute_id,
            evidence_document_id: result.evidence_document_id,
            confidence: result.final_confidence,
            reasoning: result.reasoning
          },
          {
            headers: this.buildServiceHeaders(userId, 'evidence-matching:auto-submit', {
              'Content-Type': 'application/json'
            }),
            timeout: 30000
          }
        );
      } catch (error: any) {
        // Non-critical - auto-submit endpoint might not exist
        logger.debug('⚠️ [EVIDENCE MATCHING] Auto-submit endpoint not available', {
          error: error.message
        });
      }

    } catch (error: any) {
      logger.error('❌ [EVIDENCE MATCHING] Failed to handle auto-submit', {
        userId,
        resultId: result.dispute_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Handle smart prompt (confidence 0.5 - 0.85)
   */
  private async handleSmartPrompt(userId: string, result: MatchingResult): Promise<void> {
    try {
      logger.info('❓ [EVIDENCE MATCHING] Creating smart prompt for ambiguous match', {
        userId,
        disputeId: result.dispute_id,
        evidenceId: result.evidence_document_id,
        confidence: result.final_confidence
      });

      // Store evidence link
      await this.storeEvidenceLink(result, 'ml_suggested');

      // Generate smart prompt question
      const question = this.generateSmartPromptQuestion(result);
      const options = [
        {
          id: 'yes',
          label: 'Yes, this matches my claim',
          evidence_document_id: result.evidence_document_id
        },
        {
          id: 'no',
          label: 'No, this does not match',
          evidence_document_id: result.evidence_document_id
        },
        {
          id: 'review',
          label: 'I need to review this',
          evidence_document_id: result.evidence_document_id
        }
      ];

      // Create smart prompt
      await smartPromptService.createEvidenceSelectionPrompt(
        userId,
        result.dispute_id,
        question,
        options
      );

      // Update detection result status
      await this.updateDetectionResultStatus(result.dispute_id, 'reviewed', result.final_confidence);

    } catch (error: any) {
      logger.error('❌ [EVIDENCE MATCHING] Failed to handle smart prompt', {
        userId,
        resultId: result.dispute_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Handle hold (confidence < 0.5)
   */
  private async handleHold(userId: string, result: MatchingResult): Promise<void> {
    try {
      logger.info('⏸️ [EVIDENCE MATCHING] Holding low-confidence match', {
        userId,
        disputeId: result.dispute_id,
        evidenceId: result.evidence_document_id,
        confidence: result.final_confidence
      });

      // Store evidence link with low confidence
      await this.storeEvidenceLink(result, 'manual_review');

      // Update detection result status
      await this.updateDetectionResultStatus(result.dispute_id, 'pending', result.final_confidence);

    } catch (error: any) {
      logger.error('❌ [EVIDENCE MATCHING] Failed to handle hold', {
        userId,
        resultId: result.dispute_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Store evidence link in database
   */
  private async storeEvidenceLink(
    result: MatchingResult,
    linkType: 'auto_match' | 'ml_suggested' | 'manual_review'
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;

      // Check if dispute_evidence_links table exists
      const { error: insertError } = await client
        .from('dispute_evidence_links')
        .insert({
          dispute_case_id: result.dispute_id,
          evidence_document_id: result.evidence_document_id,
          relevance_score: result.final_confidence,
          matched_context: {
            match_type: result.match_type,
            matched_fields: result.matched_fields,
            reasoning: result.reasoning,
            rule_score: result.rule_score,
            ml_score: result.ml_score
          }
        });

      if (insertError) {
        // Table might not exist - that's OK
        logger.debug('⚠️ [EVIDENCE MATCHING] dispute_evidence_links table may not exist', {
          error: insertError.message
        });
      } else {
        logger.info('✅ [EVIDENCE MATCHING] Stored evidence link', {
          disputeId: result.dispute_id,
          evidenceId: result.evidence_document_id,
          linkType
        });
      }
    } catch (error: any) {
      logger.warn('⚠️ [EVIDENCE MATCHING] Failed to store evidence link', {
        error: error.message
      });
    }
  }

  /**
   * Update detection result status
   */
  private async updateDetectionResultStatus(
    detectionId: string,
    status: 'pending' | 'reviewed' | 'disputed' | 'resolved',
    confidence?: number
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      // Add match_confidence if provided
      if (confidence !== undefined) {
        // Check if match_confidence column exists
        updateData.match_confidence = confidence;
      }

      const { error } = await client
        .from('detection_results')
        .update(updateData)
        .eq('id', detectionId);

      if (error) {
        logger.debug('⚠️ [EVIDENCE MATCHING] Failed to update detection result', {
          detectionId,
          error: error.message
        });
      }
    } catch (error: any) {
      logger.warn('⚠️ [EVIDENCE MATCHING] Error updating detection result', {
        detectionId,
        error: error.message
      });
    }
  }

  /**
   * Generate smart prompt question based on match type
   */
  private generateSmartPromptQuestion(result: MatchingResult): string {
    const matchType = result.match_type;
    const confidence = (result.final_confidence * 100).toFixed(0);

    switch (matchType) {
      case 'sku_match':
        return `We found an invoice with SKU that matches your claim (${confidence}% confidence). Is this the correct evidence?`;
      case 'asin_match':
        return `We found an invoice with ASIN that matches your claim (${confidence}% confidence). Is this the correct evidence?`;
      case 'supplier_match':
        return `We found an invoice from a supplier that matches your claim (${confidence}% confidence). Is this related to your dispute?`;
      case 'date_match':
        return `We found an invoice with a date that matches your claim (${confidence}% confidence). Is this the correct evidence?`;
      case 'amount_match':
        return `We found an invoice with an amount that matches your claim (${confidence}% confidence). Is this the correct evidence?`;
      default:
        return `We found a potential match for your claim (${confidence}% confidence). ${result.reasoning}. Is this evidence related to your case?`;
    }
  }

  /**
   * Get matching metrics for a user
   */
  async getMatchingMetrics(userId: string, days: number = 30): Promise<any> {
    try {
      const endpoint = `${this.pythonApiUrl}/api/internal/evidence/matching/metrics`;
      const response = await axios.get(
        endpoint,
        {
          params: { user_id: userId, days },
          headers: this.buildServiceHeaders(userId, 'evidence-matching:metrics'),
          timeout: 10000
        }
      );

      return response.data;
    } catch (error: any) {
      logger.warn('⚠️ [EVIDENCE MATCHING] Failed to get metrics', {
        userId,
        error: error.message
      });
      return null;
    }
  }
}

export const evidenceMatchingService = new EvidenceMatchingService();
export default evidenceMatchingService;

