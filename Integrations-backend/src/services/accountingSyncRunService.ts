import { supabase, supabaseAdmin } from '../database/supabaseClient';
import { AccountingProvider } from './accountingEvidenceService';

export type AccountingSyncTrigger = 'oauth_initial' | 'manual' | 'scheduled' | 'reconnect' | 'retry';
export type AccountingSyncRunStatus = 'queued' | 'running' | 'completed' | 'completed_no_data' | 'failed' | 'reconnect_required' | 'cancelled';

export interface AccountingSyncRunInput {
  tenantId: string;
  userId: string;
  provider: AccountingProvider;
  sourceId?: string;
  trigger: AccountingSyncTrigger;
  queueJobId?: string;
}

export class AccountingSyncRunService {
  private readonly db = supabaseAdmin || supabase;

  async createOrGetActive(input: AccountingSyncRunInput): Promise<{ runId: string; reused: boolean }> {
    const { data: active, error: activeError } = await this.db
      .from('accounting_sync_runs')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('provider', input.provider)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeError) throw new Error(`ACCOUNTING_SYNC_ACTIVE_LOOKUP_FAILED:${activeError.message}`);
    if (active?.id) return { runId: active.id, reused: true };

    const { data, error } = await this.db
      .from('accounting_sync_runs')
      .insert({
        tenant_id: input.tenantId,
        user_id: input.userId,
        source_id: input.sourceId || null,
        provider: input.provider,
        trigger: input.trigger,
        status: 'queued',
        queue_job_id: input.queueJobId || null
      })
      .select('id')
      .single();
    if (error || !data?.id) {
      // Another concurrent enqueue may have won the unique active index. Recover
      // by returning that run rather than creating an uncontrolled duplicate.
      const { data: concurrent } = await this.db
        .from('accounting_sync_runs')
        .select('id')
        .eq('tenant_id', input.tenantId)
        .eq('provider', input.provider)
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (concurrent?.id) return { runId: concurrent.id, reused: true };
      throw new Error(`ACCOUNTING_SYNC_RUN_CREATE_FAILED:${error?.message || 'unknown'}`);
    }
    return { runId: data.id, reused: false };
  }

  async markRunning(runId: string, tenantId: string, queueJobId?: string): Promise<void> {
    const { error } = await this.db
      .from('accounting_sync_runs')
      .update({ status: 'running', queue_job_id: queueJobId || null, started_at: new Date().toISOString(), attempt_count: 1, updated_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('tenant_id', tenantId)
      .in('status', ['queued', 'running']);
    if (error) throw new Error(`ACCOUNTING_SYNC_RUN_START_FAILED:${error.message}`);
  }

  async markCompleted(input: {
    runId: string;
    tenantId: string;
    sourceId: string;
    status: 'verified' | 'no_data';
    recordsDiscovered: number;
    recordsInserted: number;
    recordsUpdated: number;
    checkpoint?: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db
      .from('accounting_sync_runs')
      .update({
        status: input.status === 'verified' ? 'completed' : 'completed_no_data',
        records_discovered: input.recordsDiscovered,
        records_inserted: input.recordsInserted,
        records_updated: input.recordsUpdated,
        provider_checkpoint_after: input.checkpoint || null,
        completed_at: now,
        updated_at: now,
        error_code: null,
        error_message: null
      })
      .eq('id', input.runId)
      .eq('tenant_id', input.tenantId);
    if (error) throw new Error(`ACCOUNTING_SYNC_RUN_COMPLETE_FAILED:${error.message}`);

    // The checkpoint belongs to source health and advances only after the record
    // persistence and run completion transition succeeded.
    if (input.checkpoint) {
      const { error: sourceError } = await this.db
        .from('evidence_sources')
        .update({ accounting_sync_checkpoint: input.checkpoint, updated_at: now })
        .eq('id', input.sourceId)
        .eq('tenant_id', input.tenantId);
      if (sourceError) throw new Error(`ACCOUNTING_SYNC_CHECKPOINT_UPDATE_FAILED:${sourceError.message}`);
    }
  }

  async markFailed(input: {
    runId: string;
    tenantId: string;
    reconnectRequired: boolean;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const { error } = await this.db
      .from('accounting_sync_runs')
      .update({
        status: input.reconnectRequired ? 'reconnect_required' : 'failed',
        error_code: input.errorCode,
        error_message: input.errorMessage.slice(0, 500),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', input.runId)
      .eq('tenant_id', input.tenantId);
    if (error) throw new Error(`ACCOUNTING_SYNC_RUN_FAIL_FAILED:${error.message}`);
  }
}

export const accountingSyncRunService = new AccountingSyncRunService();
