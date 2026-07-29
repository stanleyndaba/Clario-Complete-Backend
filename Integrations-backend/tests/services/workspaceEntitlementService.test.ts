import { describe, expect, it } from '@jest/globals';
import { BillingSubscriptionRecord } from '../../src/services/billingSubscriptionRepository';
import { deriveSubscriptionEntitlement } from '../../src/services/workspaceEntitlementService';

function subscription(overrides: Partial<BillingSubscriptionRecord>): BillingSubscriptionRecord {
  return {
    id: 'sub-1',
    provider: 'paystack',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    store_id: null,
    initial_audit_run_id: 'audit-1',
    product_key: 'recovery_workspace_monthly',
    provider_subscription_code: null,
    provider_customer_code: null,
    provider_plan_code: 'PLN_margin',
    provider_email_token: null,
    status: 'pending',
    amount_subunits: 179900,
    currency: 'ZAR',
    billing_interval: 'monthly',
    current_period_start: null,
    current_period_end: null,
    next_payment_at: null,
    grace_expires_at: null,
    cancel_at_period_end: false,
    cancel_requested_at: null,
    cancelled_at: null,
    ended_at: null,
    latest_payment_id: null,
    metadata: {},
    provider_response: {},
    created_at: '2026-07-28T00:00:00.000Z',
    updated_at: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('workspaceEntitlementService', () => {
  it('does not entitle tenants without a subscription', () => {
    expect(deriveSubscriptionEntitlement(null)).toEqual({
      entitled: false,
      state: 'none',
      access_until: null,
      subscription_id: null,
    });
  });

  it('entitles active subscriptions', () => {
    const entitlement = deriveSubscriptionEntitlement(subscription({
      status: 'active',
      current_period_end: '2099-01-01T00:00:00.000Z',
    }));

    expect(entitlement.entitled).toBe(true);
    expect(entitlement.state).toBe('active');
    expect(entitlement.access_until).toBe('2099-01-01T00:00:00.000Z');
  });

  it('keeps access during a past-due grace window', () => {
    const entitlement = deriveSubscriptionEntitlement(subscription({
      status: 'past_due',
      grace_expires_at: '2099-01-04T00:00:00.000Z',
    }));

    expect(entitlement.entitled).toBe(true);
    expect(entitlement.state).toBe('past_due');
    expect(entitlement.access_until).toBe('2099-01-04T00:00:00.000Z');
  });

  it('blocks cancelled subscriptions', () => {
    const entitlement = deriveSubscriptionEntitlement(subscription({
      status: 'cancelled',
      ended_at: '2026-07-28T00:00:00.000Z',
    }));

    expect(entitlement.entitled).toBe(false);
    expect(entitlement.state).toBe('cancelled');
  });
});
