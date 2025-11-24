/**
 * Evidence Matching Worker
 * Automated background worker for continuous evidence matching
 * Runs every 3 minutes, matches claims (detection_results) to parsed documents
 * Routes based on confidence thresholds: >=0.85 auto-submit, 0.5-0.85 smart prompt, <0.5 hold
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import evidenceMatchingService, { ClaimData, MatchingResult } from '../services/evidenceMatchingService';

// Retry logic with exponential backoff
// Handles 429 (rate limit) errors with longer delays
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
      const statusCode = error.response?.status;
      
      // Handle rate limit (429) with longer delay
      if (statusCode === 429) {
        const retryAfter = error.response?.headers?.['retry-after'];
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : 30000; // Default 30s for rate limits
        
        logger.warn(`⏳ [EVIDENCE MATCHING WORKER] Rate limited (429), waiting ${delay}ms`, {
          error: error.message,
          attempt: attempt + 1,
          maxRetries,
          delay
        });
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      // Standard exponential backoff for other errors
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(`🔄 [EVIDENCE MATCHING WORKER] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
          error: error.message,
          statusCode,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

export interface MatchingStats {
  processed: number;
  matched: number;
  autoSubmitted: number;
  smartPromptsCreated: number;
  held: number;
  failed: number;
  errors: string[];
}

export class EvidenceMatchingWorker {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private isRunning: boolean = false;
  private schedule: string = '*/3 * * * *'; // Every 3 minutes

  constructor() {
    // Initialize
  }

  /**
   * Start the evidence matching worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Evidence matching worker is already running');
      return;
    }

    logger.info('🚀 [EVIDENCE MATCHING WORKER] Starting evidence matching worker', {
      schedule: this.schedule
    });

    this.isRunning = true;

    // Schedule main matching job
    const task = cron.schedule(this.schedule, async () => {
      await this.runEvidenceMatchingForAllTenants();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.set('evidence-matching', task);

    logger.info('✅ [EVIDENCE MATCHING WORKER] Evidence matching worker started successfully', {
      schedule: this.schedule
    });
  }

  /**
   * Stop the evidence matching worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Evidence matching worker is not running');
      return;
    }

    logger.info('🛑 [EVIDENCE MATCHING WORKER] Stopping evidence matching worker');

    for (const [name, task] of this.jobs.entries()) {
      task.stop();
      logger.info(`Stopped evidence matching job: ${name}`);
    }

    this.jobs.clear();
    this.isRunning = false;

    logger.info('✅ [EVIDENCE MATCHING WORKER] Evidence matching worker stopped');
  }

  /**
   * Run evidence matching for all tenants
   */
  private async runEvidenceMatchingForAllTenants(): Promise<void> {
    const runStartTime = Date.now();
    
    try {
      logger.info('🔍 [EVIDENCE MATCHING WORKER] Starting scheduled evidence matching', {
        timestamp: new Date().toISOString()
      });

      // Get active users with pending claims or newly parsed documents
      const activeUsers = await this.getActiveUsersNeedingMatching();

      if (activeUsers.length === 0) {
        logger.info('ℹ️ [EVIDENCE MATCHING WORKER] No users need matching');
        return;
      }

      logger.info(`📊 [EVIDENCE MATCHING WORKER] Processing ${activeUsers.length} users`, {
        userCount: activeUsers.length
      });

      // Process each user (with rate limiting)
      const stats: MatchingStats = {
        processed: 0,
        matched: 0,
        autoSubmitted: 0,
        smartPromptsCreated: 0,
        held: 0,
        failed: 0,
        errors: []
      };

      for (let i = 0; i < activeUsers.length; i++) {
        const userId = activeUsers[i];
        
        // Stagger processing to avoid rate limits (5 seconds between users)
        // This helps prevent 429 errors from the Python API
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds between users
        }

        try {
          const result = await this.matchEvidenceForUser(userId);
          stats.processed++;
          
          if (result.success) {
            stats.matched += result.matches || 0;
            stats.autoSubmitted += result.autoSubmitted || 0;
            stats.smartPromptsCreated += result.smartPromptsCreated || 0;
            stats.held += result.held || 0;
          } else {
            stats.failed++;
            if (result.error) {
              stats.errors.push(`User ${userId}: ${result.error}`);
            }
          }
        } catch (error: any) {
          stats.failed++;
          stats.errors.push(`User ${userId}: ${error.message}`);
          logger.error(`❌ [EVIDENCE MATCHING WORKER] Failed to match evidence for user ${userId}`, {
            error: error.message,
            userId
          });
        }
      }

      const runDuration = Date.now() - runStartTime;

      logger.info('✅ [EVIDENCE MATCHING WORKER] Scheduled evidence matching completed', {
        userCount: activeUsers.length,
        processed: stats.processed,
        matched: stats.matched,
        autoSubmitted: stats.autoSubmitted,
        smartPromptsCreated: stats.smartPromptsCreated,
        held: stats.held,
        failed: stats.failed,
        errors: stats.errors.length,
        duration: `${runDuration}ms`
      });

    } catch (error: any) {
      logger.error('❌ [EVIDENCE MATCHING WORKER] Error in scheduled evidence matching', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Get active users that need evidence matching
   * Users with:
   * - Pending detection_results (claims) without evidence linked
   * - Newly parsed evidence_documents (parser_status = 'completed')
   */
  private async getActiveUsersNeedingMatching(): Promise<string[]> {
    try {
      const client = supabaseAdmin || supabase;
      const userIds = new Set<string>();

      // Get users with pending claims (detection_results)
      const { data: pendingClaims, error: claimsError } = await client
        .from('detection_results')
        .select('seller_id')
        .eq('status', 'pending')
        .limit(100);

      if (!claimsError && pendingClaims) {
        pendingClaims.forEach((claim: any) => {
          if (claim.seller_id) {
            userIds.add(claim.seller_id);
          }
        });
      }

      // Get users with newly parsed documents
      const { data: parsedDocs, error: docsError } = await client
        .from('evidence_documents')
        .select('seller_id')
        .eq('parser_status', 'completed')
        .not('parsed_metadata', 'is', null)
        .limit(100);

      if (!docsError && parsedDocs) {
        parsedDocs.forEach((doc: any) => {
          if (doc.seller_id) {
            userIds.add(doc.seller_id);
          }
        });
      }

      return Array.from(userIds);
    } catch (error: any) {
      logger.error('❌ [EVIDENCE MATCHING WORKER] Error getting active users', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Match evidence for a single user
   */
  private async matchEvidenceForUser(userId: string): Promise<{
    success: boolean;
    matches?: number;
    autoSubmitted?: number;
    smartPromptsCreated?: number;
    held?: number;
    error?: string;
  }> {
    try {
      logger.info(`🔗 [EVIDENCE MATCHING WORKER] Matching evidence for user: ${userId}`);

      // Get pending claims for this user
      const claims = await this.getPendingClaimsForUser(userId);

      if (claims.length === 0) {
        logger.debug(`ℹ️ [EVIDENCE MATCHING WORKER] No pending claims for user ${userId}`);
        return { success: true, matches: 0 };
      }

      logger.info(`📋 [EVIDENCE MATCHING WORKER] Found ${claims.length} pending claims for user ${userId}`);

      // Run matching via Python API
      const matchingResult = await retryWithBackoff(async () => {
        return await evidenceMatchingService.runMatchingWithRetry(userId, claims, 2);
      }, 1, 2000);

      // Process results and route based on confidence
      const processedStats = await evidenceMatchingService.processMatchingResults(
        userId,
        matchingResult.results || []
      );

      logger.info(`✅ [EVIDENCE MATCHING WORKER] Successfully matched evidence for user ${userId}`, {
        matches: matchingResult.matches,
        autoSubmitted: processedStats.autoSubmitted,
        smartPromptsCreated: processedStats.smartPromptsCreated,
        held: processedStats.held
      });

      // 🎯 AGENT 11 INTEGRATION: Log matching events
      try {
        const agentEventLogger = (await import('../services/agentEventLogger')).default;
        const matchingStartTime = Date.now();
        
        for (const result of (matchingResult.results || [])) {
          await agentEventLogger.logEvidenceMatching({
            userId,
            disputeId: result.dispute_id || '',
            success: true,
            confidence: result.final_confidence || 0,
            action: (result.final_confidence || 0) >= 0.85 ? 'auto_submit' 
              : (result.final_confidence || 0) >= 0.5 ? 'smart_prompt' 
              : 'hold',
            duration: Date.now() - matchingStartTime
          });
        }
      } catch (logError: any) {
        logger.warn('⚠️ [EVIDENCE MATCHING WORKER] Failed to log event', {
          error: logError.message
        });
      }

      return {
        success: true,
        matches: matchingResult.matches,
        autoSubmitted: processedStats.autoSubmitted,
        smartPromptsCreated: processedStats.smartPromptsCreated,
        held: processedStats.held
      };

    } catch (error: any) {
      // Log error
      await this.logError(userId, error);

      logger.error(`❌ [EVIDENCE MATCHING WORKER] Failed to match evidence for user: ${userId}`, {
        error: error.message,
        userId
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get pending claims (detection_results) for a user
   */
  private async getPendingClaimsForUser(userId: string): Promise<ClaimData[]> {
    try {
      const client = supabaseAdmin || supabase;

      // Get detection_results that need matching
      const { data: results, error } = await client
        .from('detection_results')
        .select('id, seller_id, anomaly_type, estimated_value, currency, confidence_score, evidence, related_event_ids')
        .eq('seller_id', userId)
        .eq('status', 'pending')
        .limit(50);

      if (error) {
        logger.warn('⚠️ [EVIDENCE MATCHING WORKER] Error fetching claims', {
          userId,
          error: error.message
        });
        return [];
      }

      if (!results || results.length === 0) {
        return [];
      }

      // Transform to ClaimData format
      return results.map((result: any) => {
        const evidence = result.evidence || {};
        return {
          claim_id: result.id,
          claim_type: result.anomaly_type,
          amount: result.estimated_value,
          confidence: result.confidence_score,
          currency: result.currency || 'USD',
          evidence: evidence,
          sku: evidence.sku,
          asin: evidence.asin,
          order_id: evidence.order_id
        };
      });
    } catch (error: any) {
      logger.error('❌ [EVIDENCE MATCHING WORKER] Error getting pending claims', {
        userId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Log matching error
   */
  private async logError(
    userId: string,
    error: any,
    retryCount: number = 0
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;

      // Try to insert into evidence_matching_errors table
      const { error: insertError } = await client
        .from('evidence_matching_errors')
        .insert({
          seller_id: userId,
          error_type: error.name || 'MatchingError',
          error_message: error.message || String(error),
          error_stack: error.stack,
          retry_count: retryCount,
          max_retries: 3,
          metadata: {
            timestamp: new Date().toISOString(),
            seller_id: userId
          }
        });

      if (insertError) {
        // Table might not exist - log warning
        logger.warn('⚠️ [EVIDENCE MATCHING WORKER] Failed to log error (table may not exist)', {
          userId,
          error: insertError.message
        });
      } else {
        logger.info('📝 [EVIDENCE MATCHING WORKER] Logged matching error', {
          userId,
          errorType: error.name || 'MatchingError',
          retryCount
        });
      }
    } catch (logError: any) {
      logger.warn('⚠️ [EVIDENCE MATCHING WORKER] Error logging error (non-critical)', {
        userId,
        error: logError.message
      });
    }
  }

  /**
   * Get worker status
   */
  getStatus(): { running: boolean; schedule: string } {
    return {
      running: this.isRunning,
      schedule: this.schedule
    };
  }

  /**
   * Manually trigger matching for a user (for testing)
   */
  async triggerManualMatching(userId: string): Promise<{
    success: boolean;
    matches?: number;
    autoSubmitted?: number;
    smartPromptsCreated?: number;
    held?: number;
    error?: string;
  }> {
    logger.info(`🔧 [EVIDENCE MATCHING WORKER] Manual matching triggered for user: ${userId}`);
    return await this.matchEvidenceForUser(userId);
  }

  /**
   * Trigger matching when document parsing completes (called by Agent 5)
   */
  async triggerMatchingForParsedDocument(userId: string): Promise<void> {
    try {
      logger.info(`🔄 [EVIDENCE MATCHING WORKER] Triggering matching after document parsing for user: ${userId}`);
      
      // Queue matching for this user (non-blocking)
      setImmediate(async () => {
        try {
          await this.matchEvidenceForUser(userId);
        } catch (error: any) {
          logger.warn('⚠️ [EVIDENCE MATCHING WORKER] Failed to match after parsing', {
            userId,
            error: error.message
          });
        }
      });
    } catch (error: any) {
      logger.warn('⚠️ [EVIDENCE MATCHING WORKER] Error triggering matching after parsing', {
        userId,
        error: error.message
      });
    }
  }
}

// Singleton instance
const evidenceMatchingWorker = new EvidenceMatchingWorker();

export default evidenceMatchingWorker;

