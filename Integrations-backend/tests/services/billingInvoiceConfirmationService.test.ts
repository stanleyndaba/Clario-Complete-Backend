import { beforeEach, describe, expect, test, jest } from '@jest/globals';

type Row = Record<string, any>;

const state = {
  billing_invoices: [] as Row[],
};

const metrics = {
  invoiceUpdates: 0,
};

function matchesFilters(row: Row, filters: Array<(row: Row) => boolean>): boolean {
  return filters.every((filter) => filter(row));
}

function buildInvoice(overrides: Partial<Row> = {}): Row {
  return {
    id: 'invoice-row-1',
    invoice_id: 'SUB-STARTER-20260402-ABC12345',
    payment_reference: 'SUB-STARTER-20260402-ABC12345',
    tenant_id: 'tenant-1',
    user_id: 'owner-1',
    subscription_id: 'sub-1',
    invoice_type: 'subscription_invoice',
    invoice_model: 'subscription',
    billing_model: 'flat_subscription',
    plan_tier: 'starter',
    billing_interval: 'monthly',
    billing_amount_cents: 4900,
    amount_charged_cents: null,
    currency: 'USD',
    billing_period_start: '2026-04-01T00:00:00.000Z',
    billing_period_end: '2026-05-01T00:00:00.000Z',
    invoice_date: '2026-04-02T00:00:00.000Z',
    due_date: '2026-05-01T00:00:00.000Z',
    paid_at: null,
    subscription_status_snapshot: 'active',
    promo_type: 'keep_100_percent_recoveries_60_days',
    promo_note: 'First 60 days: you keep 100% of recoveries.',
    provider: 'yoco',
    provider_invoice_id: null,
    provider_charge_id: null,
    payment_provider: 'yoco',
    payment_link_key: 'starter_monthly',
    payment_link_url: 'https://pay.yoco.com/r/7XalBE',
    payment_confirmation_source: null,
    payment_confirmed_by_user_id: null,
    payment_confirmation_note: null,
    status: 'pending',
    legacy_source_transaction_id: null,
    metadata: {},
    created_at: '2026-04-02T00:00:00.000Z',
    updated_at: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

function createQueryBuilder(table: keyof typeof state) {
  const filters: Array<(row: Row) => boolean> = [];
  let pendingUpdate: Row | null = null;
  let singleResult = false;
  let maybeSingleResult = false;

  const builder: any = {
    select: () => builder,
    eq: (field: string, value: any) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    update: (data: Row) => {
      pendingUpdate = data;
      return builder;
    },
    single: async () => {
      singleResult = true;
      return execute();
    },
    maybeSingle: async () => {
      maybeSingleResult = true;
      return execute();
    },
    then: (resolve: (value: any) => any, reject: (reason?: any) => any) =>
      execute().then(resolve, reject),
  };

  async function execute() {
    let rows = state[table].filter((row) => matchesFilters(row, filters));

    if (pendingUpdate) {
      const idsToUpdate = new Set(rows.map((row) => row.id));
      state[table] = state[table].map((row) => {
        if (!idsToUpdate.has(row.id)) return row;
        metrics.invoiceUpdates += 1;
        return {
          ...row,
          ...pendingUpdate,
        };
      });
      rows = state[table].filter((row) => idsToUpdate.has(row.id));
    }

    if (singleResult) {
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: 'No rows returned' },
      };
    }

    if (maybeSingleResult) {
      return {
        data: rows[0] ?? null,
        error: null,
      };
    }

    return {
      data: rows,
      error: null,
    };
  }

  return builder;
}

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: {
    from: (table: keyof typeof state) => createQueryBuilder(table),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  canConfirmSubscriptionInvoicePayment,
  confirmSubscriptionInvoicePayment,
} from '../../src/services/billingInvoiceConfirmationService';

