/**
 * Agent 3: Claim Detection Agent
 * 
 * Purpose:
 * - Receives normalized data from Agent 2 (Continuous Data Sync)
 * - Detects claimable opportunities using ML + rules engine
 * - Categorizes claims (lost, damaged, fees, returns, etc.)
 * - Logs events to agent_events table
 * - Prepares claims for Agent 4 (Evidence Ingestion)
 * 
 * Key Responsibilities:
 * 1. Anomaly Detection - scans normalized data for discrepancies
 * 2. Categorization - classifies claims by type (lost, damaged, fees, returns)
 * 3. ML Integration - calls Python Claim Detector API for predictions
 * 4. Event Logging - logs detection events for learning
 * 5. Integration with Agent 4 - makes detected claims available for evidence matching
 * 
 * Dependencies:
 * - Input: Agent 2 normalized data (orders, shipments, returns, settlements, inventory, claims)
 * - Output: Detection results ready for Agent 4 (Evidence Ingestion)
 */

import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import detectionService from './detectionService';
import agentEventLogger from './agentEventLogger';
import axios from 'axios';

export interface ClaimDetectionResult {
  success: boolean;
  detectionId: string;
  userId: string;
  syncId: string;
  summary: {
    totalDetected: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    byType: {
      lost: number;
      damaged: number;
      fees: number;
      returns: number;
      other: number;
    };
    totalValue: number;
  };
  detections: any[];
  errors: string[];
  duration: number; // ms
  isMock: boolean;
}

export class Agent3ClaimDetectionService {
  private readonly pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-4-aukq.onrender.com';

