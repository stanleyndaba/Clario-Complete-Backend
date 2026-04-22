import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import { buildPendingAmazonSellerId } from '../src/utils/sellerIdentity';

type AppUser = {
  id: string;
  email?: string | null;
  company_name?: string | null;
  tenant_id?: string | null;
  last_active_tenant_id?: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
};

type Tenant = {
  id: string;
  name?: string | null;
  slug?: string | null;
  status?: string | null;
  deleted_at?: string | null;
};

type Membership = {
  id: string;
  tenant_id: string;
  user_id: string;
  role?: string | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
};

const KEEP_EMAIL = (process.env.KEEP_USER_EMAIL || 'mvelo@margin-finance.com').trim().toLowerCase();
const KEEP_TENANT_SLUG = (process.env.KEEP_TENANT_SLUG || 'demo-workspace').trim().toLowerCase();
const APPLY = process.argv.includes('--apply') || process.env.APPLY_LAUNCH_USER_CLEANUP === 'true';
const ALLOW_CLEANUP = process.env.ALLOW_LAUNCH_USER_CLEANUP === 'true';
const DELETE_AUTH_USERS = process.env.DELETE_AUTH_USERS === 'true';
const ALLOW_AUTH_DELETE = process.env.ALLOW_AUTH_USER_DELETE === 'true';
const PRESERVE_SYSTEM_TENANT_SLUGS = new Set([
  KEEP_TENANT_SLUG,
  'default',
]);

function isSchemaError(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    message.includes('does not exist') ||
    message.includes('could not find the') ||
    message.includes('schema cache')
  );
}

function maskEmail(email?: string | null): string {
  const value = String(email || '').trim().toLowerCase();
  if (!value || !value.includes('@')) return value || 'no-email';
  const [name, domain] = value.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}

async function listAuthUsers() {
  const users: any[] = [];
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      throw new Error(`Failed to list Supabase Auth users: ${error.message}`);
    }

    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

async function selectRows<T>(table: string, columns = '*'): Promise<T[]> {
  const { data, error } = await supabaseAdmin.from(table).select(columns);
  if (error) {
    throw new Error(`Failed to read ${table}: ${error.message}`);
  }
  return (data || []) as T[];
}

async function bestEffortDeleteByIds(table: string, field: string, ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabaseAdmin.from(table).delete().in(field, ids);
  if (error) {
    if (isSchemaError(error)) {
      console.log(`skip optional cleanup ${table}.${field}: ${error.message}`);
      return;
    }
    throw new Error(`Failed cleanup ${table}.${field}: ${error.message}`);
  }
}

async function hardDeleteAppUser(user: AppUser, now: string) {
  const { error } = await supabaseAdmin.from('users').delete().eq('id', user.id);
  if (!error) return;

  console.warn(`hard delete failed for app user ${user.id}; falling back to soft delete: ${error.message}`);
  const fallback = await supabaseAdmin
    .from('users')
    .update({ deleted_at: now, updated_at: now, status: 'locked' })
    .eq('id', user.id);
  if (fallback.error) {
    throw new Error(`Failed to remove app user ${user.id}: ${fallback.error.message}`);
  }
}

