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
const DEMO_TENANT_SLUG = 'demo-workspace';
const ALLOW_EXPLICIT_DEMO_RUNTIME = process.env.ALLOW_DEMO_USER === 'true';

/**
 * Paths that skip tenant resolution
 */
const TENANT_EXEMPT_PATHS = [
    '/health',
    '/healthz',
    '/',
    '/api/status',
    '/api/metrics/track',
    '/api/v1/integrations/amazon/diagnose/live',
    '/api/v1/integrations/amazon/diagnose/seller-central-readiness',
    '/api/integrations/amazon/diagnose/live',
    '/api/integrations/amazon/diagnose/seller-central-readiness',
    '/api/webhooks/amazon/notifications',
    '/api/auth',
    '/api/amazon/callback',
    '/api/v1/integrations/amazon/auth',
    '/api/v1/integrations/gmail/callback',
    '/api/v1/integrations/gmail/auth',
    '/api/v1/integrations/outlook/callback',
    '/api/v1/integrations/outlook/auth',
    '/api/v1/integrations/gdrive/callback',
    '/api/v1/integrations/gdrive/auth',
    '/api/v1/integrations/dropbox/callback',
    '/api/v1/integrations/dropbox/auth',
    '/api/v1/integrations/onedrive/callback',
    '/api/v1/integrations/adobe_sign/callback',
    '/api/v1/integrations/slack/callback',
    '/api/admin/revenue',
    '/api/admin/users',
    '/api/admin/queue',
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

function getRequestedTenantSlug(req: Request): string | null {
    const fullPath = req.originalUrl?.split('?')[0] || req.path;
    const queryTenantSlug = String(req.query.tenantSlug || req.query.tenant_slug || req.query.slug || '').trim();
    return extractTenantSlugFromPath(fullPath) || queryTenantSlug || null;
}

function getExplicitTenantId(req: Request): string | null {
    return String(req.headers['x-tenant-id'] || '').trim() || null;
}

function isExplicitDemoRequest(req: Request): boolean {
    if (!ALLOW_EXPLICIT_DEMO_RUNTIME) {
        return false;
    }

    return getRequestedTenantSlug(req) === DEMO_TENANT_SLUG;
}

/**
 * Get tenant by slug
 */
async function getTenantBySlug(slug: string): Promise<any | null> {
    const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name, slug, plan, status, metadata')
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
        .select('id, name, slug, plan, status, metadata')
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

function isDemoTenant(tenant: any): boolean {
    return tenant?.slug === DEMO_TENANT_SLUG || tenant?.metadata?.is_demo_workspace === true;
}

async function ensureDemoMembership(userId: string, tenantId: string): Promise<any | null> {
    const { error } = await supabaseAdmin
        .from('tenant_memberships')
        .upsert({
            tenant_id: tenantId,
            user_id: userId,
            role: 'viewer',
            is_active: true,
            accepted_at: new Date().toISOString()
        }, {
            onConflict: 'tenant_id,user_id'
        });

    if (error) {
        logger.error('Failed to create demo workspace membership', { error, userId, tenantId });
        return null;
    }

    return { role: 'viewer', is_active: true };
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
 * 5. Fail closed unless an explicit demo workspace request is allowed
 */
export async function tenantMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const fullPath = req.originalUrl?.split('?')[0] || req.path;
        const explicitDemoRequest = isExplicitDemoRequest(req);
        const explicitTenantSlug = getRequestedTenantSlug(req);
        const explicitTenantId = getExplicitTenantId(req);

        // Skip tenant resolution for exempt paths
        if (isTenantExempt(fullPath)) {
            return next();
        }

        const userId = (req as any).userId;

        if (!userId || userId === 'demo-user') {
            if (!explicitDemoRequest) {
                logger.warn('Rejecting request without authenticated user context', { path: fullPath });
                res.status(401).json({ error: 'Authenticated user context is required for this workspace route' });
                return;
            }

            const demoTenant = await getTenantBySlug(DEMO_TENANT_SLUG) || await getTenantById(DEFAULT_TENANT_ID);
            if (!demoTenant) {
                res.status(503).json({ error: 'Demo workspace is unavailable' });
                return;
            }

            (req as any).tenant = {
                tenantId: demoTenant.id,
                tenantName: demoTenant.name,
                tenantSlug: demoTenant.slug,
                tenantPlan: demoTenant.plan,
                tenantStatus: demoTenant.status,
                userRole: 'viewer'
            } as TenantContext;

            logger.info('Using isolated explicit demo tenant context', { path: fullPath, tenantSlug: demoTenant.slug });
            return next();
        }

        let tenant: any = null;
        let membership: any = null;

        // 1. Try URL path or query parameter
        if (explicitTenantSlug) {
            tenant = await getTenantBySlug(explicitTenantSlug);
            if (!tenant) {
                logger.warn('Explicit tenant slug not found', { userId, tenantSlug: explicitTenantSlug, path: fullPath });
                res.status(404).json({ error: 'Tenant not found' });
                return;
            }

            membership = await getUserMembership(userId, tenant.id);
            if (!membership) {
                if (explicitDemoRequest && isDemoTenant(tenant)) {
                    membership = await ensureDemoMembership(userId, tenant.id);
                }

                if (!membership) {
                    logger.warn('User does not have access to tenant', { userId, tenantSlug: explicitTenantSlug });
                    res.status(403).json({ error: 'You do not have access to this workspace' });
                    return;
                }
            }
        }

        // 2. Try X-Tenant-Id header
        if (!tenant && explicitTenantId) {
            tenant = await getTenantById(explicitTenantId);
            if (!tenant) {
                logger.warn('Explicit tenant header not found', { userId, tenantId: explicitTenantId, path: fullPath });
                res.status(404).json({ error: 'Tenant not found' });
                return;
            }

            membership = await getUserMembership(userId, explicitTenantId);
            if (!membership) {
                if (explicitDemoRequest && isDemoTenant(tenant)) {
                    membership = await ensureDemoMembership(userId, tenant.id);
                }

                if (!membership) {
                    logger.warn('User does not have access to tenant from explicit header', { userId, tenantId: explicitTenantId });
                    res.status(403).json({ error: 'You do not have access to this workspace' });
                    return;
                }
            }
        }

        // 3. Fall back to user's default tenant
        if (!tenant && !explicitTenantSlug && !explicitTenantId) {
            const defaultResult = await getDefaultTenantForUser(userId);
            if (defaultResult) {
                tenant = defaultResult.tenant;
                membership = defaultResult.membership;
            }
        }

        // 4. Explicit demo fallback only
        if (!tenant && !explicitTenantSlug && !explicitTenantId) {
            if (explicitDemoRequest) {
                const demoTenant = await getTenantBySlug(DEMO_TENANT_SLUG) || await getTenantById(DEFAULT_TENANT_ID);
                if (demoTenant) {
                    membership = await ensureDemoMembership(userId, demoTenant.id);
                    tenant = demoTenant;
                }
            }
        }

        if (!tenant || !membership) {
            logger.warn('No tenant membership found for user; failing closed', { userId, path: fullPath });
            res.status(403).json({ error: 'No active workspace membership found for this request' });
            return;
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
        if (!isDemoTenant(tenant)) {
            updateLastActiveTenant(userId, tenant.id).catch(err =>
                logger.warn('Failed to update last active tenant', { error: err.message })
            );
        }

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
