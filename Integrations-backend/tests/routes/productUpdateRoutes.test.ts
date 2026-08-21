import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;
type TableName = 'users' | 'product_updates' | 'product_update_broadcast_jobs';

const state = {
  users: [] as Row[],
  product_updates: [] as Row[],
  product_update_broadcast_jobs: [] as Row[],
  failNextJobInsert: false,
};

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function createQueryBuilder(table: TableName) {
  const filters: Array<(row: Row) => boolean> = [];
  const orderings: Array<{ field: string; ascending: boolean }> = [];
  let pendingMutation: { type: 'insert' | 'update'; value: Row } | null = null;

  const filteredRows = () => {
    const rows = state[table].filter((row) => filters.every((filter) => filter(row)));
    for (const ordering of orderings) {
      rows.sort((left, right) => {
        const a = left[ordering.field] ?? '';
        const b = right[ordering.field] ?? '';
        const comparison = String(a).localeCompare(String(b));
        return ordering.ascending ? comparison : -comparison;
      });
    }
    return rows;
  };

  const applyMutation = () => {
    if (!pendingMutation) return { data: filteredRows(), error: null };

    if (pendingMutation.type === 'insert') {
      if (table === 'product_update_broadcast_jobs' && state.failNextJobInsert) {
        state.failNextJobInsert = false;
        return { data: null, error: { message: 'forced job enqueue failure' } };
      }

      if (table === 'product_updates' && state.product_updates.some((row) => row.slug === pendingMutation?.value.slug)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }

      if (
        table === 'product_update_broadcast_jobs' &&
        state.product_update_broadcast_jobs.some((row) => row.product_update_id === pendingMutation?.value.product_update_id)
      ) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }

      const row: Row = {
        id: pendingMutation.value.id || nextId(table === 'product_updates' ? 'update' : 'job'),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...pendingMutation.value,
      };
      state[table].push(row);
      return { data: row, error: null };
    }

    const row = filteredRows()[0];
    if (!row) return { data: null, error: { message: 'row not found' } };
    Object.assign(row, pendingMutation.value, { updated_at: new Date().toISOString() });
    return { data: row, error: null };
  };

  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    not: (field: string, operator: string, value: unknown) => {
      if (operator === 'is' && value === null) filters.push((row) => row[field] !== null && row[field] !== undefined);
      return builder;
    },
    order: (field: string, options?: { ascending?: boolean }) => {
      orderings.push({ field, ascending: options?.ascending !== false });
      return builder;
    },
    insert: (value: Row) => {
      pendingMutation = { type: 'insert', value };
      return builder;
    },
    update: (value: Row) => {
      pendingMutation = { type: 'update', value };
      return builder;
    },
    maybeSingle: async () => {
      const result = applyMutation();
      return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error };
    },
    single: async () => applyMutation(),
    then: (resolve: (value: any) => any, reject: (reason?: any) => any) =>
      Promise.resolve({ data: filteredRows(), error: null }).then(resolve, reject),
  };

  return builder;
}

jest.mock('../../src/database/supabaseClient', () => ({
  convertUserIdToUuid: (value: string) => value,
  supabaseAdmin: {
    from: (table: TableName) => createQueryBuilder(table),
  },
}));

jest.mock('../../src/notifications/services/notification_service', () => ({
  notificationService: {
    createNotification: jest.fn(),
  },
}));

import productUpdateRoutes from '../../src/routes/productUpdateRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const testUser = req.headers['x-test-user'];
    if (typeof testUser === 'string' && testUser) {
      req.userId = testUser;
      req.authIdentitySource = String(req.headers['x-test-identity-source'] || 'verified-backend-jwt');
    }
    next();
  });
  app.use('/api/product-updates', productUpdateRoutes);
  return app;
}

const immediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation((() => 0) as any);

