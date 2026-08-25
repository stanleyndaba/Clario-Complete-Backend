import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
  createAccountingSellerMapping,
  getAccountingCoverage,
  getAccountingMappingCandidates,
  getAccountingSyncRuns,
  getEffectiveAccountingCost
} from '../controllers/accountingIntelligenceController';

const router = Router();

// Every response is a server-built safe projection. No route exposes raw provider
// payloads, OAuth credentials, or token metadata.
router.get('/coverage', authenticateToken, getAccountingCoverage);
router.get('/mapping-candidates', authenticateToken, getAccountingMappingCandidates);
router.post('/mappings', authenticateToken, createAccountingSellerMapping);
router.get('/costs/effective', authenticateToken, getEffectiveAccountingCost);
router.get('/sync-runs', authenticateToken, getAccountingSyncRuns);

export default router;
