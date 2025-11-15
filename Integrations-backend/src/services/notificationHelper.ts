/**
 * Notification Helper Service
 * Unified helper for Agents 4-9 to send notifications
 * Handles WebSocket push events and email notifications
 */

import logger from '../utils/logger';
import { notificationService, NotificationEvent } from '../notifications/services/notification_service';
import { NotificationType, NotificationPriority, NotificationChannel } from '../notifications/models/notification';
import websocketService from './websocketService';

export interface ClaimDetectedData {
  claimId: string;
  amount: number;
  currency?: string;
  confidence?: number;
  orderId?: string;
  sku?: string;
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
   * Notify when claim is detected
   */
  async notifyClaimDetected(userId: string, data: ClaimDetectedData): Promise<void> {
    try {
      logger.info('📢 [NOTIFICATIONS] Notifying claim detected', {
        userId,
        claimId: data.claimId,
        amount: data.amount
      });

      const event: NotificationEvent = {
        type: NotificationType.CLAIM_DETECTED,
        user_id: userId,
        title: '💰 New Claim Detected',
        message: `A potential reimbursement claim of ${data.currency || '$'}${data.amount.toFixed(2)} has been detected${data.orderId ? ` for order ${data.orderId}` : ''}.`,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: {
          claimId: data.claimId,
          amount: data.amount,
          currency: data.currency || 'usd',
          confidence: data.confidence,
          orderId: data.orderId,
          sku: data.sku
        },
        immediate: true
      };

      await notificationService.createNotification(event);

      // Also send via WebSocket for real-time delivery
      websocketService.sendNotificationToUser(userId, {
        type: 'success',
        title: '💰 New Claim Detected',
        message: `Claim of ${data.currency || '$'}${data.amount.toFixed(2)} detected${data.orderId ? ` for order ${data.orderId}` : ''}`,
        data: event.payload
      });

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify claim detected', {
        userId,
        error: error.message
      });
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

      let title = '📄 Evidence Document Found';
      let message = `Evidence document "${data.fileName}" has been ${data.parsed ? 'parsed and is ready' : 'ingested'}`;

      if (data.matchFound && data.disputeId) {
        title = '✅ Evidence Matched to Claim';
        message = `Evidence document "${data.fileName}" has been matched to your claim`;
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

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify evidence found', {
        userId,
        error: error.message
      });
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
        title: data.status === 'filed' ? '📋 Case Filed with Amazon' : '⏳ Case Filing in Progress',
        message: data.status === 'filed' 
          ? `Your dispute case for ${data.currency || '$'}${data.claimAmount.toFixed(2)} has been filed with Amazon${data.amazonCaseId ? ` (Case ID: ${data.amazonCaseId})` : ''}.`
          : `Your dispute case for ${data.currency || '$'}${data.claimAmount.toFixed(2)} is being filed with Amazon.`,
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

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify case filed', {
        userId,
        error: error.message
      });
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

      const event: NotificationEvent = {
        type: NotificationType.REFUND_APPROVED,
        user_id: userId,
        title: '✅ Refund Approved by Amazon',
        message: `Your refund request for ${data.currency || '$'}${approvedAmount.toFixed(2)} has been approved by Amazon${data.amazonCaseId ? ` (Case ID: ${data.amazonCaseId})` : ''}. We're now tracking the payout.`,
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
        title: '✅ Refund Approved by Amazon',
        message: `Your refund of ${data.currency || '$'}${approvedAmount.toFixed(2)} has been approved!`,
        data: event.payload
      });

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify refund approved', {
        userId,
        error: error.message
      });
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

      let title = '💰 Funds Deposited';
      let message = `Your refund of ${data.currency || '$'}${data.amount.toFixed(2)} has been deposited`;

      if (data.billingStatus === 'charged') {
        const platformFee = data.platformFee || (data.amount * 0.20);
        const sellerPayout = data.sellerPayout || (data.amount * 0.80);
        message += `. Platform fee (20%): ${data.currency || '$'}${platformFee.toFixed(2)}, Your payout: ${data.currency || '$'}${sellerPayout.toFixed(2)}`;
      }

      const event: NotificationEvent = {
        type: NotificationType.FUNDS_DEPOSITED,
        user_id: userId,
        title,
        message: message + '.',
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

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to notify funds deposited', {
        userId,
        error: error.message
      });
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
}

// Export singleton instance
const notificationHelper = new NotificationHelper();
export default notificationHelper;

