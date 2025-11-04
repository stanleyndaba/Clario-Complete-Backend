import { Router } from 'express';
import logger from '../utils/logger';
import {
  startAmazonOAuth,
  handleAmazonCallback,
  syncAmazonData,
  getAmazonClaims,
  getAmazonInventory,
  disconnectAmazon
} from '../controllers/amazonController';

const router = Router();

// Wrap handlers to ensure exceptions are surfaced and logged
const wrap = (fn: any) => async (req: any, res: any, next: any) => {
  try { await fn(req, res, next); } catch (err) { logger.error('Amazon route error', { err }); next(err); }
};

// Root Amazon endpoint - start OAuth flow directly (for backward compatibility)
// This handles requests to /api/v1/integrations/amazon
router.get('/', wrap(startAmazonOAuth));

router.get('/auth/start', wrap(startAmazonOAuth));
router.get('/auth/callback', wrap(handleAmazonCallback));
// Sandbox callback endpoint - same as regular callback (sandbox uses same OAuth flow)
router.get('/sandbox/callback', wrap(handleAmazonCallback));
router.post('/sandbox/callback', wrap(handleAmazonCallback));
router.options('/sandbox/callback', (req, res) => {
  // Handle CORS preflight for sandbox callback
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(204).send();
});
router.post('/sync', wrap(syncAmazonData));
router.get('/claims', wrap(getAmazonClaims));
router.get('/inventory', wrap(getAmazonInventory));
router.post('/disconnect', wrap(disconnectAmazon));

// Mock fee endpoint since it was referenced
router.get('/fees', (_, res) => {
  res.json({
    success: true,
    fees: [
      { type: 'referral_fee', amount: 45.50 },
      { type: 'storage_fee', amount: 23.75 }
    ]
  });
});

// Recovery metrics (lightweight placeholder for frontend charts)
router.get('/recoveries', (_, res) => {
  res.json({
    success: true,
    recoveries: {
      last_30_days: {
        total_cases: 12,
        approved: 8,
        rejected: 2,
        pending: 2,
        recovered_amount: 1825.40
      }
    }
  });
});

export default router;
