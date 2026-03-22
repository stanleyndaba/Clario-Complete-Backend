/**
 * Metrics API Routes
 * 
 * Exposes observability and financial impact metrics for dashboards.
 */

import { Router, Request, Response } from 'express';
import { metricsService } from '../services/metricsService';
import { financialImpactService } from '../services/financialImpactService';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

const router = Router();

const FILED_FILING_STATUSES = new Set(['filed', 'submitted', 'submitting', 'auto_submitted']);
const POST_FILE_STATUSES = new Set(['approved', 'won', 'rejected', 'denied', 'lost', 'closed', 'paid']);
const APPROVED_STATUSES = new Set(['approved', 'won']);
const REJECTED_STATUSES = new Set(['rejected', 'denied', 'lost', 'failed']);
const BILLED_STATUSES = new Set(['sent', 'paid', 'charged', 'credited', 'due', 'overdue']);
const RECOVERED_STATUSES = new Set(['reconciled']);

function toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function isFiledCase(record: any): boolean {
    const filingStatus = normalize(record?.filing_status);
    const caseStatus = normalize(record?.status);
    return Boolean(record?.provider_case_id) || FILED_FILING_STATUSES.has(filingStatus) || POST_FILE_STATUSES.has(caseStatus);
}

function isApprovedCase(record: any): boolean {
    return APPROVED_STATUSES.has(normalize(record?.status));
}

function isRejectedCase(record: any): boolean {
    return REJECTED_STATUSES.has(normalize(record?.status));
}

function isRecoveredCase(record: any): boolean {
    return RECOVERED_STATUSES.has(normalize(record?.recovery_status)) || toNumber(record?.actual_payout_amount) > 0;
}

function isBilledRecord(record: any): boolean {
    return BILLED_STATUSES.has(normalize(record?.billing_status));
}

function pickLatestTimestamp(...values: Array<string | null | undefined>): string | null {
    const valid = values
        .filter(Boolean)
        .map(value => new Date(value as string))
        .filter(date => !Number.isNaN(date.getTime()))
        .sort((a, b) => b.getTime() - a.getTime());

    return valid[0]?.toISOString() || null;
}

async function resolveDashboardScope(req: Request): Promise<{ userId: string; tenantId: string }> {
    const userId = ((req as any).userId || (req as any)?.user?.id || '').toString().trim();
    const queryTenantSlug = String(req.query.tenantSlug || req.query.tenant_slug || req.query.tenant || '').trim();
    let tenantId = String((req as any).tenant?.tenantId || (req as any).tenantId || '').trim();

    if (!userId) {
        throw new Error('User ID required');
    }

    if (!tenantId && queryTenantSlug) {
        const { data: tenantData, error: tenantError } = await supabaseAdmin
            .from('tenants')
            .select('id')
            .eq('slug', queryTenantSlug)
            .is('deleted_at', null)
            .maybeSingle();

        if (tenantError) {
            throw new Error('Failed to resolve tenant context');
        }

        tenantId = String(tenantData?.id || '').trim();
    }

    if (!tenantId) {
        throw new Error('Tenant context required');
    }

    return { userId, tenantId };
}

/**
 * GET /api/metrics/recoveries
 * Get recovery metrics with time-based dashboard breakdown (Today, This Week, This Month)
 * This is called by the frontend Dashboard to populate the header metrics
 */
