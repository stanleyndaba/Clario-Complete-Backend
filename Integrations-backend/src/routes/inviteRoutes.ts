import { Router, Request, Response } from 'express';
import { inviteService } from '../services/inviteService';
import { getLogger } from '../utils/logger';

const router = Router();
const logger = getLogger('InviteRoutes');

/**
 * POST /api/invites/send
 * Send a referral invitation to a potential seller
 */
router.post('/send', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';
        const { email, message } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Build referral link
        const baseUrl = process.env.FRONTEND_URL || 'https://opside.io';
        const referralLink = `${baseUrl}/signup?ref=${encodeURIComponent(userId)}`;

        const result = await inviteService.sendInvite({
            email,
            referrerId: userId,
            referralLink,
            message
        });

        if (result.success) {
            logger.info('Invite sent successfully', { email, inviteId: result.inviteId });
            return res.json({
                success: true,
                message: 'Invitation sent successfully',
                inviteId: result.inviteId
            });
        } else {
            logger.warn('Failed to send invite', { email, error: result.error });
            return res.status(400).json({
                success: false,
                error: result.error || 'Failed to send invitation'
            });
        }
    } catch (error: any) {
        logger.error('Error in send invite endpoint', { error: error.message });
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * GET /api/invites
 * Get all invites sent by the current user
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || req.headers['x-user-id'] as string || 'demo-user';

        const invites = await inviteService.getInvitesByReferrer(userId);

        return res.json({
            success: true,
            invites
        });
    } catch (error: any) {
        logger.error('Error fetching invites', { error: error.message });
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

export default router;
