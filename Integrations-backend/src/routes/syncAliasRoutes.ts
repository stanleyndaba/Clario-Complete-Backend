import { Router } from 'express';
import enhancedSyncController from '../controllers/enhancedSyncController';
import { authenticateUser } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateUser);

// Aliases under /api/v1/integrations/sync/* to reuse enhanced sync handlers
router.post('/start', enhancedSyncController.startEnhancedSync.bind(enhancedSyncController));
router.get('/status/:syncId', enhancedSyncController.getEnhancedSyncStatus.bind(enhancedSyncController));
router.get('/history', enhancedSyncController.getEnhancedSyncHistory.bind(enhancedSyncController));
router.get('/statistics', enhancedSyncController.getEnhancedSyncStatistics.bind(enhancedSyncController));

export default router;


