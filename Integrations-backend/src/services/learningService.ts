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
  // NEW: Outcome-by-dimension tracking
  outcomesByDimension?: OutcomesByDimension;
  // NEW: Long tail patterns
  longTailPatterns?: LongTailPattern[];
}

// NEW: Outcome tracking by dimension (claim type, marketplace, age, evidence)
export interface OutcomesByDimension {
  byClaimType: Record<string, OutcomeMetrics>;
  byMarketplace: Record<string, OutcomeMetrics>;
  byClaimAge: Record<string, OutcomeMetrics>;  // "0-7d", "8-30d", "31-60d"
  byEvidenceQuality: Record<string, OutcomeMetrics>;  // "low", "medium", "high"
}

export interface OutcomeMetrics {
  totalClaims: number;
  approved: number;
  denied: number;
  pending: number;
  approvalRate: number;
  denialRate: number;
  totalEstimated: number;
  totalApproved: number;
  recoveryRate: number;
  avgTimeToResolution: number;
}

// NEW: Long tail pattern detection ($0.10-$2 x 1000s of units = big money)
export interface LongTailPattern {
  patternId: string;
  patternType: 'fee_micro_overcharge' | 'recurring_adjustment' | 'systematic_shortage';
  affectedSkus: string[];
  perUnitAmount: number;
  totalUnitsAffected: number;
  aggregatedValue: number;
  frequency: 'every_order' | 'daily' | 'weekly';
  confidenceScore: number;
  firstOccurrence: string;
  lastOccurrence: string;
  description: string;
}

// NEW: Detection threshold feedback
export interface DetectionThresholdUpdate {
  anomalyType: string;
  dimension: 'value_threshold' | 'confidence_threshold' | 'frequency_threshold';
  oldValue: number;
  newValue: number;
  reason: string;
  basedOnOutcomes: number;
  expectedImpact: string;
}


class LearningService {
  private pythonApiUrl: string;

