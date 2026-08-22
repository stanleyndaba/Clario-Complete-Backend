import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';

export type AccountingProvider = 'quickbooks' | 'xero';
export type AccountingRecordType = 'bill' | 'purchase' | 'accpay';
export type AccountingReadStatus = 'pending' | 'verified' | 'no_data' | 'failed' | 'reconnect_required';

export interface AccountingSource {
  id: string;
  provider: AccountingProvider;
  tenant_id: string;
  user_id: string;
  status: string;
  metadata: Record<string, unknown> | null;
  account_email?: string | null;
}

export interface CanonicalAccountingRecord {
  provider: AccountingProvider;
  providerRecordId: string;
  recordType: AccountingRecordType;
  supplierName?: string | null;
  transactionDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  totalAmount?: number | null;
  lineItems: Array<Record<string, unknown>>;
  referenceNumber?: string | null;
  memo?: string | null;
  status?: string | null;
  rawData: Record<string, unknown>;
  providerUpdatedAt?: string | null;
}

export type AccountingProviderErrorKind = 'auth' | 'rate_limited' | 'provider' | 'configuration' | 'not_connected';

export class AccountingProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: AccountingProviderErrorKind,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'AccountingProviderError';
  }
}

function isAccountingProvider(value: string): value is AccountingProvider {
  return value === 'quickbooks' || value === 'xero';
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Unknown provider error');
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/refresh_token=[^&\s]+/gi, 'refresh_token=[redacted]')
    .slice(0, 500);
}

export async function resolveAccountingSource(
  userId: string,
  tenantId: string,
  provider: AccountingProvider
): Promise<AccountingSource> {
  const adminClient = supabaseAdmin || supabase;
  const dbUserId = convertUserIdToUuid(userId);
  const { data, error } = await adminClient
    .from('evidence_sources')
    .select('id, provider, tenant_id, user_id, status, metadata, account_email')
    .eq('user_id', dbUserId)
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) {
    throw new AccountingProviderError('Margin could not resolve the accounting connection for this workspace.', 'provider');
  }
  if (!data || !isAccountingProvider(data.provider)) {
    throw new AccountingProviderError('No accounting connection exists for this workspace.', 'not_connected');
  }
  if (data.status !== 'connected') {
    throw new AccountingProviderError('The accounting connection is disconnected and must be reconnected.', 'not_connected');
  }

  return data as AccountingSource;
}

export async function persistAccountingRead(input: {
  userId: string;
  tenantId: string;
  sourceId: string;
  provider: AccountingProvider;
  records: CanonicalAccountingRecord[];
}): Promise<{ recordCount: number; status: 'verified' | 'no_data'; readAt: string }> {
  const adminClient = supabaseAdmin || supabase;
  const dbUserId = convertUserIdToUuid(input.userId);
  const readAt = new Date().toISOString();

  if (input.records.length > 0) {
    const rows = input.records.map((record) => ({
      tenant_id: input.tenantId,
      user_id: dbUserId,
      provider: input.provider,
      provider_record_id: record.providerRecordId,
      record_type: record.recordType,
      supplier_name: record.supplierName || null,
      transaction_date: record.transactionDate || null,
      due_date: record.dueDate || null,
      currency: record.currency || null,
      total_amount: record.totalAmount ?? null,
      line_items: record.lineItems,
      reference_number: record.referenceNumber || null,
      memo: record.memo || null,
      status: record.status || null,
      raw_data: record.rawData,
      provider_updated_at: record.providerUpdatedAt || null,
      synced_at: readAt,
      source_id: input.sourceId,
      updated_at: readAt
    }));

    const { error } = await adminClient
      .from('accounting_records')
      .upsert(rows, { onConflict: 'tenant_id,provider,provider_record_id' });

    if (error) {
      throw new AccountingProviderError('Margin could not store the provider-read accounting evidence.', 'provider');
    }
  }

  const status: 'verified' | 'no_data' = input.records.length > 0 ? 'verified' : 'no_data';
  const { error: sourceError } = await adminClient
    .from('evidence_sources')
    .update({
      accounting_read_status: status,
      accounting_last_read_at: readAt,
      accounting_last_error: null,
      accounting_record_count: input.records.length,
      updated_at: readAt
    })
    .eq('id', input.sourceId)
    .eq('tenant_id', input.tenantId)
    .eq('user_id', dbUserId)
    .eq('provider', input.provider);

  if (sourceError) {
    throw new AccountingProviderError('Margin stored accounting evidence but could not record the connection health.', 'provider');
  }

  return { recordCount: input.records.length, status, readAt };
}

export async function recordAccountingReadFailure(input: {
  userId: string;
  tenantId: string;
  sourceId?: string;
  provider: AccountingProvider;
  error: unknown;
}): Promise<void> {
  const adminClient = supabaseAdmin || supabase;
  const dbUserId = convertUserIdToUuid(input.userId);
  const typedError = input.error instanceof AccountingProviderError ? input.error : undefined;
  const status: Extract<AccountingReadStatus, 'failed' | 'reconnect_required'> = typedError?.kind === 'auth'
    ? 'reconnect_required'
    : 'failed';

  let query = adminClient
    .from('evidence_sources')
    .update({
      accounting_read_status: status,
      accounting_last_error: sanitizeErrorMessage(input.error),
      updated_at: new Date().toISOString()
    })
    .eq('tenant_id', input.tenantId)
    .eq('user_id', dbUserId)
    .eq('provider', input.provider);

  if (input.sourceId) {
    query = query.eq('id', input.sourceId);
  }

  await query;
}

export function classifyProviderHttpError(provider: string, statusCode?: number): AccountingProviderError {
  if (statusCode === 401 || statusCode === 403) {
    return new AccountingProviderError(`${provider} authorization is no longer valid. Reconnect to restore financial evidence reads.`, 'auth', statusCode);
  }
  if (statusCode === 429) {
    return new AccountingProviderError(`${provider} rate-limited this read. Margin will retry without changing the last verified evidence state.`, 'rate_limited', statusCode);
  }
  return new AccountingProviderError(`${provider} could not complete the accounting read.`, 'provider', statusCode);
}
