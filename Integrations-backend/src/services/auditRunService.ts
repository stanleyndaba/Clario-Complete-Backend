import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import { ensureAuthenticatedUserWorkspace } from './userWorkspaceBootstrap';
import { syncJobManager } from './syncJobManager';
import enhancedDetectionService from './enhancedDetectionService';
import logger from '../utils/logger';

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
