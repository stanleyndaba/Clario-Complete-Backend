import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const state = {
  users: [] as Row[],
  tenants: [] as Row[],
  tenant_memberships: [] as Row[],
};

const operations = {
  insertedUsers: 0,
  updatedUsers: [] as Row[],
};

function rowMatches(row: Row, filters: Array<(row: Row) => boolean>) {
  return filters.every((filter) => filter(row));
}

function createBuilder(table: keyof typeof state) {
  const filters: Array<(row: Row) => boolean> = [];
  let insertPayload: Row | null = null;
  let updatePayload: Row | null = null;

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
    order: () => builder,
    maybeSingle: async () => {
      const rows = readRows();
      return { data: rows[0] || null, error: null };
    },
    single: async () => {
      const rows = readRows();
      return { data: rows[0] || null, error: null };
    },
    insert: (payload: Row) => {
      insertPayload = payload;
      if (table === 'users') {
        operations.insertedUsers += 1;
      }
      state[table].push(payload);
      return builder;
    },
    update: (payload: Row) => {
      updatePayload = payload;
      const rows = state[table].filter((row) => rowMatches(row, filters));
      rows.forEach((row) => Object.assign(row, payload));
      if (table === 'users') {
        operations.updatedUsers.push(payload);
      }
      return builder;
    },
    upsert: (payload: Row) => {
      state[table].push(payload);
      return builder;
    },
    delete: () => builder,
    then: (resolve: (value: any) => any, reject: (reason?: any) => any) =>
      Promise.resolve({ data: readRows(), error: null }).then(resolve, reject),
  };

  function readRows() {
    if (insertPayload) {
      return [insertPayload];
    }

    if (updatePayload) {
      return state[table].filter((row) => rowMatches(row, filters));
    }

    const rows = state[table].filter((row) => rowMatches(row, filters));
    if (table === 'tenant_memberships') {
      return rows.map((row) => ({
        ...row,
        tenants: state.tenants.find((tenant) => tenant.id === row.tenant_id) || null,
      }));
    }
    return rows;
  }

  return builder;
}

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: {
    from: (table: keyof typeof state) => createBuilder(table),
  },
  supabaseAdmin: {
    from: (table: keyof typeof state) => createBuilder(table),
  },
  convertUserIdToUuid: (value: string) => value,
}));

jest.mock('../../src/utils/sellerIdentity', () => ({
  buildPendingAmazonSellerId: (userId: string) => `pending-${userId}`,
}));

import { ensureAuthenticatedUserWorkspace } from '../../src/services/userWorkspaceBootstrap';

describe('ensureAuthenticatedUserWorkspace Clerk identity reconciliation', () => {
  beforeEach(() => {
    operations.insertedUsers = 0;
    operations.updatedUsers = [];
    state.tenants = [
      {
        id: 'tenant-existing',
        name: 'Existing Workspace',
        slug: 'existing-workspace',
        plan: 'free',
        status: 'active',
        metadata: {},
        deleted_at: null,
      },
    ];
    state.users = [
      {
        id: 'neon-user-existing',
        email: 'seller@example.com',
        company_name: 'Existing Workspace',
        tenant_id: 'tenant-existing',
        last_active_tenant_id: 'tenant-existing',
        amazon_seller_id: 'pending-neon-user-existing',
        seller_id: null,
        clerk_user_id: 'user_old',
        deleted_at: null,
      },
    ];
    state.tenant_memberships = [
      {
        id: 'membership-existing',
        tenant_id: 'tenant-existing',
        user_id: 'neon-user-existing',
        role: 'owner',
        is_active: true,
        deleted_at: null,
      },
    ];
  });

  it('reuses an existing Neon user when a recreated Clerk identity has the same verified email', async () => {
    const result = await ensureAuthenticatedUserWorkspace({
      userId: 'user_new',
      clerkUserId: 'user_new',
      email: 'seller@example.com',
      preferredWorkspaceName: 'Seller',
      authProvider: 'clerk',
    });

    expect(result.userId).toBe('neon-user-existing');
    expect(result.tenant.id).toBe('tenant-existing');
    expect(result.createdUser).toBe(false);
    expect(result.createdTenant).toBe(false);
    expect(operations.insertedUsers).toBe(0);
    expect(state.users).toHaveLength(1);
    expect(state.users[0].clerk_user_id).toBe('user_new');
  });

  it('preserves the raw Clerk subject when bootstrap receives an already-resolved Margin UUID', async () => {
    const result = await ensureAuthenticatedUserWorkspace({
      userId: 'neon-user-existing',
      clerkUserId: 'user_clerk_current',
      email: 'seller@example.com',
      preferredTenantSlug: 'existing-workspace',
      authProvider: 'clerk',
    });

    expect(result.userId).toBe('neon-user-existing');
    expect(result.tenant.id).toBe('tenant-existing');
    expect(result.createdUser).toBe(false);
    expect(result.createdTenant).toBe(false);
    expect(operations.insertedUsers).toBe(0);
    expect(state.users).toHaveLength(1);
    expect(state.users[0].clerk_user_id).toBe('user_clerk_current');
    expect(state.users[0].clerk_user_id).not.toBe('neon-user-existing');
  });
});
