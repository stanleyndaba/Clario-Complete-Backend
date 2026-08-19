import crypto from 'crypto';
import { NotificationChannel, NotificationPriority, NotificationType } from './models/notification';

export const SYSTEM_SIGNAL_EVENT_TYPES = [
  'audit.completed_findings',
  'audit.completed_no_findings',
  'audit.data_incomplete',
  'audit.failed_action_required',
  'recovery.opportunity_identified',
  'recovery.reversal_detected',
  'evidence.package_ready',
  'evidence.certification_required',
  'case.approval_required',
  'case.amazon_response_received',
  'case.evidence_requested',
  'case.rejected',
  'filing.submitted',
  'filing.failed',
  'deadline.critical',
  'payout.confirmed',
  'payout.reversal_detected',
  'reconciliation.completed',
  'reconciliation.partial_match',
  'reconciliation.review_required',
  'reconciliation.unmatched',
  'reconciliation.processing_paused',
  'integration.amazon.authentication_invalid',
  'integration.amazon.sync_paused',
  'integration.amazon.restored',
  'integration.quickbooks.authentication_invalid',
  'integration.quickbooks.reconciliation_paused',
  'integration.quickbooks.restored',
  'integration.xero.authentication_invalid',
  'integration.xero.reconciliation_paused',
  'integration.xero.restored'
] as const;

export type SystemSignalEventType = typeof SYSTEM_SIGNAL_EVENT_TYPES[number];
export type SignalSeverity = 'critical' | 'action_required' | 'informational';
export type SignalSensitivity = 'operational_private' | 'financial_sensitive' | 'security_sensitive';
export type SignalProviderState = 'provider_outage' | 'seller_auth_failure' | 'business_outcome' | 'none';
export type SignalDeliveryPolicy = 'record_only' | 'realtime_record' | 'action_record' | 'critical_escalation' | 'digest_eligible';
export type SignalState = 'open' | 'resolved' | 'expired' | 'superseded' | 'cancelled';
export type SellerState = 'unseen' | 'seen' | 'read' | 'acknowledged';
export type SignalActionState = 'none' | 'pending' | 'completed' | 'no_longer_needed' | 'expired';
export type SignalActionType =
  | 'none'
  | 'review_audit'
  | 'review_recovery'
  | 'review_evidence'
  | 'certify_evidence'
  | 'approve_filing'
  | 'review_case'
  | 'review_deadline'
  | 'review_reconciliation'
  | 'reconnect_amazon';

export type SignalRouteTarget = 'notifications' | 'audit' | 'recovery' | 'evidence' | 'case' | 'deadline' | 'reconciliation' | 'integration';

export interface SignalActionRoute {
  target: SignalRouteTarget;
  objectType: string;
  objectId: string;
  action: SignalActionType;
  fallbackTarget: 'notifications';
}

export interface SystemSignalDefinition {
  eventType: SystemSignalEventType;
  domain: string;
  severity: SignalSeverity;
  sensitivity: SignalSensitivity;
  providerState: SignalProviderState;
  deliveryPolicy: SignalDeliveryPolicy;
  legacyNotificationType: NotificationType;
  legacyPriority: NotificationPriority;
  requestedChannel: NotificationChannel;
  actionType: SignalActionType;
  routeTarget: SignalRouteTarget;
  defaultPrivateTitle: string;
  defaultPrivateBody: string;
  defaultExternalTitle: string;
  defaultExternalBody: string;
}

const definition = (
  eventType: SystemSignalEventType,
  domain: string,
  severity: SignalSeverity,
  sensitivity: SignalSensitivity,
  providerState: SignalProviderState,
  deliveryPolicy: SignalDeliveryPolicy,
  legacyNotificationType: NotificationType,
  legacyPriority: NotificationPriority,
  requestedChannel: NotificationChannel,
  actionType: SignalActionType,
  routeTarget: SignalRouteTarget,
  defaultPrivateTitle: string,
  defaultPrivateBody: string,
  defaultExternalTitle: string,
  defaultExternalBody: string
): SystemSignalDefinition => ({
  eventType,
  domain,
  severity,
  sensitivity,
  providerState,
  deliveryPolicy,
  legacyNotificationType,
  legacyPriority,
  requestedChannel,
  actionType,
  routeTarget,
  defaultPrivateTitle,
  defaultPrivateBody,
  defaultExternalTitle,
  defaultExternalBody
});

