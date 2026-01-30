/**
 * Store Management Routes
 * 
 * CRUD and switching operations for Stores.
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import { getTenantId } from '../middleware/tenantMiddleware';
import { storeMiddleware } from '../middleware/storeMiddleware';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/v1/stores
 * List all stores for the current tenant
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);

        const { data: stores, error } = await supabaseAdmin
            .from('stores')
            .select('*')
            .eq('tenant_id', tenantId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

        if (error) throw error;

        res.json({ success: true, stores });
    } catch (error: any) {
        logger.error('Failed to list stores', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to list stores' });
    }
});

/**
 * POST /api/v1/stores
 * Create a new store
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const { name, marketplace, seller_id, metadata } = req.body;

        if (!name || !marketplace) {
            return res.status(400).json({ success: false, error: 'Name and marketplace are required' });
        }

        const { data: store, error } = await supabaseAdmin
            .from('stores')
            .insert({
                tenant_id: tenantId,
                name,
                marketplace,
                seller_id,
                metadata: metadata || {}
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ success: true, store });
    } catch (error: any) {
        logger.error('Failed to create store', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to create store' });
    }
});

/**
 * GET /api/v1/stores/:id
 * Get store details
 */
router.get('/:id', storeMiddleware, async (req: Request, res: Response) => {
    // Context is already validated by storeMiddleware
    res.json({ success: true, store: (req as any).storeContext });
});

/**
 * DELETE /api/v1/stores/:id
 * Soft delete a store
 */
router.delete('/:id', storeMiddleware, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('stores')
            .update({ deleted_at: new Date().toISOString(), is_active: false })
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true, message: 'Store deleted successfully' });
    } catch (error: any) {
        logger.error('Failed to delete store', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to delete store' });
    }
});

export default router;
