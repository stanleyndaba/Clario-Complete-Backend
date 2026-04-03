import { supabase, supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

type LaunchMetric = number | null;

export interface LaunchMonitorMetrics {
  agent7_ready_count: LaunchMetric;
  agent7_duplicate_blocked_count: LaunchMetric;
  agent7_insufficient_data_count: LaunchMetric;
  agent7_thread_only_count: LaunchMetric;
  agent7_pending_safety_verification_count: LaunchMetric;
  agent7_filed_count: LaunchMetric;
  agent7_needs_evidence_count: LaunchMetric;
  agent7_approved_count: LaunchMetric;
  agent7_rejected_count: LaunchMetric;
  agent7_paid_count: LaunchMetric;
  unmatched_amazon_email_count: LaunchMetric;
  notification_failed_count: LaunchMetric;
  notification_partial_count: LaunchMetric;
}

export interface LaunchMonitorAlert {
  key: 'duplicate_blocked_spike' | 'unmatched_amazon_email_spike' | 'notification_failure_present' | 'pending_safety_verification_backlog';
  label: string;
  severity: 'medium' | 'high';
  active: boolean | null;
  count: LaunchMetric;
  threshold: number | null;
  detail: string;
}

export interface LaunchMonitorEvent {
  id: string;
  event_type:
    | 'case_blocked'
    | 'case_filed'
    | 'amazon_thread_linked'
    | 'needs_evidence'
    | 'approved'
    | 'rejected'
    | 'paid'
    | 'notification_failed'
    | 'notification_partial'
    | 'unmatched_email_created';
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: string;
  dispute_case_id: string | null;
  amazon_case_id: string | null;
  notification_id: string | null;
  source_table: 'dispute_cases' | 'dispute_submissions' | 'unmatched_case_messages' | 'notifications';
  source_id: string;
  status: string | null;
}

export interface LaunchMonitorPayload {
  metrics: LaunchMonitorMetrics;
  alerts: LaunchMonitorAlert[];
  recent_events: LaunchMonitorEvent[] | null;
  last_updated_at: string | null;
}

type DisputeCaseMonitorRow = {
  id: string;
  case_number?: string | null;
  case_type?: string | null;
  amazon_case_id?: string | null;
  status?: string | null;
  filing_status?: string | null;
  eligibility_status?: string | null;
  case_state?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type DisputeSubmissionMonitorRow = {
  id: string;
  dispute_id?: string | null;
  amazon_case_id?: string | null;
  external_reference?: string | null;
  status?: string | null;
  outcome?: string | null;
  submission_channel?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type UnmatchedMessageMonitorRow = {
  id: string;
  amazon_case_id?: string | null;
  subject?: string | null;
  failure_reason?: string | null;
  link_status?: string | null;
  linked_dispute_case_id?: string | null;
  received_at?: string | null;
  resolved_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type NotificationMonitorRow = {
  id: string;
  type?: string | null;
  status?: string | null;
  title?: string | null;
  message?: string | null;
  last_delivery_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  payload?: Record<string, any> | null;
};

const DUPLICATE_BLOCKED_SPIKE_THRESHOLD = 3;
const UNMATCHED_EMAIL_SPIKE_THRESHOLD = 3;
const PENDING_SAFETY_BACKLOG_THRESHOLD = 3;
const RECENT_EVENT_SOURCE_LIMIT = 20;

function db() {
  return supabaseAdmin || supabase;
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function asIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function pickLatestTimestamp(...values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => asIsoTimestamp(value))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());

  return valid[0] || null;
}

function formatCaseReference(record: DisputeCaseMonitorRow): string {
  const caseNumber = String(record.case_number || '').trim();
  if (caseNumber) return `Case ${caseNumber}`;
  return `Case ${record.id.slice(0, 8)}`;
}

function formatCaseType(record: DisputeCaseMonitorRow): string {
  const raw = String(record.case_type || '').trim();
  if (!raw) return 'support case';
  return raw.replace(/_/g, ' ');
}

function isCaseFiled(record: DisputeCaseMonitorRow): boolean {
  const filingStatus = normalize(record.filing_status);
  const status = normalize(record.status);
  return filingStatus === 'filed' || status === 'submitted';
}

function isCaseApproved(record: DisputeCaseMonitorRow): boolean {
  const caseState = normalize(record.case_state);
  const status = normalize(record.status);
  return caseState === 'approved' || status === 'approved' || status === 'won';
}

function isCaseRejected(record: DisputeCaseMonitorRow): boolean {
  const caseState = normalize(record.case_state);
  const status = normalize(record.status);
  return caseState === 'rejected' || status === 'rejected' || status === 'denied' || status === 'lost';
}

function isCasePaid(record: DisputeCaseMonitorRow): boolean {
  return normalize(record.case_state) === 'paid';
}

export function buildMetricsFromCases(cases: DisputeCaseMonitorRow[] | null): Pick<
  LaunchMonitorMetrics,
  | 'agent7_ready_count'
  | 'agent7_duplicate_blocked_count'
  | 'agent7_insufficient_data_count'
  | 'agent7_thread_only_count'
  | 'agent7_pending_safety_verification_count'
  | 'agent7_filed_count'
  | 'agent7_needs_evidence_count'
  | 'agent7_approved_count'
  | 'agent7_rejected_count'
  | 'agent7_paid_count'
> {
  if (!cases) {
    return {
      agent7_ready_count: null,
      agent7_duplicate_blocked_count: null,
      agent7_insufficient_data_count: null,
      agent7_thread_only_count: null,
      agent7_pending_safety_verification_count: null,
      agent7_filed_count: null,
      agent7_needs_evidence_count: null,
      agent7_approved_count: null,
      agent7_rejected_count: null,
      agent7_paid_count: null
    };
  }

  return {
    agent7_ready_count: cases.filter((record) => normalize(record.eligibility_status) === 'ready').length,
    agent7_duplicate_blocked_count: cases.filter((record) => normalize(record.eligibility_status) === 'duplicate_blocked').length,
    agent7_insufficient_data_count: cases.filter((record) => normalize(record.eligibility_status) === 'insufficient_data').length,
    agent7_thread_only_count: cases.filter((record) => normalize(record.eligibility_status) === 'thread_only').length,
    agent7_pending_safety_verification_count: cases.filter((record) => normalize(record.filing_status) === 'pending_safety_verification').length,
    agent7_filed_count: cases.filter(isCaseFiled).length,
    agent7_needs_evidence_count: cases.filter((record) => normalize(record.case_state) === 'needs_evidence').length,
    agent7_approved_count: cases.filter(isCaseApproved).length,
    agent7_rejected_count: cases.filter(isCaseRejected).length,
    agent7_paid_count: cases.filter(isCasePaid).length
  };
}

export function buildBlockedEvents(cases: DisputeCaseMonitorRow[]): LaunchMonitorEvent[] {
  return cases
    .filter((record) => ['duplicate_blocked', 'insufficient_data', 'thread_only', 'safety_hold'].includes(normalize(record.eligibility_status)))
    .map((record) => {
      const eligibility = normalize(record.eligibility_status);
      const title =
        eligibility === 'duplicate_blocked'
          ? 'Duplicate detected - not filed'
          : eligibility === 'insufficient_data'
            ? 'Awaiting verified identifiers'
            : eligibility === 'thread_only'
              ? 'Amazon thread detected'
              : 'Safety hold';
      const detail =
        record.last_error ||
        `${formatCaseReference(record)} is currently held as ${eligibility.replace(/_/g, ' ')} for ${formatCaseType(record)}.`;
      return {
        id: `case_blocked:${record.id}`,
        event_type: 'case_blocked',
        title,
        detail,
        severity: eligibility === 'thread_only' ? 'low' : eligibility === 'duplicate_blocked' ? 'medium' : 'high',
        timestamp: asIsoTimestamp(record.updated_at || record.created_at) || new Date(0).toISOString(),
        dispute_case_id: record.id,
        amazon_case_id: record.amazon_case_id || null,
        notification_id: null,
        source_table: 'dispute_cases',
        source_id: record.id,
        status: record.eligibility_status || null
      };
    });
}

export function buildFiledEvents(submissions: DisputeSubmissionMonitorRow[]): LaunchMonitorEvent[] {
  return submissions.map((record) => ({
    id: `case_filed:${record.id}`,
    event_type: 'case_filed',
    title: 'Case filed with Amazon',
    detail: record.amazon_case_id
      ? `Amazon case ${record.amazon_case_id} was recorded through ${record.submission_channel || 'seller_central_chat'}.`
      : `A filing ledger entry was recorded through ${record.submission_channel || 'seller_central_chat'}.`,
    severity: 'low',
    timestamp: asIsoTimestamp(record.created_at || record.updated_at) || new Date(0).toISOString(),
    dispute_case_id: record.dispute_id || null,
    amazon_case_id: record.amazon_case_id || record.external_reference || null,
    notification_id: null,
    source_table: 'dispute_submissions',
    source_id: record.id,
    status: record.status || record.outcome || null
  }));
}

export function buildThreadLinkedEvents(messages: UnmatchedMessageMonitorRow[]): LaunchMonitorEvent[] {
  return messages
    .filter((record) => ['linked_existing_case', 'linked_placeholder_case'].includes(normalize(record.link_status)))
    .map((record) => ({
      id: `amazon_thread_linked:${record.id}`,
      event_type: 'amazon_thread_linked',
      title: 'Amazon thread linked',
      detail: record.link_status === 'linked_placeholder_case'
        ? `Amazon case ${record.amazon_case_id || 'unknown'} was linked by creating a placeholder dispute case.`
        : `Amazon case ${record.amazon_case_id || 'unknown'} was linked to an existing dispute case.`,
      severity: 'medium',
      timestamp: asIsoTimestamp(record.resolved_at || record.received_at || record.created_at) || new Date(0).toISOString(),
      dispute_case_id: record.linked_dispute_case_id || null,
      amazon_case_id: record.amazon_case_id || null,
      notification_id: null,
      source_table: 'unmatched_case_messages',
      source_id: record.id,
      status: record.link_status || null
    }));
}

export function buildUnmatchedEmailEvents(messages: UnmatchedMessageMonitorRow[]): LaunchMonitorEvent[] {
  return messages
    .filter((record) => normalize(record.link_status) === 'unmatched')
    .map((record) => ({
      id: `unmatched_email:${record.id}`,
      event_type: 'unmatched_email_created',
      title: 'Unmatched Amazon email detected',
      detail: record.subject
        ? `${record.subject} remains unmatched${record.failure_reason ? ` (${record.failure_reason.replace(/_/g, ' ')})` : ''}.`
        : `Amazon case ${record.amazon_case_id || 'unknown'} remains unmatched.`,
      severity: 'high',
      timestamp: asIsoTimestamp(record.received_at || record.created_at) || new Date(0).toISOString(),
      dispute_case_id: null,
      amazon_case_id: record.amazon_case_id || null,
      notification_id: null,
      source_table: 'unmatched_case_messages',
      source_id: record.id,
      status: record.failure_reason || record.link_status || null
    }));
}

export function buildNotificationEvents(notifications: NotificationMonitorRow[]): LaunchMonitorEvent[] {
  const interestingTypes = new Set(['needs_evidence', 'approved', 'rejected', 'paid']);

  return notifications
    .filter((record) => interestingTypes.has(normalize(record.type)) || ['failed', 'partial'].includes(normalize(record.status)))
    .map((record) => {
      const status = normalize(record.status);
      const type = normalize(record.type);
      const eventType =
        status === 'failed'
          ? 'notification_failed'
          : status === 'partial'
            ? 'notification_partial'
            : (type as LaunchMonitorEvent['event_type']);
      const title =
        status === 'failed'
          ? 'Notification delivery failed'
          : status === 'partial'
            ? 'Notification delivery partial'
            : type === 'needs_evidence'
              ? 'Amazon requested more evidence'
              : type === 'approved'
                ? 'Amazon approved a case'
                : type === 'rejected'
                  ? 'Amazon rejected a case'
                  : 'Amazon marked a case paid';
      const payloadCaseId = String(record.payload?.dispute_case_id || record.payload?.case_id || '').trim() || null;
      const payloadAmazonCaseId = String(record.payload?.amazon_case_id || record.payload?.case_number || '').trim() || null;
      return {
        id: `${eventType}:${record.id}`,
        event_type: eventType,
        title,
        detail: status === 'failed' || status === 'partial'
          ? record.last_delivery_error || record.message || 'Notification delivery needs attention.'
          : record.message || record.title || title,
        severity: status === 'failed' ? 'high' : status === 'partial' ? 'medium' : type === 'needs_evidence' ? 'high' : 'low',
        timestamp: asIsoTimestamp(record.created_at || record.updated_at) || new Date(0).toISOString(),
        dispute_case_id: payloadCaseId,
        amazon_case_id: payloadAmazonCaseId,
        notification_id: record.id,
        source_table: 'notifications',
        source_id: record.id,
        status: record.status || record.type || null
      };
    });
}

async function safeExactCount(label: string, execute: () => Promise<{ count: number | null; error: any }>): Promise<number | null> {
  try {
    const { count, error } = await execute();
    if (error) {
      logger.warn('[LAUNCH MONITOR] Count query failed', { label, error: error.message });
      return null;
    }
    return typeof count === 'number' ? count : 0;
  } catch (error: any) {
    logger.warn('[LAUNCH MONITOR] Count query threw', { label, error: error.message });
    return null;
  }
}

export function buildAlerts(
  metrics: LaunchMonitorMetrics,
  recentDuplicateBlockedCount: number | null,
  recentUnmatchedCount: number | null
): LaunchMonitorAlert[] {
  return [
    {
      key: 'duplicate_blocked_spike',
      label: 'Duplicate-blocked spike',
      severity: 'medium',
      active: recentDuplicateBlockedCount === null ? null : recentDuplicateBlockedCount >= DUPLICATE_BLOCKED_SPIKE_THRESHOLD,
      count: recentDuplicateBlockedCount,
      threshold: DUPLICATE_BLOCKED_SPIKE_THRESHOLD,
      detail: 'Recent duplicate-blocked cases suggest sellers may be re-attempting the same underlying issue.'
    },
    {
      key: 'unmatched_amazon_email_spike',
      label: 'Unmatched Amazon email spike',
      severity: 'high',
      active: recentUnmatchedCount === null ? null : recentUnmatchedCount >= UNMATCHED_EMAIL_SPIKE_THRESHOLD,
      count: recentUnmatchedCount,
      threshold: UNMATCHED_EMAIL_SPIKE_THRESHOLD,
      detail: 'Real Amazon thread emails are arriving without a linked dispute case and need operator attention.'
    },
    {
      key: 'notification_failure_present',
      label: 'Notification failure present',
      severity: 'high',
      active:
        metrics.notification_failed_count === null && metrics.notification_partial_count === null
          ? null
          : (metrics.notification_failed_count || 0) > 0 || (metrics.notification_partial_count || 0) > 0,
      count:
        metrics.notification_failed_count === null && metrics.notification_partial_count === null
          ? null
          : (metrics.notification_failed_count || 0) + (metrics.notification_partial_count || 0),
      threshold: 1,
      detail: 'At least one notification has failed or only partially delivered and should be reviewed.'
    },
    {
      key: 'pending_safety_verification_backlog',
      label: 'Pending safety verification backlog',
      severity: 'medium',
      active:
        metrics.agent7_pending_safety_verification_count === null
          ? null
          : metrics.agent7_pending_safety_verification_count >= PENDING_SAFETY_BACKLOG_THRESHOLD,
      count: metrics.agent7_pending_safety_verification_count,
      threshold: PENDING_SAFETY_BACKLOG_THRESHOLD,
      detail: 'Cases are waiting on verified identifiers or operator review before Amazon filing can proceed.'
    }
  ];
}

export async function getLaunchMonitor(tenantId: string, limit: number = 20): Promise<LaunchMonitorPayload> {
  const client = db();
  const eventLimit = Math.max(1, Math.min(limit, 50));
  const recentCutoff = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();

  const [
    disputeCasesResult,
    recentSubmissionsResult,
    recentUnmatchedResult,
    recentNotificationsResult,
    unmatchedCount,
    notificationFailedCount,
    notificationPartialCount,
    recentDuplicateBlockedCount,
    recentUnmatchedCount
  ] = await Promise.all([
    client
      .from('dispute_cases')
      .select('id, case_number, case_type, amazon_case_id, status, filing_status, eligibility_status, case_state, last_error, updated_at, created_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false }),
    client
      .from('dispute_submissions')
      .select('id, dispute_id, amazon_case_id, external_reference, status, outcome, submission_channel, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.max(eventLimit, RECENT_EVENT_SOURCE_LIMIT)),
    client
      .from('unmatched_case_messages')
      .select('id, amazon_case_id, subject, failure_reason, link_status, linked_dispute_case_id, received_at, resolved_at, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.max(eventLimit, RECENT_EVENT_SOURCE_LIMIT)),
    client
      .from('notifications')
      .select('id, type, status, title, message, last_delivery_error, created_at, updated_at, payload')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.max(eventLimit, RECENT_EVENT_SOURCE_LIMIT)),
    safeExactCount('unmatched_amazon_email_count', () =>
      client
        .from('unmatched_case_messages')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('link_status', 'unmatched')
    ),
    safeExactCount('notification_failed_count', () =>
      client
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'failed')
    ),
    safeExactCount('notification_partial_count', () =>
      client
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'partial')
    ),
    safeExactCount('duplicate_blocked_recent_count', () =>
      client
        .from('dispute_cases')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('eligibility_status', 'DUPLICATE_BLOCKED')
        .gte('updated_at', recentCutoff)
    ),
    safeExactCount('unmatched_recent_count', () =>
      client
        .from('unmatched_case_messages')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('link_status', 'unmatched')
        .gte('created_at', recentCutoff)
    )
  ]);

  const disputeCases = disputeCasesResult.error ? null : (disputeCasesResult.data as DisputeCaseMonitorRow[] | null) || [];
  if (disputeCasesResult.error) {
    logger.warn('[LAUNCH MONITOR] Failed to load dispute cases', { tenantId, error: disputeCasesResult.error.message });
  }

  const recentSubmissions = recentSubmissionsResult.error ? null : (recentSubmissionsResult.data as DisputeSubmissionMonitorRow[] | null) || [];
  if (recentSubmissionsResult.error) {
    logger.warn('[LAUNCH MONITOR] Failed to load dispute submissions', { tenantId, error: recentSubmissionsResult.error.message });
  }

  const recentUnmatchedMessages = recentUnmatchedResult.error ? null : (recentUnmatchedResult.data as UnmatchedMessageMonitorRow[] | null) || [];
  if (recentUnmatchedResult.error) {
    logger.warn('[LAUNCH MONITOR] Failed to load unmatched Amazon messages', { tenantId, error: recentUnmatchedResult.error.message });
  }

  const recentNotifications = recentNotificationsResult.error ? null : (recentNotificationsResult.data as NotificationMonitorRow[] | null) || [];
  if (recentNotificationsResult.error) {
    logger.warn('[LAUNCH MONITOR] Failed to load notifications', { tenantId, error: recentNotificationsResult.error.message });
  }

  const caseMetrics = buildMetricsFromCases(disputeCases);
  const metrics: LaunchMonitorMetrics = {
    ...caseMetrics,
    unmatched_amazon_email_count: unmatchedCount,
    notification_failed_count: notificationFailedCount,
    notification_partial_count: notificationPartialCount
  };

  const alerts = buildAlerts(metrics, recentDuplicateBlockedCount, recentUnmatchedCount);

  const recentEvents =
    disputeCases !== null &&
    recentSubmissions !== null &&
    recentUnmatchedMessages !== null &&
    recentNotifications !== null
      ? [
          ...buildBlockedEvents(disputeCases),
          ...buildFiledEvents(recentSubmissions),
          ...buildThreadLinkedEvents(recentUnmatchedMessages),
          ...buildUnmatchedEmailEvents(recentUnmatchedMessages),
          ...buildNotificationEvents(recentNotifications)
        ]
          .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
          .slice(0, eventLimit)
      : null;

  const lastUpdatedAt = pickLatestTimestamp(
    ...(disputeCases || []).flatMap((record) => [record.updated_at || null, record.created_at || null]),
    ...(recentSubmissions || []).flatMap((record) => [record.created_at || null, record.updated_at || null]),
    ...(recentUnmatchedMessages || []).flatMap((record) => [record.resolved_at || null, record.received_at || null, record.created_at || null]),
    ...(recentNotifications || []).flatMap((record) => [record.updated_at || null, record.created_at || null])
  );

  return {
    metrics,
    alerts,
    recent_events: recentEvents,
    last_updated_at: lastUpdatedAt
  };
}
