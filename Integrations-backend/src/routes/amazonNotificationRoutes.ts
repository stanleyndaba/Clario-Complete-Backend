import express, { Request, Response, Router } from 'express';
import amazonNotificationService from '../services/amazonNotificationService';
import { getCurrentTenant, requireRole } from '../middleware/tenantMiddleware';
import logger from '../utils/logger';

export const amazonNotificationWebhookRouter = Router();
amazonNotificationWebhookRouter.use(express.text({ type: ['text/plain', 'application/json', 'application/*+json'] }));

amazonNotificationWebhookRouter.post('/', async (req: Request, res: Response) => {
  try {
    const result = await amazonNotificationService.receiveWebhook(req.body);
    return res.status(result.statusCode).json(result.response);
  } catch (error: any) {
    logger.error('[AMAZON NOTIFICATIONS] Webhook receiver failed', {
      error: error?.message || error
    });

    return res.status(500).json({
      success: false,
      error: 'Amazon notification processing failed',
      message: error?.message || 'Internal error'
    });
  }
});

amazonNotificationWebhookRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'amazon_notifications_webhook',
    timestamp: new Date().toISOString()
  });
});

export const amazonNotificationAuditRouter = Router();
amazonNotificationAuditRouter.use(requireRole('owner', 'admin'));

amazonNotificationAuditRouter.get('/', async (req: Request, res: Response) => {
  try {
    const tenant = getCurrentTenant(req);
    const notifications = await amazonNotificationService.listNotifications(tenant.tenantId, {
      storeId: (req.query.storeId as string | undefined) || (req.headers['x-store-id'] as string | undefined),
      limit: Number(req.query.limit || 50),
      status: (req.query.status as string | undefined) || undefined
    });

    return res.json({
      success: true,
      notifications
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to load Amazon notification audit trail'
    });
  }
});

amazonNotificationAuditRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenant = getCurrentTenant(req);
    const notification = await amazonNotificationService.getNotificationById(req.params.id, tenant.tenantId);

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Amazon notification not found'
      });
    }

    return res.json({
      success: true,
      notification
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to load Amazon notification'
    });
  }
});

amazonNotificationAuditRouter.post('/:id/replay', async (req: Request, res: Response) => {
  try {
    const tenant = getCurrentTenant(req);
    const replayResult = await amazonNotificationService.replayStoredNotification(req.params.id, tenant.tenantId, {
      dryRun: String(req.query.dryRun || req.body?.dryRun || '').trim().toLowerCase() === 'true'
    });

    return res.json({
      success: true,
      replayResult
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to replay Amazon notification'
    });
  }
});
