import { Request, Router } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import sellerLifecycleService from '../services/sellerLifecycleService';

const router = Router();

router.use(authenticateToken);

router.get('/', async (req: AuthenticatedRequest & Request, res) => {
  try {
    const userId = String(req.user?.id || '').trim();
    const tenantId = String((req as any).tenant?.tenantId || '').trim();
    const tenantSlug = String((req as any).tenant?.tenantSlug || '').trim();

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!tenantId || !tenantSlug) {
      return res.status(400).json({ success: false, message: 'Active workspace context is required' });
    }

    const auditIntentId = typeof req.query.auditIntentId === 'string'
      ? req.query.auditIntentId.trim()
      : null;
    const lifecycle = await sellerLifecycleService.resolve({
      userId,
      tenantId,
      tenantSlug,
      auditIntentId,
    });

    return res.json({ success: true, ...lifecycle });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to resolve seller lifecycle',
    });
  }
});

export default router;
