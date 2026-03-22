import { Router, Request, Response } from 'express';
import { getDisputeCaseQueue } from '../services/disputeCaseQueueService';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const payload = await getDisputeCaseQueue({
      tenantSlug: String(req.query.tenantSlug || req.query.tenant_slug || '').trim() || undefined,
      requestTenantId: (req as any).tenant?.tenantId || null,
      requestTenantSlug: (req as any).tenant?.tenantSlug || null,
      userId: (req as any).userId || (req as any).user?.id || (req as any).user?.user_id || null,
      search: String(req.query.search || '').trim() || undefined,
      status: String(req.query.status || '').trim() || undefined,
      filing_status: String(req.query.filing_status || '').trim() || undefined,
      recovery_status: String(req.query.recovery_status || '').trim() || undefined,
      billing_status: String(req.query.billing_status || '').trim() || undefined,
      evidence_state: String(req.query.evidence_state || '').trim() || undefined,
      rejection_category: String(req.query.rejection_category || '').trim() || undefined,
      sort_by: String(req.query.sort_by || '').trim() || undefined,
      sort_order: String(req.query.sort_order || '').trim() || undefined,
      page: Number(req.query.page || 1),
      page_size: Number(req.query.page_size || 25),
    });

    return res.json({
      success: true,
      ...payload
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to load dispute case queue';
    const lower = String(message).toLowerCase();
    const statusCode =
      lower.includes('authentication') || lower.includes('authenticated') ? 401 :
      lower.includes('tenant not found') ? 404 :
      lower.includes('access') ? 403 :
      lower.includes('tenant context required') || lower.includes('invalid tenant context') ? 400 :
      500;

    return res.status(statusCode).json({
      success: false,
      message
    });
  }
});

export default router;
