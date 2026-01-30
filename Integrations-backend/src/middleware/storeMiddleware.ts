/**
 * Store Context Middleware
 * 
 * Extracts x-store-id from headers, validates ownership, 
 * and injects it into the request context.
 */

import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import { getTenantId } from './tenantMiddleware';
import logger from '../utils/logger';

export async function storeMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const storeId = req.headers['x-store-id'] as string;
        const tenantId = getTenantId(req);

        // Optional for certain routes, but enforced for data planes
        if (!storeId) {
            return next();
        }

        // Validate that store belongs to the current tenant
        const { data: store, error } = await supabaseAdmin
            .from('stores')
            .select('id, name, marketplace, is_active')
            .eq('id', storeId)
            .eq('tenant_id', tenantId)
            .is('deleted_at', null)
            .single();

        if (error || !store) {
            logger.warn('Store context validation failed', { storeId, tenantId, error });
            return res.status(403).json({
                success: false,
                error: 'Invalid store context',
                message: 'The requested store does not exist or you do not have permission to access it.'
            });
        }

        if (!store.is_active) {
            return res.status(403).json({
                success: false,
                error: 'Store inactive',
                message: 'This store is currently inactive. Please enable it to perform actions.'
            });
        }

        // Attach store context to request
        (req as any).storeId = store.id;
        (req as any).storeContext = {
            id: store.id,
            name: store.name,
            marketplace: store.marketplace
        };

        next();
    } catch (error: any) {
        logger.error('Error in storeMiddleware', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error during store resolution' });
    }
}
