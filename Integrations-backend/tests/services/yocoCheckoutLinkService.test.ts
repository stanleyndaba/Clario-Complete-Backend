import { afterEach, describe, expect, test } from '@jest/globals';
import { buildPromoNote, BillingSubscriptionRow } from '../../src/services/subscriptionBillingTruthService';
import { resolveYocoCheckoutLink } from '../../src/services/yocoCheckoutLinkService';

const ORIGINAL_ENV = {
  YOCO_STARTER_MONTHLY_URL: process.env.YOCO_STARTER_MONTHLY_URL,
  YOCO_STARTER_ANNUAL_URL: process.env.YOCO_STARTER_ANNUAL_URL,
  YOCO_PRO_MONTHLY_URL: process.env.YOCO_PRO_MONTHLY_URL,
  YOCO_PRO_ANNUAL_URL: process.env.YOCO_PRO_ANNUAL_URL,
  YOCO_ENTERPRISE_MONTHLY_URL: process.env.YOCO_ENTERPRISE_MONTHLY_URL,
  YOCO_ENTERPRISE_ANNUAL_URL: process.env.YOCO_ENTERPRISE_ANNUAL_URL,
};

function setAllLinks(): void {
  process.env.YOCO_STARTER_MONTHLY_URL = 'https://pay.yoco.com/r/7XalBE';
  process.env.YOCO_STARTER_ANNUAL_URL = 'https://pay.yoco.com/r/m6VjDE';
  process.env.YOCO_PRO_MONTHLY_URL = 'https://pay.yoco.com/r/4aKRkd';
  process.env.YOCO_PRO_ANNUAL_URL = 'https://pay.yoco.com/r/mozkwy';
  process.env.YOCO_ENTERPRISE_MONTHLY_URL = 'https://pay.yoco.com/r/7KnLO6';
  process.env.YOCO_ENTERPRISE_ANNUAL_URL = 'https://pay.yoco.com/r/73rNRK';
}

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

afterEach(() => {
  process.env.YOCO_STARTER_MONTHLY_URL = ORIGINAL_ENV.YOCO_STARTER_MONTHLY_URL;
  process.env.YOCO_STARTER_ANNUAL_URL = ORIGINAL_ENV.YOCO_STARTER_ANNUAL_URL;
  process.env.YOCO_PRO_MONTHLY_URL = ORIGINAL_ENV.YOCO_PRO_MONTHLY_URL;
  process.env.YOCO_PRO_ANNUAL_URL = ORIGINAL_ENV.YOCO_PRO_ANNUAL_URL;
  process.env.YOCO_ENTERPRISE_MONTHLY_URL = ORIGINAL_ENV.YOCO_ENTERPRISE_MONTHLY_URL;
  process.env.YOCO_ENTERPRISE_ANNUAL_URL = ORIGINAL_ENV.YOCO_ENTERPRISE_ANNUAL_URL;
});

describe('yocoCheckoutLinkService', () => {
  test('Test 1 — Starter monthly resolves to the starter_monthly YOCO link', () => {
    setAllLinks();

    const resolved = resolveYocoCheckoutLink({
      planTier: 'starter',
      billingInterval: 'monthly',
      billingAmountCents: 4900,
    });

    expect(resolved.paymentLinkKey).toBe('starter_monthly');
    expect(resolved.expectedAmountCents).toBe(4900);
    expect(resolved.paymentLinkUrl).toBe('https://pay.yoco.com/r/7XalBE');
    expect(resolved.mappingStatus).toBe('resolved');
  });

  test('Test 2 — Starter annual resolves to the starter_annual YOCO link and full annual amount', () => {
    setAllLinks();

    const resolved = resolveYocoCheckoutLink({
      planTier: 'starter',
      billingInterval: 'annual',
      billingAmountCents: 46800,
    });

    expect(resolved.paymentLinkKey).toBe('starter_annual');
    expect(resolved.expectedAmountCents).toBe(46800);
    expect(resolved.paymentLinkUrl).toBe('https://pay.yoco.com/r/m6VjDE');
    expect(resolved.mappingStatus).toBe('resolved');
  });

  test('Test 3 — Pro monthly resolves to the pro_monthly YOCO link', () => {
    setAllLinks();

    const resolved = resolveYocoCheckoutLink({
      planTier: 'pro',
      billingInterval: 'monthly',
      billingAmountCents: 9900,
    });

    expect(resolved.paymentLinkKey).toBe('pro_monthly');
    expect(resolved.expectedAmountCents).toBe(9900);
    expect(resolved.paymentLinkUrl).toBe('https://pay.yoco.com/r/4aKRkd');
    expect(resolved.mappingStatus).toBe('resolved');
  });

  test('Test 4 — Enterprise annual resolves to the enterprise_annual YOCO link', () => {
    setAllLinks();

    const resolved = resolveYocoCheckoutLink({
      planTier: 'enterprise',
      billingInterval: 'annual',
      billingAmountCents: 190800,
    });

    expect(resolved.paymentLinkKey).toBe('enterprise_annual');
    expect(resolved.expectedAmountCents).toBe(190800);
    expect(resolved.paymentLinkUrl).toBe('https://pay.yoco.com/r/73rNRK');
    expect(resolved.mappingStatus).toBe('resolved');
  });

  test('Test 5 — Missing mapping fails closed with no payment link URL', () => {
    setAllLinks();
    delete process.env.YOCO_PRO_ANNUAL_URL;

    const resolved = resolveYocoCheckoutLink({
      planTier: 'pro',
      billingInterval: 'annual',
      billingAmountCents: 94800,
    });

    expect(resolved.paymentLinkKey).toBe('pro_annual');
    expect(resolved.paymentLinkUrl).toBeNull();
    expect(resolved.mappingStatus).toBe('url_missing');
  });

  test('Test 6 — Promo period does not change YOCO link selection or invoice amount', () => {
    setAllLinks();
    const promoSubscription = buildSubscription({
      plan_tier: 'starter',
      billing_interval: 'monthly',
      billing_amount_cents: 4900,
    });

    const promoNote = buildPromoNote(promoSubscription, '2026-01-15T00:00:00.000Z');
    const resolved = resolveYocoCheckoutLink({
      planTier: promoSubscription.plan_tier,
      billingInterval: promoSubscription.billing_interval,
      billingAmountCents: promoSubscription.billing_amount_cents,
    });

    expect(promoNote).toContain('keep 100% of recoveries');
    expect(resolved.paymentLinkKey).toBe('starter_monthly');
    expect(resolved.expectedAmountCents).toBe(4900);
    expect(resolved.mappingStatus).toBe('resolved');
  });
});
