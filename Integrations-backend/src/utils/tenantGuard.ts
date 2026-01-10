/**
 * Tenant Guard Utility
 * 
 * Security utility to ensure tenant_id is always present in database operations.
 * Use this in all services that bypass RLS (using supabaseAdmin).
 */

import logger from '../utils/logger';

/**
 * Guard that ensures tenant_id is present
 * Throws if missing - CRITICAL for data isolation
 * 
 * @param tenantId - The tenant ID to validate
 * @throws Error if tenant_id is missing or invalid
 */
export function tenantGuard(tenantId: string | undefined | null): asserts tenantId is string {
    if (!tenantId) {
        const error = new Error('[SECURITY VIOLATION] Database operation attempted without tenant_id');
        logger.error('Tenant guard failed - no tenant_id provided', {
            stack: error.stack
        });
        throw error;
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
        const error = new Error(`[SECURITY VIOLATION] Invalid tenant_id format: ${tenantId}`);
        logger.error('Tenant guard failed - invalid tenant_id format', {
            tenantId,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Wrapper for tenant-scoped operations
 * Ensures tenant_id is present before executing callback
 * 
 * @param tenantId - The tenant ID to validate
 * @param operation - Async function to execute if tenant is valid
 * @returns Result of the operation
 */
export async function withTenantScope<T>(
    tenantId: string | undefined | null,
    operation: (validTenantId: string) => Promise<T>
): Promise<T> {
    tenantGuard(tenantId);
    return operation(tenantId);
}

/**
 * Validates that two tenant IDs match
 * Use when checking cross-resource access
 * 
 * @param resourceTenantId - Tenant ID from the resource being accessed
 * @param requestTenantId - Tenant ID from the request context
 * @throws Error if tenant IDs don't match
 */
export function validateTenantMatch(
    resourceTenantId: string | undefined | null,
    requestTenantId: string | undefined | null
): void {
    tenantGuard(resourceTenantId);
    tenantGuard(requestTenantId);

    if (resourceTenantId !== requestTenantId) {
        const error = new Error('[SECURITY VIOLATION] Cross-tenant access attempted');
        logger.error('Tenant match validation failed', {
            resourceTenantId,
            requestTenantId,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Tables that require tenant isolation
 */
export const TENANT_SCOPED_TABLES = [
    // Core Data
    'orders',
    'shipments',
    'returns',
    'settlements',
    'inventory',

    // Financial & Detection
    'financial_events',
    'detection_results',
    'detection_queue',
    'detection_thresholds',
    'detection_whitelist',

    // Disputes
    'dispute_cases',
    'dispute_automation_rules',
    'dispute_evidence',
    'dispute_audit_log',

    // Evidence
    'evidence_sources',
    'evidence_documents',
    'evidence_line_items',
    'dispute_evidence_links',
    'proof_packets',
    'smart_prompts',
    'evidence_match_results',

    // Recoveries
    'recoveries',

    // System
    'agent_events',
    'notifications',
    'sync_detection_triggers',
    'sync_snapshots',
    'realtime_alerts',

    // Access
    'tokens',
    'users',
    'referral_invites',
    'seller_proxy_assignments',
    'user_notes',

    // Workers
    'parser_jobs',
    'ingestion_jobs',
    'filing_jobs',
    'billing_jobs',

    // Learning
    'learning_insights',
    'threshold_optimizations',

    // Errors
    'evidence_ingestion_errors',
    'billing_errors'
] as const;

/**
 * Check if a table requires tenant isolation
 */
export function requiresTenantIsolation(tableName: string): boolean {
    return TENANT_SCOPED_TABLES.includes(tableName as any);
}

/**
 * Default tenant ID for demo/migration mode
 */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
