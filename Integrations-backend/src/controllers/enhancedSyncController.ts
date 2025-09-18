import { Request, Response } from 'express';
import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { createError } from '../utils/errorHandler';
import dataOrchestrator from '../orchestration/dataOrchestrator';
import OrchestrationJobManager from '../jobs/orchestrationJob';
import { authenticateUser } from '../middleware/authMiddleware';
import enhancedDetectionService from '../services/enhancedDetectionService';

export interface EnhancedSyncStatusResponse {
  success: boolean;
  data: {
    syncId: string;
    step: number;
    totalSteps: number;
    currentStep: string;
    status: 'running' | 'completed' | 'failed';
    progress: number;
    message: string;
    estimatedTimeRemaining?: number;
    metadata?: Record<string, any>;
    detectionPipelineStatus?: 'pending' | 'triggered' | 'processing' | 'completed' | 'failed';
    disputeCasesCreated?: number;
  };
}

export interface StartEnhancedSyncResponse {
  success: boolean;
  data: {
    syncId: string;
    message: string;
    estimatedDuration: number;
    detectionPipelineEnabled: boolean;
  };
}

export class EnhancedSyncController {
  
  /**
   * Get enhanced sync status including detection pipeline status
   */
  async getEnhancedSyncStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }
      
      const { syncId } = req.params;
      logger.info('Getting enhanced sync status', { userId, syncId });
      
      // Get sync progress
      const { data: syncProgress, error: syncError } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('sync_id', syncId)
        .single();

      if (syncError && syncError.code !== 'PGRST116') {
        logger.error('Error getting sync progress', { error: syncError, userId, syncId });
        throw createError('Failed to get sync progress', 500);
      }

      if (!syncProgress) {
        throw createError('Sync not found', 404);
      }

      // Get detection pipeline status
      const detectionStatus = await this.getDetectionPipelineStatus(syncId, userId);
      
      // Get dispute cases count if detection is completed
      let disputeCasesCreated = 0;
      if (detectionStatus === 'completed') {
        disputeCasesCreated = await this.getDisputeCasesCount(syncId, userId);
      }

      res.json({
        success: true,
        data: {
          syncId: syncProgress.sync_id,
          step: syncProgress.step,
          totalSteps: syncProgress.total_steps,
          currentStep: syncProgress.current_step,
          status: syncProgress.status,
          progress: syncProgress.progress,
          message: this.getStatusMessage(syncProgress.status, syncProgress.current_step, syncProgress.progress),
          estimatedTimeRemaining: this.calculateEstimatedTimeRemaining(syncProgress.progress),
          metadata: syncProgress.metadata,
          updatedAt: syncProgress.updated_at,
          detectionPipelineStatus: detectionStatus,
          disputeCasesCreated
        }
      });
    } catch (error) {
      logger.error('Error in getEnhancedSyncStatus', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Start enhanced sync with detection pipeline integration
   */
  async startEnhancedSync(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { syncType, enableDetection = true } = req.body;
      
      if (!syncType) {
        throw createError('Sync type is required', 400);
      }

      logger.info('Starting enhanced sync', { userId, syncType, enableDetection });

      // Generate sync ID
      const syncId = `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create sync progress record
      const { error: progressError } = await supabase
        .from('sync_progress')
        .insert({
          sync_id: syncId,
          user_id: userId,
          step: 1,
          total_steps: 5,
          current_step: 'Initializing sync',
          status: 'running',
          progress: 0,
          metadata: {
            sync_type: syncType,
            detection_enabled: enableDetection,
            started_at: new Date().toISOString()
          }
        });

      if (progressError) {
        logger.error('Error creating sync progress record', { error: progressError, userId, syncId });
        throw createError('Failed to start sync', 500);
      }

      // Start orchestration jobs
      await this.startOrchestrationJobs(userId, syncId, syncType);

      // If detection is enabled, trigger detection pipeline after sync completion
      if (enableDetection) {
        // Schedule detection pipeline trigger
        setTimeout(async () => {
          try {
            await this.triggerDetectionPipelineAfterSync(syncId, userId, syncType);
          } catch (error) {
            logger.error('Error triggering detection pipeline after sync', { error, syncId, userId });
          }
        }, 1000); // Small delay to ensure sync is properly initialized
      }

      res.json({
        success: true,
        data: {
          syncId,
          message: 'Enhanced sync started successfully',
          estimatedDuration: 300, // 5 minutes
          detectionPipelineEnabled: enableDetection
        }
      });
    } catch (error) {
      logger.error('Error in startEnhancedSync', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Get sync history with detection pipeline information
   */
  async getEnhancedSyncHistory(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { limit = 10, offset = 0 } = req.query;

      logger.info('Getting enhanced sync history', { userId, limit, offset });

      // Get sync progress records
      const { data: syncRecords, error: syncError } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (syncError) {
        logger.error('Error getting sync history', { error: syncError, userId });
        throw createError('Failed to get sync history', 500);
      }

      // Enhance with detection pipeline status
      const enhancedHistory = await Promise.all(
        syncRecords.map(async (syncRecord) => {
          const detectionStatus = await this.getDetectionPipelineStatus(syncRecord.sync_id, userId);
          const disputeCasesCount = detectionStatus === 'completed' 
            ? await this.getDisputeCasesCount(syncRecord.sync_id, userId)
            : 0;

          return {
            ...syncRecord,
            detectionPipelineStatus: detectionStatus,
            disputeCasesCreated: disputeCasesCount
          };
        })
      );

      res.json({
        success: true,
        data: enhancedHistory
      });
    } catch (error) {
      logger.error('Error in getEnhancedSyncHistory', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Get enhanced sync statistics including detection pipeline metrics
   */
  async getEnhancedSyncStatistics(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      logger.info('Getting enhanced sync statistics', { userId });

      // Get sync statistics
      const { data: recentSyncs, error: recentError } = await supabase
        .from('sync_progress')
        .select('status, created_at, metadata')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false });

      if (recentError) {
        logger.error('Error getting recent syncs', { recentError, userId });
        throw createError('Failed to get sync statistics', 500);
      }

      // Calculate basic sync statistics
      const totalSyncs = recentSyncs.length;
      const successfulSyncs = recentSyncs.filter(sync => sync.status === 'completed').length;
      const failedSyncs = recentSyncs.filter(sync => sync.status === 'failed').length;
      const runningSyncs = recentSyncs.filter(sync => sync.status === 'running').length;

      // Calculate detection pipeline statistics
      const detectionEnabledSyncs = recentSyncs.filter(sync => 
        sync.metadata?.detection_enabled === true
      ).length;

      const detectionSuccessRate = await this.calculateDetectionSuccessRate(userId);

      // Get dispute case statistics
      const disputeStats = await this.getDisputeStatistics(userId);

      const statistics = {
        sync: {
          totalSyncs,
          successfulSyncs,
          failedSyncs,
          runningSyncs,
          successRate: totalSyncs > 0 ? Math.round((successfulSyncs / totalSyncs) * 100) : 0,
          averageDuration: this.calculateAverageDuration(recentSyncs),
          lastSyncAt: recentSyncs.length > 0 ? recentSyncs[0].created_at : null
        },
        detection: {
          enabledSyncs: detectionEnabledSyncs,
          successRate: detectionSuccessRate,
          totalAnomalies: disputeStats.total_anomalies || 0,
          totalValue: disputeStats.total_value || 0
        },
        disputes: {
          totalCases: disputeStats.total_cases || 0,
          totalClaimed: disputeStats.total_claimed || 0,
          successRate: disputeStats.success_rate || 0
        }
      };

      res.json({
        success: true,
        data: statistics
      });
    } catch (error) {
      logger.error('Error in getEnhancedSyncStatistics', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Cancel enhanced sync and cleanup detection pipeline
   */
  async cancelEnhancedSync(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { syncId } = req.params;

      logger.info('Canceling enhanced sync operation', { userId, syncId });

      // Update sync status to cancelled
      const { error } = await supabase
        .from('sync_progress')
        .update({
          status: 'cancelled',
          current_step: 'Sync cancelled by user',
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('sync_id', syncId)
        .eq('status', 'running');

      if (error) {
        logger.error('Error canceling sync', { error, userId, syncId });
        throw createError('Failed to cancel sync', 500);
      }

      // Cancel any pending detection jobs for this sync
      await this.cancelDetectionJobs(syncId, userId);

      res.json({
        success: true,
        message: 'Enhanced sync operation cancelled successfully'
      });
    } catch (error) {
      logger.error('Error in cancelEnhancedSync', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Get real-time enhanced sync progress
   */
  async getRealtimeEnhancedSyncProgress(userId: string, syncId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('sync_id', syncId)
        .single();

      if (error && error.code !== 'PGRST116') {
        logger.error('Error getting realtime sync progress', { error, userId, syncId });
        throw new Error('Failed to get sync progress');
      }

      if (!data) {
        return null;
      }

      // Get detection pipeline status
      const detectionStatus = await this.getDetectionPipelineStatus(syncId, userId);

      return {
        syncId: data.sync_id,
        step: data.step,
        totalSteps: data.total_steps,
        currentStep: data.current_step,
        status: data.status,
        progress: data.progress,
        message: this.getStatusMessage(data.status, data.current_step, data.progress),
        estimatedTimeRemaining: this.calculateEstimatedTimeRemaining(data.progress),
        metadata: data.metadata,
        updatedAt: data.updated_at,
        detectionPipelineStatus: detectionStatus
      };
    } catch (error) {
      logger.error('Error in getRealtimeEnhancedSyncProgress', { error, userId, syncId });
      throw error;
    }
  }

  /**
   * Trigger detection pipeline after sync completion
   */
  private async triggerDetectionPipelineAfterSync(
    syncId: string,
    userId: string,
    syncType: string
  ): Promise<void> {
    try {
      logger.info('Triggering detection pipeline after sync', { syncId, userId, syncType });

      // Determine trigger type based on sync type
      const triggerType = this.mapSyncTypeToTriggerType(syncType);

      // Trigger detection pipeline
      await enhancedDetectionService.triggerDetectionPipeline(
        userId,
        syncId,
        triggerType,
        {
          sync_type: syncType,
          triggered_at: new Date().toISOString(),
          user_id: userId
        }
      );

      logger.info('Detection pipeline triggered successfully after sync', { syncId, userId });
    } catch (error) {
      logger.error('Error triggering detection pipeline after sync', { error, syncId, userId });
      throw error;
    }
  }

  /**
   * Get detection pipeline status for a sync
   */
  private async getDetectionPipelineStatus(syncId: string, userId: string): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('sync_detection_triggers')
        .select('status')
        .eq('sync_id', syncId)
        .eq('seller_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        logger.error('Error getting detection pipeline status', { error, syncId, userId });
        return 'unknown';
      }

      return data?.status || 'pending';
    } catch (error) {
      logger.error('Error in getDetectionPipelineStatus', { error, syncId, userId });
      return 'unknown';
    }
  }

  /**
   * Get dispute cases count for a sync
   */
  private async getDisputeCasesCount(syncId: string, userId: string): Promise<number> {
    try {
      // Get detection results for this sync
      const { data: detectionResults, error: detectionError } = await supabase
        .from('detection_results')
        .select('id')
        .eq('sync_id', syncId)
        .eq('seller_id', userId);

      if (detectionError) {
        logger.error('Error getting detection results for dispute count', { error: detectionError, syncId, userId });
        return 0;
      }

      if (!detectionResults || detectionResults.length === 0) {
        return 0;
      }

      // Get dispute cases count for these detection results
      const detectionResultIds = detectionResults.map(result => result.id);
      const { data: disputeCases, error: disputeError } = await supabase
        .from('dispute_cases')
        .select('id', { count: 'exact' })
        .in('detection_result_id', detectionResultIds);

      if (disputeError) {
        logger.error('Error getting dispute cases count', { error: disputeError, syncId, userId });
        return 0;
      }

      return disputeCases?.length || 0;
    } catch (error) {
      logger.error('Error in getDisputeCasesCount', { error, syncId, userId });
      return 0;
    }
  }

  /**
   * Calculate detection success rate
   */
  private async calculateDetectionSuccessRate(userId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('sync_detection_triggers')
        .select('status')
        .eq('seller_id', userId);

      if (error) {
        logger.error('Error getting detection triggers for success rate', { error, userId });
        return 0;
      }

      if (!data || data.length === 0) {
        return 0;
      }

      const completedTriggers = data.filter(trigger => trigger.status === 'detection_completed').length;
      return Math.round((completedTriggers / data.length) * 100);
    } catch (error) {
      logger.error('Error in calculateDetectionSuccessRate', { error, userId });
      return 0;
    }
  }

  /**
   * Get dispute statistics for a user
   */
  private async getDisputeStatistics(userId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('dispute_cases')
        .select('claim_amount, status')
        .eq('seller_id', userId);

      if (error) {
        logger.error('Error getting dispute statistics', { error, userId });
        return {};
      }

      const cases = data || [];
      const total_cases = cases.length;
      const total_claimed = cases.reduce((sum, dispute) => sum + dispute.claim_amount, 0);
      const resolved_cases = cases.filter(dispute => ['approved', 'rejected', 'closed'].includes(dispute.status)).length;
      const success_rate = total_cases > 0 ? (resolved_cases / total_cases) * 100 : 0;

      return {
        total_cases,
        total_claimed,
        success_rate
      };
    } catch (error) {
      logger.error('Error in getDisputeStatistics', { error, userId });
      return {};
    }
  }

  /**
   * Cancel detection jobs for a sync
   */
  private async cancelDetectionJobs(syncId: string, userId: string): Promise<void> {
    try {
      // Update detection queue jobs to cancelled
      const { error } = await supabase
        .from('detection_queue')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('sync_id', syncId)
        .eq('seller_id', userId)
        .eq('status', 'pending');

      if (error) {
        logger.error('Error cancelling detection jobs', { error, syncId, userId });
      }

      // Update sync detection triggers
      const { error: triggerError } = await supabase
        .from('sync_detection_triggers')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('sync_id', syncId)
        .eq('seller_id', userId);

      if (triggerError) {
        logger.error('Error cancelling detection triggers', { error: triggerError, syncId, userId });
      }
    } catch (error) {
      logger.error('Error in cancelDetectionJobs', { error, syncId, userId });
    }
  }

  /**
   * Start orchestration jobs
   */
  private async startOrchestrationJobs(userId: string, syncId: string, syncType: string): Promise<void> {
    try {
      const steps = [
        { step: 1, name: 'Fetch Amazon Claims' },
        { step: 2, name: 'Link MCDE Documents' },
        { step: 3, name: 'Create Ledger Entries' },
        { step: 4, name: 'Process Stripe Transactions' },
        { step: 5, name: 'Finalize Cases' }
      ];

      // Add jobs to queue for each step
      for (const { step, name } of steps) {
        await OrchestrationJobManager.addOrchestrationJob({
          userId,
          syncId,
          step,
          totalSteps: steps.length,
          currentStep: name,
          metadata: {
            startedAt: new Date().toISOString(),
            syncType
          }
        });
      }

      logger.info('Orchestration jobs started', { userId, syncId, totalSteps: steps.length, syncType });
    } catch (error) {
      logger.error('Error starting orchestration jobs', { error, userId, syncId });
      throw error;
    }
  }

  /**
   * Map sync type to detection trigger type
   */
  private mapSyncTypeToTriggerType(syncType: string): 'inventory' | 'financial' | 'product' | 'manual' {
    switch (syncType) {
      case 'inventory':
        return 'inventory';
      case 'financial':
        return 'financial';
      case 'product':
        return 'product';
      default:
        return 'manual';
    }
  }

  /**
   * Get status message
   */
  private getStatusMessage(status: string, currentStep: string, progress: number): string {
    switch (status) {
      case 'running':
        return `Opside is syncing... ${currentStep} (${progress}% complete)`;
      case 'completed':
        return 'Sync completed successfully';
      case 'failed':
        return 'Sync failed - please try again';
      case 'cancelled':
        return 'Sync was cancelled';
      default:
        return 'Unknown sync status';
    }
  }

  /**
   * Calculate estimated time remaining
   */
  private calculateEstimatedTimeRemaining(progress: number): number | undefined {
    if (progress === 0 || progress === 100) {
      return undefined;
    }
    
    // Rough estimation: assume 5 minutes total duration
    const totalEstimatedSeconds = 300;
    const remainingProgress = 100 - progress;
    return Math.round((remainingProgress / progress) * (totalEstimatedSeconds * progress / 100));
  }

  /**
   * Calculate average duration
   */
  private calculateAverageDuration(syncs: any[]): number {
    if (syncs.length === 0) {
      return 0;
    }

    // This is a simplified calculation
    // In a real implementation, you'd track actual start/end times
    return 300; // 5 minutes average
  }
}

export const enhancedSyncController = new EnhancedSyncController();
export default enhancedSyncController;

