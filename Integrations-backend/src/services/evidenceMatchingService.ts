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

  constructor() {
    // Get Python API URL from environment
    this.pythonApiUrl = 
      process.env.PYTHON_API_URL || 
      process.env.API_URL || 
      'https://python-api-7.onrender.com';
    
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
   * Run evidence matching for a user via Python API
   */
  async runMatchingForUser(userId: string, claims?: ClaimData[]): Promise<MatchingJobResponse> {
    try {
      logger.info('🔄 [EVIDENCE MATCHING] Running matching for user', {
        userId,
        claimsCount: claims?.length || 0
      });

      const endpoint = `${this.pythonApiUrl}/api/internal/evidence/matching/run`;

      const response = await axios.post<MatchingJobResponse>(
        endpoint,
        {
          user_id: userId,
          claims: claims || []
        },
        {
          headers: this.buildServiceHeaders(userId, 'evidence-matching:run', {
            'Content-Type': 'application/json'
          }),
          timeout: 60000 // 60 seconds (matching can take time)
        }
      );

      if (response.status === 200 || response.status === 201) {
        logger.info('✅ [EVIDENCE MATCHING] Matching completed', {
          userId,
          matches: response.data.matches,
          autoSubmits: response.data.auto_submits,
          smartPrompts: response.data.smart_prompts
        });
        return response.data;
      }

      throw new Error(`Unexpected status code: ${response.status}`);

    } catch (error: any) {
      logger.error('❌ [EVIDENCE MATCHING] Failed to run matching', {
        userId,
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText
      });
      throw error;
    }
  }

  /**
   * Run matching with retry logic
   */
  async runMatchingWithRetry(
    userId: string,
    claims?: ClaimData[],
    maxRetries: number = 3
  ): Promise<MatchingJobResponse> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.runMatchingForUser(userId, claims);
      } catch (error: any) {
        lastError = error;

        if (attempt < maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt);
          logger.warn(`🔄 [EVIDENCE MATCHING] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
            userId,
            error: error.message,
            delay
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logger.error('❌ [EVIDENCE MATCHING] All retry attempts exhausted', {
      userId,
      error: lastError?.message
    });
    throw lastError;
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

