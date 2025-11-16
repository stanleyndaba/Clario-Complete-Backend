import logger from '../utils/logger';
import agent2DataSyncService from './agent2DataSyncService';
import { supabase } from '../database/supabaseClient';
import sseHub from '../utils/sseHub';
import tokenManager from '../utils/tokenManager';

// Standardized status values - use database values consistently
export type SyncStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SyncJobStatus {
  syncId: string;
  userId: string;
  status: SyncStatus;
  progress: number;
  message: string;
  startedAt: string;
  completedAt?: string;
  estimatedCompletion?: string;
  ordersProcessed?: number;
  totalOrders?: number;
  claimsDetected?: number;
  inventoryCount?: number;
  shipmentsCount?: number;
  returnsCount?: number;
  settlementsCount?: number;
  feesCount?: number;
  error?: string;
}

class SyncJobManager {
  private runningJobs: Map<string, { status: SyncJobStatus; cancel: () => void }> = new Map();

  constructor() {
    // Agent 2 Data Sync Service is imported and used directly
  }

  /**
   * Start a new sync job asynchronously
   */
  async startSync(userId: string): Promise<{ syncId: string; status: string }> {
    const syncId = `sync_${userId}_${Date.now()}`;
    
    // Check if user has Amazon connection (database or environment variables)
    const isConnected = await tokenManager.isTokenValid(userId, 'amazon');
    if (!isConnected) {
      // Double-check environment variables as fallback (for sandbox mode)
      const envRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
      const envClientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
      const envClientSecret = process.env.AMAZON_CLIENT_SECRET;
      
      if (envRefreshToken && envClientId && envClientSecret) {
        logger.info('Using environment variables for sync (sandbox mode)', {
          userId,
          syncId,
          hasRefreshToken: !!envRefreshToken,
          hasClientId: !!envClientId,
          hasClientSecret: !!envClientSecret
        });
        // Continue with sync - environment variables are sufficient
      } else {
        logger.warn('Amazon connection not found and no environment variables available', {
          userId,
          syncId,
          hasRefreshToken: !!envRefreshToken,
          hasClientId: !!envClientId,
          hasClientSecret: !!envClientSecret
        });
        throw new Error('Amazon connection not found. Please connect your Amazon account first.');
      }
    }

    // Check if there's already a running sync (both in-memory and database)
    const existingSync = await this.getActiveSync(userId);
    if (existingSync && existingSync.status === 'running') {
      throw new Error(`Sync already in progress (${existingSync.syncId}). Please wait for it to complete or cancel it first.`);
    }

    // Also check database for any active syncs
    const { data: dbActiveSync } = await supabase
      .from('sync_progress')
      .select('sync_id, status')
      .eq('user_id', userId)
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbActiveSync && dbActiveSync.status === 'running') {
      // Check if it's actually still running (not stale)
      const dbSyncStatus = await this.getSyncStatus(dbActiveSync.sync_id, userId);
      if (dbSyncStatus && dbSyncStatus.status === 'running') {
        throw new Error(`Sync already in progress (${dbActiveSync.sync_id}). Please wait for it to complete or cancel it first.`);
      }
    }

    // Initialize sync status (use 'running' to match database)
    const syncStatus: SyncJobStatus = {
      syncId,
      userId,
      status: 'running',
      progress: 0,
      message: 'Sync starting...',
      startedAt: new Date().toISOString(),
      ordersProcessed: 0,
      totalOrders: 0,
      claimsDetected: 0
    };

    // Create cancel function
    let cancelled = false;
    const cancelFn = () => {
      cancelled = true;
      syncStatus.status = 'cancelled';
      syncStatus.message = 'Sync cancelled by user';
      this.updateSyncStatus(syncStatus);
    };

    // Store job
    this.runningJobs.set(syncId, { status: syncStatus, cancel: cancelFn });

    // Save to database
    await this.saveSyncToDatabase(syncStatus);

    // Send initial SSE event
    this.sendProgressUpdate(userId, syncStatus);

    // Start async sync (don't await)
    this.runSync(syncId, userId, () => cancelled).catch((error) => {
      logger.error(`Sync job ${syncId} failed:`, error);
      syncStatus.status = 'failed';
      syncStatus.error = error.message;
      syncStatus.message = `Sync failed: ${error.message}`;
      this.updateSyncStatus(syncStatus);
    });

