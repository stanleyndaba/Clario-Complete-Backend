/**
 * Tenant Management Routes
 * 
 * API endpoints for tenant/workspace management including:
 * - Get current tenant
 * - Switch tenant
 * - Manage memberships
 * - Invitations
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import {
    getCurrentTenant,
    getTenantId,
    requireRole,
    requireActiveTenant,
    TenantContext
} from '../middleware/tenantMiddleware';
import { tenantGuard, DEFAULT_TENANT_ID } from '../utils/tenantGuard';
import { logAuditFromRequest, AuditActions } from '../utils/auditService';
import logger from '../utils/logger';
import crypto from 'crypto';

const router = Router();

/**
 * GET /api/tenant/current
 * Get current tenant context
 */
router.get('/current', async (req: Request, res: Response) => {
    try {
        const tenant = getCurrentTenant(req);

        res.json({
            success: true,
            tenant: {
                id: tenant.tenantId,
                name: tenant.tenantName,
                slug: tenant.tenantSlug,
                plan: tenant.tenantPlan,
                status: tenant.tenantStatus,
                role: tenant.userRole
            }
        });
    } catch (error: any) {
        logger.error('Failed to get current tenant', { error: error.message });
        res.status(500).json({ error: 'Failed to get workspace context' });
    }
});

/**
 * GET /api/tenant/list
 * Get all tenants user has access to
 */
router.get('/list', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;

        const { data: memberships, error } = await supabaseAdmin
            .from('tenant_memberships')
            .select(`
        id, role, is_active,
        tenants (id, name, slug, plan, status)
      `)
            .eq('user_id', userId)
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

        if (error) {
            logger.error('Failed to list tenants', { error, userId });
            return res.status(500).json({ error: 'Failed to list workspaces' });
        }

        const tenants = memberships?.map(m => ({
            id: (m.tenants as any).id,
            name: (m.tenants as any).name,
            slug: (m.tenants as any).slug,
            plan: (m.tenants as any).plan,
            status: (m.tenants as any).status,
            role: m.role
        })) || [];

        res.json({
            success: true,
            tenants,
            count: tenants.length
        });
    } catch (error: any) {
        logger.error('Failed to list tenants', { error: error.message });
        res.status(500).json({ error: 'Failed to list workspaces' });
    }
});

/**
 * POST /api/tenant/create
 * Create a new tenant/workspace
 * Current user becomes the owner
 */
router.post('/create', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;
        const { name, slug } = req.body;

        if (!name || name.trim().length < 2) {
            return res.status(400).json({ error: 'Workspace name must be at least 2 characters' });
        }

        // Generate slug if not provided
        const tenantSlug = slug || name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50);

        // Check if slug already exists
        const { data: existing } = await supabaseAdmin
            .from('tenants')
            .select('id')
            .eq('slug', tenantSlug)
            .single();

        if (existing) {
            return res.status(409).json({ error: 'Workspace slug already exists' });
        }

        // Create the tenant
        const { data: tenant, error: tenantError } = await supabaseAdmin
            .from('tenants')
            .insert({
                name: name.trim(),
                slug: tenantSlug,
                plan: 'free',
                status: 'active',
                created_by: userId
            })
            .select()
            .single();

        if (tenantError || !tenant) {
            logger.error('Failed to create tenant', { error: tenantError, userId });
            return res.status(500).json({ error: 'Failed to create workspace' });
        }

        // Create owner membership
        const { error: membershipError } = await supabaseAdmin
            .from('tenant_memberships')
            .insert({
                tenant_id: tenant.id,
                user_id: userId,
                role: 'owner',
                is_active: true,
                accepted_at: new Date().toISOString()
            });

        if (membershipError) {
            logger.error('Failed to create owner membership', { error: membershipError, tenantId: tenant.id, userId });
            // Rollback: delete the tenant
            await supabaseAdmin.from('tenants').delete().eq('id', tenant.id);
            return res.status(500).json({ error: 'Failed to set up workspace ownership' });
        }

        // Update user's last active tenant
        await supabaseAdmin
            .from('users')
            .update({ last_active_tenant_id: tenant.id })
            .eq('id', userId);

        // Log audit
        logAuditFromRequest(req, AuditActions.TENANT_CREATED, 'tenant', tenant.id, {
            metadata: {
                tenantName: tenant.name,
                tenantSlug: tenant.slug
            }
        });

        logger.info('Tenant created', { tenantId: tenant.id, tenantSlug: tenant.slug, userId });

        res.status(201).json({
            success: true,
            tenant: {
                id: tenant.id,
                name: tenant.name,
                slug: tenant.slug,
                plan: tenant.plan,
                status: tenant.status,
                role: 'owner'
            },
            message: 'Workspace created successfully'
        });
    } catch (error: any) {
        logger.error('Failed to create tenant', { error: error.message });
        res.status(500).json({ error: 'Failed to create workspace' });
    }
});

