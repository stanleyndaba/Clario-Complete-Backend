import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { getRedisClient } from '../utils/redisClient';
import { v4 as uuidv4 } from 'uuid';

export interface DetectionJob {
  id: string;
  seller_id: string;
  sync_id: string;
  trigger_type: 'inventory' | 'financial' | 'product' | 'manual';
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  payload: any;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface DetectionResult {
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
  related_event_ids?: string[];
  threshold_applied?: any;
  whitelist_checked?: any;
  dedupe_hash: string;
  created_at: string;
  updated_at: string;
}

export interface DetectionThreshold {
  id: string;
  seller_id?: string;
  rule_type: string;
  threshold_value: number;
  threshold_operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  currency: string;
  is_active: boolean;
}

export interface DetectionWhitelist {
  id: string;
  seller_id: string;
  whitelist_type: 'sku' | 'asin' | 'vendor' | 'shipment' | 'order';
  whitelist_value: string;
  reason?: string;
  is_active: boolean;
}

export interface DisputeCase {
  id: string;
  seller_id: string;
  detection_result_id: string;
  case_number: string;
  status: 'pending' | 'submitted' | 'approved' | 'rejected' | 'closed';
  claim_amount: number;
  currency: string;
  case_type: 'amazon_fba' | 'stripe_dispute' | 'shopify_refund';
  provider: 'amazon' | 'stripe' | 'shopify';
  submission_date?: string;
  resolution_date?: string;
  resolution_amount?: number;
  resolution_notes?: string;
  evidence_attachments: any;
  provider_case_id?: string;
  provider_response: any;
  created_at: string;
  updated_at: string;
}

export interface SyncDetectionTrigger {
  id: string;
  sync_id: string;
  seller_id: string;
  trigger_type: 'inventory' | 'financial' | 'product' | 'manual';
  detection_job_id?: string;
  status: 'triggered' | 'detection_queued' | 'detection_completed' | 'dispute_created';
  metadata: any;
  created_at: string;
  updated_at: string;
}

export class EnhancedDetectionService {
  private readonly queueName = 'enhanced_detection_queue';
  private readonly maxConcurrency = parseInt(process.env.DETECTION_WORKER_CONCURRENCY || '5');
  private readonly backpressureThreshold = parseInt(process.env.DETECTION_QUEUE_BACKPRESSURE_THRESHOLD || '20');
  private readonly maxRetries = parseInt(process.env.DETECTION_WORKER_MAX_RETRIES || '3');

