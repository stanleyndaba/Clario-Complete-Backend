import { PoolClient } from 'pg';
import { supabaseAdmin } from '../database/supabaseClient';

export type BillingSubscriptionStatus =
  | 'pending'
  | 'active'
  | 'non_renewing'
  | 'past_due'
  | 'suspended'
  | 'cancelled'
  | 'expired';

export type BillingInterval = 'monthly';
export type SubscriptionInvoiceStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'unknown';

export type BillingSubscriptionRecord = {
  id: string;
  provider: 'paystack';
  tenant_id: string;
  user_id: string | null;
  store_id: string | null;
  initial_audit_run_id: string | null;
  product_key: string;
  provider_customer_code: string | null;
  provider_subscription_code: string | null;
  provider_plan_code: string;
  provider_email_token: string | null;
  status: BillingSubscriptionStatus;
  amount_subunits: number;
  currency: string;
  billing_interval: BillingInterval;
  current_period_start: string | null;
  current_period_end: string | null;
  next_payment_at: string | null;
  grace_expires_at: string | null;
  cancel_at_period_end: boolean;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  ended_at: string | null;
  latest_payment_id: string | null;
  metadata: Record<string, unknown>;
  provider_response: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SubscriptionEntitlement = {
  entitled: boolean;
  state: BillingSubscriptionStatus | 'none';
  access_until: string | null;
  subscription_id: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

export function toCustomerSafeSubscription(subscription: BillingSubscriptionRecord | null) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    status: subscription.status,
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
    next_payment_at: subscription.next_payment_at,
    grace_expires_at: subscription.grace_expires_at,
    cancel_at_period_end: subscription.cancel_at_period_end,
    cancelled_at: subscription.cancelled_at,
    ended_at: subscription.ended_at,
    amount_subunits: subscription.amount_subunits,
    currency: subscription.currency,
    interval: subscription.billing_interval,
  };
}

export async function createPendingSubscription(input: {
  tenantId: string;
  userId: string;
  storeId?: string | null;
  initialAuditRunId?: string | null;
  productKey: string;
  providerPlanCode: string;
  amountSubunits: number;
  currency: string;
  metadata: Record<string, unknown>;
}): Promise<BillingSubscriptionRecord> {
  const { data, error } = await supabaseAdmin
    .from('billing_subscriptions')
    .insert({
      provider: 'paystack',
      tenant_id: input.tenantId,
      user_id: input.userId,
      store_id: input.storeId || null,
      initial_audit_run_id: input.initialAuditRunId || null,
      product_key: input.productKey,
      provider_plan_code: input.providerPlanCode,
      status: 'pending',
      amount_subunits: input.amountSubunits,
      currency: input.currency,
      billing_interval: 'monthly',
      metadata: input.metadata,
      provider_response: {},
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create subscription intent: ${error?.message || 'Unknown error'}`);
  }
  return data;
}

export async function getTenantRecoverySubscription(tenantId: string): Promise<BillingSubscriptionRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('billing_subscriptions')
    .select('*')
    .eq('provider', 'paystack')
    .eq('tenant_id', tenantId)
    .eq('product_key', 'recovery_workspace_monthly')
    .in('status', ['pending', 'active', 'non_renewing', 'past_due', 'suspended'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load tenant subscription: ${error.message}`);
  return data || null;
}

export async function getSubscriptionById(id: string): Promise<BillingSubscriptionRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('billing_subscriptions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load subscription: ${error.message}`);
  return data || null;
}

export async function getSubscriptionByProviderCode(code: string): Promise<BillingSubscriptionRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('billing_subscriptions')
    .select('*')
    .eq('provider', 'paystack')
    .eq('provider_subscription_code', code)
    .maybeSingle();

  if (error) throw new Error(`Failed to load provider subscription: ${error.message}`);
  return data || null;
}

