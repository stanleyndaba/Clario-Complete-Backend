import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockWithPostgresTransaction = jest.fn();

jest.mock('../../src/database/postgresTransaction', () => ({
  withPostgresTransaction: mockWithPostgresTransaction,
}));

describe('paymentActivationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks payment paid and activates the linked audit in one transaction', async () => {
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: any[]) => {
        queries.push(sql);

        if (sql.includes('SELECT *') && sql.includes('FROM payments')) {
          return {
            rows: [{
              id: 'payment-1',
              reference: 'MGN-123',
              user_id: 'user-1',
              tenant_id: 'tenant-1',
              audit_run_id: 'audit-1',
              product_key: 'recovery_workspace_activation',
              amount_subunits: 179900,
              currency: 'ZAR',
              status: 'redirected',
              created_at: '2026-07-28T00:00:00.000Z',
            }],
          };
        }

        if (sql.includes('UPDATE payments')) {
          expect(params[0]).toBe('payment-1');
          return {
            rows: [{
              reference: 'MGN-123',
              status: 'paid',
              amount_subunits: 179900,
              currency: 'ZAR',
              paid_at: '2026-07-28T10:00:00.000Z',
              created_at: '2026-07-28T00:00:00.000Z',
            }],
          };
        }

        if (sql.includes('UPDATE audit_runs')) {
          expect(params).toEqual(expect.arrayContaining(['audit-1', 'payment-1', 'user-1', 'tenant-1']));
          return {
            rows: [{
              id: 'audit-1',
              activation_status: 'activated',
              activated_at: '2026-07-28T10:00:01.000Z',
            }],
          };
        }

        return { rows: [] };
      }),
    };

    mockWithPostgresTransaction.mockImplementation(async (operation: any) => operation(client));

    const { applyVerifiedPaystackActivation } = await import('../../src/services/paymentActivationService');
    const result = await applyVerifiedPaystackActivation('MGN-123', {
      id: 42,
      reference: 'MGN-123',
      status: 'success',
      amount: 179900,
      currency: 'ZAR',
      paid_at: '2026-07-28T10:00:00.000Z',
    }, {
      message: 'Verification successful',
    });

    expect(result.workspace).toEqual({
      activated: true,
      audit_run_id: 'audit-1',
      activated_at: '2026-07-28T10:00:01.000Z',
    });
    expect(queries.join('\n')).toContain('FOR UPDATE');
    expect(queries.join('\n')).toContain("SET status = 'paid'");
    expect(queries.join('\n')).toContain("activation_status = 'activated'");
  });

  it('rejects amount mismatch before touching the transaction', async () => {
    const { applyVerifiedPaystackActivation } = await import('../../src/services/paymentActivationService');

    await expect(applyVerifiedPaystackActivation('MGN-123', {
      reference: 'MGN-123',
      status: 'success',
      amount: 99,
      currency: 'ZAR',
    }, {})).rejects.toThrow('Paystack amount mismatch');

    expect(mockWithPostgresTransaction).not.toHaveBeenCalled();
  });
});