router.get('/recoveries', async (req: Request, res: Response) => {
    try {
        const { userId, tenantId } = await resolveDashboardScope(req);
        const dbClient = supabaseAdmin || supabase;

        // Get all dispute cases for this tenant and seller for time-based recovery truth
        const { data: cases, error } = await dbClient
            .from('dispute_cases')
            .select('claim_amount, status, created_at, actual_payout_amount, filing_status, provider_case_id, resolution_date')
            .eq('seller_id', userId)
            .eq('tenant_id', tenantId);

        if (error) {
            logger.warn('[METRICS] Error querying dispute_cases for dashboard', { error: error.message, userId });
        }

        const approvedCases = (cases || []).filter(isApprovedCase);
        const filedCases = (cases || []).filter(isFiledCase);
        const rejectedCases = (cases || []).filter(isRejectedCase);
        const decidedCases = approvedCases.length + rejectedCases.length;
        const approvedValue = approvedCases.reduce((sum, record: any) => sum + toNumber(record.claim_amount), 0);
        const valueInProgress = filedCases
            .filter((record: any) => !isApprovedCase(record) && !isRejectedCase(record))
            .reduce((sum, record: any) => sum + toNumber(record.claim_amount), 0);
        const successRate = decidedCases > 0 ? Math.round((approvedCases.length / decidedCases) * 100) : 0;
        const dashboard = await financialImpactService.getRecoveryMetricsExtended(userId, tenantId);

        logger.info('[METRICS] Dashboard metrics calculated', {
            userId,
            tenantId,
            casesCount: cases?.length || 0
        });

        res.json({
            success: true,
            approvedValue,
            valueApproved: approvedValue,
            valueInProgress,
            successRate,
            dashboard
        });
    } catch (error: any) {
        logger.error('[METRICS] Failed to get recoveries metrics', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to fetch metrics',
            dashboard: {
                today: 0,
                thisWeek: 0,
                thisMonth: 0,
                todayGrowth: 0,
                thisWeekGrowth: 0,
                thisMonthGrowth: 0
            }
        });
    }
});

