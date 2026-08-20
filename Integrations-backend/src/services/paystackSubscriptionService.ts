import crypto from 'crypto';
import config from '../config/env';
import { RECOVERY_WORKSPACE_MONTHLY_PRODUCT } from '../config/paystackProducts';
import { convertUserIdToUuid, supabaseAdmin } from '../database/supabaseClient';
import auditRunService from './auditRunService';
import {
  BillingSubscriptionRecord,
  attachPaystackSubscriptionIdentifiers,
  createPendingSubscription,
  getSubscriptionById,
  getSubscriptionByProviderCode,
  getTenantRecoverySubscription,
  toCustomerSafeSubscription,
  updateSubscriptionStatus,
  upsertSubscriptionInvoice,
} from './billingSubscriptionRepository';
import {
  createInitializedPayment,
  createOrGetRenewalPayment,
  createWebhookEvent,
  getPaymentByReference,
  listTenantPaymentHistory,
  markPaymentFailed,
  markPaymentPaid,
  markPaymentPending,
  markWebhookEventProcessed,
  toCustomerSafePayment,
} from './paymentRepository';
import {
  PaystackPlanData,
  PaystackSubscriptionData,
  computePaystackSignature,
  disablePaystackSubscription,
  enablePaystackSubscription,
  fetchPaystackPlan,
  generatePaystackSubscriptionManageLink,
  getSafePaystackProviderData,
  initializePaystackTransaction,
  listPaystackSubscriptions,
  PaystackVerifyData,
  verifyPaystackTransaction,
} from './paystackService';
import { applyVerifiedPaystackActivation } from './paymentActivationService';
import workspaceEntitlementService from './workspaceEntitlementService';

const PRODUCT = RECOVERY_WORKSPACE_MONTHLY_PRODUCT;
let cachedPlan: { planCode: string; expiresAt: number } | null = null;

