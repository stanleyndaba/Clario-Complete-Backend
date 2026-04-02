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
