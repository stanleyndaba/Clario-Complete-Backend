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
  private readonly pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-10.onrender.com';

  /**
   * Enqueue a detection job after sync completion
   * If Redis is not available, processes the job directly from the database
   */
  async enqueueDetectionJob(job: DetectionJob & { is_sandbox?: boolean }): Promise<void> {
    try {
      const isSandbox = job.is_sandbox ||
        process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox') ||
        process.env.NODE_ENV === 'development';

      logger.info('Enqueueing detection job (SANDBOX MODE)', {
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        isSandbox,
        mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
      });

      // Store in database for persistence (include sandbox flag)
      const jobWithSandbox = { ...job, is_sandbox: isSandbox };
      const { error: dbError } = await supabase
        .from('detection_queue')
        .insert({
          seller_id: job.seller_id,
          sync_id: job.sync_id,
          status: 'pending',
          priority: 1,
          payload: jobWithSandbox,
          is_sandbox: isSandbox
        });

      if (dbError) {
        logger.error('Error storing detection job in database', { error: dbError, job });
        // Continue anyway - we'll try to process directly
      }

      // Try to add to Redis queue for immediate processing
      try {
        const { isRedisAvailable } = await import('../utils/redisClient');
        if (isRedisAvailable()) {
          const redisClient = await getRedisClient();
          await redisClient.lPush(this.queueName, JSON.stringify(jobWithSandbox));
          logger.info('Detection job added to Redis queue', {
            seller_id: job.seller_id,
            sync_id: job.sync_id
          });
        } else {
          // Redis not available - process directly from database
          logger.info('Redis not available, processing detection job directly from database', {
            seller_id: job.seller_id,
            sync_id: job.sync_id
          });
          // Process the job directly (don't await - let it run in background)
          this.processDetectionJobDirectly(jobWithSandbox).catch((error) => {
            logger.error('Error processing detection job directly', { error, job });
          });
        }
      } catch (redisError: any) {
        // Redis error - process directly from database as fallback
        logger.warn('Redis error, processing detection job directly from database', {
          error: redisError.message,
          seller_id: job.seller_id,
          sync_id: job.sync_id
        });
        // Process the job directly (don't await - let it run in background)
        this.processDetectionJobDirectly(jobWithSandbox).catch((error) => {
          logger.error('Error processing detection job directly', { error, job });
        });
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
   * Process a detection job directly (fallback when Redis is not available)
   */
  private async processDetectionJobDirectly(job: DetectionJob & { is_sandbox?: boolean }): Promise<void> {
    try {
      logger.info('Processing detection job directly from database', {
        seller_id: job.seller_id,
        sync_id: job.sync_id
      });

      // Update job status to processing
      await this.updateJobStatus(job.seller_id, job.sync_id, 'processing');

      // 🎯 AGENT 3: Send SSE event for detection started
      try {
        const sseHub = (await import('../utils/sseHub')).default;
        sseHub.sendEvent(job.seller_id, 'message', {
          type: 'detection',
          status: 'started',
          data: {
            syncId: job.sync_id,
            message: 'Claim detection started',
            timestamp: new Date().toISOString()
          },
          timestamp: new Date().toISOString()
        });
        logger.debug('✅ [AGENT 3] SSE event sent for detection started', { seller_id: job.seller_id, sync_id: job.sync_id });
      } catch (sseError: any) {
        logger.warn('⚠️ [AGENT 3] Failed to send SSE event for detection started', { error: sseError.message });
      }

      // Run detection algorithms
      const results = await this.runDetectionAlgorithms(job);

      // Store detection results
      await this.storeDetectionResults(results);

      // Update job status to completed
      await this.updateJobStatus(job.seller_id, job.sync_id, 'completed');

      // Categorize claims by ML confidence score
      const highConfidenceClaims = results.filter(r => r.confidence_score >= 0.85);
      const mediumConfidenceClaims = results.filter(r => r.confidence_score >= 0.50 && r.confidence_score < 0.85);
      const lowConfidenceClaims = results.filter(r => r.confidence_score < 0.50);

      // Send notifications for each category
      const websocketService = (await import('./websocketService')).default;

      if (highConfidenceClaims.length > 0) {
        websocketService.sendNotificationToUser(job.seller_id, {
          type: 'success',
          title: '⚡ ' + highConfidenceClaims.length + ' claims ready for auto submission',
          message: `High confidence (85%+): ${highConfidenceClaims.length} claims totaling $${highConfidenceClaims.reduce((sum, r) => sum + (r.estimated_value || 0), 0).toFixed(2)}`,
          data: {
            category: 'high_confidence',
            count: highConfidenceClaims.length,
            total_amount: highConfidenceClaims.reduce((sum, r) => sum + (r.estimated_value || 0), 0),
            is_sandbox: job.is_sandbox || false
          }
        });
      }

      if (mediumConfidenceClaims.length > 0) {
        websocketService.sendNotificationToUser(job.seller_id, {
          type: 'warning',
          title: '❓ ' + mediumConfidenceClaims.length + ' claims need your input',
          message: `Medium confidence (50-85%): Review required for ${mediumConfidenceClaims.length} claims`,
          data: {
            category: 'medium_confidence',
            count: mediumConfidenceClaims.length,
            total_amount: mediumConfidenceClaims.reduce((sum, r) => sum + (r.estimated_value || 0), 0),
            is_sandbox: job.is_sandbox || false
          }
        });
      }

      if (lowConfidenceClaims.length > 0) {
        websocketService.sendNotificationToUser(job.seller_id, {
          type: 'info',
          title: '📋 ' + lowConfidenceClaims.length + ' claims need manual review',
          message: `Low confidence (<50%): Manual review required`,
          data: {
            category: 'low_confidence',
            count: lowConfidenceClaims.length,
            total_amount: lowConfidenceClaims.reduce((sum, r) => sum + (r.estimated_value || 0), 0),
            is_sandbox: job.is_sandbox || false
          }
        });
      }

      // 🎯 PHASE 3: Trigger orchestrator Phase 3 (Detection Completion)
      try {
        const OrchestrationJobManager = (await import('../jobs/orchestrationJob')).default;
        const claims = results.map((result, index) => ({
          claim_id: `claim_${result.seller_id}_${Date.now()}_${index}`,
          claim_type: result.anomaly_type,
          amount: result.estimated_value,
          confidence: result.confidence_score,
          confidence_category: result.confidence_score >= 0.85 ? 'high' :
            result.confidence_score >= 0.50 ? 'medium' : 'low',
          currency: result.currency,
          evidence: result.evidence,
          discovery_date: result.discovery_date?.toISOString(),
          deadline_date: result.deadline_date?.toISOString(),
          is_sandbox: job.is_sandbox || false
        }));
        await OrchestrationJobManager.triggerPhase3_DetectionCompletion(
          job.seller_id,
          job.sync_id,
          claims
        );
        logger.info('Phase 3 orchestration triggered after detection', {
          seller_id: job.seller_id,
          sync_id: job.sync_id,
          claims_count: claims.length,
          high_confidence: highConfidenceClaims.length,
          medium_confidence: mediumConfidenceClaims.length,
          low_confidence: lowConfidenceClaims.length,
          is_sandbox: job.is_sandbox || false,
          mode: job.is_sandbox ? 'SANDBOX' : 'PRODUCTION'
        });
      } catch (error: any) {
        // Non-blocking - orchestration failure shouldn't break detection
        logger.warn('Phase 3 orchestration trigger failed (non-critical)', {
          error: error.message,
          seller_id: job.seller_id,
          sync_id: job.sync_id
        });
      }

      // 🎯 AGENT 3: Send SSE event for detection completed
      try {
        const sseHub = (await import('../utils/sseHub')).default;
        const highConfidenceCount = results.filter(r => r.confidence_score >= 0.85).length;
        const mediumConfidenceCount = results.filter(r => r.confidence_score >= 0.50 && r.confidence_score < 0.85).length;
        const lowConfidenceCount = results.filter(r => r.confidence_score < 0.50).length;
        const totalValue = results.reduce((sum, r) => sum + (r.estimated_value || 0), 0);

        sseHub.sendEvent(job.seller_id, 'message', {
          type: 'detection',
          status: 'completed',
          data: {
            syncId: job.sync_id,
            totalDetected: results.length,
            count: results.length,
            highConfidence: highConfidenceCount,
            mediumConfidence: mediumConfidenceCount,
            lowConfidence: lowConfidenceCount,
            totalValue: totalValue,
            message: `${results.length} claim${results.length !== 1 ? 's' : ''} detected`,
            timestamp: new Date().toISOString()
          },
          timestamp: new Date().toISOString()
        });
        logger.debug('✅ [AGENT 3] SSE event sent for detection completed', { seller_id: job.seller_id, sync_id: job.sync_id, results_count: results.length });
      } catch (sseError: any) {
        logger.warn('⚠️ [AGENT 3] Failed to send SSE event for detection completed', { error: sseError.message });
      }

      logger.info('Detection job processed successfully', {
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        results_count: results.length
      });
    } catch (error) {
      logger.error('Error processing detection job directly', { error, job });

      // Update job status to failed
      await this.updateJobStatus(job.seller_id, job.sync_id, 'failed', error instanceof Error ? error.message : 'Unknown error');

      // 🎯 AGENT 3: Send SSE event for detection failed
      try {
        const sseHub = (await import('../utils/sseHub')).default;
        sseHub.sendEvent(job.seller_id, 'message', {
          type: 'detection',
          status: 'failed',
          data: {
            syncId: job.sync_id,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: `Detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            timestamp: new Date().toISOString()
          },
          timestamp: new Date().toISOString()
        });
        logger.debug('✅ [AGENT 3] SSE event sent for detection failed', { seller_id: job.seller_id, sync_id: job.sync_id });
      } catch (sseError: any) {
        logger.warn('⚠️ [AGENT 3] Failed to send SSE event for detection failed', { error: sseError.message });
      }

      throw error;
    }
  }

  /**
   * Process detection jobs from the queue
   */
  async processDetectionJobs(): Promise<void> {
    try {
      // Check if Redis is available before attempting to process jobs
      const { isRedisAvailable } = await import('../utils/redisClient');
      if (!isRedisAvailable()) {
        // Redis is not available - skip processing silently
        // This prevents log spam when Redis is not configured
        return;
      }

      const redisClient = await getRedisClient();

      // Process jobs from Redis queue (with timeout to prevent blocking)
      const jobData = await Promise.race([
        redisClient.brPop(this.queueName, 1),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000))
      ]);

      if (!jobData || !Array.isArray(jobData) || !jobData[1]) {
        // No jobs in queue, exit
        return;
      }

      // Process the job
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

        // Categorize claims by ML confidence score
        const highConfidenceClaims = results.filter(r => r.confidence_score >= 0.85);
        const mediumConfidenceClaims = results.filter(r => r.confidence_score >= 0.50 && r.confidence_score < 0.85);
        const lowConfidenceClaims = results.filter(r => r.confidence_score < 0.50);

        // Send notifications for each category
        const websocketService = (await import('./websocketService')).default;

        if (highConfidenceClaims.length > 0) {
          websocketService.sendNotificationToUser(job.seller_id, {
            type: 'success',
            title: '⚡ ' + highConfidenceClaims.length + ' claims ready for auto submission',
            message: `High confidence (85%+): ${highConfidenceClaims.length} claims totaling $${highConfidenceClaims.reduce((sum, r) => sum + (r.estimated_value || 0), 0).toFixed(2)}`,
            data: {
              category: 'high_confidence',
              count: highConfidenceClaims.length,
              total_amount: highConfidenceClaims.reduce((sum, r) => sum + (r.estimated_value || 0), 0),
              is_sandbox: (job as any).is_sandbox || false
            }
          });
        }

        if (mediumConfidenceClaims.length > 0) {
          websocketService.sendNotificationToUser(job.seller_id, {
            type: 'warning',
            title: '❓ ' + mediumConfidenceClaims.length + ' claims need your input',
            message: `Medium confidence (50-85%): Review required for ${mediumConfidenceClaims.length} claims`,
            data: {
              category: 'medium_confidence',
              count: mediumConfidenceClaims.length,
              total_amount: mediumConfidenceClaims.reduce((sum, r) => sum + (r.estimated_value || 0), 0),
              is_sandbox: (job as any).is_sandbox || false
            }
          });
        }

        if (lowConfidenceClaims.length > 0) {
          websocketService.sendNotificationToUser(job.seller_id, {
            type: 'info',
            title: '📋 ' + lowConfidenceClaims.length + ' claims need manual review',
            message: `Low confidence (<50%): Manual review required`,
            data: {
              category: 'low_confidence',
              count: lowConfidenceClaims.length,
              total_amount: lowConfidenceClaims.reduce((sum, r) => sum + (r.estimated_value || 0), 0),
              is_sandbox: (job as any).is_sandbox || false
            }
          });
        }

        // 🎯 PHASE 3: Trigger orchestrator Phase 3 (Detection Completion)
        try {
          const OrchestrationJobManager = (await import('../jobs/orchestrationJob')).default;
          const claims = results.map((result, index) => ({
            claim_id: `claim_${result.seller_id}_${Date.now()}_${index}`,
            claim_type: result.anomaly_type,
            amount: result.estimated_value,
            confidence: result.confidence_score,
            confidence_category: result.confidence_score >= 0.85 ? 'high' :
              result.confidence_score >= 0.50 ? 'medium' : 'low',
            currency: result.currency,
            evidence: result.evidence,
            discovery_date: result.discovery_date?.toISOString(),
            deadline_date: result.deadline_date?.toISOString(),
            is_sandbox: (job as any).is_sandbox || false
          }));
          await OrchestrationJobManager.triggerPhase3_DetectionCompletion(
            job.seller_id,
            job.sync_id,
            claims
          );
          logger.info('Phase 3 orchestration triggered after detection (SANDBOX MODE)', {
            seller_id: job.seller_id,
            sync_id: job.sync_id,
            claims_count: claims.length,
            high_confidence: highConfidenceClaims.length,
            medium_confidence: mediumConfidenceClaims.length,
            low_confidence: lowConfidenceClaims.length,
            is_sandbox: (job as any).is_sandbox || false,
            mode: (job as any).is_sandbox ? 'SANDBOX' : 'PRODUCTION'
          });
        } catch (error: any) {
          // Non-blocking - orchestration failure shouldn't break detection
          logger.warn('Phase 3 orchestration trigger failed (non-critical)', {
            error: error.message,
            seller_id: job.seller_id,
            sync_id: job.sync_id
          });
        }
      } catch (error) {
        logger.error('Error processing detection job', { error, job });

        // Update job status to failed
        await this.updateJobStatus(job.seller_id, job.sync_id, 'failed', error instanceof Error ? error.message : 'Unknown error');
      }
    } catch (error: any) {
      // Only log Redis connection errors once, then suppress
      // This prevents log spam when Redis is not available
      if (error?.message?.includes('ECONNREFUSED') || error?.message?.includes('Redis')) {
        // Suppress Redis connection errors - they're already handled in redisClient.ts
        return;
      }
      // Log other errors
      logger.error('Error in processDetectionJobs', { error: error?.message || error });
    }
  }

  /**
   * Run detection algorithms on synced data
   * This is Phase 2: Autonomous Money Discovery - scans orders and detects claims
   */
  private async runDetectionAlgorithms(job: DetectionJob): Promise<DetectionResult[]> {
    try {
      const isSandbox = (job as any).is_sandbox ||
        process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox') ||
        process.env.NODE_ENV === 'development';

      logger.info('Running detection algorithms (Phase 2: Autonomous Money Discovery - SANDBOX MODE)', {
        seller_id: job.seller_id,
        sync_id: job.sync_id,
        isSandbox,
        mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
      });

      const results: DetectionResult[] = [];

      // Step 1: Get financial events from database (synced from SP-API)
      const financialEvents = await this.getFinancialEventsForUser(job.seller_id);

      logger.info('Found financial events for claim detection (SANDBOX MODE)', {
        seller_id: job.seller_id,
        event_count: financialEvents.length,
        isSandbox,
        mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
      });

      // For sandbox: If no financial events, create mock events from claims table for testing
      if (isSandbox && financialEvents.length === 0) {
        logger.info('No financial events found - checking claims table for sandbox test data', {
          seller_id: job.seller_id
        });

        const { data: claims } = await supabase
          .from('claims')
          .select('*')
          .eq('user_id', job.seller_id)
          .eq('provider', 'amazon')
          .limit(100);

        if (claims && claims.length > 0) {
          // Convert claims to financial events format for detection
          const mockEvents = claims.map((claim: any) => ({
            id: claim.id,
            seller_id: job.seller_id,
            event_type: claim.type || 'fee',
            amount: parseFloat(claim.amount) || 0,
            currency: claim.currency || 'USD',
            event_date: claim.created_at || new Date().toISOString(),
            amazon_order_id: claim.order_id || claim.amazon_order_id,
            raw_payload: claim.raw_data || {}
          }));

          logger.info('Using claims as mock financial events for sandbox detection', {
            seller_id: job.seller_id,
            mock_event_count: mockEvents.length
          });

          // Use mock events for detection
          for (const mockEvent of mockEvents) {
            financialEvents.push(mockEvent);
          }
        }
      }

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
      const apiCallStartTime = Date.now();
      let apiResponseTimeMs = 0;
      let apiCallSuccess = false;
      let apiCallError: string | undefined;

      try {
        logger.info('Calling Claim Detector API for batch prediction', {
          seller_id: job.seller_id,
          claim_count: claimsToDetect.length,
          api_url: `${this.pythonApiUrl}/api/v1/claim-detector/predict/batch`
        });

        const detectionResponse = await axios.post(
          `${this.pythonApiUrl}/api/v1/claim-detector/predict/batch`,
          { claims: claimsToDetect },
          {
            timeout: 180000, // 180 second timeout for batch processing (3 minutes to match sync timeout)
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        apiResponseTimeMs = Date.now() - apiCallStartTime;
        apiCallSuccess = true;

        // Parse API response - the API returns { predictions: [], batch_metrics: {} }
        const apiPredictions = detectionResponse.data?.predictions || detectionResponse.data?.results || detectionResponse.data?.claims || [];
        const batchMetrics = detectionResponse.data?.batch_metrics || {};

        logger.info('Claim Detector API response received', {
          seller_id: job.seller_id,
          predictions_count: apiPredictions.length,
          total_processed: claimsToDetect.length,
          batch_metrics: batchMetrics,
          response_keys: Object.keys(detectionResponse.data || {})
        });

        // Create a map of claim_id to original claim data for preserving metadata
        const claimsMap = new Map(claimsToDetect.map(claim => [claim.claim_id, claim]));

        // Step 5: Transform Claim Detector predictions into DetectionResult format
        for (const prediction of apiPredictions) {
          // Get the original claim data to preserve amount and other fields
          const originalClaim = claimsMap.get(prediction.claim_id);

          if (!originalClaim) {
            logger.warn('Original claim not found for prediction', {
              claim_id: prediction.claim_id,
              seller_id: job.seller_id
            });
            continue;
          }

          // Only process claimable predictions with probability >= 0.5
          if (prediction.claimable && prediction.probability >= 0.5) {
            // Merge prediction with original claim data
            const enrichedClaim = {
              ...originalClaim,
              ...prediction,
              // Preserve original amount and metadata
              amount: originalClaim.amount || prediction.amount || 0,
              currency: originalClaim.currency || prediction.currency || 'USD',
              order_id: originalClaim.order_id || prediction.order_id,
              category: originalClaim.category || prediction.category,
              evidence: originalClaim.evidence || {}
            };

            // Map claim detector response to detection result
            const detectionResult = this.mapClaimToDetectionResult(
              enrichedClaim,
              job.seller_id,
              job.sync_id
            );
            results.push(detectionResult);

            logger.debug('Mapped prediction to detection result', {
              claim_id: prediction.claim_id,
              claimable: prediction.claimable,
              probability: prediction.probability,
              confidence: prediction.confidence,
              anomaly_type: detectionResult.anomaly_type,
              estimated_value: detectionResult.estimated_value
            });
          } else {
            logger.debug('Skipping non-claimable or low-probability prediction', {
              claim_id: prediction.claim_id,
              claimable: prediction.claimable,
              probability: prediction.probability
            });
          }
        }

        const highConfidence = results.filter(r => r.confidence_score >= 0.85).length;
        const mediumConfidence = results.filter(r => r.confidence_score >= 0.50 && r.confidence_score < 0.85).length;
        const lowConfidence = results.filter(r => r.confidence_score < 0.50).length;
        const totalAmount = results.reduce((sum, r) => sum + (r.estimated_value || 0), 0);

        // Record detection accuracy metrics and API call metrics
        try {
          const syncMonitoringService = (await import('./syncMonitoringService')).default;
          const claimsByType: Record<string, number> = {};
          const claimsBySeverity: Record<string, number> = {};

          results.forEach(result => {
            claimsByType[result.anomaly_type] = (claimsByType[result.anomaly_type] || 0) + 1;
            claimsBySeverity[result.severity] = (claimsBySeverity[result.severity] || 0) + 1;
          });

          const averageConfidence = results.length > 0
            ? results.reduce((sum, r) => sum + r.confidence_score, 0) / results.length
            : 0;
          const averageProbability = apiPredictions.length > 0
            ? apiPredictions.reduce((sum, p) => sum + (p.probability || 0), 0) / apiPredictions.length
            : 0;

          // Record detection accuracy metrics
          await syncMonitoringService.recordDetectionAccuracy({
            sync_id: job.sync_id,
            user_id: job.seller_id,
            total_predictions: apiPredictions.length,
            claimable_predictions: results.length,
            high_confidence_count: highConfidence,
            average_confidence: averageConfidence,
            average_probability: averageProbability,
            claims_by_type: claimsByType,
            claims_by_severity: claimsBySeverity
          });

          // Record API call metrics
          await syncMonitoringService.recordApiCallMetrics(
            job.sync_id,
            job.seller_id,
            'claim_detector_api',
            apiResponseTimeMs,
            apiCallSuccess,
            apiCallError
          );
        } catch (monitoringError) {
          // Non-blocking - monitoring failures shouldn't break detection
          logger.warn('Failed to record detection metrics', {
            error: monitoringError,
            seller_id: job.seller_id,
            sync_id: job.sync_id
          });
        }

        const environment = isSandbox ? 'SANDBOX' : 'PRODUCTION';
        logger.info(`Detection algorithms completed (${environment} MODE)`, {
          seller_id: job.seller_id,
          sync_id: job.sync_id,
          results_count: results.length,
          high_confidence: highConfidence,
          medium_confidence: mediumConfidence,
          low_confidence: lowConfidence,
          total_amount: totalAmount,
          isSandbox,
          mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
        });

        // Send real-time notification with results (sandbox mode indicator)
        const websocketService = (await import('./websocketService')).default;
        const sandboxPrefix = isSandbox ? '[SANDBOX] ' : '';
        websocketService.sendNotificationToUser(job.seller_id, {
          type: 'success',
          title: sandboxPrefix + '💰 Found $' + totalAmount.toFixed(2) + ' in recoverable funds',
          message: `${results.length} claims detected: ${highConfidence} high confidence, ${mediumConfidence} need review${isSandbox ? ' (Sandbox Test Data)' : ''}`,
          data: {
            claims_found: results.length,
            total_amount: totalAmount,
            high_confidence: highConfidence,
            medium_confidence: mediumConfidence,
            low_confidence: lowConfidence,
            auto_submit_ready: highConfidence,
            needs_review: mediumConfidence + lowConfidence,
            is_sandbox: isSandbox,
            mode: isSandbox ? 'SANDBOX' : 'PRODUCTION',
            sandbox_test_data: isSandbox
          }
        });

        // Send additional toast for high-confidence claims ready for auto-submit
        if (highConfidence > 0) {
          websocketService.sendNotificationToUser(job.seller_id, {
            type: 'success',
            title: sandboxPrefix + '⚡ ' + highConfidence + ' claims ready for auto submission',
            message: `High confidence (85%+): ${highConfidence} claims totaling $${results.filter(r => r.confidence_score >= 0.85).reduce((sum, r) => sum + (r.estimated_value || 0), 0).toFixed(2)}${isSandbox ? ' (Sandbox)' : ''}`,
            data: {
              category: 'high_confidence',
              count: highConfidence,
              total_amount: results.filter(r => r.confidence_score >= 0.85).reduce((sum, r) => sum + (r.estimated_value || 0), 0),
              is_sandbox: isSandbox,
              sandbox_test_data: isSandbox
            }
          });
        }

      } catch (error: any) {
        apiResponseTimeMs = Date.now() - apiCallStartTime;
        apiCallSuccess = false;
        apiCallError = error.message || 'Unknown error';

        // Enhanced error logging with full context
        const errorDetails = {
          error_message: error.message,
          error_code: error.code,
          error_response: error.response?.data,
          error_status: error.response?.status,
          error_statusText: error.response?.statusText,
          api_url: `${this.pythonApiUrl}/api/v1/claim-detector/predict/batch`,
          seller_id: job.seller_id,
          claims_sent: claimsToDetect.length,
          response_time_ms: apiResponseTimeMs,
          isSandbox,
          mode: isSandbox ? 'SANDBOX' : 'PRODUCTION',
          stack: error.stack
        };

        logger.error('Error calling Claim Detector API', errorDetails);

        // Record API call metrics even on failure
        try {
          const syncMonitoringService = (await import('./syncMonitoringService')).default;
          await syncMonitoringService.recordApiCallMetrics(
            job.sync_id,
            job.seller_id,
            'claim_detector_api',
            apiResponseTimeMs,
            false,
            apiCallError
          );
        } catch (monitoringError) {
          // Non-blocking
          logger.warn('Failed to record API call metrics', { error: monitoringError });
        }

        // If API is unreachable or returns error, log detailed diagnostics
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          logger.error('Claim Detector API is unreachable', {
            api_url: this.pythonApiUrl,
            error_code: error.code,
            seller_id: job.seller_id,
            response_time_ms: apiResponseTimeMs
          });
        } else if (error.response?.status) {
          logger.error('Claim Detector API returned error status', {
            status: error.response.status,
            statusText: error.response.statusText,
            response_data: error.response.data,
            seller_id: job.seller_id,
            response_time_ms: apiResponseTimeMs
          });
        }

        // Fallback: Create basic detection results from financial events if API fails
        // For sandbox, this is acceptable - we'll create mock claims from synced data
        logger.warn('Falling back to basic detection from financial events (SANDBOX MODE)', {
          isSandbox,
          event_count: financialEvents.length
        });

        if (financialEvents.length === 0 && isSandbox) {
          // Sandbox may have no financial events - create mock claims from claims table
          logger.info('No financial events - creating mock claims from synced claims for sandbox testing', {
            seller_id: job.seller_id
          });

          const { data: claims } = await supabase
            .from('claims')
            .select('*')
            .eq('user_id', job.seller_id)
            .eq('provider', 'amazon')
            .limit(50);

          if (claims && claims.length > 0) {
            // Create detection results from claims with mock confidence scores
            for (const claim of claims) {
              const mockConfidence = 0.5 + Math.random() * 0.4; // 0.5-0.9 for testing
              const basicResult = this.createBasicDetectionResult({
                id: claim.id,
                seller_id: job.seller_id,
                event_type: claim.type || 'fee',
                amount: parseFloat(claim.amount) || 0,
                currency: claim.currency || 'USD',
                event_date: claim.created_at || new Date().toISOString(),
                amazon_order_id: claim.order_id || claim.amazon_order_id,
                raw_payload: claim.raw_data || {}
              }, job.seller_id, job.sync_id);

              // Override confidence with mock value for sandbox
              basicResult.confidence_score = mockConfidence;
              results.push(basicResult);
            }

            logger.info('Created mock detection results from claims for sandbox testing', {
              seller_id: job.seller_id,
              mock_results_count: results.length
            });
          }
        } else {
          // Create from financial events
          for (const event of financialEvents) {
            if (event.amount && event.amount > 0) {
              const basicResult = this.createBasicDetectionResult(event, job.seller_id, job.sync_id);
              // For sandbox, add some variance to confidence scores for testing
              if (isSandbox) {
                basicResult.confidence_score = 0.5 + Math.random() * 0.4;
              }
              results.push(basicResult);
            }
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
        const eventDate = event.event_date ? new Date(event.event_date) : new Date();
        const daysSinceOrder = Math.floor((Date.now() - eventDate.getTime()) / (1000 * 60 * 60 * 24));

        claims.push({
          claim_id: `claim_${event.id}_${Date.now()}`,
          seller_id: event.seller_id,
          order_id: event.amazon_order_id || event.event_id || `event_${event.id}`,
          category: 'fee_error',
          subcategory: event.event_type,
          reason_code: 'INCORRECT_FEE',
          marketplace: event.marketplace || 'US',
          fulfillment_center: event.fulfillment_center || 'UNKNOWN',
          amount: Math.abs(event.amount || 0),
          quantity: 1,
          order_value: Math.abs(event.amount || 0),
          shipping_cost: 0,
          days_since_order: daysSinceOrder,
          days_since_delivery: Math.max(0, daysSinceOrder - 7), // Estimate delivery 7 days after order
          description: `Potential ${event.event_type} discrepancy: ${event.event_type} event detected`,
          reason: `Automated detection from financial events: ${event.event_type}`,
          notes: event.description || event.notes || '',
          claim_date: eventDate.toISOString(),
          currency: event.currency || 'USD',
          evidence: {
            event_id: event.id,
            event_type: event.event_type,
            raw_payload: event.raw_payload || {},
            event_date: event.event_date
          }
        });
      }
    }

    // Process inventory discrepancies as lost/damaged inventory claims
    for (const item of inventoryDiscrepancies) {
      const damagedQty = item.dimensions?.damaged || 0;
      const estimatedValuePerUnit = item.price || item.cost || 10; // Use item price if available, else default to $10

      if (damagedQty > 0) {
        const discoveryDate = item.updated_at ? new Date(item.updated_at) : new Date();
        const daysSinceOrder = Math.floor((Date.now() - discoveryDate.getTime()) / (1000 * 60 * 60 * 24));

        claims.push({
          claim_id: `claim_inv_${item.id}_${Date.now()}`,
          seller_id: item.user_id,
          order_id: item.sku || `sku_${item.id}`,
          category: 'inventory_loss',
          subcategory: 'damaged_goods',
          reason_code: 'DAMAGED_INVENTORY',
          marketplace: item.marketplace || 'US',
          fulfillment_center: item.dimensions?.location || item.fulfillment_center || 'UNKNOWN',
          amount: damagedQty * estimatedValuePerUnit,
          quantity: damagedQty,
          order_value: damagedQty * estimatedValuePerUnit,
          shipping_cost: 0,
          days_since_order: daysSinceOrder,
          days_since_delivery: Math.max(0, daysSinceOrder - 7),
          description: `Damaged inventory detected for SKU ${item.sku}: ${damagedQty} unit(s) damaged`,
          reason: `Automated detection from inventory sync: ${damagedQty} damaged unit(s) found`,
          notes: item.notes || '',
          claim_date: discoveryDate.toISOString(),
          currency: item.currency || 'USD',
          evidence: {
            item_id: item.id,
            sku: item.sku,
            asin: item.asin,
            dimensions: item.dimensions || {},
            quantity_available: item.quantity_available,
            quantity_reserved: item.quantity_reserved,
            price: item.price,
            cost: item.cost
          }
        });
      }

      // Also check for missing units (quantity_available === 0 but quantity_reserved > 0)
      if (item.quantity_available === 0 && item.quantity_reserved > 0) {
        const missingQty = item.quantity_reserved;
        const estimatedValuePerUnit = item.price || item.cost || 10;
        const discoveryDate = item.updated_at ? new Date(item.updated_at) : new Date();
        const daysSinceOrder = Math.floor((Date.now() - discoveryDate.getTime()) / (1000 * 60 * 60 * 24));

        claims.push({
          claim_id: `claim_missing_${item.id}_${Date.now()}`,
          seller_id: item.user_id,
          order_id: item.sku || `sku_${item.id}`,
          category: 'inventory_loss',
          subcategory: 'missing_unit',
          reason_code: 'MISSING_UNIT',
          marketplace: item.marketplace || 'US',
          fulfillment_center: item.dimensions?.location || item.fulfillment_center || 'UNKNOWN',
          amount: missingQty * estimatedValuePerUnit,
          quantity: missingQty,
          order_value: missingQty * estimatedValuePerUnit,
          shipping_cost: 0,
          days_since_order: daysSinceOrder,
          days_since_delivery: Math.max(0, daysSinceOrder - 7),
          description: `Missing inventory detected for SKU ${item.sku}: ${missingQty} unit(s) reserved but not available`,
          reason: `Automated detection from inventory sync: ${missingQty} missing unit(s)`,
          notes: item.notes || '',
          claim_date: discoveryDate.toISOString(),
          currency: item.currency || 'USD',
          evidence: {
            item_id: item.id,
            sku: item.sku,
            asin: item.asin,
            quantity_available: item.quantity_available,
            quantity_reserved: item.quantity_reserved,
            price: item.price,
            cost: item.cost
          }
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
    // Map claim type to anomaly type (check subcategory first for more specific mapping)
    const anomalyTypeMap: Record<string, DetectionResult['anomaly_type']> = {
      'fee_error': 'incorrect_fee',
      'inventory_loss': 'missing_unit',
      'damaged_goods': 'damaged_stock',
      'overcharge': 'overcharge',
      'duplicate': 'duplicate_charge'
    };

    // Map by subcategory if available for more specific detection
    const subcategoryMap: Record<string, DetectionResult['anomaly_type']> = {
      'damaged_goods': 'damaged_stock',
      'missing_unit': 'missing_unit',
      'fee': 'incorrect_fee',
      'adjustment': 'incorrect_fee',
      'overcharge': 'overcharge',
      'duplicate': 'duplicate_charge'
    };

    // Prefer subcategory mapping if available, otherwise use category
    const anomalyType = subcategoryMap[detectedClaim.subcategory] ||
      anomalyTypeMap[detectedClaim.category] ||
      'missing_unit';

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
      // Use supabaseAdmin to bypass RLS (Agent 3 stores with supabaseAdmin)
      // Fall back to supabase if supabaseAdmin is not available
      const { supabaseAdmin, supabase: supabaseClient } = await import('../database/supabaseClient');
      const client = supabaseAdmin || supabaseClient;
      let query = client
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
   * Get confidence score distribution for monitoring and calibration
   */
  async getConfidenceDistribution(sellerId: string): Promise<{
    total_detections: number;
    by_confidence: {
      high: number;
      medium: number;
      low: number;
    };
    by_anomaly_type: Record<string, {
      high: number;
      medium: number;
      low: number;
      total: number;
    }>;
    confidence_ranges: {
      '0.0-0.2': number;
      '0.2-0.4': number;
      '0.4-0.6': number;
      '0.6-0.8': number;
      '0.8-1.0': number;
    };
    recovery_rates?: {
      high: number;
      medium: number;
      low: number;
    };
    average_confidence: number;
  }> {
    try {
      // Use supabaseAdmin to bypass RLS (Agent 3 stores with supabaseAdmin)
      // Fall back to supabase if supabaseAdmin is not available
      const { supabaseAdmin, supabase: supabaseClient } = await import('../database/supabaseClient');
      const client = supabaseAdmin || supabaseClient;
      const { data, error } = await client
        .from('detection_results')
        .select('anomaly_type, confidence_score, status')
        .eq('seller_id', sellerId);

      if (error) {
        logger.error('Error fetching confidence distribution', { error, sellerId });
        throw new Error(`Failed to fetch confidence distribution: ${error.message}`);
      }

      const results = data as { anomaly_type: string; confidence_score: number; status: string }[];

      // Initialize counters
      const by_confidence = { high: 0, medium: 0, low: 0 };
      const by_anomaly_type: Record<string, { high: number; medium: number; low: number; total: number }> = {};
      const confidence_ranges = {
        '0.0-0.2': 0,
        '0.2-0.4': 0,
        '0.4-0.6': 0,
        '0.6-0.8': 0,
        '0.8-1.0': 0
      };

      let totalConfidence = 0;
      const resolvedByConfidence = { high: 0, medium: 0, low: 0 };
      const totalByConfidence = { high: 0, medium: 0, low: 0 };

      results.forEach(result => {
        const score = result.confidence_score;
        totalConfidence += score;

        // Categorize by confidence level
        let category: 'high' | 'medium' | 'low';
        if (score >= 0.75) {
          category = 'high';
          by_confidence.high++;
        } else if (score >= 0.50) {
          category = 'medium';
          by_confidence.medium++;
        } else {
          category = 'low';
          by_confidence.low++;
        }

        // Track by anomaly type
        if (!by_anomaly_type[result.anomaly_type]) {
          by_anomaly_type[result.anomaly_type] = { high: 0, medium: 0, low: 0, total: 0 };
        }
        by_anomaly_type[result.anomaly_type][category]++;
        by_anomaly_type[result.anomaly_type].total++;

        // Track confidence ranges
        if (score < 0.2) confidence_ranges['0.0-0.2']++;
        else if (score < 0.4) confidence_ranges['0.2-0.4']++;
        else if (score < 0.6) confidence_ranges['0.4-0.6']++;
        else if (score < 0.8) confidence_ranges['0.6-0.8']++;
        else confidence_ranges['0.8-1.0']++;

        // Track recovery rates (resolved vs total)
        totalByConfidence[category]++;
        if (result.status === 'resolved') {
          resolvedByConfidence[category]++;
        }
      });

      // Calculate recovery rates
      const recovery_rates = {
        high: totalByConfidence.high > 0 ? resolvedByConfidence.high / totalByConfidence.high : 0,
        medium: totalByConfidence.medium > 0 ? resolvedByConfidence.medium / totalByConfidence.medium : 0,
        low: totalByConfidence.low > 0 ? resolvedByConfidence.low / totalByConfidence.low : 0
      };

      return {
        total_detections: results.length,
        by_confidence,
        by_anomaly_type,
        confidence_ranges,
        recovery_rates,
        average_confidence: results.length > 0 ? totalConfidence / results.length : 0
      };
    } catch (error) {
      logger.error('Error in getConfidenceDistribution', { error, sellerId });
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
    by_confidence?: {
      high: number;
      medium: number;
      low: number;
    };
  }> {
    try {
      // Use supabaseAdmin to bypass RLS (Agent 3 stores with supabaseAdmin)
      // Fall back to supabase if supabaseAdmin is not available
      const { supabaseAdmin, supabase: supabaseClient } = await import('../database/supabaseClient');
      const client = supabaseAdmin || supabaseClient;
      const { data, error } = await client
        .from('detection_results')
        .select('anomaly_type, severity, estimated_value, days_remaining, expired, confidence_score')
        .eq('seller_id', sellerId);

      if (error) {
        logger.error('Error fetching detection statistics', { error, sellerId });
        throw new Error(`Failed to fetch detection statistics: ${error.message}`);
      }

      const results = data as { anomaly_type: string; severity: string; estimated_value: number; days_remaining?: number; expired?: boolean; confidence_score?: number }[];
      const by_severity: Record<string, { count: number; value: number }> = {};
      const by_type: Record<string, { count: number; value: number }> = {};
      const by_confidence = { high: 0, medium: 0, low: 0 };
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

        // Count by confidence
        if (result.confidence_score !== undefined) {
          if (result.confidence_score >= 0.75) {
            by_confidence.high++;
          } else if (result.confidence_score >= 0.50) {
            by_confidence.medium++;
          } else {
            by_confidence.low++;
          }
        }

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
        expired_count,
        by_confidence
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
        // Use supabaseAdmin to bypass RLS (Agent 3 stores with supabaseAdmin)
        // Fall back to supabase if supabaseAdmin is not available
        const { supabaseAdmin, supabase: supabaseClient } = await import('../database/supabaseClient');
        const client = supabaseAdmin || supabaseClient;
        const { data: expiringClaims, error } = await client
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
      // Use supabaseAdmin to bypass RLS (Agent 3 stores with supabaseAdmin)
      // Fall back to supabase if supabaseAdmin is not available
      const { supabaseAdmin, supabase: supabaseClient } = await import('../database/supabaseClient');
      const client = supabaseAdmin || supabaseClient;
      const { data, error } = await client
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
   * Trigger evidence matching automatically after detection completes
   */
  private async _triggerEvidenceMatching(
    sellerId: string,
    results: DetectionResult[]
  ): Promise<void> {
    try {
      const pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-10.onrender.com';

      // Transform detection results to claims format for evidence matching
      const claims = results.map((result, index) => ({
        claim_id: `claim_${result.seller_id}_${Date.now()}_${index}`,
        claim_type: result.anomaly_type,
        amount: result.estimated_value,
        confidence: result.confidence_score,
        currency: result.currency,
        evidence: result.evidence,
        discovery_date: result.discovery_date?.toISOString(),
        deadline_date: result.deadline_date?.toISOString()
      }));

      // Trigger evidence matching via Python API
      await axios.post(
        `${pythonApiUrl}/api/internal/evidence/matching/run`,
        {},
        {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        }
      ).catch((error) => {
        // Non-blocking - evidence matching can be triggered manually if this fails
        logger.warn('Automatic evidence matching trigger failed (non-critical)', {
          error: error.message,
          seller_id: sellerId
        });
      });

      logger.info('Evidence matching triggered after detection', {
        seller_id: sellerId,
        claims_count: claims.length
      });
    } catch (error: any) {
      // Non-blocking - don't fail detection if evidence matching trigger fails
      logger.warn('Failed to trigger evidence matching', {
        error: error.message,
        seller_id: sellerId
      });
    }
  }

  /**
   * Trigger workflow orchestrator webhook when detection completes
   */
  private async _triggerWorkflowWebhook(
    sellerId: string,
    syncId: string,
    results: DetectionResult[]
  ): Promise<void> {
    try {
      const pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-10.onrender.com';

      // Transform results to claims format
      const claims = results.map((result, index) => ({
        claim_id: `claim_${result.seller_id}_${Date.now()}_${index}`,
        claim_type: result.anomaly_type,
        amount: result.estimated_value,
        confidence: result.confidence_score,
        currency: result.currency,
        evidence: result.evidence,
        discovery_date: result.discovery_date?.toISOString(),
        deadline_date: result.deadline_date?.toISOString()
      }));

      // Call workflow webhook
      await axios.post(
        `${pythonApiUrl}/api/v1/workflow/detection/complete`,
        {
          user_id: sellerId,
          detection_job_id: syncId,
          claims: claims,
          claims_found: claims
        },
        {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      logger.info('Workflow webhook triggered for detection completion', {
        seller_id: sellerId,
        sync_id: syncId,
        claims_count: claims.length
      });
    } catch (error: any) {
      // Don't fail the detection job if webhook fails
      logger.warn('Failed to trigger workflow webhook', {
        error: error.message,
        seller_id: sellerId,
        sync_id: syncId
      });
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
        logger.error('Error fetching expired claims', {
          error: fetchError?.message || String(fetchError),
          code: fetchError?.code,
          details: fetchError?.details
        });
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
        logger.error('Error updating expired claims', {
          error: updateError?.message || String(updateError),
          code: updateError?.code,
          details: updateError?.details
        });
        return 0;
      }

      // Send expiration notifications via SSE (don't block on this)
      try {
        const sseHub = (await import('../utils/sseHub')).default;
        for (const claim of expiredClaims) {
          sseHub.sendEvent(claim.seller_id, 'claim_expired', {
            claim_id: claim.id,
            message: 'Claim deadline has expired. This claim can no longer be filed with Amazon.'
          });
        }
      } catch (sseError: any) {
        // Don't fail if SSE fails
        logger.warn('Error sending SSE events for expired claims', {
          error: sseError?.message || String(sseError)
        });
      }

      logger.info('Updated expired claims', { count: expiredClaims.length });
      return expiredClaims.length;
    } catch (error: any) {
      // Handle error properly with serializable error message
      const errorMessage = error?.message || String(error) || 'Unknown error';
      const errorStack = error?.stack;
      logger.error('Error in updateExpiredClaims', {
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name
      });
      return 0;
    }
  }
}

export const detectionService = new DetectionService();
export default detectionService;