    return {
      syncId,
      status: 'in_progress'
    };
  }

  /**
   * Run the actual sync job asynchronously
   */
  private async runSync(syncId: string, userId: string, isCancelled: () => boolean): Promise<void> {
    const job = this.runningJobs.get(syncId);
    if (!job) {
      throw new Error(`Sync job ${syncId} not found`);
    }

    const syncStatus = job.status;
    let syncResult: any = null; // Store Agent 2 sync result for use throughout method

    try {
      // Update progress: 10% - Starting Agent 2 sync
      syncStatus.progress = 10;
      syncStatus.message = 'Starting data sync...';
      this.updateSyncStatus(syncStatus);
      this.sendProgressUpdate(userId, syncStatus);

      if (isCancelled()) {
        syncStatus.status = 'cancelled';
        syncStatus.message = 'Sync cancelled';
        this.updateSyncStatus(syncStatus);
        return;
      }

      // Update progress: 20% - Fetching orders
      syncStatus.progress = 20;
      syncStatus.message = 'Fetching orders from Amazon SP-API...';
      this.updateSyncStatus(syncStatus);
      this.sendProgressUpdate(userId, syncStatus);

      if (isCancelled()) {
        syncStatus.status = 'cancelled';
        syncStatus.message = 'Sync cancelled';
        this.updateSyncStatus(syncStatus);
        return;
      }

      // Update progress: 40% - Running Agent 2 data sync
      syncStatus.progress = 40;
      syncStatus.message = 'Syncing data (orders, shipments, returns, settlements, inventory, claims)...';
      this.updateSyncStatus(syncStatus);
      this.sendProgressUpdate(userId, syncStatus);

      // Run Agent 2 Data Sync Service (comprehensive data sync with normalization)
      logger.info('🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync', { userId, syncId });
      syncResult = await agent2DataSyncService.syncUserData(userId);
      
      // Check if Agent 2 sync failed
      if (!syncResult.success) {
        logger.error('❌ [SYNC JOB MANAGER] Agent 2 sync failed', {
          userId,
          syncId,
          errors: syncResult.errors,
          summary: syncResult.summary
        });
        throw new Error(`Agent 2 sync failed: ${syncResult.errors.join(', ') || 'Unknown error'}`);
      }
      
      // Log Agent 2 summary in detail to debug wrong counts
      logger.info('✅ [SYNC JOB MANAGER] Agent 2 sync completed', {
        userId,
        syncId,
        success: syncResult.success,
        summary: syncResult.summary,
        isMock: syncResult.isMock,
        ordersCount: syncResult.summary?.ordersCount,
        inventoryCount: syncResult.summary?.inventoryCount,
        shipmentsCount: syncResult.summary?.shipmentsCount,
        returnsCount: syncResult.summary?.returnsCount,
        settlementsCount: syncResult.summary?.settlementsCount,
        feesCount: syncResult.summary?.feesCount,
        claimsCount: syncResult.summary?.claimsCount
      });
      
      if (isCancelled()) {
        syncStatus.status = 'cancelled';
        syncStatus.message = 'Sync cancelled';
        this.updateSyncStatus(syncStatus);
        return;
      }

      // Update progress: 70% - Data normalization complete
      syncStatus.progress = 70;
      syncStatus.message = 'Data normalization complete. Processing results...';
      // Store all data type counts from Agent 2 at this point
      syncStatus.ordersProcessed = syncResult.summary.ordersCount || 0;
      syncStatus.totalOrders = syncResult.summary.ordersCount || 0;
      syncStatus.inventoryCount = syncResult.summary.inventoryCount || 0;
      syncStatus.shipmentsCount = syncResult.summary.shipmentsCount || 0;
      syncStatus.returnsCount = syncResult.summary.returnsCount || 0;
      syncStatus.settlementsCount = syncResult.summary.settlementsCount || 0;
      syncStatus.feesCount = syncResult.summary.feesCount || 0;
      this.updateSyncStatus(syncStatus);
      this.sendProgressUpdate(userId, syncStatus);

      if (isCancelled()) {
        syncStatus.status = 'cancelled';
        syncStatus.message = 'Sync cancelled';
        this.updateSyncStatus(syncStatus);
        return;
      }

      // Update progress: 80% - Waiting for Agent 3 (claim detection) to complete
      syncStatus.progress = 80;
      syncStatus.message = 'Waiting for claim detection (Agent 3)...';
      this.updateSyncStatus(syncStatus);
      this.sendProgressUpdate(userId, syncStatus);

      // Wait for detection to process (detection runs asynchronously via Redis queue)
      // Poll detection_queue to see if detection has started/completed
      let detectionCompleted = false;
      let detectionAttempts = 0;
      const maxDetectionWaitTime = 60000; // Wait up to 60 seconds for detection
      const detectionPollInterval = 2000; // Poll every 2 seconds
      const maxDetectionAttempts = Math.floor(maxDetectionWaitTime / detectionPollInterval);

      while (!detectionCompleted && detectionAttempts < maxDetectionAttempts) {
        await new Promise(resolve => setTimeout(resolve, detectionPollInterval));
        detectionAttempts++;

        // Check if detection job has completed
        try {
          const { data: detectionJob, error } = await supabase
            .from('detection_queue')
            .select('status, processed_at')
            .eq('seller_id', userId)
            .eq('sync_id', syncId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!error && detectionJob) {
            if (detectionJob.status === 'completed') {
              detectionCompleted = true;
              logger.info('Detection completed for sync', { userId, syncId, detectionAttempts });
            } else if (detectionJob.status === 'failed') {
              // Detection failed, but continue with sync completion
              logger.warn('Detection failed for sync, continuing with sync completion', { userId, syncId });
              detectionCompleted = true;
            } else if (detectionJob.status === 'processing') {
              // Detection is in progress, continue waiting
              logger.debug('Detection in progress, waiting...', { userId, syncId, detectionAttempts });
            }
          } else if (error) {
            // Error querying detection queue, might not have started yet
            logger.debug('Detection queue query error (might not have started yet)', { 
              userId, 
              syncId, 
              error: error.message,
              detectionAttempts 
            });
          }
        } catch (error: any) {
          logger.warn('Error checking detection status', { error: error.message, userId, syncId });
        }

        // Also check if we have detection results (detection might have completed but queue status not updated)
        if (!detectionCompleted) {
          const { data: detectionResults } = await supabase
            .from('detection_results')
            .select('id', { count: 'exact', head: true })
            .eq('seller_id', userId)
            .eq('sync_id', syncId);

          if (detectionResults && detectionResults.length > 0) {
            // We have detection results, detection has completed
            detectionCompleted = true;
            logger.info('Detection results found, detection completed', { 
              userId, 
              syncId, 
              resultsCount: detectionResults.length,
              detectionAttempts 
            });
          }
        }
      }

      if (!detectionCompleted) {
        logger.warn('Detection did not complete within timeout, continuing with sync completion', {
          userId,
          syncId,
          detectionAttempts,
          maxAttempts: maxDetectionAttempts
        });
      }

      // Update progress: 95% - Finalizing
      syncStatus.progress = 95;
      syncStatus.message = 'Finalizing sync...';
      this.updateSyncStatus(syncStatus);
      this.sendProgressUpdate(userId, syncStatus);

      // Get sync results from database (now includes detection results if completed)
      const syncResults = await this.getSyncResults(userId, syncId);

      // Use Agent 2 sync result data if available, otherwise use database results
      // NOTE: Claims are NOT included - they're detected FROM the data, not synced data
      const totalItemsSynced = syncResult 
        ? ((syncResult.summary?.ordersCount || 0) + 
           (syncResult.summary?.shipmentsCount || 0) + 
           (syncResult.summary?.returnsCount || 0) + 
           (syncResult.summary?.settlementsCount || 0) + 
           (syncResult.summary?.inventoryCount || 0) + 
           (syncResult.summary?.feesCount || 0))
        : ((syncResults.ordersProcessed || 0) + (syncResults.totalOrders || 0));
      
      // Debug logging to trace where "48 items" comes from
      logger.info('🔍 [SYNC JOB MANAGER] Calculating totalItemsSynced', {
        userId,
        syncId,
        hasSyncResult: !!syncResult,
        hasSummary: !!(syncResult?.summary),
        agent2Counts: syncResult?.summary ? {
          ordersCount: syncResult.summary.ordersCount || 0,
          shipmentsCount: syncResult.summary.shipmentsCount || 0,
          returnsCount: syncResult.summary.returnsCount || 0,
          settlementsCount: syncResult.summary.settlementsCount || 0,
          inventoryCount: syncResult.summary.inventoryCount || 0,
          feesCount: syncResult.summary.feesCount || 0,
          claimsCount: syncResult.summary.claimsCount || 0  // Note: claims are detected, not synced
        } : null,
        databaseCounts: !syncResult ? {
          ordersProcessed: syncResults.ordersProcessed || 0,
          totalOrders: syncResults.totalOrders || 0
        } : null,
        calculatedTotal: totalItemsSynced
      });

      // Update progress: 100% - Complete (use 'completed' to match database)
      syncStatus.progress = 100;
      syncStatus.status = 'completed';
      syncStatus.message = syncResults.claimsDetected > 0
        ? `Sync completed successfully - ${totalItemsSynced} items synced, ${syncResults.claimsDetected} discrepancies detected`
        : `Sync completed successfully - ${totalItemsSynced} items synced`;
      syncStatus.completedAt = new Date().toISOString();
      // Store all data type counts from Agent 2 - ALWAYS use Agent 2 result, never fall back to database
      // The database might have old/incomplete data from previous updates
      if (syncResult && syncResult.summary) {
        syncStatus.ordersProcessed = syncResult.summary.ordersCount || 0;
        syncStatus.totalOrders = syncResult.summary.ordersCount || 0;
        syncStatus.inventoryCount = syncResult.summary.inventoryCount || 0;
        syncStatus.shipmentsCount = syncResult.summary.shipmentsCount || 0;
        syncStatus.returnsCount = syncResult.summary.returnsCount || 0;
        syncStatus.settlementsCount = syncResult.summary.settlementsCount || 0;
        syncStatus.feesCount = syncResult.summary.feesCount || 0;
        
        // Log what we're saving to debug wrong counts
        logger.info('💾 [SYNC JOB MANAGER] Saving sync completion with Agent 2 counts', {
          userId,
          syncId,
          ordersProcessed: syncStatus.ordersProcessed,
          totalOrders: syncStatus.totalOrders,
          inventoryCount: syncStatus.inventoryCount,
          shipmentsCount: syncStatus.shipmentsCount,
          returnsCount: syncStatus.returnsCount,
          settlementsCount: syncStatus.settlementsCount,
          feesCount: syncStatus.feesCount,
          totalItemsSynced
        });
      } else {
        // Only use database results if Agent 2 result is not available (shouldn't happen)
        logger.warn('⚠️ [SYNC JOB MANAGER] Agent 2 sync result not available, using database results (may be incomplete)', {
          userId,
          syncId,
          hasSyncResult: !!syncResult,
          hasSummary: !!(syncResult?.summary),
          databaseOrdersProcessed: syncResults.ordersProcessed,
          databaseTotalOrders: syncResults.totalOrders
        });
        syncStatus.ordersProcessed = syncResults.ordersProcessed || 0;
        syncStatus.totalOrders = syncResults.totalOrders || 0;
        syncStatus.inventoryCount = 0;
        syncStatus.shipmentsCount = 0;
        syncStatus.returnsCount = 0;
        syncStatus.settlementsCount = 0;
        syncStatus.feesCount = 0;
      }
      syncStatus.claimsDetected = syncResults.claimsDetected || 0;
      this.updateSyncStatus(syncStatus);
      this.sendProgressUpdate(userId, syncStatus);

      // Remove from running jobs after a delay
      setTimeout(() => {
        this.runningJobs.delete(syncId);
      }, 60000); // Keep for 1 minute after completion

    } catch (error: any) {
      logger.error(`Sync job ${syncId} error:`, error);
      syncStatus.status = 'failed';
      syncStatus.error = error.message;
      syncStatus.message = `Sync failed: ${error.message}`;
      syncStatus.completedAt = new Date().toISOString();
      this.updateSyncStatus(syncStatus);
      this.sendProgressUpdate(userId, syncStatus);
      throw error;
    }
  }

  /**
   * Get sync status by syncId
   */
  async getSyncStatus(syncId: string, userId: string): Promise<SyncJobStatus | null> {
    // Check running jobs first
    const job = this.runningJobs.get(syncId);
    if (job) {
      // Verify it belongs to the user
      if (job.status.userId === userId) {
        return job.status;
      }
      return null;
    }

    // Check database
    try {
      const { data, error } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('sync_id', syncId)
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return null;
      }

      // Normalize status from database to our standard format
      let normalizedStatus: SyncStatus = 'idle';
      if (data.status === 'running' || data.status === 'in_progress') {
        normalizedStatus = 'running';
      } else if (data.status === 'completed' || data.status === 'complete') {
        normalizedStatus = 'completed';
      } else if (data.status === 'failed') {
        normalizedStatus = 'failed';
      } else if (data.status === 'cancelled') {
        normalizedStatus = 'cancelled';
      }

      const metadata = (data.metadata as any) || {};
      
      // If metadata is missing the new fields (old sync), try to recalculate from database
      // This handles syncs created before we added all the data type counts
      const hasNewFields = metadata.inventoryCount !== undefined || 
                           metadata.shipmentsCount !== undefined ||
                           metadata.returnsCount !== undefined;
      
      // If old sync format and completed, try to recalculate counts from actual database records
      if (!hasNewFields && normalizedStatus === 'completed') {
        logger.warn(`Sync ${data.sync_id} has old metadata format (missing data type counts). Attempting to recalculate from database...`, {
          userId: data.user_id,
          syncId: data.sync_id
        });
        
        try {
          // Recalculate counts from actual database records
          const syncStartDate = metadata.startedAt || data.created_at;
          const [ordersCount, inventoryCount, shipmentsCount, returnsCount, settlementsCount, feesCount, claimsCount] = await Promise.all([
            supabase.from('orders').select('id', { count: 'exact', head: true }).eq('seller_id', data.user_id).gte('created_at', syncStartDate),
            supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('user_id', data.user_id).gte('created_at', syncStartDate),
            supabase.from('shipments').select('id', { count: 'exact', head: true }).eq('seller_id', data.user_id).gte('created_at', syncStartDate),
            supabase.from('returns').select('id', { count: 'exact', head: true }).eq('seller_id', data.user_id).gte('created_at', syncStartDate),
            supabase.from('settlements').select('id', { count: 'exact', head: true }).eq('seller_id', data.user_id).gte('created_at', syncStartDate),
            supabase.from('fees').select('id', { count: 'exact', head: true }).eq('user_id', data.user_id).gte('created_at', syncStartDate),
            // Agent 3 stores claims in detection_results table, not claims table
            supabase.from('detection_results').select('id', { count: 'exact', head: true }).eq('seller_id', data.user_id).eq('sync_id', data.sync_id)
          ]);
          
          // Update metadata with recalculated counts
          const recalculatedMetadata = {
            ...metadata,
            ordersProcessed: ordersCount.count || metadata.ordersProcessed || 0,
            totalOrders: ordersCount.count || metadata.totalOrders || 0,
            inventoryCount: inventoryCount.count || 0,
            shipmentsCount: shipmentsCount.count || 0,
            returnsCount: returnsCount.count || 0,
            settlementsCount: settlementsCount.count || 0,
            feesCount: feesCount.count || 0,
            claimsDetected: claimsCount.count || metadata.claimsDetected || 0
          };
          
          // Save recalculated metadata back to database (async, don't wait)
          supabase.from('sync_progress')
            .update({ metadata: recalculatedMetadata })
            .eq('sync_id', data.sync_id)
            .eq('user_id', data.user_id)
            .then(() => {
              logger.info(`✅ Recalculated and updated metadata for sync ${data.sync_id}`, {
                userId: data.user_id,
                syncId: data.sync_id,
                recalculatedCounts: recalculatedMetadata
              });
            })
            .catch((err) => {
              logger.error(`Failed to update recalculated metadata for sync ${data.sync_id}:`, err);
            });
          
          // Use recalculated metadata for this response
          Object.assign(metadata, recalculatedMetadata);
        } catch (recalcError: any) {
          logger.error(`Failed to recalculate counts for sync ${data.sync_id}:`, recalcError);
          // Continue with old metadata if recalculation fails
        }
      }
      
      return {
        syncId: data.sync_id,
        userId: data.user_id,
        status: normalizedStatus,
        progress: data.progress || 0,
        message: data.current_step || 'Unknown',
        startedAt: data.created_at,
        completedAt: data.updated_at,
        ordersProcessed: metadata.ordersProcessed || 0,
        totalOrders: metadata.totalOrders || 0,
        inventoryCount: metadata.inventoryCount || 0,
        shipmentsCount: metadata.shipmentsCount || 0,
        returnsCount: metadata.returnsCount || 0,
        settlementsCount: metadata.settlementsCount || 0,
        feesCount: metadata.feesCount || 0,
        claimsDetected: metadata.claimsDetected || 0,
        error: metadata.error
      };
    } catch (error) {
      logger.error(`Error getting sync status for ${syncId}:`, error);
      return null;
    }
  }

  /**
   * Cancel a sync job (both in-memory and database)
   */
  async cancelSync(syncId: string, userId: string): Promise<boolean> {
    const job = this.runningJobs.get(syncId);
    
    // Check if job exists in memory
    if (job) {
      // Verify it belongs to the user
      if (job.status.userId !== userId) {
        return false;
      }

      // Cancel the job
      job.cancel();
      
      // Update database
      await this.updateSyncStatusInDatabase(syncId, userId, {
        status: 'cancelled',
        message: 'Sync cancelled by user',
        completedAt: new Date().toISOString()
      });
      
      return true;
    }

    // If not in memory, check database and cancel there
    try {
      const { data, error } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('sync_id', syncId)
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return false;
      }

      // Only cancel if it's actually running
      if (data.status === 'running' || data.status === 'in_progress') {
        await this.updateSyncStatusInDatabase(syncId, userId, {
          status: 'cancelled',
          message: 'Sync cancelled by user',
          completedAt: new Date().toISOString()
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error cancelling sync ${syncId}:`, error);
      return false;
    }
  }

  /**
   * Update sync status in database (helper method)
   */
  private async updateSyncStatusInDatabase(
    syncId: string,
    userId: string,
    updates: Partial<SyncJobStatus>
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('sync_progress')
        .update({
          status: updates.status === 'running' ? 'running' :
                  updates.status === 'completed' ? 'completed' :
                  updates.status === 'failed' ? 'failed' :
                  updates.status === 'cancelled' ? 'cancelled' : 'running',
          current_step: updates.message,
          progress: updates.progress,
          updated_at: new Date().toISOString(),
          metadata: {
            ...(updates.ordersProcessed !== undefined && { ordersProcessed: updates.ordersProcessed }),
            ...(updates.totalOrders !== undefined && { totalOrders: updates.totalOrders }),
            ...(updates.inventoryCount !== undefined && { inventoryCount: updates.inventoryCount }),
            ...(updates.shipmentsCount !== undefined && { shipmentsCount: updates.shipmentsCount }),
            ...(updates.returnsCount !== undefined && { returnsCount: updates.returnsCount }),
            ...(updates.settlementsCount !== undefined && { settlementsCount: updates.settlementsCount }),
            ...(updates.feesCount !== undefined && { feesCount: updates.feesCount }),
            ...(updates.claimsDetected !== undefined && { claimsDetected: updates.claimsDetected }),
            ...(updates.error && { error: updates.error }),
            ...(updates.completedAt && { completedAt: updates.completedAt })
          }
        })
        .eq('sync_id', syncId)
        .eq('user_id', userId);

      if (error) {
        logger.error(`Error updating sync status in database:`, error);
      }
    } catch (error) {
      logger.error(`Error in updateSyncStatusInDatabase:`, error);
    }
  }

  /**
   * Get sync history for a user
   */
  async getSyncHistory(userId: string, limit: number = 20, offset: number = 0): Promise<{
    syncs: SyncJobStatus[];
    total: number;
  }> {
    try {
      const { data, error, count } = await supabase
        .from('sync_progress')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        logger.error(`Error getting sync history for ${userId}:`, error);
        return { syncs: [], total: 0 };
      }

      const syncs = (data || []).map((row: any) => {
        const metadata = (row.metadata as any) || {};
        return {
          syncId: row.sync_id,
          userId: row.user_id,
          status: row.status as any,
          progress: row.progress || 0,
          message: row.current_step || 'Unknown',
          startedAt: row.created_at,
          completedAt: row.updated_at,
          ordersProcessed: metadata.ordersProcessed || 0,
          totalOrders: metadata.totalOrders || 0,
          inventoryCount: metadata.inventoryCount || 0,
          shipmentsCount: metadata.shipmentsCount || 0,
          returnsCount: metadata.returnsCount || 0,
          settlementsCount: metadata.settlementsCount || 0,
          feesCount: metadata.feesCount || 0,
          claimsDetected: metadata.claimsDetected || 0,
          error: metadata.error
        };
      });

      return {
        syncs,
        total: count || 0
      };
    } catch (error) {
      logger.error(`Error getting sync history for ${userId}:`, error);
      return { syncs: [], total: 0 };
    }
  }

  /**
   * Get active sync status for a user (for frontend monitoring)
   * Returns format: { hasActiveSync: boolean, lastSync: { syncId, status, ... } | null }
   */
  async getActiveSyncStatus(userId: string): Promise<{
    hasActiveSync: boolean;
    lastSync: {
      syncId: string;
      status: string;
      progress?: number;
      message?: string;
      startedAt?: string;
      completedAt?: string;
      ordersProcessed?: number;
      totalOrders?: number;
      inventoryCount?: number;
      shipmentsCount?: number;
      returnsCount?: number;
      settlementsCount?: number;
      feesCount?: number;
      claimsDetected?: number;
    } | null;
  }> {
    // Check running jobs first
    for (const job of this.runningJobs.values()) {
      if (job.status.userId === userId && job.status.status === 'running') {
        return {
          hasActiveSync: true,
          lastSync: {
            syncId: job.status.syncId,
            status: job.status.status,
            progress: job.status.progress,
            message: job.status.message,
            startedAt: job.status.startedAt,
            completedAt: job.status.completedAt,
            ordersProcessed: job.status.ordersProcessed,
            totalOrders: job.status.totalOrders,
            inventoryCount: job.status.inventoryCount,
            shipmentsCount: job.status.shipmentsCount,
            returnsCount: job.status.returnsCount,
            settlementsCount: job.status.settlementsCount,
            feesCount: job.status.feesCount,
            claimsDetected: job.status.claimsDetected
          }
        };
      }
    }

    // Check database for active syncs
    try {
      const { data, error } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'running')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        // No active sync, get last sync (completed or failed)
        const { data: lastSyncData } = await supabase
          .from('sync_progress')
          .select('*')
          .eq('user_id', userId)
          .in('status', ['completed', 'failed', 'cancelled'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastSyncData) {
          const metadata = (lastSyncData.metadata as any) || {};
          return {
            hasActiveSync: false,
            lastSync: {
              syncId: lastSyncData.sync_id,
              status: lastSyncData.status === 'complete' ? 'completed' : lastSyncData.status,
              progress: lastSyncData.progress || 0,
              message: lastSyncData.current_step || 'Unknown',
              startedAt: lastSyncData.created_at,
              completedAt: lastSyncData.updated_at,
              ordersProcessed: metadata.ordersProcessed || 0,
              totalOrders: metadata.totalOrders || 0,
              inventoryCount: metadata.inventoryCount || 0,
              shipmentsCount: metadata.shipmentsCount || 0,
              returnsCount: metadata.returnsCount || 0,
              settlementsCount: metadata.settlementsCount || 0,
              feesCount: metadata.feesCount || 0,
              claimsDetected: metadata.claimsDetected || 0
            }
          };
        }

        return {
          hasActiveSync: false,
          lastSync: null
        };
      }

      // Found active sync
      const metadata = (data.metadata as any) || {};
      return {
        hasActiveSync: true,
        lastSync: {
          syncId: data.sync_id,
          status: data.status === 'in_progress' ? 'running' : data.status,
          progress: data.progress || 0,
          message: data.current_step || 'Unknown',
          startedAt: data.created_at,
          completedAt: data.updated_at,
          ordersProcessed: metadata.ordersProcessed || 0,
          totalOrders: metadata.totalOrders || 0,
          inventoryCount: metadata.inventoryCount || 0,
          shipmentsCount: metadata.shipmentsCount || 0,
          returnsCount: metadata.returnsCount || 0,
          settlementsCount: metadata.settlementsCount || 0,
          feesCount: metadata.feesCount || 0,
          claimsDetected: metadata.claimsDetected || 0
        }
      };
    } catch (error) {
      logger.error(`Error getting active sync status for ${userId}:`, error);
      return {
        hasActiveSync: false,
        lastSync: null
      };
    }
  }

  /**
   * Get active sync for a user (private helper)
   */
  private async getActiveSync(userId: string): Promise<SyncJobStatus | null> {
    // Check running jobs first
    for (const job of this.runningJobs.values()) {
      if (job.status.userId === userId && job.status.status === 'running') {
        return job.status;
      }
    }

    // Check database
    try {
      const { data, error } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'running')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      const metadata = (data.metadata as any) || {};
      return {
        syncId: data.sync_id,
        userId: data.user_id,
        status: 'running', // Normalize to 'running'
        progress: data.progress || 0,
        message: data.current_step || 'Unknown',
        startedAt: data.created_at,
        ordersProcessed: metadata.ordersProcessed || 0,
        totalOrders: metadata.totalOrders || 0,
        inventoryCount: metadata.inventoryCount || 0,
        shipmentsCount: metadata.shipmentsCount || 0,
        returnsCount: metadata.returnsCount || 0,
        settlementsCount: metadata.settlementsCount || 0,
        feesCount: metadata.feesCount || 0,
        claimsDetected: metadata.claimsDetected || 0
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Save sync status to database (normalized to database status values)
   */
  private async saveSyncToDatabase(syncStatus: SyncJobStatus): Promise<void> {
    try {
      // Normalize status to database format (status is already in correct format)
      const dbStatus: string = syncStatus.status;

      const { error } = await supabase
        .from('sync_progress')
        .upsert({
          user_id: syncStatus.userId,
          sync_id: syncStatus.syncId,
          step: Math.round(syncStatus.progress / 20), // 0-5 steps
          total_steps: 5,
          current_step: syncStatus.message,
          status: dbStatus,
          progress: syncStatus.progress,
          metadata: {
            ordersProcessed: syncStatus.ordersProcessed || 0,
            totalOrders: syncStatus.totalOrders || 0,
            inventoryCount: syncStatus.inventoryCount || 0,
            shipmentsCount: syncStatus.shipmentsCount || 0,
            returnsCount: syncStatus.returnsCount || 0,
            settlementsCount: syncStatus.settlementsCount || 0,
            feesCount: syncStatus.feesCount || 0,
            claimsDetected: syncStatus.claimsDetected || 0,
            error: syncStatus.error,
            startedAt: syncStatus.startedAt,
            completedAt: syncStatus.completedAt
          },
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,sync_id'
        });

      if (error) {
        logger.error(`Error saving sync to database:`, error);
      }
    } catch (error) {
      logger.error(`Error in saveSyncToDatabase:`, error);
    }
  }

  /**
   * Update sync status
   */
  private async updateSyncStatus(syncStatus: SyncJobStatus): Promise<void> {
    // Update in-memory
    const job = this.runningJobs.get(syncStatus.syncId);
    if (job) {
      job.status = syncStatus;
    }

    // Update database
    await this.saveSyncToDatabase(syncStatus);
  }

  /**
   * Send progress update via SSE
   */
  private sendProgressUpdate(userId: string, syncStatus: SyncJobStatus): void {
    sseHub.sendEvent(userId, 'sync_progress', {
      syncId: syncStatus.syncId,
      status: syncStatus.status,
      progress: syncStatus.progress,
      message: syncStatus.message,
      ordersProcessed: syncStatus.ordersProcessed,
      totalOrders: syncStatus.totalOrders,
      inventoryCount: syncStatus.inventoryCount,
      shipmentsCount: syncStatus.shipmentsCount,
      returnsCount: syncStatus.returnsCount,
      settlementsCount: syncStatus.settlementsCount,
      feesCount: syncStatus.feesCount,
      claimsDetected: syncStatus.claimsDetected,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get sync results from database (real implementation)
   */
  private async getSyncResults(userId: string, syncId: string): Promise<{
    ordersProcessed: number;
    totalOrders: number;
    claimsDetected: number;
  }> {
    try {
      // Get sync metadata from database
      const { data: syncData, error } = await supabase
        .from('sync_progress')
        .select('metadata')
        .eq('sync_id', syncId)
        .eq('user_id', userId)
        .single();

      if (error || !syncData) {
        logger.warn(`Sync results not found for ${syncId}, using defaults`);
        return {
          ordersProcessed: 0,
          totalOrders: 0,
          claimsDetected: 0
        };
      }

      const metadata = (syncData.metadata as any) || {};
      
      // Also query actual counts from database for accuracy
      const [ordersCount, claimsCount] = await Promise.all([
        // Count orders processed in this sync (if we track this)
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('seller_id', userId)
          .gte('created_at', metadata.startedAt || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        // Count claims detected in this sync (Agent 3 stores in detection_results table)
        supabase
          .from('detection_results')
          .select('id', { count: 'exact', head: true })
          .eq('seller_id', userId)
          .eq('sync_id', syncId)
      ]);

      return {
        ordersProcessed: metadata.ordersProcessed || ordersCount.count || 0,
        totalOrders: metadata.totalOrders || ordersCount.count || 0,
        claimsDetected: metadata.claimsDetected || claimsCount.count || 0
      };
    } catch (error) {
      logger.error(`Error getting sync results for ${syncId}:`, error);
      // Return metadata values if available, otherwise defaults
      try {
        const { data: syncData } = await supabase
          .from('sync_progress')
          .select('metadata')
          .eq('sync_id', syncId)
          .eq('user_id', userId)
          .single();

        if (syncData && syncData.metadata) {
          const metadata = syncData.metadata as any;
          return {
            ordersProcessed: metadata.ordersProcessed || 0,
            totalOrders: metadata.totalOrders || 0,
            claimsDetected: metadata.claimsDetected || 0
          };
        }
      } catch (fallbackError) {
        logger.error(`Fallback sync results query failed:`, fallbackError);
      }

      return {
        ordersProcessed: 0,
        totalOrders: 0,
        claimsDetected: 0
      };
    }
  }
}

export const syncJobManager = new SyncJobManager();

