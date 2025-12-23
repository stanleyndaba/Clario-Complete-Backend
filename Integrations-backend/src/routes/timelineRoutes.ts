/**
 * Timeline Routes - API endpoints for claim timeline events
 */

import { Router, Request, Response } from 'express';
import { timelineService, TimelineAction } from '../services/timelineService';

const router = Router();

/**
 * GET /api/claims/:id/timeline
 * Get timeline events for a claim
 */
router.get('/:id/timeline', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const table = (req.query.table as 'detection_results' | 'claims') || 'detection_results';

        const timeline = await timelineService.getTimeline(id, table);

        return res.json({
            success: true,
            timeline,
            count: timeline.length
        });
    } catch (error: any) {
        console.error('[Timeline API] Error fetching timeline:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch timeline'
        });
    }
});

/**
 * POST /api/claims/:id/timeline
 * Add a timeline event to a claim
 */
router.post('/:id/timeline', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { action, description, amount, rejectionReason, escalationRound, metadata, table } = req.body;

        if (!action || !description) {
            return res.status(400).json({
                success: false,
                error: 'action and description are required'
            });
        }

        const event = await timelineService.addEvent({
            claimId: id,
            action: action as TimelineAction,
            description,
            amount,
            rejectionReason,
            escalationRound,
            metadata,
            table: table || 'detection_results'
        });

        if (!event) {
            return res.status(500).json({
                success: false,
                error: 'Failed to add timeline event'
            });
        }

        return res.json({
            success: true,
            event
        });
    } catch (error: any) {
        console.error('[Timeline API] Error adding event:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to add timeline event'
        });
    }
});

export default router;
