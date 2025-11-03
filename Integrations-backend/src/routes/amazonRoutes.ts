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

// Root Amazon endpoint - redirect to auth/start for backward compatibility
router.get('/', (req, res) => {
  // If it's a connect request, redirect to auth/start
  if (req.query.connect || req.query.action === 'connect') {
    return res.redirect('/api/v1/integrations/amazon/auth/start');
  }
  // Otherwise return endpoint info
  res.json({
    success: true,
    message: 'Amazon integration endpoints',
    endpoints: {
      connect: '/api/v1/integrations/amazon/auth/start',
      callback: '/api/v1/integrations/amazon/auth/callback',
      sync: '/api/v1/integrations/amazon/sync',
      claims: '/api/v1/integrations/amazon/claims',
      inventory: '/api/v1/integrations/amazon/inventory',
      disconnect: '/api/v1/integrations/amazon/disconnect'
    }
  });
});

router.get('/auth/start', wrap(startAmazonOAuth));
router.get('/auth/callback', wrap(handleAmazonCallback));
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
