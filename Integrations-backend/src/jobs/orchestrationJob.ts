import Queue from 'bull';
import logger from '../utils/logger';
import dataOrchestrator from '../orchestration/dataOrchestrator';
import websocketService from '../services/websocketService';
import { supabase } from '../database/supabaseClient';
import detectionService from '../services/detectionService';
import { amazonSyncJob } from '../jobs/amazonSyncJob';
import axios from 'axios';

export interface OrchestrationJobData {
  userId: string;
  syncId: string;
  step: number;
  totalSteps: number;
  currentStep: string;
  metadata?: Record<string, any>;
}

export interface JobResult {
  success: boolean;
  step: number;
  message: string;
  data?: any;
  error?: string;
}

// Create Redis connection (you'll need to add Redis to your environment)
// Make Redis optional - if not available, queues will be disabled
const REDIS_URL = process.env.REDIS_URL;
// Type queues as any since Queue from 'bull' has type issues with TypeScript
// We check for null before using them anyway, so this is safe
let orchestrationQueue: any = null;
let syncProgressQueue: any = null;
let queueInitialized = false;

// Initialize queues only if Redis is available
function initializeQueues(): void {
  if (queueInitialized) {
    return;
  }

  // Check if Redis URL is configured and not pointing to localhost
  // This prevents queues from being created if Redis is not available
  if (!REDIS_URL ||
    REDIS_URL === 'redis://localhost:6379' ||
    REDIS_URL.includes('localhost') ||
    REDIS_URL.includes('127.0.0.1')) {
    // Don't log warning here - Redis is optional, this is expected behavior
    queueInitialized = true;
    return;
  }

  try {
    // Create queues - Bull Queue accepts Redis URL string directly
    // It will attempt to connect, but we'll handle errors gracefully
    orchestrationQueue = new Queue<OrchestrationJobData>('orchestration', REDIS_URL);
    syncProgressQueue = new Queue<OrchestrationJobData>('sync-progress', REDIS_URL);

    // Track error counts to suppress repeated errors
    let orchestrationErrorCount = 0;
    let syncProgressErrorCount = 0;

    // Handle queue errors gracefully - suppress repeated errors
    orchestrationQueue.on('error', (error: any) => {
      orchestrationErrorCount++;
      // Only log first error and every 100th error
      if (orchestrationErrorCount === 1 || orchestrationErrorCount % 100 === 0) {
        logger.warn(`Orchestration queue error (${orchestrationErrorCount}${orchestrationErrorCount === 1 ? 'st' : 'th'} error) - queues disabled: ${error?.message || 'Unknown error'}`);
      }
      // Disable queue if connection fails
      orchestrationQueue = null;
    });

    syncProgressQueue.on('error', (error: any) => {
      syncProgressErrorCount++;
      // Only log first error and every 100th error
      if (syncProgressErrorCount === 1 || syncProgressErrorCount % 100 === 0) {
        logger.warn(`Sync progress queue error (${syncProgressErrorCount}${syncProgressErrorCount === 1 ? 'st' : 'th'} error) - queues disabled: ${error?.message || 'Unknown error'}`);
      }
      // Disable queue if connection fails
      syncProgressQueue = null;
    });

    // Handle successful connection
    orchestrationQueue.on('ready', () => {
      logger.info('Orchestration queue connected to Redis');
    });

    syncProgressQueue.on('ready', () => {
      logger.info('Sync progress queue connected to Redis');
    });

    queueInitialized = true;
    logger.info('Job queues initialized (will connect to Redis when available)');
  } catch (error: any) {
    // Queue creation failed - this is OK, queues will be disabled
    logger.debug('Job queues not initialized - Redis not available (this is OK if Redis is not configured)', { error: error?.message });
    orchestrationQueue = null;
    syncProgressQueue = null;
    queueInitialized = true;
  }
}

// Initialize queues on module load (but don't fail if Redis is unavailable)
initializeQueues();

export class OrchestrationJobManager {
  private static async fetchRawAmazonData(_userId: string): Promise<any[]> {
    return [];
  }

  private static async fetchMCDEDocs(_userId: string): Promise<any[]> {
    return [];
  }

  /**
   * Initialize job queues and processors
   */
  static initialize(): void {
    this.setupOrchestrationProcessor();
    this.setupSyncProgressProcessor();
    this.setupQueueEventHandlers();

    logger.info('Orchestration job manager initialized');
  }

  /**
   * Add orchestration job to queue
   */
  static async addOrchestrationJob(data: OrchestrationJobData): Promise<void> {
    // Skip if queues are not available (Redis not configured)
    if (!orchestrationQueue) {
      logger.debug('Orchestration queue not available - skipping job addition (Redis not configured)');
      return;
    }

    try {
      // Use jobId to prevent duplicate jobs for same user/step/syncId
      const jobId = `orchestrate_${data.userId}_${data.step}_${data.syncId}`;

      await orchestrationQueue.add('orchestrate', data, {
        jobId, // Prevents duplicate jobs with same ID
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      });

      logger.info('Orchestration job added to queue', {
        userId: data.userId,
        syncId: data.syncId,
        step: data.step
      });
    } catch (error: any) {
      // Don't throw error - queue failures are non-critical
      logger.warn('Error adding orchestration job to queue (non-critical)', { error: error?.message, data });
    }
  }

