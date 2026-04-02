import { addDays, addMonths, addYears, format } from 'date-fns';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export type PlanTier = 'starter' | 'pro' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual';
export type PromoType = 'keep_100_percent_recoveries_60_days';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'not_started';
export type SubscriptionInvoiceStatus = 'draft' | 'pending' | 'scheduled' | 'pending_payment_method' | 'sent' | 'paid' | 'failed' | 'void' | 'legacy';
export type InvoiceModel = 'subscription' | 'legacy_recovery_fee';
export type BillingModel = 'flat_subscription' | 'legacy_recovery_fee';
export type InvoiceType = 'subscription_invoice' | 'legacy_recovery_fee_invoice';

export type BillingSubscriptionRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  billing_model: BillingModel;
  plan_tier: PlanTier;
  billing_interval: BillingInterval;
  monthly_price_cents: number;
  annual_monthly_equivalent_price_cents: number;
  billing_amount_cents: number;
  billing_currency: string;
  promo_start_at: string | null;
  promo_end_at: string | null;
  promo_type: PromoType | null;
  subscription_status: SubscriptionStatus;
  current_period_start_at: string | null;
  current_period_end_at: string | null;
  next_billing_date: string | null;
  billing_provider: string | null;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
  legacy_recovery_billing_disabled_at: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
};

export type BillingInvoiceRow = {
  id: string;
  invoice_id: string;
  tenant_id: string;
  user_id: string | null;
  subscription_id: string | null;
  invoice_type: InvoiceType;
  invoice_model: InvoiceModel;
  billing_model: BillingModel;
  plan_tier: PlanTier | null;
  billing_interval: BillingInterval | null;
  billing_amount_cents: number;
  amount_charged_cents: number | null;
  currency: string;
  billing_period_start: string | null;
  billing_period_end: string | null;
  invoice_date: string;
  due_date: string | null;
  subscription_status_snapshot: string | null;
  promo_type: PromoType | null;
  promo_note: string | null;
  provider: string | null;
  provider_invoice_id: string | null;
  provider_charge_id: string | null;
  payment_provider: 'yoco' | null;
  payment_link_key: string | null;
  payment_link_url: string | null;
  status: SubscriptionInvoiceStatus;
  legacy_source_transaction_id: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionInvoiceSummary = {
  invoicesTotal: number;
  paidInvoiceTotalCents: number;
  pendingInvoiceTotalCents: number;
  paidInvoiceCount: number;
  pendingInvoiceCount: number;
  lastInvoiceDate: string | null;
  lastPaidInvoiceDate: string | null;
};

export type LegacyRecoveryFeeSummary = {
  legacyRecoveryFeeCount: number;
  legacyRecoveryFeeTotalCents: number;
};

const PLAN_PRICING_CENTS: Record<PlanTier, { monthly: number; annualEquivalent: number; annualBilled: number }> = {
  starter: { monthly: 4900, annualEquivalent: 3900, annualBilled: 46800 },
  pro: { monthly: 9900, annualEquivalent: 7900, annualBilled: 94800 },
  enterprise: { monthly: 19900, annualEquivalent: 15900, annualBilled: 190800 },
};

const SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>(['trialing', 'active', 'past_due', 'canceled', 'incomplete', 'not_started']);
const BILLING_INTERVALS = new Set<BillingInterval>(['monthly', 'annual']);

function toIso(value: Date): string {
  return value.toISOString();
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function normalizePlanTier(value: unknown): PlanTier | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'starter') return 'starter';
  if (normalized === 'pro' || normalized === 'professional') return 'pro';
  if (normalized === 'enterprise') return 'enterprise';
  return null;
}

export function normalizeBillingInterval(value: unknown): BillingInterval | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (BILLING_INTERVALS.has(normalized as BillingInterval)) return normalized as BillingInterval;
  return null;
}

export function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (SUBSCRIPTION_STATUSES.has(normalized as SubscriptionStatus)) return normalized as SubscriptionStatus;
  return null;
}

export function planTierLabel(value: PlanTier | null | undefined): string | null {
  if (value === 'starter') return 'Starter';
  if (value === 'pro') return 'Pro';
  if (value === 'enterprise') return 'Enterprise';
  return null;
}

export function billingIntervalLabel(value: BillingInterval | null | undefined): string | null {
  if (value === 'monthly') return 'Monthly';
  if (value === 'annual') return 'Annual';
  return null;
}

export function getPlanPricingCents(planTier: PlanTier, billingInterval: BillingInterval) {
  const pricing = PLAN_PRICING_CENTS[planTier];
  return {
    monthlyPriceCents: pricing.monthly,
    annualMonthlyEquivalentPriceCents: pricing.annualEquivalent,
    billingAmountCents: billingInterval === 'annual' ? pricing.annualBilled : pricing.monthly,
  };
}

