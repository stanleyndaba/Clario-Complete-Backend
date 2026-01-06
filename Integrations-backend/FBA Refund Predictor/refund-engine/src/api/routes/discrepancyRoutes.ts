import { Router } from 'express';
import { DiscrepancyController } from '../controllers/discrepancyController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * @route GET /api/v1/discrepancies
 * @desc Get claims predicted for reimbursement (discrepancies)
 * @access Private
 */
router.get('/', DiscrepancyController.getDiscrepancies);

/**
 * @route GET /api/v1/discrepancies/stats
 * @desc Get discrepancy statistics
 * @access Private
 */
router.get('/stats', DiscrepancyController.getDiscrepancyStats);

/**
 * @route GET /api/v1/discrepancies/trends
 * @desc Get discrepancy trends over time
 * @access Private
 */
router.get('/trends', DiscrepancyController.getDiscrepancyTrends);

/**
 * @route GET /api/v1/discrepancies/ml-health
 * @desc Test ML API connection
 * @access Private
 */
router.get('/ml-health', DiscrepancyController.testMLConnection);

/**
 * @route POST /api/v1/discrepancies/batch-predict
 * @desc Batch predict discrepancies for multiple cases
 * @access Private
 */
router.post('/batch-predict', DiscrepancyController.batchPredictDiscrepancies);

/**
 * @route GET /api/v1/discrepancies/case/:caseId
 * @desc Get discrepancy analysis for a specific case
 * @access Private
 */
router.get('/case/:caseId', DiscrepancyController.getCaseDiscrepancyAnalysis);

export { router }; 
