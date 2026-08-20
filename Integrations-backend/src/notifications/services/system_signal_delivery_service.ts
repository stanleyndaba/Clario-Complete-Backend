import Notification from '../models/notification';
import { supabaseAdmin } from '../../database/supabaseClient';
import { getLogger } from '../../utils/logger';

const logger = getLogger('SystemSignalDeliveryService');

type DeliveryChannel = 'in_app' | 'realtime' | 'email';
type DeliveryStatus =
  | 'queued'
  | 'persisted'
  | 'attempted'
  | 'accepted'
  | 'provider_confirmed'
  | 'client_received'
  | 'failed_transient'
  | 'failed_permanent'
  | 'suppressed'
  | 'cancelled';

interface DeliveryPatch {
  status: DeliveryStatus;
  attempt?: boolean;
  attemptedAt?: Date;
  acceptedAt?: Date;
  providerConfirmedAt?: Date;
  clientReceivedAt?: Date;
  failedAt?: Date;
  lastError?: string | null;
  providerMessageId?: string | null;
  providerEventId?: string | null;
}

function getPolicySnapshot(notification: Notification) {
  return {
    event_type: notification.signal_event_type,
    severity: notification.signal_severity,
    sensitivity: notification.signal_sensitivity,
    delivery_policy: notification.signal_delivery_policy,
    provider_state: notification.signal_provider_state,
    action_state: notification.action_state
  };
}

/**
 * V1 stores one materialized record per signal/channel. It captures the current
 * state and attempt count without fabricating client receipt or provider delivery.
 */
export class SystemSignalDeliveryService {
  private isCanonical(notification: Notification): notification is Notification & { system_signal_id: string } {
    return Boolean(notification.system_signal_id && notification.tenant_id && notification.user_id);
  }

  async recordInAppPersisted(notification: Notification): Promise<void> {
    await this.upsert(notification, 'in_app', { status: 'persisted' });
  }

  async recordRealtimeAttempt(notification: Notification, success: boolean, error?: string): Promise<void> {
    await this.upsert(notification, 'realtime', {
      status: success ? 'attempted' : 'failed_transient',
      attempt: true,
      attemptedAt: new Date(),
      failedAt: success ? undefined : new Date(),
      lastError: success ? null : (error || 'realtime_emit_failed')
    });
  }

  async recordEmailAccepted(notification: Notification, providerMessageId: string | null): Promise<void> {
    await this.upsert(notification, 'email', {
      status: 'accepted',
      attempt: true,
      attemptedAt: new Date(),
      acceptedAt: new Date(),
      providerMessageId,
      lastError: null
    });
  }

  async recordEmailFailure(notification: Notification, error: string): Promise<void> {
    await this.upsert(notification, 'email', {
      status: 'failed_transient',
      attempt: true,
      attemptedAt: new Date(),
      failedAt: new Date(),
      lastError: error
    });
  }

  /**
   * Receipt is transport truth only. It never changes seller, action, or signal state.
   * The caller must already have verified notification ownership through the authenticated route.
   */
  async recordClientReceipt(notification: Notification, tenantId: string, recipientUserId: string): Promise<{ idempotent: boolean }> {
    if (!this.isCanonical(notification)) throw new Error('SYSTEM_SIGNAL_NOT_CANONICAL');
    if (notification.tenant_id !== tenantId || notification.user_id !== recipientUserId) {
      throw new Error('SYSTEM_SIGNAL_ACCESS_DENIED');
    }

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('notification_signal_deliveries')
      .select('id, client_received_at')
      .eq('notification_id', notification.id)
      .eq('tenant_id', tenantId)
      .eq('recipient_user_id', recipientUserId)
      .eq('channel', 'realtime')
      .maybeSingle();
    if (lookupError) throw new Error(`SYSTEM_SIGNAL_DELIVERY_LOOKUP_FAILED:${lookupError.message}`);
    if (existing?.client_received_at) return { idempotent: true };

    await this.upsert(notification, 'realtime', {
      // A receipt can legitimately race the asynchronous ledger attempt write.
      // The received event itself proves a transport attempt, so create the row safely if absent.
      status: 'client_received',
      attempt: !existing,
      attemptedAt: existing ? undefined : new Date(),
      clientReceivedAt: new Date(),
      lastError: null
    });
    return { idempotent: false };
  }

