import { Router } from 'express';
import {
  startSync,
  getActiveSyncStatus,
  getSyncStatus,
  getSyncHistory,
  cancelSync,
  forceSync
} from '../controllers/syncController';

const router = Router();

// POST /api/sync/start - Start a new sync job
router.post('/start', startSync);

// GET /api/sync/status - Get active sync status (for frontend monitoring)
// This must come BEFORE /status/:syncId to avoid route conflicts
// IMPORTANT: Route order matters - this exact path must be registered first
router.get('/status', getActiveSyncStatus);

// GET /api/sync/status/:syncId - Get sync status by syncId
router.get('/status/:syncId', getSyncStatus);

// GET /api/sync/history - Get sync history for authenticated user
router.get('/history', getSyncHistory);

// POST /api/sync/cancel/:syncId - Cancel a sync job
router.post('/cancel/:syncId', cancelSync);

// POST /api/sync/force - Force sync (alias for startSync)
router.post('/force', forceSync);

export default router;
