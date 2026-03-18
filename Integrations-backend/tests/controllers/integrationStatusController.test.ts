import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const state = {
  users: [] as Row[],
  tenants: [] as Row[],
  tenant_memberships: [] as Row[],
  tokens: [] as Row[],
  evidence_sources: [] as Row[],
};

function matchesFilters(row: Row, filters: Array<(row: Row) => boolean>): boolean {
  return filters.every((filter) => filter(row));
}

function createQueryBuilder(table: keyof typeof state) {
  const filters: Array<(row: Row) => boolean> = [];
  let maybeSingleResult = false;
  let limitCount: number | null = null;
  let orderField: string | null = null;
  let orderAscending = true;

  const builder: any = {
    select: () => builder,
    eq: (field: string, value: any) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    is: (field: string, value: any) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    or: (expression: string) => {
      const clauses = expression.split(',').map((clause) => clause.trim()).filter(Boolean);
      filters.push((row) =>
        clauses.some((clause) => {
          const parts = clause.split('.');
          if (parts.length < 3) return false;
          const [field, operator, ...rest] = parts;
          const value = rest.join('.');
          return operator === 'eq' && String(row[field]) === value;
        })
      );
      return builder;
    },
    order: (field: string, options?: { ascending?: boolean }) => {
      orderField = field;
      orderAscending = options?.ascending !== false;
      return builder;
    },
    limit: (count: number) => {
      limitCount = count;
      return builder;
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

    if (orderField) {
      rows = rows.sort((a, b) => {
        if (a[orderField!] < b[orderField!]) return orderAscending ? -1 : 1;
        if (a[orderField!] > b[orderField!]) return orderAscending ? 1 : -1;
        return 0;
      });
    }

    if (limitCount !== null) {
      rows = rows.slice(0, limitCount);
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
  supabase: {
    from: (table: keyof typeof state) => createQueryBuilder(table),
  },
  supabaseAdmin: {
    from: (table: keyof typeof state) => createQueryBuilder(table),
  },
  convertUserIdToUuid: (userId: string) => userId,
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

import { getIntegrationStatus } from '../../src/controllers/integrationStatusController';

function createMockResponse() {
  const res: any = {};

  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation((body: any) => {
    res.jsonBody = body;
    return res;
  });

  return res as Response & { statusCode?: number; jsonBody?: any };
}

describe('integrationStatusController tenant truth', () => {
  beforeEach(() => {
    state.tenants = [
      { id: 'tenant-a', slug: 'tenant-a', name: 'Tenant A', deleted_at: null },
      { id: 'tenant-b', slug: 'tenant-b', name: 'Tenant B', deleted_at: null },
      { id: 'tenant-c', slug: 'tenant-c', name: 'Tenant C', deleted_at: null },
    ];
    state.users = [
      {
        id: 'user-1',
        email: 'seller-a@example.com',
        amazon_seller_id: 'SELLER-A',
        seller_id: 'SELLER-A',
        tenant_id: 'tenant-a',
        company_name: 'Tenant A Seller',
        created_at: '2026-03-18T00:00:00.000Z',
      },
      {
        id: 'user-1',
        email: 'seller-b@example.com',
        amazon_seller_id: 'SELLER-B',
        seller_id: 'SELLER-B',
        tenant_id: 'tenant-b',
        company_name: 'Tenant B Seller',
        created_at: '2026-03-18T00:00:00.000Z',
      },
    ];
    state.tenant_memberships = [
      { id: 'm-1', user_id: 'user-1', tenant_id: 'tenant-a', is_active: true, deleted_at: null, role: 'owner' },
      { id: 'm-2', user_id: 'user-1', tenant_id: 'tenant-b', is_active: true, deleted_at: null, role: 'member' },
    ];
    state.tokens = [
      {
        id: 'tok-a',
        user_id: 'user-1',
        provider: 'amazon',
        tenant_id: 'tenant-a',
        expires_at: '2099-01-01T00:00:00.000Z',
        updated_at: '2026-03-18T00:00:00.000Z',
      },
    ];
    state.evidence_sources = [
      {
        provider: 'gmail',
        status: 'connected',
        last_sync_at: '2026-03-18T01:00:00.000Z',
        account_email: 'ops@tenant-a.example',
        permissions: ['gmail.readonly'],
        seller_id: 'SELLER-A',
        display_name: 'Tenant A Gmail',
        metadata: {},
        tenant_id: 'tenant-a',
        user_id: 'user-1',
      },
    ];
  });

  it('returns tenant-specific truth for a valid connected tenant', async () => {
    const req = {
      userId: 'user-1',
      query: { tenantSlug: 'tenant-a' },
    } as unknown as Request;
    const res = createMockResponse();

    await getIntegrationStatus(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.jsonBody.tenantId).toBe('tenant-a');
    expect(res.jsonBody.tenantSlug).toBe('tenant-a');
    expect(res.jsonBody.amazon_connected).toBe(true);
    expect(res.jsonBody.agent2_ready).toBe(true);
    expect(res.jsonBody.amazon_account).toEqual({
      seller_id: 'SELLER-A',
      display_name: 'Tenant A Seller',
      email: 'seller-a@example.com',
    });
    expect(res.jsonBody.docs_connected).toBe(true);
    expect(res.jsonBody.providerIngest.gmail.connected).toBe(true);
  });

  it('does not leak status from a different tenant', async () => {
    const req = {
      userId: 'user-1',
      query: { tenantSlug: 'tenant-b' },
    } as unknown as Request;
    const res = createMockResponse();

    await getIntegrationStatus(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.jsonBody.tenantId).toBe('tenant-b');
    expect(res.jsonBody.amazon_connected).toBe(false);
    expect(res.jsonBody.agent2_ready).toBe(false);
    expect(res.jsonBody.docs_connected).toBe(false);
    expect(res.jsonBody.amazon_account).toBeNull();
  });

  it('fails safely for a nonexistent tenant slug', async () => {
    const req = {
      userId: 'user-1',
      query: { tenantSlug: 'missing-tenant' },
    } as unknown as Request;
    const res = createMockResponse();

    await getIntegrationStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.jsonBody).toEqual({
      ok: false,
      error: 'Tenant not found',
    });
  });

  it('fails safely for unauthorized tenant access', async () => {
    const req = {
      userId: 'user-1',
      query: { tenantSlug: 'tenant-c' },
    } as unknown as Request;
    const res = createMockResponse();

    await getIntegrationStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.jsonBody).toEqual({
      ok: false,
      error: 'You do not have access to this tenant',
    });
  });

  it('fails safely when tenantSlug is missing', async () => {
    const req = {
      userId: 'user-1',
      query: {},
    } as unknown as Request;
    const res = createMockResponse();

    await getIntegrationStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.jsonBody).toEqual({
      ok: false,
      error: 'tenantSlug is required',
    });
  });
});
