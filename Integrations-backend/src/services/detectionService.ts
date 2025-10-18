import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { getRedisClient } from '../utils/redisClient';

export interface DetectionJob {
  seller_id: string;
  sync_id: string;
  timestamp: string;
}

export interface DetectionResult {
  seller_id: string;
  sync_id: string;
  anomaly_type: 'missing_unit' | 'overcharge' | 'damaged_stock' | 'incorrect_fee' | 'duplicate_charge';
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimated_value: number;
  currency: string;
  confidence_score: number;
  evidence: any;
  related_event_ids?: string[];
}

export interface DetectionResultRecord {
  id: string;
  seller_id: string;
  sync_id: string;
  anomaly_type: 'missing_unit' | 'overcharge' | 'damaged_stock' | 'incorrect_fee' | 'duplicate_charge';
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimated_value: number;
  currency: string;
  confidence_score: number;
  evidence: any;
  status: 'pending' | 'reviewed' | 'disputed' | 'resolved';
  related_event_ids: string[];
  created_at: string;
  updated_at: string;
}

export class DetectionService {
  private readonly queueName = 'detection_queue';

  /**
   * Enqueue a detection job after sync completion
   */
  async enqueueDetectionJob(job: DetectionJob): Promise<void> {
    try {
      logger.info('Enqueueing detection job', {
        seller_id: job.seller_id,
        sync_id: job.sync_id
      });

      // Add to Redis queue for immediate processing
      const redisClient = await getRedisClient();
      await redisClient.lpush(this.queueName, JSON.stringify(job));

      // Also store in database for persistence
      const { error } = await supabase
        .from('detection_queue')
        .insert({
          seller_id: job.seller_id,
          sync_id: job.sync_id,
          status: 'pending',
          priority: 1,
          payload: job
        });

      if (error) {
        logger.error('Error storing detection job in database', { error, job });
        // Don't throw error as Redis queue is the primary mechanism
      }

      logger.info('Detection job enqueued successfully', {
        seller_id: job.seller_id,
        sync_id: job.sync_id
      });
    } catch (error) {
      logger.error('Error enqueueing detection job', { error, job });
      throw error;
    }
  }

  /**
   * Process detection jobs from the queue
   */
  async processDetectionJobs(): Promise<void> {
    try {
      const redisClient = await getRedisClient();
      
      // Process jobs from Redis queue
      while (true) {
        const jobData = await redisClient.brpop(this.queueName, 1);
        
        if (!jobData) {
          // No jobs in queue, exit
          break;
        }

        const job: DetectionJob = JSON.parse(jobData[1]);
        
        try {
          logger.info('Processing detection job', {
            seller_id: job.seller_id,
            sync_id: job.sync_id
          });

          // Update job status to processing
          await this.updateJobStatus(job.seller_id, job.sync_id, 'processing');

          // Run detection algorithms
          const results = await this.runDetectionAlgorithms(job);

          // Store detection results
          await this.storeDetectionResults(results);

          // Update job status to completed
          await this.updateJobStatus(job.seller_id, job.sync_id, 'completed');

          

      // 🎯 STEP 3 → STEP 6: Trigger evidence matching for new claims
      await this.triggerEvidenceMatching(job.seller_id);
        } catch (error) {
          logger.error('Error processing detection job', { error, job });
          
          // Update job status to failed
          await this.updateJobStatus(job.seller_id, job.sync_id, 'failed', error instanceof Error ? error.message : 'Unknown error');
        }
      }
    } catch (error) {
      logger.error('Error in processDetectionJobs', { error });
      throw error;
    }
  }

  /**
   * Run detection algorithms on synced data
   */
  private async runDetectionAlgorithms(job: DetectionJob): Promise<DetectionResult[]> {
    try {
      logger.info('Running detection algorithms', {
        seller_id: job.seller_id,
        sync_id: job.sync_id
      });

      const results: DetectionResult[] = [];

      // TODO: Implement actual detection algorithms
      // For now, return mock results for testing
      
      // Mock detection: Check for missing units
      const missingUnitResult: DetectionResult = {
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        anomaly_type: 'missing_unit',
        severity: 'medium',
        estimated_value: 45.99,
        currency: 'USD',
        confidence_score: 0.85,
        evidence: {
          order_id: 'mock-order-123',
          expected_quantity: 2,
          actual_quantity: 1,
          sku: 'MOCK-SKU-001'
        },
        related_event_ids: ['mock-event-1']
      };

      // Mock detection: Check for overcharges
      const overchargeResult: DetectionResult = {
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        anomaly_type: 'overcharge',
        severity: 'high',
        estimated_value: 12.50,
        currency: 'USD',
        confidence_score: 0.92,
        evidence: {
          fee_type: 'FBA Storage Fee',
          expected_amount: 5.00,
          actual_amount: 17.50,
          period: '2024-01'
        },
        related_event_ids: ['mock-event-2']
      };

      results.push(missingUnitResult, overchargeResult);

      logger.info('Detection algorithms completed', {
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        results_count: results.length
      });

      return results;
    } catch (error) {
      logger.error('Error running detection algorithms', { error, job });
      throw error;
    }
  }

