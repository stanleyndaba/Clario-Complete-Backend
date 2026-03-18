import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const state = {
  tenants: [] as Row[],
  tenant_memberships: [] as Row[],
  tokens: [] as Row[],
  sync_progress: [] as Row[],
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
    update: () => builder,
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

jest.mock('../../src/utils/tokenManager', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(),
    revokeToken: jest.fn(),
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

import { getIntegrationStatus } from '../../src/controllers/integrationController';

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

describe('integrationController amazon provider status tenant truth', () => {
  beforeEach(() => {
    state.tenants = [
      { id: 'tenant-a', slug: 'tenant-a', deleted_at: null },
      { id: 'tenant-b', slug: 'tenant-b', deleted_at: null },
      { id: 'tenant-c', slug: 'tenant-c', deleted_at: null },
    ];
    state.tenant_memberships = [
      { user_id: 'user-1', tenant_id: 'tenant-a', is_active: true, deleted_at: null },
      { user_id: 'user-1', tenant_id: 'tenant-b', is_active: true, deleted_at: null },
    ];
    state.tokens = [
      {
        user_id: 'user-1',
        provider: 'amazon',
        tenant_id: 'tenant-a',
        expires_at: '2099-01-01T00:00:00.000Z',
        updated_at: '2026-03-18T00:00:00.000Z',
      },
    ];
    state.sync_progress = [
      { user_id: 'user-1', status: 'completed', updated_at: '2026-03-18T12:00:00.000Z' },
    ];
  });

  it('returns tenant-specific connected truth for amazon provider status', async () => {
    const req = {
      params: { provider: 'amazon' },
      userId: 'user-1',
      query: { tenantSlug: 'tenant-a' },
    } as unknown as Request;
    const res = createMockResponse();

    await getIntegrationStatus(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.jsonBody).toEqual({
      connected: true,
      sandboxMode: false,
      useMockGenerator: false,
      useMockData: false,
      lastSync: '2026-03-18T12:00:00.000Z',
      connectionVerified: true,
    });
  });

  it('does not leak amazon connection from another tenant', async () => {
    const req = {
      params: { provider: 'amazon' },
      userId: 'user-1',
      query: { tenantSlug: 'tenant-b' },
    } as unknown as Request;
    const res = createMockResponse();

    await getIntegrationStatus(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.jsonBody.connected).toBe(false);
    expect(res.jsonBody.connectionVerified).toBe(false);
    expect(res.jsonBody.sandboxMode).toBe(false);
  });

  it('fails when tenantSlug is missing', async () => {
    const req = {
      params: { provider: 'amazon' },
      userId: 'user-1',
      query: {},
    } as unknown as Request;
    const res = createMockResponse();

    await getIntegrationStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.jsonBody).toEqual({
      success: false,
      error: 'tenantSlug is required',
    });
  });

  it('fails for unauthorized tenant access', async () => {
    const req = {
      params: { provider: 'amazon' },
      userId: 'user-1',
      query: { tenantSlug: 'tenant-c' },
    } as unknown as Request;
    const res = createMockResponse();

    await getIntegrationStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.jsonBody).toEqual({
      success: false,
      error: 'You do not have access to this tenant',
    });
  });
});
