import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import { ensureAuthenticatedUserWorkspace } from './userWorkspaceBootstrap';
import { syncJobManager } from './syncJobManager';
import enhancedDetectionService from './enhancedDetectionService';
import logger from '../utils/logger';
import workspaceEntitlementService from './workspaceEntitlementService';
import { withPostgresTransaction } from '../database/postgresTransaction';

type AuditRunStatus =
  | 'created'
  | 'amazon_connection_required'
  | 'syncing'
  | 'detecting'
  | 'completed'
  | 'failed'
  | 'activated';

type AuditSummary = {
  scopeValue: number;
  findingsCount: number;
  categories: string[];
  evidenceReadyCount: number;
  locked: boolean;
  message: string;
  finalStatus?: 'complete_with_findings' | 'complete_no_findings' | 'partial_with_findings' | 'partial_no_findings' | 'failed';
  recordsReviewed?: number;
  sourcesReviewed?: string[];
  sourcesUnavailable?: string[];
  retryable?: boolean;
};

const EMPTY_SUMMARY: AuditSummary = {
  scopeValue: 0,
  findingsCount: 0,
  categories: [],
  evidenceReadyCount: 0,
  locked: true,
  message: 'Connect Amazon to run your free recovery audit.'
};

const SYNC_BACKLOG_SUMMARY: AuditSummary = {
  scopeValue: 0,
  findingsCount: 0,
  categories: [],
  evidenceReadyCount: 0,
  locked: true,
  message: 'Amazon is connected. Margin will resume the audit when sync capacity is available.'
};

const SYNC_IN_PROGRESS_SUMMARY: AuditSummary = {
  scopeValue: 0,
  findingsCount: 0,
  categories: [],
  evidenceReadyCount: 0,
  locked: true,
  message: 'Amazon data is still syncing. Continue the audit again once the sync finishes.'
};

const SAFE_AUDIT_FAILURE_SUMMARY: AuditSummary = {
  scopeValue: 0,
  findingsCount: 0,
  categories: [],
  evidenceReadyCount: 0,
  locked: true,
  message: 'Margin could not complete the audit automatically. Retry after the Amazon connection settles.'
};

function isTemporarySyncAdmissionBlock(error: any) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('sync temporarily paused') ||
    message.includes('downstream backlog') ||
    message.includes('filing_circuit_breaker_open') ||
    message.includes('capacity_blocked') ||
    message.includes('operator_disabled');
}

function isUnsafePipelineMessage(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('supabase') ||
    normalized.includes('duplicate key') ||
    normalized.includes('constraint') ||
    normalized.includes('is not a function') ||
    normalized.includes('typeerror') ||
    normalized.includes('syntaxerror') ||
    normalized.includes('pipeline failed');
}

function safeFailureSummary(message?: string | null): AuditSummary {
  if (!message || isUnsafePipelineMessage(message)) {
    return SAFE_AUDIT_FAILURE_SUMMARY;
  }

  return {
    ...SAFE_AUDIT_FAILURE_SUMMARY,
    message
  };
}

function isRetryableSyncFailure(syncStatus: any): boolean {
  const details = [
    syncStatus?.current_step,
    syncStatus?.error_code,
    typeof syncStatus?.error_details === 'string' ? syncStatus.error_details : JSON.stringify(syncStatus?.error_details || {}),
    typeof syncStatus?.metadata === 'string' ? syncStatus.metadata : JSON.stringify(syncStatus?.metadata || {})
  ].join(' ').toLowerCase();

  return details.includes('access to requested resource is denied') ||
    details.includes('temporary issue while updating your amazon records') ||
    details.includes('sync timeout') ||
    details.includes('timeout');
}

function getCountedValue(row: any): number {
  const countedValue = row?.evidence?.economic_rollup?.counted_value;
  return typeof countedValue === 'number' && Number.isFinite(countedValue)
    ? countedValue
    : Number(row?.estimated_value || 0);
}

