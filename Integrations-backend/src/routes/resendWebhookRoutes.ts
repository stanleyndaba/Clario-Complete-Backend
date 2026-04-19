import { Router } from 'express';
import crypto from 'crypto';
import { Webhook } from 'svix';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

const router = Router();

type ResendEventPayload = Record<string, any>;

function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  return String(email).replace(/^(.).+(@.+)$/, '$1***$2');
}

function getHeaderValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string') return value;
  return undefined;
}

function normalizeRecipient(value: unknown): string | null {
  if (Array.isArray(value)) {
    return normalizeRecipient(value[0]);
  }

  const email = String(value || '').trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function normalizeOccurredAt(payload: ResendEventPayload): string {
  const candidate = payload.created_at || payload.createdAt || payload.data?.created_at || payload.data?.createdAt;
  const date = candidate ? new Date(candidate) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeStatus(eventType: string): string {
  const normalized = eventType.toLowerCase();
  if (normalized.includes('delivered')) return 'delivered';
  if (normalized.includes('bounced')) return 'bounced';
  if (normalized.includes('complained') || normalized.includes('complaint')) return 'complained';
  if (normalized.includes('opened')) return 'opened';
  if (normalized.includes('clicked')) return 'clicked';
  if (normalized.includes('delivery_delayed') || normalized.includes('delayed')) return 'delayed';
  return normalized || 'received';
}

function extractProviderMessageId(payload: ResendEventPayload): string | null {
  return String(
    payload.data?.email_id ||
    payload.data?.emailId ||
    payload.data?.id ||
    payload.email_id ||
    payload.emailId ||
    ''
  ).trim() || null;
}

function extractProviderEventId(payload: ResendEventPayload, rawPayload: string): string {
  const explicitId = String(payload.id || payload.event_id || payload.eventId || payload.data?.event_id || '').trim();
  if (explicitId) return explicitId;

  const hash = crypto.createHash('sha256').update(rawPayload).digest('hex').slice(0, 32);
  return `resend_${hash}`;
}

function verifyWebhook(req: any): ResendEventPayload {
  const rawPayload = String(req.rawBody || JSON.stringify(req.body || {}));
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_WEBHOOK_SECRET_REQUIRED');
  }

  if (!secret) {
    return req.body || {};
  }

  const webhook = new Webhook(secret);
  return webhook.verify(rawPayload, {
    'svix-id': getHeaderValue(req.headers['svix-id']) || '',
    'svix-timestamp': getHeaderValue(req.headers['svix-timestamp']) || '',
    'svix-signature': getHeaderValue(req.headers['svix-signature']) || ''
  }) as ResendEventPayload;
}

async function updateWelcomeEmailState(messageId: string, status: string, occurredAt: string) {
  const updates: Record<string, unknown> = {
    welcome_email_delivery_status: status,
    welcome_email_last_event_at: occurredAt
  };

  if (status === 'delivered') updates.welcome_email_delivered_at = occurredAt;
  if (status === 'bounced') updates.welcome_email_bounced_at = occurredAt;
  if (status === 'complained') updates.welcome_email_complained_at = occurredAt;

  const { error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('welcome_email_provider_message_id', messageId);

  if (error) {
    logger.warn('[RESEND WEBHOOK] Failed to update welcome email delivery state', {
      providerMessageId: messageId,
      status,
      error: error.message
    });
  }
}

async function updateManualBroadcastDeliveryState(messageId: string, status: string, occurredAt: string) {
  const updates: Record<string, unknown> = {
    last_event_at: occurredAt
  };

  if (status === 'delivered') {
    updates.delivered_at = occurredAt;
  } else if (status === 'bounced') {
    updates.status = 'failed';
    updates.error = 'resend_bounced';
    updates.bounced_at = occurredAt;
  } else if (status === 'complained') {
    updates.status = 'failed';
    updates.error = 'resend_complained';
    updates.complained_at = occurredAt;
  }

  const { error } = await supabaseAdmin
    .from('manual_user_broadcast_deliveries')
    .update(updates)
    .eq('provider_message_id', messageId);

  if (error) {
    logger.warn('[RESEND WEBHOOK] Failed to update manual broadcast delivery state', {
      providerMessageId: messageId,
      status,
      error: error.message
    });
  }
}

router.post('/', async (req: any, res) => {
  let payload: ResendEventPayload;
  try {
    payload = verifyWebhook(req);
  } catch (error: any) {
    const code = error?.message || 'RESEND_WEBHOOK_VERIFICATION_FAILED';
    const status = code === 'RESEND_WEBHOOK_SECRET_REQUIRED' ? 503 : 400;
    return res.status(status).json({ success: false, error: code });
  }

  const rawPayload = String(req.rawBody || JSON.stringify(payload || {}));
  const eventType = String(payload.type || payload.event || payload.event_type || 'unknown').trim();
  const status = normalizeStatus(eventType);
  const providerMessageId = extractProviderMessageId(payload);
  const providerEventId = extractProviderEventId(payload, rawPayload);
  const occurredAt = normalizeOccurredAt(payload);
  const recipientEmail = normalizeRecipient(payload.data?.to || payload.data?.recipient || payload.to || payload.recipient);

  try {
    const { error: eventError } = await supabaseAdmin
      .from('email_delivery_events')
      .upsert({
        provider: 'resend',
        provider_event_id: providerEventId,
        provider_message_id: providerMessageId,
        event_type: eventType,
        recipient_email: recipientEmail,
        payload,
        occurred_at: occurredAt
      }, {
        onConflict: 'provider,provider_event_id'
      });

    if (eventError) {
      throw new Error(`RESEND_EVENT_STORE_FAILED:${eventError.message}`);
    }

    if (providerMessageId) {
      await Promise.all([
        updateWelcomeEmailState(providerMessageId, status, occurredAt),
        updateManualBroadcastDeliveryState(providerMessageId, status, occurredAt)
      ]);
    }

    logger.info('[RESEND WEBHOOK] Processed email event', {
      eventType,
      status,
      providerMessageId,
      recipient: maskEmail(recipientEmail)
    });

    return res.json({ success: true });
  } catch (error: any) {
    logger.error('[RESEND WEBHOOK] Failed to process email event', {
      error: error?.message || String(error),
      eventType,
      providerMessageId
    });
    return res.status(500).json({ success: false, error: 'RESEND_WEBHOOK_PROCESSING_FAILED' });
  }
});

export default router;
