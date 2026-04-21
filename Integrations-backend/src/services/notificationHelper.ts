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
  tenantId: string;
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
  claimReadyCount?: number;
  reviewNeededCount?: number;
  monitoringCount?: number;
  caseNumber?: string;
}

export interface EvidenceFoundData {
  tenantId: string;
  documentId: string;
  source: 'gmail' | 'outlook' | 'drive' | 'dropbox' | 'unknown';
  fileName: string;
  parsed?: boolean;
  matchFound?: boolean;
  disputeId?: string;
  caseNumber?: string;
  amazonCaseId?: string;
  documentType?: string | null;
  documentLabel?: string | null;
  matchType?: string | null;
  matchedFields?: string[];
}

export interface CaseFiledData {
  tenantId: string;
  disputeId: string;
  caseId?: string;
  caseNumber?: string;
  amazonCaseId?: string;
  claimAmount: number;
  currency?: string;
  status: 'filed' | 'pending' | 'in_progress';
  syncId?: string;
}

export interface RefundApprovedData {
  tenantId: string;
  disputeId: string;
  amazonCaseId?: string;
  caseNumber?: string;
  claimAmount: number;
  currency?: string;
  approvedAmount?: number;
}

export interface FundsDepositedData {
  tenantId: string;
  disputeId: string;
  recoveryId?: string;
  amount: number;
  currency?: string;
  platformFee?: number;
  sellerPayout?: number;
  billingStatus?: 'charged' | 'credited' | 'pending' | 'sent';
  caseNumber?: string;
  payoutId?: string;
  payoutTruthSource?: 'recovery_reconciliation';
}

function formatMoney(amount: number | undefined, currency: string = 'USD'): string {
  const safeAmount = Number(amount || 0);
  const normalizedCurrency = String(currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency
    }).format(safeAmount);
  } catch {
    return `${normalizedCurrency} ${safeAmount.toFixed(2)}`;
  }
}

