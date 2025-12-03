import { Router, Request, Response } from 'express';
import { getLogger } from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import learningService from '../services/learningService';
import learningWorker from '../workers/learningWorker';

const router = Router();
const logger = getLogger('LearningRoutes');

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
