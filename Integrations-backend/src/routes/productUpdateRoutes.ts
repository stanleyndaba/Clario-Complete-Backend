import express from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import productUpdateService, { type ProductUpdateInput } from '../services/productUpdateService';
import logger from '../utils/logger';

const router = express.Router();

function hasTrustedInternalApiKey(req: any): boolean {
  const configuredKey = process.env.INTERNAL_API_KEY;
  if (!configuredKey || configuredKey.trim().length === 0) {
    return false;
  }

  const providedKey = req.headers['x-internal-api-key'] || req.headers['x-api-key'];
  return typeof providedKey === 'string' && providedKey === configuredKey;
}

async function canManageProductUpdates(req: any): Promise<boolean> {
  if (hasTrustedInternalApiKey(req)) {
    return true;
  }

  const userId = getActorUserId(req);
  if (!userId) {
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logger.warn('[PRODUCT UPDATES] Failed to verify platform admin role', {
      userId,
      error: error.message
    });
    return false;
  }

  return String(data?.role || '').toLowerCase() === 'admin';
}

async function requireProductUpdateAdmin(req: any, res: any, next: any) {
  if (await canManageProductUpdates(req)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    error: 'PRODUCT_UPDATE_ADMIN_REQUIRED'
  });
}

function getActorUserId(req: any): string | null {
  return req.userId || req.user?.id || req.user?.user_id || null;
}

function normalizeError(error: unknown): { status: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error || 'PRODUCT_UPDATE_ERROR');
  const code = message.split(':')[0] || 'PRODUCT_UPDATE_ERROR';

  if (
    code === 'TITLE_REQUIRED' ||
    code === 'SUMMARY_REQUIRED' ||
    code === 'SLUG_REQUIRED' ||
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

router.get('/', async (_req, res) => {
  try {
    const updates = await productUpdateService.listPublishedUpdates();
    res.json({ success: true, data: updates });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[PRODUCT UPDATES] Failed to list published updates', { error: normalized.message });
    res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.get('/:slug', async (req, res) => {
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

router.post('/', requireProductUpdateAdmin, async (req: any, res) => {
  try {
    const update = await productUpdateService.createDraft(req.body as ProductUpdateInput, getActorUserId(req));
    return res.status(201).json({ success: true, data: update });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[PRODUCT UPDATES] Failed to create draft', { error: normalized.message });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.patch('/:id', requireProductUpdateAdmin, async (req: any, res) => {
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

router.post('/:id/publish', requireProductUpdateAdmin, async (req: any, res) => {
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

router.post('/:id/archive', requireProductUpdateAdmin, async (req, res) => {
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
