/**
 * Store-Scoped Database Client
 * 
 * Provides a second-layer wrapper around Supabase queries that 
 * automatically injects both tenant_id AND store_id filters.
 * 
 * This is the primary mechanism for enforced hard isolation.
 */

import { supabaseAdmin } from './supabaseClient';
import { Request } from 'express';
import { getTenantId } from '../middleware/tenantMiddleware';
import { tenantGuard } from '../utils/tenantGuard';
import logger from '../utils/logger';

/**
 * Extract store_id from headers or request context
 */
export function getStoreId(req: Request): string | null {
    return (req as any).storeId || req.headers['x-store-id'] as string || null;
}

/**
 * Create a store-scoped query builder
 * Automatically adds tenant_id AND store_id filters
 */
export function createStoreScopedQuery(req: Request, table: string) {
    const tenantId = getTenantId(req);
    const storeId = getStoreId(req);

    if (!storeId) {
        logger.warn('Store-scoped query attempted without store_id - using tenant scope only', { table, tenantId });
        // Fallback to tenant scope if store context is missing
        // In a strict execution mode, this would throw
        const { createTenantScopedQueryById } = require('./tenantScopedClient');
        return createTenantScopedQueryById(tenantId, table);
    }

    return createStoreScopedQueryById(tenantId, storeId, table);
}

/**
 * Create a store-scoped query builder using IDs directly
 */
export function createStoreScopedQueryById(tenantId: string, storeId: string, table: string) {
    tenantGuard(tenantId);

    if (!storeId) {
        throw new Error('[SECURITY VIOLATION] Store-scoped query attempted without storeId');
    }

    const baseQuery = supabaseAdmin.from(table);

    return {
        select: (columns?: string) => {
            return baseQuery.select(columns)
                .eq('tenant_id', tenantId)
                .eq('store_id', storeId);
        },

        insert: (data: any | any[]) => {
            const dataWithContext = Array.isArray(data)
                ? data.map(row => ({ ...row, tenant_id: tenantId, store_id: storeId }))
                : { ...data, tenant_id: tenantId, store_id: storeId };
            return baseQuery.insert(dataWithContext);
        },

        update: (data: any) => {
            const { tenant_id, store_id, ...safeData } = data;
            return baseQuery.update(safeData)
                .eq('tenant_id', tenantId)
                .eq('store_id', storeId);
        },

        upsert: (data: any | any[], options?: { onConflict?: string }) => {
            const dataWithContext = Array.isArray(data)
                ? data.map(row => ({ ...row, tenant_id: tenantId, store_id: storeId }))
                : { ...data, tenant_id: tenantId, store_id: storeId };
            return baseQuery.upsert(dataWithContext, options);
        },

        delete: () => {
            return baseQuery.delete()
                .eq('tenant_id', tenantId)
                .eq('store_id', storeId);
        },

        raw: () => {
            logger.warn('Using raw query builder with store scope - ensure filters are applied', { table, storeId });
            return baseQuery;
        }
    };
}
