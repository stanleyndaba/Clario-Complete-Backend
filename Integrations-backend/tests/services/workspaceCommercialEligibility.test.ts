import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockGetAudit = jest.fn<(auditId: string, userId: string) => Promise<any>>();
const mockGetTenantRecoverySubscription = jest.fn<(tenantId: string) => Promise<any>>();
const mockGetTenantEntitlement = jest.fn<(tenantId: string) => Promise<any>>();
const mockCreatePendingSubscription = jest.fn<(input: any) => Promise<any>>();
const mockEnsurePaystackPlan = jest.fn<(planCode: string) => Promise<any>>();

function queryChain(result: any = { data: { id: 'membership-1' }, error: null }) {
  const chain: any = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.is = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.maybeSingle = jest.fn<() => Promise<any>>().mockResolvedValue(result);
  chain.update = jest.fn(() => chain);
  return chain;
}

const mockFrom = jest.fn(() => queryChain());

jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: {
    PAYSTACK_CALLBACK_URL: 'https://margin.test/payment/success',
    PAYSTACK_RECOVERY_WORKSPACE_PLAN_CODE: 'PLN_workspace_monthly',
  },
}));

jest.mock('../../src/database/supabaseClient', () => ({
  convertUserIdToUuid: (value: string) => value,
  supabaseAdmin: { from: mockFrom },
}));

jest.mock('../../src/services/auditRunService', () => ({
  __esModule: true,
  default: { getAudit: mockGetAudit },
}));

jest.mock('../../src/services/billingSubscriptionRepository', () => ({
  attachPaystackSubscriptionIdentifiers: jest.fn(),
  createPendingSubscription: mockCreatePendingSubscription,
  getSubscriptionById: jest.fn(),
  getSubscriptionByProviderCode: jest.fn(),
  getTenantRecoverySubscription: mockGetTenantRecoverySubscription,
  toCustomerSafeSubscription: (subscription: unknown) => subscription,
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
  toCustomerSafePayment: (payment: unknown) => payment,
}));

jest.mock('../../src/services/paystackService', () => ({
  computePaystackSignature: jest.fn(),
  disablePaystackSubscription: jest.fn(),
  enablePaystackSubscription: jest.fn(),
  fetchPaystackPlan: mockEnsurePaystackPlan,
  generatePaystackSubscriptionManageLink: jest.fn(),
  getSafePaystackProviderData: (data: unknown) => data,
  initializePaystackTransaction: jest.fn(),
  verifyPaystackTransaction: jest.fn(),
}));

jest.mock('../../src/services/paymentActivationService', () => ({
  applyVerifiedPaystackActivation: jest.fn(),
}));

jest.mock('../../src/services/workspaceEntitlementService', () => ({
  __esModule: true,
  default: { getTenantEntitlement: mockGetTenantEntitlement },
}));

import paystackSubscriptionService, {
  WorkspaceCommercialEligibilityError,
  evaluateWorkspaceCommercialEligibility,
} from '../../src/services/paystackSubscriptionService';

const userId = '11111111-1111-1111-1111-111111111111';
const tenantId = '22222222-2222-2222-2222-222222222222';

function audit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    user_id: userId,
    tenant_id: tenantId,
    store_id: null,
    status: 'completed',
    commercial_route: 'WORKSPACE',
    commercial_eligibility: 'eligible',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockImplementation(() => queryChain());
  mockGetTenantRecoverySubscription.mockResolvedValue(null);
  mockGetTenantEntitlement.mockResolvedValue({
    entitlement: { entitled: false, active: false, state: 'none', access_until: null, subscription_id: null },
  });
});