describe('Product updates publication contract', () => {
  beforeEach(() => {
    idCounter = 0;
    state.failNextJobInsert = false;
    state.users = [
      { id: 'admin-active', email: 'admin@margin.test', role: 'admin', status: 'active', deleted_at: null },
      { id: 'seller', email: 'seller@margin.test', role: 'seller', status: 'active', deleted_at: null },
      { id: 'admin-disabled', email: 'disabled@margin.test', role: 'admin', status: 'disabled', deleted_at: null },
      { id: 'admin-deleted', email: 'deleted@margin.test', role: 'admin', status: 'active', deleted_at: '2026-08-21T00:00:00.000Z' },
    ];
    state.product_updates = [];
    state.product_update_broadcast_jobs = [];
  });

  afterAll(() => {
    immediateSpy.mockRestore();
  });

  it('rejects unauthenticated and demo-fallback seller retrieval at the product-update route boundary', async () => {
    const app = createApp();
    await request(app).get('/api/product-updates').expect(401);
    await request(app)
      .get('/api/product-updates')
      .set('x-test-user', 'demo-user')
      .set('x-test-identity-source', 'default-demo-user')
      .expect(401);
  });

  it('allows only active platform admins to use the publication authority endpoint and mutations', async () => {
    const app = createApp();

    await request(app).get('/api/product-updates/admin-access').expect(401);
    await request(app).get('/api/product-updates/admin-access').set('x-test-user', 'seller').expect(403);
    await request(app).get('/api/product-updates/admin-access').set('x-test-user', 'admin-disabled').expect(403);
    await request(app).get('/api/product-updates/admin-access').set('x-test-user', 'admin-deleted').expect(403);

    const allowed = await request(app)
      .get('/api/product-updates/admin-access')
      .set('x-test-user', 'admin-active')
      .expect(200);
    expect(allowed.body.data).toEqual({ allowed: true });

    await request(app)
      .post('/api/product-updates')
      .set('x-test-user', 'seller')
      .send({ title: 'Blocked attempt', summary: 'A seller must not write a rollout.' })
      .expect(403);
    expect(state.product_updates).toHaveLength(0);
  });

  it('keeps drafts invisible, publishes exactly one seller-visible record, and does not duplicate its durable broadcast job', async () => {
    const app = createApp();

    const create = await request(app)
      .post('/api/product-updates')
      .set('x-test-user', 'admin-active')
      .send({
        title: 'Recovery evidence improvements',
        summary: 'Margin now groups related operational evidence more clearly.',
        cta_href: '/evidence-locker',
        highlights: ['Safer correlation', 'Clearer resolution context'],
      })
      .expect(201);

    const updateId = create.body.data.id;
    expect(create.body.data).toMatchObject({
      status: 'draft',
      audience_scope: 'all_users',
      notify_in_app: true,
      notify_email: true,
    });

    const draftRead = await request(app).get('/api/product-updates').set('x-test-user', 'seller').expect(200);
    expect(draftRead.body.data).toEqual([]);

    await request(app)
      .post(`/api/product-updates/${updateId}/publish`)
      .set('x-test-user', 'admin-active')
      .expect(200);

    const publishedRead = await request(app).get('/api/product-updates').set('x-test-user', 'seller').expect(200);
    expect(publishedRead.body.data).toHaveLength(1);
    expect(publishedRead.body.data[0]).toMatchObject({ id: updateId, status: 'published' });
    expect(state.product_update_broadcast_jobs).toHaveLength(1);

    await request(app)
      .post(`/api/product-updates/${updateId}/publish`)
      .set('x-test-user', 'admin-active')
      .expect(200);
    expect(state.product_update_broadcast_jobs).toHaveLength(1);
  });

  it('does not expose a phantom update when durable job creation fails before publication', async () => {
    const app = createApp();
    const create = await request(app)
      .post('/api/product-updates')
      .set('x-test-user', 'admin-active')
      .send({ title: 'Atomicity proof', summary: 'This record must remain a draft if job creation fails.' })
      .expect(201);

    state.failNextJobInsert = true;
    await request(app)
      .post(`/api/product-updates/${create.body.data.id}/publish`)
      .set('x-test-user', 'admin-active')
      .expect(500);

    expect(state.product_updates[0].status).toBe('draft');
    expect(state.product_updates[0]).not.toHaveProperty('published_at');
    expect(state.product_update_broadcast_jobs).toHaveLength(0);

    const sellerRead = await request(app).get('/api/product-updates').set('x-test-user', 'seller').expect(200);
    expect(sellerRead.body.data).toEqual([]);
  });

  it('rejects unsafe or oversized input without corrupting canonical records and stores markup as inert text', async () => {
    const app = createApp();

    await request(app)
      .post('/api/product-updates')
      .set('x-test-user', 'admin-active')
      .send({ title: 'Unsafe CTA', summary: 'Must not persist an executable link.', cta_href: 'javascript:alert(1)' })
      .expect(400);
    expect(state.product_updates).toHaveLength(0);

    await request(app)
      .post('/api/product-updates')
      .set('x-test-user', 'admin-active')
      .send({ title: 'A'.repeat(201), summary: 'Too long title.' })
      .expect(400);
    expect(state.product_updates).toHaveLength(0);

    const markup = '<img src=x onerror=alert(1)>';
    const create = await request(app)
      .post('/api/product-updates')
      .set('x-test-user', 'admin-active')
      .send({
        title: markup,
        summary: 'The seller renderer treats this as text, never executable HTML.',
        cta_href: 'https://margin-finance.com/whats-new',
      })
      .expect(201);

    expect(create.body.data.title).toBe(markup);
    expect(create.body.data.cta_href).toBe('https://margin-finance.com/whats-new');
  });
});
