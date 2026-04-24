import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { getRedisClient } from '../utils/redisClient';
import { rateLimit } from '../middleware/rateLimit';
import { getLogger } from '../utils/logger';
import {
  buildExplainScope,
  explainCase,
  explainFinding,
  explainRecovery,
  prepareExplainScope,
  AiExplainerError,
} from '../services/aiExplainerService';

const router = Router();
const logger = getLogger('AiRoutes');

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || (req.headers['x-real-ip'] as string)
    || req.socket.remoteAddress
    || req.ip
    || 'unknown'
  );
}

function getRequestId(req: Request): string {
  return String(req.headers['x-request-id'] || '').trim() || crypto.randomUUID();
}

function hasExplicitTenantSignal(req: Request): boolean {
  const headerTenantId = req.headers['x-tenant-id'];
  const queryTenantSlug = req.query?.tenantSlug;
  const pathTenantMatch = /^\/app\/[^/]+/.test(req.originalUrl?.split('?')[0] || req.path);

  return Boolean(
    (typeof headerTenantId === 'string' && headerTenantId.trim())
    || (typeof queryTenantSlug === 'string' && queryTenantSlug.trim())
    || pathTenantMatch
  );
}

async function aiExplainerRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const redisClient = await getRedisClient();
    const limiter = rateLimit({
      keyPrefix: 'ai_explain',
      windowSec: 60,
      maxHits: 20,
      redisClient,
      getKey: (request) => {
        const tenantId = String((request as any).tenant?.tenantId || 'no-tenant').trim();
        const userId = String((request as any).user?.id || 'anonymous').trim();
        return `ai_explain:${tenantId}:${userId}:${getClientIp(request)}`;
      },
    });

    return limiter(req, res, next);
  } catch {
    return next();
  }
}

function validateScopedRequest(req: Request): {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  requestId: string;
} {
  const tenantId = String((req as any).tenant?.tenantId || '').trim();
  const tenantSlug = String(req.query.tenantSlug || (req as any).tenant?.tenantSlug || '').trim();
  const userId = String((req as any).user?.id || '').trim();
  const requestId = getRequestId(req);

  if (!tenantId || !tenantSlug) {
    throw new AiExplainerError(400, 'TENANT_REQUIRED', 'Explicit tenant context is required for AI explanation.');
  }

  if (!hasExplicitTenantSignal(req)) {
    throw new AiExplainerError(400, 'TENANT_REQUIRED', 'Explicit tenant context is required for AI explanation.');
  }

  if (!userId) {
    throw new AiExplainerError(401, 'UNAUTHORIZED', 'Authenticated user is required for AI explanation.');
  }

  return { tenantId, tenantSlug, userId, requestId };
}

function parseBodyStringField(body: any, field: string): string {
  const value = String(body?.[field] || '').trim();
  if (!value) {
    throw new AiExplainerError(400, 'VALIDATION_ERROR', `${field} is required.`);
  }
  return value;
}

async function handleExplainRequest(
  req: Request,
  res: Response,
  idField: string,
  runner: (scope: ReturnType<typeof buildExplainScope>, id: string) => Promise<any>
) {
  const requestStartedAt = Date.now();
  let scopeForLogs: ReturnType<typeof buildExplainScope> | null = null;
  let objectId: string | null = null;

  try {
    const scopeInput = validateScopedRequest(req);
    objectId = parseBodyStringField(req.body, idField);
    scopeForLogs = buildExplainScope(scopeInput);

    await prepareExplainScope(scopeForLogs);
    const result = await runner(scopeForLogs, objectId);

    return res.json({
      success: true,
      explanation: result.explanation,
      meta: result.meta,
    });
  } catch (error: any) {
    const requestId = scopeForLogs?.requestId || getRequestId(req);
    const tenantId = scopeForLogs?.tenantId || String((req as any).tenant?.tenantId || '').trim() || null;
    const status = error instanceof AiExplainerError ? error.status : 500;
    const code = error instanceof AiExplainerError ? error.code : 'AI_EXPLAINER_INTERNAL_ERROR';
    const message = error instanceof AiExplainerError
      ? error.message
      : 'AI explanation failed unexpectedly.';

    logger.warn('AI explainer request failed', {
      requestId,
      tenantId,
      objectId,
      model: process.env.AI_EXPLAINER_MODEL || 'gpt-4.1-nano',
      latencyMs: Date.now() - requestStartedAt,
      success: false,
      errorCode: code,
      errorMessage: message,
    });

    return res.status(status).json({
      success: false,
      error: {
        code,
        message,
      },
      request_id: requestId,
    });
  }
}

router.use(authenticateToken);
router.use(aiExplainerRateLimiter);

router.post('/explain/case', async (req: Request, res: Response) => {
  return handleExplainRequest(req, res, 'caseId', explainCase);
});

router.post('/explain/recovery', async (req: Request, res: Response) => {
  return handleExplainRequest(req, res, 'recoveryId', explainRecovery);
});

router.post('/explain/finding', async (req: Request, res: Response) => {
  return handleExplainRequest(req, res, 'findingId', explainFinding);
});

export default router;