function compactIdentifier(value?: string | null, maxLength = 28): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength - 3)}...`;
}

function parentheticalIdentifier(value?: string | null): string {
  const compact = compactIdentifier(value);
  return compact ? `(${compact}) ` : '';
}

function humanizeToken(value?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizeRequestedDocumentLabel(value?: string | null): string | null {
  return humanizeToken(value) || compactIdentifier(value);
}

class NotificationHelper {
  private async resolveRecipients(targetId: string, tenantId: string): Promise<string[]> {
    const normalizedTargetId = String(targetId || '').trim();
    if (!normalizedTargetId) {
      return [];
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedTargetId);
    let userQuery = supabaseAdmin
      .from('users')
      .select('id');

    if (isUuid) {
      userQuery = userQuery.or(`id.eq.${normalizedTargetId},amazon_seller_id.eq.${normalizedTargetId}`);
    } else {
      userQuery = userQuery.eq('amazon_seller_id', normalizedTargetId);
    }

    const { data: candidateUsers, error: userError } = await userQuery;

    if (userError) {
      throw new Error(`RECIPIENT_LOOKUP_FAILED:${userError.message}`);
    }

    const candidateUserIds = Array.from(
      new Set((candidateUsers || []).map((row: any) => String(row.id || '').trim()).filter(Boolean))
    );

    if (candidateUserIds.length === 0) {
      return [];
    }

    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('user_id', candidateUserIds);

    if (membershipError) {
      throw new Error(`TENANT_MEMBERSHIP_LOOKUP_FAILED:${membershipError.message}`);
    }

    return Array.from(
      new Set((memberships || []).map((row: any) => String(row.user_id || '').trim()).filter(Boolean))
    );
  }

  private async dispatchNotification(
    targetId: string,
    event: Omit<NotificationEvent, 'user_id'>,
    trackingType: string
  ): Promise<void> {
    if (!event.tenant_id) {
      throw new Error('TENANT_REQUIRED');
    }

    const userIds = await this.resolveRecipients(targetId, event.tenant_id);

    if (userIds.length === 0) {
      logger.warn('Skipping notification - no valid recipient context', {
        targetId,
        tenantId: event.tenant_id,
        trackingType,
        notificationType: event.type,
        title: event.title
      });
      throw new Error('RECIPIENT_NOT_FOUND_FOR_TENANT');
    }

    for (const userId of userIds) {
      const notification = await notificationService.createNotification({
        ...event,
        user_id: userId,
        tenant_id: event.tenant_id
      });

      if (notification) {
        this._logDelivery(userId, trackingType, true);
      }
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
      const count = data.count || (data.claimId ? 1 : 0);
      const claimReadyCount = Number.isFinite(Number(data.claimReadyCount)) ? Number(data.claimReadyCount) : count;
      const reviewNeededCount = Number.isFinite(Number(data.reviewNeededCount)) ? Number(data.reviewNeededCount) : Math.max(count - claimReadyCount, 0);
      const amountLabel = formatMoney(amount, currency);
      const titleIdentifier = compactIdentifier(data.syncId) || (isBulk ? `${count} findings` : compactIdentifier(data.caseNumber || data.claimId));

      logger.info('📢 [NOTIFICATIONS] Notifying claim detected', {
        userId,
        isBulk,
        count,
        claimId: data.claimId,
        amount
      });

      const title = `${parentheticalIdentifier(titleIdentifier)}Recovery opportunities detected`.trim();
      const countSummary = count > 0 ? `${count} ${count === 1 ? 'finding' : 'findings'}` : 'A recovery finding';
      const valueSummary = amount > 0 ? `worth ${amountLabel}` : 'ready for review';
      const readinessSummary = [
        claimReadyCount > 0 ? `${claimReadyCount} claim-ready` : null,
        reviewNeededCount > 0 ? `${reviewNeededCount} review-needed` : null
      ].filter(Boolean).join(' · ');
      const message = `${countSummary} ${valueSummary}.${readinessSummary ? ` ${readinessSummary}.` : ''}${data.syncId ? ` Sync ${compactIdentifier(data.syncId, 20)} completed.` : ''}`;

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.CLAIM_DETECTED,
        tenant_id: data.tenantId,
        title,
        message,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.CLAIM_DETECTED, {
          claimId: data.claimId,
          count,
          amount,
          totalValue: amount,
          currency,
          confidence: data.confidence,
          orderId: data.orderId,
          sku: data.sku,
          isBulk,
          syncId: data.syncId,
          claimReadyCount,
          reviewNeededCount,
          monitoringCount: data.monitoringCount || 0,
          caseNumber: data.caseNumber,
          status: claimReadyCount > 0 ? 'claim_ready' : 'review_needed'
        }, {
          tenantId: data.tenantId,
          entityType: data.claimId ? 'detection_result' : 'unknown',
          entityId: data.claimId || data.syncId
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

      const documentLabel =
        normalizeRequestedDocumentLabel(data.documentLabel) ||
        normalizeRequestedDocumentLabel(data.documentType) ||
        compactIdentifier(data.fileName, 36) ||
        'Document';
      let title = `${parentheticalIdentifier(documentLabel)}Evidence found`.trim();
      let message = `Margin ingested ${data.fileName || 'a document'} from ${data.source || 'a connected source'} and is checking where it can help.`;

      if (data.matchFound && data.disputeId) {
        title = `${parentheticalIdentifier(documentLabel)}Evidence linked`.trim();
        message = `Margin linked this document to ${data.caseNumber ? `${data.caseNumber}` : 'a live case'} and recorded it for filing review.`;
      } else if (data.parsed) {
        title = `${parentheticalIdentifier(documentLabel)}Document parsed`.trim();
        message = `Margin parsed ${data.fileName || 'this document'} and updated the evidence record for matching.`;
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
          disputeId: data.disputeId,
          caseNumber: data.caseNumber,
          amazonCaseId: data.amazonCaseId,
          documentType: data.documentType,
          documentLabel,
          matchType: data.matchType,
          matchedFields: data.matchedFields
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

      const identifier = data.caseNumber || data.amazonCaseId || data.caseId || data.disputeId;
      const amountLabel = formatMoney(data.claimAmount, data.currency || 'USD');
      const title = data.status === 'filed'
        ? `${parentheticalIdentifier(identifier)}Filed`.trim()
        : data.status === 'in_progress'
          ? `${parentheticalIdentifier(identifier)}Queued for filing`.trim()
          : `${parentheticalIdentifier(identifier)}Preparing case`.trim();
      const message = data.status === 'filed'
        ? `Margin submitted this case to Amazon${data.amazonCaseId ? ` as ${data.amazonCaseId}` : ''}. Current tracked value: ${amountLabel}.`
        : data.status === 'in_progress'
          ? `Margin queued this case for Amazon filing once the submission worker reaches it.`
          : `Margin is preparing this case for filing and checking the final supporting record.`;

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.CASE_FILED,
        tenant_id: data.tenantId,
        title,
        message,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.CASE_FILED, {
          disputeId: data.disputeId,
          caseId: data.caseId,
          caseNumber: data.caseNumber,
          amazonCaseId: data.amazonCaseId,
          claimAmount: data.claimAmount,
          currency: data.currency || 'usd',
          status: data.status,
          syncId: data.syncId
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
      const identifier = data.caseNumber || data.amazonCaseId || data.disputeId;
      const amountLabel = formatMoney(approvedAmount, currency);

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.REFUND_APPROVED,
        tenant_id: data.tenantId,
        title: `${parentheticalIdentifier(identifier)}Approved`.trim(),
        message: `Amazon approved ${amountLabel} on this case. Margin is now tracking payout confirmation.`,
        priority: NotificationPriority.URGENT,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.REFUND_APPROVED, {
          disputeId: data.disputeId,
          amazonCaseId: data.amazonCaseId,
          caseNumber: data.caseNumber,
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
      if (!data.recoveryId || data.payoutTruthSource !== 'recovery_reconciliation') {
        logger.warn('Skipping funds deposited notification without recovery payout truth', {
          userId,
          disputeId: data.disputeId,
          recoveryId: data.recoveryId,
          payoutTruthSource: data.payoutTruthSource
        });
        return;
      }

      logger.info('📢 [NOTIFICATIONS] Notifying funds deposited', {
        userId,
        disputeId: data.disputeId,
        amount: data.amount
      });

      const currency = (data.currency || 'USD').toUpperCase();
      const formattedAmount = formatMoney(data.amount, currency);
      const identifier = data.caseNumber || data.payoutId || data.recoveryId || data.disputeId;
      const title = `${parentheticalIdentifier(identifier)}Payout confirmed`.trim();
      const message = `Amazon recorded ${formattedAmount} as deposited${data.payoutId ? ` under payout ${compactIdentifier(data.payoutId)}` : ''}. Margin is keeping the payout record in sync.`;

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.FUNDS_DEPOSITED,
        tenant_id: data.tenantId,
        title,
        message,
        priority: NotificationPriority.URGENT,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.FUNDS_DEPOSITED, {
          disputeId: data.disputeId,
          recoveryId: data.recoveryId,
          amount: data.amount,
          currency: data.currency || 'usd',
          sellerPayout: data.sellerPayout ?? data.amount,
          billingStatus: data.billingStatus,
          caseNumber: data.caseNumber,
          payoutId: data.payoutId,
          payoutTruthSource: data.payoutTruthSource,
          payout_truth_source: data.payoutTruthSource
        }, {
          tenantId: data.tenantId,
          entityType: 'recovery',
          entityId: data.recoveryId
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
      if (!tenantId) {
        throw new Error('TENANT_REQUIRED');
      }

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
  async notifyAmazonChallenge(userId: string, data: { tenantId: string; count?: number; disputeIds?: string[] }): Promise<void> {
    try {
      const count = data.count || (data.disputeIds ? data.disputeIds.length : 1);
      const title = count > 1 ? `Amazon Challenged ${count} Claims — Escalating` : `Amazon Challenged Claim — Escalating`;
      const message = `We’re reviewing their response and preparing counter-evidence.`;

      const event: Omit<NotificationEvent, 'user_id'> = {
        type: NotificationType.AMAZON_CHALLENGE,
        tenant_id: data.tenantId,
        title,
        message,
        priority: NotificationPriority.HIGH,
        channel: NotificationChannel.BOTH,
        payload: normalizeAgent10EventPayload(NotificationType.AMAZON_CHALLENGE, {
          count,
          disputeIds: data.disputeIds
        }, {
          tenantId: data.tenantId
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

