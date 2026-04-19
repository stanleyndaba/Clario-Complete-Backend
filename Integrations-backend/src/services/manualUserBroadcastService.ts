import { supabaseAdmin } from '../database/supabaseClient';
import { EmailService } from '../notifications/services/delivery/email_service';
import { buildManualUserBroadcastEmail } from '../notifications/services/delivery/manual_broadcast_presenter';
import logger from '../utils/logger';

export type ManualBroadcastAudienceType = 'test_emails' | 'all_users' | 'active_users';

export interface ManualBroadcastInput {
  subject?: string;
  heading?: string;
  summary?: string | null;
  body?: string;
  highlights?: string[] | string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  audience_type?: ManualBroadcastAudienceType;
  audience_payload?: Record<string, unknown> | null;
}

interface BroadcastRecipient {
  userId: string | null;
  email: string;
  emailKey: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STALE_DELIVERY_CLAIM_MS = 10 * 60 * 1000;

function clean(value: unknown): string {
  return String(value || '').trim();
}

function truncate(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value || 'manual_broadcast_failed');
  return message.slice(0, 500);
}

function normalizeEmail(value: unknown): string | null {
  const email = clean(value).toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return null;
  return email;
}

function parseEmailList(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : clean(value)
      .split(/[\n,;]+/)
      .map((item) => item.trim());

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of rawValues) {
    const email = normalizeEmail(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails.slice(0, 250);
}

function normalizeHighlights(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : clean(value)
      .split('\n')
      .map((item) => item.trim());

  return raw
    .map((item) => clean(item))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeAudienceType(value: unknown): ManualBroadcastAudienceType {
  const normalized = clean(value) as ManualBroadcastAudienceType;
  if (normalized === 'all_users' || normalized === 'active_users' || normalized === 'test_emails') {
    return normalized;
  }
  return 'test_emails';
}

function normalizeCtaUrl(value: unknown): string | null {
  const url = clean(value);
  if (!url) return null;
  if (url.startsWith('/')) {
    const base = (process.env.FRONTEND_URL || 'https://app.margin-finance.com').replace(/\/+$/, '');
    return `${base}${url}`;
  }
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  return null;
}

function normalizeInput(input: ManualBroadcastInput, requireContent = true) {
  const subject = clean(input.subject);
  const heading = clean(input.heading);
  const body = clean(input.body);
  const audienceType = normalizeAudienceType(input.audience_type);
  const audiencePayload = input.audience_payload && typeof input.audience_payload === 'object'
    ? { ...input.audience_payload }
    : {};

  if (audienceType === 'test_emails') {
    audiencePayload.emails = parseEmailList((audiencePayload as any).emails);
  }

  if (requireContent) {
    if (!subject) throw new Error('MANUAL_BROADCAST_SUBJECT_REQUIRED');
    if (!heading) throw new Error('MANUAL_BROADCAST_HEADING_REQUIRED');
    if (!body) throw new Error('MANUAL_BROADCAST_BODY_REQUIRED');
    if (audienceType === 'test_emails' && !((audiencePayload as any).emails || []).length) {
      throw new Error('MANUAL_BROADCAST_TEST_EMAIL_REQUIRED');
    }
  }

  return {
    subject,
    heading,
    summary: clean(input.summary) || null,
    body,
    highlights: normalizeHighlights(input.highlights),
    cta_label: clean(input.cta_label) || null,
    cta_url: normalizeCtaUrl(input.cta_url),
    audience_type: audienceType,
    audience_payload: audiencePayload
  };
}

function serializeBroadcast(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    subject: row.subject,
    heading: row.heading,
    summary: row.summary || null,
    body: row.body,
    highlights: Array.isArray(row.highlights) ? row.highlights : [],
    cta_label: row.cta_label || null,
    cta_url: row.cta_url || null,
    audience_type: row.audience_type,
    audience_payload: row.audience_payload || {},
    status: row.status,
    recipient_count: row.recipient_count || 0,
    sent_count: row.sent_count || 0,
    failed_count: row.failed_count || 0,
    last_error: row.last_error || null,
    sent_at: row.sent_at || null,
    created_by: row.created_by || null,
    updated_by: row.updated_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function isMissingSchema(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || message.includes('manual_user_broadcasts') || message.includes('manual_user_broadcast_deliveries');
}

export class ManualUserBroadcastService {
  private emailService = new EmailService();

  async listBroadcasts() {
    const { data, error } = await supabaseAdmin
      .from('manual_user_broadcasts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(25);

    if (error) {
      if (isMissingSchema(error)) throw new Error('MANUAL_BROADCAST_SCHEMA_MISSING');
      throw new Error(`MANUAL_BROADCAST_LIST_FAILED:${error.message}`);
    }

    return data || [];
  }

  async getBroadcast(id: string) {
    const { data, error } = await supabaseAdmin
      .from('manual_user_broadcasts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      if (isMissingSchema(error)) throw new Error('MANUAL_BROADCAST_SCHEMA_MISSING');
      throw new Error(`MANUAL_BROADCAST_LOOKUP_FAILED:${error.message}`);
    }

    return data || null;
  }

  async getBroadcastWithPreview(id: string) {
    const broadcast = await this.getBroadcast(id);
    if (!broadcast) return null;
    return this.withPreview(broadcast);
  }

  async createDraft(input: ManualBroadcastInput, actorUserId?: string | null) {
    const normalized = normalizeInput(input);
    const { data, error } = await supabaseAdmin
      .from('manual_user_broadcasts')
      .insert({
        ...normalized,
        status: 'draft',
        created_by: actorUserId || null,
        updated_by: actorUserId || null
      })
      .select('*')
      .single();

    if (error) {
      if (isMissingSchema(error)) throw new Error('MANUAL_BROADCAST_SCHEMA_MISSING');
      throw new Error(`MANUAL_BROADCAST_CREATE_FAILED:${error.message}`);
    }

    return this.withPreview(data);
  }

  async updateDraft(id: string, input: ManualBroadcastInput, actorUserId?: string | null) {
    const existing = await this.getBroadcast(id);
    if (!existing) throw new Error('MANUAL_BROADCAST_NOT_FOUND');
    if (existing.status !== 'draft') throw new Error('MANUAL_BROADCAST_SENT_EDIT_BLOCKED');

    const normalized = normalizeInput(input);
    const { data, error } = await supabaseAdmin
      .from('manual_user_broadcasts')
      .update({
        ...normalized,
        updated_by: actorUserId || null
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`MANUAL_BROADCAST_UPDATE_FAILED:${error.message}`);
    }

    return this.withPreview(data);
  }

  async testSend(id: string, emailsInput: unknown) {
    const broadcast = await this.getBroadcast(id);
    if (!broadcast) throw new Error('MANUAL_BROADCAST_NOT_FOUND');
    const emails = parseEmailList(emailsInput);
    if (!emails.length) throw new Error('MANUAL_BROADCAST_TEST_EMAIL_REQUIRED');

    const recipients = emails.map((email) => ({
      userId: null,
      email,
      emailKey: email
    }));

    const result = await this.sendToRecipients(broadcast, recipients, 'test');
    return {
      broadcast: await this.withPreview(broadcast),
      ...result
    };
  }

  async sendBroadcast(id: string, actorUserId?: string | null) {
    const broadcast = await this.getBroadcast(id);
    if (!broadcast) throw new Error('MANUAL_BROADCAST_NOT_FOUND');
    if (broadcast.status === 'sent') throw new Error('MANUAL_BROADCAST_ALREADY_SENT');
    if (broadcast.status === 'archived') throw new Error('MANUAL_BROADCAST_ARCHIVED');
    if (broadcast.status === 'failed') throw new Error('MANUAL_BROADCAST_FAILED_RETRY_DEFERRED');

    if (broadcast.status === 'sending') {
      return this.withPreview(broadcast);
    }

    const recipients = await this.resolveRecipients(broadcast.audience_type, broadcast.audience_payload || {});
    if (!recipients.length) throw new Error('MANUAL_BROADCAST_NO_RECIPIENTS');

    const existingFinal = await this.getExistingFinalEmailKeys(broadcast.id);
    const queuedRows = recipients
      .filter((recipient) => !existingFinal.has(recipient.emailKey))
      .map((recipient) => ({
        broadcast_id: broadcast.id,
        user_id: recipient.userId,
        email: recipient.email,
        email_key: recipient.emailKey,
        channel: 'email',
        send_type: 'final',
        status: 'queued'
      }));

    if (queuedRows.length) {
      const { error: deliveryError } = await supabaseAdmin
        .from('manual_user_broadcast_deliveries')
        .insert(queuedRows);

      if (deliveryError) {
        throw new Error(`MANUAL_BROADCAST_DELIVERY_CREATE_FAILED:${deliveryError.message}`);
      }
    }

    const { data, error } = await supabaseAdmin
      .from('manual_user_broadcasts')
      .update({
        status: 'sending',
        recipient_count: recipients.length,
        sent_count: 0,
        failed_count: 0,
        last_error: null,
        updated_by: actorUserId || null
      })
      .eq('id', broadcast.id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`MANUAL_BROADCAST_SEND_MARK_FAILED:${error.message}`);
    }

    this.processFinalSendSoon(broadcast.id);
    return this.withPreview(data);
  }

  async resumeSendingBroadcasts() {
    await this.releaseStaleDeliveryClaims();

    const { data, error } = await supabaseAdmin
      .from('manual_user_broadcasts')
      .select('id')
      .eq('status', 'sending')
      .order('updated_at', { ascending: true })
      .limit(20);

    if (error) {
      if (isMissingSchema(error)) return { dispatched: 0 };
      throw new Error(`MANUAL_BROADCAST_RECOVERY_LOOKUP_FAILED:${error.message}`);
    }

    for (const row of data || []) {
      this.processFinalSendSoon(row.id);
    }

    return { dispatched: data?.length || 0 };
  }

  async withPreview(row: any) {
    const serialized = serializeBroadcast(row);
    const template = buildManualUserBroadcastEmail(serialized as any);
    const recipients = await this.resolveRecipients(serialized!.audience_type, serialized!.audience_payload);
    return {
      ...serialized,
      preview: template.view,
      recipient_count_preview: recipients.length
    };
  }

  private processFinalSendSoon(broadcastId: string) {
    setTimeout(() => {
      this.processFinalSend(broadcastId).catch((error) => {
        logger.error('[MANUAL BROADCAST] Final send failed outside request path', {
          broadcastId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });
  }

  private async processFinalSend(broadcastId: string) {
    const broadcast = await this.getBroadcast(broadcastId);
    if (!broadcast) return;

    const { data: deliveries, error } = await supabaseAdmin
      .from('manual_user_broadcast_deliveries')
      .select('*')
      .eq('broadcast_id', broadcastId)
      .eq('send_type', 'final')
      .eq('status', 'queued')
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`MANUAL_BROADCAST_DELIVERY_LOOKUP_FAILED:${error.message}`);
    }

    const recipients = (deliveries || []).map((delivery: any) => ({
      userId: delivery.user_id || null,
      email: delivery.email,
      emailKey: delivery.email_key,
      deliveryId: delivery.id
    }));

    await this.sendToRecipients(broadcast, recipients, 'final');
    await this.completeFinalSend(broadcastId);
  }

  private async sendToRecipients(
    broadcast: any,
    recipients: Array<BroadcastRecipient & { deliveryId?: string }>,
    sendType: 'test' | 'final'
  ) {
    const template = buildManualUserBroadcastEmail(serializeBroadcast(broadcast) as any);
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      let deliveryId = recipient.deliveryId;

      if (!deliveryId) {
        const { data, error } = await supabaseAdmin
          .from('manual_user_broadcast_deliveries')
          .insert({
            broadcast_id: broadcast.id,
            user_id: recipient.userId,
            email: recipient.email,
            email_key: recipient.emailKey,
            channel: 'email',
            send_type: sendType,
            status: 'queued'
          })
          .select('id')
          .single();

        if (error) {
          failed += 1;
          continue;
        }

        deliveryId = data.id;
      }

      try {
        if (sendType === 'final') {
          const claimed = await this.claimFinalDelivery(deliveryId);
          if (!claimed) continue;
        }

        const sendResult = await this.emailService.sendEmail({
          to: recipient.email,
          subject: template.subject,
          html: template.html,
          text: template.text
        });

        sent += 1;
        const sentAt = new Date().toISOString();
        await supabaseAdmin
          .from('manual_user_broadcast_deliveries')
          .update({
            status: 'sent',
            error: null,
            sent_at: sentAt
          })
          .eq('id', deliveryId);

        if (sendResult.providerMessageId) {
          try {
            await supabaseAdmin
              .from('manual_user_broadcast_deliveries')
              .update({
                provider_message_id: sendResult.providerMessageId,
                last_event_at: sentAt
              })
              .eq('id', deliveryId);
          } catch {
            // Provider tracking is useful, but must never block the primary delivery state.
          }
        }
      } catch (error) {
        failed += 1;
        await supabaseAdmin
          .from('manual_user_broadcast_deliveries')
          .update({
            status: 'failed',
            error: truncate(error)
          })
          .eq('id', deliveryId);
      }
    }

    return { sent, failed, attempted: recipients.length };
  }

  private async completeFinalSend(broadcastId: string) {
    const { data: deliveries, error } = await supabaseAdmin
      .from('manual_user_broadcast_deliveries')
      .select('status, error')
      .eq('broadcast_id', broadcastId)
      .eq('send_type', 'final');

    if (error) throw new Error(`MANUAL_BROADCAST_FINAL_COUNT_FAILED:${error.message}`);

    const rows = deliveries || [];
    const sentCount = rows.filter((row: any) => row.status === 'sent').length;
    const failedRows = rows.filter((row: any) => row.status === 'failed');
    const pendingCount = rows.filter((row: any) => row.status === 'queued' || row.status === 'sending').length;

    const status = pendingCount > 0
      ? 'sending'
      : failedRows.length > 0
        ? 'failed'
        : 'sent';

    await supabaseAdmin
      .from('manual_user_broadcasts')
      .update({
        status,
        recipient_count: rows.length,
        sent_count: sentCount,
        failed_count: failedRows.length,
        last_error: failedRows[0]?.error || null,
        sent_at: status === 'sent' ? new Date().toISOString() : null
      })
      .eq('id', broadcastId);
  }

  private async claimFinalDelivery(deliveryId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('manual_user_broadcast_deliveries')
      .update({
        status: 'sending',
        error: null
      })
      .eq('id', deliveryId)
      .eq('send_type', 'final')
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(`MANUAL_BROADCAST_DELIVERY_CLAIM_FAILED:${error.message}`);
    }

    return Boolean(data?.id);
  }

  private async releaseStaleDeliveryClaims() {
    const staleBefore = new Date(Date.now() - STALE_DELIVERY_CLAIM_MS).toISOString();
    const { error } = await supabaseAdmin
      .from('manual_user_broadcast_deliveries')
      .update({ status: 'queued' })
      .eq('send_type', 'final')
      .eq('status', 'sending')
      .lt('updated_at', staleBefore);

    if (error && !isMissingSchema(error)) {
      throw new Error(`MANUAL_BROADCAST_STALE_DELIVERY_RELEASE_FAILED:${error.message}`);
    }
  }

  private async getExistingFinalEmailKeys(broadcastId: string): Promise<Set<string>> {
    const { data, error } = await supabaseAdmin
      .from('manual_user_broadcast_deliveries')
      .select('email_key')
      .eq('broadcast_id', broadcastId)
      .eq('send_type', 'final');

    if (error) {
      throw new Error(`MANUAL_BROADCAST_DELIVERY_DEDUPE_LOOKUP_FAILED:${error.message}`);
    }

    return new Set((data || []).map((row: any) => String(row.email_key)));
  }

  private async resolveRecipients(audienceType: string, audiencePayload: any): Promise<BroadcastRecipient[]> {
    const normalizedAudience = normalizeAudienceType(audienceType);
    if (normalizedAudience === 'test_emails') {
      return parseEmailList(audiencePayload?.emails).map((email) => ({
        userId: null,
        email,
        emailKey: email
      }));
    }

    let query = supabaseAdmin
      .from('users')
      .select('id, email, status, deleted_at')
      .not('email', 'is', null)
      .is('deleted_at', null)
      .limit(10000);

    if (normalizedAudience === 'active_users') {
      query = query.eq('status', 'active');
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`MANUAL_BROADCAST_RECIPIENT_LOOKUP_FAILED:${error.message}`);
    }

    const seen = new Set<string>();
    const recipients: BroadcastRecipient[] = [];
    for (const row of data || []) {
      const email = normalizeEmail(row.email);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      recipients.push({
        userId: row.id || null,
        email,
        emailKey: email
      });
    }

    return recipients;
  }
}

export const manualUserBroadcastService = new ManualUserBroadcastService();
export default manualUserBroadcastService;
