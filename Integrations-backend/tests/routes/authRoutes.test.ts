import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const state = {
  users: [] as Row[],
  tenants: [] as Row[],
  tenant_memberships: [] as Row[],
  tokens: [] as Row[],
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

jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: {
    JWT_SECRET: 'test-secret',
  },
}));

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    verify: jest.fn(),
  },
  verify: jest.fn(),
}));

import jwt from 'jsonwebtoken';
import authRoutes from '../../src/routes/authRoutes';

describe('authRoutes /me tenant truth', () => {
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
        company_name: 'Tenant A Seller',
        amazon_seller_id: 'SELLER-A',
        seller_id: 'SELLER-A',
        paypal_payment_token: 'vault-token-a',
        paypal_email: 'billing-a@example.com',
        created_at: '2026-03-18T00:00:00.000Z',
        last_login_at: '2026-03-18T10:00:00.000Z',
        tenant_id: 'tenant-a',
      },
      {
        id: 'user-1',
        email: 'seller-b@example.com',
        company_name: 'Tenant B Seller',
        amazon_seller_id: 'SELLER-B',
        seller_id: 'SELLER-B',
        paypal_payment_token: null,
        paypal_email: null,
        created_at: '2026-03-18T00:00:00.000Z',
        last_login_at: '2026-03-18T10:00:00.000Z',
        tenant_id: 'tenant-b',
      },
    ];
    state.tenant_memberships = [
      { user_id: 'user-1', tenant_id: 'tenant-a', role: 'owner', is_active: true, deleted_at: null },
      { user_id: 'user-1', tenant_id: 'tenant-b', role: 'member', is_active: true, deleted_at: null },
    ];
    state.tokens = [
      {
        user_id: 'user-1',
        provider: 'amazon',
        tenant_id: 'tenant-a',
        expires_at: '2099-01-01T00:00:00.000Z',
        updated_at: '2026-03-18T12:00:00.000Z',
      },
    ];

    (jwt.verify as jest.Mock).mockReturnValue({
      user_id: 'user-1',
      email: 'fallback@example.com',
      name: 'Fallback User',
    });
  });

  function createApp() {
    const app = express();
    app.use('/api/auth', authRoutes);
    return app;
  }

  it('returns tenant-scoped profile truth for a connected tenant', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/auth/me?tenantSlug=tenant-a')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'user-1',
      email: 'seller-a@example.com',
      name: 'Tenant A Seller',
      company_name: 'Tenant A Seller',
      amazon_seller_id: 'SELLER-A',
      amazon_connected: true,
      paypal_connected: true,
      paypal_email: 'billing-a@example.com',
      billing_provider: 'paypal',
      tenant_id: 'tenant-a',
      tenant_slug: 'tenant-a',
      tenant_name: 'Tenant A',
      role: 'owner',
    });
    expect(response.body.amazon_account).toEqual({
      seller_id: 'SELLER-A',
      display_name: 'Tenant A Seller',
      email: 'seller-a@example.com',
    });
  });

  it('does not leak connected status into another tenant', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/auth/me?tenantSlug=tenant-b')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.amazon_connected).toBe(false);
    expect(response.body.amazon_seller_id).toBe('SELLER-B');
    expect(response.body.paypal_connected).toBe(false);
    expect(response.body.billing_provider).toBe('paypal');
    expect(response.body.tenant_id).toBe('tenant-b');
    expect(response.body.tenant_slug).toBe('tenant-b');
  });

  it('fails safely for nonexistent tenant slugs', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/auth/me?tenantSlug=missing-tenant')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: 'Tenant not found',
    });
  });

  it('fails safely for unauthorized tenant access', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/auth/me?tenantSlug=tenant-c')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      message: 'You do not have access to this tenant',
    });
  });

  it('fails when a tenant exists but no tenant-bound user row exists', async () => {
    const app = createApp();
    state.users = state.users.filter((row) => row.tenant_id !== 'tenant-b');

    const response = await request(app)
      .get('/api/auth/me?tenantSlug=tenant-b')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: 'No tenant-bound user profile found',
    });
  });
});