async function main() {
  if (!supabaseAdmin?.from || !supabaseAdmin?.auth?.admin) {
    throw new Error('Supabase admin client is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const [authUsers, appUsers, tenants, memberships] = await Promise.all([
    listAuthUsers(),
    selectRows<AppUser>('users', 'id, email, company_name, tenant_id, last_active_tenant_id, deleted_at, created_at'),
    selectRows<Tenant>('tenants', 'id, name, slug, status, deleted_at'),
    selectRows<Membership>('tenant_memberships', 'id, tenant_id, user_id, role, is_active, deleted_at'),
  ]);

  const demoTenant = tenants.find((tenant) => String(tenant.slug || '').toLowerCase() === KEEP_TENANT_SLUG);
  if (!demoTenant?.id) {
    throw new Error(`Refusing cleanup: tenant slug "${KEEP_TENANT_SLUG}" was not found.`);
  }

  const keptAuthUsers = authUsers.filter((user) => String(user.email || '').trim().toLowerCase() === KEEP_EMAIL);
  if (!keptAuthUsers.length) {
    throw new Error(`Refusing cleanup: Supabase Auth user "${KEEP_EMAIL}" was not found.`);
  }

  const keepUserIds = new Set<string>(keptAuthUsers.map((user) => String(user.id)).filter(Boolean));
  for (const user of appUsers) {
    if (String(user.email || '').trim().toLowerCase() === KEEP_EMAIL) {
      keepUserIds.add(user.id);
    }
  }

  const primaryUserId = keptAuthUsers[0].id as string;
  const activeAppUsers = appUsers.filter((user) => !user.deleted_at);
  const appUsersToRemove = activeAppUsers.filter((user) => !keepUserIds.has(user.id));
  const authUsersToDelete = authUsers.filter((user) => !keepUserIds.has(user.id));
  const tenantsToArchive = tenants.filter((tenant) => (
    !PRESERVE_SYSTEM_TENANT_SLUGS.has(String(tenant.slug || '').toLowerCase()) &&
    tenant.status !== 'deleted'
  ));
  const membershipsToRemove = memberships.filter((membership) => (
    !(membership.tenant_id === demoTenant.id && membership.user_id === primaryUserId) &&
    !membership.deleted_at
  ));

  console.log('Launch user cleanup plan');
  console.log({
    mode: APPLY ? 'apply' : 'dry-run',
    keepEmail: KEEP_EMAIL,
    keepTenantSlug: KEEP_TENANT_SLUG,
    primaryUserId,
    demoTenantId: demoTenant.id,
    authUsersTotal: authUsers.length,
    authUsersToDelete: authUsersToDelete.length,
    appUsersTotal: appUsers.length,
    appUsersActive: activeAppUsers.length,
    appUsersToRemove: appUsersToRemove.length,
    tenantsTotal: tenants.length,
    tenantsToArchive: tenantsToArchive.length,
    membershipsToDeactivate: membershipsToRemove.length,
    authDeleteEnabled: DELETE_AUTH_USERS && ALLOW_AUTH_DELETE,
  });

  if (!APPLY) {
    console.log('Dry-run only. Re-run with --apply and ALLOW_LAUNCH_USER_CLEANUP=true to change data.');
    console.log('Auth deletion additionally requires DELETE_AUTH_USERS=true and ALLOW_AUTH_USER_DELETE=true.');
    console.log('Auth users planned for deletion:', authUsersToDelete.map((user) => `${maskEmail(user.email)}:${user.id}`));
    console.log('App users planned for removal:', appUsersToRemove.map((user) => `${maskEmail(user.email)}:${user.id}`));
    console.log('Tenants planned for archival status:', tenantsToArchive.map((tenant) => `${tenant.slug}:${tenant.id}`));
    return;
  }

  if (!ALLOW_CLEANUP) {
    throw new Error('Refusing to apply cleanup without ALLOW_LAUNCH_USER_CLEANUP=true.');
  }

  const now = new Date().toISOString();

  const { error: restoreDemoTenantError } = await supabaseAdmin
    .from('tenants')
    .update({ deleted_at: null, status: demoTenant.status === 'deleted' ? 'read_only' : demoTenant.status, updated_at: now })
    .eq('id', demoTenant.id);
  if (restoreDemoTenantError) {
    throw new Error(`Failed to keep demo tenant active: ${restoreDemoTenantError.message}`);
  }

  const existingPrimaryAppUser = appUsers.find((user) => user.id === primaryUserId);
  const preserveUserResult = existingPrimaryAppUser
    ? await supabaseAdmin
      .from('users')
      .update({
        email: KEEP_EMAIL,
        tenant_id: demoTenant.id,
        last_active_tenant_id: demoTenant.id,
        deleted_at: null,
        updated_at: now,
      })
      .eq('id', primaryUserId)
    : await supabaseAdmin
      .from('users')
      .insert({
      id: primaryUserId,
      email: KEEP_EMAIL,
      company_name: 'Margin Finance',
      tenant_id: demoTenant.id,
      last_active_tenant_id: demoTenant.id,
      amazon_seller_id: buildPendingAmazonSellerId(primaryUserId),
      deleted_at: null,
      updated_at: now,
    });
  if (preserveUserResult.error) {
    throw new Error(`Failed to preserve ${KEEP_EMAIL} app user: ${preserveUserResult.error.message}`);
  }

  const { error: membershipError } = await supabaseAdmin
    .from('tenant_memberships')
    .upsert({
      tenant_id: demoTenant.id,
      user_id: primaryUserId,
      role: 'owner',
      is_active: true,
      accepted_at: now,
      deleted_at: null,
      updated_at: now,
    }, { onConflict: 'tenant_id,user_id' });
  if (membershipError) {
    throw new Error(`Failed to preserve demo workspace membership: ${membershipError.message}`);
  }

  for (const tenant of tenantsToArchive) {
    const { error } = await supabaseAdmin
      .from('tenants')
      .update({ status: 'deleted', updated_at: now })
      .eq('id', tenant.id);
    if (error) {
      throw new Error(`Failed to archive tenant ${tenant.slug || tenant.id}: ${error.message}`);
    }
  }

  for (const membership of membershipsToRemove) {
    const { error } = await supabaseAdmin
      .from('tenant_memberships')
      .update({ is_active: false, deleted_at: now, updated_at: now })
      .eq('id', membership.id);
    if (error) {
      throw new Error(`Failed to deactivate demo membership ${membership.id}: ${error.message}`);
    }
  }

  const removedAppUserIds = appUsersToRemove.map((user) => user.id);
  await bestEffortDeleteByIds('tokens', 'user_id', removedAppUserIds);
  await bestEffortDeleteByIds('oauth_tokens', 'user_id', removedAppUserIds);
  await bestEffortDeleteByIds('user_notification_preferences', 'user_id', removedAppUserIds);

  for (const user of appUsersToRemove) {
    await hardDeleteAppUser(user, now);
  }

  if (DELETE_AUTH_USERS) {
    if (!ALLOW_AUTH_DELETE) {
      throw new Error('Refusing to delete Supabase Auth users without ALLOW_AUTH_USER_DELETE=true.');
    }

    for (const user of authUsersToDelete) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
      if (error) {
        throw new Error(`Failed to delete auth user ${user.id}: ${error.message}`);
      }
    }
  } else {
    console.log('Skipped Supabase Auth deletion. Set DELETE_AUTH_USERS=true and ALLOW_AUTH_USER_DELETE=true to delete auth users.');
  }

  console.log('Cleanup complete', {
    keptEmail: KEEP_EMAIL,
    keptAuthUserId: primaryUserId,
    keptTenantSlug: KEEP_TENANT_SLUG,
    archivedTenants: tenantsToArchive.length,
    removedAppUsers: appUsersToRemove.length,
    deletedAuthUsers: DELETE_AUTH_USERS ? authUsersToDelete.length : 0,
  });
}

main().catch((error) => {
  console.error('Launch user cleanup failed:', error?.message || error);
  process.exit(1);
});
