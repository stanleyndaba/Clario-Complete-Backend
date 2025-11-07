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
  discovery_date?: Date; // When the discrepancy was discovered
  deadline_date?: Date; // 60 days from discovery date (Amazon claim deadline)
  days_remaining?: number; // Days until deadline
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
  discovery_date?: string;
  deadline_date?: string;
  days_remaining?: number;
  expiration_alert_sent?: boolean;
  expired?: boolean;
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
   * Calculate 60-day deadline from discovery date (Amazon claim deadline)
   */
  private calculateDeadline(discoveryDate: Date): { deadlineDate: Date; daysRemaining: number } {
    const deadlineDate = new Date(discoveryDate);
    deadlineDate.setDate(deadlineDate.getDate() + 60); // Add 60 days
    
    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    
    return { deadlineDate, daysRemaining };
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

    // Calculate discovery date (use claim_date from API or current date)
    const discoveryDate = detectedClaim.claim_date ? 
      new Date(detectedClaim.claim_date) : 
      new Date();
    
    // Calculate 60-day deadline
    const { deadlineDate, daysRemaining } = this.calculateDeadline(discoveryDate);

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
      related_event_ids: [detectedClaim.order_id],
      discovery_date: discoveryDate,
      deadline_date: deadlineDate,
      days_remaining: daysRemaining
    };
  }

  /**
   * Create basic detection result from financial event (fallback when API fails)
   */
  private createBasicDetectionResult(event: any, sellerId: string, syncId: string): DetectionResult {
    // Use event date as discovery date, or current date if not available
    const discoveryDate = event.event_date ? new Date(event.event_date) : new Date();
    const { deadlineDate, daysRemaining } = this.calculateDeadline(discoveryDate);

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
      related_event_ids: [event.amazon_event_id || event.id],
      discovery_date: discoveryDate,
      deadline_date: deadlineDate,
      days_remaining: daysRemaining
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
          results.map(result => {
            // Recalculate days remaining before storing (in case time passed)
            const { deadlineDate, daysRemaining } = result.deadline_date && result.discovery_date ?
              this.calculateDeadline(new Date(result.discovery_date)) :
              result.deadline_date ? 
                { deadlineDate: new Date(result.deadline_date), daysRemaining: result.days_remaining || 0 } :
                { deadlineDate: null, daysRemaining: null };

            return {
              seller_id: result.seller_id,
              sync_id: result.sync_id,
              anomaly_type: result.anomaly_type,
              severity: result.severity,
              estimated_value: result.estimated_value,
              currency: result.currency,
              confidence_score: result.confidence_score,
              evidence: result.evidence,
              related_event_ids: result.related_event_ids || [],
              discovery_date: result.discovery_date ? new Date(result.discovery_date).toISOString() : new Date().toISOString(),
              deadline_date: deadlineDate ? deadlineDate.toISOString() : null,
              days_remaining: daysRemaining,
              expired: daysRemaining !== null && daysRemaining === 0,
              expiration_alert_sent: false
            };
          })
        );

      if (error) {
        logger.error('Error storing detection results', { error });
        throw new Error(`Failed to store detection results: ${error.message}`);
      }

      logger.info('Detection results stored successfully', {
        count: results.length,
        with_deadlines: results.filter(r => r.deadline_date).length
      });

      // Check for expiring claims and send alerts
      await this.checkExpiringClaims(results.map(r => r.seller_id));
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
    expiring_soon: number;
    expired_count: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('detection_results')
        .select('anomaly_type, severity, estimated_value, days_remaining, expired')
        .eq('seller_id', sellerId);

      if (error) {
        logger.error('Error fetching detection statistics', { error, sellerId });
        throw new Error(`Failed to fetch detection statistics: ${error.message}`);
      }

      const results = data as { anomaly_type: string; severity: string; estimated_value: number; days_remaining?: number; expired?: boolean }[];
      const by_severity: Record<string, { count: number; value: number }> = {};
      const by_type: Record<string, { count: number; value: number }> = {};
      let total_value = 0;
      let expiring_soon = 0;
      let expired_count = 0;

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

        // Count expiring and expired
        if (result.days_remaining !== null && result.days_remaining <= 7 && result.days_remaining > 0) {
          expiring_soon++;
        }
        if (result.expired) {
          expired_count++;
        }
      });

      return {
        total_anomalies: results.length,
        total_value,
        by_severity,
        by_type,
        expiring_soon,
        expired_count
      };
    } catch (error) {
      logger.error('Error in getDetectionStatistics', { error, sellerId });
      throw error;
    }
  }

  /**
   * Check for expiring claims and send alerts
   */
  async checkExpiringClaims(sellerIds: string[]): Promise<void> {
    try {
      const uniqueSellerIds = [...new Set(sellerIds)];
      
      for (const sellerId of uniqueSellerIds) {
        // Get claims expiring in 7 days or less
        const { data: expiringClaims, error } = await supabase
          .from('detection_results')
          .select('*')
          .eq('seller_id', sellerId)
          .eq('expiration_alert_sent', false)
          .eq('expired', false)
          .not('deadline_date', 'is', null)
          .lte('days_remaining', 7)
          .gte('days_remaining', 0)
          .in('status', ['pending', 'reviewed']);

        if (error) {
          logger.error('Error checking expiring claims', { error, sellerId });
          continue;
        }

        if (!expiringClaims || expiringClaims.length === 0) {
          continue;
        }

        logger.info('Found expiring claims', {
          seller_id: sellerId,
          count: expiringClaims.length
        });

        // Send alerts for each expiring claim
        for (const claim of expiringClaims) {
          await this.sendExpirationAlert(sellerId, claim);
        }
      }
    } catch (error) {
      logger.error('Error in checkExpiringClaims', { error });
    }
  }

  /**
   * Send expiration alert for a claim
   */
  private async sendExpirationAlert(sellerId: string, claim: any): Promise<void> {
    try {
      const daysRemaining = claim.days_remaining || 0;
      const urgency = daysRemaining <= 3 ? 'critical' : daysRemaining <= 7 ? 'high' : 'medium';

      // Send SSE event for real-time alert
      const sseHub = (await import('../utils/sseHub')).default;
      sseHub.sendEvent(sellerId, 'claim_expiring', {
        claim_id: claim.id,
        anomaly_type: claim.anomaly_type,
        estimated_value: claim.estimated_value,
        currency: claim.currency,
        days_remaining: daysRemaining,
        deadline_date: claim.deadline_date,
        urgency,
        message: daysRemaining === 0 
          ? `Claim deadline expired! Claim ${claim.id} can no longer be filed.`
          : `Claim expires in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}. File soon to avoid missing the deadline.`
      });

      // Mark alert as sent
      await supabase
        .from('detection_results')
        .update({ expiration_alert_sent: true })
        .eq('id', claim.id);

      logger.info('Expiration alert sent', {
        seller_id: sellerId,
        claim_id: claim.id,
        days_remaining: daysRemaining
      });
    } catch (error) {
      logger.error('Error sending expiration alert', { error, sellerId, claimId: claim.id });
    }
  }

  /**
   * Get claims approaching deadline
   */
  async getClaimsApproachingDeadline(sellerId: string, daysThreshold: number = 7): Promise<DetectionResultRecord[]> {
    try {
      const { data, error } = await supabase
        .from('detection_results')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('expired', false)
        .not('deadline_date', 'is', null)
        .lte('days_remaining', daysThreshold)
        .gte('days_remaining', 0)
        .in('status', ['pending', 'reviewed'])
        .order('days_remaining', { ascending: true })
        .order('severity', { ascending: false });

      if (error) {
        logger.error('Error fetching claims approaching deadline', { error, sellerId });
        throw new Error(`Failed to fetch claims approaching deadline: ${error.message}`);
      }

      return (data || []) as DetectionResultRecord[];
    } catch (error) {
      logger.error('Error in getClaimsApproachingDeadline', { error, sellerId });
      throw error;
    }
  }

  /**
   * Resolve a detection result (mark as resolved)
   */
  async resolveDetectionResult(
    sellerId: string,
    detectionId: string,
    notes?: string,
    resolutionAmount?: number
  ): Promise<DetectionResultRecord> {
    try {
      // First verify the detection result belongs to the seller
      const { data: detection, error: fetchError } = await supabase
        .from('detection_results')
        .select('*')
        .eq('id', detectionId)
        .eq('seller_id', sellerId)
        .single();

      if (fetchError || !detection) {
        throw new Error('Detection result not found');
      }

      // Update status to resolved
      const updateData: any = {
        status: 'resolved',
        updated_at: new Date().toISOString()
      };

      if (notes) {
        updateData.evidence = {
          ...(detection.evidence || {}),
          resolution_notes: notes,
          resolved_at: new Date().toISOString()
        };
      }

      if (resolutionAmount !== undefined) {
        updateData.evidence = {
          ...(updateData.evidence || detection.evidence || {}),
          resolution_amount: resolutionAmount
        };
      }

      const { data: updatedDetection, error: updateError } = await supabase
        .from('detection_results')
        .update(updateData)
        .eq('id', detectionId)
        .eq('seller_id', sellerId)
        .select()
        .single();

      if (updateError) {
        logger.error('Error resolving detection result', { error: updateError, detectionId, sellerId });
        throw new Error(`Failed to resolve detection result: ${updateError.message}`);
      }

      logger.info('Detection result resolved successfully', {
        detection_id: detectionId,
        seller_id: sellerId,
        notes: !!notes,
        resolution_amount: resolutionAmount
      });

      // Send SSE event for resolution
      const sseHub = (await import('../utils/sseHub')).default;
      sseHub.sendEvent(sellerId, 'detection_resolved', {
        detection_id: detectionId,
        previous_status: detection.status,
        new_status: 'resolved',
        estimated_value: detection.estimated_value,
        resolution_amount: resolutionAmount,
        message: `Detection result ${detectionId} has been resolved.`,
        timestamp: new Date().toISOString()
      });

      return updatedDetection as DetectionResultRecord;
    } catch (error) {
      logger.error('Error in resolveDetectionResult', { error, detectionId, sellerId });
      throw error;
    }
  }

  /**
   * Update detection result status (generic status update)
   */
  async updateDetectionResultStatus(
    sellerId: string,
    detectionId: string,
    status: 'pending' | 'reviewed' | 'disputed' | 'resolved',
    notes?: string
  ): Promise<DetectionResultRecord> {
    try {
      // First verify the detection result belongs to the seller
      const { data: detection, error: fetchError } = await supabase
        .from('detection_results')
        .select('*')
        .eq('id', detectionId)
        .eq('seller_id', sellerId)
        .single();

      if (fetchError || !detection) {
        throw new Error('Detection result not found');
      }

      // Update status
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (notes) {
        updateData.evidence = {
          ...(detection.evidence || {}),
          status_notes: notes,
          status_updated_at: new Date().toISOString()
        };
      }

      const { data: updatedDetection, error: updateError } = await supabase
        .from('detection_results')
        .update(updateData)
        .eq('id', detectionId)
        .eq('seller_id', sellerId)
        .select()
        .single();

      if (updateError) {
        logger.error('Error updating detection result status', { error: updateError, detectionId, sellerId, status });
        throw new Error(`Failed to update detection result status: ${updateError.message}`);
      }

      logger.info('Detection result status updated successfully', {
        detection_id: detectionId,
        seller_id: sellerId,
        previous_status: detection.status,
        new_status: status
      });

      // Send SSE event for status change
      const sseHub = (await import('../utils/sseHub')).default;
      sseHub.sendEvent(sellerId, 'detection_status_changed', {
        detection_id: detectionId,
        previous_status: detection.status,
        new_status: status,
        message: `Detection result ${detectionId} status changed from ${detection.status} to ${status}.`,
        timestamp: new Date().toISOString()
      });

      return updatedDetection as DetectionResultRecord;
    } catch (error) {
      logger.error('Error in updateDetectionResultStatus', { error, detectionId, sellerId, status });
      throw error;
    }
  }

  /**
   * Update expired claims (mark as expired when deadline passes)
   */
  async updateExpiredClaims(): Promise<number> {
    try {
      // Update claims where deadline has passed
      const { data: expiredClaims, error: fetchError } = await supabase
        .from('detection_results')
        .select('id, seller_id')
        .eq('expired', false)
        .not('deadline_date', 'is', null)
        .lte('deadline_date', new Date().toISOString())
        .in('status', ['pending', 'reviewed']);

      if (fetchError) {
        logger.error('Error fetching expired claims', { error: fetchError });
        return 0;
      }

      if (!expiredClaims || expiredClaims.length === 0) {
        return 0;
      }

      // Mark as expired
      const claimIds = expiredClaims.map(c => c.id);
      const { error: updateError } = await supabase
        .from('detection_results')
        .update({ 
          expired: true,
          days_remaining: 0,
          updated_at: new Date().toISOString()
        })
        .in('id', claimIds);

      if (updateError) {
        logger.error('Error updating expired claims', { error: updateError });
        return 0;
      }

      // Send expiration notifications via SSE
      const sseHub = (await import('../utils/sseHub')).default;
      for (const claim of expiredClaims) {
        sseHub.sendEvent(claim.seller_id, 'claim_expired', {
          claim_id: claim.id,
          message: 'Claim deadline has expired. This claim can no longer be filed with Amazon.'
        });
      }

      logger.info('Updated expired claims', { count: expiredClaims.length });
      return expiredClaims.length;
    } catch (error) {
      logger.error('Error in updateExpiredClaims', { error });
      return 0;
    }
  }
}

export const detectionService = new DetectionService();
export default detectionService;