  /**
   * Updates only the matching persisted email delivery after an already-verified Resend webhook.
   * Provider-confirmed transport truth remains independent from seller read or action state.
   */
  async recordEmailProviderConfirmation(input: {
    providerMessageId: string;
    providerEventId: string;
    providerStatus: string;
    occurredAt: Date;
  }): Promise<number> {
    const providerMessageId = String(input.providerMessageId || '').trim();
    const providerEventId = String(input.providerEventId || '').trim();
    if (!providerMessageId || !providerEventId) return 0;

    const { data: deliveries, error } = await supabaseAdmin
      .from('notification_signal_deliveries')
      .select('id, provider_event_id')
      .eq('channel', 'email')
      .eq('provider_message_id', providerMessageId);
    if (error) throw new Error(`SYSTEM_SIGNAL_PROVIDER_DELIVERY_LOOKUP_FAILED:${error.message}`);

    let updated = 0;
    const normalizedStatus = String(input.providerStatus || '').toLowerCase();
    const terminalFailure = normalizedStatus === 'bounced' || normalizedStatus === 'complained';
    const nextStatus: DeliveryStatus = terminalFailure ? 'failed_permanent' : 'provider_confirmed';

    for (const delivery of deliveries || []) {
      if (String((delivery as any).provider_event_id || '') === providerEventId) continue;
      const priorEventId = String((delivery as any).provider_event_id || '').trim();
      if (priorEventId === providerEventId) continue;

      // Guard the write at the database boundary as well as in memory. If two copies of
      // the same provider event race, only the first may materialize delivery truth.
      let updateQuery: any = supabaseAdmin
        .from('notification_signal_deliveries')
        .update({
          status: nextStatus,
          provider_event_id: providerEventId,
          provider_confirmed_at: input.occurredAt.toISOString(),
          failed_at: terminalFailure ? input.occurredAt.toISOString() : null,
          last_error: terminalFailure ? `resend_${normalizedStatus}` : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', (delivery as any).id);

      updateQuery = priorEventId
        ? updateQuery.neq('provider_event_id', providerEventId)
        : updateQuery.is('provider_event_id', null);
      const { error: updateError } = await updateQuery;
      if (updateError) throw new Error(`SYSTEM_SIGNAL_PROVIDER_DELIVERY_UPDATE_FAILED:${updateError.message}`);
      updated += 1;
    }
    return updated;
  }

  private async upsert(notification: Notification, channel: DeliveryChannel, patch: DeliveryPatch): Promise<void> {
    if (!this.isCanonical(notification)) return;

    const now = new Date().toISOString();
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('notification_signal_deliveries')
      .select('id, attempt_count')
      .eq('notification_id', notification.id)
      .eq('channel', channel)
      .maybeSingle();

    if (lookupError) {
      logger.warn('Unable to load System Signal delivery record', {
        notificationId: notification.id,
        signalId: notification.system_signal_id,
        channel,
        error: lookupError.message
      });
      return;
    }

    const payload = {
      notification_id: notification.id,
      signal_id: notification.system_signal_id,
      tenant_id: notification.tenant_id,
      recipient_user_id: notification.user_id,
      channel,
      status: patch.status,
      policy_snapshot: getPolicySnapshot(notification),
      attempt_count: (existing?.attempt_count || 0) + (patch.attempt ? 1 : 0),
      attempted_at: patch.attemptedAt ? patch.attemptedAt.toISOString() : undefined,
      accepted_at: patch.acceptedAt ? patch.acceptedAt.toISOString() : undefined,
      provider_confirmed_at: patch.providerConfirmedAt ? patch.providerConfirmedAt.toISOString() : undefined,
      client_received_at: patch.clientReceivedAt ? patch.clientReceivedAt.toISOString() : undefined,
      failed_at: patch.failedAt ? patch.failedAt.toISOString() : undefined,
      last_error: patch.lastError,
      provider_message_id: patch.providerMessageId || undefined,
      provider_event_id: patch.providerEventId || undefined,
      updated_at: now
    };

    const { error } = await supabaseAdmin
      .from('notification_signal_deliveries')
      .upsert(payload, { onConflict: 'notification_id,channel' });

    if (error) {
      logger.warn('Unable to persist System Signal delivery record', {
        notificationId: notification.id,
        signalId: notification.system_signal_id,
        channel,
        error: error.message
      });
    }
  }
}

export const systemSignalDeliveryService = new SystemSignalDeliveryService();
export default systemSignalDeliveryService;
