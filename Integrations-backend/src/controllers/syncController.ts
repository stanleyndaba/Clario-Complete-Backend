import { Request, Response } from 'express';
import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { createError } from '../utils/errorHandler';
import dataOrchestrator from '../orchestration/dataOrchestrator';
import OrchestrationJobManager from '../jobs/orchestrationJob';
import { authenticateUser } from '../middleware/authMiddleware';

export interface SyncStatusResponse {
  success: boolean;
  data: {
    syncId: string;
    step: number;
    totalSteps: number;
    currentStep: string;
    status: 'running' | 'completed' | 'failed';
    progress: number;
    message: string;
    estimatedTimeRemaining?: number; // in seconds
    metadata?: Record<string, any>;
  };
}

export interface StartSyncResponse {
  success: boolean;
  data: {
    syncId: string;
    message: string;
    estimatedDuration: number; // in seconds
  };
}

export class SyncController {
  
  /**
   * Get current sync status for a user
   */
  async getSyncStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }
      const { syncId } = req.params;
      logger.info('Getting sync status', { userId, syncId });
      const { data, error } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('sync_id', syncId)
        .single();
      if (error && error.code !== 'PGRST116') {
        logger.error('Error getting sync status', { error, userId, syncId });
        throw createError('Failed to get sync status', 500);
      }
      if (!data) {
        throw createError('Sync not found', 404);
      }
      res.json({
        success: true,
        data: {
          syncId: data.sync_id,
          stage: data.stage,
          percent: data.percent,
          totalCases: data.total_cases,
          processedCases: data.processed_cases,
          audit: data.audit_log || [],
          updatedAt: data.updated_at
        }
      });
    } catch (error) {
      logger.error('Error in getSyncStatus', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Get all sync history for a user
   */
  async getSyncHistory(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { limit = 10, offset = 0 } = req.query;

      logger.info('Getting sync history', { userId, limit, offset });

      const { data, error } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (error) {
        logger.error('Error getting sync history', { error, userId });
        throw createError('Failed to get sync history', 500);
      }

      const response = {
        success: true,
        data: data.map(item => ({
          syncId: item.sync_id,
          step: item.step,
          totalSteps: item.total_steps,
          currentStep: item.current_step,
          status: item.status,
          progress: item.progress,
          message: this.getStatusMessage(item.status, item.current_step, item.progress),
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          metadata: item.metadata
        }))
      };

      res.json(response);
    } catch (error) {
      logger.error('Error in getSyncHistory', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Start a new sync operation
   */
  async startSync(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      logger.info('Starting new sync operation', { userId });

      // Generate unique sync ID
      const syncId = `sync-${userId}-${Date.now()}`;

      // Initialize sync progress
      const { error: progressError } = await supabase
        .from('sync_progress')
        .insert({
          user_id: userId,
          sync_id: syncId,
          step: 0,
          total_steps: 5,
          current_step: 'Initializing...',
          status: 'running',
          progress: 0,
          metadata: {
            startedAt: new Date().toISOString(),
            source: 'manual'
          }
        });

      if (progressError) {
        logger.error('Error initializing sync progress', { progressError, userId });
        throw createError('Failed to initialize sync', 500);
      }

      // Start the orchestration process using job manager
      await this.startOrchestrationJobs(userId, syncId);

      const response: StartSyncResponse = {
        success: true,
        data: {
          syncId,
          message: 'Sync operation started successfully',
          estimatedDuration: 300 // 5 minutes estimated
        }
      };

      res.json(response);
    } catch (error) {
      logger.error('Error in startSync', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Cancel an ongoing sync operation
   */
  async cancelSync(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { syncId } = req.params;

      logger.info('Canceling sync operation', { userId, syncId });

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

      res.json({
        success: true,
        message: 'Sync operation cancelled successfully'
      });
    } catch (error) {
      logger.error('Error in cancelSync', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Get real-time sync progress (for WebSocket updates)
   */
  async getRealtimeSyncProgress(userId: string, syncId: string): Promise<any> {
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
        updatedAt: data.updated_at
      };
    } catch (error) {
      logger.error('Error in getRealtimeSyncProgress', { error, userId, syncId });
      throw error;
    }
  }

  /**
   * Get sync statistics for dashboard
   */
  async getSyncStatistics(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      logger.info('Getting sync statistics', { userId });

      // Get sync statistics from database
      const { data: recentSyncs, error: recentError } = await supabase
        .from('sync_progress')
        .select('status, created_at')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Last 7 days
        .order('created_at', { ascending: false });

      if (recentError) {
        logger.error('Error getting recent syncs', { recentError, userId });
        throw createError('Failed to get sync statistics', 500);
      }

      // Calculate statistics
      const totalSyncs = recentSyncs.length;
      const successfulSyncs = recentSyncs.filter(sync => sync.status === 'completed').length;
      const failedSyncs = recentSyncs.filter(sync => sync.status === 'failed').length;
      const runningSyncs = recentSyncs.filter(sync => sync.status === 'running').length;

      const statistics = {
        totalSyncs,
        successfulSyncs,
        failedSyncs,
        runningSyncs,
        successRate: totalSyncs > 0 ? Math.round((successfulSyncs / totalSyncs) * 100) : 0,
        averageDuration: this.calculateAverageDuration(recentSyncs),
        lastSyncAt: recentSyncs.length > 0 ? recentSyncs[0].created_at : null
      };

      res.json({
        success: true,
        data: statistics
      });
    } catch (error) {
      logger.error('Error in getSyncStatistics', { error });
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  // Private helper methods
  private async startOrchestrationJobs(userId: string, syncId: string): Promise<void> {
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
            startedAt: new Date().toISOString()
          }
        });
      }

      logger.info('Orchestration jobs started', { userId, syncId, totalSteps: steps.length });
    } catch (error) {
      logger.error('Error starting orchestration jobs', { error, userId, syncId });
      throw error;
    }
  }

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

  private calculateEstimatedTimeRemaining(progress: number): number | undefined {
    if (progress === 0 || progress === 100) {
      return undefined;
    }
    
    // Rough estimation: assume 5 minutes total duration
    const totalEstimatedSeconds = 300;
    const remainingProgress = 100 - progress;
    return Math.round((remainingProgress / progress) * (totalEstimatedSeconds * progress / 100));
  }

  private calculateAverageDuration(syncs: any[]): number {
    if (syncs.length === 0) {
      return 0;
    }

    // This is a simplified calculation
    // In a real implementation, you'd track actual start/end times
    return 300; // 5 minutes average
  }
}

export const syncController = new SyncController();
export default syncController; 