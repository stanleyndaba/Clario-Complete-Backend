import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import paystackSubscriptionService from '../services/paystackSubscriptionService';
import { verifyPaystackWebhookSignature } from '../services/paystackService';

const router = Router();

function getTenantId(req: Request): string | null {
  return String((req as any).tenant?.tenantId || '').trim() || null;
}

function getUser(req: Request): { id: string; email?: string | null } {
  const user = (req as any).user;
  return {
    id: String(user?.id || ''),
    email: typeof user?.email === 'string' ? user.email : null,
  };
}

async function initializeSubscriptionCheckout(req: Request, res: Response) {
  try {
    const user = getUser(req);
    if (!user.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const auditRunId = String(req.body?.audit_run_id || '').trim();
    if (!auditRunId) {
      return res.status(400).json({ success: false, message: 'audit_run_id is required' });
    }

    const result = await paystackSubscriptionService.initializeSubscription({
      userId: user.id,
      email: user.email,
      auditRunId,
      tenantId: getTenantId(req),
    });

    return res.json(result);
  } catch (error: any) {
    const message = error?.message || 'Failed to initialize Paystack checkout';
    const status = /not found/i.test(message) ? 404 : /membership|required|eligible/i.test(message) ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
}

router.post('/subscription/initialize', authenticateToken, initializeSubscriptionCheckout);

router.post('/checkout/initialize', authenticateToken, initializeSubscriptionCheckout);

router.post('/subscription/recover', authenticateToken, initializeSubscriptionCheckout);

router.get('/verify/:reference', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const reference = String(req.params.reference || '').trim();
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Payment reference is required' });
    }

    const result = await paystackSubscriptionService.verifyCheckout({
      reference,
      userId: user.id,
      tenantId: getTenantId(req),
    });

    if (!result.success && (result as any).status) {
      return res.status((result as any).status).json(result);
    }

    return res.json(result);
  } catch (error: any) {
    const message = error?.message || 'Failed to verify Paystack checkout';
    const status = /not found/i.test(message) ? 404 : /mismatch|membership|required/i.test(message) ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
});

router.post('/webhook', async (req: Request, res: Response) => {
  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const signature = typeof req.headers['x-paystack-signature'] === 'string'
    ? req.headers['x-paystack-signature']
    : undefined;

  try {
    if (!verifyPaystackWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ success: false, message: 'Invalid Paystack signature' });
    }

    const payload = req.body && typeof req.body === 'object'
      ? req.body
      : JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));

    const signatureHash = paystackSubscriptionService.computeWebhookSignatureHash(rawBody);
    const result = await paystackSubscriptionService.processWebhook(payload, signatureHash);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to process Paystack webhook',
    });
  }
});

router.get('/subscription/validate-plan', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const result = await paystackSubscriptionService.validateConfiguredPlan();
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Paystack plan validation failed' });
  }
});

export default router;
