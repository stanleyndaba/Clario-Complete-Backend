import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import { notificationService } from '../notifications/services/notification_service';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType
} from '../notifications/models/notification';

type ProductUpdateStatus = 'draft' | 'published' | 'archived';
type ProductUpdateAudienceScope = 'all_users';
type DeliveryChannel = 'in_app' | 'email';
type DeliveryStatus = 'queued' | 'sent' | 'skipped' | 'failed';

export interface ProductUpdateInput {
  slug?: string;
  title?: string;
  summary?: string;
  body?: string | null;
  tag?: string | null;
  highlights?: string[] | null;
  cta_text?: string | null;
  cta_href?: string | null;
  audience_scope?: ProductUpdateAudienceScope;
  notify_in_app?: boolean;
  notify_email?: boolean;
}

interface BroadcastTarget {
  userId: string;
  tenantId: string;
  tenantSlug: string | null;
}

const PRODUCT_UPDATE_LIMITS = {
  slug: 90,
  title: 200,
  summary: 500,
  body: 5000,
  tag: 80,
  highlight: 280,
  highlights: 5,
  ctaText: 100,
  ctaHref: 2048
} as const;

function trimString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}

function normalizeBoundedString(value: unknown, fieldCode: string, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${fieldCode}_INVALID`);

  const normalized = value.trim();
  if (!normalized) return null;
  if (hasControlCharacters(normalized)) throw new Error(`${fieldCode}_INVALID`);
  if (normalized.length > maxLength) throw new Error(`${fieldCode}_TOO_LONG`);
  return normalized;
}

function requireBoundedString(value: unknown, fieldCode: string, maxLength: number): string {
  const normalized = normalizeBoundedString(value, fieldCode, maxLength);
  if (!normalized) throw new Error(`${fieldCode}_REQUIRED`);
  return normalized;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PRODUCT_UPDATE_LIMITS.slug);
}

function normalizeSlug(value: unknown): string | null {
  const raw = normalizeBoundedString(value, 'SLUG', PRODUCT_UPDATE_LIMITS.slug);
  if (!raw) return null;
  const slug = slugify(raw);
  if (!slug) throw new Error('SLUG_INVALID');
  return slug;
}

function normalizeHighlights(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('HIGHLIGHTS_INVALID');
  if (value.length > PRODUCT_UPDATE_LIMITS.highlights) throw new Error('HIGHLIGHTS_TOO_MANY');

  return value
    .map((item) => normalizeBoundedString(item, 'HIGHLIGHT', PRODUCT_UPDATE_LIMITS.highlight))
    .filter((item): item is string => Boolean(item));
}

function normalizeCtaHref(value: unknown): string | null {
  const href = normalizeBoundedString(value, 'CTA_HREF', PRODUCT_UPDATE_LIMITS.ctaHref);
  if (!href) return null;

  if (href.startsWith('//') || href.includes('\\')) {
    throw new Error('CTA_HREF_INVALID');
  }

  if (href.startsWith('/')) {
    return href;
  }

  if (/^mailto:/i.test(href)) {
    try {
      const parsed = new URL(href);
      const address = parsed.pathname;
      if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        throw new Error('invalid mailto recipient');
      }
      return href;
    } catch {
      throw new Error('CTA_HREF_INVALID');
    }
  }

  try {
    const parsed = new URL(href);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error('unsupported URL');
    }
    return href;
  } catch {
    throw new Error('CTA_HREF_INVALID');
  }
}

function throwProductUpdateDbError(operation: string, error: any, context: Record<string, unknown> = {}): never {
  const code = String(error?.code || '');
  const message = String(error?.message || 'Unknown database error');
  const normalizedMessage = message.toLowerCase();

  logger.error('[PRODUCT UPDATES] Database operation failed', {
    operation,
    code: code || null,
    message,
    details: error?.details || null,
    hint: error?.hint || null,
    ...context
  });

  if (
    code === '23505' ||
    normalizedMessage.includes('duplicate key') ||
    normalizedMessage.includes('unique constraint')
  ) {
    throw new Error(
      'PRODUCT_UPDATE_SLUG_EXISTS:A product update with this slug already exists. Change the slug or edit the existing draft.'
    );
  }

  if (
    code === '42P01' ||
    normalizedMessage.includes('schema cache') ||
    (normalizedMessage.includes('product_updates') && normalizedMessage.includes('does not exist'))
  ) {
    throw new Error(
      'PRODUCT_UPDATE_SCHEMA_MISSING:Product update tables are not available in the live database yet. Run migration 106_product_updates_publish_broadcast.sql, then retry.'
    );
  }

  if (
    code === '42703' ||
    normalizedMessage.includes('column') ||
    normalizedMessage.includes('foreign key constraint')
  ) {
    throw new Error(
      `PRODUCT_UPDATE_SCHEMA_MISMATCH:Live product update schema does not match the deployed API. Database said: ${message}`
    );
  }

  throw new Error(`${operation}:${message}`);
}

function serializeUpdate(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body || null,
    tag: row.tag || null,
    highlights: Array.isArray(row.highlights) ? row.highlights : [],
    cta_text: row.cta_text || null,
    cta_href: row.cta_href || null,
    status: row.status as ProductUpdateStatus,
    audience_scope: row.audience_scope as ProductUpdateAudienceScope,
    notify_in_app: row.notify_in_app !== false,
    notify_email: row.notify_email !== false,
    published_at: row.published_at || null,
    broadcasted_at: row.broadcasted_at || null,
    created_by: row.created_by || null,
    published_by: row.published_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function requestedChannel(update: any): NotificationChannel | null {
  const wantsInApp = update.notify_in_app !== false;
  const wantsEmail = update.notify_email !== false;

  if (wantsInApp && wantsEmail) return NotificationChannel.BOTH;
  if (wantsInApp) return NotificationChannel.IN_APP;
  if (wantsEmail) return NotificationChannel.EMAIL;
  return null;
}

function requestedDeliveryChannels(update: any): DeliveryChannel[] {
  return [
    update.notify_in_app !== false ? 'in_app' : null,
    update.notify_email !== false ? 'email' : null
  ].filter((channel): channel is DeliveryChannel => Boolean(channel));
}

class ProductUpdateService {
  async resumeQueuedBroadcastJobs(options?: { staleRunningMinutes?: number; limit?: number }) {
    const staleRunningMinutes = Number.isFinite(options?.staleRunningMinutes)
      ? Math.max(1, Number(options?.staleRunningMinutes))
      : 15;
    const limit = Number.isFinite(options?.limit)
      ? Math.max(1, Math.min(100, Number(options?.limit)))
      : 25;
    const staleCutoff = new Date(Date.now() - staleRunningMinutes * 60_000).toISOString();

    const { data: requeuedRows, error: requeueError } = await supabaseAdmin
      .from('product_update_broadcast_jobs')
      .update({
        status: 'queued',
        error: `Recovered stale running broadcast after ${staleRunningMinutes} minutes`
      })
      .eq('status', 'running')
      .lt('started_at', staleCutoff)
      .is('completed_at', null)
      .select('id');

    if (requeueError) {
      throw new Error(`PRODUCT_UPDATE_BROADCAST_REQUEUE_FAILED:${requeueError.message}`);
    }

    const { data: queuedRows, error: queuedError } = await supabaseAdmin
      .from('product_update_broadcast_jobs')
      .select('id, product_update_id, status, created_at')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (queuedError) {
      throw new Error(`PRODUCT_UPDATE_BROADCAST_RESUME_LOOKUP_FAILED:${queuedError.message}`);
    }

    const jobs = queuedRows || [];
    for (const job of jobs) {
      this.processBroadcastJobSoon(job.id);
    }

    logger.info('[PRODUCT UPDATES] Broadcast recovery sweep dispatched jobs', {
      staleRunningMinutes,
      requeued: requeuedRows?.length || 0,
      dispatched: jobs.length
    });

    return {
      requeued: requeuedRows?.length || 0,
      dispatched: jobs.length
    };
  }

  async listPublishedUpdates() {
    const { data, error } = await supabaseAdmin
      .from('product_updates')
      .select('*')
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`PRODUCT_UPDATES_LIST_FAILED:${error.message}`);
    }

    return (data || []).map(serializeUpdate);
  }

  async getPublishedUpdateBySlug(slug: string) {
    const normalizedSlug = slugify(slug);
    const { data, error } = await supabaseAdmin
      .from('product_updates')
      .select('*')
      .eq('slug', normalizedSlug)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .maybeSingle();

    if (error) {
      throw new Error(`PRODUCT_UPDATE_LOOKUP_FAILED:${error.message}`);
    }

    return data ? serializeUpdate(data) : null;
  }

  async createDraft(input: ProductUpdateInput, actorUserId?: string | null) {
    const title = requireBoundedString(input.title, 'TITLE', PRODUCT_UPDATE_LIMITS.title);
    const summary = requireBoundedString(input.summary, 'SUMMARY', PRODUCT_UPDATE_LIMITS.summary);
    const slug = normalizeSlug(input.slug) || slugify(title);
    if (!slug) throw new Error('SLUG_REQUIRED');

    const payload = {
      slug,
      title,
      summary,
      body: normalizeBoundedString(input.body, 'BODY', PRODUCT_UPDATE_LIMITS.body),
      tag: normalizeBoundedString(input.tag, 'TAG', PRODUCT_UPDATE_LIMITS.tag),
      highlights: normalizeHighlights(input.highlights),
      cta_text: normalizeBoundedString(input.cta_text, 'CTA_TEXT', PRODUCT_UPDATE_LIMITS.ctaText),
      cta_href: normalizeCtaHref(input.cta_href),
      audience_scope: 'all_users',
      notify_in_app: input.notify_in_app !== false,
      notify_email: input.notify_email !== false,
      status: 'draft',
      created_by: actorUserId || null
    };

    const { data, error } = await supabaseAdmin
      .from('product_updates')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      throwProductUpdateDbError('PRODUCT_UPDATE_CREATE_FAILED', error, { slug });
    }

    return serializeUpdate(data);
  }

  async updateDraftOrArchived(id: string, input: ProductUpdateInput) {
    const existing = await this.getUpdateById(id);
    if (!existing) throw new Error('PRODUCT_UPDATE_NOT_FOUND');
    if (existing.status === 'published') {
      throw new Error('PUBLISHED_UPDATE_EDIT_BLOCKED');
    }

    const patch: Record<string, any> = {};
    const hasField = (field: keyof ProductUpdateInput) => Object.prototype.hasOwnProperty.call(input, field);

    if (hasField('title')) patch.title = requireBoundedString(input.title, 'TITLE', PRODUCT_UPDATE_LIMITS.title);
    if (hasField('summary')) patch.summary = requireBoundedString(input.summary, 'SUMMARY', PRODUCT_UPDATE_LIMITS.summary);
    if (hasField('slug')) {
      const slug = normalizeSlug(input.slug);
      if (!slug) throw new Error('SLUG_REQUIRED');
      patch.slug = slug;
    }
    if (hasField('body')) patch.body = normalizeBoundedString(input.body, 'BODY', PRODUCT_UPDATE_LIMITS.body);
    if (hasField('tag')) patch.tag = normalizeBoundedString(input.tag, 'TAG', PRODUCT_UPDATE_LIMITS.tag);
    if (hasField('highlights')) patch.highlights = normalizeHighlights(input.highlights);
    if (hasField('cta_text')) patch.cta_text = normalizeBoundedString(input.cta_text, 'CTA_TEXT', PRODUCT_UPDATE_LIMITS.ctaText);
    if (hasField('cta_href')) patch.cta_href = normalizeCtaHref(input.cta_href);
    if (hasField('notify_in_app')) patch.notify_in_app = input.notify_in_app !== false;
    if (hasField('notify_email')) patch.notify_email = input.notify_email !== false;

    const { data, error } = await supabaseAdmin
      .from('product_updates')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throwProductUpdateDbError('PRODUCT_UPDATE_UPDATE_FAILED', error, { productUpdateId: id });
    }

    return serializeUpdate(data);
  }

  async publish(id: string, actorUserId?: string | null) {
    const existing = await this.getUpdateById(id);
    if (!existing) throw new Error('PRODUCT_UPDATE_NOT_FOUND');
    if (existing.status === 'archived') throw new Error('ARCHIVED_UPDATE_CANNOT_PUBLISH');

    // A seller can only see a record after both publication truths exist: the
    // canonical published state and its durable broadcast job. Create/recover
    // the job first without dispatching it; an enqueue error therefore leaves
    // the record as a non-visible draft.
    const job = await this.enqueueBroadcast(id, { dispatch: false });

    const now = new Date().toISOString();
    const patch: Record<string, any> = {
      status: 'published',
      published_by: actorUserId || null
    };

    if (!existing.published_at) {
      patch.published_at = now;
    }

    const { data, error } = await supabaseAdmin
      .from('product_updates')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`PRODUCT_UPDATE_PUBLISH_FAILED:${error.message}`);
    }

    this.processBroadcastJobSoon(job.id);
    return { update: serializeUpdate(data), job };
  }

  async archive(id: string) {
    const { data, error } = await supabaseAdmin
      .from('product_updates')
      .update({ status: 'archived' })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`PRODUCT_UPDATE_ARCHIVE_FAILED:${error.message}`);
    }

    return serializeUpdate(data);
  }

  async enqueueBroadcast(productUpdateId: string, options: { dispatch?: boolean } = {}) {
    const dispatch = options.dispatch !== false;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('product_update_broadcast_jobs')
      .select('*')
      .eq('product_update_id', productUpdateId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`PRODUCT_UPDATE_JOB_LOOKUP_FAILED:${existingError.message}`);
    }

    if (existing && ['queued', 'running', 'completed'].includes(existing.status)) {
      if (dispatch && existing.status === 'queued') {
        this.processBroadcastJobSoon(existing.id);
      }
      return existing;
    }

    const jobPayload = {
      product_update_id: productUpdateId,
      status: 'queued',
      error: null,
      attempt_count: existing ? Number(existing.attempt_count || 0) + 1 : 1
    };

    const query = existing
      ? supabaseAdmin.from('product_update_broadcast_jobs').update(jobPayload).eq('id', existing.id).select('*').single()
      : supabaseAdmin.from('product_update_broadcast_jobs').insert(jobPayload).select('*').single();

    const { data, error } = await query;
    if (error) {
      throw new Error(`PRODUCT_UPDATE_JOB_ENQUEUE_FAILED:${error.message}`);
    }

    if (dispatch) {
      this.processBroadcastJobSoon(data.id);
    }
    return data;
  }

  private processBroadcastJobSoon(jobId: string): void {
    setImmediate(() => {
      this.processBroadcastJob(jobId).catch((error) => {
        logger.error('[PRODUCT UPDATES] Broadcast job failed outside request path', {
          jobId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });
  }

  private async processBroadcastJob(jobId: string): Promise<void> {
    const startedAt = new Date().toISOString();
    const { data: job, error: jobError } = await supabaseAdmin
      .from('product_update_broadcast_jobs')
      .update({
        status: 'running',
        started_at: startedAt,
        error: null
      })
      .eq('id', jobId)
      .eq('status', 'queued')
      .select('*')
      .maybeSingle();

    if (jobError || !job) {
      logger.info('[PRODUCT UPDATES] Broadcast job was not claimable', {
        jobId,
        reason: jobError?.message || 'not_queued'
      });
      return;
    }

    try {
      const update = await this.getUpdateById(job.product_update_id);
      if (!update) throw new Error('PRODUCT_UPDATE_NOT_FOUND');
      if (update.status !== 'published') {
        // A recovery sweep may claim the durable job between job creation and
        // the succeeding publish-state write. Keep it eligible for the
        // publish path’s post-commit dispatch rather than delivering a draft
        // or marking the job permanently failed.
        await supabaseAdmin
          .from('product_update_broadcast_jobs')
          .update({ status: 'queued', started_at: null, error: null })
          .eq('id', jobId);
        return;
      }

      const channels = requestedDeliveryChannels(update);
      if (channels.length === 0) {
        await this.completeJob(jobId, {
          targetCount: 0,
          inAppSentCount: 0,
          emailSentCount: 0,
          skippedCount: 0,
          failedCount: 0
        });
        return;
      }

      const targets = await this.resolveBroadcastTargets();
      const counts = {
        targetCount: targets.length,
        inAppSentCount: 0,
        emailSentCount: 0,
        skippedCount: 0,
        failedCount: 0
      };

      for (const target of targets) {
        const result = await this.deliverUpdateToTarget(update, target, channels);
        counts.inAppSentCount += result.inAppSent ? 1 : 0;
        counts.emailSentCount += result.emailSent ? 1 : 0;
        counts.skippedCount += result.skipped;
        counts.failedCount += result.failed;
      }

      await this.completeJob(jobId, counts);
    } catch (error: any) {
      await supabaseAdmin
        .from('product_update_broadcast_jobs')
        .update({
          status: 'failed',
          error: error?.message || 'product_update_broadcast_failed',
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
      throw error;
    }
  }

  private async deliverUpdateToTarget(
    update: any,
    target: BroadcastTarget,
    channels: DeliveryChannel[]
  ): Promise<{ inAppSent: boolean; emailSent: boolean; skipped: number; failed: number }> {
    const existingSent = await this.getSentDeliveryChannels(update.id, target.userId);
    const remainingChannels = channels.filter((channel) => !existingSent.has(channel));
    const result = { inAppSent: false, emailSent: false, skipped: 0, failed: 0 };

    if (remainingChannels.length === 0) {
      result.skipped += channels.length;
      return result;
    }

    const channel = remainingChannels.length === 2
      ? NotificationChannel.BOTH
      : remainingChannels[0] === 'in_app'
        ? NotificationChannel.IN_APP
        : NotificationChannel.EMAIL;

    let notification: any = null;
    try {
      notification = await notificationService.createNotification({
        type: NotificationType.PRODUCT_UPDATE,
        user_id: target.userId,
        tenant_id: target.tenantId,
        title: `New in Margin: ${update.title}`,
        message: update.summary,
        priority: NotificationPriority.NORMAL,
        channel,
        payload: {
          dedupe_key: `product-update:${update.id}:user:${target.userId}`,
          product_update_id: update.id,
          slug: update.slug,
          title: update.title,
          summary: update.summary,
          body: update.body,
          tag: update.tag,
          highlights: update.highlights,
          cta_text: update.cta_text,
          cta_href: update.cta_href,
          published_at: update.published_at,
          tenant_slug: target.tenantSlug,
          entity_type: 'product_update',
          entity_id: update.id
        }
      });
    } catch (error: any) {
      for (const deliveryChannel of remainingChannels) {
        await this.upsertDelivery(update.id, target, deliveryChannel, 'failed', error?.message || 'notification_create_failed', null);
        result.failed += 1;
      }
      return result;
    }

    if (!notification) {
      for (const deliveryChannel of remainingChannels) {
        await this.upsertDelivery(update.id, target, deliveryChannel, 'skipped', 'suppressed_by_user_preference', null);
        result.skipped += 1;
      }
      return result;
    }

    const deliveryState = notification.delivery_state || {};
    for (const deliveryChannel of remainingChannels) {
      const requestedKey = deliveryChannel === 'in_app' ? 'in_app_requested' : 'email_requested';
      const successKey = deliveryChannel === 'in_app' ? 'in_app_success' : 'email_success';

      if (deliveryState[requestedKey] === false) {
        await this.upsertDelivery(update.id, target, deliveryChannel, 'skipped', 'suppressed_by_user_preference', notification.id);
        result.skipped += 1;
        continue;
      }

      if (deliveryState[successKey] === true) {
        await this.upsertDelivery(update.id, target, deliveryChannel, 'sent', null, notification.id);
        if (deliveryChannel === 'in_app') result.inAppSent = true;
        if (deliveryChannel === 'email') result.emailSent = true;
        continue;
      }

      await this.upsertDelivery(
        update.id,
        target,
        deliveryChannel,
        'failed',
        notification.last_delivery_error || `${deliveryChannel}_delivery_failed`,
        notification.id
      );
      result.failed += 1;
    }

    return result;
  }

  private async getSentDeliveryChannels(productUpdateId: string, userId: string): Promise<Set<DeliveryChannel>> {
    const { data, error } = await supabaseAdmin
      .from('product_update_deliveries')
      .select('channel')
      .eq('product_update_id', productUpdateId)
      .eq('user_id', userId)
      .in('status', ['sent', 'skipped']);

    if (error) {
      throw new Error(`PRODUCT_UPDATE_DELIVERY_LOOKUP_FAILED:${error.message}`);
    }

    return new Set((data || []).map((row: any) => row.channel as DeliveryChannel));
  }

  private async upsertDelivery(
    productUpdateId: string,
    target: BroadcastTarget,
    channel: DeliveryChannel,
    status: DeliveryStatus,
    error: string | null,
    notificationId: string | null
  ) {
    const sentAt = status === 'sent' ? new Date().toISOString() : null;
    const { error: upsertError } = await supabaseAdmin
      .from('product_update_deliveries')
      .upsert({
        product_update_id: productUpdateId,
        user_id: target.userId,
        tenant_id: target.tenantId,
        channel,
        notification_id: notificationId,
        status,
        error,
        sent_at: sentAt
      }, {
        onConflict: 'product_update_id,user_id,channel'
      });

    if (upsertError) {
      throw new Error(`PRODUCT_UPDATE_DELIVERY_UPSERT_FAILED:${upsertError.message}`);
    }
  }

  private async completeJob(
    jobId: string,
    counts: {
      targetCount: number;
      inAppSentCount: number;
      emailSentCount: number;
      skippedCount: number;
      failedCount: number;
    }
  ) {
    const completedAt = new Date().toISOString();
    const { data: job } = await supabaseAdmin
      .from('product_update_broadcast_jobs')
      .update({
        status: counts.failedCount > 0 ? 'failed' : 'completed',
        target_count: counts.targetCount,
        in_app_sent_count: counts.inAppSentCount,
        email_sent_count: counts.emailSentCount,
        skipped_count: counts.skippedCount,
        failed_count: counts.failedCount,
        completed_at: completedAt,
        error: counts.failedCount > 0 ? `${counts.failedCount} delivery attempts failed` : null
      })
      .eq('id', jobId)
      .select('product_update_id')
      .single();

    if (job?.product_update_id && counts.failedCount === 0) {
      await supabaseAdmin
        .from('product_updates')
        .update({ broadcasted_at: completedAt })
        .eq('id', job.product_update_id);
    }
  }

  private async resolveBroadcastTargets(): Promise<BroadcastTarget[]> {
    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from('tenant_memberships')
      .select('user_id, tenant_id, created_at')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (membershipError) {
      throw new Error(`PRODUCT_UPDATE_TARGET_MEMBERSHIP_FAILED:${membershipError.message}`);
    }

    const tenantIds = Array.from(new Set((memberships || []).map((row: any) => row.tenant_id).filter(Boolean)));
    if (!tenantIds.length) return [];

    const { data: tenants, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id, slug, status')
      .in('id', tenantIds)
      .in('status', ['active', 'trialing'])
      .is('deleted_at', null);

    if (tenantError) {
      throw new Error(`PRODUCT_UPDATE_TARGET_TENANT_FAILED:${tenantError.message}`);
    }

    const tenantSlugById = new Map<string, string | null>(
      (tenants || []).map((tenant: any) => [String(tenant.id), tenant.slug ? String(tenant.slug) : null])
    );
    const seen = new Set<string>();
    const targets: BroadcastTarget[] = [];

    for (const membership of memberships || []) {
      const tenantSlug = tenantSlugById.get(String(membership.tenant_id));
      if (tenantSlug === undefined) continue;

      // Product updates are global rollouts. Target each user once so sellers
      // with multiple workspaces do not receive duplicate rollout emails.
      const key = String(membership.user_id);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        userId: String(membership.user_id),
        tenantId: String(membership.tenant_id),
        tenantSlug
      });
    }

    return targets;
  }

  private async getUpdateById(id: string) {
    const { data, error } = await supabaseAdmin
      .from('product_updates')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`PRODUCT_UPDATE_LOOKUP_FAILED:${error.message}`);
    }

    return data ? serializeUpdate(data) : null;
  }
}

export const productUpdateService = new ProductUpdateService();
export default productUpdateService;
