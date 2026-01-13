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
import { ingestionQueue, isQueueHealthy, getQueueMetrics } from '../queues/ingestionQueue';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/admin/queue-stats
 * 
 * Returns queue health status and job counts.
 * 
 * Response:
 * - status: 'healthy' | 'down'
 * - timestamp: ISO string
 * - metrics: { waiting, active, completed, failed, delayed }
 */
router.get('/queue-stats', async (req: Request, res: Response) => {
    try {
        // ✅ Health check first
        const isHealthy = await isQueueHealthy();

        if (!isHealthy) {
            logger.warn('[ADMIN] Queue health check failed');
            return res.status(503).json({
                status: 'down',
                message: 'Redis disconnected or queue unavailable',
                timestamp: new Date().toISOString()
            });
        }

        // ✅ Get metrics
        const metrics = await getQueueMetrics();

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            queueName: 'onboarding-sync',
            metrics: {
                waiting: metrics.waiting,     // Jobs in line
                active: metrics.active,       // Currently processing
                completed: metrics.completed, // Success stories
                failed: metrics.failed,       // Needs attention
                delayed: metrics.delayed      // Scheduled for later
            },
            alerts: {
                // Flag if there are concerning patterns
                highFailureRate: metrics.failed > 10,
                backlogBuilding: metrics.waiting > 50,
                workersOverloaded: metrics.active >= 5
            }
        });
    } catch (error: any) {
        logger.error('[ADMIN] Failed to get queue stats', { error: error.message });
        res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/admin/queue-jobs
 * 
 * Returns recent jobs for debugging.
 * Query params:
 * - status: 'waiting' | 'active' | 'completed' | 'failed' (default: 'failed')
 * - limit: number (default: 10, max: 50)
 */
router.get('/queue-jobs', async (req: Request, res: Response) => {
    try {
        const status = (req.query.status as string) || 'failed';
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

        const jobs = await ingestionQueue.getJobs([status as any], 0, limit - 1);

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            jobStatus: status,
            count: jobs.length,
            jobs: jobs.map(job => ({
                id: job.id,
                userId: job.data.userId,
                sellerId: job.data.sellerId,
                jobType: job.data.jobType,
                triggeredAt: job.data.triggeredAt,
                attemptsMade: job.attemptsMade,
                failedReason: job.failedReason,
                processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
                finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null
            }))
        });
    } catch (error: any) {
        logger.error('[ADMIN] Failed to get queue jobs', { error: error.message });
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/queue-retry/:jobId
 * 
 * Retry a failed job manually.
 */
router.post('/queue-retry/:jobId', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;

        const job = await ingestionQueue.getJob(jobId);
        if (!job) {
            return res.status(404).json({
                status: 'error',
                message: `Job ${jobId} not found`
            });
        }

        await job.retry();
        logger.info('[ADMIN] Job manually retried', { jobId });

        res.json({
            status: 'ok',
            message: `Job ${jobId} queued for retry`,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        logger.error('[ADMIN] Failed to retry job', { error: error.message });
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

export default router;