describe('billingInvoiceConfirmationService', () => {
  beforeEach(() => {
    state.billing_invoices = [buildInvoice()];
    metrics.invoiceUpdates = 0;
  });

  test('marks a pending subscription invoice paid only through explicit backend confirmation', async () => {
    const result = await confirmSubscriptionInvoicePayment({
      tenantId: 'tenant-1',
      invoiceId: 'SUB-STARTER-20260402-ABC12345',
      confirmedByUserId: 'owner-1',
      paymentReference: 'SUB-STARTER-20260402-ABC12345',
      confirmationSource: 'manual_dashboard',
      confirmationNote: 'YOCO payment received and verified manually.',
    });

    expect(result.alreadyConfirmed).toBe(false);
    expect(result.invoice.status).toBe('paid');
    expect(result.invoice.amount_charged_cents).toBe(4900);
    expect(result.invoice.paid_at).toBeTruthy();
    expect(result.invoice.payment_confirmation_source).toBe('manual_dashboard');
    expect(result.invoice.payment_confirmed_by_user_id).toBe('owner-1');
    expect(result.invoice.payment_confirmation_note).toBe('YOCO payment received and verified manually.');
    expect(result.invoice.metadata.payment_confirmation.source).toBe('manual_dashboard');
    expect(result.invoice.metadata.payment_confirmation.entered_payment_reference).toBe('SUB-STARTER-20260402-ABC12345');
    expect(result.invoice.metadata.payment_confirmation.matched_payment_reference).toBe('SUB-STARTER-20260402-ABC12345');
    expect(result.invoice.metadata.payment_confirmation_history).toHaveLength(1);
    expect(canConfirmSubscriptionInvoicePayment(result.invoice)).toBe(false);
    expect(metrics.invoiceUpdates).toBe(1);
  });

  test('rejects confirmation when the entered payment reference does not match the invoice', async () => {
    await expect(confirmSubscriptionInvoicePayment({
      tenantId: 'tenant-1',
      invoiceId: 'invoice-row-1',
      confirmedByUserId: 'owner-1',
      paymentReference: 'WRONG-REFERENCE',
      confirmationSource: 'manual_dashboard',
    })).rejects.toThrow('Payment reference does not match this invoice');

    expect(state.billing_invoices[0].status).toBe('pending');
    expect(state.billing_invoices[0].paid_at).toBeNull();
    expect(state.billing_invoices[0].metadata.payment_confirmation_history).toBeUndefined();
    expect(metrics.invoiceUpdates).toBe(0);
  });

  test('repeated confirmation is idempotent and does not append duplicate state history', async () => {
    const first = await confirmSubscriptionInvoicePayment({
      tenantId: 'tenant-1',
      invoiceId: 'invoice-row-1',
      confirmedByUserId: 'owner-1',
      paymentReference: 'SUB-STARTER-20260402-ABC12345',
      confirmationSource: 'manual_api',
      confirmationNote: 'First explicit confirmation.',
    });

    const firstPaidAt = first.invoice.paid_at;
    const firstHistory = first.invoice.metadata.payment_confirmation_history;

    const second = await confirmSubscriptionInvoicePayment({
      tenantId: 'tenant-1',
      invoiceId: 'invoice-row-1',
      confirmedByUserId: 'owner-2',
      paymentReference: 'SUB-STARTER-20260402-ABC12345',
      confirmationSource: 'manual_dashboard',
      confirmationNote: 'Second confirmation should be ignored.',
    });

    expect(second.alreadyConfirmed).toBe(true);
    expect(second.invoice.status).toBe('paid');
    expect(second.invoice.paid_at).toBe(firstPaidAt);
    expect(second.invoice.payment_confirmation_source).toBe('manual_api');
    expect(second.invoice.payment_confirmed_by_user_id).toBe('owner-1');
    expect(second.invoice.payment_confirmation_note).toBe('First explicit confirmation.');
    expect(second.invoice.metadata.payment_confirmation_history).toEqual(firstHistory);
    expect(second.invoice.metadata.payment_confirmation_history).toHaveLength(1);
    expect(metrics.invoiceUpdates).toBe(1);
  });

  test('fails closed for tenant mismatch', async () => {
    await expect(confirmSubscriptionInvoicePayment({
      tenantId: 'tenant-2',
      invoiceId: 'invoice-row-1',
      confirmedByUserId: 'owner-1',
      paymentReference: 'SUB-STARTER-20260402-ABC12345',
    })).rejects.toThrow('Subscription invoice not found');

    expect(metrics.invoiceUpdates).toBe(0);
  });

  test('fails closed for non-subscription or non-confirmable invoices', async () => {
    state.billing_invoices = [
      buildInvoice({
        invoice_type: 'legacy_recovery_fee_invoice',
        invoice_model: 'legacy_recovery_fee',
        billing_model: 'legacy_recovery_fee',
        status: 'legacy',
      }),
    ];

    await expect(confirmSubscriptionInvoicePayment({
      tenantId: 'tenant-1',
      invoiceId: 'invoice-row-1',
      confirmedByUserId: 'owner-1',
      paymentReference: 'SUB-STARTER-20260402-ABC12345',
    })).rejects.toThrow('Only active subscription invoices can be manually confirmed');

    expect(metrics.invoiceUpdates).toBe(0);
  });

  test('fails closed when a subscription invoice has no stored payment reference', async () => {
    state.billing_invoices = [
      buildInvoice({
        payment_reference: null,
      }),
    ];

    await expect(confirmSubscriptionInvoicePayment({
      tenantId: 'tenant-1',
      invoiceId: 'invoice-row-1',
      confirmedByUserId: 'owner-1',
      paymentReference: 'SUB-STARTER-20260402-ABC12345',
    })).rejects.toThrow('Invoice payment reference is not available for confirmation');

    expect(state.billing_invoices[0].status).toBe('pending');
    expect(metrics.invoiceUpdates).toBe(0);
  });

  test('fails closed when invoice amount does not match canonical plan pricing', async () => {
    state.billing_invoices = [
      buildInvoice({
        billing_amount_cents: 9999,
      }),
    ];

    await expect(confirmSubscriptionInvoicePayment({
      tenantId: 'tenant-1',
      invoiceId: 'invoice-row-1',
      confirmedByUserId: 'owner-1',
      paymentReference: 'SUB-STARTER-20260402-ABC12345',
    })).rejects.toThrow('Invoice amount does not match canonical plan pricing');

    expect(state.billing_invoices[0].status).toBe('pending');
    expect(metrics.invoiceUpdates).toBe(0);
  });
});
