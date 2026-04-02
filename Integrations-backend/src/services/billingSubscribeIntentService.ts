import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import { resolveYocoCheckoutLink } from './yocoCheckoutLinkService';
import {
  addBillingInterval,
  BillingInterval,
  BillingInvoiceRow,
  BillingSubscriptionRow,
  buildSubscriptionInvoicePayload,
  ensureTenantBillingSubscription,
  getPlanPricingCents,
  PlanTier,
} from './subscriptionBillingTruthService';

type SubscribeIntentStatus = 'created' | 'reused';

type SubscribeIntentResult = {
  intentStatus: SubscribeIntentStatus;
  subscription: BillingSubscriptionRow;
  invoice: BillingInvoiceRow;
};

const PAYABLE_INVOICE_STATUSES = new Set(['draft', 'pending', 'scheduled', 'pending_payment_method', 'sent', 'failed']);

function mapPlanTierToTenantPlan(planTier: PlanTier): 'starter' | 'professional' | 'enterprise' {
  if (planTier === 'pro') return 'professional';
  return planTier;
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

async function alignTenantPlanSelection(params: {
  tenantId: string;
  planTier: PlanTier;
  billingInterval: BillingInterval;
  userId: string;
  nowIso: string;
}): Promise<void> {
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id, plan, status, settings, metadata')
    .eq('id', params.tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (tenantError) {
    throw new Error(tenantError.message);
  }

  if (!tenant?.id) {
    throw new Error('Workspace not found');
  }

  const selectedTenantPlan = mapPlanTierToTenantPlan(params.planTier);
  const metadata = parseJsonObject(tenant.metadata);
  const settings = parseJsonObject(tenant.settings);

  const nextMetadata = {
    ...metadata,
    billing_interval: params.billingInterval,
    selected_plan_tier: params.planTier,
    billing_entrypoint: 'pricing_subscribe_intent',
    billing_plan_selected_at: params.nowIso,
    billing_plan_selected_by_user_id: params.userId,
  };

  const nextSettings = {
    ...settings,
    billing_interval: params.billingInterval,
  };

  const { error: updateError } = await supabaseAdmin
    .from('tenants')
    .update({
      plan: selectedTenantPlan,
      metadata: nextMetadata,
      settings: nextSettings,
      updated_at: params.nowIso,
    })
    .eq('id', params.tenantId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

function buildPeriodAnchor(subscription: BillingSubscriptionRow, billingInterval: BillingInterval, nowIso: string) {
  const periodStart = subscription.current_period_start_at || subscription.next_billing_date || nowIso;
  const periodEnd = subscription.current_period_end_at || addBillingInterval(periodStart, billingInterval);
  const nextBillingDate = subscription.next_billing_date || periodStart;

  return {
    periodStart,
    periodEnd,
    nextBillingDate,
  };
}

async function persistSubscriptionSelection(params: {
  subscription: BillingSubscriptionRow;
  userId: string;
  planTier: PlanTier;
  billingInterval: BillingInterval;
  nowIso: string;
}): Promise<BillingSubscriptionRow> {
  const pricing = getPlanPricingCents(params.planTier, params.billingInterval);
  const anchor = buildPeriodAnchor(params.subscription, params.billingInterval, params.nowIso);

  const updatePayload = {
    user_id: params.userId || params.subscription.user_id,
    plan_tier: params.planTier,
    billing_interval: params.billingInterval,
    monthly_price_cents: pricing.monthlyPriceCents,
    annual_monthly_equivalent_price_cents: pricing.annualMonthlyEquivalentPriceCents,
    billing_amount_cents: pricing.billingAmountCents,
    billing_provider: 'yoco',
    current_period_start_at: anchor.periodStart,
    current_period_end_at: anchor.periodEnd,
    next_billing_date: anchor.nextBillingDate,
    updated_at: params.nowIso,
  };

  const { data, error } = await supabaseAdmin
    .from('tenant_billing_subscriptions')
    .update(updatePayload)
    .eq('id', params.subscription.id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to persist subscription plan selection');
  }

  return data as BillingSubscriptionRow;
}

async function findExistingInvoice(subscription: BillingSubscriptionRow): Promise<BillingInvoiceRow | null> {
  const { data, error } = await supabaseAdmin
    .from('billing_invoices')
    .select('*')
    .eq('subscription_id', subscription.id)
    .eq('invoice_model', 'subscription')
    .eq('billing_period_start', subscription.current_period_start_at)
    .eq('billing_period_end', subscription.current_period_end_at)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data || null) as BillingInvoiceRow | null;
}

export async function createSubscriptionSubscribeIntent(params: {
  tenantId: string;
  userId: string;
  planTier: PlanTier;
  billingInterval: BillingInterval;
}): Promise<SubscribeIntentResult> {
  const nowIso = new Date().toISOString();
  await alignTenantPlanSelection({
    tenantId: params.tenantId,
    userId: params.userId,
    planTier: params.planTier,
    billingInterval: params.billingInterval,
    nowIso,
  });
  const existingSubscription = await ensureTenantBillingSubscription(params.tenantId);

  if (!existingSubscription) {
    throw new Error('Subscription billing is Not Available for this workspace');
  }

  const subscription = await persistSubscriptionSelection({
    subscription: existingSubscription,
    userId: params.userId,
    planTier: params.planTier,
    billingInterval: params.billingInterval,
    nowIso,
  });

  const yocoResolution = resolveYocoCheckoutLink({
    planTier: subscription.plan_tier,
    billingInterval: subscription.billing_interval,
    billingAmountCents: subscription.billing_amount_cents,
  });

  const invoicePayload = buildSubscriptionInvoicePayload({
    subscription,
    invoiceDateIso: nowIso,
    status: 'pending',
    provider: subscription.billing_provider || 'yoco',
    paymentProvider: yocoResolution.paymentProvider,
    paymentLinkKey: yocoResolution.paymentLinkKey,
    paymentLinkUrl: yocoResolution.paymentLinkUrl,
    amountChargedCents: null,
    userId: params.userId,
    metadata: {
      intent_source: 'pricing_entrypoint',
      invoice_mapping_status: yocoResolution.mappingStatus,
      explicit_payment_confirmation_required: true,
    },
  });

  const existingInvoice = await findExistingInvoice(subscription);

  if (existingInvoice && existingInvoice.status === 'paid') {
    logger.info('[BILLING] Reusing existing paid invoice for subscribe intent redirect', {
      tenantId: params.tenantId,
      subscriptionId: subscription.id,
      invoiceId: existingInvoice.invoice_id,
      planTier: subscription.plan_tier,
      billingInterval: subscription.billing_interval,
    });

    return {
      intentStatus: 'reused',
      subscription,
      invoice: existingInvoice,
    };
  }

  if (existingInvoice && PAYABLE_INVOICE_STATUSES.has(String(existingInvoice.status || '').toLowerCase())) {
    const { data: updatedInvoice, error: updateError } = await supabaseAdmin
      .from('billing_invoices')
      .update({
        ...invoicePayload,
        updated_at: nowIso,
      })
      .eq('id', existingInvoice.id)
      .select('*')
      .single();

    if (updateError || !updatedInvoice) {
      throw new Error(updateError?.message || 'Failed to refresh subscription invoice intent');
    }

    return {
      intentStatus: 'reused',
      subscription,
      invoice: updatedInvoice as BillingInvoiceRow,
    };
  }

  const { data: insertedInvoice, error: insertError } = await supabaseAdmin
    .from('billing_invoices')
    .insert(invoicePayload)
    .select('*')
    .single();

  if (insertError || !insertedInvoice) {
    throw new Error(insertError?.message || 'Failed to create subscription invoice intent');
  }

  logger.info('[BILLING] Created pricing subscribe intent', {
    tenantId: params.tenantId,
    subscriptionId: subscription.id,
    invoiceId: insertedInvoice.invoice_id,
    planTier: subscription.plan_tier,
    billingInterval: subscription.billing_interval,
    paymentLinkKey: insertedInvoice.payment_link_key,
  });

  return {
    intentStatus: 'created',
    subscription,
    invoice: insertedInvoice as BillingInvoiceRow,
  };
}

export default {
  createSubscriptionSubscribeIntent,
};
