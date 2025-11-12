import { Router } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import enhancedDetectionService from '../services/enhancedDetectionService';
import detectionService from '../services/detectionService';

const router = Router();

router.use((req, res, next) => {
  try {
    return (authenticateToken as any)(req as any, res as any, next as any);
  } catch {
    return next();
  }
});

// POST /api/v1/integrations/detections/run
router.post('/run', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { syncId, triggerType = 'inventory', metadata } = ((req as any).body || {}) as any;
    if (!syncId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'syncId is required' } });
    }
    await enhancedDetectionService.triggerDetectionPipeline(userId, syncId, triggerType, metadata);
    return res.json({ success: true, job: { sync_id: syncId, trigger_type: triggerType } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/detections/results
// Get all detection results for the authenticated user
router.get('/results', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { status, limit = 100, offset = 0 } = (req as any).query;
    const results = await detectionService.getDetectionResults(
      userId,
      undefined, // syncId - optional
      status,
      parseInt(limit as string, 10),
      parseInt(offset as string, 10)
    );
    return res.json({ success: true, results, total: results.length });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/detections/status/:syncId
router.get('/status/:syncId', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { syncId } = (req as any).params;
    const results = await enhancedDetectionService.getDetectionResults(userId, syncId);
    return res.json({ success: true, results });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/detections/deadlines
// Get claims approaching deadline (Discovery Agent - 60-day deadline tracking)
router.get('/deadlines', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const daysThreshold = parseInt((req as any).query.days || '7', 10);
    const claims = await detectionService.getClaimsApproachingDeadline(userId, daysThreshold);
    return res.json({ 
      success: true, 
      claims,
      count: claims.length,
      threshold_days: daysThreshold
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/detections/statistics
// Get detection statistics including confidence distribution and recovery rates
router.get('/statistics', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = (req as any).userId || req.user?.id as string;
    const stats = await detectionService.getDetectionStatistics(userId);
    return res.json({ success: true, statistics: stats });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/detections/confidence-distribution
// Get confidence score distribution for monitoring and calibration
router.get('/confidence-distribution', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = (req as any).userId || req.user?.id as string;
    const distribution = await detectionService.getConfidenceDistribution(userId);
    return res.json({ success: true, distribution });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// PUT /api/v1/integrations/detections/:id/resolve
// Resolve a detection result (mark as resolved)
router.put('/:id/resolve', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { id } = (req as any).params;
    const { notes, resolution_amount } = (req as any).body || {};

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'VALIDATION_ERROR', message: 'Detection result ID is required' } 
      });
    }

    const result = await detectionService.resolveDetectionResult(userId, id, notes, resolution_amount);
    
    return res.json({ 
      success: true, 
      message: 'Detection result resolved successfully',
      detection: result
    });
  } catch (error: any) {
    if (error.message === 'Detection result not found') {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'NOT_FOUND', message: error.message } 
      });
    }
    return res.status(500).json({ 
      success: false, 
      error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } 
    });
  }
});

// PUT /api/v1/integrations/detections/:id/status
// Update detection result status (generic status update)
router.put('/:id/status', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { id } = (req as any).params;
    const { status, notes } = (req as any).body || {};

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'VALIDATION_ERROR', message: 'Detection result ID is required' } 
      });
    }

    if (!status) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'VALIDATION_ERROR', message: 'Status is required' } 
      });
    }

    const validStatuses = ['pending', 'reviewed', 'disputed', 'resolved'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'VALIDATION_ERROR', message: `Status must be one of: ${validStatuses.join(', ')}` } 
      });
    }

    const result = await detectionService.updateDetectionResultStatus(userId, id, status, notes);
    
    return res.json({ 
      success: true, 
      message: 'Detection result status updated successfully',
      detection: result
    });
  } catch (error: any) {
    if (error.message === 'Detection result not found') {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'NOT_FOUND', message: error.message } 
      });
    }
    return res.status(500).json({ 
      success: false, 
      error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } 
    });
  }
});

export default router;


