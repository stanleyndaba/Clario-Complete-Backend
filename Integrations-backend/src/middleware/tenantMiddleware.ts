import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

/**
 * Tenant context attached to every request
 */
export interface TenantContext {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    tenantPlan: 'free' | 'starter' | 'professional' | 'enterprise';
    tenantStatus: 'active' | 'trialing' | 'suspended' | 'read_only' | 'canceled' | 'deleted';
    userRole: 'owner' | 'admin' | 'member' | 'viewer';
}

/**
 * Default tenant ID for demo/migration mode
 */
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Paths that skip tenant resolution
 */
const TENANT_EXEMPT_PATHS = [
    '/health',
    '/healthz',
    '/',
    '/api/status',
    '/api/metrics/track',
    '/api/auth',
    '/api/amazon/callback',
    '/api/v1/integrations/amazon/auth',
    '/api/v1/integrations/gmail/auth',
];

/**
 * Check if path should skip tenant resolution
 */
function isTenantExempt(path: string): boolean {
    return TENANT_EXEMPT_PATHS.some(exempt =>
        path === exempt || path.startsWith(exempt + '/')
    );
}

/**
 * Extract tenant slug from URL path
 * Pattern: /app/:tenantSlug/*
 */
function extractTenantSlugFromPath(path: string): string | null {
    const match = path.match(/^\/app\/([^\/]+)/);
    return match ? match[1] : null;
}

/**
 * Get tenant by slug
 */
async function getTenantBySlug(slug: string): Promise<any | null> {
    const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name, slug, plan, status')
        .eq('slug', slug)
        .is('deleted_at', null)
        .single();

    if (error || !data) return null;
    return data;
}

/**
 * Get tenant by ID
 */
async function getTenantById(tenantId: string): Promise<any | null> {
    const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name, slug, plan, status')
        .eq('id', tenantId)
        .is('deleted_at', null)
        .single();

    if (error || !data) return null;
    return data;
}

/**
 * Check if user has membership in tenant
 */
async function getUserMembership(userId: string, tenantId: string): Promise<any | null> {
    const { data, error } = await supabaseAdmin
        .from('tenant_memberships')
        .select('id, role, is_active')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .single();

    if (error || !data) return null;
    return data;
}

/**
 * Get user's default tenant (first active membership or last active)
 */
