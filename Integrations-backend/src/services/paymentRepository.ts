import { supabaseAdmin } from '../database/supabaseClient';

export type PaymentStatus =
  | 'initialized'
  | 'redirected'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'abandoned'
  | 'cancelled';

export type PaymentRow = {
  id: string;
  provider: 'paystack';
  reference: string;
  access_code: string | null;
  authorization_url: string | null;
  user_id: string;
  tenant_id: string;
  audit_run_id: string | null;
  store_id: string | null;
  product_key: string;
  amount_subunits: number;
  currency: string;
  status: PaymentStatus;
  provider_transaction_id: string | null;
  provider_status: string | null;
  paid_at: string | null;
  verified_at: string | null;
  metadata: Record<string, unknown>;
  provider_response: Record<string, unknown>;
  billing_subscription_id: string | null;
  provider_invoice_code: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  payment_kind: 'subscription_initial' | 'subscription_renewal' | null;
  created_at: string;
  updated_at: string;
};

export type WebhookEventRow = {
  id: string;
  provider: 'paystack';
  event_id: string | null;
  reference: string | null;
  event_type: string;
  signature_hash: string;
  payload: Record<string, unknown>;
  status: 'received' | 'processed' | 'ignored' | 'failed';
  processed_at: string | null;
  error: string | null;
  created_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

export function toCustomerSafePayment(payment: PaymentRow) {
  return {
    reference: payment.reference,
    status: payment.status,
    amount_subunits: payment.amount_subunits,
    currency: payment.currency,
    paid_at: payment.paid_at,
    created_at: payment.created_at,
    payment_kind: payment.payment_kind,
  };
}

export async function createInitializedPayment(input: {
  reference: string;
  userId: string;
  tenantId: string;
  auditRunId: string;
  storeId?: string | null;
  productKey: string;
  amountSubunits: number;
  currency: string;
  metadata: Record<string, unknown>;
  billingSubscriptionId?: string | null;
  paymentKind?: 'subscription_initial' | 'subscription_renewal' | null;
}): Promise<PaymentRow> {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .insert({
      provider: 'paystack',
      reference: input.reference,
      user_id: input.userId,
      tenant_id: input.tenantId,
      audit_run_id: input.auditRunId,
      store_id: input.storeId || null,
      product_key: input.productKey,
      amount_subunits: input.amountSubunits,
      currency: input.currency,
      status: 'initialized',
      metadata: input.metadata,
      provider_response: {},
      billing_subscription_id: input.billingSubscriptionId || null,
      payment_kind: input.paymentKind || null,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create payment: ${error?.message || 'Unknown error'}`);
  }

  return data;
}

export async function createOrGetRenewalPayment(input: {
  reference: string;
  userId: string;
  tenantId: string;
  billingSubscriptionId: string;
  productKey: string;
  amountSubunits: number;
  currency: string;
  providerInvoiceCode?: string | null;
  billingPeriodStart?: string | null;
  billingPeriodEnd?: string | null;
  metadata: Record<string, unknown>;
}): Promise<PaymentRow> {
  const existing = await getPaymentByReference(input.reference);
  if (existing) return existing;
  if (!input.userId) {
    throw new Error('Renewal payment requires a subscription owner');
  }

  const { data, error } = await supabaseAdmin
    .from('payments')
    .insert({
      provider: 'paystack',
      reference: input.reference,
      user_id: input.userId,
      tenant_id: input.tenantId,
      billing_subscription_id: input.billingSubscriptionId,
      product_key: input.productKey,
      amount_subunits: input.amountSubunits,
      currency: input.currency,
      status: 'initialized',
      payment_kind: 'subscription_renewal',
      provider_invoice_code: input.providerInvoiceCode || null,
      billing_period_start: input.billingPeriodStart || null,
      billing_period_end: input.billingPeriodEnd || null,
      metadata: input.metadata,
      provider_response: {},
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create renewal payment: ${error?.message || 'Unknown error'}`);
  }

  return data;
}

export async function getPaymentByReference(reference: string): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load payment: ${error.message}`);
  }

  return data || null;
}

export async function getCurrentPaidActivationPayment(auditRunId: string): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('audit_run_id', auditRunId)
    .eq('provider', 'paystack')
    .in('product_key', ['recovery_workspace_activation', 'recovery_workspace_monthly'])
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load activation payment: ${error.message}`);
  }

  return data || null;
}

