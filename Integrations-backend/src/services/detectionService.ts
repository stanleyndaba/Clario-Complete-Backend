import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { getRedisClient } from '../utils/redisClient';
import axios from 'axios';

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
  private readonly pythonApiUrl = process.env.PYTHON_API_URL || 'https://opside-python-api.onrender.com';

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
      await redisClient.lPush(this.queueName, JSON.stringify(job));

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
        const jobData = await redisClient.brPop(this.queueName, 1);
        
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
      // await this.triggerEvidenceMatching // TODO: Implement this method(job.seller_id);
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
   * This is Phase 2: Autonomous Money Discovery - scans orders and detects claims
   */
  private async runDetectionAlgorithms(job: DetectionJob): Promise<DetectionResult[]> {
    try {
      logger.info('Running detection algorithms (Phase 2: Autonomous Money Discovery)', {
        seller_id: job.seller_id,
        sync_id: job.sync_id
      });

      const results: DetectionResult[] = [];

      // Step 1: Get financial events from database (synced from SP-API)
      const financialEvents = await this.getFinancialEventsForUser(job.seller_id);
      
      logger.info('Found financial events for claim detection', {
        seller_id: job.seller_id,
        event_count: financialEvents.length
      });

      // Step 2: Get inventory discrepancies from database
      const inventoryDiscrepancies = await this.getInventoryDiscrepancies(job.seller_id);

      logger.info('Found inventory discrepancies for claim detection', {
        seller_id: job.seller_id,
        discrepancy_count: inventoryDiscrepancies.length
      });

      // Step 3: Transform data into claim detection format and call Claim Detector API
      const claimsToDetect = this.prepareClaimsForDetection(financialEvents, inventoryDiscrepancies);

      if (claimsToDetect.length === 0) {
        logger.info('No claims to detect', { seller_id: job.seller_id });
        return results;
      }

      logger.info('Calling Claim Detector API', {
        seller_id: job.seller_id,
        claim_count: claimsToDetect.length
      });

      // Step 4: Call Claim Detector API (batch detection)
      try {
        const detectionResponse = await axios.post(
          `${this.pythonApiUrl}/api/v1/claim-detector/predict/batch`,
          { claims: claimsToDetect },
          {
            timeout: 60000, // 60 second timeout for batch processing
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        const detectedClaims = detectionResponse.data?.results || detectionResponse.data?.claims || [];
        
        logger.info('Claim Detector API response', {
          seller_id: job.seller_id,
          detected_count: detectedClaims.length,
          total_processed: claimsToDetect.length
        });

        // Step 5: Transform Claim Detector results into DetectionResult format
        for (const detectedClaim of detectedClaims) {
          if (detectedClaim.claimable && detectedClaim.probability >= 0.5) {
            // Map claim detector response to detection result
            const detectionResult = this.mapClaimToDetectionResult(
              detectedClaim,
              job.seller_id,
              job.sync_id
            );
            results.push(detectionResult);
          }
        }

        logger.info('Detection algorithms completed', {
          seller_id: job.seller_id,
          sync_id: job.sync_id,
          results_count: results.length,
          high_confidence: results.filter(r => r.confidence_score >= 0.85).length,
          medium_confidence: results.filter(r => r.confidence_score >= 0.50 && r.confidence_score < 0.85).length,
          low_confidence: results.filter(r => r.confidence_score < 0.50).length
        });

      } catch (error: any) {
        logger.error('Error calling Claim Detector API', {
          error: error.message,
          response: error.response?.data,
          seller_id: job.seller_id
        });
        
        // Fallback: Create basic detection results from financial events if API fails
        logger.warn('Falling back to basic detection from financial events');
        for (const event of financialEvents) {
          if (event.amount && event.amount > 0) {
            const basicResult = this.createBasicDetectionResult(event, job.seller_id, job.sync_id);
            results.push(basicResult);
          }
        }
      }

      return results;
    } catch (error) {
      logger.error('Error running detection algorithms', { error, job });
      throw error;
    }
  }

  /**
   * Get financial events from database for claim detection
   */
  private async getFinancialEventsForUser(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('financial_events')
        .select('*')
        .eq('seller_id', userId)
        .order('event_date', { ascending: false })
        .limit(1000); // Limit to recent 1000 events

      if (error) {
        logger.error('Error fetching financial events', { error, userId });
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error in getFinancialEventsForUser', { error, userId });
      return [];
    }
  }

  /**
   * Get inventory discrepancies from database
   */
  private async getInventoryDiscrepancies(userId: string): Promise<any[]> {
    try {
      // Get inventory items with quantity discrepancies
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('user_id', userId)
        .not('quantity_available', 'is', null)
        .limit(500);

      if (error) {
        logger.error('Error fetching inventory discrepancies', { error, userId });
        return [];
      }

      // Filter for potential discrepancies (could be enhanced with more logic)
      return (data || []).filter((item: any) => {
        // Check for potential lost/damaged inventory
        return item.dimensions?.damaged > 0 || 
               (item.quantity_available === 0 && item.quantity_reserved > 0);
      });
    } catch (error) {
      logger.error('Error in getInventoryDiscrepancies', { error, userId });
      return [];
    }
  }

  /**
   * Prepare claims data for Claim Detector API
   */
  private prepareClaimsForDetection(financialEvents: any[], inventoryDiscrepancies: any[]): any[] {
    const claims: any[] = [];

    // Process financial events as potential fee overcharges or missing reimbursements
    for (const event of financialEvents) {
      if (event.event_type === 'fee' || event.event_type === 'adjustment') {
        claims.push({
          claim_id: `claim_${event.id}_${Date.now()}`,
          seller_id: event.seller_id,
          order_id: event.amazon_order_id || event.event_id,
          category: 'fee_error',
          subcategory: event.event_type,
          reason_code: 'INCORRECT_FEE',
          marketplace: event.marketplace || 'US',
          fulfillment_center: event.fulfillment_center || 'UNKNOWN',
          amount: Math.abs(event.amount || 0),
          quantity: 1,
          order_value: event.amount || 0,
          shipping_cost: 0,
          days_since_order: event.event_date ? 
            Math.floor((Date.now() - new Date(event.event_date).getTime()) / (1000 * 60 * 60 * 24)) : 0,
          days_since_delivery: 0,
          description: `Potential ${event.event_type} discrepancy`,
          reason: 'Automated detection from financial events',
          claim_date: new Date().toISOString(),
          evidence: event.raw_payload || {}
        });
      }
    }

    // Process inventory discrepancies as lost/damaged inventory claims
    for (const item of inventoryDiscrepancies) {
      if (item.dimensions?.damaged > 0) {
        claims.push({
          claim_id: `claim_inv_${item.id}_${Date.now()}`,
          seller_id: item.user_id,
          order_id: item.sku,
          category: 'inventory_loss',
          subcategory: 'damaged_goods',
          reason_code: 'DAMAGED_INVENTORY',
          marketplace: 'US',
          fulfillment_center: item.dimensions?.location || 'UNKNOWN',
          amount: item.dimensions?.damaged * 10 || 0, // Estimated value
          quantity: item.dimensions?.damaged || 0,
          order_value: item.dimensions?.damaged * 10 || 0,
          shipping_cost: 0,
          days_since_order: 0,
          days_since_delivery: 0,
          description: `Damaged inventory detected for SKU ${item.sku}`,
          reason: 'Automated detection from inventory sync',
          claim_date: new Date().toISOString(),
          evidence: item.dimensions || {}
        });
      }
    }

    return claims;
  }

  /**
   * Map Claim Detector API response to DetectionResult
   */
  private mapClaimToDetectionResult(
    detectedClaim: any,
    sellerId: string,
    syncId: string
  ): DetectionResult {
    // Map claim type to anomaly type
    const anomalyTypeMap: Record<string, DetectionResult['anomaly_type']> = {
      'fee_error': 'incorrect_fee',
      'inventory_loss': 'missing_unit',
      'damaged_goods': 'damaged_stock',
      'overcharge': 'overcharge',
      'duplicate': 'duplicate_charge'
    };

    const anomalyType = anomalyTypeMap[detectedClaim.category] || 'missing_unit';

    // Map confidence to severity
    let severity: DetectionResult['severity'] = 'low';
    if (detectedClaim.probability >= 0.85) severity = 'critical';
    else if (detectedClaim.probability >= 0.70) severity = 'high';
    else if (detectedClaim.probability >= 0.50) severity = 'medium';

    return {
      seller_id: sellerId,
      sync_id: syncId,
      anomaly_type: anomalyType,
      severity,
      estimated_value: detectedClaim.amount || 0,
      currency: detectedClaim.currency || 'USD',
      confidence_score: detectedClaim.probability || detectedClaim.confidence || 0.5,
      evidence: {
        claim_id: detectedClaim.claim_id,
        order_id: detectedClaim.order_id,
        category: detectedClaim.category,
        ...detectedClaim.evidence
      },
      related_event_ids: [detectedClaim.order_id]
    };
  }

  /**
   * Create basic detection result from financial event (fallback when API fails)
   */
  private createBasicDetectionResult(event: any, sellerId: string, syncId: string): DetectionResult {
    return {
      seller_id: sellerId,
      sync_id: syncId,
      anomaly_type: event.event_type === 'fee' ? 'incorrect_fee' : 'missing_unit',
      severity: 'medium',
      estimated_value: Math.abs(event.amount || 0),
      currency: event.currency || 'USD',
      confidence_score: 0.65, // Default medium confidence
      evidence: {
        event_id: event.id,
        event_type: event.event_type,
        ...event.raw_payload
      },
      related_event_ids: [event.amazon_event_id || event.id]
    };
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





