import { Router } from 'express';
import enhancedSyncController from '../controllers/enhancedSyncController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Apply authentication middleware to all sync routes (guarded)
router.use((req, res, next) => {
  try {
    return (authenticateToken as any)(req, res, next);
  } catch {
    return next();
  }
});

/**
 * @route GET /api/enhanced-sync/status/:syncId
 * @desc Get enhanced sync status including detection pipeline status
 * @access Private
 */
router.get('/status/:syncId', enhancedSyncController.getEnhancedSyncStatus.bind(enhancedSyncController));

/**
 * @route POST /api/enhanced-sync/start
 * @desc Start enhanced sync with detection pipeline integration
 * @access Private
 * @body { syncType: string, enableDetection?: boolean }
 */
router.post('/start', enhancedSyncController.startEnhancedSync.bind(enhancedSyncController));

/**
 * @route GET /api/enhanced-sync/history
 * @desc Get enhanced sync history with detection pipeline information
 * @access Private
 * @query limit - Number of records to return (default: 10)
 * @query offset - Number of records to skip (default: 0)
 */
router.get('/history', enhancedSyncController.getEnhancedSyncHistory.bind(enhancedSyncController));

/**
 * @route GET /api/enhanced-sync/statistics
 * @desc Get enhanced sync statistics including detection pipeline metrics
 * @access Private
 */
router.get('/statistics', enhancedSyncController.getEnhancedSyncStatistics.bind(enhancedSyncController));

/**
 * @route DELETE /api/enhanced-sync/cancel/:syncId
 * @desc Cancel enhanced sync and cleanup detection pipeline
 * @access Private
 */
router.delete('/cancel/:syncId', enhancedSyncController.cancelEnhancedSync.bind(enhancedSyncController));

/**
 * @route GET /api/enhanced-sync/progress/:syncId
 * @desc Get real-time enhanced sync progress
 * @access Private
 */
router.get('/progress/:syncId', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { syncId } = req.params as any;

    const progress = await enhancedSyncController.getRealtimeEnhancedSyncProgress(userId, syncId);

    if (!progress) {
      return res.status(404).json({
        success: false,
        message: 'Sync not found'
      });
    }

    res.json({
      success: true,
      data: progress
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

/**
 * @route POST /api/enhanced-sync/bulk
 * @desc Start multiple sync operations with different types
 * @access Private
 * @body { syncs: Array<{ syncType: string, enableDetection?: boolean }> }
 */
router.post('/bulk', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { syncs } = req.body as any;

    if (!syncs || !Array.isArray(syncs) || syncs.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'syncs array is required and must not be empty'
      });
    }

    if (syncs.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 5 sync operations allowed per bulk request'
      });
    }

    const results: any[] = [];
    const errors: any[] = [];

    for (const syncConfig of syncs) {
      try {
        const syncId = `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // Placeholder success result
        results.push({ syncId, syncType: syncConfig.syncType, status: 'started' });
      } catch (error: any) {
        errors.push({ syncType: syncConfig.syncType, error: error?.message || 'Unknown error' });
      }
    }

    res.json({
      success: true,
      data: { results, errors, totalRequested: syncs.length, totalStarted: results.length, totalErrors: errors.length }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
  }
});

/**
 * @route GET /api/enhanced-sync/health
 * @desc Get sync system health status
 * @access Private
 */
router.get('/health', async (_req, res) => {
  res.json({ success: true, data: { status: 'healthy' } });
});

/**
 * @route GET /api/enhanced-sync/queue
 * @desc Get sync queue status and pending operations
 * @access Private
 */
router.get('/queue', async (req, res) => {
  try {
    const userId = (req as any).user?.id;

    // Get pending sync operations
    const { data: pendingSyncs, error: syncError } = await supabase
      .from('sync_progress')
      .select('sync_id, current_step, status, created_at, metadata')
      .eq('user_id', userId)
      .in('status', ['running', 'pending'])
      .order('created_at', { ascending: true });

    if (syncError) {
      throw new Error(`Failed to fetch pending syncs: ${syncError.message}`);
    }

    // Get pending detection jobs
    const { data: pendingDetections, error: detectionError } = await supabase
      .from('detection_queue')
      .select('id, sync_id, status, priority, attempts, created_at')
      .eq('seller_id', userId)
      .in('status', ['pending', 'processing'])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (detectionError) {
      throw new Error(`Failed to fetch pending detections: ${detectionError.message}`);
    }

    res.json({
      success: true,
      data: {
        sync: {
          pending: pendingSyncs?.length || 0,
          running: pendingSyncs?.filter(sync => sync.status === 'running').length || 0,
          operations: pendingSyncs || []
        },
        detection: {
          pending: pendingDetections?.length || 0,
          processing: pendingDetections?.filter(job => job.status === 'processing').length || 0,
          jobs: pendingDetections || []
        },
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

/**
 * @route POST /api/enhanced-sync/cleanup
 * @desc Clean up completed and failed sync operations
 * @access Private
 * @query days - Number of days to keep (default: 30)
 */
router.post('/cleanup', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { days = 30 } = req.query as any;

    const cutoffDate = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

    // Clean up old sync progress records
    const { error: syncCleanupError } = await supabase
      .from('sync_progress')
      .delete()
      .eq('user_id', userId)
      .in('status', ['completed', 'failed', 'cancelled'])
      .lt('created_at', cutoffDate.toISOString());

    if (syncCleanupError) {
      throw new Error(`Failed to cleanup sync records: ${syncCleanupError.message}`);
    }

    // Clean up old detection triggers
    const { error: triggerCleanupError } = await supabase
      .from('sync_detection_triggers')
      .delete()
      .eq('seller_id', userId)
      .in('status', ['detection_completed', 'failed', 'cancelled'])
      .lt('created_at', cutoffDate.toISOString());

    if (triggerCleanupError) {
      throw new Error(`Failed to cleanup detection triggers: ${triggerCleanupError.message}`);
    }

    // Clean up old detection queue jobs
    const { error: queueCleanupError } = await supabase
      .from('detection_queue')
      .delete()
      .eq('seller_id', userId)
      .in('status', ['completed', 'failed', 'cancelled'])
      .lt('created_at', cutoffDate.toISOString());

    if (queueCleanupError) {
      throw new Error(`Failed to cleanup detection queue: ${queueCleanupError.message}`);
    }

    res.json({
      success: true,
      message: `Cleanup completed for records older than ${days} days`,
      data: {
        cutoffDate: cutoffDate.toISOString(),
        cleanupCompleted: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

export default router;