export function addBillingInterval(dateIso: string, billingInterval: BillingInterval): string {
  const start = new Date(dateIso);
  if (Number.isNaN(start.getTime())) return dateIso;
  return billingInterval === 'annual'
    ? toIso(addYears(start, 1))
    : toIso(addMonths(start, 1));
}

export function buildPromoWindow(promoStartAt?: string | null): { promoStartAt: string | null; promoEndAt: string | null } {
  if (!promoStartAt) {
    return { promoStartAt: null, promoEndAt: null };
  }
  const start = new Date(promoStartAt);
  if (Number.isNaN(start.getTime())) {
    return { promoStartAt: null, promoEndAt: null };
  }
  return {
    promoStartAt: toIso(start),
    promoEndAt: toIso(addDays(start, 60)),
  };
}

export function isPromoActive(subscription: Pick<BillingSubscriptionRow, 'promo_start_at' | 'promo_end_at'>, atIso?: string | null): boolean {
  if (!subscription.promo_start_at || !subscription.promo_end_at) return false;
  const now = atIso ? new Date(atIso) : new Date();
  const start = new Date(subscription.promo_start_at);
  const end = new Date(subscription.promo_end_at);
  if ([now, start, end].some((value) => Number.isNaN(value.getTime()))) return false;
  return now >= start && now <= end;
}

export function buildPromoNote(subscription: Pick<BillingSubscriptionRow, 'promo_start_at' | 'promo_end_at' | 'promo_type'>, atIso?: string | null): string | null {
  if (subscription.promo_type !== 'keep_100_percent_recoveries_60_days') return null;
  if (isPromoActive(subscription, atIso)) {
    return 'First 60 days: you keep 100% of recoveries. Subscription pricing remains flat with no commissions.';
  }
  return 'Flat subscription pricing. No commissions, no recovery-based charges, no surprises.';
}

export function buildSubscriptionInvoiceId(subscription: Pick<BillingSubscriptionRow, 'id' | 'plan_tier'>, invoiceDateIso: string): string {
  const date = new Date(invoiceDateIso);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `SUB-${planTierLabel(subscription.plan_tier)?.toUpperCase() || 'PLAN'}-${format(safeDate, 'yyyyMMdd')}-${subscription.id.slice(0, 8).toUpperCase()}`;
}

export function deriveSubscriptionStatusFromTenantStatus(value: unknown): SubscriptionStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'trialing') return 'trialing';
  if (normalized === 'active') return 'active';
  if (normalized === 'suspended' || normalized === 'read_only') return 'past_due';
  if (normalized === 'canceled' || normalized === 'deleted') return 'canceled';
  return 'incomplete';
}

