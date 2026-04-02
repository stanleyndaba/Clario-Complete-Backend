import { Router } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import { invoicePdfService } from '../services/invoicePdfService';
import recoveryFinancialTruthService from '../services/recoveryFinancialTruthService';
import {
  canConfirmSubscriptionInvoicePayment,
  confirmSubscriptionInvoicePayment,
} from '../services/billingInvoiceConfirmationService';
import {
  BillingInvoiceRow,
  BillingSubscriptionRow,
  billingIntervalLabel,
  buildPromoNote,
  ensureTenantBillingSubscription,
  isPromoActive,
  normalizeBillingInterval,
  normalizePlanTier,
  planTierLabel,
  summarizeLegacyRecoveryFees,
  summarizeSubscriptionInvoices,
} from '../services/subscriptionBillingTruthService';
import { hasRole, requireRole } from '../middleware/tenantMiddleware';
import { resolveYocoCheckoutLink } from '../services/yocoCheckoutLinkService';
import { createSubscriptionSubscribeIntent } from '../services/billingSubscribeIntentService';

const router = Router();

type BillingProof = {
  settlement_id: string | null;
  payout_batch_id: string | null;
  reference_ids: string[];
  event_ids: string[];
};

type BillingScope = {
  userId: string;
  tenantId: string;
};

type BillingRouteInvoice = {
  id: string;
  invoice_id: string;
  invoice_type: 'subscription_invoice' | 'legacy_recovery_fee_invoice';
  invoice_model: 'subscription' | 'legacy_recovery_fee';
  billing_model: 'flat_subscription' | 'legacy_recovery_fee';
  legacy_label: string | null;
  plan_tier: string | null;
  plan_tier_label: string | null;
  billing_interval: string | null;
  billing_interval_label: string | null;
  currency: string | null;
  period_start: string | null;
  period_end: string | null;
  total_amount: number | null;
  amount_charged: number | null;
  status: string | null;
  created_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  promo_type: string | null;
  promo_note: string | null;
  provider_invoice_id: string | null;
  provider_charge_id: string | null;
  payment_provider: 'yoco' | null;
  payment_link_key: string | null;
  payment_link_url: string | null;
  payment_confirmation_source: 'manual_dashboard' | 'manual_api' | 'legacy_status_backfill' | null;
  payment_confirmed_by_user_id: string | null;
  payment_confirmation_note: string | null;
  can_confirm_payment: boolean;
  summary_label: string | null;
  legacy_source_transaction_id: string | null;
  settlement_id?: string | null;
  payout_batch_id?: string | null;
  reference_ids?: string[];
  event_ids?: string[];
  current_subscription_plan?: string | null;
};

