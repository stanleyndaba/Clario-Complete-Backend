import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const state: Record<string, Row[]> = {
  tokens: [],
  users: [],
  stores: [],
};

function createQueryBuilder(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let limitCount: number | null = null;
  let descending = false;
  let orderField: string | null = null;

  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    is: (field: string, value: unknown) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    order: (field: string, options?: { ascending?: boolean }) => {
      orderField = field;
      descending = options?.ascending === false;
      return builder;
    },
    limit: (count: number) => {
      limitCount = count;
      return builder;
    },
    maybeSingle: async () => {
      const rows = execute();
      return { data: rows[0] || null, error: null };
    },
  };

  function execute() {
    let rows = (state[table] || []).filter((row) => filters.every((filter) => filter(row)));
    if (orderField) {
      rows = rows.sort((left, right) => {
        const comparison = String(left[orderField!]).localeCompare(String(right[orderField!]));
        return descending ? -comparison : comparison;
      });
    }
    return limitCount === null ? rows : rows.slice(0, limitCount);
  }

  return builder;
}

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: { from: (table: string) => createQueryBuilder(table) },
  supabaseAdmin: { from: (table: string) => createQueryBuilder(table) },
  convertUserIdToUuid: (value: string) => value,
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn() },
}));

import { getAuthoritativeAmazonConnectionTruth, toAmazonLifecycleStatus } from '../../src/services/amazonConnectionTruthService';

describe('amazonConnectionTruthService', () => {
  beforeEach(() => {
    state.tokens = [];
    state.users = [];
    state.stores = [];
  });

  function seedCompleteConnection(overrides: Partial<Row> = {}) {
    state.tokens = [{
      id: 'token-a',
      user_id: 'user-a',
      provider: 'amazon',
      tenant_id: 'tenant-a',
      store_id: 'store-a',
      expires_at: '2099-01-01T00:00:00.000Z',
      updated_at: '2026-08-27T00:00:00.000Z',
      ...overrides,
    }];
    state.users = [{
      id: 'user-a',
      tenant_id: 'tenant-a',
      amazon_seller_id: 'SELLER-A',
      seller_id: 'SELLER-A',
    }];
    state.stores = [{ id: 'store-a', tenant_id: 'tenant-a', deleted_at: null }];
  }

  it('reports connected only when all existing token and binding checks pass', async () => {
    seedCompleteConnection();

    const truth = await getAuthoritativeAmazonConnectionTruth({ userId: 'user-a', tenantId: 'tenant-a' });

    expect(truth).toMatchObject({
      connected: true,
      needsReconnect: false,
      tokenPresent: true,
      tokenNotExpired: true,
      tenantBound: true,
      sellerResolved: true,
      storeBound: true,
      errorCode: null,
    });
    expect(toAmazonLifecycleStatus(truth)).toBe('connected');
  });

  it('does not treat a token without a valid tenant-bound store as connected', async () => {
    seedCompleteConnection({ store_id: null });

    const truth = await getAuthoritativeAmazonConnectionTruth({ userId: 'user-a', tenantId: 'tenant-a' });

    expect(truth).toMatchObject({
      connected: false,
      tokenPresent: true,
      storeBound: false,
      errorCode: 'amazon_store_binding_invalid',
    });
    expect(toAmazonLifecycleStatus(truth)).toBe('error');
  });

  it('does not treat a tenant token without a resolved seller identity as connected', async () => {
    seedCompleteConnection();
    state.users = [{
      id: 'user-a',
      tenant_id: 'tenant-a',
      amazon_seller_id: null,
      seller_id: null,
    }];

    const truth = await getAuthoritativeAmazonConnectionTruth({ userId: 'user-a', tenantId: 'tenant-a' });

    expect(truth).toMatchObject({
      connected: false,
      tokenPresent: true,
      sellerResolved: false,
      storeBound: true,
      errorCode: 'amazon_seller_identity_unresolved',
    });
  });

  it('does not treat a token whose store belongs to another tenant as connected', async () => {
    seedCompleteConnection();
    state.stores = [{ id: 'store-a', tenant_id: 'tenant-b', deleted_at: null }];

    const truth = await getAuthoritativeAmazonConnectionTruth({ userId: 'user-a', tenantId: 'tenant-a' });

    expect(truth).toMatchObject({
      connected: false,
      tokenPresent: true,
      sellerResolved: true,
      storeBound: false,
      errorCode: 'amazon_store_binding_invalid',
    });
  });

  it('requires reconnect for an expired tenant-bound token', async () => {
    seedCompleteConnection({ expires_at: '2000-01-01T00:00:00.000Z' });

    const truth = await getAuthoritativeAmazonConnectionTruth({ userId: 'user-a', tenantId: 'tenant-a' });

    expect(truth).toMatchObject({
      connected: false,
      tokenPresent: true,
      tokenNotExpired: false,
      needsReconnect: true,
      errorCode: 'amazon_token_expired',
    });
    expect(toAmazonLifecycleStatus(truth)).toBe('reconnect_required');
  });

  it('does not leak a token, seller identity, or store binding from another tenant', async () => {
    seedCompleteConnection({ tenant_id: 'tenant-b' });
    state.users = [{
      id: 'user-a',
      tenant_id: 'tenant-b',
      amazon_seller_id: 'SELLER-B',
      seller_id: 'SELLER-B',
    }];
    state.stores = [{ id: 'store-a', tenant_id: 'tenant-b', deleted_at: null }];

    const truth = await getAuthoritativeAmazonConnectionTruth({ userId: 'user-a', tenantId: 'tenant-a' });

    expect(truth).toMatchObject({
      connected: false,
      tokenPresent: false,
      sellerResolved: false,
      storeBound: false,
    });
    expect(toAmazonLifecycleStatus(truth)).toBe('connection_required');
  });
});
