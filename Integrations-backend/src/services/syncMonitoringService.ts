import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface SyncMetrics {
  sync_id: string;
  user_id: string;
  duration_ms: number;
  orders_processed: number;
  claims_detected: number;
  high_confidence_claims: number;
  medium_confidence_claims: number;
  low_confidence_claims: number;
  total_claim_value: number;
  detection_api_response_time_ms: number;
  detection_api_success: boolean;
  detection_api_error?: string;
  sync_status: 'completed' | 'failed' | 'cancelled';
  started_at: string;
  completed_at: string;
}

export interface DetectionAccuracyMetrics {
  sync_id: string;
  user_id: string;
  total_predictions: number;
  claimable_predictions: number;
  high_confidence_count: number;
  average_confidence: number;
  average_probability: number;
  claims_by_type: Record<string, number>;
  claims_by_severity: Record<string, number>;
}

export interface PerformanceMetrics {
  average_sync_duration_ms: number;
  average_detection_api_response_time_ms: number;
  sync_success_rate: number;
  detection_api_success_rate: number;
  average_claims_per_sync: number;
  average_claim_value_per_sync: number;
  high_confidence_claim_rate: number;
}

export class SyncMonitoringService {
  private readonly metricsTable = 'sync_metrics';
  private readonly accuracyTable = 'detection_accuracy_metrics';

  /**
   * Record sync metrics after sync completion
   */
  async recordSyncMetrics(metrics: Partial<SyncMetrics>): Promise<void> {
    try {
      const { error } = await supabase
        .from(this.metricsTable)
        .insert({
          sync_id: metrics.sync_id,
          user_id: metrics.user_id,
          duration_ms: metrics.duration_ms,
          orders_processed: metrics.orders_processed || 0,
          claims_detected: metrics.claims_detected || 0,
          high_confidence_claims: metrics.high_confidence_claims || 0,
          medium_confidence_claims: metrics.medium_confidence_claims || 0,
          low_confidence_claims: metrics.low_confidence_claims || 0,
          total_claim_value: metrics.total_claim_value || 0,
          detection_api_response_time_ms: metrics.detection_api_response_time_ms || 0,
          detection_api_success: metrics.detection_api_success ?? true,
          detection_api_error: metrics.detection_api_error || null,
          sync_status: metrics.sync_status || 'completed',
          started_at: metrics.started_at,
          completed_at: metrics.completed_at,
          created_at: new Date().toISOString()
        });

      if (error) {
        logger.error('Error recording sync metrics', { error, metrics });
        // Don't throw - monitoring failures shouldn't break the sync
      } else {
        logger.info('Sync metrics recorded', {
          sync_id: metrics.sync_id,
          user_id: metrics.user_id,
          claims_detected: metrics.claims_detected,
          duration_ms: metrics.duration_ms
        });
      }
    } catch (error) {
      logger.error('Error in recordSyncMetrics', { error, metrics });
      // Don't throw - monitoring failures shouldn't break the sync
    }
  }

  /**
   * Record detection accuracy metrics
   */
  async recordDetectionAccuracy(metrics: DetectionAccuracyMetrics): Promise<void> {
    try {
      const { error } = await supabase
        .from(this.accuracyTable)
        .insert({
          sync_id: metrics.sync_id,
          user_id: metrics.user_id,
          total_predictions: metrics.total_predictions,
          claimable_predictions: metrics.claimable_predictions,
          high_confidence_count: metrics.high_confidence_count,
          average_confidence: metrics.average_confidence,
          average_probability: metrics.average_probability,
          claims_by_type: metrics.claims_by_type,
          claims_by_severity: metrics.claims_by_severity,
          created_at: new Date().toISOString()
        });

      if (error) {
        logger.error('Error recording detection accuracy metrics', { error, metrics });
        // Don't throw - monitoring failures shouldn't break detection
      } else {
        logger.info('Detection accuracy metrics recorded', {
          sync_id: metrics.sync_id,
          user_id: metrics.user_id,
          total_predictions: metrics.total_predictions,
          claimable_predictions: metrics.claimable_predictions
        });
      }
    } catch (error) {
      logger.error('Error in recordDetectionAccuracy', { error, metrics });
      // Don't throw - monitoring failures shouldn't break detection
    }
  }