  /**
   * Trigger detection pipeline after sync completion
   */
  async triggerDetectionPipeline(
    sellerId: string,
    syncId: string,
    triggerType: 'inventory' | 'financial' | 'product' | 'manual',
    metadata?: any
  ): Promise<void> {
    try {
      logger.info('Triggering detection pipeline', {
        seller_id: sellerId,
        sync_id: syncId,
        trigger_type: triggerType
      });

      // Create sync detection trigger record
      const triggerId = uuidv4();
      const { error: triggerError } = await supabase
        .from('sync_detection_triggers')
        .insert({
          id: triggerId,
          sync_id: syncId,
          seller_id: sellerId,
          trigger_type: triggerType,
          status: 'triggered',
          metadata: metadata || {}
        });

      if (triggerError) {
        logger.error('Error creating sync detection trigger', { error: triggerError, sellerId, syncId });
        throw new Error(`Failed to create sync detection trigger: ${triggerError.message}`);
      }

      // Enqueue detection job
      await this.enqueueDetectionJob({
        id: uuidv4(),
        seller_id: sellerId,
        sync_id: syncId,
        trigger_type: triggerType,
        priority: this.determinePriority(triggerType),
        status: 'pending',
        attempts: 0,
        max_attempts: this.maxRetries,
        payload: { triggerId, metadata },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // Update trigger status
      await this.updateTriggerStatus(triggerId, 'detection_queued');

      logger.info('Detection pipeline triggered successfully', {
        seller_id: sellerId,
        sync_id: syncId,
        trigger_id: triggerId
      });
    } catch (error) {
      logger.error('Error triggering detection pipeline', { error, sellerId, syncId });
      throw error;
    }
  }

  /**
   * Enqueue a detection job with priority and backpressure handling
   */
  async enqueueDetectionJob(job: DetectionJob): Promise<void> {
    try {
      logger.info('Enqueueing detection job', {
        job_id: job.id,
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        priority: job.priority
      });

      // Check backpressure
      const queueLength = await this.getQueueLength();
      if (queueLength > this.backpressureThreshold) {
        if (job.priority === 'low') {
          logger.warn('Backpressure threshold exceeded, skipping low priority job', {
            job_id: job.id,
            queue_length: queueLength,
            threshold: this.backpressureThreshold
          });
          return;
        }
        logger.info('Backpressure threshold exceeded, processing high priority job', {
          job_id: job.id,
          priority: job.priority,
          queue_length: queueLength
        });
      }

      // Add to Redis queue for immediate processing
      const redisClient = await getRedisClient();
      const priorityScore = this.getPriorityScore(job.priority);
      await redisClient.zadd(this.queueName, priorityScore, JSON.stringify(job));

      // Store in database for persistence
      const { error } = await supabase
        .from('detection_queue')
        .insert({
          id: job.id,
          seller_id: job.seller_id,
          sync_id: job.sync_id,
          status: job.status,
          priority: priorityScore,
          attempts: job.attempts,
          max_attempts: job.max_attempts,
          payload: job.payload
        });

      if (error) {
        logger.error('Error storing detection job in database', { error, job });
        // Don't throw error as Redis queue is the primary mechanism
      }

      logger.info('Detection job enqueued successfully', {
        job_id: job.id,
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        priority: job.priority
      });
    } catch (error) {
      logger.error('Error enqueueing detection job', { error, job });
      throw error;
    }
  }

  /**
   * Process detection jobs with enhanced logic and dispute integration
   */
  async processDetectionJobs(): Promise<void> {
    try {
      const redisClient = await getRedisClient();
      
      // Process jobs with priority ordering
      while (true) {
        const jobData = await redisClient.zpopmax(this.queueName, 1);
        
        if (!jobData || jobData.length === 0) {
          break;
        }

        const job: DetectionJob = JSON.parse(jobData[0].member);
        
        try {
          logger.info('Processing detection job', {
            job_id: job.id,
            seller_id: job.seller_id,
            sync_id: job.sync_id,
            priority: job.priority
          });

          // Update job status to processing
          await this.updateJobStatus(job.id, 'processing');

          // Run enhanced detection algorithms
          const results = await this.runEnhancedDetectionAlgorithms(job);

          // Store detection results
          await this.storeDetectionResults(results);

          // Create dispute cases for high-severity anomalies
          await this.createDisputeCases(results);

          // Update job status to completed
          await this.updateJobStatus(job.id, 'completed');

          // Update trigger status
          await this.updateTriggerStatusBySyncId(job.sync_id, 'detection_completed');

          logger.info('Detection job completed successfully', {
            job_id: job.id,
            seller_id: job.seller_id,
            sync_id: job.sync_id,
            results_count: results.length
          });
        } catch (error) {
          logger.error('Error processing detection job', { error, job });
          
          // Handle retries
          if (job.attempts < job.max_attempts) {
            const newAttempts = job.attempts + 1;
            const backoffDelay = Math.pow(2, newAttempts) * 1000; // Exponential backoff
            
            logger.info('Retrying detection job', {
              job_id: job.id,
              attempts: newAttempts,
              max_attempts: job.max_attempts,
              backoff_delay: backoffDelay
            });

            // Re-enqueue with backoff
            setTimeout(async () => {
              try {
                const retryJob = { ...job, attempts: newAttempts };
                await this.enqueueDetectionJob(retryJob);
              } catch (retryError) {
                logger.error('Error re-enqueueing retry job', { error: retryError, job_id: job.id });
              }
            }, backoffDelay);
          } else {
            // Max retries exceeded, mark as failed
            await this.updateJobStatus(job.id, 'failed', error instanceof Error ? error.message : 'Unknown error');
          }
        }
      }
    } catch (error) {
      logger.error('Error in processDetectionJobs', { error });
      throw error;
    }
  }

  /**
   * Run enhanced detection algorithms with thresholds and whitelist
   */
  private async runEnhancedDetectionAlgorithms(job: DetectionJob): Promise<DetectionResult[]> {
    try {
      logger.info('Running enhanced detection algorithms', {
        job_id: job.id,
        seller_id: job.seller_id,
        sync_id: job.sync_id
      });

      // Fetch thresholds and whitelist
      const thresholds = await this.getDetectionThresholds(job.seller_id);
      const whitelist = await this.getDetectionWhitelist(job.seller_id);

      // Fetch synced data based on trigger type
      const syncedData = await this.fetchSyncedData(job.seller_id, job.sync_id, job.trigger_type);

      const results: DetectionResult[] = [];

      // Run detection rules with thresholds and whitelist
      for (const rule of this.getDetectionRules()) {
        const ruleResults = await this.applyDetectionRule(
          rule,
          syncedData,
          thresholds,
          whitelist,
          job
        );
        results.push(...ruleResults);
      }

      logger.info('Enhanced detection algorithms completed', {
        job_id: job.id,
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        results_count: results.length
      });

      return results;
    } catch (error) {
      logger.error('Error running enhanced detection algorithms', { error, job });
      throw error;
    }
  }

  /**
   * Create dispute cases for high-severity anomalies
   */
  private async createDisputeCases(results: DetectionResult[]): Promise<void> {
    try {
      const highSeverityResults = results.filter(
        result => result.severity === 'high' || result.severity === 'critical'
      );

      for (const result of highSeverityResults) {
        try {
          const disputeCase = await this.createDisputeCase(result);
          logger.info('Dispute case created', {
            dispute_id: disputeCase.id,
            detection_result_id: result.id,
            case_number: disputeCase.case_number
          });
        } catch (error) {
          logger.error('Error creating dispute case', { error, detection_result_id: result.id });
        }
      }
    } catch (error) {
      logger.error('Error creating dispute cases', { error });
    }
  }

  /**
   * Create a dispute case for a detection result
   */
  private async createDisputeCase(result: DetectionResult): Promise<DisputeCase> {
    try {
      const caseNumber = this.generateCaseNumber(result.seller_id, result.anomaly_type);
      const caseType = this.determineCaseType(result.anomaly_type);
      const provider = this.determineProvider(result.anomaly_type);

      const { data, error } = await supabase
        .from('dispute_cases')
        .insert({
          seller_id: result.seller_id,
          detection_result_id: result.id,
          case_number: caseNumber,
          status: 'pending',
          claim_amount: result.estimated_value,
          currency: result.currency,
          case_type: caseType,
          provider: provider,
          evidence_attachments: {
            detection_result: result.id,
            evidence: result.evidence
          }
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create dispute case: ${error.message}`);
      }

      return data as DisputeCase;
    } catch (error) {
      logger.error('Error creating dispute case', { error, result });
      throw error;
    }
  }

  /**
   * Get detection thresholds for a seller
   */
  private async getDetectionThresholds(sellerId: string): Promise<DetectionThreshold[]> {
    try {
      const { data, error } = await supabase
        .from('detection_thresholds')
        .select('*')
        .or(`seller_id.eq.${sellerId},seller_id.is.null`)
        .eq('is_active', true);

      if (error) {
        logger.error('Error fetching detection thresholds', { error, sellerId });
        return [];
      }

      return data as DetectionThreshold[];
    } catch (error) {
      logger.error('Error in getDetectionThresholds', { error, sellerId });
      return [];
    }
  }

  /**
   * Get detection whitelist for a seller
   */
  private async getDetectionWhitelist(sellerId: string): Promise<DetectionWhitelist[]> {
    try {
      const { data, error } = await supabase
        .from('detection_whitelist')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('is_active', true);

      if (error) {
        logger.error('Error fetching detection whitelist', { error, sellerId });
        return [];
      }

      return data as DetectionWhitelist[];
    } catch (error) {
      logger.error('Error in getDetectionWhitelist', { error, sellerId });
      return [];
    }
  }

  /**
   * Fetch synced data based on trigger type
   */
  private async fetchSyncedData(sellerId: string, syncId: string, triggerType: string): Promise<any> {
    try {
      // This is a placeholder - in production, you'd fetch actual synced data
      // based on the trigger type and sync ID
      return {
        seller_id: sellerId,
        sync_id: syncId,
        trigger_type: triggerType,
        data: {} // Placeholder for actual synced data
      };
    } catch (error) {
      logger.error('Error fetching synced data', { error, sellerId, syncId, triggerType });
      throw error;
    }
  }

  /**
   * Get detection rules
   */
  private getDetectionRules(): any[] {
    // Placeholder for detection rules
    // In production, this would return actual rule implementations
    return [
      { name: 'missing_unit', priority: 'high' },
      { name: 'overcharge', priority: 'high' },
      { name: 'damaged_stock', priority: 'medium' },
      { name: 'incorrect_fee', priority: 'medium' },
      { name: 'duplicate_charge', priority: 'low' }
    ];
  }

  /**
   * Apply a detection rule
   */
  private async applyDetectionRule(
    rule: any,
    syncedData: any,
    thresholds: DetectionThreshold[],
    whitelist: DetectionWhitelist[],
    job: DetectionJob
  ): Promise<DetectionResult[]> {
    try {
      // This is a placeholder - in production, you'd implement actual rule logic
      // For now, return mock results
      const mockResult: DetectionResult = {
        id: uuidv4(),
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        anomaly_type: 'missing_unit',
        severity: 'medium',
        estimated_value: 25.99,
        currency: 'USD',
        confidence_score: 0.85,
        evidence: {
          rule_name: rule.name,
          rule_priority: rule.priority,
          synced_data: syncedData
        },
        status: 'pending',
        dedupe_hash: this.generateDedupeHash(job.seller_id, rule.name, syncedData),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      return [mockResult];
    } catch (error) {
      logger.error('Error applying detection rule', { error, rule, job });
      return [];
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
            id: result.id,
            seller_id: result.seller_id,
            sync_id: result.sync_id,
            anomaly_type: result.anomaly_type,
            severity: result.severity,
            estimated_value: result.estimated_value,
            currency: result.currency,
            confidence_score: result.confidence_score,
            evidence: result.evidence,
            status: result.status,
            related_event_ids: result.related_event_ids || [],
            dedupe_hash: result.dedupe_hash
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
    jobId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
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
        .eq('id', jobId);

      if (error) {
        logger.error('Error updating job status', { error, jobId, status });
      }
    } catch (error) {
      logger.error('Error in updateJobStatus', { error, jobId, status });
    }
  }

  /**
   * Update trigger status
   */
  private async updateTriggerStatus(triggerId: string, status: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('sync_detection_triggers')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', triggerId);

      if (error) {
        logger.error('Error updating trigger status', { error, triggerId, status });
      }
    } catch (error) {
      logger.error('Error in updateTriggerStatus', { error, triggerId, status });
    }
  }

  /**
   * Update trigger status by sync ID
   */
  private async updateTriggerStatusBySyncId(syncId: string, status: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('sync_detection_triggers')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('sync_id', syncId);

      if (error) {
        logger.error('Error updating trigger status by sync ID', { error, syncId, status });
      }
    } catch (error) {
      logger.error('Error in updateTriggerStatusBySyncId', { error, syncId, status });
    }
  }

  /**
   * Get queue length for backpressure handling
   */
  private async getQueueLength(): Promise<number> {
    try {
      const redisClient = await getRedisClient();
      return await redisClient.zcard(this.queueName);
    } catch (error) {
      logger.error('Error getting queue length', { error });
      return 0;
    }
  }

  /**
   * Determine job priority based on trigger type
   */
  private determinePriority(triggerType: string): 'low' | 'normal' | 'high' | 'critical' {
    switch (triggerType) {
      case 'financial':
        return 'critical';
      case 'inventory':
        return 'high';
      case 'product':
        return 'normal';
      case 'manual':
        return 'high';
      default:
        return 'normal';
    }
  }

  /**
   * Get priority score for Redis sorted set
   */
  private getPriorityScore(priority: string): number {
    switch (priority) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'normal':
        return 2;
      case 'low':
        return 1;
      default:
        return 2;
    }
  }

  /**
   * Generate case number for dispute cases
   */
  private generateCaseNumber(sellerId: string, anomalyType: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `DC-${sellerId.substr(0, 8)}-${anomalyType.substr(0, 3).toUpperCase()}-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Determine case type based on anomaly type
   */
  private determineCaseType(anomalyType: string): 'amazon_fba' | 'stripe_dispute' | 'shopify_refund' {
    switch (anomalyType) {
      case 'missing_unit':
      case 'damaged_stock':
      case 'overcharge':
        return 'amazon_fba';
      case 'incorrect_fee':
      case 'duplicate_charge':
        return 'stripe_dispute';
      default:
        return 'amazon_fba';
    }
  }

  /**
   * Determine provider based on anomaly type
   */
  private determineProvider(anomalyType: string): 'amazon' | 'stripe' | 'shopify' {
    switch (anomalyType) {
      case 'missing_unit':
      case 'damaged_stock':
      case 'overcharge':
        return 'amazon';
      case 'incorrect_fee':
      case 'duplicate_charge':
        return 'stripe';
      default:
        return 'amazon';
    }
  }

  /**
   * Generate dedupe hash for detection results
   */
  private generateDedupeHash(sellerId: string, ruleName: string, data: any): string {
    const hashInput = `${sellerId}-${ruleName}-${JSON.stringify(data)}`;
    // Simple hash for demo - in production, use crypto.createHash('sha256')
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
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
  ): Promise<DetectionResult[]> {
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

      return data as DetectionResult[];
    } catch (error) {
      logger.error('Error in getDetectionResults', { error, sellerId });
      throw error;
    }
  }

  /**
   * Get dispute cases for a seller
   */
  async getDisputeCases(
    sellerId: string,
    status?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<DisputeCase[]> {
    try {
      let query = supabase
        .from('dispute_cases')
        .select('*')
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching dispute cases', { error, sellerId });
        throw new Error(`Failed to fetch dispute cases: ${error.message}`);
      }

      return data as DisputeCase[];
    } catch (error) {
      logger.error('Error in getDisputeCases', { error, sellerId });
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
    dispute_cases: number;
    total_claimed: number;
  }> {
    try {
      // Get detection results statistics
      const { data: detectionData, error: detectionError } = await supabase
        .from('detection_results')
        .select('anomaly_type, severity, estimated_value')
        .eq('seller_id', sellerId);

      if (detectionError) {
        logger.error('Error fetching detection statistics', { error: detectionError, sellerId });
        throw new Error(`Failed to fetch detection statistics: ${detectionError.message}`);
      }

      // Get dispute cases statistics
      const { data: disputeData, error: disputeError } = await supabase
        .from('dispute_cases')
        .select('claim_amount, status')
        .eq('seller_id', sellerId);

      if (disputeError) {
        logger.error('Error fetching dispute statistics', { error: disputeError, sellerId });
        throw new Error(`Failed to fetch dispute statistics: ${disputeError.message}`);
      }

      const detectionResults = detectionData as { anomaly_type: string; severity: string; estimated_value: number }[];
      const disputeCases = disputeData as { claim_amount: number; status: string }[];

      const by_severity: Record<string, { count: number; value: number }> = {};
      const by_type: Record<string, { count: number; value: number }> = {};
      let total_value = 0;

      detectionResults.forEach(result => {
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

      const total_claimed = disputeCases.reduce((sum, dispute) => sum + dispute.claim_amount, 0);
      const dispute_cases = disputeCases.length;

      return {
        total_anomalies: detectionResults.length,
        total_value,
        by_severity,
        by_type,
        dispute_cases,
        total_claimed
      };
    } catch (error) {
      logger.error('Error in getDetectionStatistics', { error, sellerId });
      throw error;
    }
  }
}

export const enhancedDetectionService = new EnhancedDetectionService();
export default enhancedDetectionService;

