import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, unknown>;

process.env.ALLOW_DEMO_USER = 'true';

const persistenceWrites: Array<{ table: string; values: Record<string, unknown> }> = [];

const state = {
  tenants: [
    {
      id: 'tenant-gmail-4',
      name: 'Gmail',
      slug: 'gmail-4',
      plan: 'free',
      status: 'active',
      metadata: {},
      deleted_at: null,
    },
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Demo workspace',
      slug: 'demo-workspace',
      plan: 'free',
      status: 'active',
      metadata: { is_demo_workspace: true },
      deleted_at: null,
    },
  ] as Row[],
  tenant_memberships: [
    {
      id: 'membership-owner',
      tenant_id: 'tenant-gmail-4',
      user_id: 'margin-user-canonical',
      role: 'owner',
      is_active: true,
      deleted_at: null,
    },
  ] as Row[],
  users: [] as Row[],
};

function createBuilder(table: keyof typeof state) {
  const filters: Array<(row: Row) => boolean> = [];
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
    order: () => builder,
    limit: () => builder,
    update: (values: Record<string, unknown>) => {
      persistenceWrites.push({ table, values });
      return builder;
    },
    upsert: (values: Record<string, unknown>) => {
      persistenceWrites.push({ table, values });
      return builder;
    },
    single: async () => {
      const rows = state[table].filter((row) => filters.every((filter) => filter(row)));
      return { data: rows[0] || null, error: rows.length ? null : { code: 'PGRST116' } };
    },
    maybeSingle: async () => {
      const rows = state[table].filter((row) => filters.every((filter) => filter(row)));
      return { data: rows[0] || null, error: null };
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) => {
      const rows = state[table].filter((row) => filters.every((filter) => filter(row)));
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: {
    from: (table: keyof typeof state) => createBuilder(table),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import { tenantMiddleware } from '../../src/middleware/tenantMiddleware';

function createApp(userId: string) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).userId = userId;
    next();
  });
  app.use(tenantMiddleware);
  app.get('/api/tenant/current', (req, res) => {
    res.json({ tenant: (req as any).tenant });
  });
  return app;
}

describe('tenantMiddleware canonical identity enforcement', () => {
  beforeEach(() => {
    persistenceWrites.length = 0;
  });

  it('allows the canonical Gmail-4 owner identity through the existing membership guard', async () => {
    const response = await request(createApp('margin-user-canonical'))
      .get('/api/tenant/current?tenantSlug=gmail-4');

    expect(response.status).toBe(200);
    expect(response.body.tenant).toEqual(expect.objectContaining({
      tenantId: 'tenant-gmail-4',
      tenantSlug: 'gmail-4',
      userRole: 'owner',
    }));
  });

  it('does not persist last-active workspace state while resolving the read-only lifecycle route', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).userId = 'margin-user-canonical';
      next();
    });
    app.use(tenantMiddleware);
    app.get('/api/seller-lifecycle', (req, res) => {
      res.json({ tenant: (req as any).tenant });
    });

    const response = await request(app)
      .get('/api/seller-lifecycle?tenantSlug=gmail-4');

    expect(response.status).toBe(200);
    expect(response.body.tenant).toEqual(expect.objectContaining({
      tenantId: 'tenant-gmail-4',
      tenantSlug: 'gmail-4',
    }));
    expect(persistenceWrites).toEqual([]);
  });

  it('keeps a trailing-slash lifecycle request write-free while resolving an authorized membership', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).userId = 'margin-user-canonical';
      next();
    });
    app.use(tenantMiddleware);
    app.get('/api/seller-lifecycle', (req, res) => {
      res.json({ tenant: (req as any).tenant });
    });

    const response = await request(app)
      .get('/api/seller-lifecycle/?tenantSlug=gmail-4');

    expect(response.status).toBe(200);
    expect(response.body.tenant).toEqual(expect.objectContaining({
      tenantId: 'tenant-gmail-4',
      tenantSlug: 'gmail-4',
    }));
    expect(persistenceWrites).toEqual([]);
  });

  it('does not create a demo membership on a lifecycle read and fails closed when none exists', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).userId = 'margin-user-non-member';
      next();
    });
    app.use(tenantMiddleware);
    app.get('/api/seller-lifecycle', (req, res) => {
      res.json({ tenant: (req as any).tenant });
    });

    const response = await request(app)
      .get('/api/seller-lifecycle?tenantSlug=demo-workspace');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'You do not have access to this workspace' });
    expect(persistenceWrites).toEqual([]);
  });

  it('continues to deny a different authenticated internal identity with no Gmail-4 membership', async () => {
    const response = await request(createApp('margin-user-non-member'))
      .get('/api/tenant/current?tenantSlug=gmail-4');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'You do not have access to this workspace' });
  });
});
