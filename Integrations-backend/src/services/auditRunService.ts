import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import { ensureAuthenticatedUserWorkspace } from './userWorkspaceBootstrap';
import { syncJobManager } from './syncJobManager';
import enhancedDetectionService from './enhancedDetectionService';
import logger from '../utils/logger';
import workspaceEntitlementService from './workspaceEntitlementService';
import { withPostgresTransaction } from '../database/postgresTransaction';
import tokenManager from '../utils/tokenManager';
import {
  buildControlStatement,
  classifyCommercialDecision,
  type AuditRecordLike,
  type AuditSummaryLike,
  type CommercialDecision,
} from './auditCommercialDecisionService';

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
  commercialState?: string;
  commercialRoute?: string;
  commercialReason?: string;
  commercialEligibility?: string;
  commercialEvidenceBasis?: Record<string, unknown>;
  commercialDecidedAt?: string | null;
  previousAuditId?: string | null;
  lastAuditAt?: string | null;
  nextEligibleAt?: string | null;
  commercialComparison?: Record<string, unknown>;
  controlStatementId?: string | null;
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
      .select('id, store_id, expires_at, credential_status')
      .eq('user_id', safeUserId)
      .eq('tenant_id', tenantId)
      .eq('provider', 'amazon')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.id) return null;
    if (data.credential_status === 'reconnect_required') return null;
    const usable = await tokenManager.isTokenValid(userId, 'amazon', data.store_id || undefined);
    if (!usable) return null;
    return data;
  }

  async startAudit(userId: string, email?: string | null): Promise<{
    audit: any;
    tenant: any;
    amazonConnected: boolean;
    commercialEligibility?: string | null;
    nextEligibleAt?: string | null;
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
          amazonConnected: Boolean(connection),
          commercialEligibility: resumedAudit.commercial_eligibility || null,
          nextEligibleAt: resumedAudit.next_eligible_at || null
        };
      }

      if (
        latestAudit.status === 'completed' &&
        latestAudit.next_eligible_at &&
        new Date(latestAudit.next_eligible_at).getTime() > Date.now()
      ) {
        return {
          audit: latestAudit,
          tenant: workspace.tenant,
          amazonConnected: Boolean(connection),
          commercialEligibility: latestAudit.commercial_eligibility || null,
          nextEligibleAt: latestAudit.next_eligible_at
        };
      }
    }

    const previousCompletedAudit = await this.getLatestCompletedAudit(workspace.userId, workspace.tenant.id, latestAudit?.id || null);

    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .insert({
        user_id: workspace.userId,
        tenant_id: workspace.tenant.id,
        store_id: connection?.store_id || null,
        status,
        source_type: 'sp_api',
        summary: EMPTY_SUMMARY,
        activation_status: 'not_activated',
        previous_audit_id: previousCompletedAudit?.id || null,
        last_audit_at: previousCompletedAudit?.completed_at || previousCompletedAudit?.started_at || null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create audit run: ${error?.message || 'Unknown error'}`);
    }

    return {
      audit: data,
      tenant: workspace.tenant,
      amazonConnected: Boolean(connection),
      commercialEligibility: data.commercial_eligibility || null,
      nextEligibleAt: data.next_eligible_at || null
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

  private async getLatestCompletedAudit(userId: string, tenantId: string, excludeAuditId?: string | null) {
    const safeUserId = convertUserIdToUuid(userId);
    let query = supabaseAdmin
      .from('audit_runs')
      .select('*')
      .eq('user_id', safeUserId)
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);

    if (excludeAuditId) {
      query = query.neq('id', excludeAuditId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Failed to load previous completed audit: ${error.message}`);
    return data || null;
  }

  private buildCsvSyncStatus(uploadRun: any) {
    const filesSummary = Array.isArray(uploadRun?.files_summary)
      ? uploadRun.files_summary
      : Array.isArray(uploadRun?.ingestion_results)
        ? uploadRun.ingestion_results
        : [];
    const byType: Record<string, number> = {};
    let totalItemsSynced = 0;

    filesSummary.forEach((file: any) => {
      const csvType = String(file?.csvType || file?.csv_type || '').trim();
      const inserted = numberFrom(file?.rowsInserted ?? file?.rows_inserted);
      const processed = numberFrom(file?.rowsProcessed ?? file?.rows_processed);
      const reviewed = inserted || processed;
      if (reviewed > 0) {
        totalItemsSynced += reviewed;
        if (csvType) {
          byType[csvType] = (byType[csvType] || 0) + reviewed;
        }
      }
    });

    const sourceMap: Record<string, string> = {
      orders: 'Orders',
      shipments: 'Shipments',
      returns: 'Returns',
      settlements: 'Settlements',
      inventory: 'Inventory',
      financial_events: 'Financial events',
      fees: 'Fees',
      transfers: 'Transfers',
    };
    const suppliedTypes = new Set(Object.keys(byType));
    const sourceWarnings = Object.keys(sourceMap)
      .filter((csvType) => !suppliedTypes.has(csvType))
      .map((csvType) => ({ source: sourceMap[csvType], reason: 'not_uploaded' }));

    return {
      sync_id: uploadRun?.sync_id,
      status: uploadRun?.status === 'failed' ? 'failed' : 'completed',
      current_step: 'manual_report_audit',
      updated_at: uploadRun?.updated_at || uploadRun?.completed_at || uploadRun?.created_at || new Date().toISOString(),
      metadata: {
        sourceType: 'csv_upload',
        totalItemsSynced,
        ordersProcessed: byType.orders || 0,
        totalOrders: byType.orders || 0,
        inventoryCount: byType.inventory || 0,
        shipmentsCount: byType.shipments || 0,
        returnsCount: byType.returns || 0,
        settlementsCount: (byType.settlements || 0) + (byType.financial_events || 0),
        feesCount: byType.fees || 0,
        transfersCount: byType.transfers || 0,
        sourceWarnings,
        csvTypesUploaded: Array.from(suppliedTypes),
      },
    };
  }

  private async getCsvUploadRunForAudit(userId: string, tenantId: string, syncId: string) {
    const { data, error } = await supabaseAdmin
      .from('csv_upload_runs')
      .select('sync_id, tenant_id, user_id, seller_id, success, total_files, file_count, detection_triggered, detection_job_id, ingestion_results, files_summary, created_at, updated_at, started_at, completed_at, status, error, is_sandbox')
      .eq('tenant_id', tenantId)
      .eq('seller_id', userId)
      .eq('sync_id', syncId)
      .maybeSingle();

    if (error?.code === '42P01') {
      throw new Error('CSV upload run table is not deployed.');
    }

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to load CSV upload run: ${error.message}`);
    }

    return data || null;
  }

  private async getCsvDetectionStatusForAudit(userId: string, tenantId: string, syncId: string) {
    const [{ data: queueRows, error: queueError }, { count: resultCount, error: resultError }] = await Promise.all([
      supabaseAdmin
        .from('detection_queue')
        .select('status, processed_at, error_message, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .eq('seller_id', userId)
        .eq('sync_id', syncId)
        .order('updated_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('detection_results')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('seller_id', userId)
        .eq('sync_id', syncId),
    ]);

    if (queueError) throw new Error(`Failed to load CSV detection queue: ${queueError.message}`);
    if (resultError) throw new Error(`Failed to load CSV detection results: ${resultError.message}`);

    const queue = Array.isArray(queueRows) && queueRows.length > 0 ? queueRows[0] : null;
    const status = String(queue?.status || (Number(resultCount || 0) > 0 ? 'completed' : '')).toLowerCase();
    return {
      status,
      resultCount: Number(resultCount || 0),
      error: queue?.error_message || null,
      completedAt: queue?.processed_at || queue?.updated_at || null,
    };
  }

  async createOrResumeCsvAuditFromSync(input: {
    userId: string;
    tenantId: string;
    syncId: string;
    storeId?: string | null;
  }) {
    const safeUserId = convertUserIdToUuid(input.userId);
    const syncId = String(input.syncId || '').trim();
    if (!syncId || !syncId.startsWith('csv_')) {
      throw new Error('A valid CSV sync is required for a manual report audit.');
    }

    const uploadRun = await this.getCsvUploadRunForAudit(safeUserId, input.tenantId, syncId);
    if (!uploadRun) {
      throw new Error('CSV upload run was not found.');
    }

    const filesSummary = Array.isArray(uploadRun.files_summary)
      ? uploadRun.files_summary
      : Array.isArray(uploadRun.ingestion_results)
        ? uploadRun.ingestion_results
        : [];
    const rowsInserted = filesSummary.reduce((sum: number, file: any) => sum + numberFrom(file?.rowsInserted ?? file?.rows_inserted), 0);
    const rowsProcessed = filesSummary.reduce((sum: number, file: any) => sum + numberFrom(file?.rowsProcessed ?? file?.rows_processed), 0);
    if (rowsInserted <= 0 && rowsProcessed <= 0) {
      throw new Error('No usable Amazon report rows were available for a manual audit.');
    }

    if (!uploadRun.detection_triggered) {
      throw new Error('Detection has not been started for this manual report upload.');
    }

    const detection = await this.getCsvDetectionStatusForAudit(safeUserId, input.tenantId, syncId);
    if (detection.status === 'failed') {
      throw new Error('Detection failed for this manual report upload.');
    }

    const auditStatus: AuditRunStatus = detection.status === 'completed'
      ? 'completed'
      : 'detecting';

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('audit_runs')
      .select('*')
      .eq('user_id', safeUserId)
      .eq('tenant_id', input.tenantId)
      .eq('source_type', 'csv_upload')
      .eq('sync_id', syncId)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      throw new Error(`Failed to load manual report audit: ${existingError.message}`);
    }

    const syncStatus = this.buildCsvSyncStatus(uploadRun);
    const summary = auditStatus === 'completed'
      ? await this.buildSummary(safeUserId, input.tenantId, syncId, syncStatus)
      : {
          ...SYNC_IN_PROGRESS_SUMMARY,
          message: 'Manual report detection is still running. Margin will finish the recovery audit when processing completes.',
        };

    const previousAudit = await this.getLatestCompletedAudit(safeUserId, input.tenantId, existing?.id || null);
    const basePayload = {
      user_id: safeUserId,
      tenant_id: input.tenantId,
      store_id: input.storeId || existing?.store_id || null,
      sync_id: syncId,
      status: auditStatus,
      source_type: 'csv_upload',
      summary,
      activation_status: existing?.activation_status || 'not_activated',
      previous_audit_id: existing?.previous_audit_id || previousAudit?.id || null,
      last_audit_at: existing?.last_audit_at || previousAudit?.completed_at || previousAudit?.started_at || null,
      started_at: existing?.started_at || uploadRun.started_at || uploadRun.created_at || new Date().toISOString(),
      completed_at: auditStatus === 'completed'
        ? (existing?.completed_at || detection.completedAt || uploadRun.completed_at || new Date().toISOString())
        : null,
    };

    const audit = existing?.id
      ? await this.updateAudit(existing.id, basePayload)
      : await (async () => {
          const { data, error } = await supabaseAdmin
            .from('audit_runs')
            .insert(basePayload)
            .select('*')
            .single();

          if (error || !data) {
            if (error?.code === '23505') {
              const { data: racedAudit, error: raceLoadError } = await supabaseAdmin
                .from('audit_runs')
                .select('*')
                .eq('user_id', safeUserId)
                .eq('tenant_id', input.tenantId)
                .eq('source_type', 'csv_upload')
                .eq('sync_id', syncId)
                .maybeSingle();
              if (!raceLoadError && racedAudit) return racedAudit;
            }
            throw new Error(`Failed to create manual report audit: ${error?.message || 'Unknown error'}`);
          }
          return data;
        })();

    if (audit.status === 'completed' && !audit.commercial_state) {
      const workspaceEntitlement = await workspaceEntitlementService.getTenantEntitlement(audit.tenant_id);
      const { audit: commercialAudit } = await this.persistCommercialOutcome({
        audit,
        summary,
        previousAudit,
        hasRecoveryWorkspace: workspaceEntitlement.entitlement.entitled,
      });
      return commercialAudit;
    }

    return audit;
  }

  private async getControlStatementByAuditId(auditId: string) {
    const { data, error } = await supabaseAdmin
      .from('audit_control_statements')
      .select('*')
      .eq('audit_run_id', auditId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load audit control statement: ${error.message}`);
    return data || null;
  }

  private async persistCommercialOutcome(input: {
    audit: any;
    summary: AuditSummaryLike | null;
    previousAudit: any | null;
    hasRecoveryWorkspace: boolean;
  }) {
    const decision: CommercialDecision = classifyCommercialDecision({
      currentAudit: input.audit as AuditRecordLike,
      currentSummary: input.summary,
      previousAudit: input.previousAudit as AuditRecordLike | null | undefined,
      hasRecoveryWorkspace: input.hasRecoveryWorkspace,
    });
    const controlStatement = buildControlStatement({
      currentAudit: input.audit as AuditRecordLike,
      commercialDecision: decision,
    });

    const persisted = await this.updateAudit(input.audit.id, {
      previous_audit_id: decision.previous_audit_id,
      last_audit_at: decision.last_audit_at,
      next_eligible_at: decision.next_eligible_at,
      commercial_state: decision.commercial_state,
      commercial_route: decision.commercial_route,
      commercial_reason: decision.commercial_reason,
      commercial_eligibility: decision.commercial_eligibility,
      commercial_evidence_basis: decision.commercial_evidence_basis,
      commercial_decided_at: decision.commercial_decided_at,
      commercial_comparison: decision.comparison,
    });

    const { data: controlData, error: controlError } = await supabaseAdmin
      .from('audit_control_statements')
      .upsert({
        audit_run_id: input.audit.id,
        tenant_id: input.audit.tenant_id,
        user_id: input.audit.user_id,
        coverage_start: controlStatement.coverage_start,
        coverage_end: controlStatement.coverage_end,
        generated_at: controlStatement.generated_at,
        data_freshness: controlStatement.data_freshness,
        event_population: controlStatement.event_population,
        automatic_reimbursements: controlStatement.automatic_reimbursements,
        manual_reimbursements: controlStatement.manual_reimbursements,
        reversals: controlStatement.reversals,
        exceptions_investigated: controlStatement.exceptions_investigated,
        unresolved_recoveries: controlStatement.unresolved_recoveries,
        evidence_gaps: controlStatement.evidence_gaps,
        deadlines_approaching: controlStatement.deadlines_approaching,
        open_cases: controlStatement.open_cases,
        control_status: controlStatement.control_status,
        source_lineage: controlStatement.source_lineage,
        payload: controlStatement.payload,
      }, { onConflict: 'audit_run_id' })
      .select('*')
      .single();

    if (controlError) {
      logger.warn('[AUDIT] Failed to persist control statement', {
        auditId: input.audit.id,
        error: controlError.message,
      });
    }

    if (controlData?.id) {
      await this.updateAudit(input.audit.id, { control_statement_id: controlData.id });
    }

    return {
      audit: persisted,
      decision,
      controlStatement: controlData || null,
    };
  }

  async getAuditHistory(userId: string, limit = 18) {
    const safeUserId = convertUserIdToUuid(userId);
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 18);
    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .select('id, tenant_id, store_id, sync_id, status, source_type, started_at, completed_at, created_at, updated_at, summary, activation_status, commercial_state, commercial_route')
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
        commercialState: audit.commercial_state || null,
        commercialRoute: audit.commercial_route || null,
        isLatest: index === 0,
      };
    });
  }

  async runAudit(auditId: string, userId: string) {
    const audit = await this.getAudit(auditId, userId);
    if (audit.status === 'completed') {
      if (audit.commercial_state) {
        return audit;
      }

      const previousAudit = await this.getLatestCompletedAudit(audit.user_id, audit.tenant_id, audit.id);
      const workspaceEntitlement = await workspaceEntitlementService.getTenantEntitlement(audit.tenant_id);
      const { audit: commercialAudit } = await this.persistCommercialOutcome({
        audit,
        summary: audit.summary || EMPTY_SUMMARY,
        previousAudit,
        hasRecoveryWorkspace: workspaceEntitlement.entitlement.entitled,
      });
      return commercialAudit;
    }

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
    const completedAudit = await this.updateAudit(audit.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      summary
    });

    const previousAudit = await this.getLatestCompletedAudit(audit.user_id, audit.tenant_id, audit.id);
    const workspaceEntitlement = await workspaceEntitlementService.getTenantEntitlement(audit.tenant_id);
    const { audit: commercialAudit } = await this.persistCommercialOutcome({
      audit: completedAudit,
      summary,
      previousAudit,
      hasRecoveryWorkspace: workspaceEntitlement.entitlement.entitled,
    });

    return commercialAudit;
  }

  async getResults(auditId: string, userId: string) {
    const audit = await this.getAudit(auditId, userId);
    const syncStatus = audit.sync_id
      ? await this.getSyncStatus(audit.sync_id, audit.user_id, audit.tenant_id, audit.store_id)
      : null;
    const summary = audit.status === 'completed' && audit.sync_id
      ? await this.buildSummary(audit.user_id, audit.tenant_id, audit.sync_id, syncStatus)
      : (audit.summary || EMPTY_SUMMARY);
    const teaserSummary = {
      ...summary,
      commercialState: audit.commercial_state || summary.commercialState,
      commercialRoute: audit.commercial_route || summary.commercialRoute,
      commercialReason: audit.commercial_reason || summary.commercialReason,
      commercialEligibility: audit.commercial_eligibility || summary.commercialEligibility,
      commercialEvidenceBasis: audit.commercial_evidence_basis || summary.commercialEvidenceBasis,
      commercialDecidedAt: audit.commercial_decided_at || summary.commercialDecidedAt,
      previousAuditId: audit.previous_audit_id || summary.previousAuditId,
      lastAuditAt: audit.last_audit_at || summary.lastAuditAt,
      nextEligibleAt: audit.next_eligible_at || summary.nextEligibleAt,
      commercialComparison: audit.commercial_comparison || summary.commercialComparison,
      controlStatementId: audit.control_statement_id || summary.controlStatementId,
    };

    if (audit.status === 'completed') {
      if (!audit.commercial_state) {
        const previousAudit = await this.getLatestCompletedAudit(audit.user_id, audit.tenant_id, audit.id);
        const workspaceEntitlement = await workspaceEntitlementService.getTenantEntitlement(audit.tenant_id);
        const commercial = await this.persistCommercialOutcome({
          audit,
          summary: teaserSummary,
          previousAudit,
          hasRecoveryWorkspace: workspaceEntitlement.entitlement.entitled,
        });
        return {
          audit: {
            id: commercial.audit.id,
            status: commercial.audit.status,
            activation_status: commercial.audit.activation_status,
            sync_id: commercial.audit.sync_id,
            started_at: commercial.audit.started_at,
            completed_at: commercial.audit.completed_at
          },
          teaser: {
            ...teaserSummary,
            locked: commercial.audit.activation_status !== 'activated',
            activationRequired: commercial.audit.activation_status !== 'activated',
          },
          commercial: {
            decision: commercial.decision,
            controlStatement: commercial.controlStatement,
          }
        };
      }
      await this.updateAudit(audit.id, { summary: teaserSummary });
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
        ...teaserSummary,
        locked: audit.activation_status !== 'activated',
        activationRequired: audit.activation_status !== 'activated'
      },
      commercial: {
        state: audit.commercial_state || null,
        route: audit.commercial_route || null,
        reason: audit.commercial_reason || null,
        eligibility: audit.commercial_eligibility || null,
        decidedAt: audit.commercial_decided_at || null,
        previousAuditId: audit.previous_audit_id || null,
        lastAuditAt: audit.last_audit_at || null,
        nextEligibleAt: audit.next_eligible_at || null,
        comparison: audit.commercial_comparison || {},
        controlStatementId: audit.control_statement_id || null,
        controlStatement: await this.getControlStatementByAuditId(audit.id),
      }
    };
  }

  async getControlStatement(auditId: string, userId: string) {
    const audit = await this.getAudit(auditId, userId);
    const controlStatement = await this.getControlStatementByAuditId(audit.id);

    if (!controlStatement) {
      const summary = audit.summary || EMPTY_SUMMARY;
      const decision = audit.commercial_state
        ? {
            commercial_state: audit.commercial_state,
            commercial_route: audit.commercial_route,
            commercial_reason: audit.commercial_reason,
            commercial_eligibility: audit.commercial_eligibility,
            commercial_evidence_basis: audit.commercial_evidence_basis || {},
            commercial_decided_at: audit.commercial_decided_at || new Date().toISOString(),
            previous_audit_id: audit.previous_audit_id || null,
            last_audit_at: audit.last_audit_at || null,
            next_eligible_at: audit.next_eligible_at || null,
            comparison: audit.commercial_comparison || {},
          }
        : null;

      return {
        audit,
        controlStatement: decision
          ? buildControlStatement({
              currentAudit: audit as any,
              commercialDecision: decision as CommercialDecision,
            })
          : {
              coverage_start: audit.started_at || audit.created_at || new Date().toISOString(),
              coverage_end: audit.completed_at || audit.updated_at || new Date().toISOString(),
              generated_at: audit.updated_at || audit.completed_at || new Date().toISOString(),
              data_freshness: summary.recordsReviewed === 0 ? 'DATA_INCOMPLETE' : 'UNDER_CONTROL',
              event_population: {
                records_reviewed: summary.recordsReviewed || 0,
                findings_count: summary.findingsCount || 0,
                scope_value: summary.scopeValue || 0,
                evidence_ready_count: summary.evidenceReadyCount || 0,
                sources_reviewed: summary.sourcesReviewed || [],
                sources_unavailable: summary.sourcesUnavailable || [],
              },
              automatic_reimbursements: 0,
              manual_reimbursements: 0,
              reversals: 0,
              exceptions_investigated: 0,
              unresolved_recoveries: summary.findingsCount || 0,
              evidence_gaps: summary.sourcesUnavailable || [],
              deadlines_approaching: [],
              open_cases: summary.findingsCount || 0,
              control_status: summary.recordsReviewed === 0 ? 'DATA_INCOMPLETE' : 'UNDER_CONTROL',
              source_lineage: {
                previous_audit_id: audit.previous_audit_id || null,
                current_audit_id: audit.id,
                comparison_available: Boolean(audit.commercial_comparison),
                recurring_burden: false,
              },
              payload: {
                summary,
                commercial_state: audit.commercial_state || null,
                commercial_route: audit.commercial_route || null,
              },
            },
      };
    }

    return {
      audit,
      controlStatement,
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
        commercial_state: audit.commercial_state || null,
        commercial_route: audit.commercial_route || null,
        commercial_reason: audit.commercial_reason || null,
        commercial_eligibility: audit.commercial_eligibility || null,
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

      if (audit.commercial_route || audit.commercial_state) {
        events.push({
          timestamp: audit.commercial_decided_at || audit.completed_at || audit.updated_at || started,
          category: 'Commercial',
          status: 'completed',
          message: `Commercial route resolved to ${audit.commercial_route || 'NO_SALE'} (${audit.commercial_state || 'unclassified'}).`,
        });
      }
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
