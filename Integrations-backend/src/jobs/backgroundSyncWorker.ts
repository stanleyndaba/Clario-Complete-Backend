/**
 * Background Sync Worker - Continuous Data Sync
 * Phase 2: Runs scheduled sync jobs automatically
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { AmazonSyncJob } from './amazonSyncJob';
import { supabase } from '../database/supabaseClient';
import { logAuditEvent } from '../security/auditLogger';

export interface SyncJobConfig {
  schedule: string; // Cron expression
  enabled: boolean;
  syncType: 'full' | 'incremental';
  dataTypes: string[]; // ['inventory', 'orders', 'shipments', 'returns', 'settlements']
}

export class BackgroundSyncWorker {
  private syncJob: AmazonSyncJob;
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private isRunning: boolean = false;
  private defaultConfig: SyncJobConfig = {
    schedule: '0 */6 * * *', // Every 6 hours
    enabled: true,
    syncType: 'incremental',
    dataTypes: ['inventory', 'orders', 'shipments', 'returns', 'settlements', 'claims', 'fees']
  };

  constructor() {
    this.syncJob = new AmazonSyncJob();
  }

  /**
   * Start background sync worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Background sync worker is already running');
      return;
    }

    logger.info('Starting background sync worker', {
      schedule: this.defaultConfig.schedule,
      syncType: this.defaultConfig.syncType,
      dataTypes: this.defaultConfig.dataTypes
    });

    this.isRunning = true;

    // Schedule main sync job
    const task = cron.schedule(this.defaultConfig.schedule, async () => {
      await this.executeScheduledSync();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.set('main-sync', task);

    logger.info('Background sync worker started successfully', {
      schedule: this.defaultConfig.schedule
    });

    // Log audit event
    await logAuditEvent({
      event_type: 'background_sync_worker_started',
      metadata: {
        schedule: this.defaultConfig.schedule,
        syncType: this.defaultConfig.syncType
      },
      severity: 'low'
    });
  }

  /**
   * Stop background sync worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Background sync worker is not running');
      return;
    }

    logger.info('Stopping background sync worker');

    // Stop all scheduled jobs
    for (const [name, task] of this.jobs.entries()) {
      task.stop();
      logger.info(`Stopped sync job: ${name}`);
    }

    this.jobs.clear();
    this.isRunning = false;

    logger.info('Background sync worker stopped');

    await logAuditEvent({
      event_type: 'background_sync_worker_stopped',
      metadata: {},
      severity: 'low'
    });
  }

  /**
   * Execute scheduled sync for all active users
   */
  private async executeScheduledSync(): Promise<void> {
    try {
      logger.info('Executing scheduled background sync', {
        timestamp: new Date().toISOString(),
        syncType: this.defaultConfig.syncType
      });

      // Get all users with active Amazon connections
      const userIds = await this.getActiveUserIds();

      if (userIds.length === 0) {
        logger.info('No active users found for background sync');
        return;
      }

      logger.info(`Starting background sync for ${userIds.length} users`, {
        userIds: userIds.length
      });

      // Execute sync for each user (with rate limiting)
      const syncPromises = userIds.map((userId, index) => {
        // Stagger syncs to avoid rate limits
        const delay = index * 2000; // 2 seconds between each user
        
        return new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              await this.syncUserData(userId);
            } catch (error: any) {
              logger.error(`Background sync failed for user ${userId}`, {
                error: error.message,
                userId
              });
            }
            resolve();
          }, delay);
        });
      });

      await Promise.all(syncPromises);

      logger.info('Background sync completed for all users', {
        userCount: userIds.length,
        timestamp: new Date().toISOString()
      });

      await logAuditEvent({
        event_type: 'background_sync_completed',
        metadata: {
          userCount: userIds.length,
          syncType: this.defaultConfig.syncType
        },
        severity: 'low'
      });
    } catch (error: any) {
      logger.error('Error executing scheduled background sync', {
        error: error.message,
        stack: error.stack
      });

      await logAuditEvent({
        event_type: 'background_sync_failed',
        metadata: {
          error: error.message
        },
        severity: 'high'
      });
    }
  }

  /**
   * Get list of active user IDs with Amazon connections
   */
  private async getActiveUserIds(): Promise<string[]> {
    try {
      if (typeof supabase.from !== 'function') {
        logger.warn('Demo mode: Returning empty user list');
        return [];
      }

      // Get users with valid Amazon tokens
      const { data: tokens, error } = await supabase
        .from('tokens')
        .select('user_id')
        .eq('provider', 'amazon')
        .eq('status', 'active');

      if (error) {
        logger.error('Error fetching active user IDs', { error: error.message });
        return [];
      }

      // Extract user IDs and ensure they are strings
      const userIdsArray: string[] = (tokens || [])
        .map((t: any) => t.user_id)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
      
      const userIds: string[] = [...new Set<string>(userIdsArray)];

      // Also check for users with environment variables (sandbox mode)
      const envRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
      if (envRefreshToken) {
        // Add a default user for sandbox mode
        userIds.push('sandbox-user');
      }

      return userIds;
    } catch (error: any) {
      logger.error('Error getting active user IDs', { error: error.message });
      return [];
    }
  }

  /**
   * Sync data for a specific user
   */
  private async syncUserData(userId: string): Promise<void> {
    try {
      logger.info(`Starting background sync for user: ${userId}`, {
        userId,
        syncType: this.defaultConfig.syncType
      });

      const syncStartTime = Date.now();
      const syncResult = await this.syncJob.syncUserData(userId);
      const syncId = syncResult.syncId;
      const syncDuration = Date.now() - syncStartTime;

      logger.info(`Background sync completed for user: ${userId}`, {
        userId,
        syncId,
        duration: `${syncDuration}ms`
      });

      // Update sync status in database
      await this.updateSyncStatus(userId, syncId, 'completed', syncDuration);
    } catch (error: any) {
      logger.error(`Background sync failed for user: ${userId}`, {
        error: error.message,
        userId
      });

      await this.updateSyncStatus(userId, 'unknown', 'failed', 0, error.message);

      // Don't throw - we want to continue with other users
    }
  }

  /**
   * Update sync status in database
   */
  private async updateSyncStatus(
    userId: string,
    syncId: string,
    status: 'running' | 'completed' | 'failed',
    duration: number,
    error?: string
  ): Promise<void> {
    try {
      if (typeof supabase.from !== 'function') {
        return; // Demo mode
      }

      const { error: updateError } = await supabase
        .from('sync_progress')
        .upsert({
          sync_id: syncId,
          user_id: userId,
          status,
          progress: status === 'completed' ? 100 : status === 'failed' ? 0 : 50,
          message: status === 'completed' 
            ? `Background sync completed in ${duration}ms`
            : status === 'failed'
            ? `Background sync failed: ${error}`
            : 'Background sync in progress',
          started_at: new Date().toISOString(),
          completed_at: status !== 'running' ? new Date().toISOString() : null,
          error: error || null,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'sync_id'
        });

      if (updateError) {
        logger.warn('Error updating sync status', { error: updateError.message, userId, syncId });
      }
    } catch (error: any) {
      logger.warn('Error updating sync status', { error: error.message, userId, syncId });
    }
  }

  /**
   * Update sync configuration
   */
  updateConfig(config: Partial<SyncJobConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
    logger.info('Background sync worker config updated', { config: this.defaultConfig });

    // Restart worker if running
    if (this.isRunning) {
      this.stop().then(() => this.start());
    }
  }

  /**
   * Get current sync status
   */
  getStatus(): { running: boolean; jobs: string[]; config: SyncJobConfig } {
    return {
      running: this.isRunning,
      jobs: Array.from(this.jobs.keys()),
      config: this.defaultConfig
    };
  }

  /**
   * Manually trigger sync for a user (for testing)
   */
  async triggerManualSync(userId: string): Promise<string> {
    logger.info(`Manual sync triggered for user: ${userId}`);
    const result = await this.syncJob.syncUserData(userId);
    return result.syncId;
  }
}

// Singleton instance
const backgroundSyncWorker = new BackgroundSyncWorker();

// Auto-start if enabled
if (process.env.ENABLE_BACKGROUND_SYNC !== 'false') {
  backgroundSyncWorker.start().catch((error) => {
    logger.error('Failed to start background sync worker', { error: error.message });
  });
}

export default backgroundSyncWorker;

