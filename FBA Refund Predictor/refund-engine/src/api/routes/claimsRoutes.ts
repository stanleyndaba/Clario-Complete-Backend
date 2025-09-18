import { Router } from 'express';
import { ClaimsController } from '../controllers/claimsController';
import { authenticateToken } from '../middleware/authMiddleware';
import claimRiskRoutes from './claimRiskRoutes';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Mount claim risk scoring routes
router.use('/', claimRiskRoutes);

/**
 * @route POST /api/v1/claims/flag
 * @desc Flag invoice anomalies and persist proof
 * @access Private
 */
router.post('/flag', ClaimsController.flagClaim);

/**
 * @route POST /api/v1/claims/flag+score
 * @desc Unified endpoint: Flag claim + generate certainty score in one shot
 * @access Private
 */
router.post('/flag+score', ClaimsController.flagClaimWithCertainty);

/**
 * @route GET /api/v1/proofs/:id
 * @desc Fetch full auditable proof bundle
 * @access Private
 */
router.get('/proofs/:id', ClaimsController.getProof);

/**
 * @route POST /api/v1/claims
 * @desc Create a new claim
 * @access Private
 */
router.post('/', ClaimsController.createClaim);

/**
 * @route GET /api/v1/claims
 * @desc Get all claims with pagination and filtering
 * @access Private
 */
router.get('/', ClaimsController.getClaims);

/**
 * @route GET /api/v1/claims/stats
 * @desc Get claims statistics
 * @access Private
 */
router.get('/stats', ClaimsController.getClaimsStats);

/**
 * @route GET /api/v1/claims/search
 * @desc Search claims by text
 * @access Private
 */
router.get('/search', ClaimsController.searchClaims);

/**
 * @route GET /api/v1/claims/:id
 * @desc Get a specific claim by ID
 * @access Private
 */
router.get('/:id', ClaimsController.getClaimById);

/**
 * @route GET /api/v1/claims/case/:caseNumber
 * @desc Get a specific claim by case number
 * @access Private
 */
router.get('/case/:caseNumber', ClaimsController.getClaimByCaseNumber);

/**
 * @route PUT /api/v1/claims/:id
 * @desc Update a claim
 * @access Private
 */
router.put('/:id', ClaimsController.updateClaim);

/**
 * @route DELETE /api/v1/claims/:id
 * @desc Delete a claim
 * @access Private
 */
router.delete('/:id', ClaimsController.deleteClaim);

export default router; 