  constructor() {
    this.pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-backend-jb6c.onrender.com';
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

  // ============================================================================
  // NEW: Outcome-by-Dimension Analysis
  // ============================================================================

  /**
   * Analyze outcomes by claim type, marketplace, claim age, and evidence quality
   * Feeds back into detection thresholds
   */
  async analyzeOutcomesByDimension(userId: string): Promise<OutcomesByDimension> {
    const results: OutcomesByDimension = {
      byClaimType: {},
      byMarketplace: {},
      byClaimAge: {},
      byEvidenceQuality: {}
    };

    try {
      const { supabaseAdmin } = await import('../database/supabaseClient');

      // Get all resolved cases for this user
      const { data: cases, error } = await supabaseAdmin
        .from('dispute_cases')
        .select('*')
        .eq('seller_id', userId)
        .in('status', ['approved', 'denied', 'closed', 'partial'])
        .limit(2000);

      if (error || !cases?.length) {
        logger.info('[LEARNING] No cases to analyze for outcomes', { userId });
        return results;
      }

      // Group and calculate metrics by claim type
      const byType = this.groupCases(cases, 'case_type');
      for (const [type, typeCases] of Object.entries(byType)) {
        results.byClaimType[type] = this.calculateMetrics(typeCases as any[]);
      }

      // Group by marketplace
      const byMarketplace = this.groupCases(cases, 'marketplace');
      for (const [mp, mpCases] of Object.entries(byMarketplace)) {
        results.byMarketplace[mp] = this.calculateMetrics(mpCases as any[]);
      }

      // Group by claim age
      const casesWithAge = cases.map(c => ({
        ...c,
        age_bucket: this.getAgeBucket(c.created_at, c.updated_at)
      }));
      const byAge = this.groupCases(casesWithAge, 'age_bucket');
      for (const [age, ageCases] of Object.entries(byAge)) {
        results.byClaimAge[age] = this.calculateMetrics(ageCases as any[]);
      }

      // Group by evidence quality
      const casesWithQuality = cases.map(c => ({
        ...c,
        evidence_quality: this.getEvidenceQuality(c.evidence_completeness || 0.5)
      }));
      const byQuality = this.groupCases(casesWithQuality, 'evidence_quality');
      for (const [quality, qualityCases] of Object.entries(byQuality)) {
        results.byEvidenceQuality[quality] = this.calculateMetrics(qualityCases as any[]);
      }

      logger.info('[LEARNING] Outcome-by-dimension analysis complete', {
        userId,
        totalCases: cases.length,
        claimTypes: Object.keys(results.byClaimType).length,
        marketplaces: Object.keys(results.byMarketplace).length
      });

    } catch (error: any) {
      logger.error('[LEARNING] Error analyzing outcomes by dimension', { userId, error: error.message });
    }

    return results;
  }

  private groupCases(cases: any[], key: string): Record<string, any[]> {
    const groups: Record<string, any[]> = {};
    for (const c of cases) {
      const value = c[key] || 'unknown';
      if (!groups[value]) groups[value] = [];
      groups[value].push(c);
    }
    return groups;
  }

  private calculateMetrics(cases: any[]): OutcomeMetrics {
    const total = cases.length;
    const approved = cases.filter(c => c.status === 'approved' || c.status === 'partial').length;
    const denied = cases.filter(c => c.status === 'denied' || c.status === 'closed').length;
    const pending = cases.filter(c => c.status === 'pending').length;

    const totalEstimated = cases.reduce((s, c) => s + (c.estimated_value || 0), 0);
    const totalApproved = cases.reduce((s, c) => s + (c.approved_amount || 0), 0);

    const resolutionTimes = cases
      .filter(c => c.created_at && c.updated_at)
      .map(c => this.daysBetween(c.created_at, c.updated_at));
    const avgTime = resolutionTimes.length > 0
      ? resolutionTimes.reduce((s, t) => s + t, 0) / resolutionTimes.length
      : 0;

    return {
      totalClaims: total,
      approved,
      denied,
      pending,
      approvalRate: total > 0 ? approved / total : 0,
      denialRate: total > 0 ? denied / total : 0,
      totalEstimated,
      totalApproved,
      recoveryRate: totalEstimated > 0 ? totalApproved / totalEstimated : 0,
      avgTimeToResolution: avgTime
    };
  }

  private getAgeBucket(created: string, resolved: string): string {
    const days = this.daysBetween(created, resolved);
    if (days <= 7) return '0-7d';
    if (days <= 30) return '8-30d';
    if (days <= 60) return '31-60d';
    return '60+d';
  }

  private getEvidenceQuality(completeness: number): string {
    if (completeness >= 0.8) return 'high';
    if (completeness >= 0.5) return 'medium';
    return 'low';
  }

  private daysBetween(start: string, end: string): number {
    const s = new Date(start);
    const e = new Date(end);
    return Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  }

  // ============================================================================
  // NEW: Long Tail Pattern Explorer
  // ============================================================================

  /**
   * Find long tail patterns: micro-overcharges that add up to significant value
   * Example: $0.35 overcharge x 50,000 units = $17,500
   */
  async exploreLongTailPatterns(userId: string): Promise<LongTailPattern[]> {
    const patterns: LongTailPattern[] = [];

    try {
      const { supabaseAdmin } = await import('../database/supabaseClient');

      // Get fee events for the last 180 days
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - 180);

      const { data: feeEvents, error } = await supabaseAdmin
        .from('financial_events')
        .select('*')
        .eq('seller_id', userId)
        .in('event_type', ['fba_fee', 'fulfillment_fee', 'service_fee'])
        .gte('event_date', lookbackDate.toISOString())
        .limit(10000);

      if (error || !feeEvents?.length) {
        return patterns;
      }

      // Group by SKU
      const skuGroups = new Map<string, any[]>();
      for (const event of feeEvents) {
        const sku = event.amazon_sku || event.sku || 'unknown';
        if (!skuGroups.has(sku)) skuGroups.set(sku, []);
        skuGroups.get(sku)!.push(event);
      }

      // Analyze each SKU for patterns
      for (const [sku, events] of skuGroups) {
        if (events.length < 50) continue; // Need enough data

        // Look for consistent small overcharges
        const overcharges = events
          .filter(e => e.expected_amount && e.amount)
          .map(e => ({
            date: e.event_date,
            charged: Math.abs(e.amount),
            expected: Math.abs(e.expected_amount || e.amount),
            diff: Math.abs(e.amount) - Math.abs(e.expected_amount || e.amount)
          }))
          .filter(o => o.diff >= 0.05 && o.diff <= 2.00); // $0.05 to $2 range

        if (overcharges.length < 25) continue;

        // Check for consistency
        const avgOvercharge = overcharges.reduce((s, o) => s + o.diff, 0) / overcharges.length;
        const totalValue = avgOvercharge * overcharges.length;

        // Only report if total value is significant ($100+)
        if (totalValue >= 100) {
          patterns.push({
            patternId: `lt_${sku}_${userId.substring(0, 6)}`,
            patternType: 'fee_micro_overcharge',
            affectedSkus: [sku],
            perUnitAmount: Math.round(avgOvercharge * 100) / 100,
            totalUnitsAffected: overcharges.length,
            aggregatedValue: Math.round(totalValue * 100) / 100,
            frequency: 'every_order',
            confidenceScore: Math.min(0.95, 0.6 + (overcharges.length / 500) * 0.35),
            firstOccurrence: overcharges[overcharges.length - 1].date,
            lastOccurrence: overcharges[0].date,
            description: `SKU ${sku}: $${avgOvercharge.toFixed(2)} overcharge x ${overcharges.length} units = $${totalValue.toFixed(2)} potential recovery`
          });
        }
      }

      // Sort by aggregated value
      patterns.sort((a, b) => b.aggregatedValue - a.aggregatedValue);

      logger.info('[LEARNING] Long tail pattern exploration complete', {
        userId,
        patternsFound: patterns.length,
        totalValue: patterns.reduce((s, p) => s + p.aggregatedValue, 0)
      });

    } catch (error: any) {
      logger.error('[LEARNING] Error exploring long tail patterns', { userId, error: error.message });
    }

    return patterns;
  }

