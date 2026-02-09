/**
 * Admin Routes
 * Backend endpoints for admin users and evidence settings
 */

import { Router, Request, Response } from 'express';
import { getLogger } from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';

const router = Router();
const logger = getLogger('AdminRoutes');

/**
 * GET /api/admin/evidence/settings
 * Get evidence collection settings
 */
router.get('/evidence/settings', async (req: Request, res: Response) => {
    try {
        // Get settings from database or return defaults
        const { data: settings } = await supabaseAdmin
            .from('system_settings')
            .select('*')
            .eq('key', 'evidence_collection')
            .maybeSingle();

        // Get document count
        const { count } = await supabaseAdmin
            .from('evidence_documents')
            .select('*', { count: 'exact', head: true });

        return res.json({
            success: true,
            autoCollect: settings?.value?.auto_collect ?? true,
            schedule: settings?.value?.schedule ?? 'daily 02:00 UTC',
            lastRun: settings?.value?.last_run,
            totalDocuments: count || 0
        });
    } catch (error: any) {
        logger.error('Error fetching evidence settings', { error: error.message });
        return res.status(500).json({ error: 'Failed to fetch evidence settings' });
    }
});

/**
 * POST /api/admin/evidence/auto-collect
 * Enable/disable auto-collection
 */
router.post('/evidence/auto-collect', async (req: Request, res: Response) => {
    try {
        const { enabled } = req.body;

        await supabaseAdmin
            .from('system_settings')
            .upsert({
                key: 'evidence_collection',
                value: { auto_collect: enabled, schedule: 'daily 02:00 UTC' },
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        logger.info('Evidence auto-collect updated', { enabled });
        return res.json({ success: true, message: `Auto-collect ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error: any) {
        logger.error('Error updating auto-collect', { error: error.message });
        return res.status(500).json({ error: 'Failed to update auto-collect' });
    }
});

/**
 * POST /api/admin/evidence/schedule
 * Update collection schedule
 */
router.post('/evidence/schedule', async (req: Request, res: Response) => {
    try {
        const { schedule } = req.body;

        // Get current settings
        const { data: current } = await supabaseAdmin
            .from('system_settings')
            .select('value')
            .eq('key', 'evidence_collection')
            .maybeSingle();

        await supabaseAdmin
            .from('system_settings')
            .upsert({
                key: 'evidence_collection',
                value: { ...current?.value, schedule },
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        logger.info('Evidence schedule updated', { schedule });
        return res.json({ success: true, message: `Schedule updated to: ${schedule}` });
    } catch (error: any) {
        logger.error('Error updating schedule', { error: error.message });
        return res.status(500).json({ error: 'Failed to update schedule' });
    }
});

/**
 * GET /api/admin/users
 * Get all users with enhanced stats (admin only)
 */
router.get('/users', async (req: Request, res: Response) => {
    try {
        // Get all users
        const { data: users, error } = await supabaseAdmin
            .from('users')
            .select('id, email, role, status, created_at, last_login_at, amazon_seller_id, tenant_id')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Get integration counts per user
        const { data: integrations } = await supabaseAdmin
            .from('oauth_tokens')
            .select('user_id, provider');

        // Get dispute case stats per user
        const { data: cases } = await supabaseAdmin
            .from('dispute_cases')
            .select('seller_id, status, actual_payout_amount');

        // Build integration map: user_id -> providers array
        const integrationMap = new Map<string, string[]>();
        (integrations || []).forEach((i: any) => {
            const existing = integrationMap.get(i.user_id) || [];
            if (!existing.includes(i.provider)) {
                existing.push(i.provider);
            }
            integrationMap.set(i.user_id, existing);
        });

        // Build case stats map: seller_id -> { count, recovered }
        const caseStatsMap = new Map<string, { count: number; recovered: number }>();
        (cases || []).forEach((c: any) => {
            const existing = caseStatsMap.get(c.seller_id) || { count: 0, recovered: 0 };
            existing.count += 1;
            if (c.status === 'approved' || c.status === 'resolved') {
                existing.recovered += parseFloat(c.actual_payout_amount || 0);
            }
            caseStatsMap.set(c.seller_id, existing);
        });

        // Map to enhanced format
        const mappedUsers = (users || []).map(u => {
            const integs = integrationMap.get(u.id) || [];
            const caseStats = caseStatsMap.get(u.id) || { count: 0, recovered: 0 };

            return {
                id: u.id,
                email: u.email || 'No email',
                role: u.role || 'user',
                status: u.status || 'active',
                created_at: u.created_at,
                last_login: u.last_login_at,
                amazon_connected: !!u.amazon_seller_id,
                integrations: integs,
                integrations_count: integs.length + (u.amazon_seller_id ? 1 : 0),
                cases_count: caseStats.count,
                total_recovered: caseStats.recovered
            };
        });

        return res.json({ success: true, users: mappedUsers, total: mappedUsers.length });
    } catch (error: any) {
        logger.error('Error fetching users', { error: error.message });
        return res.status(500).json({ error: 'Failed to fetch users' });
    }
});

/**
 * PATCH /api/admin/users/:userId
 * Update user role or status
 */
router.patch('/users/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        const { role, status } = req.body;

        const updates: any = { updated_at: new Date().toISOString() };
        if (role) updates.role = role;
        if (status) updates.status = status;

        const { error } = await supabaseAdmin
            .from('users')
            .update(updates)
            .eq('id', userId);

        if (error) throw error;

        logger.info('User updated', { userId, updates });
        return res.json({ success: true, message: 'User updated successfully' });
    } catch (error: any) {
        logger.error('Error updating user', { error: error.message });
        return res.status(500).json({ error: 'Failed to update user' });
    }
});

/**
 * POST /api/admin/users/:userId/impersonate
 * Generate impersonation token (admin only)
 */
router.post('/users/:userId/impersonate', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        const requestingUserId = (req as any).user?.id;

        // Get the target user
        const { data: targetUser, error } = await supabaseAdmin
            .from('users')
            .select('id, email, role')
            .eq('id', userId)
            .single();

        if (error || !targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        logger.info('User impersonation started', {
            admin: requestingUserId,
            target: userId,
            targetEmail: targetUser.email
        });

        // In production, generate a JWT or session token
        // For now, return success with instructions
        return res.json({
            success: true,
            message: `Impersonating ${targetUser.email}. Use X-User-Id header with value: ${userId}`,
            userId: userId
        });
    } catch (error: any) {
        logger.error('Error impersonating user', { error: error.message });
        return res.status(500).json({ error: 'Failed to impersonate user' });
    }
});

export default router;