async function resolveBillingScope(req: any): Promise<BillingScope> {
  const userId = String((req.query.userId as string) || req.userId || '').trim();
  const tenantSlug = String((req.query.tenantSlug as string) || (req.query.tenant_slug as string) || '').trim();
  const headerTenantId = String((req.headers['x-tenant-id'] as string) || '').trim();

  if (!userId) {
    throw new Error('User ID required');
  }

  let tenantId = headerTenantId;

  if (!tenantId && tenantSlug) {
    const { data: tenantData, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', tenantSlug)
      .is('deleted_at', null)
      .maybeSingle();

    if (tenantError) {
      throw new Error('Failed to resolve tenant context');
    }

    if (!tenantData?.id) {
      throw new Error('Tenant not found');
    }

    tenantId = tenantData.id;
  }

  if (!tenantId) {
    throw new Error('Tenant context required');
  }

  return { userId, tenantId };
}

function toOptionalMoney(cents: unknown): number | null {
  const parsed = Number(cents);
  return Number.isFinite(parsed) ? Number((parsed / 100).toFixed(2)) : null;
}

function normalizeInvoiceStatus(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if ([
    'draft',
    'pending',
    'scheduled',
    'pending_payment_method',
    'sent',
    'paid',
    'failed',
    'void',
    'legacy',
    'charged',
    'credited',
    'refunded',
  ].includes(normalized)) {
    return normalized;
  }
  return null;
}

function deriveLegacyChargedAmount(status: unknown, amountDueCents: unknown): number | null {
  const normalizedStatus = normalizeInvoiceStatus(status);
  if (normalizedStatus === 'charged' || normalizedStatus === 'refunded') {
    return toOptionalMoney(amountDueCents);
  }
  if (normalizedStatus === 'credited') {
    return 0;
  }
  return null;
}

function dateSortValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

async function buildBillingProofMap(
  rows: Array<{ id: string; dispute_id?: string | null; recovery_id?: string | null }>,
  tenantId: string
): Promise<Map<string, BillingProof>> {
  const proofByRowId = new Map<string, BillingProof>();
  const directDisputeIds = new Set<string>();
  const recoveryIds: string[] = [];
  const disputeIdByRowId = new Map<string, string>();

  rows.forEach((row) => {
    const disputeId = String(row.dispute_id || '').trim();
    const recoveryId = String(row.recovery_id || '').trim();
    if (disputeId) {
      directDisputeIds.add(disputeId);
      disputeIdByRowId.set(row.id, disputeId);
    } else if (recoveryId) {
      recoveryIds.push(recoveryId);
    }
  });

  let recoveryRows: Array<{ id: string; dispute_id: string | null }> = [];
  if (recoveryIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('recoveries')
      .select('id, dispute_id')
      .eq('tenant_id', tenantId)
      .in('id', Array.from(new Set(recoveryIds)));

    recoveryRows = data || [];
  }

  const recoveryDisputeById = new Map<string, string>();
  recoveryRows.forEach((row) => {
    const disputeId = String(row.dispute_id || '').trim();
    if (disputeId) {
      recoveryDisputeById.set(row.id, disputeId);
      directDisputeIds.add(disputeId);
    }
  });

  rows.forEach((row) => {
    if (disputeIdByRowId.has(row.id)) return;
    const recoveryId = String(row.recovery_id || '').trim();
    const disputeId = recoveryDisputeById.get(recoveryId);
    if (disputeId) {
      disputeIdByRowId.set(row.id, disputeId);
    }
  });

  const disputeIds = Array.from(directDisputeIds);
  if (disputeIds.length === 0) {
    return proofByRowId;
  }

  const truth = await recoveryFinancialTruthService.getFinancialTruth({ tenantId, caseIds: disputeIds });
  const proofByDisputeId = new Map<string, BillingProof>();

  disputeIds.forEach((disputeId) => {
    const events = truth.eventsByInputId[disputeId] || [];
    const settlementIds = Array.from(new Set(events.map((event) => String(event.settlement_id || '').trim()).filter(Boolean)));
    const payoutBatchIds = Array.from(new Set(events.map((event) => String(event.payout_batch_id || '').trim()).filter(Boolean)));
    const referenceIds = Array.from(new Set(events.map((event) => String(event.reference_id || '').trim()).filter(Boolean)));
    const eventIds = Array.from(new Set(events.map((event) => String(event.event_id || '').trim()).filter(Boolean)));

    proofByDisputeId.set(disputeId, {
      settlement_id: settlementIds[0] || null,
      payout_batch_id: payoutBatchIds[0] || null,
      reference_ids: referenceIds,
      event_ids: eventIds,
    });
  });

  rows.forEach((row) => {
    const disputeId = disputeIdByRowId.get(row.id);
    if (!disputeId) return;
    proofByRowId.set(row.id, proofByDisputeId.get(disputeId) || {
      settlement_id: null,
      payout_batch_id: null,
      reference_ids: [],
      event_ids: [],
    });
  });

  return proofByRowId;
}

function toSubscriptionInvoiceRouteRow(
  invoice: BillingInvoiceRow,
  subscription: BillingSubscriptionRow | null,
  canCurrentUserConfirmPayment: boolean
): BillingRouteInvoice {
  const yocoResolution = resolveYocoCheckoutLink({
    planTier: invoice.plan_tier,
    billingInterval: invoice.billing_interval,
    billingAmountCents: invoice.billing_amount_cents,
  });

  const paymentLinkKey = invoice.payment_link_key || yocoResolution.paymentLinkKey || null;
  const paymentLinkUrl = invoice.payment_link_url || yocoResolution.paymentLinkUrl || null;
  const paymentProvider = invoice.payment_provider || (paymentLinkKey ? yocoResolution.paymentProvider : null);
  const planLabel = planTierLabel(invoice.plan_tier);
  const intervalLabel = billingIntervalLabel(invoice.billing_interval);

  return {
    id: invoice.id,
    invoice_id: invoice.invoice_id,
    invoice_type: invoice.invoice_type || 'subscription_invoice',
    invoice_model: invoice.invoice_model === 'legacy_recovery_fee' ? 'legacy_recovery_fee' : 'subscription',
    billing_model: invoice.billing_model === 'legacy_recovery_fee' ? 'legacy_recovery_fee' : 'flat_subscription',
    legacy_label: invoice.invoice_model === 'legacy_recovery_fee' ? 'Legacy Recovery Fee' : null,
    plan_tier: invoice.plan_tier,
    plan_tier_label: planLabel,
    billing_interval: invoice.billing_interval,
    billing_interval_label: intervalLabel,
    currency: invoice.currency || null,
    period_start: invoice.billing_period_start,
    period_end: invoice.billing_period_end,
    total_amount: toOptionalMoney(invoice.billing_amount_cents),
    amount_charged: toOptionalMoney(invoice.amount_charged_cents),
    status: normalizeInvoiceStatus(invoice.status),
    created_at: invoice.invoice_date || invoice.created_at,
    due_date: invoice.due_date,
    paid_at: invoice.paid_at,
    promo_type: invoice.promo_type,
    promo_note: invoice.promo_note || null,
    provider_invoice_id: invoice.provider_invoice_id || null,
    provider_charge_id: invoice.provider_charge_id || null,
    payment_provider: paymentProvider,
    payment_link_key: paymentLinkKey,
    payment_link_url: paymentLinkUrl,
    payment_confirmation_source: invoice.payment_confirmation_source || null,
    payment_confirmed_by_user_id: invoice.payment_confirmed_by_user_id || null,
    payment_confirmation_note: invoice.payment_confirmation_note || null,
    can_confirm_payment: canCurrentUserConfirmPayment && canConfirmSubscriptionInvoicePayment(invoice),
    summary_label: planLabel && intervalLabel
      ? `${planLabel} ${intervalLabel} subscription invoice`
      : 'Subscription invoice',
    legacy_source_transaction_id: invoice.legacy_source_transaction_id,
    current_subscription_plan: subscription?.plan_tier || null,
  };
}

function toLegacyInvoiceRouteRow(
  tx: any,
  proof: BillingProof | undefined,
  subscription: BillingSubscriptionRow | null
): BillingRouteInvoice {
  return {
    id: tx.id,
    invoice_id: tx.id,
    invoice_type: 'legacy_recovery_fee_invoice',
    invoice_model: 'legacy_recovery_fee',
    billing_model: 'legacy_recovery_fee',
    legacy_label: 'Legacy Recovery Fee',
    plan_tier: null,
    plan_tier_label: null,
    billing_interval: null,
    billing_interval_label: null,
    currency: tx.currency || 'USD',
    period_start: null,
    period_end: null,
    total_amount: toOptionalMoney(tx.amount_due_cents),
    amount_charged: deriveLegacyChargedAmount(tx.billing_status, tx.amount_due_cents),
    status: normalizeInvoiceStatus(tx.billing_status),
    created_at: tx.created_at || null,
    due_date: null,
    paid_at: null,
    promo_type: null,
    promo_note: null,
    provider_invoice_id: tx.paypal_invoice_id || tx.metadata?.paypal_invoice_id || null,
    provider_charge_id: tx.external_payment_id || null,
    payment_provider: null,
    payment_link_key: null,
    payment_link_url: null,
    payment_confirmation_source: null,
    payment_confirmed_by_user_id: null,
    payment_confirmation_note: null,
    can_confirm_payment: false,
    summary_label: 'Historical legacy recovery-fee record',
    legacy_source_transaction_id: tx.id,
    settlement_id: proof?.settlement_id || null,
    payout_batch_id: proof?.payout_batch_id || null,
    reference_ids: proof?.reference_ids || [],
    event_ids: proof?.event_ids || [],
    current_subscription_plan: subscription?.plan_tier || null,
  };
}

router.get('/transactions', async (req, res) => {
  try {
    const { tenantId } = await resolveBillingScope(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const { data, error, count } = await supabaseAdmin
      .from('billing_transactions')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const rows = data || [];
    const proofMap = await buildBillingProofMap(rows, tenantId);
    const transactions = rows.map((tx) => ({
      id: tx.id,
      record_type: 'legacy_recovery_fee' as const,
      billing_model: 'legacy_recovery_fee' as const,
      legacy_label: 'Legacy Recovery Fee',
      currency: tx.currency || 'USD',
      recovery_id: tx.recovery_id || null,
      amount: toOptionalMoney(tx.amount_due_cents),
      confirmed_recovered_amount: toOptionalMoney(tx.amount_recovered_cents),
      platform_fee: toOptionalMoney(tx.platform_fee_cents),
      credit_applied: toOptionalMoney(tx.credit_applied_cents),
      amount_due: toOptionalMoney(tx.amount_due_cents),
      credit_balance_remaining: toOptionalMoney(tx.credit_balance_after_cents),
      seller_payout: toOptionalMoney(tx.seller_payout_cents),
      status: normalizeInvoiceStatus(tx.billing_status),
      paypal_invoice_id: tx.paypal_invoice_id || tx.metadata?.paypal_invoice_id || null,
      settlement_id: proofMap.get(tx.id)?.settlement_id || null,
      payout_batch_id: proofMap.get(tx.id)?.payout_batch_id || null,
      reference_ids: proofMap.get(tx.id)?.reference_ids || [],
      event_ids: proofMap.get(tx.id)?.event_ids || [],
      created_at: tx.created_at,
    }));

    res.json({
      success: true,
      transactions,
      total: count || 0,
      billing_model: 'flat_subscription',
      legacy_note: 'Legacy recovery-fee records are historical only. New Margin billing uses flat subscription invoices.',
    });
  } catch (error: any) {
    logger.error('Failed to fetch billing transactions', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/subscribe-intent', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { userId, tenantId } = await resolveBillingScope(req);
    const planTier = normalizePlanTier(req.body?.plan_tier);
    const billingInterval = normalizeBillingInterval(req.body?.billing_interval);

    if (!planTier) {
      return res.status(400).json({ success: false, error: 'Valid plan_tier is required' });
    }

    if (!billingInterval) {
      return res.status(400).json({ success: false, error: 'Valid billing_interval is required' });
    }

    const result = await createSubscriptionSubscribeIntent({
      tenantId,
      userId,
      planTier,
      billingInterval,
    });

    const canCurrentUserConfirmPayment = hasRole(req, ['owner', 'admin']);
    const invoice = toSubscriptionInvoiceRouteRow(result.invoice, result.subscription, canCurrentUserConfirmPayment);

    res.json({
      success: true,
      intent_status: result.intentStatus,
      tenant_id: tenantId,
      user_id: userId,
      plan_tier: result.subscription.plan_tier,
      billing_interval: result.subscription.billing_interval,
      invoice_id: invoice.invoice_id,
      invoice,
    });
  } catch (error: any) {
    logger.error('Failed to create billing subscribe intent', {
      error: error.message,
      tenantId: (req as any).tenant?.tenantId,
      userId: (req as any).userId,
    });
    const status = /required|valid/i.test(error?.message || '') ? 400 : 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to create subscription intent' });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const { tenantId } = await resolveBillingScope(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const subscription = await ensureTenantBillingSubscription(tenantId);

    const [{ data: invoiceRows, error: invoiceError }, { data: legacyRows, error: legacyError }] = await Promise.all([
      supabaseAdmin
        .from('billing_invoices')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('invoice_date', { ascending: false }),
      supabaseAdmin
        .from('billing_transactions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
    ]);

    if (invoiceError) throw invoiceError;
    if (legacyError) throw legacyError;

    const typedInvoices = (invoiceRows || []) as BillingInvoiceRow[];
    const proofMap = await buildBillingProofMap(legacyRows || [], tenantId);
    const canCurrentUserConfirmPayment = hasRole(req, ['owner', 'admin']);

    const combined = [
      ...typedInvoices.map((invoice) => toSubscriptionInvoiceRouteRow(invoice, subscription, canCurrentUserConfirmPayment)),
      ...(legacyRows || []).map((tx) => toLegacyInvoiceRouteRow(tx, proofMap.get(tx.id), subscription)),
    ].sort((left, right) => dateSortValue(right.created_at) - dateSortValue(left.created_at));

    const invoices = combined.slice(offset, offset + limit);

    res.json({
      success: true,
      invoices,
      total: combined.length,
      billing_model: 'flat_subscription',
      subscription: subscription ? {
        id: subscription.id,
        plan_tier: subscription.plan_tier,
        billing_interval: subscription.billing_interval,
        subscription_status: subscription.subscription_status,
        promo_end_at: subscription.promo_end_at,
      } : null,
    });
  } catch (error: any) {
    logger.error('Failed to fetch billing invoices', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const { tenantId } = await resolveBillingScope(req);
    const subscription = await ensureTenantBillingSubscription(tenantId);

    const [{ data: invoiceRows, error: invoiceError }, { data: legacyRows, error: legacyError }] = await Promise.all([
      supabaseAdmin
        .from('billing_invoices')
        .select('billing_amount_cents, amount_charged_cents, status, invoice_date, paid_at')
        .eq('tenant_id', tenantId)
        .eq('invoice_model', 'subscription'),
      supabaseAdmin
        .from('billing_transactions')
        .select('amount_due_cents')
        .eq('tenant_id', tenantId),
    ]);

    if (invoiceError) throw invoiceError;
    if (legacyError) throw legacyError;

    const invoiceSummary = summarizeSubscriptionInvoices((invoiceRows || []) as Array<Pick<BillingInvoiceRow, 'billing_amount_cents' | 'amount_charged_cents' | 'status' | 'invoice_date' | 'paid_at'>>);
    const legacySummary = summarizeLegacyRecoveryFees(legacyRows || []);

    res.json({
      success: true,
      status: {
        billing_model: 'flat_subscription',
        plan_tier: subscription?.plan_tier || null,
        plan_tier_label: planTierLabel(subscription?.plan_tier || null),
        billing_interval: subscription?.billing_interval || null,
        billing_interval_label: billingIntervalLabel(subscription?.billing_interval || null),
        monthly_price: subscription ? toOptionalMoney(subscription.monthly_price_cents) : null,
        annual_monthly_equivalent_price: subscription ? toOptionalMoney(subscription.annual_monthly_equivalent_price_cents) : null,
        subscription_amount: subscription ? toOptionalMoney(subscription.billing_amount_cents) : null,
        summary_currency: subscription?.billing_currency || null,
        promo_start_at: subscription?.promo_start_at || null,
        promo_end_at: subscription?.promo_end_at || null,
        promo_type: subscription?.promo_type || null,
        promo_note: subscription ? buildPromoNote(subscription) : null,
        promo_active: subscription ? isPromoActive(subscription) : false,
        subscription_status: subscription?.subscription_status || null,
        next_billing_date: subscription?.next_billing_date || null,
        current_period_start_at: subscription?.current_period_start_at || null,
        current_period_end_at: subscription?.current_period_end_at || null,
        billing_provider: subscription?.billing_provider || null,
        billing_customer_id: subscription?.billing_customer_id || null,
        billing_subscription_id: subscription?.billing_subscription_id || null,
        legacy_recovery_billing_disabled_at: subscription?.legacy_recovery_billing_disabled_at || null,
        invoices_total: invoiceSummary.invoicesTotal,
        paid_invoice_total: toOptionalMoney(invoiceSummary.paidInvoiceTotalCents),
        pending_invoice_total: toOptionalMoney(invoiceSummary.pendingInvoiceTotalCents),
        paid_invoice_count: invoiceSummary.paidInvoiceCount,
        pending_invoice_count: invoiceSummary.pendingInvoiceCount,
        last_invoice_date: invoiceSummary.lastInvoiceDate,
        last_paid_invoice_date: invoiceSummary.lastPaidInvoiceDate,
        legacy_recovery_fee_count: legacySummary.legacyRecoveryFeeCount,
        legacy_recovery_fee_total: toOptionalMoney(legacySummary.legacyRecoveryFeeTotalCents),
      },
    });
  } catch (error: any) {
    logger.error('Failed to fetch billing status', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/invoices/:invoiceId/confirm-payment', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { userId, tenantId } = await resolveBillingScope(req);

    if (!invoiceId) {
      return res.status(400).json({ success: false, error: 'Invoice ID required' });
    }

    const confirmationSource = req.body?.confirmation_source === 'manual_api'
      ? 'manual_api'
      : 'manual_dashboard';
    const confirmationNote = typeof req.body?.confirmation_note === 'string'
      ? req.body.confirmation_note
      : null;

    const result = await confirmSubscriptionInvoicePayment({
      tenantId,
      invoiceId,
      confirmedByUserId: userId,
      confirmationSource,
      confirmationNote,
    });

    const subscription = await ensureTenantBillingSubscription(tenantId);
    const invoice = toSubscriptionInvoiceRouteRow(result.invoice, subscription, hasRole(req, ['owner', 'admin']));

    res.json({
      success: true,
      already_confirmed: result.alreadyConfirmed,
      invoice,
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to confirm invoice payment';
    const status = /not found/i.test(message) ? 404 : 400;
    logger.error('Failed to confirm billing invoice payment', {
      error: message,
      invoiceId: req.params.invoiceId,
    });
    res.status(status).json({ success: false, error: message });
  }
});

router.get('/invoices/:invoiceId/pdf', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { userId, tenantId } = await resolveBillingScope(req);

    if (!invoiceId) {
      return res.status(400).json({ success: false, error: 'Invoice ID required' });
    }

    logger.info('[BILLING] Generating PDF invoice', { invoiceId, userId, tenantId });

    const pdfBuffer = await invoicePdfService.generateInvoicePdf(invoiceId, userId, tenantId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=\"invoice-${invoiceId}.pdf\"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error: any) {
    logger.error('Failed to generate invoice PDF', { error: error.message, invoiceId: req.params.invoiceId });
    res.status(500).json({ success: false, error: 'Failed to generate invoice PDF' });
  }
});

export default router;
