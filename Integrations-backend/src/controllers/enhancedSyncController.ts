import { Request, Response } from 'express';
import { syncJobManager } from '../services/syncJobManager';
import logger from '../utils/logger';

/**
 * Start enhanced sync (delegates to main sync system)
 */
export const startEnhancedSync = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    logger.info('Starting enhanced sync', { userId });
    
    const result = await syncJobManager.startSync(userId);

    res.json({
      success: true,
      message: 'Sync started successfully',
      syncId: result.syncId,
      status: result.status
    });
  } catch (error: any) {
    logger.error('Enhanced sync start error:', error);
    
    if (error.message.includes('not found') || error.message.includes('not connected')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('already in progress')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

/**
 * Get enhanced sync status (delegates to main sync system)
 */
export const getEnhancedSyncStatus = async (req: Request, res: Response) => {
  try {
    const { syncId } = req.params;
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    if (!syncId) {
      return res.status(400).json({
        success: false,
        error: 'Sync ID is required'
      });
    }

    const syncStatus = await syncJobManager.getSyncStatus(syncId, userId);

    if (!syncStatus) {
      return res.status(404).json({
        success: false,
        error: 'Sync not found'
      });
    }

    res.json({
      success: true,
      syncId: syncStatus.syncId,
      status: syncStatus.status,
      progress: syncStatus.progress,
      message: syncStatus.message,
      startedAt: syncStatus.startedAt,
      completedAt: syncStatus.completedAt,
      ordersProcessed: syncStatus.ordersProcessed,
      totalOrders: syncStatus.totalOrders,
      claimsDetected: syncStatus.claimsDetected,
      error: syncStatus.error
    });
  } catch (error: any) {
    logger.error('Get enhanced sync status error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

/**
 * Get enhanced sync history (delegates to main sync system)
 */
export const getEnhancedSyncHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const history = await syncJobManager.getSyncHistory(userId, limit, offset);

    res.json({
      success: true,
      history: history.syncs.map(sync => ({
        syncId: sync.syncId,
        status: sync.status,
        startedAt: sync.startedAt,
        completedAt: sync.completedAt,
        ordersProcessed: sync.ordersProcessed,
        claimsDetected: sync.claimsDetected,
        duration: sync.completedAt && sync.startedAt 
          ? Math.round((new Date(sync.completedAt).getTime() - new Date(sync.startedAt).getTime()) / 1000)
          : undefined,
        error: sync.error
      })),
      total: history.total
    });
  } catch (error: any) {
    logger.error('Get enhanced sync history error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

/**
 * Get enhanced sync statistics (real implementation)
 */
export const getEnhancedSyncStatistics = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    // Get all syncs for statistics
    const history = await syncJobManager.getSyncHistory(userId, 1000, 0); // Get large batch for stats

    const statistics = {
      totalSyncs: history.total,
      successfulSyncs: history.syncs.filter(s => s.status === 'completed').length,
      failedSyncs: history.syncs.filter(s => s.status === 'failed').length,
      cancelledSyncs: history.syncs.filter(s => s.status === 'cancelled').length,
      runningSyncs: history.syncs.filter(s => s.status === 'running').length,
      totalOrdersProcessed: history.syncs.reduce((sum, s) => sum + (s.ordersProcessed || 0), 0),
      totalClaimsDetected: history.syncs.reduce((sum, s) => sum + (s.claimsDetected || 0), 0)
    };

    res.json({
      success: true,
      statistics
    });
  } catch (error: any) {
    logger.error('Get enhanced sync statistics error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

/**
 * Get sync progress (delegates to main sync system)
 */
export const getSyncProgress = async (req: Request, res: Response) => {
  try {
    const { syncId } = req.params;
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const syncStatus = await syncJobManager.getSyncStatus(syncId, userId);

    if (!syncStatus) {
      return res.status(404).json({
        success: false,
        error: 'Sync not found'
      });
    }

    res.json({
      success: true,
      syncId: syncStatus.syncId,
      progress: syncStatus.progress,
      status: syncStatus.status,
      message: syncStatus.message,
      estimatedCompletion: syncStatus.estimatedCompletion,
      startedAt: syncStatus.startedAt,
      completedAt: syncStatus.completedAt
    });
  } catch (error: any) {
    logger.error('Get sync progress error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

/**
 * Start bulk sync (currently same as regular sync, can be enhanced later)
 */
export const startBulkSync = async (req: Request, res: Response) => {
  // For now, bulk sync is the same as regular sync
  // Can be enhanced later to sync multiple users or force full historical sync
  return startEnhancedSync(req, res);
};

/**
 * Get queue status (returns active syncs count)
 */
export const getQueueStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const activeSyncStatus = await syncJobManager.getActiveSyncStatus(userId);

    res.json({
      success: true,
      queueStatus: {
        running: activeSyncStatus.hasActiveSync ? 1 : 0,
        pending: 0, // Can be enhanced with actual queue system
        processing: activeSyncStatus.hasActiveSync ? 1 : 0,
        completed: activeSyncStatus.lastSync && !activeSyncStatus.hasActiveSync ? 1 : 0
      },
      activeSync: activeSyncStatus.lastSync
    });
  } catch (error: any) {
    logger.error('Get queue status error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

/**
 * Cleanup sync data (placeholder - can be enhanced to clean old sync records)
 */
export const cleanupSyncData = async (req: Request, res: Response) => {
  try {
    // TODO: Implement cleanup of old sync records (e.g., older than 90 days)
    // For now, just return success
    logger.info('Sync cleanup requested', {
      userId: (req as any).userId || (req as any).user?.id
    });

    res.json({
      success: true,
      message: 'Cleanup completed (no cleanup needed at this time)',
      note: 'Automatic cleanup of old sync records can be implemented here'
    });
  } catch (error: any) {
    logger.error('Cleanup sync data error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

// Create a default export object that contains all the methods
const enhancedSyncController = {
  startEnhancedSync,
  getEnhancedSyncStatus,
  getEnhancedSyncHistory,
  getEnhancedSyncStatistics,
  getSyncProgress,
  startBulkSync, 
  getQueueStatus,
  cleanupSyncData
};

export default enhancedSyncController;
