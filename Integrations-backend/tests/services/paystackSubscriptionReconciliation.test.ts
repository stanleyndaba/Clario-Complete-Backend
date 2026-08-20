import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockAttach = jest.fn();
const mockGetByProviderCode = jest.fn();
const mockFetchPlan = jest.fn();
const mockListSubscriptions = jest.fn();

jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: {
    PAYSTACK_CALLBACK_URL: 'https://margin-finance.com/payment/success',
    PAYSTACK_RECOVERY_WORKSPACE_PLAN_CODE: 'PLN_margin_workspace',
  },
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: {},
  convertUserIdToUuid: (value: string) => value,
}));

jest.mock('../../src/services/auditRunService', () => ({
  __esModule: true,
  default: { getAudit: jest.fn() },
}));

jest.mock('../../src/services/billingSubscriptionRepository', () => ({
  attachPaystackSubscriptionIdentifiers: mockAttach,
  createPendingSubscription: jest.fn(),
  getSubscriptionById: jest.fn(),
  getSubscriptionByProviderCode: mockGetByProviderCode,
  getTenantRecoverySubscription: jest.fn(),
  toCustomerSafeSubscription: (value: unknown) => value,
  updateSubscriptionStatus: jest.fn(),
  upsertSubscriptionInvoice: jest.fn(),
}));

jest.mock('../../src/services/paymentRepository', () => ({
  createInitializedPayment: jest.fn(),
  createOrGetRenewalPayment: jest.fn(),
  createWebhookEvent: jest.fn(),
  getPaymentByReference: jest.fn(),
  listTenantPaymentHistory: jest.fn(),
  markPaymentFailed: jest.fn(),
  markPaymentPaid: jest.fn(),
  markPaymentPending: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
  toCustomerSafePayment: (value: unknown) => value,
}));

jest.mock('../../src/services/paystackService', () => ({
  computePaystackSignature: jest.fn(),
  disablePaystackSubscription: jest.fn(),
  enablePaystackSubscription: jest.fn(),
  fetchPaystackPlan: mockFetchPlan,
  generatePaystackSubscriptionManageLink: jest.fn(),
  getSafePaystackProviderData: (value: unknown) => value,
  initializePaystackTransaction: jest.fn(),
  listPaystackSubscriptions: mockListSubscriptions,
  verifyPaystackTransaction: jest.fn(),
}));

jest.mock('../../src/services/paymentActivationService', () => ({
  applyVerifiedPaystackActivation: jest.fn(),
}));

jest.mock('../../src/services/workspaceEntitlementService', () => ({
  __esModule: true,
  default: { getTenantEntitlement: jest.fn() },
}));

const configuredPlan = {
  id: 123,
  plan_code: 'PLN_margin_workspace',
  amount: 179900,
  currency: 'ZAR',
  interval: 'monthly',
};

const verified = {
  reference: 'MGN-SUB-existing-paid-reference',
  status: 'success',
  amount: 179900,
  currency: 'ZAR',
  customer: { customer_code: 'CUS_margin_customer', email: 'customer@margin-finance.com' },
  plan: 'PLN_margin_workspace',
  authorization: { signature: 'SIG_exact_authorization', reusable: true },
};

const providerSubscription = {
  subscription_code: 'SUB_provider_truth',
  email_token: 'email-token-for-test-only',
  status: 'active',
  next_payment_date: '2026-09-20T09:24:14.000Z',
  customer: { customer_code: 'CUS_margin_customer', email: 'customer@margin-finance.com' },
  plan: configuredPlan,
  authorization: { signature: 'SIG_exact_authorization', reusable: true },
};

const pendingSubscription = {
  id: 'local-subscription-1',
  tenant_id: 'tenant-1',
  provider: 'paystack',
  provider_subscription_code: null,
};

describe('P4-PAY-002 verified provider subscription reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchPlan.mockResolvedValue({ data: configuredPlan } as never);
    mockGetByProviderCode.mockResolvedValue(null as never);
  });

  it('accepts only an active provider subscription with the exact verified customer, plan, price, interval, currency, and authorization signature', async () => {
    const { isMatchingVerifiedProviderSubscription } = await import('../../src/services/paystackSubscriptionService');

    expect(isMatchingVerifiedProviderSubscription(providerSubscription, verified, configuredPlan)).toBe(true);
    expect(isMatchingVerifiedProviderSubscription(
      { ...providerSubscription, customer: { customer_code: 'CUS_other' } },
      verified,
      configuredPlan,
    )).toBe(false);
    expect(isMatchingVerifiedProviderSubscription(
      { ...providerSubscription, authorization: { signature: 'SIG_other' } },
      verified,
      configuredPlan,
    )).toBe(false);
    expect(isMatchingVerifiedProviderSubscription(
      { ...providerSubscription, plan: { ...configuredPlan, amount: 999 } },
      verified,
      configuredPlan,
    )).toBe(false);
  });

  it('persists only the provider-authoritative match for a paid pending subscription', async () => {
    const attached = { ...pendingSubscription, provider_subscription_code: 'SUB_provider_truth' };
    mockListSubscriptions.mockResolvedValue({ data: [providerSubscription] } as never);
    mockAttach.mockResolvedValue(attached as never);

    const { reconcileVerifiedProviderSubscription } = await import('../../src/services/paystackSubscriptionService');
    await expect(reconcileVerifiedProviderSubscription(pendingSubscription as any, verified)).resolves.toEqual(attached);

    expect(mockListSubscriptions).toHaveBeenCalledWith({ planId: 123 });
    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'local-subscription-1',
      providerSubscriptionCode: 'SUB_provider_truth',
      providerCustomerCode: 'CUS_margin_customer',
      providerPlanCode: 'PLN_margin_workspace',
    }));
  });

  it('stays pending when no authoritative provider subscription match exists', async () => {
    mockListSubscriptions.mockResolvedValue({ data: [] } as never);

    const { reconcileVerifiedProviderSubscription } = await import('../../src/services/paystackSubscriptionService');
    await expect(reconcileVerifiedProviderSubscription(pendingSubscription as any, verified)).resolves.toEqual(pendingSubscription);

    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('is idempotent when the local subscription is already attached', async () => {
    const attached = { ...pendingSubscription, provider_subscription_code: 'SUB_provider_truth' };

    const { reconcileVerifiedProviderSubscription } = await import('../../src/services/paystackSubscriptionService');
    await expect(reconcileVerifiedProviderSubscription(attached as any, verified)).resolves.toEqual(attached);

    expect(mockFetchPlan).not.toHaveBeenCalled();
    expect(mockListSubscriptions).not.toHaveBeenCalled();
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('fails closed when a matched provider code belongs to a different Margin subscription', async () => {
    mockListSubscriptions.mockResolvedValue({ data: [providerSubscription] } as never);
    mockGetByProviderCode.mockResolvedValue({ id: 'different-local-subscription' } as never);

    const { reconcileVerifiedProviderSubscription } = await import('../../src/services/paystackSubscriptionService');
    await expect(reconcileVerifiedProviderSubscription(pendingSubscription as any, verified))
      .rejects.toThrow('already attached to a different Margin subscription');

    expect(mockAttach).not.toHaveBeenCalled();
  });
});
