import { Router } from 'express';
import { CertaintyController } from '../controllers/certaintyController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * @route POST /api/v1/certainty/score
 * @desc Score a flagged claim and persist the result
 * @access Private
 */
router.post('/score', CertaintyController.scoreClaim);

/**
 * @route GET /api/v1/certainty/scores/:claim_id
 * @desc Get all certainty scores for a specific claim
 * @access Private
 */
router.get('/scores/:claim_id', CertaintyController.getCertaintyScores);

/**
 * @route GET /api/v1/certainty/scores/:claim_id/latest
 * @desc Get the latest certainty score for a specific claim
 * @access Private
 */
router.get('/scores/:claim_id/latest', CertaintyController.getLatestCertaintyScore);

/**
 * @route GET /api/v1/certainty/stats
 * @desc Get certainty score statistics
 * @access Private
 */
router.get('/stats', CertaintyController.getCertaintyStats);

export default router;