/**
 * System Signals V1 policy registry. Producers may select only a known event type;
 * severity, sensitivity, delivery policy, legacy compatibility type, and external
 * copy defaults are intentionally centralized here.
 */
export const SYSTEM_SIGNAL_REGISTRY: Record<SystemSignalEventType, SystemSignalDefinition> = {
  'audit.completed_findings': definition('audit.completed_findings', 'audit', 'informational', 'financial_sensitive', 'business_outcome', 'realtime_record', NotificationType.CLAIM_DETECTED, NotificationPriority.NORMAL, NotificationChannel.IN_APP, 'review_audit', 'audit', 'Audit complete', 'Recovery findings are ready for review.', 'Audit complete', 'Your audit results are ready in Margin.'),
  'audit.completed_no_findings': definition('audit.completed_no_findings', 'audit', 'informational', 'operational_private', 'business_outcome', 'record_only', NotificationType.SYNC_COMPLETED, NotificationPriority.NORMAL, NotificationChannel.IN_APP, 'none', 'audit', 'Audit complete', 'Margin completed this audit with no supported findings.', 'Audit complete', 'An audit update is available in Margin.'),
  'audit.data_incomplete': definition('audit.data_incomplete', 'audit', 'action_required', 'operational_private', 'none', 'action_record', NotificationType.USER_ACTION_REQUIRED, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_audit', 'audit', 'Audit data is incomplete', 'Margin needs additional account data before this audit can continue.', 'Audit requires review', 'An audit requires your review in Margin.'),
  'audit.failed_action_required': definition('audit.failed_action_required', 'audit', 'action_required', 'operational_private', 'none', 'action_record', NotificationType.SYSTEM_ALERT, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_audit', 'audit', 'Audit requires review', 'This audit cannot continue until the listed issue is resolved.', 'Audit requires review', 'An audit requires your review in Margin.'),
  'recovery.opportunity_identified': definition('recovery.opportunity_identified', 'recovery', 'informational', 'financial_sensitive', 'business_outcome', 'digest_eligible', NotificationType.CLAIM_DETECTED, NotificationPriority.HIGH, NotificationChannel.IN_APP, 'review_recovery', 'recovery', 'Recovery opportunity identified', 'Margin identified a recovery opportunity that is ready for review.', 'Recovery update', 'A recovery update is available in Margin.'),
  'recovery.reversal_detected': definition('recovery.reversal_detected', 'recovery', 'critical', 'financial_sensitive', 'business_outcome', 'critical_escalation', NotificationType.SYSTEM_ALERT, NotificationPriority.URGENT, NotificationChannel.BOTH, 'review_recovery', 'recovery', 'Recovery reversal detected', 'A recovery record changed and requires review.', 'Recovery action required', 'A recovery requires your review in Margin.'),
  'evidence.package_ready': definition('evidence.package_ready', 'evidence', 'informational', 'operational_private', 'business_outcome', 'digest_eligible', NotificationType.EVIDENCE_FOUND, NotificationPriority.NORMAL, NotificationChannel.IN_APP, 'review_evidence', 'evidence', 'Evidence prepared', 'An evidence package is ready to review.', 'Evidence prepared', 'Evidence is ready in Margin.'),
  'evidence.certification_required': definition('evidence.certification_required', 'evidence', 'action_required', 'financial_sensitive', 'business_outcome', 'action_record', NotificationType.NEEDS_EVIDENCE, NotificationPriority.HIGH, NotificationChannel.BOTH, 'certify_evidence', 'case', 'Evidence certification required', 'Evidence is ready for your certification.', 'Evidence requires review', 'Evidence requires your review in Margin.'),
  'case.approval_required': definition('case.approval_required', 'case', 'action_required', 'financial_sensitive', 'business_outcome', 'action_record', NotificationType.USER_ACTION_REQUIRED, NotificationPriority.HIGH, NotificationChannel.BOTH, 'approve_filing', 'case', 'Approval required', 'This case is ready for your filing decision.', 'Case requires review', 'A case requires your review in Margin.'),
  'case.amazon_response_received': definition('case.amazon_response_received', 'case', 'informational', 'financial_sensitive', 'business_outcome', 'realtime_record', NotificationType.AMAZON_CHALLENGE, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_case', 'case', 'Amazon response received', 'A case response is ready for review.', 'Case update', 'A case update is available in Margin.'),
  'case.evidence_requested': definition('case.evidence_requested', 'case', 'action_required', 'financial_sensitive', 'business_outcome', 'action_record', NotificationType.NEEDS_EVIDENCE, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_evidence', 'case', 'Evidence required', 'Amazon requested additional evidence for this case.', 'Case requires review', 'A case requires your review in Margin.'),
  'case.rejected': definition('case.rejected', 'case', 'action_required', 'financial_sensitive', 'business_outcome', 'action_record', NotificationType.REJECTED, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_case', 'case', 'Case requires review', 'Amazon rejected this case. Review the current case status.', 'Case requires review', 'A case requires your review in Margin.'),
  'filing.submitted': definition('filing.submitted', 'filing', 'informational', 'financial_sensitive', 'business_outcome', 'digest_eligible', NotificationType.CASE_FILED, NotificationPriority.HIGH, NotificationChannel.IN_APP, 'review_case', 'case', 'Filing submitted', 'Margin submitted this case for Amazon review.', 'Filing submitted', 'A filing update is available in Margin.'),
  'filing.failed': definition('filing.failed', 'filing', 'critical', 'financial_sensitive', 'business_outcome', 'critical_escalation', NotificationType.SYSTEM_ALERT, NotificationPriority.URGENT, NotificationChannel.BOTH, 'review_case', 'case', 'Filing failed', 'Margin could not complete this filing. Review the case to continue.', 'Filing requires review', 'A filing requires your review in Margin.'),
  'deadline.critical': definition('deadline.critical', 'deadline', 'critical', 'financial_sensitive', 'business_outcome', 'critical_escalation', NotificationType.CLAIM_EXPIRING, NotificationPriority.URGENT, NotificationChannel.BOTH, 'review_deadline', 'recovery', 'Claim deadline requires attention', 'This recovery deadline requires immediate review.', 'Recovery deadline requires review', 'A recovery deadline requires your review in Margin.'),
  'payout.confirmed': definition('payout.confirmed', 'payout', 'informational', 'financial_sensitive', 'business_outcome', 'digest_eligible', NotificationType.FUNDS_DEPOSITED, NotificationPriority.URGENT, NotificationChannel.IN_APP, 'review_recovery', 'recovery', 'Payout confirmed', 'Margin matched a payout record to this recovery.', 'Recovery payout confirmed', 'A payout update is available in Margin.'),
  'payout.reversal_detected': definition('payout.reversal_detected', 'payout', 'critical', 'financial_sensitive', 'business_outcome', 'critical_escalation', NotificationType.SYSTEM_ALERT, NotificationPriority.URGENT, NotificationChannel.BOTH, 'review_recovery', 'recovery', 'Payout reversal detected', 'A payout record changed and requires review.', 'Recovery action required', 'A recovery requires your review in Margin.'),
  'reconciliation.completed': definition('reconciliation.completed', 'reconciliation', 'informational', 'financial_sensitive', 'business_outcome', 'digest_eligible', NotificationType.PAYMENT_PROCESSED, NotificationPriority.NORMAL, NotificationChannel.IN_APP, 'review_reconciliation', 'recovery', 'Recovery reconciled', 'Margin matched the recovery to an accounting record.', 'Reconciliation complete', 'A reconciliation result is available in Margin.'),
  'reconciliation.partial_match': definition('reconciliation.partial_match', 'reconciliation', 'action_required', 'financial_sensitive', 'business_outcome', 'action_record', NotificationType.USER_ACTION_REQUIRED, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_reconciliation', 'recovery', 'Recovery reconciliation requires review', 'Multiple accounting records may match this recovery.', 'Recovery action required', 'A recovery requires your review in Margin.'),
  'reconciliation.review_required': definition('reconciliation.review_required', 'reconciliation', 'action_required', 'financial_sensitive', 'business_outcome', 'action_record', NotificationType.USER_ACTION_REQUIRED, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_reconciliation', 'recovery', 'Recovery reconciliation requires review', 'Margin needs a decision on this reconciliation result.', 'Recovery action required', 'A recovery requires your review in Margin.'),
  'reconciliation.unmatched': definition('reconciliation.unmatched', 'reconciliation', 'informational', 'financial_sensitive', 'business_outcome', 'record_only', NotificationType.DISCREPANCY_FOUND, NotificationPriority.NORMAL, NotificationChannel.IN_APP, 'review_reconciliation', 'recovery', 'No credible accounting match found', 'Margin completed the search and found no supported accounting match.', 'Reconciliation result', 'A reconciliation result is available in Margin.'),
  'reconciliation.processing_paused': definition('reconciliation.processing_paused', 'reconciliation', 'action_required', 'financial_sensitive', 'provider_outage', 'action_record', NotificationType.SYSTEM_ALERT, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_reconciliation', 'recovery', 'Reconciliation is paused', 'Margin cannot continue this reconciliation until the accounting connection is available.', 'Reconciliation requires review', 'A reconciliation requires your review in Margin.'),
  'integration.amazon.authentication_invalid': definition('integration.amazon.authentication_invalid', 'integration', 'critical', 'security_sensitive', 'seller_auth_failure', 'critical_escalation', NotificationType.SYSTEM_ALERT, NotificationPriority.HIGH, NotificationChannel.BOTH, 'reconnect_amazon', 'integration', 'Amazon connection requires attention', 'Recovery monitoring is paused until Amazon access is restored.', 'Amazon connection requires attention', 'Reconnect securely in Margin to resume updates.'),
  'integration.amazon.sync_paused': definition('integration.amazon.sync_paused', 'integration', 'action_required', 'operational_private', 'none', 'action_record', NotificationType.SYSTEM_ALERT, NotificationPriority.HIGH, NotificationChannel.BOTH, 'reconnect_amazon', 'integration', 'Amazon sync is paused', 'Margin cannot refresh Amazon records until the connection is available.', 'Amazon connection requires review', 'An Amazon connection requires your review in Margin.'),
  'integration.amazon.restored': definition('integration.amazon.restored', 'integration', 'informational', 'operational_private', 'none', 'realtime_record', NotificationType.INTEGRATION_COMPLETED, NotificationPriority.NORMAL, NotificationChannel.IN_APP, 'none', 'integration', 'Amazon connection restored', 'Margin can refresh Amazon records again.', 'Amazon connection restored', 'Amazon updates have resumed in Margin.'),
  'integration.quickbooks.authentication_invalid': definition('integration.quickbooks.authentication_invalid', 'integration', 'critical', 'security_sensitive', 'seller_auth_failure', 'critical_escalation', NotificationType.SYSTEM_ALERT, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_reconciliation', 'integration', 'QuickBooks connection requires attention', 'Accounting reconciliation is paused until QuickBooks access is restored.', 'QuickBooks connection requires attention', 'Reconnect securely in Margin to resume reconciliation.'),
  'integration.quickbooks.reconciliation_paused': definition('integration.quickbooks.reconciliation_paused', 'integration', 'action_required', 'financial_sensitive', 'provider_outage', 'action_record', NotificationType.SYSTEM_ALERT, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_reconciliation', 'integration', 'QuickBooks reconciliation is paused', 'Margin cannot continue accounting reconciliation until QuickBooks is available.', 'QuickBooks reconciliation requires review', 'A reconciliation requires your review in Margin.'),
  'integration.quickbooks.restored': definition('integration.quickbooks.restored', 'integration', 'informational', 'operational_private', 'none', 'realtime_record', NotificationType.INTEGRATION_COMPLETED, NotificationPriority.NORMAL, NotificationChannel.IN_APP, 'none', 'integration', 'QuickBooks connection restored', 'Accounting reconciliation can continue.', 'QuickBooks connection restored', 'Accounting reconciliation can continue in Margin.'),
  'integration.xero.authentication_invalid': definition('integration.xero.authentication_invalid', 'integration', 'critical', 'security_sensitive', 'seller_auth_failure', 'critical_escalation', NotificationType.SYSTEM_ALERT, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_reconciliation', 'integration', 'Xero connection requires attention', 'Accounting reconciliation is paused until Xero access is restored.', 'Xero connection requires attention', 'Reconnect securely in Margin to resume reconciliation.'),
  'integration.xero.reconciliation_paused': definition('integration.xero.reconciliation_paused', 'integration', 'action_required', 'financial_sensitive', 'provider_outage', 'action_record', NotificationType.SYSTEM_ALERT, NotificationPriority.HIGH, NotificationChannel.BOTH, 'review_reconciliation', 'integration', 'Xero reconciliation is paused', 'Margin cannot continue accounting reconciliation until Xero is available.', 'Xero reconciliation requires review', 'A reconciliation requires your review in Margin.'),
  'integration.xero.restored': definition('integration.xero.restored', 'integration', 'informational', 'operational_private', 'none', 'realtime_record', NotificationType.INTEGRATION_COMPLETED, NotificationPriority.NORMAL, NotificationChannel.IN_APP, 'none', 'integration', 'Xero connection restored', 'Accounting reconciliation can continue.', 'Xero connection restored', 'Accounting reconciliation can continue in Margin.')
};

export function isSystemSignalEventType(value: string): value is SystemSignalEventType {
  return (SYSTEM_SIGNAL_EVENT_TYPES as readonly string[]).includes(value);
}

export function getSystemSignalDefinition(eventType: SystemSignalEventType): SystemSignalDefinition {
  return SYSTEM_SIGNAL_REGISTRY[eventType];
}

export function buildSignalDedupeKey(input: {
  eventType: SystemSignalEventType;
  tenantId: string;
  recipientUserId: string;
  objectType: string;
  objectId: string;
  businessTransitionKey: string;
  policyWindowKey?: string;
}): string {
  const canonical = [
    input.eventType,
    input.tenantId,
    input.recipientUserId,
    input.objectType,
    input.objectId,
    input.businessTransitionKey,
    input.policyWindowKey || ''
  ].map((part) => String(part || '').trim()).join('|');

  return `ss1:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

export function createActionRoute(
  definition: SystemSignalDefinition,
  objectType: string,
  objectId: string,
  overrideAction?: SignalActionType
): SignalActionRoute {
  return {
    target: definition.routeTarget,
    objectType,
    objectId,
    action: overrideAction || definition.actionType,
    fallbackTarget: 'notifications'
  };
}

export function renderSystemSignalCopy(
  definition: SystemSignalDefinition,
  overrides: Partial<Pick<SystemSignalDefinition, 'defaultPrivateTitle' | 'defaultPrivateBody' | 'defaultExternalTitle' | 'defaultExternalBody'>> = {}
) {
  return {
    privateTitle: overrides.defaultPrivateTitle || definition.defaultPrivateTitle,
    privateBody: overrides.defaultPrivateBody || definition.defaultPrivateBody,
    externalTitle: overrides.defaultExternalTitle || definition.defaultExternalTitle,
    externalBody: overrides.defaultExternalBody || definition.defaultExternalBody
  };
}

export function toLegacyNotificationPriority(severity: SignalSeverity): NotificationPriority {
  if (severity === 'critical') return NotificationPriority.URGENT;
  if (severity === 'action_required') return NotificationPriority.HIGH;
  return NotificationPriority.NORMAL;
}
