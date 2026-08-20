import crypto from 'crypto';
import Notification from '../models/notification';
import { notificationService } from './notification_service';
import {
  buildSignalDedupeKey,
  createActionRoute,
  getSystemSignalDefinition,
  renderSystemSignalCopy,
  SignalActionState,
  SignalActionType,
  SignalProviderState,
  SignalState,
  SystemSignalEventType,
  isSystemSignalEventType
} from '../systemSignals';
import { supabaseAdmin } from '../../database/supabaseClient';
import { getLogger } from '../../utils/logger';

const logger = getLogger('SystemSignalService');

export interface AcceptSystemSignalInput {
  tenantId: string;
  recipientUserId: string;
  eventType: SystemSignalEventType;
  objectType: string;
  objectId: string;
  businessTransitionKey: string;
  policyWindowKey?: string;
  occurredAt?: Date | string;
  correlationId?: string;
  causationId?: string;
  providerState?: SignalProviderState;
  actionType?: SignalActionType;
  privateTitle?: string;
  privateBody?: string;
  detailedBody?: string;
  externalTitle?: string;
  externalBody?: string;
  payload?: Record<string, unknown>;
}

export interface AcceptSystemSignalResult {
  notification: Notification;
  signalId: string;
  deduped: boolean;
}

export type AcceptSystemSignalForTargetInput = Omit<AcceptSystemSignalInput, 'recipientUserId'> & {
  recipientTargetId: string;
};

interface StoredSystemSignalMetadata {
  signal_id?: string;
  event_type?: string;
  action_type?: string;
  action_state?: string;
  signal_state?: string;
}

function normalizeRequired(value: unknown, name: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`SYSTEM_SIGNAL_${name}_REQUIRED`);
  return normalized;
}

function asDate(value?: Date | string): Date {
  if (!value) return new Date();
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('SYSTEM_SIGNAL_OCCURRED_AT_INVALID');
  return parsed;
}

function actionStateFor(actionType: SignalActionType): SignalActionState {
  return actionType === 'none' ? 'none' : 'pending';
}

/**
 * A thin canonical adapter. It deliberately writes the existing `notifications`
 * record as the seller-facing durable state and persists canonical metadata beside
 * it; it does not create another inbox or replace SSE/email adapters.
 */
export class SystemSignalService {
  async acceptForTarget(input: AcceptSystemSignalForTargetInput): Promise<AcceptSystemSignalResult[]> {
    const tenantId = normalizeRequired(input.tenantId, 'TENANT');
    const target = normalizeRequired(input.recipientTargetId, 'RECIPIENT_TARGET');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);
    let userQuery = supabaseAdmin.from('users').select('id');
    userQuery = isUuid
      ? userQuery.or(`id.eq.${target},amazon_seller_id.eq.${target},seller_id.eq.${target}`)
      : userQuery.or(`amazon_seller_id.eq.${target},seller_id.eq.${target}`);

    const { data: users, error: usersError } = await userQuery;
    if (usersError) throw new Error(`SYSTEM_SIGNAL_RECIPIENT_LOOKUP_FAILED:${usersError.message}`);

    const candidateUserIds = Array.from(new Set((users || [])
      .map((row: any): string => String(row.id || '').trim())
      .filter((value): value is string => Boolean(value))));
    if (!candidateUserIds.length) throw new Error('SYSTEM_SIGNAL_RECIPIENT_NOT_FOUND_FOR_TENANT');

    const { data: memberships, error: membershipsError } = await supabaseAdmin
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('user_id', candidateUserIds);
    if (membershipsError) throw new Error(`SYSTEM_SIGNAL_MEMBERSHIP_LOOKUP_FAILED:${membershipsError.message}`);

    const recipientUserIds: string[] = Array.from(new Set<string>(
      ((memberships || []) as Array<{ user_id?: unknown }>)
        .map((row): string => String(row.user_id || '').trim())
        .filter((value): value is string => Boolean(value))
    ));
    if (!recipientUserIds.length) throw new Error('SYSTEM_SIGNAL_RECIPIENT_NOT_FOUND_FOR_TENANT');

