import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import runtimeCapacityService from './runtimeCapacityService';

type WorkKind = 'recovery' | 'billing';
type WorkStatus = 'pending' | 'processing' | 'completed' | 'quarantined' | 'failed_retry_exhausted';

type BaseWorkCreate = {
  tenantId: string;
  tenantSlug?: string | null;
  userId: string;
  disputeCaseId: string;
  sourceEventType: string;
  sourceEventId: string;
  payload?: Record<string, any>;
  maxAttempts?: number;
};

type RecoveryWorkCreate = BaseWorkCreate;

type BillingWorkCreate = BaseWorkCreate & {
  recoveryId?: string | null;
};

const TABLES: Record<WorkKind, string> = {
  recovery: 'recovery_work_items',
  billing: 'billing_work_items'
};

const TERMINAL_FAILURE_STATUS: 'failed_retry_exhausted' = 'failed_retry_exhausted';
const TERMINAL_STATUSES = new Set<WorkStatus>(['completed', 'quarantined', TERMINAL_FAILURE_STATUS]);
const LOCK_TIMEOUT_MS = Number(process.env.FINANCIAL_WORK_LOCK_TIMEOUT_MS || String(15 * 60 * 1000));

function buildBackoffDelayMs(attempts: number): number {
  const baseMs = 5 * 60 * 1000;
  return Math.min(6 * 60 * 60 * 1000, baseMs * Math.pow(2, Math.max(0, attempts - 1)));
}

class FinancialWorkItemService {
  private getTable(kind: WorkKind): string {
    return TABLES[kind];
  }

  private buildIdempotencyKey(kind: WorkKind, params: RecoveryWorkCreate | BillingWorkCreate): string {
    if (kind === 'billing') {
      const billing = params as BillingWorkCreate;
      return `billing:${params.tenantId}:${billing.recoveryId || params.disputeCaseId}`;
    }
    return `recovery:${params.tenantId}:${params.disputeCaseId}`;
  }

  async enqueueRecoveryWork(params: RecoveryWorkCreate): Promise<{ item: any; created: boolean }> {
    return this.enqueue('recovery', params);
  }

  async enqueueBillingWork(params: BillingWorkCreate): Promise<{ item: any; created: boolean }> {
    return this.enqueue('billing', params);
  }