function generateReference(): string {
  return `MGN-SUB-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function getCallbackUrl(): string {
  const callbackUrl = config.PAYSTACK_CALLBACK_URL?.trim();
  if (!callbackUrl) throw new Error('PAYSTACK_CALLBACK_URL is not configured');
  return callbackUrl;
}

function getPlanCode(): string {
  const planCode = config.PAYSTACK_RECOVERY_WORKSPACE_PLAN_CODE?.trim();
  if (!planCode) throw new Error('PAYSTACK_RECOVERY_WORKSPACE_PLAN_CODE is not configured');
  return planCode;
}

function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function addMonth(date: Date): string {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export type WorkspaceBillingActions = {
  cancel: boolean;
  resume: boolean;
  manage: boolean;
};

export function deriveWorkspaceBillingActions(subscription: BillingSubscriptionRecord | null): WorkspaceBillingActions {
  if (!subscription) {
    return { cancel: false, resume: false, manage: false };
  }

  const providerConfirmed = Boolean(subscription.provider_subscription_code && subscription.provider_email_token);
  const paidPeriodRemaining = Boolean(
    subscription.current_period_end && new Date(subscription.current_period_end).getTime() > Date.now()
  );

  return {
    cancel: subscription.status === 'active' && providerConfirmed,
    resume: subscription.status === 'non_renewing' && providerConfirmed && paidPeriodRemaining,
    manage: Boolean(subscription.provider_subscription_code),
  };
}

function getPlanCodeFromValue(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.plan_code || value.planCode || null;
}

function getCustomerCode(value: any): string | null {
  return value?.customer?.customer_code || value?.customer_code || null;
}

function getProviderSubscriptionCode(value: any): string | null {
  return value?.subscription_code || value?.subscription?.subscription_code || value?.subscription || null;
}

function getProviderInvoiceCode(value: any): string | null {
  const invoiceCode = value?.invoice_code || value?.invoice?.invoice_code || value?.id;
  return invoiceCode ? String(invoiceCode) : null;
}

function safeProviderResponse(data: Record<string, any>) {
  return { data: getSafePaystackProviderData(data as any) };
}

function assertPlanMatches(plan: PaystackPlanData) {
  if (plan.plan_code !== getPlanCode()) throw new Error('Configured Paystack plan code mismatch');
  if (Number(plan.amount) !== PRODUCT.amountSubunits) throw new Error('Configured Paystack plan amount mismatch');
  if (String(plan.currency || '').toUpperCase() !== PRODUCT.currency) throw new Error('Configured Paystack plan currency mismatch');
  if (String(plan.interval || '').toLowerCase() !== PRODUCT.interval) throw new Error('Configured Paystack plan interval mismatch');
  if (plan.is_deleted || plan.is_archived) throw new Error('Configured Paystack plan is not usable');
}

async function ensurePaystackPlanValid() {
  const planCode = getPlanCode();
  if (cachedPlan?.planCode === planCode && cachedPlan.expiresAt > Date.now()) {
    return;
  }
  const plan = await fetchPaystackPlan(planCode);
  assertPlanMatches(plan.data);
  cachedPlan = { planCode, expiresAt: Date.now() + 5 * 60 * 1000 };
}

async function ensureTenantMembership(userId: string, tenantId: string): Promise<void> {
  const safeUserId = convertUserIdToUuid(userId);
  const { data, error } = await supabaseAdmin
    .from('tenant_memberships')
    .select('id')
    .eq('user_id', safeUserId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(`Failed to validate tenant membership: ${error.message}`);
  if (!data?.id) throw new Error('Tenant membership required');
}

function assertEligibleAudit(audit: any) {
  if (!['completed', 'failed'].includes(audit.status)) {
    throw new Error('Audit must be completed before activating Recovery Workspace');
  }
}

export type WorkspaceCommercialDecision = {
  route: string | null;
  eligibility: string | null;
};

export type WorkspaceCommercialEligibility = {
  allowed: boolean;
  code?: 'workspace_not_eligible';
  commercial: WorkspaceCommercialDecision;
};

export class WorkspaceCommercialEligibilityError extends Error {
  readonly code = 'workspace_not_eligible' as const;
  readonly status = 409;
  readonly commercial: WorkspaceCommercialDecision;

  constructor(commercial: WorkspaceCommercialDecision) {
    super('This audit does not qualify for Recovery Workspace checkout.');
    this.name = 'WorkspaceCommercialEligibilityError';
    this.commercial = commercial;
  }
}

/**
 * Workspace checkout is allowed only when persisted Audit truth explicitly
 * authorizes the current recurring Workspace product. Missing and unknown
 * commercial decisions fail closed; Recover Once qualification is not a
 * substitute for Workspace qualification.
 */
export function evaluateWorkspaceCommercialEligibility(audit: {
  commercial_route?: unknown;
  commercial_eligibility?: unknown;
}): WorkspaceCommercialEligibility {
  const commercial: WorkspaceCommercialDecision = {
    route: typeof audit.commercial_route === 'string' ? audit.commercial_route : null,
    eligibility: typeof audit.commercial_eligibility === 'string' ? audit.commercial_eligibility : null,
  };

  const allowed = commercial.eligibility === 'eligible' && (
    commercial.route === 'WORKSPACE' || commercial.route === 'RECOVERY_CONTROL'
  );

  return allowed
    ? { allowed: true, commercial }
    : { allowed: false, code: 'workspace_not_eligible', commercial };
}

function assertWorkspaceCommercialEligibility(audit: any): WorkspaceCommercialDecision {
  const eligibility = evaluateWorkspaceCommercialEligibility(audit);
  if (!eligibility.allowed) {
    throw new WorkspaceCommercialEligibilityError(eligibility.commercial);
  }
  return eligibility.commercial;
}

export function isMatchingVerifiedProviderSubscription(
  candidate: PaystackSubscriptionData,
  verified: PaystackVerifyData,
  configuredPlan: PaystackPlanData
): boolean {
  const candidatePlan = typeof candidate.plan === 'object' && candidate.plan ? candidate.plan : null;
  const candidateCode = String(candidate.subscription_code || '').trim();
  const candidateCustomerCode = String(candidate.customer?.customer_code || '').trim();
  const verifiedCustomerCode = String(verified.customer?.customer_code || '').trim();
  const candidateAuthorizationSignature = String(candidate.authorization?.signature || '').trim();
  const verifiedAuthorizationSignature = String(verified.authorization?.signature || '').trim();

  return Boolean(
    candidateCode &&
    String(candidate.status || '').toLowerCase() === 'active' &&
    candidatePlan &&
    candidatePlan.plan_code === configuredPlan.plan_code &&
    Number(candidatePlan.amount) === PRODUCT.amountSubunits &&
    String(candidatePlan.currency || '').toUpperCase() === PRODUCT.currency &&
    String(candidatePlan.interval || '').toLowerCase() === PRODUCT.interval &&
    candidateCustomerCode &&
    candidateCustomerCode === verifiedCustomerCode &&
    candidateAuthorizationSignature &&
    candidateAuthorizationSignature === verifiedAuthorizationSignature
  );
}

export async function reconcileVerifiedProviderSubscription(
  subscription: BillingSubscriptionRecord,
  verified: PaystackVerifyData
): Promise<BillingSubscriptionRecord> {
  if (subscription.provider_subscription_code) return subscription;

  const configuredPlan = await fetchPaystackPlan(getPlanCode());
  assertPlanMatches(configuredPlan.data);
  if (configuredPlan.data.id === undefined || configuredPlan.data.id === null) {
    throw new Error('Configured Paystack plan identifier is unavailable for subscription reconciliation');
  }

  const providerSubscriptions = await listPaystackSubscriptions({ planId: configuredPlan.data.id });
  const match = providerSubscriptions.data.find((candidate) =>
    isMatchingVerifiedProviderSubscription(candidate, verified, configuredPlan.data)
  );
  if (!match?.subscription_code) return subscription;

  const existing = await getSubscriptionByProviderCode(match.subscription_code);
  if (existing && existing.id !== subscription.id) {
    throw new Error('Paystack subscription is already attached to a different Margin subscription');
  }

  return attachPaystackSubscriptionIdentifiers({
    subscriptionId: subscription.id,
    providerSubscriptionCode: match.subscription_code,
    providerCustomerCode: getCustomerCode(match),
    providerPlanCode: configuredPlan.data.plan_code,
    providerEmailToken: match.email_token || null,
    nextPaymentAt: normalizeDate(match.next_payment_date),
    providerResponse: safeProviderResponse(match as Record<string, any>),
  });
}

async function activateIfReady(subscription: BillingSubscriptionRecord) {
  if (!subscription.provider_subscription_code) return subscription;

  const payments = await listTenantPaymentHistory(subscription.tenant_id);
  const paidInitial = payments.find((payment) =>
    payment.billing_subscription_id === subscription.id &&
    payment.payment_kind === 'subscription_initial' &&
    payment.status === 'paid'
  );

  if (!paidInitial) return subscription;

  const currentPeriodStart = subscription.current_period_start || paidInitial.paid_at || new Date().toISOString();
  const currentPeriodEnd = subscription.current_period_end || subscription.next_payment_at || addMonth(new Date(currentPeriodStart));
  const active = await updateSubscriptionStatus({
    subscriptionId: subscription.id,
    status: 'active',
    currentPeriodStart,
    currentPeriodEnd,
    nextPaymentAt: subscription.next_payment_at || currentPeriodEnd,
    graceExpiresAt: null,
    cancelAtPeriodEnd: false,
    latestPaymentId: paidInitial.id,
  });

  if (active.initial_audit_run_id) {
    await applyVerifiedPaystackActivation(paidInitial.reference, {
      reference: paidInitial.reference,
      status: 'success',
      amount: paidInitial.amount_subunits,
      currency: paidInitial.currency,
      paid_at: paidInitial.paid_at,
      id: paidInitial.provider_transaction_id || undefined,
    }, paidInitial.provider_response);
  }

  return active;
}

class PaystackSubscriptionService {
  async validateConfiguredPlan() {
    await ensurePaystackPlanValid();
    return { success: true, product: PRODUCT, plan_code: getPlanCode() };
  }

  async initializeSubscription(input: {
    userId: string;
    email?: string | null;
    auditRunId: string;
    tenantId?: string | null;
  }) {
    const audit = await auditRunService.getAudit(input.auditRunId, input.userId);
    const safeUserId = convertUserIdToUuid(input.userId);
    if (audit.user_id !== safeUserId) throw new Error('Audit run not found');
    if (input.tenantId && audit.tenant_id !== input.tenantId) throw new Error('Audit run not found');

    await ensureTenantMembership(input.userId, audit.tenant_id);
    assertEligibleAudit(audit);

    const existing = await getTenantRecoverySubscription(audit.tenant_id);
    if (existing) {
      const { entitlement } = await workspaceEntitlementService.getTenantEntitlement(audit.tenant_id);
      if (entitlement.entitled) {
        return {
          success: true,
          already_exists: true,
          already_entitled: true,
          subscription: toCustomerSafeSubscription(existing),
          entitlement,
          workspace: { tenant_id: audit.tenant_id },
        };
      }
      if (existing.status === 'pending') {
        return {
          success: true,
          already_exists: true,
          subscription: toCustomerSafeSubscription(existing),
          entitlement,
        };
      }
      throw new Error('Subscription recovery is required before creating a new checkout');
    }

    assertWorkspaceCommercialEligibility(audit);
    await ensurePaystackPlanValid();
    const reference = generateReference();
    const metadata = {
      internal_payment_reference: reference,
      tenant_id: audit.tenant_id,
      user_id: safeUserId,
      initial_audit_run_id: audit.id,
      product_key: PRODUCT.key,
    };

    const subscription = await createPendingSubscription({
      tenantId: audit.tenant_id,
      userId: safeUserId,
      storeId: audit.store_id || null,
      initialAuditRunId: audit.id,
      productKey: PRODUCT.key,
      providerPlanCode: getPlanCode(),
      amountSubunits: PRODUCT.amountSubunits,
      currency: PRODUCT.currency,
      metadata,
    });

    const payment = await createInitializedPayment({
      reference,
      userId: safeUserId,
      tenantId: audit.tenant_id,
      auditRunId: audit.id,
      storeId: audit.store_id || null,
      productKey: PRODUCT.key,
      amountSubunits: PRODUCT.amountSubunits,
      currency: PRODUCT.currency,
      metadata: { ...metadata, subscription_intent_id: subscription.id },
      billingSubscriptionId: subscription.id,
      paymentKind: 'subscription_initial',
    });

    const initialized = await initializePaystackTransaction({
      email: input.email || 'customer@margin-finance.com',
      amountSubunits: PRODUCT.amountSubunits,
      currency: PRODUCT.currency,
      reference,
      callbackUrl: getCallbackUrl(),
      planCode: getPlanCode(),
      metadata: {
        ...metadata,
        payment_id: payment.id,
        subscription_intent_id: subscription.id,
      },
    });

    await supabaseAdmin
      .from('payments')
      .update({
        authorization_url: initialized.data.authorization_url,
        access_code: initialized.data.access_code,
        provider_response: initialized.safeResponse,
        status: 'redirected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id);

    return {
      success: true,
      subscription_intent_id: subscription.id,
      payment_id: payment.id,
      reference,
      authorization_url: initialized.data.authorization_url,
    };
  }

  async verifyCheckout(input: { reference: string; userId: string; tenantId?: string | null }) {
    const payment = await getPaymentByReference(input.reference);
    if (!payment) return { success: false, status: 404, message: 'Payment not found' };
    if (payment.user_id !== convertUserIdToUuid(input.userId)) return { success: false, status: 404, message: 'Payment not found' };
    if (input.tenantId && payment.tenant_id !== input.tenantId) return { success: false, status: 404, message: 'Payment not found' };

    const verified = await verifyPaystackTransaction(input.reference);
    if (verified.data.status !== 'success') {
      const updated = verified.data.status === 'pending'
        ? await markPaymentPending(payment.reference, verified.safeResponse)
        : await markPaymentFailed({ reference: payment.reference, providerStatus: verified.data.status, providerResponse: verified.safeResponse });
      return { success: true, payment: toCustomerSafePayment(updated || payment), subscription_pending: true };
    }

    await markPaymentPaid({
      reference: payment.reference,
      providerTransactionId: verified.data.id ? String(verified.data.id) : null,
      providerStatus: verified.data.status,
      paidAt: verified.data.paid_at || null,
      providerResponse: verified.safeResponse,
    });

    const subscription = payment.billing_subscription_id ? await getSubscriptionById(payment.billing_subscription_id) : null;
    const providerReconciled = subscription
      ? await reconcileVerifiedProviderSubscription(subscription, verified.data)
      : null;
    const reconciled = providerReconciled ? await activateIfReady(providerReconciled) : null;
    const { entitlement } = await workspaceEntitlementService.getTenantEntitlement(payment.tenant_id);

    return {
      success: true,
      payment: toCustomerSafePayment(await getPaymentByReference(input.reference) || payment),
      subscription: toCustomerSafeSubscription(reconciled),
      entitlement,
      subscription_pending: !entitlement.entitled,
    };
  }

  async processWebhook(rawPayload: Record<string, any>, signatureHash: string) {
    const eventType = String(rawPayload?.event || '');
    const data = rawPayload?.data || {};
    const reference = typeof data?.reference === 'string' ? data.reference : null;
    const eventId = rawPayload?.id ? String(rawPayload.id) : data?.id ? `${eventType}:${String(data.id)}` : null;

    const { event, duplicate } = await createWebhookEvent({
      eventId,
      reference,
      eventType: eventType || 'unknown',
      signatureHash,
      payload: rawPayload,
    });

    if (duplicate) return { success: true, duplicate: true };

    try {
      let result: Record<string, unknown> = { ignored: true };
      if (eventType === 'charge.success') result = await this.handleChargeSuccess(data);
      else if (eventType === 'subscription.create') result = await this.handleSubscriptionCreate(data);
      else if (eventType === 'invoice.create') result = await this.handleInvoiceEvent(data, 'pending');
      else if (eventType === 'invoice.payment_failed') result = await this.handleInvoicePaymentFailed(data);
      else if (eventType === 'invoice.update') result = await this.handleInvoiceUpdate(data);
      else if (eventType === 'subscription.not_renew') result = await this.handleSubscriptionNotRenew(data);
      else if (eventType === 'subscription.disable') result = await this.handleSubscriptionDisable(data);
      else if (eventType === 'subscription.expiring_cards') result = { recorded: true, operational_signal: 'subscription_expiring_cards' };

      if (event) await markWebhookEventProcessed(event.id, result.ignored ? 'ignored' : 'processed');
      return { success: true, ...result };
    } catch (error: any) {
      if (event) await markWebhookEventProcessed(event.id, 'failed', error?.message || 'Webhook processing failed');
      throw error;
    }
  }

  async handleSubscriptionCreate(data: PaystackSubscriptionData & Record<string, any>) {
    const planCode = getPlanCodeFromValue(data.plan) || data.plan_code;
    if (planCode !== getPlanCode()) throw new Error('Paystack subscription plan mismatch');

    const subscriptionCode = getProviderSubscriptionCode(data);
    if (!subscriptionCode) throw new Error('Missing Paystack subscription code');

    let subscription: BillingSubscriptionRecord | null = null;
    const metadata = data.metadata || {};
    const internalId = String(metadata.subscription_intent_id || metadata.internal_subscription_id || '').trim();
    if (internalId) subscription = await getSubscriptionById(internalId);
    if (!subscription) subscription = await getSubscriptionByProviderCode(subscriptionCode);
    if (!subscription) throw new Error('Pending subscription intent not found');

    const attached = await attachPaystackSubscriptionIdentifiers({
      subscriptionId: subscription.id,
      providerSubscriptionCode: subscriptionCode,
      providerCustomerCode: getCustomerCode(data),
      providerPlanCode: planCode,
      providerEmailToken: data.email_token || null,
      nextPaymentAt: normalizeDate(data.next_payment_date),
      providerResponse: safeProviderResponse(data),
    });

    const reconciled = await activateIfReady(attached);
    return { processed: true, subscription_id: reconciled.id, status: reconciled.status };
  }

  async handleChargeSuccess(data: Record<string, any>) {
    const reference = String(data.reference || '').trim();
    if (!reference) throw new Error('Missing payment reference');
    const verified = await verifyPaystackTransaction(reference);
    if (verified.data.status !== 'success') return { ignored: true, provider_status: verified.data.status };
    if (Number(verified.data.amount) !== PRODUCT.amountSubunits) throw new Error('Paystack amount mismatch');
    if (String(verified.data.currency || '').toUpperCase() !== PRODUCT.currency) throw new Error('Paystack currency mismatch');

    let payment = await getPaymentByReference(reference);
    let subscription: BillingSubscriptionRecord | null = null;
    const subscriptionCode = getProviderSubscriptionCode(data) || getProviderSubscriptionCode(verified.data);
    if (subscriptionCode) subscription = await getSubscriptionByProviderCode(subscriptionCode);
    if (!subscription && payment?.billing_subscription_id) subscription = await getSubscriptionById(payment.billing_subscription_id);

    if (!payment && subscription) {
      if (!subscription.user_id) {
        throw new Error('Subscription owner is required for renewal payment');
      }
      payment = await createOrGetRenewalPayment({
        reference,
        userId: subscription.user_id,
        tenantId: subscription.tenant_id,
        billingSubscriptionId: subscription.id,
        productKey: PRODUCT.key,
        amountSubunits: PRODUCT.amountSubunits,
        currency: PRODUCT.currency,
        providerInvoiceCode: getProviderInvoiceCode(data),
        billingPeriodStart: subscription.current_period_end || new Date().toISOString(),
        billingPeriodEnd: subscription.next_payment_at || addMonth(new Date()),
        metadata: { provider_subscription_code: subscription.provider_subscription_code },
      });
    }

    if (!payment) return { ignored: true, reason: 'unknown_reference' };

    const paidPayment = await markPaymentPaid({
      reference,
      providerTransactionId: verified.data.id ? String(verified.data.id) : null,
      providerStatus: verified.data.status,
      paidAt: verified.data.paid_at || null,
      providerResponse: verified.safeResponse,
    });

    subscription = subscription || (paidPayment.billing_subscription_id ? await getSubscriptionById(paidPayment.billing_subscription_id) : null);
    if (subscription) {
      const periodStart = paidPayment.billing_period_start || subscription.current_period_end || paidPayment.paid_at || new Date().toISOString();
      const periodEnd = paidPayment.billing_period_end || normalizeDate(data.next_payment_date) || subscription.next_payment_at || addMonth(new Date(periodStart));
      const active = await updateSubscriptionStatus({
        subscriptionId: subscription.id,
        status: subscription.provider_subscription_code ? 'active' : 'pending',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextPaymentAt: normalizeDate(data.next_payment_date) || periodEnd,
        graceExpiresAt: null,
        latestPaymentId: paidPayment.id,
      });
      await activateIfReady(active);
    }

    return { processed: true, reference };
  }

  async handleInvoiceEvent(data: Record<string, any>, status: 'pending' | 'paid' | 'failed') {
    const subscriptionCode = getProviderSubscriptionCode(data);
    const subscription = subscriptionCode ? await getSubscriptionByProviderCode(subscriptionCode) : null;
    if (!subscription) return { ignored: true, reason: 'unknown_subscription' };

    await upsertSubscriptionInvoice({
      subscriptionId: subscription.id,
      tenantId: subscription.tenant_id,
      providerInvoiceCode: getProviderInvoiceCode(data),
      providerTransactionReference: data.transaction?.reference || data.reference || null,
      amountSubunits: data.amount || data.amount_due || PRODUCT.amountSubunits,
      currency: String(data.currency || PRODUCT.currency).toUpperCase(),
      status,
      dueAt: normalizeDate(data.due_date),
      paidAt: status === 'paid' ? normalizeDate(data.paid_at || data.updated_at) : null,
      failedAt: status === 'failed' ? new Date().toISOString() : null,
      billingPeriodStart: subscription.current_period_end,
      billingPeriodEnd: normalizeDate(data.next_payment_date) || subscription.next_payment_at,
      providerResponse: safeProviderResponse(data),
    });

    if (data.next_payment_date) {
      await updateSubscriptionStatus({
        subscriptionId: subscription.id,
        status: subscription.status,
        nextPaymentAt: normalizeDate(data.next_payment_date),
      });
    }
    return { processed: true, invoice_status: status };
  }

  async handleInvoicePaymentFailed(data: Record<string, any>) {
    const result = await this.handleInvoiceEvent(data, 'failed');
    const subscriptionCode = getProviderSubscriptionCode(data);
    const subscription = subscriptionCode ? await getSubscriptionByProviderCode(subscriptionCode) : null;
    if (subscription) {
      await updateSubscriptionStatus({
        subscriptionId: subscription.id,
        status: 'past_due',
        graceExpiresAt: addDays(new Date(), config.PAYSTACK_SUBSCRIPTION_GRACE_DAYS),
      });
    }
    return result;
  }

  async handleInvoiceUpdate(data: Record<string, any>) {
    const status = String(data.status || '').toLowerCase();
    if (['success', 'paid'].includes(status)) return this.handleInvoiceEvent(data, 'paid');
    if (['failed', 'payment_failed'].includes(status)) return this.handleInvoicePaymentFailed(data);
    return this.handleInvoiceEvent(data, 'pending');
  }

  async handleSubscriptionNotRenew(data: Record<string, any>) {
    const subscriptionCode = getProviderSubscriptionCode(data);
    const subscription = subscriptionCode ? await getSubscriptionByProviderCode(subscriptionCode) : null;
    if (!subscription) return { ignored: true, reason: 'unknown_subscription' };
    await updateSubscriptionStatus({
      subscriptionId: subscription.id,
      status: 'non_renewing',
      cancelAtPeriodEnd: true,
      cancelRequestedAt: new Date().toISOString(),
      providerResponse: safeProviderResponse(data),
    });
    return { processed: true, status: 'non_renewing' };
  }

  async handleSubscriptionDisable(data: Record<string, any>) {
    const subscriptionCode = getProviderSubscriptionCode(data);
    const subscription = subscriptionCode ? await getSubscriptionByProviderCode(subscriptionCode) : null;
    if (!subscription) return { ignored: true, reason: 'unknown_subscription' };
    const hasPaidTime = subscription.current_period_end && new Date(subscription.current_period_end).getTime() > Date.now();
    await updateSubscriptionStatus({
      subscriptionId: subscription.id,
      status: hasPaidTime ? 'non_renewing' : 'cancelled',
      cancelAtPeriodEnd: Boolean(hasPaidTime),
      cancelledAt: new Date().toISOString(),
      endedAt: hasPaidTime ? null : new Date().toISOString(),
      providerResponse: safeProviderResponse(data),
    });
    return { processed: true, status: hasPaidTime ? 'non_renewing' : 'cancelled' };
  }

  async getBillingStatus(tenantId: string) {
    const { subscription, entitlement } = await workspaceEntitlementService.getTenantEntitlement(tenantId);
    const payments = await listTenantPaymentHistory(tenantId);
    return {
      product: {
        key: PRODUCT.key,
        name: PRODUCT.displayName,
        amount_subunits: PRODUCT.amountSubunits,
        currency: PRODUCT.currency,
        interval: PRODUCT.interval,
      },
      subscription: toCustomerSafeSubscription(subscription),
      entitlement: {
        active: entitlement.entitled,
        ...entitlement,
      },
      actions: deriveWorkspaceBillingActions(subscription),
      latest_payment: payments[0] ? toCustomerSafePayment(payments[0]) : null,
      payments: payments.map(toCustomerSafePayment),
    };
  }

  async cancelSubscription(subscription: BillingSubscriptionRecord) {
    if (subscription.status === 'non_renewing') {
      return subscription;
    }
    if (!subscription.provider_subscription_code || !subscription.provider_email_token) {
      throw new Error('Subscription cannot be cancelled until provider details are confirmed');
    }
    await disablePaystackSubscription({
      subscriptionCode: subscription.provider_subscription_code,
      emailToken: subscription.provider_email_token,
    });
    return updateSubscriptionStatus({
      subscriptionId: subscription.id,
      status: 'non_renewing',
      cancelAtPeriodEnd: true,
      cancelRequestedAt: new Date().toISOString(),
    });
  }

  async resumeSubscription(subscription: BillingSubscriptionRecord) {
    if (subscription.status !== 'non_renewing') {
      return { subscription, new_checkout_required: false };
    }
    if (!subscription.current_period_end || new Date(subscription.current_period_end).getTime() <= Date.now()) {
      return { subscription, new_checkout_required: true };
    }
    if (!subscription.provider_subscription_code || !subscription.provider_email_token) {
      return { subscription, new_checkout_required: true };
    }
    await enablePaystackSubscription({
      subscriptionCode: subscription.provider_subscription_code,
      emailToken: subscription.provider_email_token,
    });
    const active = await updateSubscriptionStatus({
      subscriptionId: subscription.id,
      status: 'active',
      cancelAtPeriodEnd: false,
      cancelRequestedAt: null,
      cancelledAt: null,
    });
    return { subscription: active, new_checkout_required: false };
  }

  async getManageLink(subscription: BillingSubscriptionRecord) {
    if (!subscription.provider_subscription_code) {
      throw new Error('Provider subscription is not confirmed yet');
    }
    return generatePaystackSubscriptionManageLink({ subscriptionCode: subscription.provider_subscription_code });
  }

  computeWebhookSignatureHash(rawBody: Buffer | string): string {
    return computePaystackSignature(rawBody);
  }
}

export const paystackSubscriptionService = new PaystackSubscriptionService();
export default paystackSubscriptionService;
