import { Router } from 'express';
import { authenticateToken, requireUser } from '../middleware/authMiddleware';
import { syncService } from '../services/syncService';

const router = Router();

router.use(authenticateToken);

// GET /api/v1/sync-check/:entityId?source=amazon|shopify|internal
router.get('/sync-check/:entityId', requireUser, async (req, res) => {
  try {
    const entityId = req.params.entityId;
    const source = (req.query.source as string) || 'internal';
    const result = await syncService.checkNow(source as any, entityId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'sync-check failed' });
  }
});

// POST /api/v1/sync-check/:entityId/refresh?source=...
router.post('/sync-check/:entityId/refresh', requireUser, async (req, res) => {
  try {
    const entityId = req.params.entityId;
    const source = (req.query.source as string) || 'internal';
    const result = await syncService.refresh(source as any, entityId, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'refresh failed' });
  }
});

export default router;