type TenantBillingSeed = {
  id: string;
  plan: string | null;
  status: string | null;
  settings: Record<string, any>;
  metadata: Record<string, any>;
  created_at: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

function deriveBootstrapSeed(tenant: TenantBillingSeed, ownerUserId: string | null): Partial<BillingSubscriptionRow> | null {
  const planTier = normalizePlanTier(tenant.plan);
  if (!planTier) return null;

  const settings = parseJsonObject(tenant.settings);
  const metadata = parseJsonObject(tenant.metadata);
  const billingInterval = normalizeBillingInterval(metadata.billing_interval || settings.billing_interval) || 'monthly';
  const createdAt = tenant.created_at || new Date().toISOString();
  const promoWindow = buildPromoWindow(createdAt);
  const pricing = getPlanPricingCents(planTier, billingInterval);
  return {
    tenant_id: tenant.id,
    user_id: ownerUserId,
    billing_model: 'flat_subscription',
    plan_tier: planTier,
    billing_interval: billingInterval,
    monthly_price_cents: pricing.monthlyPriceCents,
    annual_monthly_equivalent_price_cents: pricing.annualMonthlyEquivalentPriceCents,
    billing_amount_cents: pricing.billingAmountCents,
    billing_currency: 'USD',
    promo_start_at: promoWindow.promoStartAt,
    promo_end_at: promoWindow.promoEndAt,
    promo_type: 'keep_100_percent_recoveries_60_days',
    subscription_status: deriveSubscriptionStatusFromTenantStatus(tenant.status),
    current_period_start_at: null,
    current_period_end_at: null,
    next_billing_date: tenant.status === 'trialing' ? tenant.trial_ends_at : null,
    billing_provider: 'yoco',
    billing_customer_id: null,
    billing_subscription_id: null,
    legacy_recovery_billing_disabled_at: new Date().toISOString(),
    metadata: {
      backfilled_from_tenant_runtime: true,
      legacy_plan_value: tenant.plan,
      legacy_stripe_customer_id: tenant.stripe_customer_id || null,
      legacy_stripe_subscription_id: tenant.stripe_subscription_id || null,
    },
  };
}

async function resolveTenantOwnerUserId(tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('tenant_memberships')
    .select('user_id, role, created_at')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  const owner = (data || []).sort((left: any, right: any) => {
    const leftRank = left.role === 'owner' ? 0 : left.role === 'admin' ? 1 : 2;
    const rightRank = right.role === 'owner' ? 0 : right.role === 'admin' ? 1 : 2;
    return leftRank - rightRank;
  })[0];

  return owner?.user_id ? String(owner.user_id) : null;
}

export async function ensureTenantBillingSubscription(tenantId: string): Promise<BillingSubscriptionRow | null> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('tenant_billing_subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }
  if (existing) {
    return existing as BillingSubscriptionRow;
  }

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id, plan, status, settings, metadata, created_at, trial_ends_at, stripe_customer_id, stripe_subscription_id')
    .eq('id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (tenantError) {
    throw new Error(tenantError.message);
  }
  if (!tenant) {
    return null;
  }

  const ownerUserId = await resolveTenantOwnerUserId(tenantId);
  const seed = deriveBootstrapSeed({
    id: tenant.id,
    plan: tenant.plan,
    status: tenant.status,
    settings: parseJsonObject(tenant.settings),
    metadata: parseJsonObject(tenant.metadata),
    created_at: tenant.created_at || null,
    trial_ends_at: tenant.trial_ends_at || null,
    stripe_customer_id: tenant.stripe_customer_id || null,
    stripe_subscription_id: tenant.stripe_subscription_id || null,
  }, ownerUserId);

  if (!seed) {
    return null;
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('tenant_billing_subscriptions')
    .insert(seed)
    .select('*')
    .maybeSingle();

  if (insertError) {
    logger.warn('[SUBSCRIPTION BILLING] Failed to bootstrap tenant billing subscription', {
      tenantId,
      error: insertError.message,
    });
    return null;
  }

  return (inserted || null) as BillingSubscriptionRow | null;
}

export function buildSubscriptionInvoicePayload(params: {
  subscription: BillingSubscriptionRow;
  invoiceDateIso?: string;
  status: SubscriptionInvoiceStatus;
  provider?: string | null;
  providerInvoiceId?: string | null;
  providerChargeId?: string | null;
  paymentProvider?: 'yoco' | null;
  paymentLinkKey?: string | null;
  paymentLinkUrl?: string | null;
  amountChargedCents?: number | null;
  userId?: string | null;
  metadata?: Record<string, any>;
}): Omit<BillingInvoiceRow, 'id' | 'created_at' | 'updated_at'> {
  const invoiceDateIso = params.invoiceDateIso || new Date().toISOString();
  const periodStart = params.subscription.current_period_start_at || params.subscription.next_billing_date || invoiceDateIso;
  const periodEnd = params.subscription.current_period_end_at || addBillingInterval(periodStart, params.subscription.billing_interval);

  return {
    invoice_id: buildSubscriptionInvoiceId(params.subscription, invoiceDateIso),
    tenant_id: params.subscription.tenant_id,
    user_id: params.userId ?? params.subscription.user_id,
    subscription_id: params.subscription.id,
    invoice_type: 'subscription_invoice',
    invoice_model: 'subscription',
    billing_model: 'flat_subscription',
    plan_tier: params.subscription.plan_tier,
    billing_interval: params.subscription.billing_interval,
    billing_amount_cents: params.subscription.billing_amount_cents,
    amount_charged_cents: params.amountChargedCents ?? null,
    currency: params.subscription.billing_currency,
    billing_period_start: periodStart,
    billing_period_end: periodEnd,
    invoice_date: invoiceDateIso,
    due_date: ['pending', 'pending_payment_method', 'sent', 'scheduled'].includes(params.status)
      ? periodEnd
      : null,
    subscription_status_snapshot: params.subscription.subscription_status,
    promo_type: params.subscription.promo_type,
    promo_note: buildPromoNote(params.subscription, invoiceDateIso),
    provider: params.provider || params.subscription.billing_provider || null,
    provider_invoice_id: params.providerInvoiceId || null,
    provider_charge_id: params.providerChargeId || null,
    payment_provider: params.paymentProvider || null,
    payment_link_key: params.paymentLinkKey || null,
    payment_link_url: params.paymentLinkUrl || null,
    status: params.status,
    legacy_source_transaction_id: null,
    metadata: {
      ...(params.metadata || {}),
      next_billing_date_snapshot: params.subscription.next_billing_date,
      legacy_recovery_billing_disabled_at: params.subscription.legacy_recovery_billing_disabled_at,
    },
  };
}

export async function upsertSubscriptionInvoice(payload: Omit<BillingInvoiceRow, 'id' | 'created_at' | 'updated_at'>): Promise<BillingInvoiceRow> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('billing_invoices')
    .select('*')
    .eq('subscription_id', payload.subscription_id)
    .eq('billing_period_start', payload.billing_period_start)
    .eq('billing_period_end', payload.billing_period_end)
    .eq('invoice_model', 'subscription')
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('billing_invoices')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (updateError || !updated) {
      throw new Error(updateError?.message || 'Failed to update billing invoice');
    }
    return updated as BillingInvoiceRow;
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('billing_invoices')
    .insert(payload)
    .select('*')
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message || 'Failed to insert billing invoice');
  }

  return inserted as BillingInvoiceRow;
}

