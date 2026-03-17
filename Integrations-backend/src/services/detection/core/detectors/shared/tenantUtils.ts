/**
 * Shared utilities for detection algorithm storage functions.
 * Centralizes tenant_id resolution to avoid duplication across 26+ algorithm files.
 */

import { supabaseAdmin } from '../../../../../database/supabaseClient';
import logger from '../../../../../utils/logger';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

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
