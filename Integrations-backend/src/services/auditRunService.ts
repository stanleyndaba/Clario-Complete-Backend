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
};

const EMPTY_SUMMARY: AuditSummary = {
  scopeValue: 0,
  findingsCount: 0,
  categories: [],
  evidenceReadyCount: 0,
  locked: true,
  message: 'Connect Amazon to run your free recovery audit.'
};

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
        return this.updateAudit(audit.id, {
          status: 'failed',
          summary: {
            ...EMPTY_SUMMARY,
            message: error?.message || 'Amazon sync could not be started.'
          }
        });
      }
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
        summary: {
          ...EMPTY_SUMMARY,
          message: result.message || 'Detection could not be completed.'
        }
      });
    }

    const summary = await this.buildSummary(audit.user_id, audit.tenant_id, audit.sync_id);
    return this.updateAudit(audit.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      summary
    });
  }

  async getResults(auditId: string, userId: string) {
    const audit = await this.getAudit(auditId, userId);
    const summary = audit.status === 'completed' && audit.sync_id
      ? await this.buildSummary(audit.user_id, audit.tenant_id, audit.sync_id)
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

  private async buildSummary(userId: string, tenantId: string, syncId: string): Promise<AuditSummary> {
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

    return {
      scopeValue,
      findingsCount: rows.length,
      categories,
      evidenceReadyCount,
      locked: true,
      message: rows.length
        ? 'Margin found recovery candidates. Activate Margin to open the recovery workflow.'
        : 'Margin completed the audit. No recovery candidates are ready yet.'
    };
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
