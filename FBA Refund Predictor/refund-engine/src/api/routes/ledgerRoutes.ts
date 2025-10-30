import { Router } from 'express';
import { LedgerController } from '../controllers/ledgerController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * @route GET /api/v1/ledger
 * @desc Get ledger entries with filtering and pagination
 * @access Private
 */
router.get('/', LedgerController.getLedgerEntries);

/**
 * @route GET /api/v1/ledger/stats
 * @desc Get ledger statistics
 * @access Private
 */
router.get('/stats', LedgerController.getLedgerStats);

/**
 * @route GET /api/v1/ledger/with-cases
 * @desc Get ledger entries with case information
 * @access Private
 */
router.get('/with-cases', LedgerController.getLedgerEntriesWithCaseInfo);

/**
 * @route GET /api/v1/ledger/search
 * @desc Search ledger entries by description
 * @access Private
 */
router.get('/search', LedgerController.searchLedgerEntries);

/**
 * @route POST /api/v1/ledger
 * @desc Create a new ledger entry
 * @access Private
 */
router.post('/', LedgerController.createLedgerEntry);

/**
 * @route GET /api/v1/ledger/:id
 * @desc Get a specific ledger entry by ID
 * @access Private
 */
router.get('/:id', LedgerController.getLedgerEntryById);

/**
 * @route PUT /api/v1/ledger/:id/status
 * @desc Update ledger entry status
 * @access Private
 */
router.put('/:id/status', LedgerController.updateLedgerEntryStatus);

/**
 * @route GET /api/v1/ledger/case/:caseId
 * @desc Get ledger entries for a specific case
 * @access Private
 */
router.get('/case/:caseId', LedgerController.getLedgerEntriesByCase);

export { router }; 
