/**
 * Notification Helper Service (Agent 10)
 * Unified helper for Agents 4-9 to send notifications
 * Handles WebSocket push events, email notifications, and feeds Agent 11
 */

import logger from '../utils/logger';
import { notificationService, NotificationEvent } from '../notifications/services/notification_service';
import { NotificationType, NotificationPriority, NotificationChannel } from '../notifications/models/notification';
import websocketService from './websocketService';

export interface ClaimDetectedData {
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
  documentId: string;
  source: 'gmail' | 'outlook' | 'drive' | 'dropbox';
  fileName: string;
  parsed?: boolean;
  matchFound?: boolean;
  disputeId?: string;
}

export interface CaseFiledData {
  disputeId: string;
  caseId?: string;
  amazonCaseId?: string;
  claimAmount: number;
  currency?: string;
  status: 'filed' | 'pending' | 'in_progress';
}

export interface RefundApprovedData {
  disputeId: string;
  amazonCaseId?: string;
  claimAmount: number;
  currency?: string;
  approvedAmount?: number;
}

export interface FundsDepositedData {
  disputeId: string;
  recoveryId?: string;
  amount: number;
  currency?: string;
  platformFee?: number;
  sellerPayout?: number;
  billingStatus?: 'charged' | 'pending';
}

class NotificationHelper {

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

      const event: NotificationEvent = {
        type: NotificationType.CLAIM_DETECTED,
        user_id: userId,
        title,
        message,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: {
          claimId: data.claimId,
          count: data.count,
          amount,
          currency,
          confidence: data.confidence,
          orderId: data.orderId,
          sku: data.sku,
          isBulk
        },
        immediate: true
      };

      await notificationService.createNotification(event);

      // Also send via WebSocket for real-time delivery
      websocketService.sendNotificationToUser(userId, {
        type: 'success',
        title,
        message,
        data: event.payload
      });

      // 🎯 AGENT 11 FEED: Log notification delivery
      this._logDelivery(userId, 'claim_detected', true);

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

      const event: NotificationEvent = {
        type: NotificationType.EVIDENCE_FOUND,
        user_id: userId,
        title,
        message,
        priority: data.matchFound ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
        channel: NotificationChannel.BOTH,
        payload: {
          documentId: data.documentId,
          source: data.source,
          fileName: data.fileName,
          parsed: data.parsed || false,
          matchFound: data.matchFound || false,
          disputeId: data.disputeId
        },
        immediate: true
      };

      await notificationService.createNotification(event);

      // Also send via WebSocket
      websocketService.sendNotificationToUser(userId, {
        type: data.matchFound ? 'success' : 'info',
        title,
        message,
        data: event.payload
      });

      // 🎯 AGENT 11 FEED
      this._logDelivery(userId, 'evidence_found', true);

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

      const event: NotificationEvent = {
        type: NotificationType.CASE_FILED,
        user_id: userId,
        title: data.status === 'filed' ? `Submitted ${data.caseId ? 'Claim' : 'Claims'} to Amazon` : 'Preparing Amazon Claim Filing',
        message: data.status === 'filed'
          ? `Filed with structured evidence packages and audit references.`
          : `Preparing evidence packages and constructing audit trails for filing.`,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: {
          disputeId: data.disputeId,
          caseId: data.caseId,
          amazonCaseId: data.amazonCaseId,
          claimAmount: data.claimAmount,
          currency: data.currency || 'usd',
          status: data.status
        },
        immediate: true
      };

      await notificationService.createNotification(event);

      // Also send via WebSocket
      websocketService.sendNotificationToUser(userId, {
        type: data.status === 'filed' ? 'success' : 'info',
        title: event.title,
        message: event.message,
        data: event.payload
      });

      // 🎯 AGENT 11 FEED
      this._logDelivery(userId, 'case_filed', true);

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

      const event: NotificationEvent = {
        type: NotificationType.REFUND_APPROVED,
        user_id: userId,
        title: `Recovered ${currencySymbol}${approvedAmount.toFixed(2)}`,
        message: `Amazon approved the reimbursement. Cleared and scheduled for payout.`,
        priority: NotificationPriority.URGENT,
        channel: NotificationChannel.BOTH,
        payload: {
          disputeId: data.disputeId,
          amazonCaseId: data.amazonCaseId,
          claimAmount: data.claimAmount,
          approvedAmount,
          currency: data.currency || 'usd'
        },
        immediate: true
      };

      await notificationService.createNotification(event);

      // Also send via WebSocket
      websocketService.sendNotificationToUser(userId, {
        type: 'success',
        title: `Recovered ${currencySymbol}${approvedAmount.toFixed(2)}`,
        message: `Amazon approved the reimbursement. Cleared and scheduled for payout.`,
        data: event.payload
      });

      // 🎯 AGENT 11 FEED
      this._logDelivery(userId, 'refund_approved', true);

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

      if (data.billingStatus === 'charged') {
        const platformFee = data.platformFee || (data.amount * 0.20);
        const sellerPayout = data.sellerPayout || (data.amount * 0.80);
        message += `. Platform fee (20%): ${data.currency || '$'}${platformFee.toFixed(2)}, Your payout: ${data.currency || '$'}${sellerPayout.toFixed(2)}`;
      }

      const event: NotificationEvent = {
        type: NotificationType.FUNDS_DEPOSITED,
        user_id: userId,
        title: `Deposit Confirmed: ${formattedAmount}`,
        message: message,
        priority: NotificationPriority.URGENT,
        channel: NotificationChannel.BOTH,
        payload: {
          disputeId: data.disputeId,
          recoveryId: data.recoveryId,
          amount: data.amount,
          currency: data.currency || 'usd',
          platformFee: data.platformFee,
          sellerPayout: data.sellerPayout,
          billingStatus: data.billingStatus
        },
        immediate: true
      };

      await notificationService.createNotification(event);

      // Also send via WebSocket
      websocketService.sendNotificationToUser(userId, {
        type: 'success',
        title,
        message: message + '.',
        data: event.payload
      });

      // 🎯 AGENT 11 FEED
      this._logDelivery(userId, 'funds_deposited', true);

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
    payload?: Record<string, any>
  ): Promise<void> {
    try {
      const event: NotificationEvent = {
        type: eventType,
        user_id: userId,
        title,
        message,
        priority,
        channel,
        payload,
        immediate: true
      };

      await notificationService.createNotification(event);

      // Also send via WebSocket
      websocketService.sendNotificationToUser(userId, {
        type: priority === NotificationPriority.URGENT || priority === NotificationPriority.HIGH ? 'success' : 'info',
        title,
        message,
        data: payload
      });

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

      const event: NotificationEvent = {
        type: NotificationType.AMAZON_CHALLENGE,
        user_id: userId,
        title,
        message,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: {
          count,
          disputeIds: data.disputeIds
        },
        immediate: true
      };

      await notificationService.createNotification(event);

      websocketService.sendNotificationToUser(userId, {
        type: 'warning',
        title,
        message,
        data: event.payload
      });
    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify Amazon challenge', { userId, error: error.message });
    }
  }
}

// Export singleton instance
const notificationHelper = new NotificationHelper();
export default notificationHelper;

