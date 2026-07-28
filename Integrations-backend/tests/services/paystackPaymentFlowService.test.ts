import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockListTenantPaymentHistory = jest.fn();
const mockGetLatestActivatedWorkspacePayment = jest.fn();

jest.mock('../../src/services/paymentRepository', () => ({
  listTenantPaymentHistory: mockListTenantPaymentHistory,
  getLatestActivatedWorkspacePayment: mockGetLatestActivatedWorkspacePayment,
  toCustomerSafePayment: (payment: any) => ({
    reference: payment.reference,
    status: payment.status,
    amount_subunits: payment.amount_subunits,
    currency: payment.currency,
    paid_at: payment.paid_at,
    created_at: payment.created_at,
  }),
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: {},
  convertUserIdToUuid: (userId: string) => userId,
}));

jest.mock('../../src/services/auditRunService', () => ({
  __esModule: true,
  default: {
    getAudit: jest.fn(),
  },
}));

describe('paystackPaymentFlowService workspace status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns inactive workspace status with backend-owned product truth', async () => {
    mockListTenantPaymentHistory.mockResolvedValue([] as never);
    mockGetLatestActivatedWorkspacePayment.mockResolvedValue(null as never);

    const { paystackPaymentFlowService } = await import('../../src/services/paystackPaymentFlowService');
    const status = await paystackPaymentFlowService.getWorkspaceStatus('tenant-1');

    expect(status).toEqual({
      product: {
        key: 'recovery_workspace_activation',
        name: 'Recovery Workspace',
        amount_subunits: 179900,
        currency: 'ZAR',
      },
      workspace: {
        activated: false,
        activated_at: null,
        audit_run_id: null,
      },
      latest_payment: null,
      payments: [],
    });
  });

  it('returns only customer-safe payment history fields', async () => {
    const payment = {
      id: 'payment-1',
      reference: 'MGN-123',
      status: 'paid',
      amount_subunits: 179900,
      currency: 'ZAR',
      paid_at: '2026-07-28T10:00:00.000Z',
      created_at: '2026-07-28T09:00:00.000Z',
      audit_run_id: 'audit-1',
      access_code: 'secret-access-code',
      authorization_url: 'https://checkout.paystack.com/secret',
      provider_response: { authorization: 'hidden' },
    };

    mockListTenantPaymentHistory.mockResolvedValue([payment] as never);
    mockGetLatestActivatedWorkspacePayment.mockResolvedValue(payment as never);

    const { paystackPaymentFlowService } = await import('../../src/services/paystackPaymentFlowService');
    const status = await paystackPaymentFlowService.getWorkspaceStatus('tenant-1');

    expect(status.workspace.activated).toBe(true);
    expect(status.latest_payment).toEqual({
      reference: 'MGN-123',
      status: 'paid',
      amount_subunits: 179900,
      currency: 'ZAR',
      paid_at: '2026-07-28T10:00:00.000Z',
      created_at: '2026-07-28T09:00:00.000Z',
    });
    expect(JSON.stringify(status)).not.toContain('secret-access-code');
    expect(JSON.stringify(status)).not.toContain('checkout.paystack.com');
    expect(JSON.stringify(status)).not.toContain('authorization');
  });
});