async function getDefaultTenantForUser(userId: string): Promise<{ tenant: any; membership: any } | null> {
    // First try last active tenant
    const { data: user } = await supabaseAdmin
        .from('users')
        .select('last_active_tenant_id')
        .eq('id', userId)
        .single();

    if (user?.last_active_tenant_id) {
        const membership = await getUserMembership(userId, user.last_active_tenant_id);
        if (membership) {
            const tenant = await getTenantById(user.last_active_tenant_id);
            if (tenant) return { tenant, membership };
        }
    }

    // Fall back to first active membership
    const { data: firstMembership, error } = await supabaseAdmin
        .from('tenant_memberships')
        .select(`
      id, role, is_active, tenant_id,
      tenants (id, name, slug, plan, status)
    `)
        .eq('user_id', userId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    if (error || !firstMembership) return null;

    return {
        tenant: firstMembership.tenants,
        membership: { id: firstMembership.id, role: firstMembership.role, is_active: firstMembership.is_active }
    };
}

/**
 * Update user's last active tenant
 */
async function updateLastActiveTenant(userId: string, tenantId: string): Promise<void> {
    await supabaseAdmin
        .from('users')
        .update({
            last_active_tenant_id: tenantId,
            last_active_at: new Date().toISOString()
        })
        .eq('id', userId);
}

/**
 * Tenant Resolution Middleware
 * 
 * Resolution order:
 * 1. URL path (/app/:tenantSlug/*)
 * 2. X-Tenant-Id header
 * 3. User's last active tenant
 * 4. User's first active membership
 * 5. Default tenant (demo mode)
 */
export async function tenantMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const fullPath = req.originalUrl?.split('?')[0] || req.path;

        // Skip tenant resolution for exempt paths
        if (isTenantExempt(fullPath)) {
            return next();
        }

        const userId = (req as any).userId;

        // Demo mode: use default tenant
        if (!userId || userId === 'demo-user') {
            (req as any).tenant = {
                tenantId: DEFAULT_TENANT_ID,
                tenantName: 'Demo Tenant',
                tenantSlug: 'default',
                tenantPlan: 'enterprise',
                tenantStatus: 'active',
                userRole: 'owner'
            } as TenantContext;

            logger.debug('Using default tenant for demo mode', { path: fullPath });
            return next();
        }

        let tenant: any = null;
        let membership: any = null;

        // 1. Try URL path or query parameter
        const pathSlug = extractTenantSlugFromPath(fullPath) || (req.query.tenantSlug as string);
        if (pathSlug) {
            tenant = await getTenantBySlug(pathSlug);
            if (tenant) {
                membership = await getUserMembership(userId, tenant.id);
                if (!membership) {
                    logger.warn('User does not have access to tenant', { userId, tenantSlug: pathSlug });
                    res.status(403).json({ error: 'You do not have access to this workspace' });
                    return;
                }
            }
        }

        // 2. Try X-Tenant-Id header
        if (!tenant) {
            const headerTenantId = req.headers['x-tenant-id'] as string;
            if (headerTenantId) {
                membership = await getUserMembership(userId, headerTenantId);
                if (membership) {
                    tenant = await getTenantById(headerTenantId);
                }
            }
        }

        // 3. Fall back to user's default tenant
        if (!tenant) {
            const defaultResult = await getDefaultTenantForUser(userId);
            if (defaultResult) {
                tenant = defaultResult.tenant;
                membership = defaultResult.membership;
            }
        }

        // 4. Last resort: create membership in default tenant
        if (!tenant) {
            logger.warn('No tenant found for user, using default', { userId });

            // Create membership in default tenant
            const { error: membershipError } = await supabaseAdmin
                .from('tenant_memberships')
                .upsert({
                    tenant_id: DEFAULT_TENANT_ID,
                    user_id: userId,
                    role: 'member',
                    is_active: true,
                    accepted_at: new Date().toISOString()
                }, {
                    onConflict: 'tenant_id,user_id'
                });

            if (membershipError) {
                logger.error('Failed to create default membership', { error: membershipError, userId });
            }

            tenant = await getTenantById(DEFAULT_TENANT_ID);
            membership = { role: 'member' };
        }

        // Validate tenant status
        if (tenant.status === 'deleted') {
            res.status(410).json({ error: 'This workspace has been deleted' });
            return;
        }

        // Set tenant context
        (req as any).tenant = {
            tenantId: tenant.id,
            tenantName: tenant.name,
            tenantSlug: tenant.slug,
            tenantPlan: tenant.plan,
            tenantStatus: tenant.status,
            userRole: membership.role
        } as TenantContext;

        // Update last active tenant (async, don't wait)
        updateLastActiveTenant(userId, tenant.id).catch(err =>
            logger.warn('Failed to update last active tenant', { error: err.message })
        );

        logger.debug('Tenant context resolved', {
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            userId,
            role: membership.role
        });

        next();
    } catch (error: any) {
        logger.error('Error in tenantMiddleware', { error: error?.message });
        res.status(500).json({ error: 'Failed to resolve workspace context' });
    }
}

/**
 * Get current tenant from request
 */
export function getCurrentTenant(req: Request): TenantContext {
    const tenant = (req as any).tenant;
    if (!tenant) {
        throw new Error('Tenant context not available - ensure tenantMiddleware is applied');
    }
    return tenant;
}

/**
 * Get tenant ID from request
 */
export function getTenantId(req: Request): string {
    return getCurrentTenant(req).tenantId;
}

/**
 * Check if tenant is in active state (can write)
 */
export function canTenantWrite(req: Request): boolean {
    const tenant = getCurrentTenant(req);
    return tenant.tenantStatus === 'active' || tenant.tenantStatus === 'trialing';
}

/**
 * Check if user has required role
 */
export function hasRole(req: Request, requiredRoles: Array<'owner' | 'admin' | 'member' | 'viewer'>): boolean {
    const tenant = getCurrentTenant(req);
    return requiredRoles.includes(tenant.userRole);
}

/**
 * Middleware to require active tenant status for write operations
 */
export function requireActiveTenant(req: Request, res: Response, next: NextFunction): void {
    if (!canTenantWrite(req)) {
        const tenant = getCurrentTenant(req);
        res.status(403).json({
            error: 'Workspace is not active',
            status: tenant.tenantStatus,
            message: tenant.tenantStatus === 'suspended'
                ? 'Your account is suspended. Please update your payment method.'
                : tenant.tenantStatus === 'read_only'
                    ? 'Your account is in read-only mode due to a billing issue.'
                    : 'This workspace is not available for modifications.'
        });
        return;
    }
    next();
}

/**
 * Middleware to require specific roles
 */
export function requireRole(...roles: Array<'owner' | 'admin' | 'member' | 'viewer'>) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!hasRole(req, roles)) {
            res.status(403).json({
                error: 'Insufficient permissions',
                required: roles,
                current: getCurrentTenant(req).userRole
            });
            return;
        }
        next();
    };
}