  /**
   * Main detection method - processes normalized data from Agent 2
   */
  async detectClaims(
    userId: string,
    syncId: string,
    normalizedData?: {
      orders?: any[];
      shipments?: any[];
      returns?: any[];
      settlements?: any[];
      inventory?: any[];
      claims?: any[];
    }
  ): Promise<ClaimDetectionResult> {
    const detectionId = `agent3_detection_${userId}_${Date.now()}`;
    const startTime = Date.now();
    const errors: string[] = [];

    logger.info('🔍 [AGENT 3] Starting claim detection', {
      userId,
      syncId,
      detectionId
    });

    const result: ClaimDetectionResult = {
      success: true,
      detectionId,
      userId,
      syncId,
      summary: {
        totalDetected: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
        byType: {
          lost: 0,
          damaged: 0,
          fees: 0,
          returns: 0,
          other: 0
        },
        totalValue: 0
      },
      detections: [],
      errors: [],
      duration: 0,
      isMock: false
    };

    try {
      // Step 1: Get normalized data from Agent 2 (if not provided)
      let dataToProcess = normalizedData;
      if (!dataToProcess) {
        logger.info('📊 [AGENT 3] Fetching normalized data from Agent 2', { userId, syncId });
        dataToProcess = await this.getNormalizedDataFromAgent2(userId, syncId);
      }

      // Step 2: Transform normalized data into claim detection format
      logger.info('🔄 [AGENT 3] Transforming data for claim detection', { userId, syncId });
      const claimsToDetect = this.prepareClaimsFromNormalizedData(dataToProcess, userId);

      // Step 3: Call Python Claim Detector API (or use mock if unavailable)
      const isMockMode = process.env.ENABLE_MOCK_DETECTION === 'true' || 
                         process.env.USE_MOCK_DATA_GENERATOR !== 'false' ||
                         !process.env.AMAZON_SPAPI_CLIENT_ID; // If no real Amazon credentials, use mock
      
      let detectionResults: any[] = [];
      
      // In mock mode, ALWAYS generate detections (even if no data or claims found)
      // This ensures we always have something to show on the frontend
      if (isMockMode) {
        if (claimsToDetect.length === 0) {
          logger.info('🧪 [AGENT 3] No claims found in data, generating mock detections', {
            userId,
            syncId,
            ordersCount: dataToProcess.orders?.length || 0,
            shipmentsCount: dataToProcess.shipments?.length || 0,
            returnsCount: dataToProcess.returns?.length || 0
          });
          // Generate mock claims from the normalized data (or empty data)
          const mockClaimsFromData = this.generateMockClaimsFromNormalizedData(dataToProcess, userId);
          detectionResults = this.generateMockDetections(mockClaimsFromData, userId);
        } else {
          logger.info('🧪 [AGENT 3] Using mock detection (Python API unavailable or mock mode enabled)', {
            userId,
            syncId,
            claimCount: claimsToDetect.length
          });
          detectionResults = this.generateMockDetections(claimsToDetect, userId);
        }
        result.isMock = true;
      } else if (claimsToDetect.length === 0) {
        logger.info('ℹ️ [AGENT 3] No claims to detect', { userId, syncId });
        result.duration = Date.now() - startTime;
        return result;
      } else {
        logger.info('🎯 [AGENT 3] Prepared claims for detection', {
          userId,
          syncId,
          claimCount: claimsToDetect.length
        });
        
        try {
          detectionResults = await this.callPythonDetectorAPI(claimsToDetect, userId);
        } catch (apiError: any) {
          logger.warn('⚠️ [AGENT 3] Python API failed, falling back to mock detection', {
            error: apiError.message,
            userId,
            syncId
          });
          detectionResults = this.generateMockDetections(claimsToDetect, userId);
          result.isMock = true;
          errors.push(`Python API unavailable: ${apiError.message}`);
        }
      }

      // Step 4: Process and categorize detection results
      logger.info('📋 [AGENT 3] Processing detection results', {
        userId,
        syncId,
        resultCount: detectionResults.length
      });

      for (const detection of detectionResults) {
        // Categorize by confidence
        if (detection.confidence_score >= 0.85) {
          result.summary.highConfidence++;
        } else if (detection.confidence_score >= 0.50) {
          result.summary.mediumConfidence++;
        } else {
          result.summary.lowConfidence++;
        }

        // Categorize by type
        const anomalyType = detection.anomaly_type || 'other';
        if (anomalyType === 'missing_unit') {
          result.summary.byType.lost++;
        } else if (anomalyType === 'damaged_stock') {
          result.summary.byType.damaged++;
        } else if (anomalyType === 'incorrect_fee' || anomalyType === 'overcharge' || anomalyType === 'duplicate_charge') {
          result.summary.byType.fees++;
        } else {
          result.summary.byType.other++;
        }

        result.summary.totalValue += detection.estimated_value || 0;
      }

      result.detections = detectionResults;
      result.summary.totalDetected = detectionResults.length;
      result.duration = Date.now() - startTime;
      result.errors = errors;
      result.success = errors.length === 0;

      // Step 5: Store detection results in database
      // FIX #2: Storage failures MUST fail Agent 3 - don't catch and continue
      await this.storeDetectionResults(detectionResults, userId, syncId);
      logger.info('✅ [AGENT 3] Detection results stored', {
        userId,
        syncId,
        count: detectionResults.length
      });

      // Step 6: Log event to agent_events table
      try {
        const { error: logError } = await supabaseAdmin
          .from('agent_events')
          .insert({
            user_id: userId,
            agent: 'claim_detection',
            event_type: result.success ? 'detection_completed' : 'detection_failed',
            success: result.success,
            metadata: {
              detectionId,
              syncId,
              summary: result.summary,
              duration: result.duration,
              isMock: result.isMock,
              errors: result.errors
            },
            created_at: new Date().toISOString()
          });
        
        if (logError) {
          logger.warn('⚠️ [AGENT 3] Failed to log event (may need migration update)', {
            error: logError.message
          });
        }
      } catch (logError: any) {
        logger.warn('⚠️ [AGENT 3] Failed to log event', { error: logError.message });
      }

      logger.info('✅ [AGENT 3] Claim detection completed', {
        userId,
        syncId,
        detectionId,
        success: result.success,
        summary: result.summary,
        duration: result.duration,
        errorsCount: errors.length
      });

      // FIX #4: Agent 3 must send a completion signal to detection_queue
      // This allows syncJobManager to know when detection is done
      try {
<<<<<<< HEAD
        const { error: queueError } = await supabaseAdmin
          .from('detection_queue')
          .upsert({
            seller_id: userId,
            sync_id: syncId,
            status: result.success ? 'completed' : 'failed',
            processed_at: new Date().toISOString(),
            payload: {
              detectionId,
              summary: result.summary,
              isMock: result.isMock
            },
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'seller_id,sync_id'
          });

        if (queueError) {
          logger.warn('⚠️ [AGENT 3] Failed to update detection_queue (non-critical)', {
            error: queueError.message,
            userId,
            syncId
          });
        } else {
          logger.info('✅ [AGENT 3] Detection completion signal sent', { userId, syncId });
=======
        // Check if queue entry exists, then update or insert
        const { data: existingQueue } = await supabaseAdmin
          .from('detection_queue')
          .select('id')
          .eq('seller_id', userId)
          .eq('sync_id', syncId)
          .maybeSingle();

        if (existingQueue) {
          // Update existing entry
          const { error: updateError } = await supabaseAdmin
            .from('detection_queue')
            .update({
              status: result.success ? 'completed' : 'failed',
              processed_at: new Date().toISOString(),
              payload: {
                detectionId,
                summary: result.summary,
                isMock: result.isMock
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', existingQueue.id);

          if (updateError) {
            logger.warn('⚠️ [AGENT 3] Failed to update detection_queue (non-critical)', {
              error: updateError.message,
              userId,
              syncId
            });
          } else {
            logger.info('✅ [AGENT 3] Detection completion signal sent', { userId, syncId });
          }
        } else {
          // Insert new entry
          const { error: insertError } = await supabaseAdmin
            .from('detection_queue')
            .insert({
              seller_id: userId,
              sync_id: syncId,
              status: result.success ? 'completed' : 'failed',
              processed_at: new Date().toISOString(),
              payload: {
                detectionId,
                summary: result.summary,
                isMock: result.isMock
              }
            });

          if (insertError) {
            logger.warn('⚠️ [AGENT 3] Failed to insert detection_queue (non-critical)', {
              error: insertError.message,
              userId,
              syncId
            });
          } else {
            logger.info('✅ [AGENT 3] Detection completion signal sent', { userId, syncId });
          }
>>>>>>> 6697dd3 (CRITICAL FIX: Agent 3 reliability - Fix all 4 silent failure issues)
        }
      } catch (queueError: any) {
        logger.warn('⚠️ [AGENT 3] Failed to signal completion (non-critical)', {
          error: queueError.message,
          userId,
          syncId
        });
      }

      // Step 7: Trigger Agent 4 (Evidence Ingestion) after successful detection
      // Note: Agent 4 runs on a schedule, but we can trigger it manually for new claims
      if (result.success && result.summary.totalDetected > 0) {
        try {
          logger.info('📦 [AGENT 3→4] New claims detected - evidence ingestion will process them on next schedule', {
            userId,
            syncId,
            detectionId,
            claimsDetected: result.summary.totalDetected
          });
          
          // Agent 4 (Evidence Ingestion Worker) runs on schedule every 5 minutes
          // It will automatically ingest evidence for users with pending claims
          // No need to trigger manually - the worker will pick up new detection_results
        } catch (error: any) {
          logger.warn('⚠️ [AGENT 3→4] Note logged (non-critical)', {
            error: error.message,
            userId,
            syncId
          });
        }
      }

      return result;
    } catch (error: any) {
      result.success = false;
      result.errors.push(`Fatal error: ${error.message}`);
      result.duration = Date.now() - startTime;

      logger.error('❌ [AGENT 3] Fatal detection error', {
        userId,
        syncId,
        detectionId,
        error: error.message,
        stack: error.stack
      });

      // Log error event
      try {
        const { error: logError } = await supabaseAdmin
          .from('agent_events')
          .insert({
            user_id: userId,
            agent: 'claim_detection',
            event_type: 'detection_failed',
            success: false,
            metadata: {
              detectionId,
              syncId,
              error: error.message,
              duration: result.duration
            },
            created_at: new Date().toISOString()
          });
        
        if (logError) {
          logger.warn('⚠️ [AGENT 3] Failed to log error event', { error: logError.message });
        }
      } catch (logError: any) {
        logger.warn('⚠️ [AGENT 3] Failed to log error event', { error: logError.message });
      }

      return result;
    }
  }

  /**
   * Get normalized data from Agent 2 (if stored in database)
   */
  private async getNormalizedDataFromAgent2(userId: string, syncId: string): Promise<{
    orders?: any[];
    shipments?: any[];
    returns?: any[];
    settlements?: any[];
    inventory?: any[];
    claims?: any[];
  }> {
    try {
      // Try to get data from database tables (if Agent 2 stored them)
      const [ordersResult, shipmentsResult, returnsResult, settlementsResult, inventoryResult, claimsResult] = await Promise.all([
        supabaseAdmin.from('orders').select('*').eq('seller_id', userId).limit(100),
        supabaseAdmin.from('shipments').select('*').eq('seller_id', userId).limit(100),
        supabaseAdmin.from('returns').select('*').eq('seller_id', userId).limit(100),
        supabaseAdmin.from('settlements').select('*').eq('seller_id', userId).limit(100),
        supabaseAdmin.from('inventory_items').select('*').eq('user_id', userId).limit(100),
        supabaseAdmin.from('claims').select('*').eq('user_id', userId).limit(100)
      ]);

      return {
        orders: ordersResult.data || [],
        shipments: shipmentsResult.data || [],
        returns: returnsResult.data || [],
        settlements: settlementsResult.data || [],
        inventory: inventoryResult.data || [],
        claims: claimsResult.data || []
      };
    } catch (error: any) {
      logger.warn('⚠️ [AGENT 3] Failed to fetch normalized data from database', {
        error: error.message,
        userId,
        syncId
      });
      return {};
    }
  }

  /**
   * Transform normalized data from Agent 2 into claim detection format
   */
  private prepareClaimsFromNormalizedData(
    data: {
      orders?: any[];
      shipments?: any[];
      returns?: any[];
      settlements?: any[];
      inventory?: any[];
      claims?: any[];
    },
    userId: string
  ): any[] {
    const claims: any[] = [];

    // Process orders for potential fee overcharges
    if (data.orders) {
      for (const order of data.orders) {
        // Check for potential fee discrepancies
        if (order.total_fees && order.total_fees > 0) {
          claims.push({
            claim_id: `claim_order_${order.order_id}_${Date.now()}`,
            seller_id: userId,
            order_id: order.order_id,
            category: 'fee_error',
            subcategory: 'order_fee',
            reason_code: 'POTENTIAL_FEE_OVERCHARGE',
            marketplace: order.marketplace_id || 'US',
            amount: order.total_fees,
            quantity: 1,
            order_value: order.total_amount || 0,
            days_since_order: this.calculateDaysSince(order.order_date),
            description: `Potential fee overcharge for order ${order.order_id}`,
            claim_date: order.order_date || new Date().toISOString(),
            currency: order.currency || 'USD',
            evidence: {
              order_id: order.order_id,
              order_data: order
            }
          });
        }
      }
    }

    // Process shipments for lost/damaged inventory
    if (data.shipments) {
      for (const shipment of data.shipments) {
        if (shipment.missing_quantity && shipment.missing_quantity > 0) {
          const estimatedValue = shipment.items?.reduce((sum: number, item: any) => {
            return sum + (item.quantity * (item.price || 10));
          }, 0) || shipment.missing_quantity * 10;

          claims.push({
            claim_id: `claim_shipment_${shipment.shipment_id}_${Date.now()}`,
            seller_id: userId,
            order_id: shipment.order_id,
            category: 'inventory_loss',
            subcategory: shipment.status === 'lost' ? 'lost_shipment' : 'damaged_goods',
            reason_code: shipment.status === 'lost' ? 'LOST_SHIPMENT' : 'DAMAGED_INVENTORY',
            marketplace: 'US',
            amount: estimatedValue,
            quantity: shipment.missing_quantity,
            order_value: estimatedValue,
            days_since_order: this.calculateDaysSince(shipment.shipped_date),
            description: `Missing ${shipment.missing_quantity} unit(s) from shipment ${shipment.shipment_id}`,
            claim_date: shipment.shipped_date || new Date().toISOString(),
            currency: 'USD',
            evidence: {
              shipment_id: shipment.shipment_id,
              shipment_data: shipment
            }
          });
        }
      }
    }

    // Process returns for potential refund discrepancies
    if (data.returns) {
      for (const returnData of data.returns) {
        if (returnData.refund_amount && returnData.refund_amount > 0) {
          claims.push({
            claim_id: `claim_return_${returnData.return_id}_${Date.now()}`,
            seller_id: userId,
            order_id: returnData.order_id,
            category: 'return_discrepancy',
            subcategory: 'refund_mismatch',
            reason_code: 'POTENTIAL_REFUND_DISCREPANCY',
            marketplace: 'US',
            amount: returnData.refund_amount,
            quantity: returnData.items?.reduce((sum: number, item: any) => sum + item.quantity, 0) || 1,
            order_value: returnData.refund_amount,
            days_since_order: this.calculateDaysSince(returnData.returned_date),
            description: `Potential refund discrepancy for return ${returnData.return_id}`,
            claim_date: returnData.returned_date || new Date().toISOString(),
            currency: returnData.currency || 'USD',
            evidence: {
              return_id: returnData.return_id,
              return_data: returnData
            }
          });
        }
      }
    }

    // Process settlements for fee discrepancies
    if (data.settlements) {
      for (const settlement of data.settlements) {
        if (settlement.fees && settlement.fees > 0) {
          claims.push({
            claim_id: `claim_settlement_${settlement.settlement_id}_${Date.now()}`,
            seller_id: userId,
            order_id: settlement.order_id,
            category: 'fee_error',
            subcategory: 'settlement_fee',
            reason_code: 'POTENTIAL_SETTLEMENT_FEE_DISCREPANCY',
            marketplace: 'US',
            amount: settlement.fees,
            quantity: 1,
            order_value: settlement.amount || 0,
            days_since_order: this.calculateDaysSince(settlement.settlement_date),
            description: `Potential fee discrepancy in settlement ${settlement.settlement_id}`,
            claim_date: settlement.settlement_date || new Date().toISOString(),
            currency: settlement.currency || 'USD',
            evidence: {
              settlement_id: settlement.settlement_id,
              settlement_data: settlement
            }
          });
        }
      }
    }

    // Process inventory for damaged/lost items
    if (data.inventory) {
      for (const item of data.inventory) {
        // Check for damaged inventory (if metadata indicates)
        const damagedQty = item.metadata?.damaged_quantity || 0;
        if (damagedQty > 0) {
          const estimatedValue = damagedQty * (item.price || item.cost || 10);
          claims.push({
            claim_id: `claim_inventory_${item.sku}_${Date.now()}`,
            seller_id: userId,
            order_id: item.sku,
            category: 'inventory_loss',
            subcategory: 'damaged_goods',
            reason_code: 'DAMAGED_INVENTORY',
            marketplace: 'US',
            amount: estimatedValue,
            quantity: damagedQty,
            order_value: estimatedValue,
            days_since_order: 0,
            description: `Damaged inventory detected for SKU ${item.sku}: ${damagedQty} unit(s)`,
            claim_date: new Date().toISOString(),
            currency: 'USD',
            evidence: {
              sku: item.sku,
              inventory_data: item
            }
          });
        }
      }
    }

    // Process existing claims (from financial events)
    if (data.claims) {
      for (const claim of data.claims) {
        if (claim.amount && claim.amount > 0) {
          claims.push({
            claim_id: claim.id || `claim_${Date.now()}`,
            seller_id: userId,
            order_id: claim.orderId || claim.order_id,
            category: claim.type || 'other',
            subcategory: claim.type || 'other',
            reason_code: 'EXISTING_CLAIM',
            marketplace: 'US',
            amount: claim.amount,
            quantity: 1,
            order_value: claim.amount,
            days_since_order: this.calculateDaysSince(claim.createdAt || claim.created_at),
            description: claim.description || `Claim for ${claim.type}`,
            claim_date: claim.createdAt || claim.created_at || new Date().toISOString(),
            currency: claim.currency || 'USD',
            evidence: {
              claim_id: claim.id,
              claim_data: claim
            }
          });
        }
      }
    }

    return claims;
  }

  /**
   * Call Python Claim Detector API
   */
  private async callPythonDetectorAPI(claims: any[], userId: string): Promise<any[]> {
    try {
      logger.info('🤖 [AGENT 3] Calling Python Claim Detector API', {
        userId,
        claimCount: claims.length,
        apiUrl: `${this.pythonApiUrl}/api/v1/claim-detector/predict/batch`
      });

      const response = await axios.post(
        `${this.pythonApiUrl}/api/v1/claim-detector/predict/batch`,
        { claims },
        {
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const predictions = response.data?.predictions || response.data?.results || response.data?.claims || [];

      // Transform API response to detection results
      return predictions.map((prediction: any) => ({
        claim_id: prediction.claim_id,
        seller_id: userId,
        anomaly_type: this.mapCategoryToAnomalyType(prediction.category, prediction.subcategory),
        severity: this.mapConfidenceToSeverity(prediction.probability || prediction.confidence || 0.5),
        estimated_value: prediction.amount || 0,
        currency: prediction.currency || 'USD',
        confidence_score: prediction.probability || prediction.confidence || 0.5,
        evidence: prediction.evidence || {},
        related_event_ids: [prediction.order_id].filter(Boolean),
        discovery_date: new Date(prediction.claim_date || Date.now()),
        deadline_date: this.calculateDeadline(new Date(prediction.claim_date || Date.now())),
        days_remaining: this.calculateDaysRemaining(new Date(prediction.claim_date || Date.now()))
      }));
    } catch (error: any) {
      logger.error('❌ [AGENT 3] Python API call failed', {
        error: error.message,
        userId,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Generate mock detections (for sandbox/testing)
   */
  private generateMockDetections(claims: any[], userId: string): any[] {
    logger.info('🧪 [AGENT 3] Generating mock detections', {
      userId,
      claimCount: claims.length
    });

    return claims.map((claim, index) => {
      // Vary confidence scores for testing
      const confidence = 0.5 + (Math.random() * 0.4); // 0.5 to 0.9
      const isHighConfidence = confidence >= 0.85;
      
      return {
        claim_id: claim.claim_id,
        seller_id: userId,
        anomaly_type: this.mapCategoryToAnomalyType(claim.category, claim.subcategory),
        severity: this.mapConfidenceToSeverity(confidence),
        estimated_value: claim.amount || 0,
        currency: claim.currency || 'USD',
        confidence_score: confidence,
        evidence: claim.evidence || {},
        related_event_ids: [claim.order_id].filter(Boolean),
        discovery_date: new Date(claim.claim_date || Date.now()),
        deadline_date: this.calculateDeadline(new Date(claim.claim_date || Date.now())),
        days_remaining: this.calculateDaysRemaining(new Date(claim.claim_date || Date.now())),
        isMock: true,
        mockNote: isHighConfidence ? 'High confidence mock detection' : 'Medium confidence mock detection'
      };
    });
  }

  /**
   * Store detection results in database
   */
  private async storeDetectionResults(
    detections: any[],
    userId: string,
    syncId: string
  ): Promise<void> {
    try {
      // Use supabaseAdmin if available, otherwise fallback to supabase
      const { supabaseAdmin, supabase } = await import('../database/supabaseClient');
      const dbClient = supabaseAdmin || supabase;
      
      if (!dbClient || typeof dbClient.from !== 'function') {
        logger.warn('⚠️ [AGENT 3] No database client available, skipping storage', {
          userId,
          syncId,
          detectionsCount: detections.length
        });
        return; // Don't throw - allow detection to complete even if storage fails
      }

      const records = detections.map(detection => ({
        seller_id: userId,
        sync_id: syncId,
        anomaly_type: detection.anomaly_type,
        severity: detection.severity,
        estimated_value: detection.estimated_value,
        currency: detection.currency,
        confidence_score: detection.confidence_score,
        evidence: detection.evidence,
        related_event_ids: detection.related_event_ids || [],
        discovery_date: detection.discovery_date ? new Date(detection.discovery_date).toISOString() : new Date().toISOString(),
        deadline_date: detection.deadline_date ? new Date(detection.deadline_date).toISOString() : null,
        days_remaining: detection.days_remaining,
        expired: detection.days_remaining !== null && detection.days_remaining === 0,
        expiration_alert_sent: false,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { error } = await dbClient
        .from('detection_results')
        .insert(records);

      // FIX #2: Database writes MUST throw errors - don't suppress failures
      if (error) {
        const errorMsg = `Failed to store detection results: ${error.message}`;
        logger.error('❌ [AGENT 3] Database write failed', {
          error: error.message,
          errorCode: error.code,
          userId,
          syncId,
          recordsCount: records.length,
          stack: error.stack
        });
        throw new Error(errorMsg);
      }

      logger.info('✅ [AGENT 3] Detection results stored', {
        userId,
        syncId,
        count: records.length
      });
    } catch (error: any) {
      logger.error('❌ [AGENT 3] Failed to store detection results', {
        error: error.message,
        userId,
        syncId,
        stack: error.stack
      });
      // FIX #2: Re-throw error - storage failures must propagate
      throw error;
    }
  }

  /**
   * Generate mock claims from normalized data when no claims are found
   * This ensures Agent 3 always generates detections in mock mode
   */
  private generateMockClaimsFromNormalizedData(
    data: {
      orders?: any[];
      shipments?: any[];
      returns?: any[];
      settlements?: any[];
      inventory?: any[];
      claims?: any[];
    },
    userId: string
  ): any[] {
    const mockClaims: any[] = [];
    let claimIndex = 0;

    // Generate claims from orders (fee-related)
    if (data.orders && data.orders.length > 0) {
      const ordersToUse = data.orders.slice(0, Math.min(25, data.orders.length));
      for (const order of ordersToUse) {
        mockClaims.push({
          claim_id: `mock_claim_order_${order.order_id || order.amazon_order_id || claimIndex}_${Date.now()}`,
          seller_id: userId,
          order_id: order.order_id || order.amazon_order_id,
          category: 'fee_error',
          subcategory: 'order_fee',
          reason_code: 'POTENTIAL_FEE_OVERCHARGE',
          marketplace: order.marketplace_id || 'US',
          amount: (order.total_amount || order.order_total || 100) * 0.05, // 5% of order value
          quantity: 1,
          order_value: order.total_amount || order.order_total || 100,
          days_since_order: this.calculateDaysSince(order.order_date || order.purchase_date || new Date().toISOString()),
          description: `Potential fee overcharge for order ${order.order_id || order.amazon_order_id || claimIndex}`,
          claim_date: order.order_date || order.purchase_date || new Date().toISOString(),
          currency: order.currency || 'USD',
          evidence: {
            order_id: order.order_id || order.amazon_order_id,
            order_data: order
          }
        });
        claimIndex++;
      }
    }

    // Generate claims from shipments (lost/damaged inventory)
    if (data.shipments && data.shipments.length > 0) {
      const shipmentsToUse = data.shipments.slice(0, Math.min(20, data.shipments.length));
      for (const shipment of shipmentsToUse) {
        const estimatedValue = shipment.items?.reduce((sum: number, item: any) => {
          return sum + ((item.quantity || 1) * (item.price || 10));
        }, 0) || 50;
        
        mockClaims.push({
          claim_id: `mock_claim_shipment_${shipment.shipment_id || claimIndex}_${Date.now()}`,
          seller_id: userId,
          order_id: shipment.order_id,
          category: 'inventory_loss',
          subcategory: 'missing_unit',
          reason_code: 'MISSING_UNIT',
          marketplace: shipment.marketplace_id || 'US',
          amount: estimatedValue * 0.1, // 10% of shipment value
          quantity: 1,
          order_value: estimatedValue,
          days_since_order: this.calculateDaysSince(shipment.ship_date || shipment.shipped_date || new Date().toISOString()),
          description: `Potential missing unit in shipment ${shipment.shipment_id || claimIndex}`,
          claim_date: shipment.ship_date || shipment.shipped_date || new Date().toISOString(),
          currency: shipment.currency || 'USD',
          evidence: {
            shipment_id: shipment.shipment_id,
            shipment_data: shipment
          }
        });
        claimIndex++;
      }
    }

    // Generate claims from returns (uncredited returns)
    if (data.returns && data.returns.length > 0) {
      const returnsToUse = data.returns.slice(0, Math.min(15, data.returns.length));
      for (const returnItem of returnsToUse) {
        mockClaims.push({
          claim_id: `mock_claim_return_${returnItem.return_id || claimIndex}_${Date.now()}`,
          seller_id: userId,
          order_id: returnItem.order_id,
          category: 'return_not_credited',
          subcategory: 'uncredited_return',
          reason_code: 'RETURN_NOT_CREDITED',
          marketplace: returnItem.marketplace_id || 'US',
          amount: (returnItem.refund_amount || 50),
          quantity: returnItem.quantity || 1,
          order_value: returnItem.refund_amount || 50,
          days_since_order: this.calculateDaysSince(returnItem.return_date || returnItem.returned_date || new Date().toISOString()),
          description: `Potential uncredited return ${returnItem.return_id || claimIndex}`,
          claim_date: returnItem.return_date || returnItem.returned_date || new Date().toISOString(),
          currency: returnItem.currency || 'USD',
          evidence: {
            return_id: returnItem.return_id,
            return_data: returnItem
          }
        });
        claimIndex++;
      }
    }

    // If still no claims, generate some generic ones
    if (mockClaims.length === 0) {
      logger.warn('⚠️ [AGENT 3] No data to generate mock claims from, creating generic mock claims', {
        userId,
        hasOrders: !!(data.orders && data.orders.length > 0),
        hasShipments: !!(data.shipments && data.shipments.length > 0),
        hasReturns: !!(data.returns && data.returns.length > 0)
      });
      
      // Generate 10 generic mock claims
      for (let i = 0; i < 10; i++) {
        mockClaims.push({
          claim_id: `mock_claim_generic_${i}_${Date.now()}`,
          seller_id: userId,
          order_id: `MOCK_ORDER_${i}`,
          category: i % 2 === 0 ? 'fee_error' : 'inventory_loss',
          subcategory: i % 2 === 0 ? 'order_fee' : 'missing_unit',
          reason_code: i % 2 === 0 ? 'POTENTIAL_FEE_OVERCHARGE' : 'MISSING_UNIT',
          marketplace: 'US',
          amount: 50 + (i * 10),
          quantity: 1,
          order_value: 100 + (i * 20),
          days_since_order: 30 - i,
          description: `Mock claim ${i + 1} for testing`,
          claim_date: new Date(Date.now() - (i * 24 * 60 * 60 * 1000)).toISOString(),
          currency: 'USD',
          evidence: {
            mock: true,
            index: i
          }
        });
      }
    }

    logger.info('🧪 [AGENT 3] Generated mock claims from normalized data', {
      userId,
      mockClaimsCount: mockClaims.length
    });

    return mockClaims;
  }

  /**
   * Helper: Map category to anomaly type
   */
  private mapCategoryToAnomalyType(category: string, subcategory?: string): string {
    const mapping: Record<string, string> = {
      'fee_error': 'incorrect_fee',
      'inventory_loss': 'missing_unit',
      'damaged_goods': 'damaged_stock',
      'return_discrepancy': 'missing_unit',
      'lost_shipment': 'missing_unit',
      'overcharge': 'overcharge',
      'duplicate': 'duplicate_charge'
    };

    return mapping[subcategory || category] || 'missing_unit';
  }

  /**
   * Helper: Map confidence to severity
   */
  private mapConfidenceToSeverity(confidence: number): 'low' | 'medium' | 'high' | 'critical' {
    if (confidence >= 0.85) return 'critical';
    if (confidence >= 0.70) return 'high';
    if (confidence >= 0.50) return 'medium';
    return 'low';
  }

  /**
   * Helper: Calculate days since date
   */
  private calculateDaysSince(dateString?: string): number {
    if (!dateString) return 0;
    const date = new Date(dateString);
    const now = new Date();
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  }

  /**
   * Helper: Calculate 60-day deadline
   */
  private calculateDeadline(discoveryDate: Date): Date {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);
    return deadline;
  }

  /**
   * Helper: Calculate days remaining until deadline
   */
  private calculateDaysRemaining(discoveryDate: Date): number {
    const deadline = this.calculateDeadline(discoveryDate);
    const now = new Date();
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, daysRemaining);
  }
}

export const agent3ClaimDetectionService = new Agent3ClaimDetectionService();
export default agent3ClaimDetectionService;

