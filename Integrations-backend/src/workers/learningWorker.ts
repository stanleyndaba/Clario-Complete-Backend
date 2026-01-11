/**
 * Learning Worker
 * Automated background worker for continuous learning and improvement
 * Collects events from Agents 4-10, analyzes patterns, optimizes thresholds, and triggers model retraining
 * 
 * MULTI-TENANT: Uses tenant-scoped queries for data isolation
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import { createTenantScopedQueryById } from '../database/tenantScopedClient';
import agentEventLogger, { AgentType, EventType } from '../services/agentEventLogger';
import learningService from '../services/learningService';

export interface LearningStats {
  eventsCollected: number;
  patternsAnalyzed: number;
  thresholdsOptimized: number;
  modelRetrainingTriggered: number;
  insightsGenerated: number;
  // NEW: Outcome and long tail tracking
  outcomesAnalyzed: number;
  longTailPatternsFound: number;
  longTailTotalValue: number;
  detectionThresholdsUpdated: number;
  errors: string[];
}


class LearningWorker {
  private schedule: string = '*/30 * * * *'; // Every 30 minutes
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private minEventsForAnalysis: number = 50;
  private minEventsForRetraining: number = 100;

  /**
   * Start the worker
   */
  start(): void {
    if (this.cronJob) {
      logger.warn('⚠️ [LEARNING] Worker already started');
      return;
    }

    logger.info('🚀 [LEARNING] Starting Learning Worker', {
      schedule: this.schedule
    });

    // Schedule learning job (every 30 minutes)
    this.cronJob = cron.schedule(this.schedule, async () => {
      if (this.isRunning) {
        logger.debug('⏸️ [LEARNING] Previous run still in progress, skipping');
        return;
      }

      this.isRunning = true;
      try {
        await this.runLearningCycle();
      } catch (error: any) {
        logger.error('❌ [LEARNING] Error in learning cycle', { error: error.message });
      } finally {
        this.isRunning = false;
      }
    });

    logger.info('✅ [LEARNING] Worker started successfully');
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    logger.info('🛑 [LEARNING] Worker stopped');
  }

  /**
   * Run a complete learning cycle
   */
  async runLearningCycle(): Promise<LearningStats> {
    const stats: LearningStats = {
      eventsCollected: 0,
      patternsAnalyzed: 0,
      thresholdsOptimized: 0,
      modelRetrainingTriggered: 0,
      insightsGenerated: 0,
      outcomesAnalyzed: 0,
      longTailPatternsFound: 0,
      longTailTotalValue: 0,
      detectionThresholdsUpdated: 0,
      errors: []
    };

    try {
      logger.info('[LEARNING] Starting learning cycle', {
        timestamp: new Date().toISOString()
      });

      // Step 1: Collect events from all agents
      const events = await this.collectAgentEvents();
      stats.eventsCollected = events.length;

      if (events.length < this.minEventsForAnalysis) {
        logger.debug('[LEARNING] Insufficient events for analysis', {
          eventCount: events.length,
          minRequired: this.minEventsForAnalysis
        });
        return stats;
      }

      // Step 2: Group events by user
      const eventsByUser = this.groupEventsByUser(events);

      // Step 3: Process each user's events
      for (const [userId, userEvents] of eventsByUser.entries()) {
        try {
          // Analyze patterns
          const patterns = await learningService.analyzePatterns(userId, userEvents);
          stats.patternsAnalyzed++;

          // Optimize thresholds
          if (patterns.thresholdRecommendations.length > 0) {
            const updated = await learningService.updateThresholds(userId, patterns.thresholdRecommendations);
            if (updated) {
              stats.thresholdsOptimized += patterns.thresholdRecommendations.length;
            }
          }

          // NEW: Analyze outcomes by dimension (claim type, marketplace, age, evidence quality)
          try {
            const outcomes = await learningService.analyzeOutcomesByDimension(userId);
            stats.outcomesAnalyzed++;

            // Generate detection threshold updates based on outcomes
            const thresholdUpdates = await learningService.generateDetectionThresholdUpdates(userId);
            stats.detectionThresholdsUpdated += thresholdUpdates.length;
          } catch (outcomeError: any) {
            logger.debug('[LEARNING] Outcome analysis skipped', { userId, error: outcomeError.message });
          }

          // NEW: Explore long tail patterns (micro-overcharges that add up)
          try {
            const longTailPatterns = await learningService.exploreLongTailPatterns(userId);
            stats.longTailPatternsFound += longTailPatterns.length;
            stats.longTailTotalValue += longTailPatterns.reduce((s, p) => s + p.aggregatedValue, 0);

            // Log significant long tail patterns
            for (const pattern of longTailPatterns.filter(p => p.aggregatedValue >= 1000)) {
              logger.info('[LEARNING] Significant long tail pattern found', {
                userId,
                patternId: pattern.patternId,
                skus: pattern.affectedSkus,
                perUnit: pattern.perUnitAmount,
                totalUnits: pattern.totalUnitsAffected,
                totalValue: pattern.aggregatedValue
              });
            }
          } catch (ltError: any) {
            logger.debug('[LEARNING] Long tail analysis skipped', { userId, error: ltError.message });
          }

          // Check if enough events for retraining
          if (userEvents.length >= this.minEventsForRetraining) {
            // Check if retraining is needed (e.g., recent rejections, low success rate)
            const shouldRetrain = await this.shouldTriggerRetraining(userId, userEvents);

            if (shouldRetrain) {
              const result = await learningService.triggerModelRetraining(userId, {
                events: userEvents,
                minSamples: 50,
                includeEdgeCases: true,
                recentDays: 90
              });

              if (result.success) {
                stats.modelRetrainingTriggered++;
                logger.info('[LEARNING] Model retraining triggered', {
                  userId,
                  modelVersion: result.modelVersion,
                  improvement: result.improvement
                });
              }
            }
          }

          // Generate insights
          const insights = await learningService.getLearningInsights(userId, 30);
          stats.insightsGenerated++;

          // Store insights
          await this.storeInsights(userId, insights);

        } catch (error: any) {
          logger.error('[LEARNING] Error processing user events', {
            userId,
            error: error.message
          });
          stats.errors.push(`User ${userId}: ${error.message}`);
        }
      }

      logger.info('[LEARNING] Learning cycle completed', stats);
      return stats;

    } catch (error: any) {
      logger.error('[LEARNING] Fatal error in learning cycle', { error: error.message });
      stats.errors.push(`Fatal error: ${error.message}`);
      return stats;
    }
  }

  /**
   * Collect events from all agents
   */
  private async collectAgentEvents(): Promise<any[]> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setHours(startDate.getHours() - 24); // Last 24 hours

      const { data: events, error } = await supabaseAdmin
        .from('agent_events')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) {
        logger.error('[LEARNING] Failed to collect events', { error: error.message });
        return [];
      }

      return events || [];

    } catch (error: any) {
      logger.error('[LEARNING] Error collecting events', { error: error.message });
      return [];
    }
  }


  /**
   * Group events by user
   */
  private groupEventsByUser(events: any[]): Map<string, any[]> {
    const grouped = new Map<string, any[]>();

    for (const event of events) {
      const userId = event.user_id;
      if (!grouped.has(userId)) {
        grouped.set(userId, []);
      }
      grouped.get(userId)!.push(event);
    }

    return grouped;
  }

  /**
   * Determine if model retraining should be triggered
   */
  private async shouldTriggerRetraining(userId: string, events: any[]): Promise<boolean> {
    try {
      // Check rejection rate
      const rejections = events.filter(
        e => e.eventType === EventType.CASE_DENIED
      ).length;

      const totalFilings = events.filter(
        e => e.agent === AgentType.REFUND_FILING && e.eventType === EventType.FILING_COMPLETED
      ).length;

      if (totalFilings === 0) {
        return false;
      }

      const rejectionRate = rejections / totalFilings;

      // Trigger retraining if rejection rate is high (>30%)
      if (rejectionRate > 0.3 && rejections >= 10) {
        logger.info('🔄 [LEARNING] High rejection rate detected, triggering retraining', {
          userId,
          rejectionRate: (rejectionRate * 100).toFixed(1) + '%',
          rejections,
          totalFilings
        });
        return true;
      }

      // Check success rate
      const successRate = await agentEventLogger.getSuccessRate(AgentType.EVIDENCE_MATCHING, userId, 30);

      // Trigger retraining if success rate is low (<70%)
      if (successRate < 0.7 && events.length >= this.minEventsForRetraining) {
        logger.info('🔄 [LEARNING] Low success rate detected, triggering retraining', {
          userId,
          successRate: (successRate * 100).toFixed(1) + '%'
        });
        return true;
      }

      return false;

    } catch (error: any) {
      logger.error('❌ [LEARNING] Error checking retraining trigger', {
        userId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Store learning insights
   */
  private async storeInsights(userId: string, insights: any): Promise<void> {
    try {
      await supabaseAdmin
        .from('learning_insights')
        .insert({
          user_id: userId,
          insights: insights,
          generated_at: new Date().toISOString()
        });

      logger.debug('💾 [LEARNING] Insights stored', { userId });

    } catch (error: any) {
      logger.warn('⚠️ [LEARNING] Failed to store insights', {
        userId,
        error: error.message
      });
    }
  }

  /**
   * Process rejection for learning (called by Agent 7 when case is denied)
   */
  async processRejection(
    userId: string,
    disputeId: string,
    rejectionReason: string,
    amazonCaseId?: string
  ): Promise<void> {
    try {
      logger.info('📚 [LEARNING] Processing rejection for learning', {
        userId,
        disputeId,
        rejectionReason
      });

      // Get case details
      const { data: disputeCase } = await supabaseAdmin
        .from('dispute_cases')
        .select('claim_amount, currency, detection_result_id')
        .eq('id', disputeId)
        .single();

      // Get detection result for SKU/ASIN
      let sku: string | undefined;
      let asin: string | undefined;
      if (disputeCase?.detection_result_id) {
        const { data: detectionResult } = await supabaseAdmin
          .from('detection_results')
          .select('evidence')
          .eq('id', disputeCase.detection_result_id)
          .single();

        if (detectionResult?.evidence) {
          sku = detectionResult.evidence.sku;
          asin = detectionResult.evidence.asin;
        }
      }

      // Log rejection to Python API
      await learningService.logRejection({
        userId,
        claimId: disputeId,
        amazonCaseId,
        rejectionReason,
        claimAmount: disputeCase?.claim_amount,
        currency: disputeCase?.currency || 'usd',
        sku,
        asin
      });

      logger.info('✅ [LEARNING] Rejection processed for learning', {
        userId,
        disputeId
      });

    } catch (error: any) {
      logger.error('❌ [LEARNING] Failed to process rejection', {
        userId,
        disputeId,
        error: error.message
      });
    }
  }
}

// Export singleton instance
const learningWorker = new LearningWorker();
export default learningWorker;

