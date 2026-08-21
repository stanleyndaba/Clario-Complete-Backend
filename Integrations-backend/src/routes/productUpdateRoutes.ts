import express from 'express';
import productUpdateService, { type ProductUpdateInput } from '../services/productUpdateService';
import logger from '../utils/logger';
import { requirePlatformAdmin } from '../middleware/platformAdminMiddleware';

const router = express.Router();

function getActorUserId(req: any): string | null {
  return req.userId || req.user?.id || req.user?.user_id || null;
}

function requireAuthenticatedProductUpdateReader(req: any, res: any, next: any) {
  const identitySource = String(req.authIdentitySource || '');
  const hasVerifiedOrTrustedIdentity = [
    'verified-supabase-token',
    'verified-backend-jwt',
    'trusted-req-user-id',
    'trusted-req-user-user_id',
    'trusted-x-user-id',
    'trusted-x-forwarded-user-id'
  ].includes(identitySource);

  if (getActorUserId(req) && hasVerifiedOrTrustedIdentity) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'PRODUCT_UPDATE_AUTH_REQUIRED'
  });
}

function normalizeError(error: unknown): { status: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error || 'PRODUCT_UPDATE_ERROR');
  const code = message.split(':')[0] || 'PRODUCT_UPDATE_ERROR';

  if (
    /^(TITLE|SUMMARY|SLUG|BODY|TAG|HIGHLIGHT|HIGHLIGHTS|CTA_TEXT|CTA_HREF)_/.test(code) ||
    code === 'ARCHIVED_UPDATE_CANNOT_PUBLISH' ||
    code === 'PUBLISHED_UPDATE_EDIT_BLOCKED'
  ) {
    return { status: 400, code, message };
  }

  if (code === 'PRODUCT_UPDATE_NOT_FOUND') {
    return { status: 404, code, message };
  }

  if (code === 'PRODUCT_UPDATE_SLUG_EXISTS') {
    return { status: 409, code, message };
  }

  if (code === 'PRODUCT_UPDATE_SCHEMA_MISSING' || code === 'PRODUCT_UPDATE_SCHEMA_MISMATCH') {
    return { status: 503, code, message };
  }

  return { status: 500, code, message };
}

router.get('/', requireAuthenticatedProductUpdateReader, async (_req, res) => {
  try {
    const updates = await productUpdateService.listPublishedUpdates();
    res.json({ success: true, data: updates });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[PRODUCT UPDATES] Failed to list published updates', { error: normalized.message });
    res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.get('/admin-access', requirePlatformAdmin, async (_req, res) => {
  return res.json({ success: true, data: { allowed: true } });
});

router.get('/:slug', requireAuthenticatedProductUpdateReader, async (req, res) => {
  try {
    const update = await productUpdateService.getPublishedUpdateBySlug(req.params.slug);
    if (!update) {
      return res.status(404).json({ success: false, error: 'PRODUCT_UPDATE_NOT_FOUND' });
    }

    return res.json({ success: true, data: update });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[PRODUCT UPDATES] Failed to fetch published update', {
      slug: req.params.slug,
      error: normalized.message
    });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.post('/', requirePlatformAdmin, async (req: any, res) => {
  try {
    const update = await productUpdateService.createDraft(req.body as ProductUpdateInput, getActorUserId(req));
    return res.status(201).json({ success: true, data: update });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[PRODUCT UPDATES] Failed to create draft', { error: normalized.message });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.patch('/:id', requirePlatformAdmin, async (req: any, res) => {
  try {
    const update = await productUpdateService.updateDraftOrArchived(req.params.id, req.body as ProductUpdateInput);
    return res.json({ success: true, data: update });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[PRODUCT UPDATES] Failed to update record', {
      productUpdateId: req.params.id,
      error: normalized.message
    });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.post('/:id/publish', requirePlatformAdmin, async (req: any, res) => {
  try {
    const result = await productUpdateService.publish(req.params.id, getActorUserId(req));
    return res.json({
      success: true,
      data: result.update,
      broadcast_job: result.job
    });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[PRODUCT UPDATES] Failed to publish update', {
      productUpdateId: req.params.id,
      error: normalized.message
    });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.post('/:id/archive', requirePlatformAdmin, async (req, res) => {
  try {
    const update = await productUpdateService.archive(req.params.id);
    return res.json({ success: true, data: update });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[PRODUCT UPDATES] Failed to archive update', {
      productUpdateId: req.params.id,
      error: normalized.message
    });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

export default router;