/**
 * POST /api/tenant/switch
 * Switch to a different tenant
 */
router.post('/switch', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;
        const { tenantId, tenantSlug } = req.body;

        if (!tenantId && !tenantSlug) {
            return res.status(400).json({ error: 'Either tenantId or tenantSlug is required' });
        }

        // Find tenant
        let tenant;
        if (tenantId) {
            const { data } = await supabaseAdmin
                .from('tenants')
                .select('id, name, slug, plan, status')
                .eq('id', tenantId)
                .is('deleted_at', null)
                .single();
            tenant = data;
        } else {
            const { data } = await supabaseAdmin
                .from('tenants')
                .select('id, name, slug, plan, status')
                .eq('slug', tenantSlug)
                .is('deleted_at', null)
                .single();
            tenant = data;
        }

        if (!tenant) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        // Check membership
        const { data: membership } = await supabaseAdmin
            .from('tenant_memberships')
            .select('role')
            .eq('user_id', userId)
            .eq('tenant_id', tenant.id)
            .eq('is_active', true)
            .is('deleted_at', null)
            .single();

        if (!membership) {
            return res.status(403).json({ error: 'You do not have access to this workspace' });
        }

        // Update last active tenant
        await supabaseAdmin
            .from('users')
            .update({
                last_active_tenant_id: tenant.id,
                last_active_at: new Date().toISOString()
            })
            .eq('id', userId);

        res.json({
            success: true,
            tenant: {
                id: tenant.id,
                name: tenant.name,
                slug: tenant.slug,
                plan: tenant.plan,
                status: tenant.status,
                role: membership.role
            }
        });
    } catch (error: any) {
        logger.error('Failed to switch tenant', { error: error.message });
        res.status(500).json({ error: 'Failed to switch workspace' });
    }
});

/**
 * GET /api/tenant/members
 * Get members of current tenant
 */
router.get('/members', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);

        const { data: memberships, error } = await supabaseAdmin
            .from('tenant_memberships')
            .select(`
        id, role, is_active, created_at, accepted_at,
        user_id
      `)
            .eq('tenant_id', tenantId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

        if (error) {
            logger.error('Failed to get members', { error, tenantId });
            return res.status(500).json({ error: 'Failed to get members' });
        }

        // Get user details
        const userIds = memberships?.map(m => m.user_id) || [];
        const { data: users } = await supabaseAdmin
            .from('users')
            .select('id, email, created_at')
            .in('id', userIds);

        const userMap = new Map<string, { id: string; email: string; created_at: string }>(
            users?.map(u => [u.id, u as { id: string; email: string; created_at: string }]) || []
        );

        const members = memberships?.map(m => ({
            id: m.id,
            userId: m.user_id,
            email: userMap.get(m.user_id)?.email || 'Unknown',
            role: m.role,
            isActive: m.is_active,
            joinedAt: m.accepted_at || m.created_at
        })) || [];

        res.json({
            success: true,
            members,
            count: members.length
        });
    } catch (error: any) {
        logger.error('Failed to get members', { error: error.message });
        res.status(500).json({ error: 'Failed to get members' });
    }
});

