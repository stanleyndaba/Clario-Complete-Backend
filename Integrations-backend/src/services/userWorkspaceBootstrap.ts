import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import { buildPendingAmazonSellerId } from '../utils/sellerIdentity';

type TenantRole = 'owner' | 'admin' | 'member' | 'viewer';

interface BootstrapTenant {
  id: string;
  name: string;
  slug: string;
  plan?: string;
  status?: string;
}

export interface BootstrapWorkspaceResult {
  userId: string;
  email: string | null;
  tenant: BootstrapTenant;
  role: TenantRole;
  createdUser: boolean;
  createdTenant: boolean;
}

interface BootstrapOptions {
  userId: string;
  email?: string | null;
  preferredWorkspaceName?: string | null;
  preferredTenantSlug?: string | null;
}

function deriveWorkspaceName(email?: string | null): string {
  const normalized = String(email || '').trim().toLowerCase();
  const domain = normalized.split('@')[1] || '';
  const base = domain.split('.')[0] || normalized.split('@')[0] || 'workspace';
  const pretty = base
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return pretty || 'Workspace';
}

function slugifyWorkspace(value?: string | null): string {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  return slug || 'workspace';
}

async function ensureUniqueTenantSlug(baseSlug: string) {
  const adminClient = supabaseAdmin || supabase;
  const normalizedBase = slugifyWorkspace(baseSlug);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? normalizedBase : `${normalizedBase}-${attempt + 1}`.slice(0, 60);
    const { data, error } = await adminClient
      .from('tenants')
      .select('id')
      .eq('slug', candidate)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to validate workspace slug: ${error.message}`);
    }

    if (!data?.id) {
      return candidate;
    }
  }

  return `${normalizedBase}-${Date.now().toString().slice(-6)}`.slice(0, 60);
}

export async function ensureAuthenticatedUserWorkspace(options: BootstrapOptions): Promise<BootstrapWorkspaceResult> {
  const adminClient = supabaseAdmin || supabase;
  const safeUserId = convertUserIdToUuid(options.userId);
  const normalizedEmail = options.email?.trim().toLowerCase() || null;

  const { data: existingUser, error: existingUserError } = await adminClient
    .from('users')
    .select('id, email, company_name, tenant_id, last_active_tenant_id, amazon_seller_id, seller_id')
    .eq('id', safeUserId)
    .maybeSingle();

  if (existingUserError) {
    throw new Error(`Failed to load authenticated app user: ${existingUserError.message}`);
  }

  const { data: activeMemberships, error: membershipsError } = await adminClient
    .from('tenant_memberships')
    .select(`
      id,
      role,
      tenant_id,
      tenants (id, name, slug, plan, status)
    `)
    .eq('user_id', safeUserId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (membershipsError) {
    throw new Error(`Failed to load workspace memberships: ${membershipsError.message}`);
  }

  const preferredTenantSlug = options.preferredTenantSlug ? slugifyWorkspace(options.preferredTenantSlug) : null;
  const memberships = (activeMemberships || []) as any[];
  let chosenMembership =
    memberships.find((membership) => preferredTenantSlug && membership.tenants?.slug === preferredTenantSlug) ||
    memberships.find((membership) => membership.tenant_id === existingUser?.last_active_tenant_id) ||
    memberships.find((membership) => membership.tenant_id === existingUser?.tenant_id) ||
    memberships[0] ||
    null;

  let tenant = chosenMembership?.tenants as BootstrapTenant | null;
  let role = (chosenMembership?.role || 'owner') as TenantRole;
  let createdTenant = false;

  if (!tenant && existingUser?.tenant_id) {
    const { data: tenantRecord, error: tenantError } = await adminClient
      .from('tenants')
      .select('id, name, slug, plan, status')
      .eq('id', existingUser.tenant_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (tenantError) {
      throw new Error(`Failed to restore stored workspace: ${tenantError.message}`);
    }

    if (tenantRecord?.id) {
      tenant = tenantRecord as BootstrapTenant;

      const { error: membershipUpsertError } = await adminClient
        .from('tenant_memberships')
        .upsert({
          tenant_id: tenant.id,
          user_id: safeUserId,
          role: 'owner',
          is_active: true,
          accepted_at: new Date().toISOString(),
          deleted_at: null
        }, {
          onConflict: 'tenant_id,user_id'
        });

      if (membershipUpsertError) {
        throw new Error(`Failed to restore workspace membership: ${membershipUpsertError.message}`);
      }

      role = 'owner';
    }
  }

  const workspaceName = options.preferredWorkspaceName?.trim() || existingUser?.company_name || deriveWorkspaceName(normalizedEmail);

  if (!tenant) {
    const slugBase = preferredTenantSlug || slugifyWorkspace(workspaceName);
    const tenantSlug = await ensureUniqueTenantSlug(slugBase);

    const { data: createdWorkspace, error: createTenantError } = await adminClient
      .from('tenants')
      .insert({
        name: workspaceName,
        slug: tenantSlug,
        plan: 'free',
        status: 'active',
        created_by: safeUserId
      })
      .select('id, name, slug, plan, status')
      .single();

    if (createTenantError || !createdWorkspace?.id) {
      throw new Error(`Failed to create initial workspace: ${createTenantError?.message || 'Unknown workspace creation error'}`);
    }

    const { error: createMembershipError } = await adminClient
      .from('tenant_memberships')
      .insert({
        tenant_id: createdWorkspace.id,
        user_id: safeUserId,
        role: 'owner',
        is_active: true,
        accepted_at: new Date().toISOString()
      });

    if (createMembershipError) {
      await adminClient.from('tenants').delete().eq('id', createdWorkspace.id);
      throw new Error(`Failed to create initial workspace membership: ${createMembershipError.message}`);
    }

    tenant = createdWorkspace as BootstrapTenant;
    role = 'owner';
    createdTenant = true;
  }

  const now = new Date().toISOString();
  let createdUser = false;

  if (existingUser?.id) {
    const updatePayload: Record<string, unknown> = {
      email: normalizedEmail || existingUser.email || null,
      company_name: existingUser.company_name || workspaceName,
      tenant_id: tenant.id,
      last_active_tenant_id: tenant.id,
      last_active_at: now,
      updated_at: now
    };

    const { error: updateUserError } = await adminClient
      .from('users')
      .update(updatePayload)
      .eq('id', safeUserId);

    if (updateUserError) {
      throw new Error(`Failed to update authenticated app user: ${updateUserError.message}`);
    }
  } else {
    const baseUserPayload = {
      id: safeUserId,
      email: normalizedEmail,
      company_name: workspaceName,
      tenant_id: tenant.id,
      last_active_tenant_id: tenant.id,
      last_active_at: now,
      created_at: now,
      updated_at: now
    };

    const initialInsert = await adminClient
      .from('users')
      .insert(baseUserPayload)
      .select('id')
      .maybeSingle();

    if (initialInsert.error) {
      const requiresAmazonSellerIdentity =
        initialInsert.error.code === '23502' ||
        initialInsert.error.message?.includes('amazon_seller_id');

      if (!requiresAmazonSellerIdentity) {
        throw new Error(`Failed to create authenticated app user: ${initialInsert.error.message}`);
      }

      const fallbackInsert = await adminClient
        .from('users')
        .insert({
          ...baseUserPayload,
          amazon_seller_id: buildPendingAmazonSellerId(safeUserId)
        })
        .select('id')
        .single();

      if (fallbackInsert.error) {
        throw new Error(`Failed to create authenticated app user: ${fallbackInsert.error.message}`);
      }
    }

    createdUser = true;
  }

  return {
    userId: safeUserId,
    email: normalizedEmail,
    tenant,
    role,
    createdUser,
    createdTenant
  };
}
