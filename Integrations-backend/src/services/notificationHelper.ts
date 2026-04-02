/**
 * Notification Helper Service (Agent 10)
 * Unified helper for Agents 4-9 to send notifications
 * Handles WebSocket push events, email notifications, and feeds Agent 11
 */

import logger from '../utils/logger';
import { notificationService, NotificationEvent } from '../notifications/services/notification_service';
import { NotificationType, NotificationPriority, NotificationChannel } from '../notifications/models/notification';
import { supabaseAdmin } from '../database/supabaseClient';
import { normalizeAgent10EventPayload } from '../utils/agent10Event';

export interface ClaimDetectedData {
  tenantId?: string;
  claimId?: string;
  amount?: number;
  count?: number;        // For bulk detections
  totalValue?: number;   // For bulk detections
  currency?: string;
  confidence?: number;
  orderId?: string;
  sku?: string;
  source?: string;
  syncId?: string;
}

export interface EvidenceFoundData {
  tenantId?: string;
  documentId: string;
  source: 'gmail' | 'outlook' | 'drive' | 'dropbox';
  fileName: string;
  parsed?: boolean;
  matchFound?: boolean;
  disputeId?: string;
}

export interface CaseFiledData {
  tenantId?: string;
  disputeId: string;
  caseId?: string;
  amazonCaseId?: string;
  claimAmount: number;
  currency?: string;
  status: 'filed' | 'pending' | 'in_progress';
}

export interface RefundApprovedData {
  tenantId?: string;
  disputeId: string;
  amazonCaseId?: string;
  claimAmount: number;
  currency?: string;
  approvedAmount?: number;
}

export interface FundsDepositedData {
  tenantId?: string;
  disputeId: string;
  recoveryId?: string;
  amount: number;
  currency?: string;
  platformFee?: number;
  sellerPayout?: number;
  billingStatus?: 'charged' | 'credited' | 'pending' | 'sent';
}

class NotificationHelper {
  private async resolveRecipients(targetId: string, explicitTenantId?: string): Promise<{ tenantId?: string; userIds: string[] }> {
    let query = supabaseAdmin
      .from('users')
      .select('id, tenant_id')
      .or(`id.eq.${targetId},seller_id.eq.${targetId}`);

    if (explicitTenantId) {
      query = query.eq('tenant_id', explicitTenantId);
    }

    const { data, error } = await query;
    if (error) {
      logger.warn('Failed to resolve notification recipients', {
        targetId,
        explicitTenantId,
        error: error.message
      });
      return { tenantId: explicitTenantId, userIds: [] };
    }

    const userIds = Array.from(new Set((data || []).map((row: any) => row.id).filter(Boolean))) as string[];
    const tenantId = explicitTenantId || data?.[0]?.tenant_id;
    return { tenantId, userIds };
  }

  private async dispatchNotification(
    targetId: string,
    event: Omit<NotificationEvent, 'user_id'>,
    trackingType: string
  ): Promise<void> {
    const { tenantId, userIds } = await this.resolveRecipients(targetId, event.tenant_id);

    if (!tenantId || userIds.length === 0) {
      logger.warn('Skipping notification - no valid recipient context', {
        targetId,
        tenantId,
        trackingType
      });
      return;
    }

    for (const userId of userIds) {
      await notificationService.createNotification({
        ...event,
        user_id: userId,
        tenant_id: tenantId
      });
      this._logDelivery(userId, trackingType, true);
    }
  }

  /**
   * Internal helper: non-blocking Agent 11 feed for notification delivery
   */
  private _logDelivery(userId: string, notificationType: string, success: boolean, error?: string): void {
    // Fire-and-forget — notification logging should never block notifications
    setImmediate(async () => {
      try {
        const agentEventLogger = (await import('./agentEventLogger')).default;
        await agentEventLogger.logNotificationDelivery({
          userId,
          notificationType,
          success,
          channel: 'both', // websocket + in-app
          duration: 0,
          error
        });
      } catch (logError: any) {
        // Silently swallow — logging failure should never impact notifications
      }
    });
  }