/**
 * POST /api/tenant/invite
 * Invite a user to the tenant
 */
router.post('/invite', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const userId = (req as any).userId;
        const { email, role = 'member' } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        if (!['admin', 'member', 'viewer'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Check if already invited
        const { data: existingInvite } = await supabaseAdmin
            .from('tenant_invitations')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('email', email.toLowerCase())
            .is('accepted_at', null)
            .gte('expires_at', new Date().toISOString())
            .single();

        if (existingInvite) {
            return res.status(409).json({ error: 'User already has a pending invitation' });
        }

        // Create invitation
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const { data: invitation, error } = await supabaseAdmin
            .from('tenant_invitations')
            .insert({
                tenant_id: tenantId,
                email: email.toLowerCase(),
                role,
                token,
                expires_at: expiresAt.toISOString(),
                invited_by: userId
            })
            .select()
            .single();

        if (error) {
            logger.error('Failed to create invitation', { error, tenantId, email });
            return res.status(500).json({ error: 'Failed to create invitation' });
        }

        // Log audit
        await logAuditFromRequest(req, AuditActions.USER_INVITED, 'tenant_invitation', invitation.id, {
            after: { email, role },
            metadata: { invited_email: email }
        });

        // TODO: Send invitation email

        res.json({
            success: true,
            invitation: {
                id: invitation.id,
                email: invitation.email,
                role: invitation.role,
                expiresAt: invitation.expires_at,
                inviteLink: `${process.env.FRONTEND_URL}/invite/${token}`
            }
        });
    } catch (error: any) {
        logger.error('Failed to invite user', { error: error.message });
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});

/**
 * POST /api/tenant/invite/accept
 * Accept an invitation
 */
router.post('/invite/accept', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Invitation token is required' });
        }

        // Find invitation
        const { data: invitation, error: inviteError } = await supabaseAdmin
            .from('tenant_invitations')
            .select('*, tenants (id, name, slug)')
            .eq('token', token)
            .is('accepted_at', null)
            .gte('expires_at', new Date().toISOString())
            .single();

        if (inviteError || !invitation) {
            return res.status(404).json({ error: 'Invalid or expired invitation' });
        }

        // Create membership
        const { error: membershipError } = await supabaseAdmin
            .from('tenant_memberships')
            .insert({
                tenant_id: invitation.tenant_id,
                user_id: userId,
                role: invitation.role,
                invited_by: invitation.invited_by,
                is_active: true,
                accepted_at: new Date().toISOString()
            });

        if (membershipError) {
            if (membershipError.code === '23505') { // Unique violation
                return res.status(409).json({ error: 'You are already a member of this workspace' });
            }
            logger.error('Failed to create membership', { error: membershipError });
            return res.status(500).json({ error: 'Failed to join workspace' });
        }

        // Mark invitation as accepted
        await supabaseAdmin
            .from('tenant_invitations')
            .update({ accepted_at: new Date().toISOString() })
            .eq('id', invitation.id);

        res.json({
            success: true,
            tenant: {
                id: (invitation.tenants as any).id,
                name: (invitation.tenants as any).name,
                slug: (invitation.tenants as any).slug,
                role: invitation.role
            }
        });
    } catch (error: any) {
        logger.error('Failed to accept invitation', { error: error.message });
        res.status(500).json({ error: 'Failed to accept invitation' });
    }
});

/**
 * PATCH /api/tenant/members/:memberId/role
 * Update a member's role
 */
