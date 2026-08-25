import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { addAccountingSyncJob, getQueueMetrics, isQueueHealthy } from '../queues/ingestionQueue';

const router = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCertificationRuntime(): boolean {
  return process.env.CERTIFICATION_RUNTIME === 'true';
}

function hasValidInternalKey(req: Request): boolean {
  const expected = String(process.env.INTERNAL_API_KEY || '');
  const provided = typeof req.headers['x-internal-api-key'] === 'string'
    ? req.headers['x-internal-api-key']
    : '';

  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function requireCertificationControl(req: Request, res: Response, next: () => void): void {
  if (!isCertificationRuntime()) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  if (!hasValidInternalKey(req)) {
    res.status(401).json({ ok: false, error: 'Certification control authorization required' });
    return;
  }
  next();
}

/**
 * Certification-only diagnostics. This router is mounted only when
 * CERTIFICATION_RUNTIME=true. It must never be enabled on the production service.
 */
router.get('/queue-health', requireCertificationControl, async (_req, res) => {
  const healthy = await isQueueHealthy();
  const metrics = await getQueueMetrics();
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    data: { healthy, metrics }
  });
});

/**
 * Enqueues a deliberately source-less QuickBooks accounting job. The worker must
 * consume it and fail at the source-resolution boundary before any provider call,
 * OAuth persistence, accounting record, evidence, or recovery data can be written.
 * It is queue/worker fixture evidence only, never provider evidence.
 */
router.post('/queue-probe', requireCertificationControl, async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const tenantId = String(req.body?.tenantId || '').trim();
  if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(tenantId)) {
    res.status(400).json({ ok: false, error: 'Valid isolated userId and tenantId are required.' });
    return;
  }

  const jobId = await addAccountingSyncJob(userId, tenantId, 'quickbooks', 'manual');
  if (!jobId) {
    res.status(503).json({ ok: false, error: 'Certification queue did not accept the controlled fixture job.' });
    return;
  }

  res.status(202).json({
    ok: true,
    data: {
      jobId,
      fixture: 'source-less quickbooks accounting job',
      expectedOutcome: 'worker consumes the job and fails before provider access because no accounting connection exists'
    }
  });
});

export default router;
