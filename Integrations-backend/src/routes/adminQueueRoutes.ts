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

        if (!isHealthy) {
            logger.warn('[ADMIN] Queue health check failed');
            return res.status(200).json({
                status: 'unavailable',
                message: 'Redis not connected or queue not initialized. Inline sync fallback is active.',
                timestamp: new Date().toISOString(),
                metrics: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
            });
        }

        // ✅ Get metrics
        const metrics = await getQueueMetrics();

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            queueName: 'onboarding-sync',
            metrics: {
                waiting: metrics.waiting,
                active: metrics.active,
                completed: metrics.completed,
                failed: metrics.failed,
                delayed: metrics.delayed
            },
            alerts: {
                highFailureRate: metrics.failed > 10,
                backlogBuilding: metrics.waiting > 50,
                workersOverloaded: metrics.active >= 5
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