export async function attachPaystackSubscriptionIdentifiers(input: {
  subscriptionId: string;
  providerSubscriptionCode: string;
  providerCustomerCode?: string | null;
  providerPlanCode: string;
  providerEmailToken?: string | null;
  nextPaymentAt?: string | null;
  providerResponse: Record<string, unknown>;
}): Promise<BillingSubscriptionRecord> {
  const { data, error } = await supabaseAdmin
    .from('billing_subscriptions')
    .update({
      provider_subscription_code: input.providerSubscriptionCode,
      provider_customer_code: input.providerCustomerCode || null,
      provider_plan_code: input.providerPlanCode,
      provider_email_token: input.providerEmailToken || null,
      next_payment_at: input.nextPaymentAt || null,
      provider_response: input.providerResponse,
      updated_at: nowIso(),
    })
    .eq('id', input.subscriptionId)
    .select('*')
    .single();

  if (error || !data) throw new Error(`Failed to attach Paystack subscription: ${error?.message || 'Unknown error'}`);
  return data;
}

export async function updateSubscriptionStatus(input: {
  subscriptionId: string;
  status: BillingSubscriptionStatus;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  nextPaymentAt?: string | null;
  graceExpiresAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  cancelRequestedAt?: string | null;
  cancelledAt?: string | null;
  endedAt?: string | null;
  latestPaymentId?: string | null;
  providerResponse?: Record<string, unknown>;
}): Promise<BillingSubscriptionRecord> {
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: nowIso(),
  };

  if ('currentPeriodStart' in input) patch.current_period_start = input.currentPeriodStart;
  if ('currentPeriodEnd' in input) patch.current_period_end = input.currentPeriodEnd;
  if ('nextPaymentAt' in input) patch.next_payment_at = input.nextPaymentAt;
  if ('graceExpiresAt' in input) patch.grace_expires_at = input.graceExpiresAt;
  if ('cancelAtPeriodEnd' in input) patch.cancel_at_period_end = input.cancelAtPeriodEnd;
  if ('cancelRequestedAt' in input) patch.cancel_requested_at = input.cancelRequestedAt;
  if ('cancelledAt' in input) patch.cancelled_at = input.cancelledAt;
  if ('endedAt' in input) patch.ended_at = input.endedAt;
  if ('latestPaymentId' in input) patch.latest_payment_id = input.latestPaymentId;
  if (input.providerResponse) patch.provider_response = input.providerResponse;

  const { data, error } = await supabaseAdmin
    .from('billing_subscriptions')
    .update(patch)
    .eq('id', input.subscriptionId)
    .select('*')
    .single();

  if (error || !data) throw new Error(`Failed to update subscription: ${error?.message || 'Unknown error'}`);
  return data;
}

export async function upsertSubscriptionInvoice(input: {
  subscriptionId?: string | null;
  tenantId: string;
  providerInvoiceCode?: string | null;
  providerTransactionReference?: string | null;
  amountSubunits?: number | null;
  currency?: string | null;
  status: SubscriptionInvoiceStatus;
  dueAt?: string | null;
  paidAt?: string | null;
  failedAt?: string | null;
  billingPeriodStart?: string | null;
  billingPeriodEnd?: string | null;
  providerResponse: Record<string, unknown>;
}) {
  const payload = {
    provider: 'paystack',
    billing_subscription_id: input.subscriptionId || null,
    tenant_id: input.tenantId,
    provider_invoice_code: input.providerInvoiceCode || null,
    provider_transaction_reference: input.providerTransactionReference || null,
    amount_subunits: input.amountSubunits ?? null,
    currency: input.currency || null,
    status: input.status,
    due_at: input.dueAt || null,
    paid_at: input.paidAt || null,
    failed_at: input.failedAt || null,
    billing_period_start: input.billingPeriodStart || null,
    billing_period_end: input.billingPeriodEnd || null,
    provider_response: input.providerResponse,
    updated_at: nowIso(),
  };

  if (input.providerInvoiceCode) {
    const { data, error } = await supabaseAdmin
      .from('billing_subscription_invoices')
      .upsert(payload, { onConflict: 'provider,provider_invoice_code' })
      .select('*')
      .single();
    if (error || !data) throw new Error(`Failed to upsert subscription invoice: ${error?.message || 'Unknown error'}`);
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from('billing_subscription_invoices')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) throw new Error(`Failed to create subscription invoice: ${error?.message || 'Unknown error'}`);
  return data;
}

export async function lockSubscription(client: PoolClient, subscriptionId: string): Promise<BillingSubscriptionRecord | null> {
  const result = await client.query(
    'SELECT * FROM billing_subscriptions WHERE id = $1 FOR UPDATE',
    [subscriptionId]
  );
  return result.rows[0] || null;
}
