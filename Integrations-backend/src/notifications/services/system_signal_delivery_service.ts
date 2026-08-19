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
  failedAt?: Date;
  lastError?: string | null;
  providerMessageId?: string | null;
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
      failed_at: patch.failedAt ? patch.failedAt.toISOString() : undefined,
      last_error: patch.lastError,
      provider_message_id: patch.providerMessageId || undefined,
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
