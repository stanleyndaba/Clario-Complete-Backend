/**
 * Tenant-Scoped Database Client
 * 
 * Provides a wrapper around Supabase queries that automatically
 * injects tenant_id filters to prevent cross-tenant data access.
 */

import { supabaseAdmin } from './supabaseClient';
import { Request } from 'express';
import { getTenantId } from '../middleware/tenantMiddleware';
import { tenantGuard, requiresTenantIsolation, DEFAULT_TENANT_ID } from '../utils/tenantGuard';
import logger from '../utils/logger';

/**
 * Create a tenant-scoped query builder for a table
 * Automatically adds tenant_id filter to all operations
 * 
 * @param req - Express request with tenant context
 * @param table - Table name to query
 * @returns Wrapped query builder with tenant isolation
 */
export function createTenantScopedQuery(req: Request, table: string) {
    const tenantId = getTenantId(req);
    return createTenantScopedQueryById(tenantId, table);
}

/**
 * Create a tenant-scoped query builder using tenant ID directly
 * Use this in workers and background jobs where Request isn't available
 * 
 * @param tenantId - Tenant UUID
 * @param table - Table name to query
 * @returns Wrapped query builder with tenant isolation
 */
export function createTenantScopedQueryById(tenantId: string, table: string) {
    tenantGuard(tenantId);

    if (!requiresTenantIsolation(table)) {
        // Non-tenant-scoped table, return normal query
        logger.debug('Table does not require tenant isolation', { table });
        return supabaseAdmin.from(table);
    }

    const baseQuery = supabaseAdmin.from(table);

    return {
        /**
         * Select with automatic tenant filter
         */
        select: (columns?: string) => {
            return baseQuery.select(columns).eq('tenant_id', tenantId);
        },

        /**
         * Insert with automatic tenant_id injection
         */
        insert: (data: any | any[]) => {
            const dataWithTenant = Array.isArray(data)
                ? data.map(row => ({ ...row, tenant_id: tenantId }))
                : { ...data, tenant_id: tenantId };
            return baseQuery.insert(dataWithTenant);
        },

        /**
         * Update with automatic tenant filter
         */
        update: (data: any) => {
            // Prevent accidental tenant_id modification
            const { tenant_id, ...safeData } = data;
            if (tenant_id && tenant_id !== tenantId) {
                throw new Error('[SECURITY] Cannot modify tenant_id in update operation');
            }
            return baseQuery.update(safeData).eq('tenant_id', tenantId);
        },

        /**
         * Upsert with automatic tenant_id injection
         */
        upsert: (data: any | any[], options?: { onConflict?: string }) => {
            const dataWithTenant = Array.isArray(data)
                ? data.map(row => ({ ...row, tenant_id: tenantId }))
                : { ...data, tenant_id: tenantId };
            return baseQuery.upsert(dataWithTenant, options);
        },

        /**
         * Delete with automatic tenant filter
         */
        delete: () => {
            return baseQuery.delete().eq('tenant_id', tenantId);
        },

        /**
         * Get the raw query builder (use with caution)
         * Only use this when you need to chain complex filters
         * Remember to add .eq('tenant_id', tenantId) manually!
         */
        raw: () => {
            logger.warn('Using raw query builder - ensure tenant_id filter is added', { table, tenantId });
            return baseQuery;
        },

        /**
         * Get tenant ID for manual query building
         */
        getTenantId: () => tenantId
    };
}

/**
 * Tenant-scoped query for fetching a single record by ID
 * 
 * @param tenantId - Tenant UUID
 * @param table - Table name
 * @param id - Record ID
 * @param idColumn - ID column name (default: 'id')
 */
export async function getTenantScopedRecord<T>(
    tenantId: string,
    table: string,
    id: string,
    idColumn: string = 'id'
): Promise<T | null> {
    tenantGuard(tenantId);

    const query = supabaseAdmin
        .from(table)
        .select('*')
        .eq(idColumn, id);

    // Add tenant filter if required
    if (requiresTenantIsolation(table)) {
        query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
        logger.error('Failed to fetch tenant-scoped record', { table, id, tenantId, error });
        throw error;
    }

    return data as T | null;
}

/**
 * Batch operation helper for tenant-scoped inserts
 * Automatically chunks large inserts to avoid timeouts
 * 
 * @param tenantId - Tenant UUID
 * @param table - Table name
 * @param records - Records to insert
 * @param chunkSize - Number of records per batch (default: 100)
 */
export async function batchTenantInsert(
    tenantId: string,
    table: string,
    records: any[],
    chunkSize: number = 100
): Promise<{ inserted: number; errors: any[] }> {
    tenantGuard(tenantId);

    const recordsWithTenant = records.map(r => ({ ...r, tenant_id: tenantId }));
    const errors: any[] = [];
    let inserted = 0;

    // Process in chunks
    for (let i = 0; i < recordsWithTenant.length; i += chunkSize) {
        const chunk = recordsWithTenant.slice(i, i + chunkSize);

        const { error, count } = await supabaseAdmin
            .from(table)
            .insert(chunk);

        if (error) {
            errors.push({ chunk: i / chunkSize, error });
            logger.error('Batch insert chunk failed', { table, tenantId, chunk: i / chunkSize, error });
        } else {
            inserted += chunk.length;
        }
    }

    return { inserted, errors };
}

/**
 * Transaction-like helper for multiple tenant-scoped operations
 * Note: Supabase doesn't support true transactions, this is a best-effort wrapper
 * 
 * @param tenantId - Tenant UUID
 * @param operations - Array of operations to execute
 */
export async function withTenantTransaction<T>(
    tenantId: string,
    operations: (scopedDb: typeof createTenantScopedQueryById) => Promise<T>
): Promise<T> {
    tenantGuard(tenantId);

    // Create a bound version of createTenantScopedQueryById
    const scopedDb = (table: string) => createTenantScopedQueryById(tenantId, table);

    try {
        return await operations(scopedDb);
    } catch (error) {
        logger.error('Tenant transaction failed', { tenantId, error });
        throw error;
    }
}

export { supabaseAdmin };
