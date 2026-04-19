import express from 'express';
import requirePlatformAdmin from '../middleware/platformAdminMiddleware';
import manualUserBroadcastService, { type ManualBroadcastInput } from '../services/manualUserBroadcastService';
import logger from '../utils/logger';

const router = express.Router();

function getActorUserId(req: any): string | null {
  return req.userId || req.user?.id || req.user?.user_id || null;
}

function normalizeError(error: unknown): { status: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error || 'MANUAL_BROADCAST_ERROR');
  const code = message.split(':')[0] || 'MANUAL_BROADCAST_ERROR';

  if (
    code === 'MANUAL_BROADCAST_SUBJECT_REQUIRED' ||
    code === 'MANUAL_BROADCAST_HEADING_REQUIRED' ||
    code === 'MANUAL_BROADCAST_BODY_REQUIRED' ||
    code === 'MANUAL_BROADCAST_TEST_EMAIL_REQUIRED' ||
    code === 'MANUAL_BROADCAST_NO_RECIPIENTS' ||
    code === 'MANUAL_BROADCAST_SENT_EDIT_BLOCKED' ||
    code === 'MANUAL_BROADCAST_ALREADY_SENT' ||
    code === 'MANUAL_BROADCAST_ARCHIVED' ||
    code === 'MANUAL_BROADCAST_FAILED_RETRY_DEFERRED'
  ) {
    return { status: 400, code, message };
  }

  if (code === 'MANUAL_BROADCAST_NOT_FOUND') {
    return { status: 404, code, message };
  }

  if (code === 'MANUAL_BROADCAST_SCHEMA_MISSING') {
    return { status: 503, code, message };
  }

  return { status: 500, code, message };
}

router.use(requirePlatformAdmin);

router.get('/', async (_req, res) => {
  try {
    const broadcasts = await manualUserBroadcastService.listBroadcasts();
    return res.json({ success: true, data: broadcasts });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[MANUAL BROADCAST] Failed to list broadcasts', { error: normalized.message });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const broadcast = await manualUserBroadcastService.getBroadcastWithPreview(req.params.id);
    if (!broadcast) {
      return res.status(404).json({ success: false, error: 'MANUAL_BROADCAST_NOT_FOUND' });
    }
    return res.json({ success: true, data: broadcast });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[MANUAL BROADCAST] Failed to fetch broadcast', { broadcastId: req.params.id, error: normalized.message });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.post('/', async (req: any, res) => {
  try {
    const broadcast = await manualUserBroadcastService.createDraft(req.body as ManualBroadcastInput, getActorUserId(req));
    return res.status(201).json({ success: true, data: broadcast });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[MANUAL BROADCAST] Failed to create draft', { error: normalized.message });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.patch('/:id', async (req: any, res) => {
  try {
    const broadcast = await manualUserBroadcastService.updateDraft(req.params.id, req.body as ManualBroadcastInput, getActorUserId(req));
    return res.json({ success: true, data: broadcast });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[MANUAL BROADCAST] Failed to update draft', { broadcastId: req.params.id, error: normalized.message });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.post('/:id/test-send', async (req, res) => {
  try {
    const result = await manualUserBroadcastService.testSend(req.params.id, req.body?.emails);
    return res.json({ success: true, data: result });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[MANUAL BROADCAST] Failed to test-send broadcast', { broadcastId: req.params.id, error: normalized.message });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

router.post('/:id/send', async (req: any, res) => {
  try {
    const broadcast = await manualUserBroadcastService.sendBroadcast(req.params.id, getActorUserId(req));
    return res.json({ success: true, data: broadcast });
  } catch (error) {
    const normalized = normalizeError(error);
    logger.error('[MANUAL BROADCAST] Failed to send broadcast', { broadcastId: req.params.id, error: normalized.message });
    return res.status(normalized.status).json({ success: false, error: normalized.code, message: normalized.message });
  }
});

export default router;
