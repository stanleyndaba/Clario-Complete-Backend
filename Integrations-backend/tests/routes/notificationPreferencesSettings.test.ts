import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const state = {
  user_notification_preferences: [] as Row[],
  users: [] as Row[],
  dispute_cases: [] as Row[],
};

function createQueryBuilder(table: keyof typeof state) {
  const filters: Array<(row: Row) => boolean> = [];
  let limitCount: number | null = null;

  const execute = async () => {
    let rows = state[table].filter((row) => filters.every((filter) => filter(row)));
    if (limitCount !== null) {
      rows = rows.slice(0, limitCount);
    }
    return { data: rows, error: null };
  };

  const builder: any = {
    select: () => builder,
    eq: (field: string, value: any) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    in: (field: string, values: any[]) => {
      filters.push((row) => values.includes(row[field]));
      return builder;
    },
    limit: (count: number) => {
      limitCount = count;
      return builder;
    },
    maybeSingle: async () => {
      const result = await execute();
      return { data: result.data[0] ?? null, error: null };
    },
    upsert: async (value: Row, options?: { onConflict?: string }) => {
      if (options?.onConflict !== 'user_id,tenant_id') {
        return { data: null, error: new Error('Unexpected conflict target') };
      }

      const existingIndex = state.user_notification_preferences.findIndex((row) =>
        row.user_id === value.user_id && row.tenant_id === value.tenant_id
      );

      if (existingIndex >= 0) {
        state.user_notification_preferences[existingIndex] = {
          ...state.user_notification_preferences[existingIndex],
          ...value,
        };
      } else {
        state.user_notification_preferences.push({ ...value });
      }

      return { data: null, error: null };
    },
    then: (resolve: (value: any) => any, reject: (reason?: any) => any) => execute().then(resolve, reject),
  };

  return builder;
}

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: {
    from: (table: keyof typeof state) => createQueryBuilder(table),
  },
  supabaseAdmin: {
    from: (table: keyof typeof state) => createQueryBuilder(table),
  },
}));

jest.mock('../../src/notifications/controllers/notification_controller', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {
    const noContent = jest.fn((_req: any, res: any) => res.status(204).send());
    return {
      acknowledgeSignal: noContent,
      createNotification: noContent,
      deleteNotification: noContent,
      getNotificationById: noContent,
      getNotificationStats: noContent,
      getNotificationTypes: noContent,
      getNotifications: noContent,
      healthCheck: noContent,
      markAllAsRead: noContent,
      markAsRead: noContent,
      recordClientReceipt: noContent,
      updateNotification: noContent,
    };
  }),
}));

jest.mock('../../src/services/operationalControlService', () => ({
  __esModule: true,
  default: {
    isEnabled: jest.fn(async () => true),
  },
}));

jest.mock('../../src/workers/refundFilingWorker', () => ({
  __esModule: true,
  default: {
    getSubmissionQueueMetrics: jest.fn(async () => ({ available: true, reason: null })),
  },
}));

jest.mock('../../src/services/agent7ResumeService', () => ({
  __esModule: true,
  default: {
    reevaluateClearableCasesForUser: jest.fn(async () => ({ resumed: 0 })),
  },
}));

import notificationRoutes from '../../src/notifications/routes/notification_routes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.userId = String(req.headers['x-test-user'] || 'user-a');
    req.tenant = {
      tenantId: String(req.headers['x-test-tenant'] || 'tenant-a'),
      tenantSlug: 'test-workspace',
      tenantStatus: 'active',
      userRole: 'owner',
    };
    next();
  });
  app.use('/api/notifications', notificationRoutes);
  return app;
}

function scoped(app: express.Express, userId: string, tenantId: string) {
  return {
    get: () => request(app)
      .get('/api/notifications/preferences/filing')
      .set('x-test-user', userId)
      .set('x-test-tenant', tenantId),
    put: (body: string | object) => request(app)
      .put('/api/notifications/preferences/filing')
      .set('x-test-user', userId)
      .set('x-test-tenant', tenantId)
      .send(body),
  };
}

describe('Settings Auto-File preference contract', () => {
  beforeEach(() => {
    state.user_notification_preferences = [];
    state.users = [
      { id: 'user-a', is_paid_beta: true, amazon_seller_id: 'seller-a', seller_id: 'seller-a' },
      { id: 'user-b', is_paid_beta: true, amazon_seller_id: 'seller-b', seller_id: 'seller-b' },
    ];
    state.dispute_cases = [];
  });

  it('fails closed when no seller filing preference has been persisted', async () => {
    const app = createApp();

    const response = await scoped(app, 'user-a', 'tenant-a').get();

    expect(response.status).toBe(200);
    expect(response.body.data.enabled).toBe(false);
    expect(response.body.data.gateStatus.sellerIntentEnabled).toBe(false);
  });

  it('validates, persists, returns, and idempotently upserts the authenticated user preference', async () => {
    const app = createApp();
    const userATenantA = scoped(app, 'user-a', 'tenant-a');

    const invalid = await userATenantA.put({ enabled: 'true' });
    expect(invalid.status).toBe(400);
    expect(state.user_notification_preferences).toHaveLength(0);

    const firstWrite = await userATenantA.put({ enabled: true });
    expect(firstWrite.status).toBe(200);
    expect(firstWrite.body.data.enabled).toBe(true);
    expect(firstWrite.body.data.gateStatus.sellerIntentEnabled).toBe(true);

    const reread = await userATenantA.get();
    expect(reread.status).toBe(200);
    expect(reread.body.data.enabled).toBe(true);

    const repeatWrite = await userATenantA.put({ enabled: true });
    expect(repeatWrite.status).toBe(200);
    expect(state.user_notification_preferences).toHaveLength(1);
    expect(state.user_notification_preferences[0]).toMatchObject({
      user_id: 'user-a',
      tenant_id: 'tenant-a',
      preferences: { auto_file_cases: { enabled: true } },
    });
  });

  it('does not leak one user’s filing authority across tenants or users', async () => {
    const app = createApp();

    const ownerWrite = await scoped(app, 'user-a', 'tenant-a').put({ enabled: true });
    expect(ownerWrite.status).toBe(200);

    const sameUserOtherTenant = await scoped(app, 'user-a', 'tenant-b').get();
    expect(sameUserOtherTenant.status).toBe(200);
    expect(sameUserOtherTenant.body.data.enabled).toBe(false);

    const otherUserSameTenant = await scoped(app, 'user-b', 'tenant-a').get();
    expect(otherUserSameTenant.status).toBe(200);
    expect(otherUserSameTenant.body.data.enabled).toBe(false);

    expect(state.user_notification_preferences).toHaveLength(1);
  });
});
