import crypto from 'crypto';
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import sseHub from '../utils/sseHub';
import { AmazonSnsEnvelope, confirmAmazonSnsSubscription, verifyAmazonSnsEnvelope } from '../utils/amazonSnsVerifier';
import {
  AMAZON_NOTIFICATION_SUPPORT_MATRIX,
  NotificationClassificationResult,
  classifyAmazonNotification,
  NormalizedAmazonNotification
} from './amazonNotificationClassifier';
import amazonNotificationOwnershipService, { NotificationOwnershipContext } from './amazonNotificationOwnershipService';
import { syncJobManager } from './syncJobManager';

interface ParsedAmazonNotification extends NormalizedAmazonNotification {
  amazonNotificationId?: string | null;
  amazonSubscriptionId?: string | null;
  amazonDestinationId?: string | null;
  sellerId?: string | null;
  marketplaceId?: string | null;
  snsMessageId?: string | null;
  snsTopicArn?: string | null;
  receivedPayload: Record<string, any>;
  payloadHash: string;
  dedupeKey: string;
}

type ProcessingStatus =
  | 'received'
  | 'confirmed'
  | 'classified'
  | 'triggered'
  | 'processed'
  | 'quarantined'
  | 'failed';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeJsonParse<T = any>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function firstString(...values: any[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function normalizeWebhookBody(body: any): AmazonSnsEnvelope {
  if (typeof body === 'string') {
    return safeJsonParse<AmazonSnsEnvelope>(body) || {};
  }

  if (body && typeof body === 'object') {
    return body as AmazonSnsEnvelope;
  }

  return {};
}

function parseInnerAmazonMessage(envelope: AmazonSnsEnvelope): Record<string, any> {
  if (typeof envelope.Message !== 'string') {
    return {};
  }

  return safeJsonParse<Record<string, any>>(envelope.Message) || { raw_message: envelope.Message };
}

function normalizeAmazonNotification(
  envelope: AmazonSnsEnvelope,
  deliveryTypeOverride?: ParsedAmazonNotification['deliveryType']
): ParsedAmazonNotification {
  const inner = parseInnerAmazonMessage(envelope);
  const metadata = typeof inner.NotificationMetadata === 'object' && inner.NotificationMetadata ? inner.NotificationMetadata : {};
  const payload = typeof inner.Payload === 'object' && inner.Payload ? inner.Payload : {};
  const notificationType =
    firstString(
      inner.NotificationType,
      metadata.NotificationType,
      envelope.Type === 'SubscriptionConfirmation' ? 'SNS_SUBSCRIPTION_CONFIRMATION' : null,
      envelope.Type === 'UnsubscribeConfirmation' ? 'SNS_UNSUBSCRIBE_CONFIRMATION' : null
    ) || 'UNKNOWN_NOTIFICATION';
  const notificationSubtype = firstString(
    inner.ReportType,
    payload.reportType,
    payload.ReportType,
    payload.NotificationType,
    payload.FeedType,
    payload.feedType
  );

  const receivedPayload = {
    sns_envelope: envelope,
    amazon_message: inner
  };

  const payloadHash = sha256(JSON.stringify(receivedPayload));
  const amazonNotificationId = firstString(
    metadata.NotificationId,
    inner.NotificationId,
    payload.notificationId,
    payload.NotificationId,
    envelope.MessageId
  );
  const amazonSubscriptionId = firstString(
    metadata.SubscriptionId,
    inner.SubscriptionId,
    payload.subscriptionId,
    payload.SubscriptionId
  );
  const amazonDestinationId = firstString(
    metadata.DestinationId,
    inner.DestinationId,
    payload.destinationId,
    payload.DestinationId
  );

  const deliveryType =
    deliveryTypeOverride ||
    (envelope.Type === 'SubscriptionConfirmation'
      ? 'sns_subscription_confirmation'
      : envelope.Type === 'UnsubscribeConfirmation'
        ? 'sns_unsubscribe_confirmation'
        : 'sns_notification');

  return {
    deliveryType,
    notificationType,
    notificationSubtype,
    reportType: firstString(inner.ReportType, payload.reportType, payload.ReportType),
    feedType: firstString(inner.FeedType, payload.feedType, payload.FeedType),
    payload,
    amazonNotificationId,
    amazonSubscriptionId,
    amazonDestinationId,
    sellerId: firstString(payload.SellerId, payload.sellerId, inner.SellerId, inner.sellerId),
    marketplaceId: firstString(payload.MarketplaceId, payload.marketplaceId, payload.MarketplaceID),
    snsMessageId: firstString(envelope.MessageId),
    snsTopicArn: firstString(envelope.TopicArn),
    receivedPayload,
    payloadHash,
    dedupeKey: sha256([
      deliveryType,
      amazonNotificationId || '',
      envelope.MessageId || '',
      notificationType,
      notificationSubtype || '',
      payloadHash
    ].join('|'))
  };
}

class AmazonNotificationService {
  async receiveTrustedEnvelopeForTest(envelope: AmazonSnsEnvelope): Promise<{ statusCode: number; response: Record<string, any> }> {
    const parsed = normalizeAmazonNotification(envelope, 'replay');
    const ownership = await amazonNotificationOwnershipService.resolveOwnership({
      amazonSubscriptionId: parsed.amazonSubscriptionId,
      amazonDestinationId: parsed.amazonDestinationId,
      sellerId: parsed.sellerId,
      marketplaceId: parsed.marketplaceId
    });

    const persisted = await this.persistNotification(parsed, ownership);
    if (persisted.duplicate) {
      return {
        statusCode: 200,
        response: {
          success: true,
          duplicate: true,
          notificationId: persisted.notificationId
        }
      };
    }

    return this.processNotificationRecord(persisted.notificationId!, parsed, ownership, {
      replay: false
    });
  }

  async receiveWebhook(body: any): Promise<{ statusCode: number; response: Record<string, any> }> {
    const envelope = normalizeWebhookBody(body);
    const verification = await verifyAmazonSnsEnvelope(envelope);

    if (!verification.valid) {
      logger.warn('[AMAZON NOTIFICATIONS] Rejected unverified notification', {
        reason: verification.reason,
        snsMessageId: envelope?.MessageId,
        type: envelope?.Type
      });

      return {
        statusCode: 401,
        response: {
          success: false,
          error: 'Amazon notification signature verification failed',
          reason: verification.reason || 'signature_verification_failed'
        }
      };
    }

    const parsed = normalizeAmazonNotification(envelope);
    const ownership = await amazonNotificationOwnershipService.resolveOwnership({
      amazonSubscriptionId: parsed.amazonSubscriptionId,
      amazonDestinationId: parsed.amazonDestinationId,
      sellerId: parsed.sellerId,
      marketplaceId: parsed.marketplaceId
    });

    const persisted = await this.persistNotification(parsed, ownership);
    if (persisted.duplicate) {
      return {
        statusCode: 200,
        response: {
          success: true,
          duplicate: true,
          notificationId: persisted.notificationId
        }
      };
    }

    const notificationId = persisted.notificationId!;

    if (parsed.deliveryType === 'sns_subscription_confirmation') {
      const confirmation = await confirmAmazonSnsSubscription(envelope);
      await this.updateProcessingState(notificationId, confirmation.confirmed ? 'confirmed' : 'failed', {
        triggered_agent: 'agent10.control_plane',
        processing_metadata: {
          control_message: 'subscription_confirmation',
          confirmation
        },
        processed_at: new Date().toISOString(),
        error: confirmation.confirmed ? null : confirmation.reason || 'subscription_confirmation_failed'
      });

      return {
        statusCode: confirmation.confirmed ? 200 : 500,
        response: {
          success: confirmation.confirmed,
          notificationId,
          confirmation
        }
      };
    }

    if (parsed.deliveryType === 'sns_unsubscribe_confirmation') {
      await this.updateProcessingState(notificationId, 'processed', {
        classification: 'transport_unsubscribe_confirmation',
        triggered_agent: 'agent10.control_plane',
        processing_metadata: {
          control_message: 'unsubscribe_confirmation'
        },
        processed_at: new Date().toISOString()
      });

      return {
        statusCode: 200,
        response: {
          success: true,
          notificationId
        }
      };
    }

    return this.processNotificationRecord(notificationId, parsed, ownership, {
      replay: false
    });
  }

  async listNotifications(tenantId: string, options?: { storeId?: string; limit?: number; status?: string }): Promise<any[]> {
    let query = supabaseAdmin
      .from('amazon_notifications')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('received_at', { ascending: false })
      .limit(Math.max(1, Math.min(options?.limit || 50, 200)));

    if (options?.storeId) {
      query = query.eq('store_id', options.storeId);
    }

    if (options?.status) {
      query = query.eq('processing_status', options.status);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list Amazon notifications: ${error.message}`);
    }

    return data || [];
  }

  async getNotificationById(id: string, tenantId: string): Promise<any | null> {
    const { data, error } = await supabaseAdmin
      .from('amazon_notifications')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load Amazon notification: ${error.message}`);
    }

    return data || null;
  }

  async replayStoredNotification(id: string, tenantId: string, options?: { dryRun?: boolean }): Promise<any> {
    const existing = await this.getNotificationById(id, tenantId);
    if (!existing) {
      throw new Error('Amazon notification not found');
    }

    const parsed = normalizeAmazonNotification(existing.payload?.sns_envelope || {}, 'replay');
    const ownership: NotificationOwnershipContext = {
      tenantId: existing.tenant_id || undefined,
      storeId: existing.store_id || undefined,
      userId: existing.user_id || undefined,
      sellerId: existing.seller_id || undefined,
      lineageResolution: existing.lineage_resolution || undefined
    };

    if (options?.dryRun) {
      const classification = classifyAmazonNotification(parsed);
      return {
        notificationId: id,
        dryRun: true,
        classification,
        ownership,
        actionPlan: this.planAction(classification)
      };
    }

    return this.processNotificationRecord(id, parsed, ownership, { replay: false });
  }

  private async processNotificationRecord(
    notificationId: string,
    parsed: ParsedAmazonNotification,
    ownership: NotificationOwnershipContext,
    options: { replay: boolean }
  ): Promise<{ statusCode: number; response: Record<string, any> }> {
    const classification = classifyAmazonNotification(parsed);
    const actionPlan = this.planAction(classification);

    await this.updateProcessingState(notificationId, classification.classification === 'unhandled_notification_type' ? 'processed' : 'classified', {
      classification: classification.classification,
      processing_metadata: {
        support_level: classification.supportLevel,
        requested_domains: classification.requestedDomains,
        reason: classification.reason,
        action_plan: actionPlan,
        ownership: this.buildOwnershipMetadata(ownership)
      }
    });

    await this.emitTenantSignal('amazon.notification.received', notificationId, ownership, {
      notification_type: parsed.notificationType,
      notification_subtype: parsed.notificationSubtype,
      classification: classification.classification,
      support_level: classification.supportLevel
    });

    if (!ownership.tenantId || !ownership.storeId || !ownership.userId) {
      await this.updateProcessingState(notificationId, 'quarantined', {
        error: ownership.ambiguous
          ? 'Notification ownership is ambiguous and was quarantined.'
          : 'Notification ownership could not be resolved.',
        processing_metadata: {
          quarantined_reason: ownership.ambiguous ? 'ambiguous_ownership' : 'missing_ownership',
          ownership: this.buildOwnershipMetadata(ownership)
        },
        processed_at: new Date().toISOString()
      });

      await this.emitTenantSignal('amazon.notification.quarantined', notificationId, ownership, {
        notification_type: parsed.notificationType,
        classification: classification.classification,
        reason: ownership.ambiguous ? 'ambiguous_ownership' : 'missing_ownership'
      });

      return {
        statusCode: 202,
        response: {
          success: true,
          notificationId,
          quarantined: true
        }
      };
    }

    if (classification.classification === 'unhandled_notification_type' || actionPlan.type === 'signal_only') {
      await this.updateProcessingState(notificationId, 'processed', {
        triggered_agent: 'agent10.signal_only',
        processed_at: new Date().toISOString()
      });

      await this.emitTenantSignal('amazon.notification.routed', notificationId, ownership, {
        notification_type: parsed.notificationType,
        classification: classification.classification,
        triggered_agent: 'agent10.signal_only'
      });

      return {
        statusCode: 202,
        response: {
          success: true,
          notificationId,
          handled: actionPlan.type !== 'signal_only' ? false : true,
          classification: classification.classification
        }
      };
    }

    try {
      const routeResult = await this.routeNotification(notificationId, classification, ownership, options.replay);

      await this.updateProcessingState(notificationId, 'processed', {
        triggered_agent: routeResult.triggeredAgent,
        triggered_sync_id: routeResult.syncId || null,
        processing_metadata: {
          route_result: routeResult,
          requested_domains: classification.requestedDomains,
          support_level: classification.supportLevel
        },
        processed_at: new Date().toISOString(),
        error: null
      });

      await this.emitTenantSignal('amazon.notification.routed', notificationId, ownership, {
        notification_type: parsed.notificationType,
        classification: classification.classification,
        triggered_agent: routeResult.triggeredAgent,
        sync_id: routeResult.syncId || null,
        execution_mode: routeResult.executionMode
      });

      return {
        statusCode: 200,
        response: {
          success: true,
          notificationId,
          classification: classification.classification,
          routeResult
        }
      };
    } catch (error: any) {
      await this.updateProcessingState(notificationId, 'failed', {
        error: error?.message || 'notification_routing_failed',
        processed_at: new Date().toISOString()
      });

      await this.emitTenantSignal('amazon.notification.failed', notificationId, ownership, {
        notification_type: parsed.notificationType,
        classification: classification.classification,
        error: error?.message || 'notification_routing_failed'
      });

      return {
        statusCode: 500,
        response: {
          success: false,
          notificationId,
          error: error?.message || 'notification_routing_failed'
        }
      };
    }
  }

  private async routeNotification(
    notificationId: string,
    classification: NotificationClassificationResult,
    ownership: NotificationOwnershipContext,
    replay: boolean
  ): Promise<{
    triggeredAgent: string;
    syncId?: string;
    executionMode: string;
    reason: string;
  }> {
    if (replay) {
      return {
        triggeredAgent: 'agent10.replay',
        executionMode: 'replay_preview',
        reason: `Replay of ${classification.classification}`
      };
    }

    try {
      const sync = await syncJobManager.startSync(ownership.userId!, ownership.storeId!);
      await this.updateProcessingState(notificationId, 'triggered', {
        triggered_agent: 'agent2.sync',
        triggered_sync_id: sync.syncId,
        processing_metadata: {
          requested_domains: classification.requestedDomains,
          execution_mode: 'agent2_full_sync_fallback',
          sync_status: sync.status
        }
      });

      return {
        triggeredAgent: 'agent2.sync',
        syncId: sync.syncId,
        executionMode: 'agent2_full_sync_fallback',
        reason: classification.reason
      };
    } catch (error: any) {
      const message = String(error?.message || '');
      if (message.includes('already in progress')) {
        const existingSyncId = message.match(/\(([^)]+)\)/)?.[1];
        await this.updateProcessingState(notificationId, 'triggered', {
          triggered_agent: 'agent2.sync',
          triggered_sync_id: existingSyncId || null,
          processing_metadata: {
            requested_domains: classification.requestedDomains,
            execution_mode: 'already_running'
          }
        });

        return {
          triggeredAgent: 'agent2.sync',
          syncId: existingSyncId,
          executionMode: 'already_running',
          reason: classification.reason
        };
      }

      throw error;
    }
  }

  private planAction(classification: NotificationClassificationResult): {
    type: 'trigger_sync' | 'signal_only';
    requestedDomains: string[];
    reason: string;
  } {
    if (['listing_issue_changed', 'transport_unsubscribe_confirmation', 'unhandled_notification_type'].includes(classification.classification)) {
      return {
        type: 'signal_only',
        requestedDomains: classification.requestedDomains,
        reason: classification.reason
      };
    }

    return {
      type: 'trigger_sync',
      requestedDomains: classification.requestedDomains,
      reason: classification.reason
    };
  }

  private async persistNotification(parsed: ParsedAmazonNotification, ownership: NotificationOwnershipContext): Promise<{ notificationId?: string; duplicate?: boolean }> {
    const { data: existingByDedupe, error: existingByDedupeError } = await supabaseAdmin
      .from('amazon_notifications')
      .select('id')
      .eq('dedupe_key', parsed.dedupeKey)
      .maybeSingle();

    if (existingByDedupeError) {
      throw new Error(`Failed to check Amazon notification dedupe state: ${existingByDedupeError.message}`);
    }

    if (existingByDedupe?.id) {
      return {
        notificationId: existingByDedupe.id,
        duplicate: true
      };
    }

    const { data, error } = await supabaseAdmin
      .from('amazon_notifications')
      .insert({
        tenant_id: ownership.tenantId || null,
        store_id: ownership.storeId || null,
        user_id: ownership.userId || null,
        seller_id: ownership.sellerId || parsed.sellerId || null,
        source: 'amazon_notifications',
        delivery_type: parsed.deliveryType,
        notification_type: parsed.notificationType,
        notification_subtype: parsed.notificationSubtype || null,
        classification: 'unhandled_notification_type',
        amazon_notification_id: parsed.amazonNotificationId || null,
        amazon_subscription_id: parsed.amazonSubscriptionId || null,
        amazon_destination_id: parsed.amazonDestinationId || null,
        sns_message_id: parsed.snsMessageId || null,
        sns_topic_arn: parsed.snsTopicArn || null,
        dedupe_key: parsed.dedupeKey,
        payload_hash: parsed.payloadHash,
        payload: parsed.receivedPayload,
        processing_metadata: {
          ownership: this.buildOwnershipMetadata(ownership)
        },
        processing_status: 'received',
        lineage_resolution: ownership.lineageResolution || null,
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (!error && data?.id) {
      return { notificationId: data.id };
    }

    if (error && String((error as any).code || '') === '23505') {
      const { data: existing } = await supabaseAdmin
        .from('amazon_notifications')
        .select('id')
        .eq('dedupe_key', parsed.dedupeKey)
        .maybeSingle();

      return { notificationId: existing?.id, duplicate: true };
    }

    throw new Error(`Failed to persist Amazon notification: ${error?.message || 'unknown_error'}`);
  }

  private async updateProcessingState(notificationId: string, status: ProcessingStatus, updates: Record<string, any>): Promise<void> {
    const { error } = await supabaseAdmin
      .from('amazon_notifications')
      .update({
        processing_status: status,
        updated_at: new Date().toISOString(),
        ...updates
      })
      .eq('id', notificationId);

    if (error) {
      throw new Error(`Failed to update Amazon notification state: ${error.message}`);
    }
  }

  private async emitTenantSignal(
    eventName: string,
    notificationId: string,
    ownership: NotificationOwnershipContext,
    payload: Record<string, any>
  ): Promise<void> {
    if (!ownership.tenantId) {
      return;
    }

    await sseHub.sendTenantEvent(eventName, {
      notification_id: notificationId,
      tenant_id: ownership.tenantId,
      store_id: ownership.storeId,
      user_id: ownership.userId,
      seller_id: ownership.sellerId,
      source: 'amazon_notifications',
      timestamp: new Date().toISOString(),
      ...payload
    }, undefined, ownership.tenantId);
  }

  private buildOwnershipMetadata(ownership: NotificationOwnershipContext): Record<string, any> {
    return {
      tenant_id: ownership.tenantId || null,
      store_id: ownership.storeId || null,
      user_id: ownership.userId || null,
      seller_id: ownership.sellerId || null,
      lineage_resolution: ownership.lineageResolution || null,
      ambiguous: !!ownership.ambiguous
    };
  }
}

export const amazonNotificationService = new AmazonNotificationService();
export default amazonNotificationService;