router.patch('/members/:memberId/role', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const currentTenant = getCurrentTenant(req);
        const { memberId } = req.params;
        const { role } = req.body;

        if (!['admin', 'member', 'viewer'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Get membership
        const { data: membership, error: fetchError } = await supabaseAdmin
            .from('tenant_memberships')
            .select('*')
            .eq('id', memberId)
            .eq('tenant_id', tenantId)
            .single();

        if (fetchError || !membership) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Cannot demote owner unless you're the owner
        if (membership.role === 'owner' && currentTenant.userRole !== 'owner') {
            return res.status(403).json({ error: 'Only owner can modify owner role' });
        }

        // Update role
        const { error: updateError } = await supabaseAdmin
            .from('tenant_memberships')
            .update({ role, updated_at: new Date().toISOString() })
            .eq('id', memberId);

        if (updateError) {
            logger.error('Failed to update role', { error: updateError });
            return res.status(500).json({ error: 'Failed to update role' });
        }

        // Log audit
        await logAuditFromRequest(req, AuditActions.USER_ROLE_CHANGED, 'tenant_membership', memberId, {
            before: { role: membership.role },
            after: { role }
        });

        res.json({ success: true, role });
    } catch (error: any) {
        logger.error('Failed to update role', { error: error.message });
        res.status(500).json({ error: 'Failed to update member role' });
    }
});

/**
 * DELETE /api/tenant/members/:memberId
 * Remove a member from the tenant
 */
router.delete('/members/:memberId', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const currentTenant = getCurrentTenant(req);
        const userId = (req as any).userId;
        const { memberId } = req.params;

        // Get membership
        const { data: membership, error: fetchError } = await supabaseAdmin
            .from('tenant_memberships')
            .select('*')
            .eq('id', memberId)
            .eq('tenant_id', tenantId)
            .single();

        if (fetchError || !membership) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Cannot remove owner
        if (membership.role === 'owner') {
            return res.status(403).json({ error: 'Cannot remove workspace owner' });
        }

        // Cannot remove yourself unless you're the owner
        if (membership.user_id === userId && currentTenant.userRole !== 'owner') {
            return res.status(403).json({ error: 'Cannot remove yourself' });
        }

        // Soft delete membership
        const { error: deleteError } = await supabaseAdmin
            .from('tenant_memberships')
            .update({
                is_active: false,
                deleted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', memberId);

        if (deleteError) {
            logger.error('Failed to remove member', { error: deleteError });
            return res.status(500).json({ error: 'Failed to remove member' });
        }

        // Log audit
        await logAuditFromRequest(req, AuditActions.USER_REMOVED, 'tenant_membership', memberId, {
            before: membership
        });

        res.json({ success: true });
    } catch (error: any) {
        logger.error('Failed to remove member', { error: error.message });
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

/**
 * GET /api/tenant/plan
 * Get tenant plan details and limits
 */
router.get('/plan', async (req: Request, res: Response) => {
    try {
        const tenant = getCurrentTenant(req);

        const planLimits = {
            free: {
                maxAmazonAccounts: 1,
                maxMonthlyRecoveries: 10,
                maxEvidenceDocs: 50,
                autoFilingEnabled: false,
                apiAccessEnabled: false,
                supportTier: 'community'
            },
            starter: {
                maxAmazonAccounts: 3,
                maxMonthlyRecoveries: 100,
                maxEvidenceDocs: 500,
                autoFilingEnabled: true,
                apiAccessEnabled: false,
                supportTier: 'email'
            },
            professional: {
                maxAmazonAccounts: 10,
                maxMonthlyRecoveries: 1000,
                maxEvidenceDocs: 5000,
                autoFilingEnabled: true,
                apiAccessEnabled: true,
                supportTier: 'priority'
            },
            enterprise: {
                maxAmazonAccounts: -1, // unlimited
                maxMonthlyRecoveries: -1,
                maxEvidenceDocs: -1,
                autoFilingEnabled: true,
                apiAccessEnabled: true,
                supportTier: 'dedicated'
            }
        };

        res.json({
            success: true,
            plan: tenant.tenantPlan,
            status: tenant.tenantStatus,
            limits: planLimits[tenant.tenantPlan] || planLimits.free
        });
    } catch (error: any) {
        logger.error('Failed to get plan', { error: error.message });
        res.status(500).json({ error: 'Failed to get plan details' });
    }
});

export default router;