export async function updatePaystackInitializationData(input: {
  paymentId: string;
  authorizationUrl: string;
  accessCode: string;
  providerResponse: Record<string, unknown>;
}): Promise<PaymentRow> {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .update({
      authorization_url: input.authorizationUrl,
      access_code: input.accessCode,
      provider_response: input.providerResponse,
      status: 'redirected',
      updated_at: nowIso(),
    })
    .eq('id', input.paymentId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to update Paystack initialization: ${error?.message || 'Unknown error'}`);
  }

  return data;
}

export async function markPaymentPending(reference: string, providerResponse: Record<string, unknown>): Promise<PaymentRow> {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .update({
      status: 'pending',
      provider_response: providerResponse,
      verified_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('reference', reference)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to mark payment pending: ${error?.message || 'Unknown error'}`);
  }

  return data;
}

export async function markPaymentFailed(input: {
  paymentId?: string;
  reference?: string;
  providerStatus?: string | null;
  providerResponse?: Record<string, unknown>;
}): Promise<PaymentRow | null> {
  let query = supabaseAdmin
    .from('payments')
    .update({
      status: 'failed',
      provider_status: input.providerStatus || 'failed',
      provider_response: input.providerResponse || {},
      verified_at: nowIso(),
      updated_at: nowIso(),
    })
    .select('*');

  query = input.paymentId ? query.eq('id', input.paymentId) : query.eq('reference', input.reference);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Failed to mark payment failed: ${error.message}`);
  }

  return data || null;
}

export async function markPaymentPaid(input: {
  reference: string;
  providerTransactionId?: string | null;
  providerStatus?: string | null;
  paidAt?: string | null;
  providerResponse: Record<string, unknown>;
}): Promise<PaymentRow> {
  const paidAt = input.paidAt || nowIso();
  const { data, error } = await supabaseAdmin
    .from('payments')
    .update({
      status: 'paid',
      provider_transaction_id: input.providerTransactionId || null,
      provider_status: input.providerStatus || 'success',
      paid_at: paidAt,
      verified_at: nowIso(),
      provider_response: input.providerResponse,
      updated_at: nowIso(),
    })
    .eq('reference', input.reference)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to mark payment paid: ${error?.message || 'Unknown error'}`);
  }

  return data;
}

export async function listTenantPaymentHistory(tenantId: string): Promise<PaymentRow[]> {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(`Failed to load payment history: ${error.message}`);
  }

  return data || [];
}

export async function getLatestActivatedWorkspacePayment(tenantId: string): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('provider', 'paystack')
    .in('product_key', ['recovery_workspace_activation', 'recovery_workspace_monthly'])
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load workspace activation payment: ${error.message}`);
  }

  return data || null;
}

export async function createWebhookEvent(input: {
  eventId?: string | null;
  reference?: string | null;
  eventType: string;
  signatureHash: string;
  payload: Record<string, unknown>;
}): Promise<{ event: WebhookEventRow | null; duplicate: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('payment_webhook_events')
    .insert({
      provider: 'paystack',
      event_id: input.eventId || null,
      reference: input.reference || null,
      event_type: input.eventType,
      signature_hash: input.signatureHash,
      payload: input.payload,
      status: 'received',
    })
    .select('*')
    .single();

  if (error) {
    const code = String(error.code || '');
    if (code === '23505' || /duplicate/i.test(error.message || '')) {
      return { event: null, duplicate: true };
    }
    throw new Error(`Failed to create webhook event: ${error.message}`);
  }

  return { event: data, duplicate: false };
}

export async function markWebhookEventProcessed(id: string, status: 'processed' | 'ignored' | 'failed', error?: string) {
  const { data, error: updateError } = await supabaseAdmin
    .from('payment_webhook_events')
    .update({
      status,
      error: error || null,
      processed_at: nowIso(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updateError || !data) {
    throw new Error(`Failed to update webhook event: ${updateError?.message || 'Unknown error'}`);
  }

  return data as WebhookEventRow;
}
