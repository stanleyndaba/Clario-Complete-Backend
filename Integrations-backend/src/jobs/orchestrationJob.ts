import Queue from 'bull';
import logger from '../utils/logger';
import dataOrchestrator from '../orchestration/dataOrchestrator';
import websocketService from '../services/websocketService';
import { supabase } from '../database/supabaseClient';

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
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create job queues
const orchestrationQueue = new Queue<OrchestrationJobData>('orchestration', REDIS_URL);
const syncProgressQueue = new Queue<OrchestrationJobData>('sync-progress', REDIS_URL);

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
    try {
      await orchestrationQueue.add('orchestrate', data, {
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
    } catch (error) {
      logger.error('Error adding orchestration job to queue', { error, data });
      throw error;
    }
  }

  /**
   * Add sync progress update job to queue
   */
  static async addSyncProgressJob(data: OrchestrationJobData): Promise<void> {
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
    } catch (error) {
      logger.error('Error adding sync progress job to queue', { error, data });
      throw error;
    }
  }

  /**
   * Setup orchestration job processor
   */
  private static setupOrchestrationProcessor(): void {
    orchestrationQueue.process('orchestrate', async (job) => {
      const { userId, syncId, step, totalSteps, currentStep, metadata } = job.data;
      
      logger.info('Processing orchestration job', { 
        jobId: job.id,
        userId, 
        syncId, 
        step, 
        currentStep 
      });

      try {
        // Update sync progress to running
        await this.updateSyncProgress(userId, syncId, step, totalSteps, currentStep, 'running');

        // Execute the specific step
        let result: JobResult;
        
        switch (step) {
          case 1:
            result = await this.executeStep1(userId, syncId);
            break;
          case 2:
            result = await this.executeStep2(userId, syncId);
            break;
          case 3:
            result = await this.executeStep3(userId, syncId);
            break;
          case 4:
            result = await this.executeStep4(userId, syncId);
            break;
          case 5:
            result = await this.executeStep5(userId, syncId);
            break;
          default:
            throw new Error(`Unknown step: ${step}`);
        }

        // Update sync progress based on result
        const status = result.success ? 'completed' : 'failed';
        await this.updateSyncProgress(userId, syncId, step, totalSteps, currentStep, status, result);

        // Broadcast progress update via WebSocket
        this.broadcastProgressUpdate(userId, syncId, step, totalSteps, currentStep, status, result);

        // If this is the last step and successful, mark sync as completed
        if (step === totalSteps && result.success) {
          await this.completeSync(userId, syncId);
        }

        return result;
      } catch (error) {
        logger.error('Error processing orchestration job', { error, jobId: job.id, data: job.data });
        
        // Update sync progress to failed
        await this.updateSyncProgress(userId, syncId, step, totalSteps, currentStep, 'failed', {
          success: false,
          step,
          message: 'Job failed',
          error: String((error as any)?.message ?? 'Unknown error')
        });

        throw error;
      }
    });
  }

  /**
   * Setup sync progress job processor
   */
  private static setupSyncProgressProcessor(): void {
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
      
      await dataOrchestrator.createCaseFileLedgerEntry(
        userId,
        { claim_id: 'AMZ-CLAIM-001', raw: { note: 'Additional processing completed' } },
        [
          {
            claimId: 'AMZ-CLAIM-001',
            type: 'document_linked',
            amount: 0,
            currency: 'USD',
            date: new Date().toISOString(),
            details: { processedAt: new Date().toISOString() }
          }
        ],
        null,
        [{ step: 'executeStep3', timestamp: new Date().toISOString() }]
      );
      
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
      step,
      totalSteps,
      currentStep,
      status,
      progress,
      message: result?.message || `Step ${step}/${totalSteps}: ${currentStep}`,
      metadata: (result ?? {}) as Record<string, any>,
      updatedAt: new Date().toISOString()
    };

    // Send a step-based progress update directly to the user
    websocketService.sendSyncProgressToUser(userId, progressUpdate as any);
  }

  /**
   * Get queue statistics
   */
  static async getQueueStats(): Promise<any> {
    try {
      const [orchestrationStats, syncProgressStats] = await Promise.all([
        orchestrationQueue.getJobCounts(),
        syncProgressQueue.getJobCounts()
      ]);

      return {
        orchestration: orchestrationStats,
        syncProgress: syncProgressStats,
        connectedClients: websocketService.getConnectedClientsCount()
      };
    } catch (error) {
      logger.error('Error getting queue stats', { error });
      throw error;
    }
  }

  /**
   * Clean up queues
   */
  static async cleanup(): Promise<void> {
    try {
      await Promise.all([
        orchestrationQueue.close(),
        syncProgressQueue.close()
      ]);
      
      logger.info('Orchestration job manager cleaned up');
    } catch (error) {
      logger.error('Error cleaning up orchestration job manager', { error });
    }
  }
}

export default OrchestrationJobManager; 
