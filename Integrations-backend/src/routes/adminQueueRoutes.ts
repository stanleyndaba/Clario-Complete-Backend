/**
 * Admin Queue Routes
 * 
 * Monitoring endpoints for BullMQ queue health and metrics.
 * Access: /api/admin/queue-stats
 * 
 * Use this endpoint to:
 * - Monitor queue health on your phone during launch
 * - Watch "active" count go up and down
 * - Spot failed jobs that need attention
 */

import { Router, Request, Response } from 'express';
import { isQueueHealthy, getQueueMetrics } from '../queues/ingestionQueue';
import logger from '../utils/logger';
import runtimeCapacityService from '../services/runtimeCapacityService';
import capacityGovernanceService from '../services/capacityGovernanceService';
import refundFilingWorker from '../workers/refundFilingWorker';
import { supabaseAdmin } from '../database/supabaseClient';

const router = Router();

/**
 * GET /api/admin/queue-stats
 * 
 * Returns queue health status and job counts.
 */
router.get('/queue-stats', async (req: Request, res: Response) => {
    try {
        // ✅ Health check first
        const isHealthy = await isQueueHealthy();
        const runtimeSnapshot = runtimeCapacityService.getSnapshot();
        const filingQueue = await refundFilingWorker.getSubmissionQueueMetrics();
        const { data: tenants } = await supabaseAdmin
            .from('tenants')
            .select('id, name')
            .in('status', ['active', 'trialing'])
            .is('deleted_at', null)
            .limit(25);

        const hotspotMetrics = await Promise.all(
            (tenants || []).map(async (tenant) => ({
                tenantId: tenant.id,
                tenantName: tenant.name,
                ...(await capacityGovernanceService.getTenantBacklogMetrics(tenant.id))
            }))
        );

        const hotspots = hotspotMetrics
            .sort((left, right) => {
                const leftScore = left.parsingBacklog + left.matchingBacklog + left.filingBacklog + left.recoveryBacklog + left.billingBacklog;
                const rightScore = right.parsingBacklog + right.matchingBacklog + right.filingBacklog + right.recoveryBacklog + right.billingBacklog;
                return rightScore - leftScore;
            })
            .slice(0, 10);

        if (!isHealthy) {
            logger.warn('[ADMIN] Queue health check failed');
            return res.status(200).json({
                status: 'unavailable',
                message: 'Redis not connected or queue not initialized. Inline sync fallback is active.',
                timestamp: new Date().toISOString(),
                metrics: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
                filingQueue,
                runtime: runtimeSnapshot,
                hotspots
            });
        }

        // ✅ Get metrics
        const metrics = await getQueueMetrics();

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            queues: {
                onboardingSync: {
                    waiting: metrics.waiting,
                    active: metrics.active,
                    completed: metrics.completed,
                    failed: metrics.failed,
                    delayed: metrics.delayed
                },
                filing: filingQueue
            },
            runtime: runtimeSnapshot,
            hotspots,
            alerts: {
                highFailureRate: metrics.failed > 10,
                backlogBuilding: metrics.waiting > 50,
                workersOverloaded: metrics.active >= 5,
                filingBacklogBuilding: filingQueue.waiting > 50,
                filingQueueAging: (filingQueue.oldestWaitingAgeMs || 0) > 10 * 60 * 1000
            }
        });
    } catch (error: any) {
        logger.error('[ADMIN] Failed to get queue stats', { error: error.message });
        res.status(200).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString(),
            metrics: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
        });
    }
});

export default router;