  /**
   * Notify when claim is detected
   */
  async notifyClaimDetected(userId: string, data: ClaimDetectedData): Promise<void> {
    try {
      const isBulk = data.count && data.count > 1;
      const amount = data.totalValue || data.amount || 0;
      const currency = data.currency || 'USD';
      const currencySymbol = currency === 'USD' ? '$' : currency + ' ';

      logger.info('📢 [NOTIFICATIONS] Notifying claim detected', {
        userId,
        isBulk,
        count: data.count,
        claimId: data.claimId,
        amount
      });

      let title = 'Detected High-Probability Claim';
      let message = `Margin identified a discrepancy Amazon likely owes you for. Reviewing and validating evidence now.`;

      if (isBulk) {
        title = `Detected ${data.count} High-Probability Claims - ${currencySymbol}${amount.toLocaleString()}`;
        message = `Margin identified discrepancies Amazon likely owes you for. Reviewing and validating evidence now.`;
      }

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.CLAIM_DETECTED,
        tenant_id: data.tenantId,
        title,
        message,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.CLAIM_DETECTED, {
          claimId: data.claimId,
          count: data.count,
          amount,
          currency,
          confidence: data.confidence,
          orderId: data.orderId,
          sku: data.sku,
          isBulk
        }, {
          tenantId: data.tenantId,
          entityType: data.claimId ? 'detection_result' : 'unknown',
          entityId: data.claimId
        }),
        immediate: true
      };