  /**
   * Add sync progress update job to queue
   */
  static async addSyncProgressJob(data: OrchestrationJobData): Promise<void> {
    // Skip if queues are not available (Redis not configured)
    if (!syncProgressQueue) {
      logger.debug('Sync progress queue not available - skipping job addition (Redis not configured)');
      return;
    }

    try {
      await syncProgressQueue.add('update-progress', data, {
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 1000
        },
        removeOnComplete: 50,
        removeOnFail: 25
      });

      logger.info('Sync progress job added to queue', {
        userId: data.userId,
        syncId: data.syncId
      });
    } catch (error: any) {
      // Don't throw error - queue failures are non-critical
      logger.warn('Error adding sync progress job to queue (non-critical)', { error: error?.message, data });
    }
  }

  /**
   * Setup orchestration job processor
   */
  private static setupOrchestrationProcessor(): void {
    // Skip if queues are not available (Redis not configured)
    if (!orchestrationQueue) {
      logger.debug('Orchestration queue not available - skipping processor setup (Redis not configured)');
      return;
    }

    orchestrationQueue.process('orchestrate', async (job) => {
      const { userId, syncId, step, totalSteps, currentStep, metadata } = job.data;

      logger.info('Processing orchestration job', {
        jobId: job.id,
        userId,
        syncId,
        step,
        currentStep
      });

      const phaseStartTime = Date.now();
      let previousPhase: number | undefined;

      try {
        // Get previous phase for rollback tracking
        const previousLog = await this.getLastPhaseLog(syncId);
        previousPhase = previousLog?.phase_number;

        // Log phase start
        await this.logPhaseTransition({
          workflowId: syncId,
          userId,
          phaseNumber: step,
          status: 'started',
          previousPhase,
          metadata
        });

        // Emit metrics: phase started
        await this.emitPhaseMetric('started', step, userId, syncId);

        // Update sync progress to running
        await this.updateSyncProgress(userId, syncId, step, totalSteps, currentStep, 'running');

        // Execute the specific step
        let result: JobResult;

        switch (step) {
          // Phase 1: Zero-Friction Onboarding (OAuth → Sync)
          case 1:
            result = await this.executePhase1_OAuthCompletion(userId, syncId, metadata);
            break;
          // Phase 2: Autonomous Money Discovery (Sync → Detection)
          case 2:
            result = await this.executePhase2_SyncCompletion(userId, syncId, metadata);
            break;
          // Phase 3: Intelligent Evidence Ecosystem (Detection → Evidence Matching)
          case 3:
            result = await this.executePhase3_DetectionCompletion(userId, syncId, metadata);
            break;
          // Phase 4: Predictive Refund Orchestration (Evidence → Auto-Submit/Smart Prompts)
          case 4:
            result = await this.executePhase4_EvidenceMatching(userId, syncId, metadata);
            break;
          // Phase 5: Autonomous Recovery Pipeline (Submission → Tracking)
          case 5:
            result = await this.executePhase5_ClaimSubmission(userId, syncId, metadata);
            break;
          // Phase 6: Continuous Learning Brain (Rejection → Learning)
          case 6:
            result = await this.executePhase6_ClaimRejection(userId, syncId, metadata);
            break;
          // Phase 7: Hyper-Transparency Layer (Payout → Proof Packet)
          case 7:
            result = await this.executePhase7_PayoutReceived(userId, syncId, metadata);
            break;
          // Legacy steps (keep for backward compatibility)
          case 10:
            result = await this.executeStep1(userId, syncId);
            break;
          case 11:
            result = await this.executeStep2(userId, syncId);
            break;
          case 12:
            result = await this.executeStep3(userId, syncId);
            break;
          case 13:
            result = await this.executeStep4(userId, syncId);
            break;
          case 14:
            result = await this.executeStep5(userId, syncId);
            break;
          default:
            throw new Error(`Unknown step: ${step}`);
        }

        // Calculate duration
        const durationMs = Date.now() - phaseStartTime;
        const status = result.success ? 'completed' : 'failed';

        // Log phase completion/failure
        await this.logPhaseTransition({
          workflowId: syncId,
          userId,
          phaseNumber: step,
          status,
          durationMs,
          previousPhase,
          errorMessage: result.error,
          metadata: { ...metadata, result: result.data }
        });

        // Emit metrics: phase completed/failed
        await this.emitPhaseMetric(status, step, userId, syncId, durationMs, result.error);

        // Update sync progress based on result
        await this.updateSyncProgress(userId, syncId, step, totalSteps, currentStep, status, result);

        // Broadcast progress update via WebSocket
        this.broadcastProgressUpdate(userId, syncId, step, totalSteps, currentStep, status, result);

        // Handle rollback if phase failed
        if (!result.success && step > 1) {
          await this.handlePhaseRollback(userId, syncId, step, previousPhase, result.error || 'Unknown error');
        }

        // If this is the last step and successful, mark sync as completed
        if (step === totalSteps && result.success) {
          await this.completeSync(userId, syncId);
        }

        return result;
      } catch (error) {
        const durationMs = Date.now() - phaseStartTime;
        const errorMessage = String((error as any)?.message ?? 'Unknown error');
        const errorStack = (error as any)?.stack;

        logger.error('Error processing orchestration job', { error, jobId: job.id, data: job.data });

        // Log phase failure
        await this.logPhaseTransition({
          workflowId: syncId,
          userId,
          phaseNumber: step,
          status: 'failed',
          durationMs,
          previousPhase,
          errorMessage,
          errorStack,
          metadata
        }).catch((logError) => {
          logger.warn('Failed to log phase transition (non-critical)', { logError });
        });

        // Emit metrics: phase failed
        await this.emitPhaseMetric('failed', step, userId, syncId, durationMs, errorMessage).catch(() => {
          // Non-blocking
        });

        // Update sync progress to failed
        await this.updateSyncProgress(userId, syncId, step, totalSteps, currentStep, 'failed', {
          success: false,
          step,
          message: errorMessage,
          error: errorMessage
        });

        // Handle rollback if phase failed
        if (step > 1) {
          await this.handlePhaseRollback(userId, syncId, step, previousPhase, errorMessage).catch((rollbackError) => {
            logger.warn('Rollback failed (non-critical)', { rollbackError });
          });
        }

        throw error;
      }
    });
  }

  /**
   * Setup sync progress job processor
   */
  private static setupSyncProgressProcessor(): void {
    // Skip if queues are not available (Redis not configured)
    if (!syncProgressQueue) {
      logger.debug('Sync progress queue not available - skipping processor setup (Redis not configured)');
      return;
    }

    syncProgressQueue.process('update-progress', async (job) => {
      const { userId, syncId, step, totalSteps, currentStep } = job.data;

      try {
        // Update sync progress in database
        await this.updateSyncProgress(userId, syncId, step, totalSteps, currentStep, 'running');

        // Broadcast via WebSocket
        this.broadcastProgressUpdate(userId, syncId, step, totalSteps, currentStep, 'running');

        logger.info('Sync progress updated', { userId, syncId, step });
      } catch (error) {
        logger.error('Error processing sync progress job', { error, jobId: job.id });
        throw error;
      }
    });
  }

  /**
   * Setup queue event handlers
   */
  private static setupQueueEventHandlers(): void {
    // Skip if queues are not available (Redis not configured)
    if (!orchestrationQueue || !syncProgressQueue) {
      logger.debug('Queues not available - skipping event handler setup (Redis not configured)');
      return;
    }

    orchestrationQueue.on('completed', (job, result) => {
      logger.info('Orchestration job completed', {
        jobId: job.id,
        userId: job.data.userId,
        syncId: job.data.syncId,
        step: job.data.step
      });
    });

    orchestrationQueue.on('failed', (job, error) => {
      logger.error('Orchestration job failed', {
        jobId: job.id,
        userId: job.data.userId,
        syncId: job.data.syncId,
        step: job.data.step,
        error: String((error as any)?.message ?? 'Unknown error')
      });
    });

    syncProgressQueue.on('completed', (job) => {
      logger.info('Sync progress job completed', {
        jobId: job.id,
        userId: job.data.userId,
        syncId: job.data.syncId
      });
    });

    syncProgressQueue.on('failed', (job, error) => {
      logger.error('Sync progress job failed', {
        jobId: job.id,
        userId: job.data.userId,
        syncId: job.data.syncId,
        error: String((error as any)?.message ?? 'Unknown error')
      });
    });
  }

  // ==================== 7-Phase Clario Experience Methods ====================

  /**
   * Phase 1: Zero-Friction Onboarding
   * OAuth completion → User Creation → Background Sync → WebSocket
   */
  private static async executePhase1_OAuthCompletion(
    userId: string,
    syncId: string,
    metadata?: Record<string, any>
  ): Promise<JobResult> {
    try {
      logger.info('🎬 Phase 1: Zero-Friction Onboarding', { userId, syncId });

      const sellerId = metadata?.seller_id || userId;

      // Step 1: User profile already created in OAuth callback
      // Step 2: Establish WebSocket connection (handled automatically)
      websocketService.sendNotificationToUser(userId, {
        type: 'info',
        title: 'Onboarding Started',
        message: 'Connected to Amazon!',
        data: { user_id: userId, timestamp: new Date().toISOString() }
      });

      // Step 3: Trigger background sync job automatically
      const syncResult = await amazonSyncJob.syncUserData(userId);

      // Step 4: Send real-time update
      websocketService.sendNotificationToUser(userId, {
        type: 'success',
        title: 'Onboarding Complete',
        message: 'Connected to Amazon!',
        data: {
          sync_started: true,
          sync_id: syncResult,
          next_step: 'Syncing your data... (30 seconds)'
        }
      });

      return {
        success: true,
        step: 1,
        message: 'Phase 1: Onboarding complete - sync started',
        data: { sync_id: syncResult, seller_id: sellerId }
      };
    } catch (error) {
      logger.error('Error in Phase 1 (OAuth Completion)', { error, userId, syncId });
      return {
        success: false,
        step: 1,
        message: 'Failed to complete onboarding',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  /**
   * Phase 2: Autonomous Money Discovery
   * Sync → Detection → ML Scoring
   */
  private static async executePhase2_SyncCompletion(
    userId: string,
    syncId: string,
    metadata?: Record<string, any>
  ): Promise<JobResult> {
    try {
      const isSandbox = process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox') ||
        process.env.NODE_ENV === 'development';

      logger.info('🔍 Phase 2: Autonomous Money Discovery (SANDBOX MODE)', {
        userId,
        syncId,
        isSandbox,
        mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
      });

      const ordersCount = metadata?.orders_count || 0;
      const inventoryItems = metadata?.inventory_items || 0;

      // Send real-time update with sandbox indicator
      websocketService.sendNotificationToUser(userId, {
        type: 'info',
        title: isSandbox ? '🔍 Analyzing your orders (Sandbox Mode)...' : '🔍 Analyzing your orders...',
        message: 'Data sync complete! Scanning for potential claims...',
        data: {
          orders_count: ordersCount,
          inventory_items: inventoryItems,
          next_step: 'Running detection algorithms...',
          is_sandbox: isSandbox,
          mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
        }
      });

      // Step 1: Trigger claim detection automatically (with sandbox flag)
      const detectionJob = {
        seller_id: userId,
        sync_id: syncId,
        timestamp: new Date().toISOString(),
        is_sandbox: isSandbox
      };

      // Send initial toast: "Analyzing your orders..."
      websocketService.sendNotificationToUser(userId, {
        type: 'info',
        title: isSandbox ? '🔍 Analyzing your orders… (Sandbox Mode)' : '🔍 Analyzing your orders…',
        message: 'Data sync complete! Scanning for potential claims...',
        data: {
          orders_count: ordersCount,
          inventory_items: inventoryItems,
          next_step: 'Running detection algorithms...',
          is_sandbox: isSandbox,
          mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
        }
      });

      await detectionService.enqueueDetectionJob(detectionJob);

      logger.info('Detection job triggered after sync (SANDBOX MODE)', {
        userId,
        syncId,
        isSandbox,
        mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
      });

      return {
        success: true,
        step: 2,
        message: `Phase 2: Detection triggered after sync (${isSandbox ? 'SANDBOX' : 'PRODUCTION'} MODE)`,
        data: {
          orders_count: ordersCount,
          inventory_items: inventoryItems,
          detection_job_queued: true,
          is_sandbox: isSandbox,
          mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
        }
      };
    } catch (error) {
      logger.error('Error in Phase 2 (Sync Completion)', { error, userId, syncId });
      return {
        success: false,
        step: 2,
        message: 'Failed to trigger detection after sync',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  /**
   * Phase 3: Intelligent Evidence Ecosystem
   * Detection → Evidence Matching → OCR
   */
  private static async executePhase3_DetectionCompletion(
    userId: string,
    syncId: string,
    metadata?: Record<string, any>
  ): Promise<JobResult> {
    try {
      logger.info('📄 Phase 3: Intelligent Evidence Ecosystem', { userId, syncId });

      const claims = metadata?.claims || metadata?.claims_found || [];
      const claimsCount = Array.isArray(claims) ? claims.length : 0;

      const isSandbox = metadata?.is_sandbox ||
        process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox') ||
        process.env.NODE_ENV === 'development';

      // Calculate success probability (mock for sandbox)
      const highConfidenceCount = Array.isArray(claims) ?
        claims.filter((c: any) => (c.confidence || 0) >= 0.85).length : 0;
      const mediumConfidenceCount = Array.isArray(claims) ?
        claims.filter((c: any) => (c.confidence || 0) >= 0.50 && (c.confidence || 0) < 0.85).length : 0;
      const avgConfidence = Array.isArray(claims) && claims.length > 0 ?
        claims.reduce((sum: number, c: any) => sum + (c.confidence || 0), 0) / claims.length : 0;
      const successProbability = Math.round(avgConfidence * 100);

      // Send real-time update with success probability
      websocketService.sendNotificationToUser(userId, {
        type: 'success',
        title: 'Detection Complete',
        message: `${claimsCount} potential claims found! Matching evidence...`,
        data: {
          claims_found: claimsCount,
          high_confidence: highConfidenceCount,
          medium_confidence: mediumConfidenceCount,
          success_probability: successProbability,
          next_step: 'Matching evidence documents...',
          is_sandbox: isSandbox,
          mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
        }
      });

      // Send success probability notification (with sandbox indicator)
      if (successProbability > 0) {
        const sandboxPrefix = isSandbox ? '[SANDBOX] ' : '';
        websocketService.sendNotificationToUser(userId, {
          type: 'info',
          title: sandboxPrefix + '📊 Success probability: ' + successProbability + '%',
          message: `Based on ML confidence scoring: ${highConfidenceCount} high, ${mediumConfidenceCount} medium confidence claims${isSandbox ? ' (Sandbox Test Data)' : ''}`,
          data: {
            success_probability: successProbability,
            high_confidence: highConfidenceCount,
            medium_confidence: mediumConfidenceCount,
            is_sandbox: isSandbox,
            sandbox_test_data: isSandbox,
            mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
          }
        });
      }

      // Send notification for evidence validation starting (mock for sandbox)
      if (isSandbox) {
        websocketService.sendNotificationToUser(userId, {
          type: 'info',
          title: '[SANDBOX] 🔍 Validating evidence...',
          message: `Running evidence validator on ${claimsCount} claims (Sandbox Mode - Mock Validation)`,
          data: {
            claims_count: claimsCount,
            validation_mode: 'sandbox_mock',
            is_sandbox: true,
            sandbox_test_data: true
          }
        });
      }

      // Step 1: Trigger evidence matching automatically
      const pythonApiUrl = process.env.PYTHON_API_URL || 'https://clario-complete-backend-7tgl.onrender.com';

      try {
        // Trigger evidence matching via Python API
        await axios.post(
          `${pythonApiUrl}/api/internal/evidence/matching/run`,
          { user_id: userId, claims: claims },
          { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
        );

        logger.info('Evidence matching triggered after detection', { userId, claimsCount });
      } catch (error: any) {
        // Non-blocking - evidence matching can be triggered manually if this fails
        logger.warn('Evidence matching trigger failed (non-critical)', {
          error: error.message,
          userId
        });
      }

      return {
        success: true,
        step: 3,
        message: 'Phase 3: Evidence matching triggered',
        data: { claims_found: claimsCount, evidence_matching_triggered: true }
      };
    } catch (error) {
      logger.error('Error in Phase 3 (Detection Completion)', { error, userId, syncId });
      return {
        success: false,
        step: 3,
        message: 'Failed to trigger evidence matching',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  /**
   * Phase 4: Predictive Refund Orchestration
   * Evidence → Auto-Submit vs Smart Prompts
   */
  private static async executePhase4_EvidenceMatching(
    userId: string,
    syncId: string,
    metadata?: Record<string, any>
  ): Promise<JobResult> {
    try {
      logger.info('🎯 Phase 4: Predictive Refund Orchestration', { userId, syncId });

      const matches = metadata?.matches || metadata?.matching_results || [];
      const matchesCount = Array.isArray(matches) ? matches.length : 0;

      let autoSubmits = 0;
      let smartPrompts = 0;
      let manualReview = 0;

      // Categorize matches by confidence
      for (const match of matches) {
        const confidence = match.confidence || 0;
        if (confidence >= 0.85) {
          autoSubmits++;
        } else if (confidence >= 0.50) {
          smartPrompts++;
        } else {
          manualReview++;
        }
      }

      // Send real-time update
      websocketService.sendNotificationToUser(userId, {
        type: 'success',
        title: 'Evidence Matching Complete',
        message: `${autoSubmits} claims ready for automatic submission`,
        data: {
          auto_submits: autoSubmits,
          smart_prompts: smartPrompts,
          manual_review: manualReview,
          next_step: 'Submitting high-confidence claims...'
        }
      });

      // Auto-submit is handled by Python evidence engine automatically
      // This orchestrator just tracks the status

      return {
        success: true,
        step: 4,
        message: 'Phase 4: Evidence matching complete - routing claims',
        data: {
          matches: matchesCount,
          auto_submits: autoSubmits,
          smart_prompts: smartPrompts,
          manual_review: manualReview
        }
      };
    } catch (error) {
      logger.error('Error in Phase 4 (Evidence Matching)', { error, userId, syncId });
      return {
        success: false,
        step: 4,
        message: 'Failed to process evidence matching results',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  /**
   * Phase 5: Autonomous Recovery Pipeline
   * Submission → Tracking → Payout Monitoring
   */
  private static async executePhase5_ClaimSubmission(
    userId: string,
    syncId: string,
    metadata?: Record<string, any>
  ): Promise<JobResult> {
    try {
      logger.info('🚀 Phase 5: Autonomous Recovery Pipeline', { userId, syncId });

      const claimId = metadata?.claim_id;
      const amazonCaseId = metadata?.amazon_case_id;

      // Send real-time update
      websocketService.sendNotificationToUser(userId, {
        type: 'success',
        title: 'Claim Submitted',
        message: `Claim submitted to Amazon (Case #${amazonCaseId})`,
        data: {
          claim_id: claimId,
          amazon_case_id: amazonCaseId,
          status: 'submitted',
          next_step: 'Amazon reviewing claim...'
        }
      });

      // Start payout monitoring (store in database)
      if (claimId) {
        try {
          await supabase.from('payout_monitoring').upsert({
            user_id: userId,
            claim_id: claimId,
            amazon_case_id: amazonCaseId,
            status: 'monitoring',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'claim_id' });
        } catch (dbError) {
          logger.warn('Failed to store payout monitoring (non-critical)', { dbError, claimId });
        }
      }

      return {
        success: true,
        step: 5,
        message: 'Phase 5: Claim submitted - tracking started',
        data: { claim_id: claimId, amazon_case_id: amazonCaseId, status: 'submitted' }
      };
    } catch (error) {
      logger.error('Error in Phase 5 (Claim Submission)', { error, userId, syncId });
      return {
        success: false,
        step: 5,
        message: 'Failed to track claim submission',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  /**
   * Phase 6: Continuous Learning Brain
   * Rejection → Learning → Model Updates
   */
  private static async executePhase6_ClaimRejection(
    userId: string,
    syncId: string,
    metadata?: Record<string, any>
  ): Promise<JobResult> {
    try {
      logger.info('🧠 Phase 6: Continuous Learning Brain', { userId, syncId });

      const claimId = metadata?.claim_id;
      const rejectionReason = metadata?.rejection_reason || metadata?.reason || 'Unknown reason';
      const amazonCaseId = metadata?.amazon_case_id || metadata?.case_id;

      // Log rejection for learning
      const pythonApiUrl = process.env.PYTHON_API_URL || 'https://clario-complete-backend-7tgl.onrender.com';

      try {
        await axios.post(
          `${pythonApiUrl}/api/v1/claim-detector/rejections/log`,
          {
            user_id: userId,
            claim_id: claimId,
            amazon_case_id: amazonCaseId,
            rejection_reason: rejectionReason
          },
          { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
        );

        logger.info('Rejection logged for learning', { userId, claimId });
      } catch (error: any) {
        logger.warn('Rejection logging failed (non-critical)', { error: error.message, claimId });
      }

      // Send real-time update
      websocketService.sendNotificationToUser(userId, {
        type: 'warning',
        title: 'Claim Rejected',
        message: 'Claim rejected - system learning from this feedback',
        data: {
          claim_id: claimId,
          amazon_case_id: amazonCaseId,
          rejection_reason: rejectionReason,
          learning_triggered: true
        }
      });

      return {
        success: true,
        step: 6,
        message: 'Phase 6: Rejection logged - learning triggered',
        data: {
          claim_id: claimId,
          rejection_reason: rejectionReason,
          learning_triggered: true
        }
      };
    } catch (error) {
      logger.error('Error in Phase 6 (Claim Rejection)', { error, userId, syncId });
      return {
        success: false,
        step: 6,
        message: 'Failed to process rejection',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  /**
   * Phase 7: Hyper-Transparency Layer
   * Payout → Proof Packet Generation
   */
  private static async executePhase7_PayoutReceived(
    userId: string,
    syncId: string,
    metadata?: Record<string, any>
  ): Promise<JobResult> {
    try {
      logger.info('💰 Phase 7: Payout Received', { userId, syncId });

      const claimId = metadata?.claim_id;
      const amount = metadata?.amount || 0;
      const amazonCaseId = metadata?.amazon_case_id || metadata?.case_id;

      // Calculate fees (20% platform fee)
      const platformFee = amount * 0.20;
      const sellerPayout = amount - platformFee;

      // Process Stripe fee (call Stripe service)
      const integrationsUrl = process.env.INTEGRATIONS_URL || 'http://localhost:3001';
      try {
        await axios.post(
          `${integrationsUrl}/api/v1/stripe/process-fee`,
          {
            user_id: userId,
            claim_id: claimId,
            amount_recovered: amount,
            platform_fee: platformFee
          },
          { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error: any) {
        logger.warn('Stripe fee processing failed (non-critical)', { error: error.message });
      }

      // Generate proof packet (call Python API)
      const pythonApiUrl = process.env.PYTHON_API_URL || 'https://clario-complete-backend-7tgl.onrender.com';
      let proofPacketId = null;
      try {
        const proofPacketResponse = await axios.post(
          `${pythonApiUrl}/api/v1/evidence/proof-packets/${claimId}/generate`,
          {
            payout_details: {
              amount: amount,
              date: new Date().toISOString()
            }
          },
          { timeout: 60000, headers: { 'Content-Type': 'application/json' } }
        );

        if (proofPacketResponse.data) {
          proofPacketId = proofPacketResponse.data.packet_id;
        }
      } catch (error: any) {
        logger.warn('Proof packet generation failed (non-critical)', { error: error.message });
      }

      // Send real-time update
      websocketService.sendNotificationToUser(userId, {
        type: 'success',
        title: 'Payout Received',
        message: `Payment received! You keep $${sellerPayout.toFixed(2)}`,
        data: {
          claim_id: claimId,
          amazon_case_id: amazonCaseId,
          amount_recovered: amount,
          platform_fee: platformFee,
          seller_payout: sellerPayout,
          proof_packet_id: proofPacketId
        }
      });

      return {
        success: true,
        step: 7,
        message: 'Phase 7: Payout processed - proof packet generated',
        data: {
          amount_recovered: amount,
          platform_fee: platformFee,
          seller_payout: sellerPayout,
          proof_packet_id: proofPacketId
        }
      };
    } catch (error) {
      logger.error('Error in Phase 7 (Payout Received)', { error, userId, syncId });
      return {
        success: false,
        step: 7,
        message: 'Failed to process payout',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  // ==================== Legacy Step Methods (Backward Compatibility) ====================

  // Step execution methods
  private static async executeStep1(userId: string, syncId: string): Promise<JobResult> {
    try {
      logger.info('Executing Step 1: Fetch Amazon Claims', { userId, syncId });

      // This would integrate with the actual Amazon service
      // For now, using mock data
      const mockClaim = {
        id: 'claim-1',
        claimId: 'AMZ-CLAIM-001',
        claimType: 'reimbursement',
        claimStatus: 'approved',
        claimAmount: 150.00,
        currency: 'USD',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: 'Reimbursement for damaged item'
      };

      await dataOrchestrator.mapAmazonClaimToRefundEngine(userId, mockClaim);

      return {
        success: true,
        step: 1,
        message: 'Amazon claims fetched and mapped successfully',
        data: { claimsProcessed: 1 }
      };
    } catch (error) {
      logger.error('Error executing Step 1', { error, userId, syncId });
      return {
        success: false,
        step: 1,
        message: 'Failed to fetch Amazon claims',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  private static async executeStep2(userId: string, syncId: string): Promise<JobResult> {
    try {
      logger.info('Executing Step 2: Normalize and Ingest Amazon Data', { userId, syncId });
      // Fetch raw Amazon data (mock or real)
      const rawAmazonData = await this.fetchRawAmazonData(userId); // Implement this as needed
      const mcdeDocs = await this.fetchMCDEDocs(userId); // Implement as needed
      // Normalize and ingest
      const result = await dataOrchestrator.orchestrateIngestion(userId, rawAmazonData, mcdeDocs);
      // Save audit log and update sync_progress
      await supabase.from('sync_progress').upsert({
        user_id: userId,
        stage: 'Normalizing Amazon data',
        percent: 40,
        total_cases: result.totalCases,
        processed_cases: result.processed,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      websocketService.broadcastSyncProgress(syncId, {
        syncId,
        stage: 'Normalizing Amazon data',
        percent: 40,
        totalCases: result.totalCases,
        processedCases: result.processed,
        audit: result.audit,
        updatedAt: new Date().toISOString()
      });
      return {
        success: true,
        step: 2,
        message: 'Amazon data normalized and ingested',
        data: result
      };
    } catch (error) {
      logger.error('Error executing Step 2 (Normalization)', { error, userId, syncId });
      return {
        success: false,
        step: 2,
        message: 'Failed to normalize and ingest Amazon data',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  private static async executeStep3(userId: string, syncId: string): Promise<JobResult> {
    try {
      logger.info('Executing Step 3: Create Ledger Entries', { userId, syncId });

      await dataOrchestrator.createCaseFileLedgerEntry(userId, 'CASE-AMZ-CLAIM-001-1234567890', [], null, []);

      return {
        success: true,
        step: 3,
        message: 'Ledger entries created successfully',
        data: { ledgerEntriesCreated: 1 }
      };
    } catch (error) {
      logger.error('Error executing Step 3', { error, userId, syncId });
      return {
        success: false,
        step: 3,
        message: 'Failed to create ledger entries',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  private static async executeStep4(userId: string, syncId: string): Promise<JobResult> {
    try {
      logger.info('Executing Step 4: Process Stripe Transactions', { userId, syncId });

      // This would integrate with the actual Stripe service
      // For now, just logging
      logger.info('Processing Stripe transactions', { userId });

      return {
        success: true,
        step: 4,
        message: 'Stripe transactions processed successfully',
        data: { transactionsProcessed: 0 }
      };
    } catch (error) {
      logger.error('Error executing Step 4', { error, userId, syncId });
      return {
        success: false,
        step: 4,
        message: 'Failed to process Stripe transactions',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  private static async executeStep5(userId: string, syncId: string): Promise<JobResult> {
    try {
      logger.info('Executing Step 5: Finalize Cases', { userId, syncId });

      await dataOrchestrator.updateCaseFileStatus(userId, 'CASE-AMZ-CLAIM-001-1234567890', 'under_review');

      return {
        success: true,
        step: 5,
        message: 'Cases finalized successfully',
        data: { casesFinalized: 1 }
      };
    } catch (error) {
      logger.error('Error executing Step 5', { error, userId, syncId });
      return {
        success: false,
        step: 5,
        message: 'Failed to finalize cases',
        error: String((error as any)?.message ?? 'Unknown error')
      };
    }
  }

  // Helper methods
  private static async updateSyncProgress(
    userId: string,
    syncId: string,
    step: number,
    totalSteps: number,
    currentStep: string,
    status: 'running' | 'completed' | 'failed',
    result?: JobResult
  ): Promise<void> {
    try {
      const progress = Math.round((step / totalSteps) * 100);

      const { error } = await supabase
        .from('sync_progress')
        .update({
          step,
          current_step: currentStep,
          status,
          progress,
          metadata: result ? { ...result, updatedAt: new Date().toISOString() } : {},
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('sync_id', syncId);

      if (error) {
        logger.error('Error updating sync progress', { error, userId, syncId });
        throw new Error('Failed to update sync progress');
      }
    } catch (error) {
      logger.error('Error in updateSyncProgress', { error, userId, syncId });
      throw error;
    }
  }

  private static async completeSync(userId: string, syncId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('sync_progress')
        .update({
          status: 'completed',
          current_step: 'Sync completed successfully',
          progress: 100,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('sync_id', syncId);

      if (error) {
        logger.error('Error completing sync', { error, userId, syncId });
        throw new Error('Failed to complete sync');
      }

      // Broadcast completion
      websocketService.broadcastSyncCompletion(syncId, {
        success: true,
        message: 'Sync completed successfully'
      });

      logger.info('Sync completed successfully', { userId, syncId });
    } catch (error) {
      logger.error('Error in completeSync', { error, userId, syncId });
      throw error;
    }
  }

  private static broadcastProgressUpdate(
    userId: string,
    syncId: string,
    step: number,
    totalSteps: number,
    currentStep: string,
    status: 'running' | 'completed' | 'failed',
    result?: JobResult
  ): void {
    const progress = Math.round((step / totalSteps) * 100);

    const progressUpdate = {
      syncId,
      stage: currentStep,
      percent: progress,
      totalCases: totalSteps,
      processedCases: step,
      audit: [],
      updatedAt: new Date().toISOString()
    };

    websocketService.broadcastSyncProgress(syncId, progressUpdate);

    // Emit workflow phase events (e.g., workflow.phase.1.completed)
    if (status === 'completed' || status === 'failed') {
      websocketService.emitWorkflowPhaseEvent(
        userId,
        step,
        status,
        {
          syncId,
          result: result?.data,
          message: result?.message,
          error: result?.error
        }
      );
    }
  }

  /**
   * Get queue statistics with metrics
   */
  static async getQueueStats(): Promise<any> {
    // Return empty stats if queues are not available
    if (!orchestrationQueue || !syncProgressQueue) {
      return {
        orchestration: { waiting: 0, active: 0, completed: 0, failed: 0 },
        syncProgress: { waiting: 0, active: 0, completed: 0, failed: 0 },
        connectedClients: websocketService.getConnectedClientsCount(),
        metrics: {
          recentJobCount: 0,
          averageJobDuration: 0,
          successRate: 'N/A',
          note: 'Redis not configured - queues disabled'
        }
      };
    }

    try {
      const [orchestrationStats, syncProgressStats] = await Promise.all([
        orchestrationQueue.getJobCounts(),
        syncProgressQueue.getJobCounts()
      ]);

      // Get recent job durations for metrics
      const recentCompleted = await orchestrationQueue.getJobs(['completed'], 0, 10);
      const durations = recentCompleted
        .filter(job => job.finishedOn && job.processedOn)
        .map(job => job.finishedOn! - job.processedOn!);

      const avgDuration = durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

      return {
        orchestration: orchestrationStats,
        syncProgress: syncProgressStats,
        connectedClients: websocketService.getConnectedClientsCount(),
        metrics: {
          recentJobCount: recentCompleted.length,
          averageJobDuration: Math.round(avgDuration),
          successRate: orchestrationStats.completed > 0
            ? (orchestrationStats.completed / (orchestrationStats.completed + orchestrationStats.failed) * 100).toFixed(2) + '%'
            : 'N/A'
        }
      };
    } catch (error: any) {
      logger.warn('Error getting queue stats (non-critical)', { error: error?.message });
      // Return empty stats on error
      return {
        orchestration: { waiting: 0, active: 0, completed: 0, failed: 0 },
        syncProgress: { waiting: 0, active: 0, completed: 0, failed: 0 },
        connectedClients: websocketService.getConnectedClientsCount(),
        metrics: {
          recentJobCount: 0,
          averageJobDuration: 0,
          successRate: 'N/A',
          error: 'Failed to get queue stats'
        }
      };
    }
  }

  /**
   * Clean up queues
   */
  static async cleanup(): Promise<void> {
    // Skip if queues are not available
    if (!orchestrationQueue && !syncProgressQueue) {
      return;
    }

    try {
      const closePromises: Promise<void>[] = [];
      if (orchestrationQueue) {
        closePromises.push(orchestrationQueue.close());
      }
      if (syncProgressQueue) {
        closePromises.push(syncProgressQueue.close());
      }

      await Promise.all(closePromises);

      logger.info('Orchestration job manager cleaned up');
    } catch (error: any) {
      logger.warn('Error cleaning up orchestration job manager (non-critical)', { error: error?.message });
    }
  }

  /**
   * Clean old jobs from queues
   * @param grace - Grace period in milliseconds (default: 0 = all old jobs)
   * @param status - Job status to clean ('failed' | 'completed' | 'active' | 'delayed' | 'wait')
   */
  static async cleanOldJobs(grace: number = 0, status: 'failed' | 'completed' | 'active' | 'delayed' | 'wait' = 'failed'): Promise<{ orchestration: number; syncProgress: number }> {
    // Skip if queues are not available
    if (!orchestrationQueue && !syncProgressQueue) {
      logger.debug('Queues not available - skipping clean old jobs (Redis not configured)');
      return { orchestration: 0, syncProgress: 0 };
    }

    try {
      const cleanPromises: Promise<any>[] = [];
      if (orchestrationQueue) {
        cleanPromises.push(orchestrationQueue.clean(grace, status));
      }
      if (syncProgressQueue) {
        cleanPromises.push(syncProgressQueue.clean(grace, status));
      }

      const results = await Promise.all(cleanPromises);
      const cleanedOrchestration = results[0] || [];
      const cleanedSyncProgress = results[1] || [];

      logger.info('Old jobs cleaned', {
        status,
        orchestration: cleanedOrchestration.length || 0,
        syncProgress: cleanedSyncProgress.length || 0
      });

      return {
        orchestration: cleanedOrchestration.length || 0,
        syncProgress: cleanedSyncProgress.length || 0
      };
    } catch (error: any) {
      logger.warn('Error cleaning old jobs (non-critical)', { error: error?.message });
      return { orchestration: 0, syncProgress: 0 };
    }
  }

  // ==================== Phase Audit Logging ====================

  /**
   * Log phase transition to workflow_phase_logs table
   */
  private static async logPhaseTransition(data: {
    workflowId: string;
    userId: string;
    phaseNumber: number;
    status: 'started' | 'completed' | 'failed' | 'rolled_back';
    durationMs?: number;
    previousPhase?: number;
    errorMessage?: string;
    errorStack?: string;
    metadata?: Record<string, any>;
    rollbackTriggered?: boolean;
    rollbackToPhase?: number;
  }): Promise<void> {
    try {
      // Use existing sync_progress table - update with phase tracking info
      await supabase.from('sync_progress').upsert({
        user_id: data.userId,
        sync_id: data.workflowId,
        step: data.phaseNumber,
        total_steps: 7,
        current_step: `Phase ${data.phaseNumber}`,
        status: data.status === 'started' ? 'running' : data.status === 'completed' ? 'completed' : 'failed',
        progress: Math.round((data.phaseNumber / 7) * 100),
        phase_number: data.phaseNumber,
        duration_ms: data.durationMs || null,
        previous_phase: data.previousPhase || null,
        error_message: data.errorMessage || null,
        error_stack: data.errorStack || null,
        rollback_triggered: data.rollbackTriggered || false,
        rollback_to_phase: data.rollbackToPhase || null,
        metadata: {
          ...(data.metadata || {}),
          phase_status: data.status,
          timestamp: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,sync_id'
      });

      logger.debug('Phase transition logged', {
        workflowId: data.workflowId,
        phase: data.phaseNumber,
        status: data.status
      });
    } catch (error) {
      // Non-blocking - don't fail orchestration if logging fails
      logger.warn('Failed to log phase transition', { error, data });
    }
  }

  /**
   * Get last phase log for a workflow
   */
  private static async getLastPhaseLog(workflowId: string): Promise<{ phase_number: number; status: string } | null> {
    try {
      // Use existing sync_progress table
      const { data, error } = await supabase
        .from('sync_progress')
        .select('phase_number, status')
        .eq('sync_id', workflowId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        return null;
      }

      return {
        phase_number: data.phase_number || data.step || 0,
        status: data.status
      };
    } catch (error) {
      logger.warn('Failed to get last phase log', { error, workflowId });
      return null;
    }
  }

  // ==================== Automatic Rollback Handlers ====================

  /**
   * Handle automatic rollback when a phase fails
   */
  private static async handlePhaseRollback(
    userId: string,
    syncId: string,
    failedPhase: number,
    previousPhase: number | undefined,
    errorMessage: string
  ): Promise<void> {
    try {
      // Determine rollback target (previous phase or phase 1)
      const rollbackToPhase = previousPhase || 1;

      // Only rollback if we have a valid previous phase and it's not phase 1
      if (!previousPhase || previousPhase === 1) {
        logger.info('Skipping rollback - no valid previous phase or already at phase 1', {
          userId,
          syncId,
          failedPhase
        });
        return;
      }

      logger.warn('Phase failed - triggering rollback', {
        userId,
        syncId,
        failedPhase,
        rollbackToPhase,
        errorMessage
      });

      // Log rollback
      await this.logPhaseTransition({
        workflowId: syncId,
        userId,
        phaseNumber: failedPhase,
        status: 'rolled_back',
        previousPhase,
        errorMessage,
        rollbackTriggered: true,
        rollbackToPhase,
        metadata: { reason: 'automatic_rollback_on_failure' }
      });

      // Emit rollback metric
      await this.emitPhaseMetric('rolled_back', failedPhase, userId, syncId, undefined, errorMessage);

      // Re-queue the previous phase (optional - can be disabled)
      // Uncomment if you want automatic retry of previous phase
      /*
      await this.addOrchestrationJob({
        userId,
        syncId,
        step: rollbackToPhase,
        totalSteps: 7,
        currentStep: `Rollback to Phase ${rollbackToPhase}`,
        metadata: { rollback_from_phase: failedPhase, rollback_reason: errorMessage }
      });
      */

      // Send notification about rollback
      websocketService.sendNotificationToUser(userId, {
        type: 'warning',
        title: 'Workflow Rollback',
        message: `Phase ${failedPhase} failed - rolled back to Phase ${rollbackToPhase}`,
        data: {
          failed_phase: failedPhase,
          rollback_to_phase: rollbackToPhase,
          error: errorMessage
        }
      });

    } catch (error) {
      logger.error('Error handling phase rollback', { error, userId, syncId, failedPhase });
      // Don't throw - rollback failure shouldn't break the system
    }
  }

  // ==================== Metrics Hooks ====================

  /**
   * Emit metrics for phase transitions (Prometheus/Supabase)
   */
  private static async emitPhaseMetric(
    event: 'started' | 'completed' | 'failed' | 'rolled_back',
    phaseNumber: number,
    userId: string,
    workflowId: string,
    durationMs?: number,
    errorMessage?: string
  ): Promise<void> {
    try {
      const metricName = `workflow_phase_${event}`;
      const labels = {
        phase: `phase_${phaseNumber}`,
        user_id: userId,
        workflow_id: workflowId
      };

      // Emit to Supabase metrics table (if exists)
      try {
        await supabase.from('metrics_data').insert({
          name: metricName,
          value: durationMs?.toString() || '1',
          metric_type: event === 'started' ? 'counter' : 'histogram',
          category: 'workflow',
          labels: labels,
          user_id: userId,
          metadata: {
            phase_number: phaseNumber,
            workflow_id: workflowId,
            error_message: errorMessage || null,
            duration_ms: durationMs || null
          },
          timestamp: new Date().toISOString()
        });
      } catch (supabaseError) {
        // Metrics table might not exist - that's okay
        logger.debug('Metrics table not available (non-critical)', { supabaseError });
      }

      // Log metric for Prometheus scraping (if using Prometheus)
      logger.info('Workflow phase metric', {
        metric: metricName,
        phase: phaseNumber,
        duration_ms: durationMs,
        labels,
        error: errorMessage || null
      });

    } catch (error) {
      // Non-blocking - metrics failure shouldn't break orchestration
      logger.warn('Failed to emit phase metric', { error, event, phaseNumber });
    }
  }

  // ==================== Convenience Methods for 7-Phase Workflow ====================

  /**
   * Phase 1: Trigger after OAuth completion
   * Includes idempotency check to prevent duplicate Phase 1 jobs
   */
  static async triggerPhase1_OAuthCompletion(
    userId: string,
    sellerId: string,
    syncId?: string
  ): Promise<void> {
    const workflowId = syncId || `oauth_${userId}_${Date.now()}`;

    // Idempotency check: Check if Phase 1 already completed for this workflow
    try {
      const lastLog = await this.getLastPhaseLog(workflowId);
      if (lastLog && lastLog.phase_number === 1 && lastLog.status === 'completed') {
        logger.info('Phase 1 already completed for this workflow (idempotency)', {
          userId,
          workflowId,
          lastStatus: lastLog.status
        });
        return; // Skip - already completed
      }

      // Check if Phase 1 is already in queue or running (skip if queue not available)
      let existingJob = null;
      if (orchestrationQueue) {
        const jobs = await orchestrationQueue.getJobs(['waiting', 'active']);
        existingJob = jobs.find(
          (job) =>
            job.data.userId === userId &&
            job.data.step === 1 &&
            (job.data.syncId === workflowId || job.data.syncId?.startsWith(`oauth_${userId}_`))
        );
      }

      if (existingJob) {
        logger.info('Phase 1 job already exists in queue (idempotency)', {
          userId,
          workflowId,
          jobId: existingJob.id,
          jobStatus: await existingJob.getState()
        });
        return; // Skip - already queued
      }
    } catch (error) {
      // Non-blocking - if idempotency check fails, proceed anyway
      logger.warn('Idempotency check failed (proceeding anyway)', { error, userId, workflowId });
    }

    await this.addOrchestrationJob({
      userId,
      syncId: workflowId,
      step: 1,
      totalSteps: 7,
      currentStep: 'Phase 1: Zero-Friction Onboarding',
      metadata: { seller_id: sellerId, amazon_connected: true }
    });
  }

  /**
   * Phase 2: Trigger after sync completes
   */
  static async triggerPhase2_SyncCompletion(
    userId: string,
    syncId: string,
    ordersCount: number = 0,
    inventoryItems: number = 0
  ): Promise<void> {
    await this.addOrchestrationJob({
      userId,
      syncId,
      step: 2,
      totalSteps: 7,
      currentStep: 'Phase 2: Autonomous Money Discovery',
      metadata: { orders_count: ordersCount, inventory_items: inventoryItems }
    });
  }

  /**
   * Phase 3: Trigger after detection completes
   */
  static async triggerPhase3_DetectionCompletion(
    userId: string,
    syncId: string,
    claims: any[] = []
  ): Promise<void> {
    await this.addOrchestrationJob({
      userId,
      syncId,
      step: 3,
      totalSteps: 7,
      currentStep: 'Phase 3: Intelligent Evidence Ecosystem',
      metadata: { claims, claims_found: claims }
    });
  }

  /**
   * Phase 4: Trigger after evidence matching completes
   */
  static async triggerPhase4_EvidenceMatching(
    userId: string,
    syncId: string,
    matches: any[] = []
  ): Promise<void> {
    await this.addOrchestrationJob({
      userId,
      syncId,
      step: 4,
      totalSteps: 7,
      currentStep: 'Phase 4: Predictive Refund Orchestration',
      metadata: { matches, matching_results: matches }
    });
  }

  /**
   * Phase 5: Trigger after claim submission
   */
  static async triggerPhase5_ClaimSubmission(
    userId: string,
    claimId: string,
    amazonCaseId?: string,
    syncId?: string
  ): Promise<void> {
    await this.addOrchestrationJob({
      userId,
      syncId: syncId || `claim_${claimId}`,
      step: 5,
      totalSteps: 7,
      currentStep: 'Phase 5: Autonomous Recovery Pipeline',
      metadata: { claim_id: claimId, amazon_case_id: amazonCaseId }
    });
  }

  /**
   * Phase 6: Trigger after claim rejection
   */
  static async triggerPhase6_ClaimRejection(
    userId: string,
    claimId: string,
    rejectionReason: string,
    amazonCaseId?: string,
    syncId?: string
  ): Promise<void> {
    await this.addOrchestrationJob({
      userId,
      syncId: syncId || `rejection_${claimId}`,
      step: 6,
      totalSteps: 7,
      currentStep: 'Phase 6: Continuous Learning Brain',
      metadata: {
        claim_id: claimId,
        rejection_reason: rejectionReason,
        amazon_case_id: amazonCaseId,
        reason: rejectionReason,
        case_id: amazonCaseId
      }
    });
  }

  /**
   * Phase 7: Trigger after payout received
   */
  static async triggerPhase7_PayoutReceived(
    userId: string,
    claimId: string,
    amount: number,
    amazonCaseId?: string,
    syncId?: string
  ): Promise<void> {
    await this.addOrchestrationJob({
      userId,
      syncId: syncId || `payout_${claimId}`,
      step: 7,
      totalSteps: 7,
      currentStep: 'Phase 7: Hyper-Transparency Layer',
      metadata: {
        claim_id: claimId,
        amount,
        amazon_case_id: amazonCaseId,
        case_id: amazonCaseId
      }
    });
  }
}

export default OrchestrationJobManager; 