describe('Workspace commercial eligibility contract', () => {
  test.each([
    ['WORKSPACE', 'eligible'],
    ['RECOVERY_CONTROL', 'eligible'],
  ])('allows %s when persisted eligibility is %s', (route, eligibility) => {
    expect(evaluateWorkspaceCommercialEligibility({ commercial_route: route, commercial_eligibility: eligibility }))
      .toEqual({ allowed: true, commercial: { route, eligibility } });
  });

  test.each([
    ['NO_SALE', 'ineligible'],
    ['RECOVER_ONCE', 'eligible'],
    ['EVIDENCE_REMEDIATION', 'recheck_later'],
    ['NURTURE', 'manual_review'],
    ['PROVIDER_QA', 'manual_review'],
    ['unknown', 'eligible'],
    [null, null],
  ])('fails closed for %s / %s', (route, eligibility) => {
    expect(evaluateWorkspaceCommercialEligibility({ commercial_route: route, commercial_eligibility: eligibility }))
      .toEqual({
        allowed: false,
        code: 'workspace_not_eligible',
        commercial: { route, eligibility },
      });
  });

  test('direct NO_SALE initialization rejects before any provider or subscription creation', async () => {
    mockGetAudit.mockResolvedValue(audit({ commercial_route: 'NO_SALE', commercial_eligibility: 'ineligible' }));

    await expect(paystackSubscriptionService.initializeSubscription({ userId, tenantId, auditRunId: 'audit-1' }))
      .rejects.toMatchObject({ code: 'workspace_not_eligible', status: 409 });

    expect(mockCreatePendingSubscription).not.toHaveBeenCalled();
    expect(mockEnsurePaystackPlan).not.toHaveBeenCalled();
  });

  test('direct Recover Once-only initialization rejects before any provider or subscription creation', async () => {
    mockGetAudit.mockResolvedValue(audit({ commercial_route: 'RECOVER_ONCE', commercial_eligibility: 'eligible' }));

    await expect(paystackSubscriptionService.initializeSubscription({ userId, tenantId, auditRunId: 'audit-1' }))
      .rejects.toBeInstanceOf(WorkspaceCommercialEligibilityError);

    expect(mockCreatePendingSubscription).not.toHaveBeenCalled();
    expect(mockEnsurePaystackPlan).not.toHaveBeenCalled();
  });

  test('returns existing entitlement without creating another checkout', async () => {
    const existingSubscription = { id: 'sub-1', status: 'active' };
    mockGetAudit.mockResolvedValue(audit({ commercial_route: 'NO_SALE', commercial_eligibility: 'ineligible' }));
    mockGetTenantRecoverySubscription.mockResolvedValue(existingSubscription);
    mockGetTenantEntitlement.mockResolvedValue({
      entitlement: { entitled: true, active: true, state: 'active', access_until: '2026-09-01T00:00:00.000Z', subscription_id: 'sub-1' },
    });

    await expect(paystackSubscriptionService.initializeSubscription({ userId, tenantId, auditRunId: 'audit-1' }))
      .resolves.toMatchObject({
        success: true,
        already_exists: true,
        already_entitled: true,
        subscription: existingSubscription,
        workspace: { tenant_id: tenantId },
      });

    expect(mockCreatePendingSubscription).not.toHaveBeenCalled();
    expect(mockEnsurePaystackPlan).not.toHaveBeenCalled();
  });

  test('rejects an audit owned by another user before membership or payment work', async () => {
    mockGetAudit.mockResolvedValue(audit({ user_id: '33333333-3333-3333-3333-333333333333' }));

    await expect(paystackSubscriptionService.initializeSubscription({ userId, tenantId, auditRunId: 'audit-1' }))
      .rejects.toThrow('Audit run not found');

    expect(mockGetTenantRecoverySubscription).not.toHaveBeenCalled();
    expect(mockCreatePendingSubscription).not.toHaveBeenCalled();
  });

  test('rejects a cross-tenant audit before membership or payment work', async () => {
    mockGetAudit.mockResolvedValue(audit({ tenant_id: '44444444-4444-4444-4444-444444444444' }));

    await expect(paystackSubscriptionService.initializeSubscription({ userId, tenantId, auditRunId: 'audit-1' }))
      .rejects.toThrow('Audit run not found');

    expect(mockGetTenantRecoverySubscription).not.toHaveBeenCalled();
    expect(mockCreatePendingSubscription).not.toHaveBeenCalled();
  });
});
