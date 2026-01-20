/**
 * Metrics API Routes
 * 
 * Exposes observability and financial impact metrics for dashboards.
 */

import { Router, Request, Response } from 'express';
import { metricsService } from '../services/metricsService';
import { financialImpactService } from '../services/financialImpactService';
import logger from '../utils/logger';

const router = Router();

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
