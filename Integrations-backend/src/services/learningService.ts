/**
 * Learning Service
 * Wraps Python learning API endpoints for continuous improvement
 * Handles model retraining, rule updates, and threshold optimization
 */

import logger from '../utils/logger';
import axios from 'axios';
import agentEventLogger, { AgentType, EventType } from './agentEventLogger';
import { buildPythonServiceAuthHeader } from '../utils/pythonServiceAuth';

export interface RejectionData {
  userId: string;
  claimId: string;
  amazonCaseId?: string;
  rejectionReason: string;
  claimAmount?: number;
  currency?: string;
  sku?: string;
  asin?: string;
  claimType?: string;
}

export interface ModelPerformance {
  modelVersion: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  lastUpdated: string;
}

export interface ThresholdUpdate {
  thresholdType: 'auto_submit' | 'smart_prompt' | 'hold';
  oldValue: number;
  newValue: number;
  reason: string;
  expectedImprovement: number;
}

export interface RetrainingResult {
  success: boolean;
  modelVersion?: string;
  oldAccuracy?: number;
  newAccuracy?: number;
  improvement?: number;
  trainingSamples?: number;
  error?: string;
}

export interface PatternAnalysis {
  evidenceTypes: Record<string, { successRate: number; count: number }>;
  rejectionPatterns: Record<string, { count: number; fixable: number; unclaimable: number }>;
  optimalSequences: Array<{ sequence: string[]; successRate: number }>;
  thresholdRecommendations: ThresholdUpdate[];
}

class LearningService {
  private pythonApiUrl: string;

  constructor() {
    this.pythonApiUrl = process.env.PYTHON_API_URL || 'https://clario-complete-backend-7tgl.onrender.com';
  }

  private buildServiceHeaders(
    userId: string,
    context: string,
    extraHeaders: Record<string, string> = {}
  ): Record<string, string> {
    return {
      ...extraHeaders,
      Authorization: buildPythonServiceAuthHeader({
        userId,
        metadata: { source: `learning:${context}` }
      })
    };
  }

