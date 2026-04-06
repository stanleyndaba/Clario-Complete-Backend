/**
 * Shared utilities for detection algorithm storage functions.
 * Centralizes tenant_id resolution to avoid duplication across 26+ algorithm files.
 */

import { supabaseAdmin } from '../../../../../database/supabaseClient';
import logger from '../../../../../utils/logger';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export type DetectionSourceType = 'sp_api' | 'csv_upload' | 'unknown';
const RESOLVED_DETECTION_SOURCES: DetectionSourceType[] = ['sp_api', 'csv_upload', 'unknown'];

/**
 * Resolve the tenant_id for a given seller/user ID.
 * Used by all algorithm store*Results functions to include tenant_id in detection_results.
 *
 * Lookup order:
 * 1. Query the `users` table for tenant_id
 * 2. Fallback to seller_id itself in dev/sandbox mode
 * 3. Use DEFAULT_TENANT_ID as last resort
 */
export async function resolveTenantId(sellerId: string): Promise<string> {
    try {
        const { data: membership } = await supabaseAdmin
            .from('tenant_memberships')
            .select('tenant_id')
            .eq('user_id', sellerId)
            .limit(1)
            .maybeSingle();

        if (membership?.tenant_id) {
            return membership.tenant_id;
        }
    } catch (e) {
        logger.warn('Failed to resolve tenant_id from tenant_memberships', { sellerId });
    }

    try {
        const { data } = await supabaseAdmin
            .from('users')
            .select('tenant_id')
            .eq('id', sellerId)
            .maybeSingle();

        if (data?.tenant_id) {
            return data.tenant_id;
        }
    } catch (e) {
        logger.warn('Failed to resolve tenant_id for seller', { sellerId });
    }

    // Fallback for sandbox/dev/test mode
    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_MOCK_DETECTION === 'true') {
        return sellerId;
    }

    return DEFAULT_TENANT_ID;
}

export async function relationExists(table: string): Promise<boolean> {
    try {
        const { error } = await supabaseAdmin
            .from(table)
            .select('*')
            .limit(1);

        return !error;
    } catch (error) {
        return false;
    }
}

function isResolvedSource(value: unknown): value is Exclude<DetectionSourceType, 'unknown'> {
    return value === 'sp_api' || value === 'csv_upload';
}

export async function inferDetectionSourceType(
    tenantId: string,
    sellerId: string,
    syncId: string
): Promise<DetectionSourceType> {
    if (!syncId) {
        return 'unknown';
    }

    if (syncId.toLowerCase().startsWith('csv_')) {
        return 'csv_upload';
    }

    try {
        const { data: csvRun } = await supabaseAdmin
            .from('csv_upload_runs')
            .select('sync_id')
            .eq('tenant_id', tenantId)
            .eq('sync_id', syncId)
            .limit(1)
            .maybeSingle();

        if (csvRun?.sync_id) {
            return 'csv_upload';
        }
    } catch (error) {
        logger.warn('Failed to inspect csv_upload_runs for detection source attribution', { tenantId, sellerId, syncId });
    }

    try {
        const { data: queueRows, error } = await supabaseAdmin
            .from('detection_queue')
            .select('payload')
            .eq('tenant_id', tenantId)
            .eq('seller_id', sellerId)
            .eq('sync_id', syncId)
            .limit(10);

        if (!error) {
            const queueSources = Array.from(new Set<Exclude<DetectionSourceType, 'unknown'>>(
                (queueRows || [])
                    .map((row: any) => row?.payload?.source_type || row?.payload?.source)
                    .filter(isResolvedSource)
            ));

            if (queueSources.length === 1) {
                return queueSources[0];
            }

            if (queueSources.length > 1) {
                return 'unknown';
            }
        }
    } catch (error) {
        logger.warn('Failed to inspect detection_queue for detection source attribution', { tenantId, sellerId, syncId });
    }

    const sourceTableChecks: Array<{ table: string; sellerField: 'seller_id' | 'user_id' }> = [
        { table: 'orders', sellerField: 'user_id' },
        { table: 'shipments', sellerField: 'user_id' },
        { table: 'returns', sellerField: 'user_id' },
        { table: 'settlements', sellerField: 'user_id' },
        { table: 'financial_events', sellerField: 'seller_id' },
        { table: 'inventory_ledger_events', sellerField: 'user_id' },
        { table: 'inventory_transfers', sellerField: 'seller_id' },
    ];

    const observedSources = new Set<Exclude<DetectionSourceType, 'unknown'>>();

    for (const { table, sellerField } of sourceTableChecks) {
        try {
            const { data, error } = await supabaseAdmin
                .from(table)
                .select('source')
                .eq('tenant_id', tenantId)
                .eq(sellerField, sellerId)
                .eq('sync_id', syncId)
                .limit(5);

            if (!error) {
                for (const row of data || []) {
                    if (isResolvedSource((row as any)?.source)) {
                        observedSources.add((row as any).source);
                    }
                }
            }
        } catch (error) {
            logger.warn('Failed to inspect source table for detection attribution', {
                tenantId,
                sellerId,
                syncId,
                table
            });
        }
    }

    if (observedSources.size === 1) {
        return Array.from(observedSources)[0];
    }

    if (observedSources.size > 1) {
        return 'unknown';
    }

    return 'unknown';
}

export async function requireDetectionSourceType(
    tenantId: string,
    sellerId: string,
    syncId: string
): Promise<Exclude<DetectionSourceType, 'unknown'>> {
    const sourceType = await inferDetectionSourceType(tenantId, sellerId, syncId);

    if (!isResolvedSource(sourceType)) {
        logger.error('Detection source attribution failed closed', {
            tenantId,
            sellerId,
            syncId,
            attemptedValues: RESOLVED_DETECTION_SOURCES
        });
        throw new Error(`Unable to determine detection source_type for sync ${syncId}`);
    }

    return sourceType;
}