export async function advanceSubscriptionBillingWindow(subscription: BillingSubscriptionRow, invoice: Pick<BillingInvoiceRow, 'billing_period_start' | 'billing_period_end' | 'status'>): Promise<void> {
  if (invoice.status === 'failed') {
    const { error } = await supabaseAdmin
      .from('tenant_billing_subscriptions')
      .update({
        subscription_status: 'past_due',
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscription.id);

    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  const nextPeriodStart = invoice.billing_period_end || subscription.current_period_end_at || subscription.next_billing_date;
  const nextPeriodEnd = nextPeriodStart ? addBillingInterval(nextPeriodStart, subscription.billing_interval) : null;
  const nextBillingDate = nextPeriodEnd ? nextPeriodStart : null;

  const { error } = await supabaseAdmin
    .from('tenant_billing_subscriptions')
    .update({
      current_period_start_at: nextPeriodStart,
      current_period_end_at: nextPeriodEnd,
      next_billing_date: nextBillingDate,
      subscription_status: subscription.subscription_status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscription.id);

  if (error) {
    throw new Error(error.message);
  }
}

export function summarizeSubscriptionInvoices(rows: Array<Pick<BillingInvoiceRow, 'billing_amount_cents' | 'amount_charged_cents' | 'status' | 'invoice_date'>>): SubscriptionInvoiceSummary {
  const pendingStatuses = new Set(['draft', 'pending', 'scheduled', 'pending_payment_method', 'sent']);
  const paidStatuses = new Set(['paid']);
  const normalizedRows = rows || [];

  return {
    invoicesTotal: normalizedRows.length,
    paidInvoiceTotalCents: normalizedRows
      .filter((row) => paidStatuses.has(String(row.status || '').toLowerCase()))
      .reduce((sum, row) => sum + Number(row.amount_charged_cents || 0), 0),
    pendingInvoiceTotalCents: normalizedRows
      .filter((row) => pendingStatuses.has(String(row.status || '').toLowerCase()))
      .reduce((sum, row) => sum + Number(row.billing_amount_cents || 0), 0),
    paidInvoiceCount: normalizedRows.filter((row) => paidStatuses.has(String(row.status || '').toLowerCase())).length,
    pendingInvoiceCount: normalizedRows.filter((row) => pendingStatuses.has(String(row.status || '').toLowerCase())).length,
    lastInvoiceDate: normalizedRows
      .map((row) => row.invoice_date)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null,
    lastPaidInvoiceDate: normalizedRows
      .filter((row) => paidStatuses.has(String(row.status || '').toLowerCase()))
      .map((row) => row.invoice_date)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null,
  };
}

export function summarizeLegacyRecoveryFees(rows: Array<{ amount_due_cents?: number | null }>): LegacyRecoveryFeeSummary {
  const normalizedRows = rows || [];
  return {
    legacyRecoveryFeeCount: normalizedRows.length,
    legacyRecoveryFeeTotalCents: normalizedRows.reduce((sum, row) => sum + Number(row.amount_due_cents || 0), 0),
  };
}

export default {
  ensureTenantBillingSubscription,
  normalizePlanTier,
  normalizeBillingInterval,
  normalizeSubscriptionStatus,
  planTierLabel,
  billingIntervalLabel,
  getPlanPricingCents,
  buildPromoWindow,
  buildPromoNote,
  buildSubscriptionInvoiceId,
  buildSubscriptionInvoicePayload,
  upsertSubscriptionInvoice,
  advanceSubscriptionBillingWindow,
  summarizeSubscriptionInvoices,
  summarizeLegacyRecoveryFees,
  addBillingInterval,
  isPromoActive,
};
