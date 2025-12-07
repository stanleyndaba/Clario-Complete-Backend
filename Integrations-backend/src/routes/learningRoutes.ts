import { Router, Request, Response } from 'express';
import { getLogger } from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import learningService from '../services/learningService';
import learningWorker from '../workers/learningWorker';

const router = Router();
const logger = getLogger('LearningRoutes');

/**
 * GET /api/learning/metrics
 * Get aggregated learning metrics for the Admin dashboard
 */
router.get('/metrics', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const windowParam = req.query.window as string || '30d';
        let days = 30;
        if (windowParam === '7d') days = 7;
        else if (windowParam === '90d') days = 90;

        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        logger.info('Fetching learning metrics', { userId, window: windowParam, days });

        // Get all events for the user in the time window
        const { data: events, error: eventsError } = await supabaseAdmin
            .from('agent_events')
            .select('agent, success, created_at')
            .eq('user_id', userId)
            .gte('created_at', since);

        if (eventsError) {
            throw new Error(eventsError.message);
        }

        const eventList = events || [];
        const totalEvents = eventList.length;
        const successfulEvents = eventList.filter(e => e.success).length;
        const successRate = totalEvents > 0 ? successfulEvents / totalEvents : 0;

        // Group by agent
        const byAgent: Record<string, { events: number; success_rate: number; successful: number }> = {};
        for (const event of eventList) {
            if (!byAgent[event.agent]) {
                byAgent[event.agent] = { events: 0, success_rate: 0, successful: 0 };
            }
            byAgent[event.agent].events++;
            if (event.success) {
                byAgent[event.agent].successful++;
            }
        }

        // Calculate success rate per agent
        for (const agent of Object.keys(byAgent)) {
            const agentData = byAgent[agent];
            agentData.success_rate = agentData.events > 0 ? agentData.successful / agentData.events : 0;
        }

        // Calculate improvement rate (compare first half vs second half of window)
        const midPoint = new Date(Date.now() - (days / 2) * 24 * 60 * 60 * 1000);
        const firstHalf = eventList.filter(e => new Date(e.created_at) < midPoint);
        const secondHalf = eventList.filter(e => new Date(e.created_at) >= midPoint);

        const firstHalfSuccess = firstHalf.length > 0
            ? firstHalf.filter(e => e.success).length / firstHalf.length
            : 0;
        const secondHalfSuccess = secondHalf.length > 0
            ? secondHalf.filter(e => e.success).length / secondHalf.length
            : 0;
        const improvementRate = secondHalfSuccess - firstHalfSuccess;

        return res.json({
            ok: true,
            data: {
                metrics: {
                    total_events: totalEvents,
                    success_rate: successRate,
                    improvement_rate: improvementRate,
                    by_agent: byAgent
                }
            }
        });

    } catch (error: any) {
        logger.error('Error fetching learning metrics', { error: error.message });
        return res.status(500).json({ error: 'Failed to fetch learning metrics' });
    }
});


/**
 * GET /api/learning/insights
 * Get learning insights for the current user
 */
router.get('/insights', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const days = parseInt(req.query.days as string) || 30;

        logger.info('Fetching learning insights', { userId, days });

        const insights = await learningService.getLearningInsights(userId, days);

        return res.json({
            success: true,
            insights
        });

    } catch (error: any) {
        logger.error('Error fetching learning insights', { error: error.message });
        return res.status(500).json({ error: 'Failed to fetch learning insights' });
    }
});

/**
 * GET /api/learning/model-performance
 * Get model performance metrics for the current user
 */
router.get('/model-performance', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const performance = await learningService.getModelPerformance(userId);

        return res.json({
            success: true,
            performance
        });

    } catch (error: any) {
        logger.error('Error fetching model performance', { error: error.message });
        return res.status(500).json({ error: 'Failed to fetch model performance' });
    }
});

/**
 * GET /api/learning/threshold-history
 * Get threshold optimization history for the current user
 */
router.get('/threshold-history', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const limit = parseInt(req.query.limit as string) || 50;

        const { data: thresholds, error } = await supabaseAdmin
            .from('threshold_optimizations')
            .select('*')
            .eq('user_id', userId)
            .order('applied_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw new Error(error.message);
        }

        return res.json({
            success: true,
            thresholds: thresholds || []
        });

    } catch (error: any) {
        logger.error('Error fetching threshold history', { error: error.message });
        return res.status(500).json({ error: 'Failed to fetch threshold history' });
    }
});

/**
 * POST /api/learning/trigger-retraining
 * Manually trigger model retraining (admin only or for testing)
 */
router.post('/trigger-retraining', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        logger.info('Manual retraining triggered', { userId });

        // Run a learning cycle manually
        const stats = await learningWorker.runLearningCycle();

        return res.json({
            success: true,
            message: 'Learning cycle triggered',
            stats
        });

    } catch (error: any) {
        logger.error('Error triggering retraining', { error: error.message });
        return res.status(500).json({ error: 'Failed to trigger retraining' });
    }
});

/**
 * GET /api/learning/stats
 * Get learning system statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Get counts from various tables
        const { data: agentEvents, error: eventsError } = await supabaseAdmin
            .from('agent_events')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        const { data: thresholdOpts, error: thresholdError } = await supabaseAdmin
            .from('threshold_optimizations')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        const { data: insights, error: insightsError } = await supabaseAdmin
            .from('learning_insights')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        return res.json({
            success: true,
            stats: {
                totalEvents: (agentEvents as any)?.count || 0,
                thresholdOptimizations: (thresholdOpts as any)?.count || 0,
                insightsGenerated: (insights as any)?.count || 0
            }
        });

    } catch (error: any) {
        logger.error('Error fetching learning stats', { error: error.message });
        return res.status(500).json({ error: 'Failed to fetch learning stats' });
    }
});

export default router;
