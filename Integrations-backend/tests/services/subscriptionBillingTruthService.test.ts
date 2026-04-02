import { describe, expect, test } from '@jest/globals';
import {
  BillingSubscriptionRow,
  buildPromoNote,
  buildPromoWindow,
  getPlanPricingCents,
  isPromoActive,
  summarizeLegacyRecoveryFees,
  summarizeSubscriptionInvoices,
} from '../../src/services/subscriptionBillingTruthService';
import { buildLegacyRecoveryBillingDisabledResult } from '../../src/services/financialWorkItemService';

function buildSubscription(overrides: Partial<BillingSubscriptionRow> = {}): BillingSubscriptionRow {
  return {
    id: 'sub_12345678',
    tenant_id: 'tenant_123',
    user_id: 'user_123',
    billing_model: 'flat_subscription',
    plan_tier: 'starter',
    billing_interval: 'monthly',
    monthly_price_cents: 4900,
    annual_monthly_equivalent_price_cents: 3900,
    billing_amount_cents: 4900,
    billing_currency: 'USD',
    promo_start_at: '2026-01-01T00:00:00.000Z',
    promo_end_at: '2026-03-02T00:00:00.000Z',
    promo_type: 'keep_100_percent_recoveries_60_days',
    subscription_status: 'active',
    current_period_start_at: '2026-03-01T00:00:00.000Z',
    current_period_end_at: '2026-04-01T00:00:00.000Z',
    next_billing_date: '2026-04-01T00:00:00.000Z',
    billing_provider: 'yoco',
    billing_customer_id: null,
    billing_subscription_id: null,
    legacy_recovery_billing_disabled_at: '2026-03-01T00:00:00.000Z',
    metadata: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('subscriptionBillingTruthService', () => {
  test('Test 1 - New tenant on Starter monthly: pricing and promo truth bootstrap correctly', () => {
    const pricing = getPlanPricingCents('starter', 'monthly');
    const promoWindow = buildPromoWindow('2026-01-01T00:00:00.000Z');
    const subscription = buildSubscription({
      promo_start_at: promoWindow.promoStartAt,
      promo_end_at: promoWindow.promoEndAt,
    });

    expect(pricing.monthlyPriceCents).toBe(4900);
    expect(pricing.annualMonthlyEquivalentPriceCents).toBe(3900);
    expect(pricing.billingAmountCents).toBe(4900);
    expect(promoWindow.promoEndAt).toBe('2026-03-02T00:00:00.000Z');
    expect(isPromoActive(subscription, '2026-01-15T00:00:00.000Z')).toBe(true);
    expect(buildPromoNote(subscription, '2026-01-15T00:00:00.000Z')).toContain('First 60 days');
  });

  test('Test 2 - Recovery happens during first 60 days: no recovery-linked billing work is created', () => {
    const subscription = buildSubscription();
    const disabled = buildLegacyRecoveryBillingDisabledResult({
      tenantId: subscription.tenant_id,
      userId: subscription.user_id || 'user_123',
      disputeCaseId: 'case_during_promo',
      recoveryId: 'recovery_during_promo',
      sourceEventType: 'recovery.completed',
      sourceEventId: 'evt_during_promo',
      payload: { promo_active: true },
    });

    expect(isPromoActive(subscription, '2026-01-20T00:00:00.000Z')).toBe(true);
    expect(disabled.created).toBe(false);
    expect(disabled.item.status).toBe('quarantined');
    expect(disabled.item.payload.legacy_recovery_billing_disabled).toBe(true);
    expect(disabled.item.payload.disabled_reason).toBe('flat_subscription_billing_model');
  });

  test('Test 3 - Recovery happens after 60 days: no commission billing reactivates', () => {
    const expiredPromoSubscription = buildSubscription({
      promo_end_at: '2026-03-02T00:00:00.000Z',
      current_period_start_at: '2026-04-01T00:00:00.000Z',
      current_period_end_at: '2026-05-01T00:00:00.000Z',
      next_billing_date: '2026-05-01T00:00:00.000Z',
    });
    const disabled = buildLegacyRecoveryBillingDisabledResult({
      tenantId: expiredPromoSubscription.tenant_id,
      userId: expiredPromoSubscription.user_id || 'user_123',
      disputeCaseId: 'case_after_promo',
      recoveryId: 'recovery_after_promo',
      sourceEventType: 'recovery.completed',
      sourceEventId: 'evt_after_promo',
      payload: { promo_active: false },
    });

    expect(isPromoActive(expiredPromoSubscription, '2026-04-15T00:00:00.000Z')).toBe(false);
    expect(buildPromoNote(expiredPromoSubscription, '2026-04-15T00:00:00.000Z')).toContain('Flat subscription pricing');
    expect(disabled.created).toBe(false);
    expect(disabled.item.status).toBe('quarantined');
  });

  test('Test 4 - Annual Pro or Enterprise: annual truth is flat subscription pricing, not success-fee logic', () => {
    const proAnnual = getPlanPricingCents('pro', 'annual');
    const enterpriseAnnual = getPlanPricingCents('enterprise', 'annual');

    expect(proAnnual.monthlyPriceCents).toBe(9900);
    expect(proAnnual.annualMonthlyEquivalentPriceCents).toBe(7900);
    expect(proAnnual.billingAmountCents).toBe(94800);
    expect(enterpriseAnnual.monthlyPriceCents).toBe(19900);
    expect(enterpriseAnnual.annualMonthlyEquivalentPriceCents).toBe(15900);
    expect(enterpriseAnnual.billingAmountCents).toBe(190800);
  });

  test('Test 5 - Legacy recovery-fee data present: legacy rows stay isolated from subscription summaries', () => {
    const currentSummary = summarizeSubscriptionInvoices([
      {
        billing_amount_cents: 9900,
        amount_charged_cents: 9900,
        status: 'paid',
        invoice_date: '2026-04-01T00:00:00.000Z',
        paid_at: '2026-04-03T00:00:00.000Z',
      },
      {
        billing_amount_cents: 9900,
        amount_charged_cents: null,
        status: 'sent',
        invoice_date: '2026-05-01T00:00:00.000Z',
        paid_at: null,
      },
    ]);
    const legacySummary = summarizeLegacyRecoveryFees([
      { amount_due_cents: 2500 },
      { amount_due_cents: 1700 },
    ]);

    expect(currentSummary.invoicesTotal).toBe(2);
    expect(currentSummary.paidInvoiceTotalCents).toBe(9900);
    expect(currentSummary.pendingInvoiceTotalCents).toBe(9900);
    expect(currentSummary.paidInvoiceCount).toBe(1);
    expect(currentSummary.pendingInvoiceCount).toBe(1);
    expect(currentSummary.lastPaidInvoiceDate).toBe('2026-04-03T00:00:00.000Z');
    expect(legacySummary.legacyRecoveryFeeCount).toBe(2);
    expect(legacySummary.legacyRecoveryFeeTotalCents).toBe(4200);
  });
});
