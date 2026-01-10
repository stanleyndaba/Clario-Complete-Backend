/**
 * Audit Service
 * 
 * Comprehensive audit logging for compliance and debugging.
 * All sensitive operations should be logged through this service.
 */

import { supabaseAdmin } from '../database/supabaseClient';
import { Request } from 'express';
import { TenantContext, getCurrentTenant } from '../middleware/tenantMiddleware';
import { tenantGuard } from './tenantGuard';
import logger from './logger';

/**
 * Audit log entry
 */
export interface AuditLogEntry {
    tenantId: string;
    actorUserId?: string;
    actorType: 'user' | 'system' | 'worker' | 'webhook';
    action: string;
    resourceType: string;
    resourceId?: string;
    before?: any;
    after?: any;
    metadata?: Record<string, any>;
    req?: Request;
}

/**
 * Log an audit event
 * 
 * @param entry - Audit log entry details
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
    try {
        tenantGuard(entry.tenantId);

        const { error } = await supabaseAdmin.from('audit_logs').insert({
            tenant_id: entry.tenantId,
            actor_user_id: entry.actorUserId || null,
            actor_type: entry.actorType,
            action: entry.action,
            resource_type: entry.resourceType,
            resource_id: entry.resourceId || null,
            payload_before: entry.before || null,
            payload_after: entry.after || null,
            ip_address: entry.req?.ip || null,
            user_agent: entry.req?.headers?.['user-agent'] || null,
            request_id: entry.req?.headers?.['x-request-id'] as string || null,
            metadata: entry.metadata || {}
        });

        if (error) {
            logger.error('Failed to write audit log', { error, entry });
        }
    } catch (error: any) {
        // Never throw from audit logging - log and continue
        logger.error('Audit logging failed', { error: error.message, entry });
    }
}

/**
 * Log audit from request context
 * Automatically extracts tenant and user from request
 */
export async function logAuditFromRequest(
    req: Request,
    action: string,
    resourceType: string,
    resourceId?: string,
    options?: {
        before?: any;
        after?: any;
        metadata?: Record<string, any>;
    }
): Promise<void> {
    try {
        const tenant = getCurrentTenant(req);
        const userId = (req as any).userId;

        await logAudit({
            tenantId: tenant.tenantId,
            actorUserId: userId,
            actorType: 'user',
            action,
            resourceType,
            resourceId,
            before: options?.before,
            after: options?.after,
            metadata: options?.metadata,
            req
        });
    } catch (error: any) {
        logger.error('Failed to log audit from request', { error: error.message, action, resourceType });
    }
}

/**
 * Log system-initiated audit event
 */
export async function logSystemAudit(
    tenantId: string,
    action: string,
    resourceType: string,
    resourceId?: string,
    options?: {
        before?: any;
        after?: any;
        metadata?: Record<string, any>;
    }
): Promise<void> {
    await logAudit({
        tenantId,
        actorType: 'system',
        action,
        resourceType,
        resourceId,
        before: options?.before,
        after: options?.after,
        metadata: options?.metadata
    });
}

/**
 * Log worker-initiated audit event
 */
export async function logWorkerAudit(
    tenantId: string,
    workerName: string,
    action: string,
    resourceType: string,
    resourceId?: string,
    options?: {
        before?: any;
        after?: any;
        metadata?: Record<string, any>;
    }
): Promise<void> {
    await logAudit({
        tenantId,
        actorType: 'worker',
        action,
        resourceType,
        resourceId,
        before: options?.before,
        after: options?.after,
        metadata: {
            ...options?.metadata,
            worker_name: workerName
        }
    });
}

/**
 * Log webhook-initiated audit event
 */
