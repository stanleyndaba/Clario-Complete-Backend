/**
 * Claim Risk Scoring Routes
 * API endpoints for claim risk assessment using ML models
 */

import { Router } from 'express';
import { ClaimRiskController } from '../controllers/claimRiskController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * @route POST /api/v1/claims/score
 * @desc Score a claim for risk assessment using ML models
 * @access Private
 */
router.post('/score', ClaimRiskController.scoreClaim);

/**
 * @route POST /api/v1/claims/train-models
 * @desc Train the ML models with synthetic data
 * @access Private
 */
router.post('/train-models', ClaimRiskController.trainModels);

/**
 * @route GET /api/v1/claims/model-info
 * @desc Get information about the trained ML models
 * @access Private
 */
router.get('/model-info', ClaimRiskController.getModelInfo);

/**
 * @route GET /api/v1/claims/check-environment
 * @desc Check if Python environment is available for ML models
 * @access Private
 */
router.get('/check-environment', ClaimRiskController.checkEnvironment);

/**
 * @route GET /api/v1/claims/sample
 * @desc Get a sample claim for testing the risk scoring API
 * @access Private
 */
router.get('/sample', ClaimRiskController.getSampleClaim);

/**
 * @route POST /api/v1/claims/batch-score
 * @desc Batch score multiple claims for risk assessment
 * @access Private
 */
router.post('/batch-score', ClaimRiskController.batchScoreClaims);

export default router;




