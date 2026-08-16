import { Router } from 'express';
import { authenticateToken, AuthenticatedRequest, optionalAuth } from '../middleware/authMiddleware';
import auditIntentService from '../services/auditIntentService';

const router = Router();

router.post('/', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = (req as any).body || {};
    const intent = await auditIntentService.createIntent({
      sourceType: body.source_type || body.sourceType,
      returnPath: body.return_path || body.returnPath,
      idempotencyKey: body.idempotency_key || body.idempotencyKey || (req as any).headers?.['idempotency-key'],
      metadata: {
        created_from: 'public_audit_entry',
      }
    });

    return res.status(201).json({
      success: true,
      intent: {
        id: intent.id,
        source_type: intent.source_type,
        status: intent.status,
        return_path: intent.return_path,
        expires_at: intent.expires_at,
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to create audit intent'
    });
  }
});

router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const intent = await auditIntentService.getOwnedIntent(String((req as any).params?.id || ''), userId);
    if (!intent) {
      return res.status(404).json({ success: false, message: 'Audit intent not found' });
    }

    return res.json({ success: true, intent });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to load audit intent'
    });
  }
});

router.post('/:id/attach', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const tenantId = String((req as any).body?.tenant_id || (req as any).body?.tenantId || '').trim();
    if (!userId || !tenantId) {
      return res.status(400).json({ success: false, message: 'Authenticated user and tenant are required' });
    }

    const intent = await auditIntentService.attachIntent({
      intentId: String((req as any).params?.id || ''),
      userId,
      tenantId,
    });

    if (!intent) {
      return res.status(404).json({ success: false, message: 'Audit intent not found' });
    }

    return res.json({ success: true, intent });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to attach audit intent'
    });
  }
});

router.post('/:id/abandon', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const intent = await auditIntentService.abandonIntent(String((req as any).params?.id || ''), req.user?.id);
    return res.json({ success: true, intent });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to abandon audit intent'
    });
  }
});

export default router;
