import { beforeEach, describe, expect, test, jest } from '@jest/globals';

type Row = Record<string, any>;

const state = {
  tenants: [] as Row[],
  tenant_memberships: [] as Row[],
  tenant_billing_subscriptions: [] as Row[],
  billing_invoices: [] as Row[],
};

function matchesFilters(row: Row, filters: Array<(row: Row) => boolean>): boolean {
  return filters.every((filter) => filter(row));
}

function buildSubscription(overrides: Partial<Row> = {}): Row {
  return {
    id: 'sub-1',
    tenant_id: 'tenant-1',
    user_id: 'owner-1',
    billing_model: 'flat_subscription',
    plan_tier: 'starter',
    billing_interval: 'monthly',
    monthly_price_cents: 4900,
    annual_monthly_equivalent_price_cents: 3900,
    billing_amount_cents: 4900,
    billing_currency: 'USD',
    promo_start_at: '2026-04-01T00:00:00.000Z',
    promo_end_at: '2026-05-31T00:00:00.000Z',
    promo_type: 'keep_100_percent_recoveries_60_days',
    subscription_status: 'active',
    current_period_start_at: null,
    current_period_end_at: null,
    next_billing_date: null,
    billing_provider: 'yoco',
    billing_customer_id: null,
    billing_subscription_id: null,
    legacy_recovery_billing_disabled_at: '2026-04-01T00:00:00.000Z',
    metadata: {},
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTenant(overrides: Partial<Row> = {}): Row {
  return {
    id: 'tenant-1',
    name: 'Workspace',
    slug: 'workspace',
    plan: 'free',
    status: 'active',
    settings: {},
    metadata: {},
    updated_at: '2026-04-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function buildTenantMembership(overrides: Partial<Row> = {}): Row {
  return {
    id: 'membership-1',
    tenant_id: 'tenant-1',
    user_id: 'owner-1',
    role: 'owner',
    is_active: true,
    deleted_at: null,
    created_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function createQueryBuilder(table: keyof typeof state) {
  const filters: Array<(row: Row) => boolean> = [];
  let pendingUpdate: Row | null = null;
  let pendingInsert: Row | null = null;
  let singleResult = false;
  let maybeSingleResult = false;
  let selectAfterInsert = false;

  const builder: any = {
    select: () => {
      selectAfterInsert = true;
      return builder;
    },
    eq: (field: string, value: any) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    is: (field: string, value: any) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    order: () => builder,
    update: (data: Row) => {
      pendingUpdate = data;
      return builder;
    },
    insert: (data: Row) => {
      pendingInsert = data;
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
    if (pendingInsert) {
      const inserted = {
        id: pendingInsert.id || `invoice-row-${state[table].length + 1}`,
        created_at: pendingInsert.created_at || new Date().toISOString(),
        updated_at: pendingInsert.updated_at || new Date().toISOString(),
        ...pendingInsert,
      };
      state[table].push(inserted);
      return {
        data: selectAfterInsert ? inserted : [inserted],
        error: null,
      };
    }

    let rows = state[table].filter((row) => matchesFilters(row, filters));

    if (pendingUpdate) {
      const idsToUpdate = new Set(rows.map((row) => row.id));
      state[table] = state[table].map((row) => {
        if (!idsToUpdate.has(row.id)) return row;
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

import { createSubscriptionSubscribeIntent } from '../../src/services/billingSubscribeIntentService';

describe('billingSubscribeIntentService', () => {
  beforeEach(() => {
    process.env.YOCO_STARTER_MONTHLY_URL = 'https://pay.yoco.com/r/7XalBE';
    process.env.YOCO_PRO_ANNUAL_URL = 'https://pay.yoco.com/r/mozkwy';
    state.tenants = [buildTenant()];
    state.tenant_memberships = [buildTenantMembership()];
    state.tenant_billing_subscriptions = [buildSubscription()];
    state.billing_invoices = [];
  });

  test('creates a tenant-bound invoice intent before payment', async () => {
    const result = await createSubscriptionSubscribeIntent({
      tenantId: 'tenant-1',
      userId: 'owner-1',
      planTier: 'starter',
      billingInterval: 'monthly',
    });

    expect(result.intentStatus).toBe('created');
    expect(result.subscription.tenant_id).toBe('tenant-1');
    expect(result.subscription.user_id).toBe('owner-1');
    expect(result.subscription.plan_tier).toBe('starter');
    expect(result.subscription.billing_interval).toBe('monthly');
    expect(result.invoice.invoice_model).toBe('subscription');
    expect(result.invoice.invoice_type).toBe('subscription_invoice');
    expect(result.invoice.payment_provider).toBe('yoco');
    expect(result.invoice.payment_link_key).toBe('starter_monthly');
    expect(result.invoice.payment_link_url).toBe('https://pay.yoco.com/r/7XalBE');
    expect(result.invoice.status).toBe('pending');
  });

  test('promotes a free tenant into the selected paid plan before billing bootstrap', async () => {
    state.tenant_billing_subscriptions = [];

    const result = await createSubscriptionSubscribeIntent({
      tenantId: 'tenant-1',
      userId: 'owner-1',
      planTier: 'pro',
      billingInterval: 'annual',
    });

    expect(state.tenants[0].plan).toBe('professional');
    expect(state.tenants[0].metadata.selected_plan_tier).toBe('pro');
    expect(state.tenants[0].metadata.billing_interval).toBe('annual');
    expect(result.subscription.plan_tier).toBe('pro');
    expect(result.subscription.billing_interval).toBe('annual');
    expect(result.invoice.payment_link_key).toBe('pro_annual');
    expect(result.invoice.payment_link_url).toBe('https://pay.yoco.com/r/mozkwy');
  });

  test('reuses the same invoice intent on repeated selection instead of creating duplicates', async () => {
    const first = await createSubscriptionSubscribeIntent({
      tenantId: 'tenant-1',
      userId: 'owner-1',
      planTier: 'pro',
      billingInterval: 'annual',
    });

    const second = await createSubscriptionSubscribeIntent({
      tenantId: 'tenant-1',
      userId: 'owner-1',
      planTier: 'pro',
      billingInterval: 'annual',
    });

    expect(first.invoice.id).toBe(second.invoice.id);
    expect(second.intentStatus).toBe('reused');
    expect(state.billing_invoices).toHaveLength(1);
    expect(second.invoice.payment_link_key).toBe('pro_annual');
    expect(second.invoice.payment_link_url).toBe('https://pay.yoco.com/r/mozkwy');
    expect(second.subscription.plan_tier).toBe('pro');
    expect(second.subscription.billing_interval).toBe('annual');
  });
});