router.get('/dashboard-summary', async (req: Request, res: Response) => {
    try {
        const { tenantId } = await resolveDashboardScope(req);
        const dbClient = supabaseAdmin || supabase;

        const [
            detectionResult,
            disputeResult,
            billingResult,
            documentResult,
            sourceResult
        ] = await Promise.all([
            dbClient
                .from('detection_results')
                .select('id, estimated_value, updated_at, created_at')
                .eq('tenant_id', tenantId),
            dbClient
                .from('dispute_cases')
                .select('id, status, filing_status, recovery_status, billing_status, claim_amount, actual_payout_amount, provider_case_id, updated_at, created_at')
                .eq('tenant_id', tenantId),
            dbClient
                .from('billing_transactions')
                .select('id, billing_status, platform_fee_cents, updated_at, created_at')
                .eq('tenant_id', tenantId),
            dbClient
                .from('evidence_documents')
                .select('id, processing_status, parser_confidence, updated_at, created_at')
                .eq('tenant_id', tenantId),
            dbClient
                .from('evidence_sources')
                .select('id, status, last_sync_at, updated_at, created_at')
                .eq('tenant_id', tenantId),
        ]);

        if (detectionResult.error) throw detectionResult.error;
        if (disputeResult.error) throw disputeResult.error;
        if (billingResult.error) throw billingResult.error;
        if (documentResult.error) throw documentResult.error;
        if (sourceResult.error) throw sourceResult.error;

        const detections = detectionResult.data || [];
        const disputes = disputeResult.data || [];
        const billingTransactions = billingResult.data || [];
        const documents = documentResult.data || [];
        const sources = sourceResult.data || [];
        const disputeIds = disputes.map((row: any) => row.id).filter(Boolean);
        let linkedDocumentIds = new Set<string>();

        if (disputeIds.length > 0) {
            const { data: linkedDocs, error: linkedDocsError } = await dbClient
                .from('dispute_evidence_links')
                .select('evidence_document_id, dispute_case_id')
                .in('dispute_case_id', disputeIds);

            if (linkedDocsError) throw linkedDocsError;
            linkedDocumentIds = new Set((linkedDocs || []).map((row: any) => row.evidence_document_id).filter(Boolean));
        }

        const filedCases = disputes.filter(isFiledCase);
        const approvedCases = disputes.filter(isApprovedCase);
        const rejectedCases = disputes.filter(isRejectedCase);
        const recoveredCases = disputes.filter(isRecoveredCase);
        const billedTransactions = billingTransactions.filter(isBilledRecord);

        const parsedDocuments = documents.filter((document: any) => normalize(document.processing_status) === 'completed');
        const failedDocuments = documents.filter((document: any) => normalize(document.processing_status) === 'failed');
        const processingDocuments = documents.filter((document: any) => normalize(document.processing_status) === 'processing');
        const needsReviewDocuments = documents.filter((document: any) => {
            const status = normalize(document.processing_status);
            const confidence = document.parser_confidence;
            return status === 'failed' || (status === 'completed' && typeof confidence === 'number' && confidence < 0.75);
        });
        const unmatchedDocuments = documents.filter((document: any) => !linkedDocumentIds.has(document.id));

        const estimatedValueTotal = detections.reduce((sum, row: any) => sum + toNumber(row.estimated_value), 0);
        const filedValueTotal = filedCases.reduce((sum, row: any) => sum + toNumber(row.claim_amount), 0);
        const approvedValueTotal = approvedCases.reduce((sum, row: any) => sum + toNumber(row.claim_amount), 0);
        const recoveredCashTotal = recoveredCases.reduce((sum, row: any) => sum + toNumber(row.actual_payout_amount), 0);
        const billedRevenueTotal = billedTransactions.reduce((sum, row: any) => sum + (toNumber(row.platform_fee_cents) / 100), 0);

        const connectedSources = sources.filter((source: any) => normalize(source.status) === 'connected');
        const staleCutoff = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
        const staleSources = connectedSources.filter((source: any) => {
            if (!source.last_sync_at) return true;
            const lastSync = new Date(source.last_sync_at);
            return Number.isNaN(lastSync.getTime()) || lastSync < staleCutoff;
        });

        const billingBacklogCount = disputes.filter((record: any) =>
            isRecoveredCase(record) && !isBilledRecord(record)
        ).length;
        const unreconciledRecoveryCount = disputes.filter((record: any) =>
            isApprovedCase(record) && !isRecoveredCase(record)
        ).length;

        const blockers = [
            connectedSources.length === 0
                ? { key: 'integrations_missing', label: 'No connected evidence sources', count: 1, severity: 'high' }
                : null,
            staleSources.length > 0
                ? { key: 'integrations_stale', label: 'Stale integrations', count: staleSources.length, severity: 'medium' }
                : null,
            processingDocuments.length > 0
                ? { key: 'parsing_backlog', label: 'Parsing backlog', count: processingDocuments.length, severity: 'medium' }
                : null,
            failedDocuments.length > 0
                ? { key: 'parsing_failed', label: 'Parsing failed', count: failedDocuments.length, severity: 'high' }
                : null,
            unmatchedDocuments.length > 0
                ? { key: 'evidence_unmatched', label: 'Unmatched evidence', count: unmatchedDocuments.length, severity: 'medium' }
                : null,
            rejectedCases.length > 0
                ? { key: 'cases_rejected', label: 'Rejected cases', count: rejectedCases.length, severity: 'medium' }
                : null,
            unreconciledRecoveryCount > 0
                ? { key: 'payouts_unreconciled', label: 'Approved cases awaiting recovery', count: unreconciledRecoveryCount, severity: 'medium' }
                : null,
            billingBacklogCount > 0
                ? { key: 'billing_backlog', label: 'Billing backlog', count: billingBacklogCount, severity: 'low' }
                : null
        ].filter(Boolean);

        const lastUpdatedAt = pickLatestTimestamp(
            ...detections.map((row: any) => row.updated_at || row.created_at),
            ...disputes.map((row: any) => row.updated_at || row.created_at),
            ...billingTransactions.map((row: any) => row.updated_at || row.created_at),
            ...documents.map((row: any) => row.updated_at || row.created_at),
            ...sources.map((row: any) => row.updated_at || row.created_at || row.last_sync_at)
        ) || new Date().toISOString();

        res.json({
            success: true,
            summary: {
                detections_count: detections.length,
                cases_count: disputes.length,
                filed_count: filedCases.length,
                approved_count: approvedCases.length,
                recovered_count: recoveredCases.length,
                billed_count: billedTransactions.length,
                estimated_value_total: Number(estimatedValueTotal.toFixed(2)),
                filed_value_total: Number(filedValueTotal.toFixed(2)),
                approved_value_total: Number(approvedValueTotal.toFixed(2)),
                recovered_cash_total: Number(recoveredCashTotal.toFixed(2)),
                billed_revenue_total: Number(billedRevenueTotal.toFixed(2)),
                last_updated_at: lastUpdatedAt,
                integrations_summary: {
                    connected_count: connectedSources.length,
                    stale_count: staleSources.length,
                    last_ingest_at: connectedSources
                        .map((source: any) => source.last_sync_at)
                        .filter(Boolean)
                        .sort()
                        .reverse()[0] || null
                },
                evidence_summary: {
                    total_documents: documents.length,
                    parsed_documents: parsedDocuments.length,
                    matched_documents: linkedDocumentIds.size,
                    failed_documents: failedDocuments.length,
                    needs_review_documents: needsReviewDocuments.length
                },
                blockers
            }
        });
    } catch (error: any) {
        logger.error('[METRICS] Failed to build dashboard summary', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch dashboard summary'
        });
    }
});