  /**
   * Log rejection to Python API for learning
   */
  async logRejection(data: RejectionData): Promise<void> {
    try {
      logger.info('📚 [LEARNING] Logging rejection for learning', {
        userId: data.userId,
        claimId: data.claimId
      });

      const response = await axios.post(
        `${this.pythonApiUrl}/api/v1/claim-detector/rejections/log`,
        {
          user_id: data.userId,
          claim_id: data.claimId,
          amazon_case_id: data.amazonCaseId,
          rejection_reason: data.rejectionReason,
          claim_amount: data.claimAmount,
          currency: data.currency || 'usd',
          sku: data.sku,
          asin: data.asin,
          claim_type: data.claimType
        },
        {
          timeout: 30000,
          headers: this.buildServiceHeaders(data.userId, 'log-rejection', {
            'Content-Type': 'application/json'
          })
        }
      );

      logger.info('✅ [LEARNING] Rejection logged successfully', {
        userId: data.userId,
        claimId: data.claimId,
        trackingId: response.data?.tracking_id
      });

    } catch (error: any) {
      logger.error('❌ [LEARNING] Failed to log rejection', {
        userId: data.userId,
        claimId: data.claimId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Trigger model retraining with collected data
   */
  async triggerModelRetraining(
    userId: string,
    trainingData: {
      events: any[];
      minSamples?: number;
      includeEdgeCases?: boolean;
      recentDays?: number;
    }
  ): Promise<RetrainingResult> {
    try {
      logger.info('🔄 [LEARNING] Triggering model retraining', {
        userId,
        eventCount: trainingData.events.length
      });

      const response = await axios.post(
        `${this.pythonApiUrl}/api/v1/claim-detector/feedback/retrain`,
        {
          user_id: userId,
          training_data: trainingData.events,
          min_samples: trainingData.minSamples || 50,
          include_edge_cases: trainingData.includeEdgeCases || true,
          recent_days: trainingData.recentDays || 90
        },
        {
          timeout: 300000, // 5 minutes for retraining
          headers: this.buildServiceHeaders(userId, 'retrain', {
            'Content-Type': 'application/json'
          })
        }
      );

      const result: RetrainingResult = {
        success: response.data?.success || false,
        modelVersion: response.data?.model_version,
        oldAccuracy: response.data?.old_accuracy,
        newAccuracy: response.data?.new_accuracy,
        improvement: response.data?.improvement,
        trainingSamples: response.data?.training_samples
      };

      logger.info('✅ [LEARNING] Model retraining completed', result);

      // Log retraining event
      await agentEventLogger.logEvent({
        userId,
        agent: AgentType.EVIDENCE_MATCHING, // Learning affects matching
        eventType: EventType.MATCHING_COMPLETED,
        success: result.success,
        metadata: {
          modelVersion: result.modelVersion,
          oldAccuracy: result.oldAccuracy,
          newAccuracy: result.newAccuracy,
          improvement: result.improvement,
          trainingSamples: result.trainingSamples
        }
      });

      return result;

    } catch (error: any) {
      logger.error('❌ [LEARNING] Failed to trigger model retraining', {
        userId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get model performance metrics
   */
  async getModelPerformance(userId: string): Promise<ModelPerformance | null> {
    try {
      const response = await axios.get(
        `${this.pythonApiUrl}/api/v1/claim-detector/model/performance`,
        {
          params: { user_id: userId },
          timeout: 30000,
          headers: this.buildServiceHeaders(userId, 'model-performance')
        }
      );

      return response.data as ModelPerformance;

    } catch (error: any) {
      logger.warn('⚠️ [LEARNING] Failed to get model performance', {
        userId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Analyze patterns from agent events
   */
  async analyzePatterns(
    userId: string,
    events: any[]
  ): Promise<PatternAnalysis> {
    try {
      logger.info('🔍 [LEARNING] Analyzing patterns', {
        userId,
        eventCount: events.length
      });

      // Analyze evidence types and success rates
      const evidenceTypes: Record<string, { successRate: number; count: number }> = {};
      const rejectionPatterns: Record<string, { count: number; fixable: number; unclaimable: number }> = {};
      const sequences: Array<{ sequence: string[]; success: boolean }> = [];

      // Process events to extract patterns
      for (const event of events) {
        // Evidence type analysis
        if (event.agent === AgentType.EVIDENCE_INGESTION && event.metadata?.provider) {
          const provider = event.metadata.provider;
          if (!evidenceTypes[provider]) {
            evidenceTypes[provider] = { successRate: 0, count: 0 };
          }
          evidenceTypes[provider].count++;
          if (event.success) {
            evidenceTypes[provider].successRate =
              (evidenceTypes[provider].successRate * (evidenceTypes[provider].count - 1) + 1) / evidenceTypes[provider].count;
          } else {
            evidenceTypes[provider].successRate =
              (evidenceTypes[provider].successRate * (evidenceTypes[provider].count - 1)) / evidenceTypes[provider].count;
          }
        }

        // Rejection pattern analysis
        if (event.eventType === EventType.CASE_DENIED && event.metadata?.rejectionReason) {
          const reason = event.metadata.rejectionReason;
          if (!rejectionPatterns[reason]) {
            rejectionPatterns[reason] = { count: 0, fixable: 0, unclaimable: 0 };
          }
          rejectionPatterns[reason].count++;
          // Classify as fixable/unclaimable (simplified - would use Python API in production)
          if (reason.toLowerCase().includes('documentation') || reason.toLowerCase().includes('evidence')) {
            rejectionPatterns[reason].fixable++;
          } else {
            rejectionPatterns[reason].unclaimable++;
          }
        }

        // Sequence analysis (simplified - would track full sequences in production)
        if (event.success && event.metadata?.disputeId) {
          sequences.push({
            sequence: [event.agent],
            success: true
          });
        }
      }

      // Calculate optimal sequences (simplified)
      const optimalSequences = sequences
        .filter(s => s.success)
        .map(s => ({
          sequence: s.sequence,
          successRate: 1.0
        }))
        .slice(0, 5);

      // Generate threshold recommendations
      const thresholdRecommendations = await this.generateThresholdRecommendations(userId, events);

      return {
        evidenceTypes,
        rejectionPatterns,
        optimalSequences,
        thresholdRecommendations
      };

    } catch (error: any) {
      logger.error('❌ [LEARNING] Failed to analyze patterns', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate threshold optimization recommendations
   */
  private async generateThresholdRecommendations(
    userId: string,
    events: any[]
  ): Promise<ThresholdUpdate[]> {
    const recommendations: ThresholdUpdate[] = [];

    try {
      // Analyze matching events to optimize thresholds
      const matchingEvents = events.filter(
        e => e.agent === AgentType.EVIDENCE_MATCHING && e.eventType === EventType.MATCHING_COMPLETED
      );

      if (matchingEvents.length < 10) {
        return recommendations; // Not enough data
      }

      // Calculate success rates by confidence ranges
      const highConfidence = matchingEvents.filter(
        e => e.metadata?.confidence >= 0.85 && e.metadata?.action === 'auto_submit'
      );
      const mediumConfidence = matchingEvents.filter(
        e => e.metadata?.confidence >= 0.5 && e.metadata?.confidence < 0.85 && e.metadata?.action === 'smart_prompt'
      );
      const lowConfidence = matchingEvents.filter(
        e => e.metadata?.confidence < 0.5 && e.metadata?.action === 'hold'
      );

      // Get approval rates for each range
      const highConfidenceApprovals = highConfidence.filter(e => {
        // Check if this led to an approval (would need to track full pipeline)
        return true; // Simplified
      }).length;

      const highConfidenceSuccessRate = highConfidence.length > 0
        ? highConfidenceApprovals / highConfidence.length
        : 0;

      // Recommend threshold adjustments if success rate is low
      if (highConfidenceSuccessRate < 0.8 && highConfidence.length > 5) {
        recommendations.push({
          thresholdType: 'auto_submit',
          oldValue: 0.85,
          newValue: 0.90, // Increase threshold if success rate is low
          reason: `High confidence success rate (${(highConfidenceSuccessRate * 100).toFixed(1)}%) is below target (80%)`,
          expectedImprovement: 0.05
        });
      }

      // Similar logic for smart_prompt threshold
      if (mediumConfidence.length > 5) {
        const mediumSuccessRate = mediumConfidence.filter(e => true).length / mediumConfidence.length;
        if (mediumSuccessRate > 0.7) {
          recommendations.push({
            thresholdType: 'smart_prompt',
            oldValue: 0.5,
            newValue: 0.45, // Lower threshold if medium confidence performs well
            reason: `Medium confidence success rate (${(mediumSuccessRate * 100).toFixed(1)}%) is above target`,
            expectedImprovement: 0.03
          });
        }
      }

    } catch (error: any) {
      logger.error('❌ [LEARNING] Failed to generate threshold recommendations', {
        userId,
        error: error.message
      });
    }

    return recommendations;
  }

  /**
   * Update thresholds based on recommendations
   */
  async updateThresholds(
    userId: string,
    updates: ThresholdUpdate[]
  ): Promise<boolean> {
    try {
      logger.info('⚙️ [LEARNING] Updating thresholds', {
        userId,
        updateCount: updates.length
      });

      // Store threshold updates in database
      const { supabaseAdmin } = await import('../database/supabaseClient');

      for (const update of updates) {
        await supabaseAdmin
          .from('threshold_optimizations')
          .insert({
            user_id: userId,
            threshold_type: update.thresholdType,
            old_value: update.oldValue,
            new_value: update.newValue,
            reason: update.reason,
            expected_improvement: update.expectedImprovement,
            applied_at: new Date().toISOString()
          });
      }

      // Also update in Python API if endpoint exists
      try {
        await axios.post(
          `${this.pythonApiUrl}/api/v1/claim-detector/thresholds/update`,
          {
            user_id: userId,
            updates: updates.map(u => ({
              threshold_type: u.thresholdType,
              new_value: u.newValue
            }))
          },
          {
            timeout: 30000,
            headers: this.buildServiceHeaders(userId, 'threshold-update', {
              'Content-Type': 'application/json'
            })
          }
        );
      } catch (error: any) {
        // Non-critical - Python API might not have this endpoint yet
        logger.debug('⚠️ [LEARNING] Python API threshold update not available', {
          error: error.message
        });
      }

      logger.info('✅ [LEARNING] Thresholds updated successfully', {
        userId,
        updateCount: updates.length
      });

      return true;

    } catch (error: any) {
      logger.error('❌ [LEARNING] Failed to update thresholds', {
        userId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get learning insights for a user
   */
  async getLearningInsights(userId: string, days: number = 30): Promise<any> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get events for analysis
      const events = await agentEventLogger.getEvents({
        userId,
        startDate,
        endDate
      });

      // Analyze patterns
      const patterns = await this.analyzePatterns(userId, events);

      // Get success rates per agent
      const successRates: Record<string, number> = {};
      for (const agent of Object.values(AgentType)) {
        successRates[agent] = await agentEventLogger.getSuccessRate(agent, userId, days);
      }

      // Get model performance
      const modelPerformance = await this.getModelPerformance(userId);

      return {
        successRates,
        patterns,
        modelPerformance,
        eventCount: events.length,
        period: { startDate, endDate, days }
      };

    } catch (error: any) {
      logger.error('❌ [LEARNING] Failed to get learning insights', {
        userId,
        error: error.message
      });
      throw error;
    }
  }
}

// Export singleton instance
const learningService = new LearningService();
export default learningService;

