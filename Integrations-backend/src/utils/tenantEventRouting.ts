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

  if (!tenantId) {
    logger.warn('Tenant event routing requested without explicit tenant scope', { userId });
    return {};
  }

  return {
    tenantId,
    tenantSlug: await resolveTenantSlug(tenantId)
  };
}
