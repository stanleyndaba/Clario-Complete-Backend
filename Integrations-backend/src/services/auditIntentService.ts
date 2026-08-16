import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';

export type AuditIntentSourceType = 'sp_api' | 'csv_upload';
export type AuditIntentStatus = 'pending' | 'attached' | 'consumed' | 'abandoned' | 'expired';

export interface AuditIntentRecord {
  id: string;
  source_type: AuditIntentSourceType;
  status: AuditIntentStatus;
  user_id: string | null;
  tenant_id: string | null;
  audit_run_id: string | null;
  return_path: string;
  metadata: Record<string, unknown>;
  created_at: string;
  attached_at: string | null;
  consumed_at: string | null;
  abandoned_at: string | null;
  expires_at: string;
  updated_at: string;
}

function normalizeSourceType(value: unknown): AuditIntentSourceType {
  return value === 'csv_upload' ? 'csv_upload' : 'sp_api';
}

function normalizeReturnPath(value: unknown, sourceType: AuditIntentSourceType) {
  const fallback = sourceType === 'csv_upload' ? '/data-upload?returnTo=audit' : '/audit';
  const raw = String(value || fallback).trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) {
    return fallback;
  }
  return raw.slice(0, 300);
}

class AuditIntentService {
  async createIntent(input: {
    sourceType?: unknown;
    returnPath?: unknown;
    metadata?: Record<string, unknown>;
  }): Promise<AuditIntentRecord> {
    const sourceType = normalizeSourceType(input.sourceType);
    const returnPath = normalizeReturnPath(input.returnPath, sourceType);

    const { data, error } = await supabaseAdmin
      .from('audit_intents')
      .insert({
        source_type: sourceType,
        return_path: returnPath,
        status: 'pending',
        metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create audit intent: ${error?.message || 'Unknown error'}`);
    }

    return data as AuditIntentRecord;
  }

  async getIntent(intentId: string): Promise<AuditIntentRecord | null> {
    const { data, error } = await supabaseAdmin
      .from('audit_intents')
      .select('*')
      .eq('id', intentId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load audit intent: ${error.message}`);
    }

    return (data as AuditIntentRecord) || null;
  }

  async getOwnedIntent(intentId: string, userId: string): Promise<AuditIntentRecord | null> {
    const safeUserId = convertUserIdToUuid(userId);
    const { data, error } = await supabaseAdmin
      .from('audit_intents')
      .select('*')
      .eq('id', intentId)
      .eq('user_id', safeUserId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load owned audit intent: ${error.message}`);
    }

    return (data as AuditIntentRecord) || null;
  }

  async attachIntent(input: {
    intentId: string;
    userId: string;
    tenantId: string;
  }): Promise<AuditIntentRecord | null> {
    const intent = await this.getIntent(input.intentId);
    if (!intent) return null;

    const now = new Date().toISOString();
    if (new Date(intent.expires_at).getTime() <= Date.now()) {
      const { data } = await supabaseAdmin
        .from('audit_intents')
        .update({ status: 'expired', updated_at: now })
        .eq('id', input.intentId)
        .select('*')
        .maybeSingle();
      return (data as AuditIntentRecord) || null;
    }

    const safeUserId = convertUserIdToUuid(input.userId);
    if (intent.user_id && intent.user_id !== safeUserId) {
      throw new Error('Audit intent belongs to a different authenticated user.');
    }

    const { data, error } = await supabaseAdmin
      .from('audit_intents')
      .update({
        user_id: safeUserId,
        tenant_id: input.tenantId,
        status: intent.audit_run_id ? 'consumed' : 'attached',
        attached_at: intent.attached_at || now,
        updated_at: now
      })
      .eq('id', input.intentId)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to attach audit intent: ${error?.message || 'Unknown error'}`);
    }

    return data as AuditIntentRecord;
  }

  async linkAuditRun(input: {
    intentId: string;
    userId: string;
    tenantId: string;
    auditRunId: string;
  }): Promise<AuditIntentRecord | null> {
    const safeUserId = convertUserIdToUuid(input.userId);
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('audit_intents')
      .update({
        audit_run_id: input.auditRunId,
        user_id: safeUserId,
        tenant_id: input.tenantId,
        status: 'consumed',
        consumed_at: now,
        updated_at: now
      })
      .eq('id', input.intentId)
      .eq('user_id', safeUserId)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to link audit intent to audit run: ${error.message}`);
    }

    return (data as AuditIntentRecord) || null;
  }

  async abandonIntent(intentId: string, userId?: string): Promise<AuditIntentRecord | null> {
    const now = new Date().toISOString();
    let query = supabaseAdmin
      .from('audit_intents')
      .update({
        status: 'abandoned',
        abandoned_at: now,
        updated_at: now
      })
      .eq('id', intentId);

    if (userId) {
      query = query.eq('user_id', convertUserIdToUuid(userId));
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to abandon audit intent: ${error.message}`);
    }
    return (data as AuditIntentRecord) || null;
  }
}

export const auditIntentService = new AuditIntentService();
export default auditIntentService;