function normalizeCategory(row: any): string {
  return String(row?.coverage_family || row?.detector_key || row?.anomaly_type || 'Recovery finding')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberFrom(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getSyncMetadata(syncStatus: any): Record<string, any> {
  if (!syncStatus?.metadata) return {};
  if (typeof syncStatus.metadata === 'string') {
    try {
      return JSON.parse(syncStatus.metadata);
    } catch {
      return {};
    }
  }
  return syncStatus.metadata;
}

function getRecordsReviewedFromMetadata(metadata: Record<string, any>): number {
  const explicitTotal = numberFrom(metadata.totalItemsSynced);
  if (explicitTotal > 0) return explicitTotal;

  return [
    metadata.ordersProcessed,
    metadata.totalOrders,
    metadata.inventoryCount,
    metadata.shipmentsCount,
    metadata.returnsCount,
    metadata.settlementsCount,
    metadata.feesCount
  ].reduce((sum, value) => sum + numberFrom(value), 0);
}

function sanitizeStatus(value: unknown): string {
  return String(value || 'unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function monthKey(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safe.getUTCFullYear()}-${String(safe.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return safe.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function auditHistoryLabel(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return safe.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

function nextScheduleRun(input: {
  cadence: string;
  preferredDayOfWeek?: number | null;
  preferredDayOfMonth?: number | null;
  preferredTime?: string | null;
  timezone?: string | null;
  from?: Date;
}): string | null {
  if (input.cadence === 'off') return null;
  const timezone = normalizeTimezone(input.timezone);
  const [hourRaw, minuteRaw] = String(input.preferredTime || '09:00').split(':');
  const hour = Math.min(Math.max(Number(hourRaw) || 9, 0), 23);
  const minute = Math.min(Math.max(Number(minuteRaw) || 0, 0), 59);
  const from = input.from || new Date();
  const local = getZonedParts(from, timezone);

  if (input.cadence === 'weekly' || input.cadence === 'biweekly') {
    const desiredDow = Number.isInteger(input.preferredDayOfWeek) ? Number(input.preferredDayOfWeek) : 1;
    for (let offset = 0; offset <= 21; offset++) {
      const localCandidate = addUtcDays(new Date(Date.UTC(local.year, local.month - 1, local.day)), offset);
      const candidateParts = getZonedParts(localCandidate, timezone);
      if (candidateParts.weekday !== desiredDow) continue;
      const candidate = wallTimeToUtc(candidateParts.year, candidateParts.month, candidateParts.day, hour, minute, timezone);
      if (candidate > from) return candidate.toISOString();
      const fallback = wallTimeToUtc(candidateParts.year, candidateParts.month, candidateParts.day + (input.cadence === 'biweekly' ? 14 : 7), hour, minute, timezone);
      return fallback.toISOString();
    }
  }

  const desiredDom = Math.min(Math.max(Number(input.preferredDayOfMonth) || 1, 1), 28);
  let candidate = wallTimeToUtc(local.year, local.month, desiredDom, hour, minute, timezone);
  if (candidate <= from) {
    const nextMonth = local.month === 12 ? 1 : local.month + 1;
    const nextYear = local.month === 12 ? local.year + 1 : local.year;
    candidate = wallTimeToUtc(nextYear, nextMonth, desiredDom, hour, minute, timezone);
  }
  return candidate.toISOString();
}

function normalizeTimezone(timezone?: string | null): string {
  const value = String(timezone || 'Africa/Johannesburg').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error('Invalid timezone');
  }
}

function getZonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour === '24' ? '0' : values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: weekdayMap[values.weekday] ?? 0,
  };
}

function wallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const parts = getZonedParts(naive, timezone);
  const actualAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  return new Date(naive.getTime() + (desiredAsUtc - actualAsUtc));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

class AuditRunService {
  private async getWorkspace(userId: string, email?: string | null) {
    return ensureAuthenticatedUserWorkspace({ userId, email });
  }

  private async getAmazonConnection(userId: string, tenantId: string) {
    const safeUserId = convertUserIdToUuid(userId);
    const { data } = await supabaseAdmin
      .from('tokens')
      .select('id, store_id, expires_at')
      .eq('user_id', safeUserId)
      .eq('tenant_id', tenantId)
      .eq('provider', 'amazon')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.id) return null;
    if (data.expires_at && new Date(data.expires_at) <= new Date()) return null;
    return data;
  }

  async startAudit(userId: string, email?: string | null): Promise<{
    audit: any;
    tenant: any;
    amazonConnected: boolean;
  }> {
    const workspace = await this.getWorkspace(userId, email);
    const connection = await this.getAmazonConnection(workspace.userId, workspace.tenant.id);
    const status: AuditRunStatus = connection ? 'created' : 'amazon_connection_required';

    const { data: latestAudit } = await supabaseAdmin
      .from('audit_runs')
      .select('*')
      .eq('user_id', workspace.userId)
      .eq('tenant_id', workspace.tenant.id)
      .neq('activation_status', 'activated')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestAudit && ['created', 'amazon_connection_required', 'syncing', 'detecting', 'completed', 'failed'].includes(latestAudit.status)) {
      const shouldResumeFailedAudit =
        latestAudit.status === 'failed' &&
        String(latestAudit.summary?.message || '').toLowerCase().includes('sync');

      if (latestAudit.status !== 'failed' || shouldResumeFailedAudit) {
        const resumedAudit = shouldResumeFailedAudit
          ? await this.updateAudit(latestAudit.id, {
              status,
              store_id: connection?.store_id || latestAudit.store_id || null,
              summary: connection ? SYNC_BACKLOG_SUMMARY : EMPTY_SUMMARY
            })
          : latestAudit;

        return {
          audit: resumedAudit,
          tenant: workspace.tenant,
          amazonConnected: Boolean(connection)
        };
      }
    }

    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .insert({
        user_id: workspace.userId,
        tenant_id: workspace.tenant.id,
        store_id: connection?.store_id || null,
        status,
        source_type: 'sp_api',
        summary: EMPTY_SUMMARY,
        activation_status: 'not_activated'
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create audit run: ${error?.message || 'Unknown error'}`);
    }

    return {
      audit: data,
      tenant: workspace.tenant,
      amazonConnected: Boolean(connection)
    };
  }

  async getAudit(auditId: string, userId: string) {
    const safeUserId = convertUserIdToUuid(userId);
    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .select('*')
      .eq('id', auditId)
      .eq('user_id', safeUserId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load audit run: ${error.message}`);
    if (!data) throw new Error('Audit run not found');
    return data;
  }

  async getLatestAudit(userId: string) {
    const safeUserId = convertUserIdToUuid(userId);
    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .select('*')
      .eq('user_id', safeUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Failed to load latest audit run: ${error.message}`);
    return data || null;
  }

  async getAuditHistory(userId: string, limit = 18) {
    const safeUserId = convertUserIdToUuid(userId);
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 18);
    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .select('id, tenant_id, store_id, sync_id, status, source_type, started_at, completed_at, created_at, updated_at, summary, activation_status')
      .eq('user_id', safeUserId)
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));

    if (error) throw new Error(`Failed to load audit history: ${error.message}`);

    return (data || []).map((audit, index) => {
      const timestamp = audit.completed_at || audit.started_at || audit.created_at;
      return {
        id: audit.id,
        month: monthKey(timestamp),
        monthLabel: monthLabel(timestamp),
        label: auditHistoryLabel(timestamp),
        status: audit.status,
        finalStatus: audit.summary?.finalStatus || null,
        created_at: audit.created_at,
        completed_at: audit.completed_at,
        recordsReviewed: audit.summary?.recordsReviewed ?? null,
        findingsCount: audit.summary?.findingsCount ?? 0,
        scopeValue: audit.summary?.scopeValue ?? 0,
        isLatest: index === 0,
      };
    });
  }

  async runAudit(auditId: string, userId: string) {
    const audit = await this.getAudit(auditId, userId);
    const connection = await this.getAmazonConnection(audit.user_id, audit.tenant_id);

    if (!connection) {
      const updated = await this.updateAudit(audit.id, {
        status: 'amazon_connection_required',
        summary: EMPTY_SUMMARY
      });
      return updated;
    }

    if (!audit.sync_id) {
      try {
        const sync = await syncJobManager.startSync(audit.user_id, audit.tenant_id, connection.store_id || undefined);
        return this.updateAudit(audit.id, {
          status: 'syncing',
          sync_id: sync.syncId,
          store_id: connection.store_id || null,
          summary: {
            ...EMPTY_SUMMARY,
            message: 'Amazon data sync started. Margin is preparing your recovery audit.'
          }
        });
      } catch (error: any) {
        const existingSync = String(error?.message || '').match(/\((sync_[^)]+)\)/)?.[1];
        if (existingSync) {
          return this.updateAudit(audit.id, {
            status: 'syncing',
            sync_id: existingSync,
            store_id: connection.store_id || null
          });
        }

        logger.warn('[AUDIT] Failed to start Amazon sync', { auditId, userId: audit.user_id, error: error?.message });
        if (isTemporarySyncAdmissionBlock(error)) {
          return this.updateAudit(audit.id, {
            status: 'created',
            store_id: connection.store_id || null,
            summary: SYNC_BACKLOG_SUMMARY
          });
        }

        return this.updateAudit(audit.id, {
          status: 'failed',
          summary: {
            ...EMPTY_SUMMARY,
            message: error?.message || 'Amazon sync could not be started.'
          }
        });
      }
    }

    const syncStatus = await this.getSyncStatus(audit.sync_id, audit.user_id, audit.tenant_id, audit.store_id);
    if (!syncStatus || ['running', 'in_progress', 'detecting'].includes(String(syncStatus.status || '').toLowerCase())) {
      return this.updateAudit(audit.id, {
        status: 'syncing',
        summary: SYNC_IN_PROGRESS_SUMMARY
      });
    }

    if (['failed', 'cancelled'].includes(String(syncStatus.status || '').toLowerCase())) {
      if (isRetryableSyncFailure(syncStatus)) {
        try {
          const sync = await syncJobManager.startSync(audit.user_id, audit.tenant_id, connection.store_id || undefined);
          return this.updateAudit(audit.id, {
            status: 'syncing',
            sync_id: sync.syncId,
            store_id: connection.store_id || null,
            summary: {
              ...SYNC_IN_PROGRESS_SUMMARY,
              message: 'Margin restarted the Amazon data sync and is rebuilding the audit.'
            }
          });
        } catch (error: any) {
          logger.warn('[AUDIT] Failed to restart audit sync after retryable failure', {
            auditId: audit.id,
            syncId: audit.sync_id,
            userId: audit.user_id,
            error: error?.message
          });
          if (isTemporarySyncAdmissionBlock(error)) {
            return this.updateAudit(audit.id, {
              status: 'created',
              summary: SYNC_BACKLOG_SUMMARY
            });
          }
        }
      }

      return this.updateAudit(audit.id, {
        status: 'failed',
        summary: safeFailureSummary(syncStatus.current_step || syncStatus.error_code || 'Amazon sync did not complete.')
      });
    }

    await this.updateAudit(audit.id, { status: 'detecting' });
    const result = await enhancedDetectionService.triggerDetectionPipeline(
      audit.user_id,
      audit.sync_id,
      'manual',
      { tenantId: audit.tenant_id, source: 'audit_run', auditRunId: audit.id }
    );

    if (!result.success) {
      return this.updateAudit(audit.id, {
        status: 'failed',
        summary: safeFailureSummary(result.message || 'Detection could not be completed.')
      });
    }

    const summary = await this.buildSummary(audit.user_id, audit.tenant_id, audit.sync_id, syncStatus);
    return this.updateAudit(audit.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      summary
    });
  }

  async getResults(auditId: string, userId: string) {
    const audit = await this.getAudit(auditId, userId);
    const syncStatus = audit.sync_id
      ? await this.getSyncStatus(audit.sync_id, audit.user_id, audit.tenant_id, audit.store_id)
      : null;
    const summary = audit.status === 'completed' && audit.sync_id
      ? await this.buildSummary(audit.user_id, audit.tenant_id, audit.sync_id, syncStatus)
      : (audit.summary || EMPTY_SUMMARY);

    if (audit.status === 'completed') {
      await this.updateAudit(audit.id, { summary });
    }

    return {
      audit: {
        id: audit.id,
        status: audit.status,
        activation_status: audit.activation_status,
        sync_id: audit.sync_id,
        started_at: audit.started_at,
        completed_at: audit.completed_at
      },
      teaser: {
        ...summary,
        locked: audit.activation_status !== 'activated',
        activationRequired: audit.activation_status !== 'activated'
      }
    };
  }

  async getExportSummary(auditId: string, userId: string) {
    const audit = await this.getAudit(auditId, userId);
    const result = await this.getResults(auditId, userId);
    const summary = result.teaser;
    const findings = audit.sync_id
      ? await this.getFindingSummaries(audit.user_id, audit.tenant_id, audit.sync_id)
      : [];

    return {
      audit: {
        id: audit.id,
        status: audit.status,
        started_at: audit.started_at,
        completed_at: audit.completed_at,
        selected_period: monthLabel(audit.completed_at || audit.started_at || audit.created_at),
        source_type: audit.source_type || 'sp_api',
      },
      summary: {
        completion_state: summary.finalStatus || audit.status,
        records_reviewed: summary.recordsReviewed || 0,
        sources_reviewed: summary.sourcesReviewed || [],
        sources_unavailable: summary.sourcesUnavailable || [],
        estimated_recoverable_value: summary.scopeValue || 0,
        actionable_findings: summary.findingsCount || 0,
        evidence_ready: summary.evidenceReadyCount || 0,
        evidence_required: Math.max(0, (summary.findingsCount || 0) - (summary.evidenceReadyCount || 0)),
        categories: summary.categories || [],
        limitations: summary.sourcesUnavailable?.length
          ? `Some sources were unavailable: ${summary.sourcesUnavailable.join(', ')}.`
          : null,
        recommended_next_actions: this.getRecommendedNextActions(summary),
      },
      findings,
      generated_at: new Date().toISOString(),
      disclaimer: 'Estimated values are not guaranteed recoveries. Margin prepares recovery evidence and seller approval remains required before filing.',
    };
  }

  async getActivity(auditId: string, userId: string) {
    const audit = await this.getAudit(auditId, userId);
    const summary = audit.summary || EMPTY_SUMMARY;
    const events: Array<{ timestamp: string; category: string; status: string; message: string }> = [];
    const started = audit.started_at || audit.created_at || new Date().toISOString();

    events.push({
      timestamp: started,
      category: 'Amazon',
      status: 'completed',
      message: audit.status === 'amazon_connection_required'
        ? 'Margin is waiting for Amazon authorization before it can review account activity.'
        : 'Margin prepared the audit workspace for this Amazon account.',
    });

    if (audit.sync_id) {
      events.push({
        timestamp: audit.updated_at || started,
        category: 'Amazon',
        status: ['syncing', 'detecting', 'completed', 'activated'].includes(audit.status) ? 'completed' : 'pending',
        message: 'Margin started reviewing Amazon activity for the selected audit period.',
      });
    }

    if (summary.recordsReviewed != null) {
      events.push({
        timestamp: audit.completed_at || audit.updated_at || started,
        category: 'Amazon',
        status: 'completed',
        message: `Margin reviewed ${Number(summary.recordsReviewed || 0).toLocaleString()} Amazon record${Number(summary.recordsReviewed || 0) === 1 ? '' : 's'}.`,
      });
    }

    if (Array.isArray(summary.sourcesReviewed) && summary.sourcesReviewed.length) {
      events.push({
        timestamp: audit.completed_at || audit.updated_at || started,
        category: 'Evidence',
        status: 'completed',
        message: `Sources reviewed: ${summary.sourcesReviewed.join(', ')}.`,
      });
    }

    if (Array.isArray(summary.sourcesUnavailable) && summary.sourcesUnavailable.length) {
      events.push({
        timestamp: audit.completed_at || audit.updated_at || started,
        category: 'Evidence',
        status: 'limited',
        message: 'Some Amazon datasets were unavailable for this audit.',
      });
    }

    if (audit.status === 'detecting') {
      events.push({
        timestamp: audit.updated_at || started,
        category: 'Findings',
        status: 'running',
        message: 'Margin is evaluating synced activity for recovery opportunities.',
      });
    }

    if (audit.status === 'completed') {
      events.push({
        timestamp: audit.completed_at || audit.updated_at || started,
        category: 'Findings',
        status: 'completed',
        message: summary.findingsCount > 0
          ? `Margin identified ${summary.findingsCount} actionable finding${summary.findingsCount === 1 ? '' : 's'}.`
          : 'Margin completed the audit without identifying actionable recoveries in the available records.',
      });
    }

    if (audit.activation_status === 'activated') {
      events.push({
        timestamp: audit.updated_at || started,
        category: 'Payment',
        status: 'completed',
        message: 'Recovery Workspace access is active for this audit workspace.',
      });
    }

    return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  async getSchedule(userId: string) {
    const latestAudit = await this.getLatestAudit(userId);
    const safeUserId = convertUserIdToUuid(userId);
    const tenantId = latestAudit?.tenant_id || null;
    if (!tenantId) {
      return { schedule: null, entitlement: { entitled: false, state: 'none' } };
    }

    const { entitlement } = await workspaceEntitlementService.getTenantEntitlement(tenantId);
    const { data, error } = await supabaseAdmin
      .from('audit_schedules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', safeUserId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load audit schedule: ${error.message}`);
    return { schedule: data || null, entitlement };
  }

  async saveSchedule(userId: string, input: {
    cadence: string;
    preferredDayOfWeek?: number | null;
    preferredDayOfMonth?: number | null;
    preferredTime?: string | null;
    timezone?: string | null;
    isPaused?: boolean;
  }) {
    const latestAudit = await this.getLatestAudit(userId);
    if (!latestAudit?.tenant_id) throw new Error('Audit workspace required before scheduling audits');
    const { entitlement } = await workspaceEntitlementService.getTenantEntitlement(latestAudit.tenant_id);
    if (!entitlement.entitled) throw new Error('Recovery Workspace subscription required');

    const cadence = String(input.cadence || 'off');
    if (!['off', 'weekly', 'biweekly', 'monthly'].includes(cadence)) throw new Error('Unsupported audit schedule frequency');
    const timezone = normalizeTimezone(input.timezone);
    const preferredTime = String(input.preferredTime || '09:00');
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(preferredTime)) throw new Error('Invalid preferred time');

    const safeUserId = convertUserIdToUuid(userId);
    const payload = {
      tenant_id: latestAudit.tenant_id,
      user_id: safeUserId,
      cadence,
      preferred_day_of_week: cadence === 'weekly' || cadence === 'biweekly' ? Number(input.preferredDayOfWeek ?? 1) : null,
      preferred_day_of_month: cadence === 'monthly' ? Math.min(Math.max(Number(input.preferredDayOfMonth || 1), 1), 28) : null,
      preferred_time: preferredTime,
      timezone,
      is_paused: Boolean(input.isPaused),
      next_run_at: Boolean(input.isPaused) ? null : nextScheduleRun({
        cadence,
        preferredDayOfWeek: Number(input.preferredDayOfWeek ?? 1),
        preferredDayOfMonth: Number(input.preferredDayOfMonth || 1),
        preferredTime,
        timezone,
      }),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('audit_schedules')
      .upsert(payload, { onConflict: 'tenant_id' })
      .select('*')
      .single();

    if (error || !data) throw new Error(`Failed to save audit schedule: ${error?.message || 'Unknown error'}`);
    return { schedule: data, entitlement };
  }

  async processDueSchedules(limit = 10) {
    const results = { processed: 0, succeeded: 0, skipped: 0, failed: 0, errors: [] as string[] };
    const workerId = `audit-schedule:${process.pid}:${Date.now()}`;
    const maxRuns = Math.min(Math.max(limit, 1), 50);

    for (let index = 0; index < maxRuns; index++) {
      const schedule = await this.claimDueSchedule(workerId);
      if (!schedule) break;

      results.processed++;
      try {
        const { entitlement } = await workspaceEntitlementService.getTenantEntitlement(schedule.tenant_id);
        const nextRunAt = nextScheduleRun({
          cadence: schedule.cadence,
          preferredDayOfWeek: schedule.preferred_day_of_week,
          preferredDayOfMonth: schedule.preferred_day_of_month,
          preferredTime: schedule.preferred_time,
          timezone: schedule.timezone,
        });

        if (!entitlement.entitled) {
          const pausedAt = new Date().toISOString();
          await supabaseAdmin
            .from('audit_schedules')
            .update({
              is_paused: true,
              next_run_at: null,
              lease_owner: null,
              lease_acquired_at: null,
              lease_expires_at: null,
              metadata: {
                ...(schedule.metadata || {}),
                paused_reason: 'recovery_workspace_entitlement_inactive',
                paused_at: pausedAt,
              },
              updated_at: pausedAt,
            })
            .eq('id', schedule.id);
          results.skipped++;
          continue;
        }

        const runningAudit = await this.getRunningAuditForSchedule(schedule.user_id, schedule.tenant_id);
        if (runningAudit) {
          await this.completeScheduleClaim(schedule.id, {
            lastRunAt: new Date().toISOString(),
            nextRunAt,
            metadata: {
              ...(schedule.metadata || {}),
              last_audit_id: runningAudit.id,
              last_run_status: 'skipped_existing_audit_in_progress',
            },
          });
          results.skipped++;
          continue;
        }

        const connection = await this.getAmazonConnection(schedule.user_id, schedule.tenant_id);
        if (!connection) {
          await this.completeScheduleClaim(schedule.id, {
            lastRunAt: new Date().toISOString(),
            nextRunAt,
            metadata: {
              ...(schedule.metadata || {}),
              last_run_status: 'amazon_connection_required',
            },
          });
          results.skipped++;
          continue;
        }

        const audit = await this.createScheduledAudit(schedule.user_id, schedule.tenant_id, connection.store_id);
        await this.runAudit(audit.id, schedule.user_id);
        results.succeeded++;

        await this.completeScheduleClaim(schedule.id, {
          lastRunAt: new Date().toISOString(),
          nextRunAt,
          metadata: {
            ...(schedule.metadata || {}),
            last_audit_id: audit.id,
            last_run_status: 'audit_started',
          },
        });
      } catch (scheduleError: any) {
        results.failed++;
        results.errors.push(scheduleError?.message || 'Unknown audit schedule error');
        logger.error('[AUDIT SCHEDULE] Failed to process scheduled audit', {
          scheduleId: schedule.id,
          tenantId: schedule.tenant_id,
          error: scheduleError?.message,
        });
      }
    }

    return results;
  }

  private async claimDueSchedule(workerId: string) {
    try {
      return await withPostgresTransaction(async (client) => {
        const result = await client.query(
          `
            WITH candidate AS (
              SELECT *
              FROM audit_schedules
              WHERE cadence <> 'off'
                AND is_paused = false
                AND next_run_at IS NOT NULL
                AND next_run_at <= now()
                AND (lease_expires_at IS NULL OR lease_expires_at < now())
              ORDER BY next_run_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE audit_schedules schedule
            SET lease_owner = $1,
                lease_acquired_at = now(),
                lease_expires_at = now() + interval '10 minutes',
                updated_at = now()
            FROM candidate
            WHERE schedule.id = candidate.id
            RETURNING schedule.*
          `,
          [workerId]
        );
        return result.rows[0] || null;
      });
    } catch (error: any) {
      if (error?.code === '42P01' || /audit_schedules/i.test(error?.message || '')) {
        logger.warn('[AUDIT SCHEDULE] audit_schedules table unavailable; worker will retry after migration', {
          error: error?.message,
        });
        return null;
      }
      throw error;
    }
  }

  private async completeScheduleClaim(scheduleId: string, input: {
    lastRunAt: string;
    nextRunAt: string | null;
    metadata: Record<string, any>;
  }) {
    const { error } = await supabaseAdmin
      .from('audit_schedules')
      .update({
        last_run_at: input.lastRunAt,
        next_run_at: input.nextRunAt,
        lease_owner: null,
        lease_acquired_at: null,
        lease_expires_at: null,
        metadata: input.metadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scheduleId);

    if (error) throw new Error(`Failed to complete audit schedule claim: ${error.message}`);
  }

  private async getRunningAuditForSchedule(userId: string, tenantId: string) {
    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .select('id, status')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .in('status', ['created', 'amazon_connection_required', 'syncing', 'detecting'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Failed to check running audit: ${error.message}`);
    return data || null;
  }

  private async createScheduledAudit(userId: string, tenantId: string, storeId?: string | null) {
    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .insert({
        user_id: userId,
        tenant_id: tenantId,
        store_id: storeId || null,
        status: 'created',
        source_type: 'sp_api',
        summary: EMPTY_SUMMARY,
        activation_status: 'not_activated'
      })
      .select('*')
      .single();

    if (error || !data) throw new Error(`Failed to create scheduled audit: ${error?.message || 'Unknown error'}`);
    return data;
  }

  private async buildSummary(userId: string, tenantId: string, syncId: string, syncStatus?: any): Promise<AuditSummary> {
    const { data, error } = await supabaseAdmin
      .from('detection_results')
      .select('estimated_value, evidence, anomaly_type, coverage_family, detector_key, claim_readiness')
      .eq('seller_id', userId)
      .eq('tenant_id', tenantId)
      .eq('sync_id', syncId)
      .limit(500);

    if (error) throw new Error(`Failed to summarize audit findings: ${error.message}`);

    const rows = data || [];
    const normalizedCategories = rows
      .map(normalizeCategory)
      .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0);
    const categories: string[] = Array.from(
      new Set<string>(normalizedCategories)
    ).slice(0, 7);
    const scopeValue = rows.reduce((sum: number, row: any) => sum + getCountedValue(row), 0);
    const evidenceReadyCount = rows.filter((row: any) =>
      row?.claim_readiness === 'claim_ready' ||
      row?.evidence?.claim_readiness === 'claim_ready' ||
      row?.evidence?.evidence_ready === true
    ).length;
    const metadata = getSyncMetadata(syncStatus);
    const recordsReviewed = getRecordsReviewedFromMetadata(metadata);
    const hasFindings = rows.length > 0;
    const sourcesReviewed = [
      numberFrom(metadata.ordersProcessed) || numberFrom(metadata.totalOrders) ? 'Orders' : null,
      numberFrom(metadata.inventoryCount) ? 'Inventory' : null,
      numberFrom(metadata.shipmentsCount) ? 'Shipments' : null,
      numberFrom(metadata.returnsCount) ? 'Returns' : null,
      numberFrom(metadata.settlementsCount) ? 'Settlements' : null,
      numberFrom(metadata.feesCount) ? 'Fees' : null
    ].filter((source): source is string => Boolean(source));
    const sourceWarnings = Array.isArray(metadata.sourceWarnings)
      ? metadata.sourceWarnings
      : Array.isArray(metadata.warnings)
        ? metadata.warnings
        : [];
    const sourcesUnavailable = sourceWarnings
      .map((warning: any) => String(warning?.source || warning?.name || warning || '').trim())
      .filter(Boolean);
    const isPartial = sourcesUnavailable.length > 0 || recordsReviewed === 0;
    const finalStatus: AuditSummary['finalStatus'] = hasFindings
      ? (isPartial ? 'partial_with_findings' : 'complete_with_findings')
      : (isPartial ? 'partial_no_findings' : 'complete_no_findings');
    const message = hasFindings
      ? (isPartial
          ? 'Margin found recovery candidates from the Amazon data available. Some datasets were unavailable, so the audit is limited.'
          : 'Margin found recovery candidates. Activate Margin to open the recovery workflow.')
      : (isPartial
          ? 'Margin completed the audit with limited Amazon data. No recovery candidates were found in the records available for review.'
          : 'Margin reviewed the available Amazon activity and did not identify recovery opportunities in that audit window.');

    return {
      scopeValue,
      findingsCount: rows.length,
      categories,
      evidenceReadyCount,
      locked: true,
      message,
      finalStatus,
      recordsReviewed,
      sourcesReviewed,
      sourcesUnavailable,
      retryable: isPartial
    };
  }

  private async getFindingSummaries(userId: string, tenantId: string, syncId: string) {
    const { data, error } = await supabaseAdmin
      .from('detection_results')
      .select('estimated_value, anomaly_type, coverage_family, detector_key, claim_readiness')
      .eq('seller_id', userId)
      .eq('tenant_id', tenantId)
      .eq('sync_id', syncId)
      .limit(25);

    if (error) throw new Error(`Failed to load audit finding summaries: ${error.message}`);
    return (data || []).map((row: any) => ({
      category: normalizeCategory(row),
      estimated_value: getCountedValue(row),
      readiness: sanitizeStatus(row.claim_readiness || 'evidence review required'),
    }));
  }

  private getRecommendedNextActions(summary: AuditSummary): string[] {
    if (summary.finalStatus === 'partial_no_findings' && Number(summary.recordsReviewed || 0) === 0) {
      return ['Retry the audit after Amazon activity becomes available.', 'Keep monitoring enabled if Recovery Workspace is active.'];
    }
    if (summary.findingsCount > 0) {
      return ['Review the locked recovery summary.', 'Choose Recover Once or activate Recovery Workspace before filing.'];
    }
    return ['Check again as new shipments, reimbursements, refunds, fees, and settlements appear.'];
  }

  private async getSyncStatus(syncId: string, userId: string, tenantId: string, storeId?: string | null) {
    let query = supabaseAdmin
      .from('sync_progress')
      .select('sync_id, status, current_step, error_code, updated_at, metadata')
      .eq('sync_id', syncId)
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      logger.warn('[AUDIT] Failed to read sync status before detection', {
        syncId,
        userId,
        tenantId,
        error: error.message
      });
      return null;
    }

    return data || null;
  }

  private async updateAudit(id: string, updates: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update audit run: ${error?.message || 'Unknown error'}`);
    }
    return data;
  }
}

export const auditRunService = new AuditRunService();
export default auditRunService;