    return Promise.all(recipientUserIds.map((recipientUserId) => this.accept({
      ...input,
      tenantId,
      recipientUserId
    })));
  }

  async accept(input: AcceptSystemSignalInput): Promise<AcceptSystemSignalResult> {
    const tenantId = normalizeRequired(input.tenantId, 'TENANT');
    const recipientUserId = normalizeRequired(input.recipientUserId, 'RECIPIENT');
    const objectType = normalizeRequired(input.objectType, 'OBJECT_TYPE');
    const objectId = normalizeRequired(input.objectId, 'OBJECT_ID');
    const businessTransitionKey = normalizeRequired(input.businessTransitionKey, 'TRANSITION_KEY');

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', recipientUserId)
      .eq('is_active', true)
      .maybeSingle();
    if (membershipError) throw new Error(`SYSTEM_SIGNAL_MEMBERSHIP_LOOKUP_FAILED:${membershipError.message}`);
    if (!membership) throw new Error('SYSTEM_SIGNAL_RECIPIENT_NOT_FOUND_FOR_TENANT');

    if (!isSystemSignalEventType(input.eventType)) {
      throw new Error(`SYSTEM_SIGNAL_EVENT_TYPE_INVALID:${input.eventType}`);
    }

    const definition = getSystemSignalDefinition(input.eventType);
    const actionType = input.actionType || definition.actionType;
    const dedupeKey = buildSignalDedupeKey({
      eventType: input.eventType,
      tenantId,
      recipientUserId,
      objectType,
      objectId,
      businessTransitionKey,
      policyWindowKey: input.policyWindowKey
    });

    const existing = await Notification.findByDedupeKey(recipientUserId, tenantId, dedupeKey);
    if (existing) {
      const metadata = (existing.payload?.system_signal || {}) as StoredSystemSignalMetadata;
      return {
        notification: existing,
        signalId: String(metadata.signal_id || existing.system_signal_id || existing.id),
        deduped: true
      };
    }

    const copy = renderSystemSignalCopy(definition, {
      defaultPrivateTitle: input.privateTitle,
      defaultPrivateBody: input.privateBody,
      defaultExternalTitle: input.externalTitle,
      defaultExternalBody: input.externalBody
    });
    const signalId = crypto.randomUUID();
    const occurredAt = asDate(input.occurredAt);
    const signalState: SignalState = 'open';
    const actionState = actionStateFor(actionType);
    const actionRoute = createActionRoute(definition, objectType, objectId, actionType);
    const providerState = input.providerState || definition.providerState;

    const notification = await notificationService.createNotification({
      type: definition.legacyNotificationType,
      user_id: recipientUserId,
      tenant_id: tenantId,
      title: copy.privateTitle,
      message: copy.privateBody,
      priority: definition.legacyPriority,
      channel: definition.requestedChannel,
      payload: {
        ...(input.payload || {}),
        dedupe_key: dedupeKey,
        system_signal: {
          signal_id: signalId,
          event_type: input.eventType,
          event_version: 1,
          domain: definition.domain,
          severity: definition.severity,
          sensitivity: definition.sensitivity,
          provider_state: providerState,
          occurred_at: occurredAt.toISOString(),
          correlation_id: input.correlationId || null,
          causation_id: input.causationId || null,
          object_type: objectType,
          object_id: objectId,
          action_type: actionType,
          action_route: actionRoute,
          private_title: copy.privateTitle,
          private_body: copy.privateBody,
          detailed_body: input.detailedBody || null,
          external_title: copy.externalTitle,
          external_body: copy.externalBody,
          delivery_policy: definition.deliveryPolicy,
          signal_state: signalState,
          seller_state: 'unseen',
          action_state: actionState,
          dedupe_key: dedupeKey
        }
      },
      canonicalSignal: {
        signalId,
        eventType: input.eventType,
        eventVersion: 1,
        domain: definition.domain,
        severity: definition.severity,
        sensitivity: definition.sensitivity,
        providerState,
        occurredAt,
        correlationId: input.correlationId,
        causationId: input.causationId,
        objectType,
        objectId,
        actionType,
        actionRoute,
        deliveryPolicy: definition.deliveryPolicy,
        signalState,
        sellerState: 'unseen',
        actionState,
        privateTitle: copy.privateTitle,
        privateBody: copy.privateBody,
        detailedBody: input.detailedBody,
        externalTitle: copy.externalTitle,
        externalBody: copy.externalBody,
        dedupeKey,
        forceInApp: definition.severity !== 'informational'
      },
      immediate: true
    });

    if (!notification) {
      // Canonical action/critical signals are force-persisted in-app. This branch is
      // retained only for a policy-suppressed informational signal.
      throw new Error('SYSTEM_SIGNAL_SUPPRESSED_UNEXPECTEDLY');
    }

    logger.info('System Signal accepted', {
      signalId,
      notificationId: notification.id,
      tenantId,
      recipientUserId,
      eventType: input.eventType,
      dedupeKey
    });

    return { notification, signalId, deduped: false };
  }

  async acknowledge(notification: Notification, tenantId: string, userId: string): Promise<Notification> {
    if (notification.tenant_id !== tenantId || notification.user_id !== userId) {
      throw new Error('SYSTEM_SIGNAL_ACCESS_DENIED');
    }
    if (!notification.system_signal_id) {
      throw new Error('SYSTEM_SIGNAL_NOT_CANONICAL');
    }

    return notification.update({
      seller_state: 'acknowledged',
      acknowledged_at: new Date()
    });
  }

  async resolveOpenSignalsForObject(input: {
    tenantId: string;
    objectType: string;
    objectId: string;
    actionType?: SignalActionType;
    eventType?: SystemSignalEventType;
    resolutionReason: string;
    actionState?: Extract<SignalActionState, 'completed' | 'no_longer_needed' | 'expired'>;
  }): Promise<number> {
    const tenantId = normalizeRequired(input.tenantId, 'TENANT');
    const objectType = normalizeRequired(input.objectType, 'OBJECT_TYPE');
    const objectId = normalizeRequired(input.objectId, 'OBJECT_ID');
    const actionState = input.actionState || 'completed';
    const now = new Date().toISOString();

    let query = supabaseAdmin
      .from('notifications')
      .update({
        signal_state: 'resolved',
        action_state: actionState,
        resolved_at: now,
        resolution_reason: input.resolutionReason,
        updated_at: now
      })
      .eq('tenant_id', tenantId)
      .eq('signal_object_type', objectType)
      .eq('signal_object_id', objectId)
      .eq('signal_state', 'open');

    if (input.actionType) {
      query = query.eq('signal_action_type', input.actionType);
    }
    if (input.eventType) {
      query = query.eq('signal_event_type', input.eventType);
    }

    const { data, error } = await query.select('id, system_signal_id');
    if (error) throw new Error(`SYSTEM_SIGNAL_RESOLUTION_FAILED:${error.message}`);

    const signalIds = (data || []).map((row: any) => String(row.system_signal_id || '')).filter(Boolean);
    if (signalIds.length) {
      const { error: deliveryError } = await supabaseAdmin
        .from('notification_signal_deliveries')
        .update({ cancelled_at: now, status: 'cancelled', updated_at: now })
        .in('signal_id', signalIds)
        .in('status', ['queued', 'attempted']);
      if (deliveryError) {
        logger.warn('Signal resolved but pending delivery cancellation failed', {
          signalIds,
          error: deliveryError.message
        });
      }
    }

    return (data || []).length;
  }
}

export const systemSignalService = new SystemSignalService();
export default systemSignalService;