  private async enqueue(kind: WorkKind, params: RecoveryWorkCreate | BillingWorkCreate): Promise<{ item: any; created: boolean }> {
    const idempotencyKey = this.buildIdempotencyKey(kind, params);
    const payload = params.payload || {};
    const table = this.getTable(kind);
    const insertPayload: any = {
      tenant_id: params.tenantId,
      tenant_slug: params.tenantSlug || null,
      user_id: params.userId,
      dispute_case_id: params.disputeCaseId,
      source_event_type: params.sourceEventType,
      source_event_id: params.sourceEventId,
      idempotency_key: idempotencyKey,
      status: 'pending',
      max_attempts: params.maxAttempts || 5,
      next_attempt_at: new Date().toISOString(),
      payload
    };

    if (kind === 'billing') {
      insertPayload.recovery_id = (params as BillingWorkCreate).recoveryId || null;
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(insertPayload)
      .select()
      .single();

    if (!error && data) {
      logger.info(`[FINANCIAL WORK] ${kind} work item created`, {
        id: data.id,
        disputeCaseId: params.disputeCaseId,
        tenantId: params.tenantId,
        sourceEventType: params.sourceEventType
      });
      return { item: data, created: true };
    }

    if ((error as any)?.code !== '23505') {
      throw new Error(`Failed to enqueue ${kind} work: ${error?.message || 'unknown error'}`);
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from(table)
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (fetchError || !existing) {
      throw new Error(`Failed to read existing ${kind} work after duplicate conflict: ${fetchError?.message || 'not found'}`);
    }

    return { item: existing, created: false };
  }

  async claimNext(kind: WorkKind, workerName: string, tenantId?: string): Promise<any | null> {
    await this.releaseStaleLocks(kind, tenantId);

    let query = supabaseAdmin
      .from(this.getTable(kind))
      .select('*')
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(1);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data: items, error } = await query;
    if (error) {
      throw new Error(`Failed to claim ${kind} work item: ${error.message}`);
    }

    const item = items?.[0];
    if (!item) return null;

    const { data: claimed, error: claimError } = await supabaseAdmin
      .from(this.getTable(kind))
      .update({
        status: 'processing',
        locked_at: new Date().toISOString(),
        locked_by: workerName,
        updated_at: new Date().toISOString()
      })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to transition ${kind} work item to processing: ${claimError.message}`);
    }

    return claimed || null;
  }

  private async releaseStaleLocks(kind: WorkKind, tenantId?: string): Promise<void> {
    const staleBefore = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();
    let query = supabaseAdmin
      .from(this.getTable(kind))
      .update({
        status: 'pending',
        locked_at: null,
        locked_by: null,
        last_error: 'stale_processing_lock_recovered',
        next_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('status', 'processing')
      .lt('locked_at', staleBefore);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { error } = await query;
    if (error) {
      logger.warn(`[FINANCIAL WORK] Failed to release stale ${kind} locks`, {
        tenantId,
        error: error.message
      });
    }
  }

  async complete(kind: WorkKind, itemId: string, metadata?: Record<string, any>): Promise<void> {
    const { error } = await supabaseAdmin
      .from(this.getTable(kind))
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: null,
        updated_at: new Date().toISOString(),
        payload: metadata ? metadata : undefined
      })
      .eq('id', itemId);

    if (error) {
      throw new Error(`Failed to complete ${kind} work item ${itemId}: ${error.message}`);
    }
  }

  async defer(kind: WorkKind, itemId: string, reason: string, delayMs: number, metadata?: Record<string, any>): Promise<void> {
    const nextAttemptAt = new Date(Date.now() + Math.max(delayMs, 60 * 1000)).toISOString();
    const { error } = await supabaseAdmin
      .from(this.getTable(kind))
      .update({
        status: 'pending',
        locked_at: null,
        locked_by: null,
        last_error: reason,
        next_attempt_at: nextAttemptAt,
        updated_at: new Date().toISOString(),
        payload: metadata ? metadata : undefined
      })
      .eq('id', itemId);

    if (error) {
      throw new Error(`Failed to defer ${kind} work item ${itemId}: ${error.message}`);
    }
  }

  async quarantine(kind: WorkKind, itemId: string, reason: string, metadata?: Record<string, any>): Promise<void> {
    const { error } = await supabaseAdmin
      .from(this.getTable(kind))
      .update({
        status: 'quarantined',
        quarantined_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: reason,
        updated_at: new Date().toISOString(),
        payload: metadata ? metadata : undefined
      })
      .eq('id', itemId);

    if (error) {
      throw new Error(`Failed to quarantine ${kind} work item ${itemId}: ${error.message}`);
    }
  }

  async fail(kind: WorkKind, item: any, reason: string, metadata?: Record<string, any>): Promise<'pending' | 'failed_retry_exhausted'> {
    const attempts = Number(item?.attempts || 0) + 1;
    const maxAttempts = Number(item?.max_attempts || 5);
    const terminal = attempts >= maxAttempts;
    const status: 'pending' | 'failed_retry_exhausted' = terminal ? TERMINAL_FAILURE_STATUS : 'pending';
    const nextAttemptAt = terminal ? item?.next_attempt_at || new Date().toISOString() : new Date(Date.now() + buildBackoffDelayMs(attempts)).toISOString();

    const { error } = await supabaseAdmin
      .from(this.getTable(kind))
      .update({
        status,
        attempts,
        locked_at: null,
        locked_by: null,
        last_error: reason,
        next_attempt_at: nextAttemptAt,
        updated_at: new Date().toISOString(),
        payload: metadata ? metadata : undefined
      })
      .eq('id', item.id);

    if (error) {
      throw new Error(`Failed to mark ${kind} work item ${item.id} as ${status}: ${error.message}`);
    }

    if (terminal) {
      runtimeCapacityService.incrementCounter(`${kind}_work_retry_exhausted`);
    }

    return status;
  }

  async findRecoveryItemForDispute(tenantId: string, disputeCaseId: string): Promise<any | null> {
    const { data, error } = await supabaseAdmin
      .from('recovery_work_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('dispute_case_id', disputeCaseId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to lookup recovery work item: ${error.message}`);
    }

    return data || null;
  }

  async findBillingItemForRecovery(tenantId: string, recoveryId: string | null, disputeCaseId: string): Promise<any | null> {
    let query = supabaseAdmin
      .from('billing_work_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (recoveryId) {
      query = query.eq('recovery_id', recoveryId);
    } else {
      query = query.eq('dispute_case_id', disputeCaseId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(`Failed to lookup billing work item: ${error.message}`);
    }

    return data || null;
  }

  async getSummary(): Promise<Record<string, any>> {
    const summarize = async (table: string) => {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('id, status, tenant_id, updated_at, last_error, dispute_case_id, attempts, max_attempts');
      if (error) {
        logger.warn('[FINANCIAL WORK] Failed to summarize work items', { table, error: error.message });
        return { counts: {}, oldestPendingAgeMs: null, terminalFailures: [] };
      }
      const counts = (data || []).reduce((acc: Record<string, number>, row: any) => {
        const key = String(row.status || 'unknown');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const oldestPending = (data || [])
        .filter((row: any) => row.status === 'pending')
        .map((row: any) => new Date(row.updated_at || 0).getTime())
        .filter((value: number) => Number.isFinite(value))
        .sort((a: number, b: number) => a - b)[0];
      const terminalFailures = (data || [])
        .filter((row: any) => TERMINAL_STATUSES.has(String(row.status || '') as WorkStatus) && row.status !== 'completed')
        .sort((left: any, right: any) => new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime())
        .slice(0, 10)
        .map((row: any) => ({
          id: row.id,
          disputeCaseId: row.dispute_case_id,
          status: row.status,
          lastError: row.last_error,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
          updatedAt: row.updated_at
        }));
      return {
        counts,
        oldestPendingAgeMs: oldestPending ? Math.max(0, Date.now() - oldestPending) : null,
        terminalFailures
      };
    };

    const [recovery, billing] = await Promise.all([
      summarize('recovery_work_items'),
      summarize('billing_work_items')
    ]);

    return { recovery, billing };
  }
}

const financialWorkItemService = new FinancialWorkItemService();

export default financialWorkItemService;
