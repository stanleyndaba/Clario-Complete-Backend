import { Request, Response } from 'express';
import logger from '../utils/logger';
import { syncJobManager } from '../services/syncJobManager';

/**
 * Start a new sync job
 * POST /api/sync/start
 */
export const startSync = async (req: Request, res: Response) => {
  try {
    // Extract user ID from middleware (set by userIdMiddleware)
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      logger.warn('Start sync called without user ID');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    logger.info(`Starting sync for user: ${userId}`);

    // Start sync job (async, returns immediately)
    const result = await syncJobManager.startSync(userId);

    res.json({
      syncId: result.syncId,
      status: result.status,
      message: 'Sync started successfully'
    });
  } catch (error: any) {
    logger.error('Sync start error:', error);
    
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
      error: 'Failed to start sync',
      message: error.message
    });
  }
};

/**
 * Get active sync status (without syncId) - for frontend monitoring
 * GET /api/sync/status
 */
export const getActiveSyncStatus = async (req: Request, res: Response) => {
  try {
    // Log request for debugging
    logger.info('🔍 [SYNC STATUS] getActiveSyncStatus called', {
      path: req.path,
      originalUrl: req.originalUrl,
      method: req.method,
      headers: {
        'x-user-id': req.headers['x-user-id'],
        'x-forwarded-user-id': req.headers['x-forwarded-user-id'],
        'authorization': req.headers['authorization'] ? 'present' : 'missing'
      }
    });

    // Extract user ID from middleware (set by userIdMiddleware)
    // Use 'demo-user' as fallback for sandbox/development testing
    let userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    // In sandbox mode, default to 'demo-user' to query actual generated data
    if (!userId) {
      const isSandbox = process.env.NODE_ENV !== 'production' || 
                        process.env.AMAZON_SANDBOX_MODE === 'true' ||
                        process.env.USE_MOCK_DATA === 'true';
      
      if (isSandbox) {
        userId = 'demo-user';
        logger.info('ℹ️ [SYNC STATUS] Using demo-user in sandbox mode', { path: req.path });
      } else {
        logger.warn('⚠️ [SYNC STATUS] No user ID found in production mode', { path: req.path });
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - no user ID provided'
        });
      }
    }

    logger.info(`✅ [SYNC STATUS] Getting active sync status for userId: ${userId}`);

    const activeSyncStatus = await syncJobManager.getActiveSyncStatus(userId);

    logger.info(`✅ [SYNC STATUS] Successfully retrieved sync status`, {
      userId,
      hasActiveSync: activeSyncStatus.hasActiveSync,
      lastSyncId: activeSyncStatus.lastSync?.syncId || null
    });

    res.json(activeSyncStatus);
  } catch (error: any) {
    logger.error('❌ [SYNC STATUS] Get active sync status error:', {
      error: error?.message || String(error),
      stack: error?.stack,
      path: req.path
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get active sync status',
      message: error.message
    });
  }
};

/**
 * Get sync status by syncId
 * GET /api/sync/status/:syncId
 */
export const getSyncStatus = async (req: Request, res: Response) => {
  try {
    const { syncId } = req.params;
    // Extract user ID from middleware (set by userIdMiddleware)
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

    logger.info(`Getting sync status for syncId: ${syncId}, userId: ${userId}`);

    const syncStatus = await syncJobManager.getSyncStatus(syncId, userId);

    if (!syncStatus) {
      return res.status(404).json({
        success: false,
        error: 'Sync not found'
      });
    }

    res.json({
      syncId: syncStatus.syncId,
      status: syncStatus.status,
      progress: syncStatus.progress,
      message: syncStatus.message,
      startedAt: syncStatus.startedAt,
      estimatedCompletion: syncStatus.estimatedCompletion,
      ordersProcessed: syncStatus.ordersProcessed,
      totalOrders: syncStatus.totalOrders,
      inventoryCount: syncStatus.inventoryCount,
      shipmentsCount: syncStatus.shipmentsCount,
      returnsCount: syncStatus.returnsCount,
      settlementsCount: syncStatus.settlementsCount,
      feesCount: syncStatus.feesCount,
      claimsDetected: syncStatus.claimsDetected,
      completedAt: syncStatus.completedAt,
      error: syncStatus.error
    });
  } catch (error: any) {
    logger.error('Get sync status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync status',
      message: error.message
    });
  }
};

/**
 * Get sync history for the authenticated user
 * GET /api/sync/history
 */
export const getSyncHistory = async (req: Request, res: Response) => {
  try {
    // Extract user ID from middleware (set by userIdMiddleware)
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    logger.info(`Getting sync history for userId: ${userId}, limit: ${limit}, offset: ${offset}`);

    const history = await syncJobManager.getSyncHistory(userId, limit, offset);

    res.json({
      syncs: history.syncs.map(sync => ({
        syncId: sync.syncId,
        status: sync.status,
        startedAt: sync.startedAt,
        completedAt: sync.completedAt,
        ordersProcessed: sync.ordersProcessed,
        totalOrders: sync.totalOrders,
        inventoryCount: sync.inventoryCount,
        shipmentsCount: sync.shipmentsCount,
        returnsCount: sync.returnsCount,
        settlementsCount: sync.settlementsCount,
        feesCount: sync.feesCount,
        claimsDetected: sync.claimsDetected,
        duration: sync.completedAt && sync.startedAt 
          ? Math.round((new Date(sync.completedAt).getTime() - new Date(sync.startedAt).getTime()) / 1000)
          : undefined,
        error: sync.error
      })),
      total: history.total
    });
  } catch (error: any) {
    logger.error('Get sync history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync history',
      message: error.message
    });
  }
};

/**
 * Cancel a sync job
 * POST /api/sync/cancel/:syncId
 */
export const cancelSync = async (req: Request, res: Response) => {
  try {
    const { syncId } = req.params;
    // Extract user ID from middleware (set by userIdMiddleware)
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

    logger.info(`Cancelling sync for syncId: ${syncId}, userId: ${userId}`);

    const cancelled = await syncJobManager.cancelSync(syncId, userId);

    if (!cancelled) {
      return res.status(404).json({
        success: false,
        error: 'Sync not found or cannot be cancelled'
      });
    }

    res.json({
      success: true,
      message: 'Sync cancelled successfully'
    });
  } catch (error: any) {
    logger.error('Cancel sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel sync',
      message: error.message
    });
  }
};

/**
 * Force sync (alias for startSync)
 * POST /api/sync/force
 */
export const forceSync = async (req: Request, res: Response) => {
  // Just call startSync
  return startSync(req, res);
};

export default {
  startSync,
  getActiveSyncStatus,
  getSyncStatus,
  getSyncHistory,
  cancelSync,
  forceSync
};