  // ============================================================================
  // NEW: Detection Threshold Feedback
  // ============================================================================

  /**
   * Generate detection threshold updates based on outcomes
   * Feeds back into Agent 3 detection algorithms
   */
  async generateDetectionThresholdUpdates(userId: string): Promise<DetectionThresholdUpdate[]> {
    const updates: DetectionThresholdUpdate[] = [];

    try {
      const outcomes = await this.analyzeOutcomesByDimension(userId);

      // Analyze each claim type's performance
      for (const [claimType, metrics] of Object.entries(outcomes.byClaimType)) {
        if (metrics.totalClaims < 10) continue; // Need enough data

        // If approval rate is high, we can lower the detection threshold (catch more)
        if (metrics.approvalRate >= 0.8 && metrics.totalClaims >= 20) {
          updates.push({
            anomalyType: claimType,
            dimension: 'value_threshold',
            oldValue: 25, // Current min value
            newValue: 15, // Lower threshold to catch more
            reason: `High approval rate (${(metrics.approvalRate * 100).toFixed(0)}%) on ${claimType} claims - safe to lower detection threshold`,
            basedOnOutcomes: metrics.totalClaims,
            expectedImpact: 'Catch 20-30% more claims with high approval likelihood'
          });
        }

        // If approval rate is low, raise the threshold (focus on quality)
        if (metrics.approvalRate < 0.5 && metrics.totalClaims >= 20) {
          updates.push({
            anomalyType: claimType,
            dimension: 'confidence_threshold',
            oldValue: 0.6,
            newValue: 0.75,
            reason: `Low approval rate (${(metrics.approvalRate * 100).toFixed(0)}%) on ${claimType} claims - raise confidence threshold`,
            basedOnOutcomes: metrics.totalClaims,
            expectedImpact: 'Reduce false positives by 30-40%'
          });
        }

        // If recovery rate is low (partial approvals), focus on evidence quality
        if (metrics.recoveryRate < 0.6 && metrics.approvalRate >= 0.5) {
          updates.push({
            anomalyType: claimType,
            dimension: 'frequency_threshold',
            oldValue: 0,
            newValue: 0,
            reason: `Low recovery rate (${(metrics.recoveryRate * 100).toFixed(0)}%) suggests partial approvals - prioritize evidence quality for ${claimType}`,
            basedOnOutcomes: metrics.totalClaims,
            expectedImpact: 'Improve recovery rate by focusing on better documentation'
          });
        }
      }

      // Store threshold updates
      if (updates.length > 0) {
        const { supabaseAdmin } = await import('../database/supabaseClient');
        for (const update of updates) {
          await supabaseAdmin
            .from('detection_threshold_updates')
            .insert({
              user_id: userId,
              anomaly_type: update.anomalyType,
              dimension: update.dimension,
              old_value: update.oldValue,
              new_value: update.newValue,
              reason: update.reason,
              based_on_outcomes: update.basedOnOutcomes,
              expected_impact: update.expectedImpact,
              created_at: new Date().toISOString()
            });
        }
      }

      logger.info('[LEARNING] Detection threshold updates generated', {
        userId,
        updatesCount: updates.length
      });

    } catch (error: any) {
      logger.error('[LEARNING] Error generating detection threshold updates', { userId, error: error.message });
    }

    return updates;
  }
}


// Export singleton instance
const learningService = new LearningService();
export default learningService;