export async function logWebhookAudit(
    tenantId: string,
    webhookSource: string,
    action: string,
    resourceType: string,
    resourceId?: string,
    options?: {
        before?: any;
        after?: any;
        metadata?: Record<string, any>;
        req?: Request;
    }
): Promise<void> {
    await logAudit({
        tenantId,
        actorType: 'webhook',
        action,
        resourceType,
        resourceId,
        before: options?.before,
        after: options?.after,
        metadata: {
            ...options?.metadata,
            webhook_source: webhookSource
        },
        req: options?.req
    });
}

/**
 * Pre-built audit actions for common operations
 */
export const AuditActions = {
    // Disputes
    DISPUTE_CREATED: 'dispute.created',
    DISPUTE_UPDATED: 'dispute.updated',
    DISPUTE_SUBMITTED: 'dispute.submitted',
    DISPUTE_APPROVED: 'dispute.approved',
    DISPUTE_REJECTED: 'dispute.rejected',
    DISPUTE_CLOSED: 'dispute.closed',

    // Recoveries
    RECOVERY_DETECTED: 'recovery.detected',
    RECOVERY_FILED: 'recovery.filed',
    RECOVERY_APPROVED: 'recovery.approved',
    RECOVERY_DEPOSITED: 'recovery.deposited',

    // Billing
    BILLING_CHARGED: 'billing.charged',
    BILLING_FAILED: 'billing.failed',
    BILLING_REFUNDED: 'billing.refunded',

    // User/Auth
    USER_LOGGED_IN: 'user.logged_in',
    USER_LOGGED_OUT: 'user.logged_out',
    USER_INVITED: 'user.invited',
    USER_JOINED: 'user.joined',
    USER_REMOVED: 'user.removed',
    USER_ROLE_CHANGED: 'user.role_changed',

    // Tenant
    TENANT_CREATED: 'tenant.created',
    TENANT_UPDATED: 'tenant.updated',
    TENANT_PLAN_CHANGED: 'tenant.plan_changed',
    TENANT_SUSPENDED: 'tenant.suspended',
    TENANT_REACTIVATED: 'tenant.reactivated',
    TENANT_DELETED: 'tenant.deleted',

    // Integrations
    INTEGRATION_CONNECTED: 'integration.connected',
    INTEGRATION_DISCONNECTED: 'integration.disconnected',
    INTEGRATION_SYNCED: 'integration.synced',
    INTEGRATION_FAILED: 'integration.failed',

    // Evidence
    EVIDENCE_UPLOADED: 'evidence.uploaded',
    EVIDENCE_MATCHED: 'evidence.matched',
    EVIDENCE_LINKED: 'evidence.linked',

    // Settings
    SETTINGS_UPDATED: 'settings.updated',
    AUTOMATION_RULE_CREATED: 'automation_rule.created',
    AUTOMATION_RULE_UPDATED: 'automation_rule.updated',
    AUTOMATION_RULE_DELETED: 'automation_rule.deleted',

    // System
    DATA_EXPORTED: 'data.exported',
    DATA_PURGED: 'data.purged',
    MIGRATION_RUN: 'migration.run'
} as const;

/**
 * Query audit logs for a tenant
 */
export async function queryAuditLogs(
    tenantId: string,
    options?: {
        action?: string;
        resourceType?: string;
        resourceId?: string;
        actorUserId?: string;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
        offset?: number;
    }
): Promise<{ data: any[]; count: number }> {
    tenantGuard(tenantId);

    let query = supabaseAdmin
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

    if (options?.action) {
        query = query.eq('action', options.action);
    }
    if (options?.resourceType) {
        query = query.eq('resource_type', options.resourceType);
    }
    if (options?.resourceId) {
        query = query.eq('resource_id', options.resourceId);
    }
    if (options?.actorUserId) {
        query = query.eq('actor_user_id', options.actorUserId);
    }
    if (options?.startDate) {
        query = query.gte('created_at', options.startDate.toISOString());
    }
    if (options?.endDate) {
        query = query.lte('created_at', options.endDate.toISOString());
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
        logger.error('Failed to query audit logs', { error, tenantId, options });
        throw error;
    }

    return { data: data || [], count: count || 0 };
}
