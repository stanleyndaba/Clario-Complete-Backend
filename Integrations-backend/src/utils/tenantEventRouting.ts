import { supabaseAdmin } from '../database/supabaseClient';
import logger from './logger';

interface TenantContext {
  tenantId?: string;
  tenantSlug?: string;
}

const tenantSlugCache = new Map<string, { slug: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCachedTenantSlug(tenantId?: string): string | undefined {
  if (!tenantId) return undefined;
  const entry = tenantSlugCache.get(tenantId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    tenantSlugCache.delete(tenantId);
    return undefined;
  }
  return entry.slug;
}

function writeTenantSlugCache(tenantId: string, tenantSlug: string): void {
  tenantSlugCache.set(tenantId, {
    slug: tenantSlug,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

export function getCachedTenantSlug(tenantId?: string): string | undefined {
  return readCachedTenantSlug(tenantId);
}

export async function resolveTenantSlug(tenantId?: string): Promise<string | undefined> {
  if (!tenantId || !supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    return undefined;
  }

  const cached = readCachedTenantSlug(tenantId);
  if (cached) {
    return cached;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('slug')
      .eq('id', tenantId)
      .single();

    if (error || !data?.slug) {
      return undefined;
    }

    writeTenantSlugCache(tenantId, data.slug);
    return data.slug;
  } catch (error: any) {
    logger.warn('Failed to resolve tenant slug for event routing', {
      tenantId,
      error: error?.message || error
    });
    return undefined;
  }
}

export async function resolveTenantContextForUser(userId: string, tenantId?: string): Promise<TenantContext> {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    return { tenantId, tenantSlug: getCachedTenantSlug(tenantId) };
  }

  if (tenantId) {
    return {
      tenantId,
      tenantSlug: await resolveTenantSlug(tenantId)
    };
  }

  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('last_active_tenant_id')
      .eq('id', userId)
      .single();

    const preferredTenantId = String(user?.last_active_tenant_id || '').trim() || undefined;
    if (preferredTenantId) {
      return {
        tenantId: preferredTenantId,
        tenantSlug: await resolveTenantSlug(preferredTenantId)
      };
    }

    const { data: membership, error } = await supabaseAdmin
      .from('tenant_memberships')
      .select('tenant_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !membership?.tenant_id) {
      return {};
    }

    const resolvedTenantId = String(membership.tenant_id);
    return {
      tenantId: resolvedTenantId,
      tenantSlug: await resolveTenantSlug(resolvedTenantId)
    };
  } catch (error: any) {
    logger.warn('Failed to resolve tenant context for event routing', {
      userId,
      error: error?.message || error
    });
    return {};
  }
}
