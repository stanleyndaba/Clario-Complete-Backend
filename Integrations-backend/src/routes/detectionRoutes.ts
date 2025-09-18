import { Router } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/authMiddleware';
import enhancedDetectionService from '../services/enhancedDetectionService';

const router = Router();

router.use(authenticateUser);

// POST /api/v1/integrations/detections/run
router.post('/run', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { syncId, triggerType = 'inventory', metadata } = req.body || {};
    if (!syncId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'syncId is required' } });
    }
    await enhancedDetectionService.triggerDetectionPipeline(userId, syncId, triggerType, metadata);
    return res.json({ success: true, job: { sync_id: syncId, trigger_type: triggerType } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/detections/status/:syncId
router.get('/status/:syncId', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { syncId } = req.params;
    const results = await enhancedDetectionService.getDetectionResults(userId, syncId);
    return res.json({ success: true, results });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

export default router;


