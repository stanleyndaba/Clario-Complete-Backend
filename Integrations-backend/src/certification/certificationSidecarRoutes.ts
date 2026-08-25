import { Request, Response, Router } from 'express';
import logger from '../utils/logger';
import { CertificationSidecarConfig } from './certificationSidecarConfig';
import {
  CertificationSidecarRuntime,
  certificationFixture,
  getCertificationSidecarRuntime,
  hasCertificationInternalKey,
} from './certificationSidecarRuntime';

function callbackPage(status: 'ok' | 'error', detail: string): string {
  const title = status === 'ok' ? 'QuickBooks Sandbox certification received' : 'QuickBooks Sandbox certification failed';
  const safeDetail = detail.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[character] || character));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${safeDetail}</p><p>You may close this window. The certification worker will record the result in the isolated test database.</p></body></html>`;
}

function requireInternalKey(config: CertificationSidecarConfig, req: Request, res: Response, next: () => void): void {
  if (!hasCertificationInternalKey(config, req.headers['x-certification-internal-key'])) {
    res.status(401).json({ ok: false, error: 'Certification control authorization required' });
    return;
  }
  next();
}

export function createCertificationSidecarRouter(config: CertificationSidecarConfig): Router {
  const router = Router();
  const runtime: CertificationSidecarRuntime = getCertificationSidecarRuntime(config);

  router.get('/health', (req, res, next) => requireInternalKey(config, req, res, next), async (_req, res) => {
    const health = await runtime.health();
    res.status(health.redis && health.database && health.worker ? 200 : 503).json({
      ok: health.redis && health.database && health.worker,
      data: health,
      classification: 'production-adjacent dependency-isolated certification sidecar',
    });
  });

  router.post('/fixture/bootstrap', (req, res, next) => requireInternalKey(config, req, res, next), async (_req, res) => {
    const fixture = await runtime.bootstrapFixture();
    res.status(201).json({
      ok: true,
      data: fixture,
      classification: 'locally-created isolated test fixture; not provider or accounting evidence',
    });
  });

  router.post('/queue/probe', (req, res, next) => requireInternalKey(config, req, res, next), async (_req, res) => {
    const jobId = await runtime.enqueueProbe();
    res.status(202).json({
      ok: true,
      data: {
        jobId,
        fixture: certificationFixture,
        expectedOutcome: 'The dedicated worker consumes this source-less job and fails before any QuickBooks provider call or accounting write.',
      },
      classification: 'queue and worker fixture evidence only',
    });
  });

  router.post('/quickbooks/oauth/start', (req, res, next) => requireInternalKey(config, req, res, next), async (_req, res) => {
    const authorizationUrl = await runtime.getOAuthAuthorizationUrl();
    res.status(200).json({
      ok: true,
      data: {
        authorizationUrl,
        callback: config.quickBooks.redirectUri || null,
        providerEnvironment: 'sandbox',
      },
      warning: 'Do not open the authorization URL until explicit user approval for QuickBooks Sandbox consent is recorded.',
    });
  });

  router.get('/quickbooks/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const realmId = typeof req.query.realmId === 'string' ? req.query.realmId : '';
    const providerError = typeof req.query.error === 'string' ? req.query.error : '';

    if (providerError || !state || !code || !realmId) {
      logger.warn('Certification QuickBooks callback was incomplete', { hasState: Boolean(state), hasCode: Boolean(code), hasRealmId: Boolean(realmId), providerError: providerError || null });
      res.status(400).type('html').send(callbackPage('error', 'QuickBooks Sandbox did not return a complete authorization result. No credential was stored.'));
      return;
    }

    try {
      const validState = await runtime.consumeOAuthState(state);
      if (!validState) {
        res.status(400).type('html').send(callbackPage('error', 'The one-time authorization state was invalid, expired, or already used. No credential was stored.'));
        return;
      }
      const jobId = await runtime.exchangeAuthorizationCode(code, realmId);
      logger.info('Certification QuickBooks callback persisted encrypted credentials and queued isolated read', { jobId, provider: 'quickbooks', environment: 'sandbox' });
      res.status(200).type('html').send(callbackPage('ok', 'Authorization was stored with encrypted credentials in the isolated test database and an isolated read was queued.'));
    } catch (error: any) {
      logger.warn('Certification QuickBooks callback failed', { error: String(error?.message || 'callback_failed').slice(0, 300) });
      res.status(502).type('html').send(callbackPage('error', 'The authorization exchange or isolated queue handoff failed. No provider-read success is implied.'));
    }
  });

  router.post('/quickbooks/sync', (req, res, next) => requireInternalKey(config, req, res, next), async (_req, res) => {
    const jobId = await runtime.enqueueManualSync();
    res.status(202).json({ ok: true, data: { jobId, provider: 'quickbooks', environment: 'sandbox' } });
  });

  return router;
}