  /**
   * Store detection results in database
   */
  private async storeDetectionResults(results: DetectionResult[]): Promise<void> {
    try {
      const { error } = await supabase
        .from('detection_results')
        .insert(
          results.map(result => ({
            seller_id: result.seller_id,
            sync_id: result.sync_id,
            anomaly_type: result.anomaly_type,
            severity: result.severity,
            estimated_value: result.estimated_value,
            currency: result.currency,
            confidence_score: result.confidence_score,
            evidence: result.evidence,
            related_event_ids: result.related_event_ids || []
          }))
        );

      if (error) {
        logger.error('Error storing detection results', { error });
        throw new Error(`Failed to store detection results: ${error.message}`);
      }

      logger.info('Detection results stored successfully', {
        count: results.length
      });
    } catch (error) {
      logger.error('Error in storeDetectionResults', { error });
      throw error;
    }
  }

  /**
   * Update job status in database
   */
  private async updateJobStatus(
    sellerId: string,
    syncId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        processed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null
      };

      if (status === 'failed' && errorMessage) {
        updateData.error_message = errorMessage;
      }

      if (status === 'processing') {
        updateData.attempts = supabase.sql`attempts + 1`;
      }

      const { error } = await supabase
        .from('detection_queue')
        .update(updateData)
        .eq('seller_id', sellerId)
        .eq('sync_id', syncId);

      if (error) {
        logger.error('Error updating job status', { error, sellerId, syncId, status });
      }
    } catch (error) {
      logger.error('Error in updateJobStatus', { error, sellerId, syncId, status });
    }
  }

  /**
   * Get detection results for a seller
   */
  async getDetectionResults(
    sellerId: string,
    syncId?: string,
    status?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<DetectionResultRecord[]> {
    try {
      let query = supabase
        .from('detection_results')
        .select('*')
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (syncId) {
        query = query.eq('sync_id', syncId);
      }

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching detection results', { error, sellerId });
        throw new Error(`Failed to fetch detection results: ${error.message}`);
      }

      return data as DetectionResultRecord[];
    } catch (error) {
      logger.error('Error in getDetectionResults', { error, sellerId });
      throw error;
    }
  }

  /**
   * Get detection statistics for a seller
   */
  async getDetectionStatistics(sellerId: string): Promise<{
    total_anomalies: number;
    total_value: number;
    by_severity: Record<string, { count: number; value: number }>;
    by_type: Record<string, { count: number; value: number }>;
  }> {
    try {
      const { data, error } = await supabase
        .from('detection_results')
        .select('anomaly_type, severity, estimated_value')
        .eq('seller_id', sellerId);

      if (error) {
        logger.error('Error fetching detection statistics', { error, sellerId });
        throw new Error(`Failed to fetch detection statistics: ${error.message}`);
      }

      const results = data as { anomaly_type: string; severity: string; estimated_value: number }[];
      const by_severity: Record<string, { count: number; value: number }> = {};
      const by_type: Record<string, { count: number; value: number }> = {};
      let total_value = 0;

      results.forEach(result => {
        // By severity
        if (!by_severity[result.severity]) {
          by_severity[result.severity] = { count: 0, value: 0 };
        }
        by_severity[result.severity].count++;
        by_severity[result.severity].value += result.estimated_value;

        // By type
        if (!by_type[result.anomaly_type]) {
          by_type[result.anomaly_type] = { count: 0, value: 0 };
        }
        by_type[result.anomaly_type].count++;
        by_type[result.anomaly_type].value += result.estimated_value;

        total_value += result.estimated_value;
      });

      return {
        total_anomalies: results.length,
        total_value,
        by_severity,
        by_type
      };
    } catch (error) {
      logger.error('Error in getDetectionStatistics', { error, sellerId });
      throw error;
    }
  }
}

export const detectionService = new DetectionService();
export default detectionService;




