import { Router, Request, Response } from 'express';

import {
  getPublicAnalyticsSummary,
  getPublicAnalyticsVisitorTimeline,
} from '../services/publicAnalyticsService';
import logger from '../utils/logger';

const router = Router();

router.get('/overview', async (req: Request, res: Response) => {
  try {
    const summary = await getPublicAnalyticsSummary(req.query.days);
    return res.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    logger.error('[ADMIN ANALYTICS] Failed to load overview', {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: 'ANALYTICS_OVERVIEW_FAILED',
    });
  }
});

router.get('/visitors/:anonymousId/timeline', async (req: Request, res: Response) => {
  try {
    const timeline = await getPublicAnalyticsVisitorTimeline(req.params.anonymousId, req.query.days);
    const status = timeline.available === false && timeline.error === 'INVALID_VISITOR_ID' ? 400 : 200;
    return res.status(status).json({
      success: status === 200,
      ...timeline,
    });
  } catch (error) {
    logger.error('[ADMIN ANALYTICS] Failed to load visitor timeline', {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: 'ANALYTICS_TIMELINE_FAILED',
    });
  }
});

export default router;