      await this.dispatchNotification(userId, event, 'claim_detected');

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify claim detected', {
        userId,
        error: error.message
      });
      this._logDelivery(userId, 'claim_detected', false, error.message);
    }
  }

  /**
   * Notify when evidence is found
   */
  async notifyEvidenceFound(userId: string, data: EvidenceFoundData): Promise<void> {
    try {
      logger.info('📢 [NOTIFICATIONS] Notifying evidence found', {
        userId,
        documentId: data.documentId,
        source: data.source
      });

      let title = 'Ingested Discovery Evidence';
      let message = `Processed documents from ${data.source}. Reviewing for claim validation data.`;

      if (data.matchFound && data.disputeId) {
        title = 'Attached Supporting Evidence';
        message = `Purchase invoices, delivery confirmations, and inventory trails linked to claims.`;
      }

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.EVIDENCE_FOUND,
        tenant_id: data.tenantId,
        title,
        message,
        priority: data.matchFound ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.EVIDENCE_FOUND, {
          documentId: data.documentId,
          source: data.source,
          fileName: data.fileName,
          parsed: data.parsed || false,
          matchFound: data.matchFound || false,
          disputeId: data.disputeId
        }, {
          tenantId: data.tenantId,
          entityType: data.documentId ? 'evidence_document' : 'unknown',
          entityId: data.documentId
        }),
        immediate: true
      };

      await this.dispatchNotification(userId, event, 'evidence_found');

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify evidence found', {
        userId,
        error: error.message
      });
      this._logDelivery(userId, 'evidence_found', false, error.message);
    }
  }

  /**
   * Notify when case is filed
   */
  async notifyCaseFiled(userId: string, data: CaseFiledData): Promise<void> {
    try {
      logger.info('📢 [NOTIFICATIONS] Notifying case filed', {
        userId,
        disputeId: data.disputeId,
        status: data.status
      });

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.CASE_FILED,
        tenant_id: data.tenantId,
        title: data.status === 'filed' ? `Submitted ${data.caseId ? 'Claim' : 'Claims'} to Amazon` : 'Preparing Amazon Claim Filing',
        message: data.status === 'filed'
          ? `Filed with structured evidence packages and audit references.`
          : `Preparing evidence packages and constructing audit trails for filing.`,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.CASE_FILED, {
          disputeId: data.disputeId,
          caseId: data.caseId,
          amazonCaseId: data.amazonCaseId,
          claimAmount: data.claimAmount,
          currency: data.currency || 'usd',
          status: data.status
        }, {
          tenantId: data.tenantId,
          entityType: 'dispute_case',
          entityId: data.disputeId
        }),
        immediate: true
      };

      await this.dispatchNotification(userId, event, 'case_filed');

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify case filed', {
        userId,
        error: error.message
      });
      this._logDelivery(userId, 'case_filed', false, error.message);
    }
  }

  /**
   * Notify when refund is approved
   */
  async notifyRefundApproved(userId: string, data: RefundApprovedData): Promise<void> {
    try {
      logger.info('📢 [NOTIFICATIONS] Notifying refund approved', {
        userId,
        disputeId: data.disputeId,
        amount: data.approvedAmount || data.claimAmount
      });

      const approvedAmount = data.approvedAmount || data.claimAmount;
      const currency = data.currency || 'USD';
      const currencySymbol = currency === 'USD' ? '$' : currency + ' ';

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.REFUND_APPROVED,
        tenant_id: data.tenantId,
        title: `Recovered ${currencySymbol}${approvedAmount.toFixed(2)}`,
        message: `Amazon approved the reimbursement. Cleared and scheduled for payout.`,
        priority: NotificationPriority.URGENT,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.REFUND_APPROVED, {
          disputeId: data.disputeId,
          amazonCaseId: data.amazonCaseId,
          claimAmount: data.claimAmount,
          approvedAmount,
          currency: data.currency || 'usd'
        }, {
          tenantId: data.tenantId,
          entityType: 'dispute_case',
          entityId: data.disputeId
        }),
        immediate: true
      };

      await this.dispatchNotification(userId, event, 'refund_approved');

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify refund approved', {
        userId,
        error: error.message
      });
      this._logDelivery(userId, 'refund_approved', false, error.message);
    }
  }

  /**
   * Notify when funds are deposited
   */
  async notifyFundsDeposited(userId: string, data: FundsDepositedData): Promise<void> {
    try {
      logger.info('📢 [NOTIFICATIONS] Notifying funds deposited', {
        userId,
        disputeId: data.disputeId,
        amount: data.amount
      });

      let title = 'Funds Deposited! 🎉';
      const currency = (data.currency || 'USD').toUpperCase();
      const currencySymbol = currency === 'USD' ? '$' : currency + ' ';
      const formattedAmount = `${currencySymbol}${data.amount.toFixed(2)}`;
      let message = `Funds have been cleared and deposited to your account.`;

      if (typeof data.amount === 'number' && Number.isFinite(data.amount)) {
        message += ` You keep ${currencySymbol}${data.amount.toFixed(2)}. Margin billing stays on flat subscription pricing and never deducts a recovery commission.`;
      }

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.FUNDS_DEPOSITED,
        tenant_id: data.tenantId,
        title: `Deposit Confirmed: ${formattedAmount}`,
        message: message,
        priority: NotificationPriority.URGENT,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.FUNDS_DEPOSITED, {
          disputeId: data.disputeId,
          recoveryId: data.recoveryId,
          amount: data.amount,
          currency: data.currency || 'usd',
          sellerPayout: data.sellerPayout ?? data.amount,
          billingStatus: data.billingStatus
        }, {
          tenantId: data.tenantId,
          entityType: data.recoveryId ? 'recovery' : 'dispute_case',
          entityId: data.recoveryId || data.disputeId
        }),
        immediate: true
      };

      await this.dispatchNotification(userId, event, 'funds_deposited');

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify funds deposited', {
        userId,
        error: error.message
      });
      this._logDelivery(userId, 'funds_deposited', false, error.message);
    }
  }

  /**
   * Generic notification method (for custom events)
   */
  async notifyUser(
    userId: string,
    eventType: NotificationType,
    title: string,
    message: string,
    priority: NotificationPriority = NotificationPriority.NORMAL,
    channel: NotificationChannel = NotificationChannel.BOTH,
    payload?: Record<string, any>,
    tenantId?: string
  ): Promise<void> {
    try {
      const event: Omit<NotificationEvent, 'user_id'> = {
        type: eventType,
        tenant_id: tenantId,
        title,
        message,
        priority,
        channel,
        payload: normalizeAgent10EventPayload(eventType, payload, { tenantId }),
        immediate: true
      };

      await this.dispatchNotification(userId, event, eventType);

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify user', {
        userId,
        eventType,
        error: error.message
      });
    }
  }
  /**
   * Notify when Amazon challenges a claim (Realism Log)
   */
  async notifyAmazonChallenge(userId: string, data: { count?: number; disputeIds?: string[] }): Promise<void> {
    try {
      const count = data.count || (data.disputeIds ? data.disputeIds.length : 1);
      const title = count > 1 ? `Amazon Challenged ${count} Claims — Escalating` : `Amazon Challenged Claim — Escalating`;
      const message = `We’re reviewing their response and preparing counter-evidence.`;

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.AMAZON_CHALLENGE,
        tenant_id: undefined,
        title,
        message,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.AMAZON_CHALLENGE, {
          count,
          disputeIds: data.disputeIds
        }),
        immediate: true
      };

      await this.dispatchNotification(userId, event, 'amazon_challenge');
    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify Amazon challenge', { userId, error: error.message });
    }
  }
}

// Export singleton instance
const notificationHelper = new NotificationHelper();
export default notificationHelper;