  /**
   * Get performance metrics for a user or globally
   */
  async getPerformanceMetrics(userId?: string, days: number = 30): Promise<PerformanceMetrics> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      let query = supabase
        .from(this.metricsTable)
        .select('*')
        .gte('completed_at', cutoffDate.toISOString())
        .eq('sync_status', 'completed');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching performance metrics', { error, userId });
        return this.getDefaultPerformanceMetrics();
      }

      if (!data || data.length === 0) {
        return this.getDefaultPerformanceMetrics();
      }

      const metrics = data as any[];

      // Calculate averages
      const totalSyncs = metrics.length;
      const successfulSyncs = metrics.filter(m => m.sync_status === 'completed').length;
      const successfulApiCalls = metrics.filter(m => m.detection_api_success).length;

      const averageSyncDuration = metrics.reduce((sum, m) => sum + (m.duration_ms || 0), 0) / totalSyncs;
      const averageApiResponseTime = metrics
        .filter(m => m.detection_api_response_time_ms > 0)
        .reduce((sum, m) => sum + (m.detection_api_response_time_ms || 0), 0) / 
        metrics.filter(m => m.detection_api_response_time_ms > 0).length || 1;

      const totalClaims = metrics.reduce((sum, m) => sum + (m.claims_detected || 0), 0);
      const totalClaimValue = metrics.reduce((sum, m) => sum + (m.total_claim_value || 0), 0);
      const totalHighConfidence = metrics.reduce((sum, m) => sum + (m.high_confidence_claims || 0), 0);

      return {
        average_sync_duration_ms: Math.round(averageSyncDuration),
        average_detection_api_response_time_ms: Math.round(averageApiResponseTime || 0),
        sync_success_rate: (successfulSyncs / totalSyncs) * 100,
        detection_api_success_rate: (successfulApiCalls / totalSyncs) * 100,
        average_claims_per_sync: totalClaims / totalSyncs,
        average_claim_value_per_sync: totalClaimValue / totalSyncs,
        high_confidence_claim_rate: totalClaims > 0 ? (totalHighConfidence / totalClaims) * 100 : 0
      };
    } catch (error) {
      logger.error('Error in getPerformanceMetrics', { error, userId });
      return this.getDefaultPerformanceMetrics();
    }
  }

  /**
   * Get detection accuracy metrics for a user or globally
   */
  async getDetectionAccuracyMetrics(userId?: string, days: number = 30): Promise<DetectionAccuracyMetrics[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      let query = supabase
        .from(this.accuracyTable)
        .select('*')
        .gte('created_at', cutoffDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching detection accuracy metrics', { error, userId });
        return [];
      }

      return (data || []) as DetectionAccuracyMetrics[];
    } catch (error) {
      logger.error('Error in getDetectionAccuracyMetrics', { error, userId });
      return [];
    }
  }

  /**
   * Get sync metrics for a specific sync
   */
  async getSyncMetrics(syncId: string): Promise<SyncMetrics | null> {
    try {
      const { data, error } = await supabase
        .from(this.metricsTable)
        .select('*')
        .eq('sync_id', syncId)
        .single();

      if (error || !data) {
        logger.warn('Sync metrics not found', { syncId, error });
        return null;
      }

      return data as SyncMetrics;
    } catch (error) {
      logger.error('Error in getSyncMetrics', { error, syncId });
      return null;
    }
  }

  /**
   * Get default performance metrics when no data is available
   */
  private getDefaultPerformanceMetrics(): PerformanceMetrics {
    return {
      average_sync_duration_ms: 0,
      average_detection_api_response_time_ms: 0,
      sync_success_rate: 0,
      detection_api_success_rate: 0,
      average_claims_per_sync: 0,
      average_claim_value_per_sync: 0,
      high_confidence_claim_rate: 0
    };
  }

  /**
   * Record API call metrics (response time, success/failure)
   */
  async recordApiCallMetrics(
    syncId: string,
    userId: string,
    apiName: string,
    responseTimeMs: number,
    success: boolean,
    error?: string
  ): Promise<void> {
    try {
      // Store in a separate table or add to sync_metrics
      logger.info('API call metrics recorded', {
        sync_id: syncId,
        user_id: userId,
        api_name: apiName,
        response_time_ms: responseTimeMs,
        success,
        error
      });

      // You can extend this to store in a dedicated api_metrics table if needed
    } catch (error) {
      logger.error('Error recording API call metrics', { error });
      // Don't throw - monitoring failures shouldn't break the flow
    }
  }
}

export const syncMonitoringService = new SyncMonitoringService();
export default syncMonitoringService;