/**
 * GET /api/metrics/agents
 * Get performance metrics for all agents
 */
router.get('/agents', async (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const metrics = await metricsService.getAllAgentMetrics(days);

        res.json({
            success: true,
            data: metrics,
            period: `${days} days`
        });
    } catch (error: any) {
        logger.error('[METRICS API] Failed to get agent metrics', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
    }
});

/**
 * GET /api/metrics/agents/:agent
 * Get performance metrics for a specific agent
 */
router.get('/agents/:agent', async (req: Request, res: Response) => {
    try {
        const { agent } = req.params;
        const days = parseInt(req.query.days as string) || 30;
        const metrics = await metricsService.getAgentMetrics(agent, days);

        res.json({
            success: true,
            data: metrics,
            period: `${days} days`
        });
    } catch (error: any) {
        logger.error('[METRICS API] Failed to get agent metrics', { error: error.message, agent: req.params.agent });
        res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
    }
});

/**
 * GET /api/metrics/system
 * Get system health metrics
 */
router.get('/system', async (_req: Request, res: Response) => {
    try {
        const health = await metricsService.getSystemHealth();

        res.json({
            success: true,
            data: health
        });
    } catch (error: any) {
        logger.error('[METRICS API] Failed to get system health', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to fetch system health' });
    }
});

/**
 * GET /api/metrics/financial/:userId
 * Get financial impact metrics for a user
 */
router.get('/financial/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        const tenantId = req.query.tenantId as string;

        const metrics = await financialImpactService.getUserMetrics(userId, tenantId);

        res.json({
            success: true,
            data: metrics
        });
    } catch (error: any) {
        logger.error('[METRICS API] Failed to get financial metrics', { error: error.message, userId: req.params.userId });
        res.status(500).json({ success: false, error: 'Failed to fetch financial metrics' });
    }
});

/**
 * GET /api/metrics/runtime
 * Get real-time runtime statistics (in-memory)
 */
router.get('/runtime', async (_req: Request, res: Response) => {
    try {
        const agents = ['evidence_ingestion', 'document_parsing', 'evidence_matching', 'refund_filing', 'recoveries', 'billing', 'learning'];

        const stats = agents.map(agent => ({
            agent,
            ...metricsService.getRuntimeStats(agent)
        }));

        res.json({
            success: true,
            data: {
                agents: stats,
                activeOperations: metricsService.getActiveOperationCount()
            }
        });
    } catch (error: any) {
        logger.error('[METRICS API] Failed to get runtime stats', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to fetch runtime stats' });
    }
});

export default router;
