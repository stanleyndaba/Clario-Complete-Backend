import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import {
  startAmazonOAuth,
  handleAmazonCallback,
  syncAmazonData,
  getAmazonClaims,
  getAmazonInventory,
  disconnectAmazon,
  diagnoseAmazonConnection
} from '../controllers/amazonController';
import amazonService from '../services/amazonService';

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
router.get('/diagnose', wrap(diagnoseAmazonConnection)); // Diagnostic endpoint

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

// Recovery metrics - returns totalAmount, currency, and claimCount
// This endpoint is called by the frontend and should match the expected format
router.get('/recoveries', wrap(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
    
    logger.info(`Getting Amazon recoveries summary for user: ${userId}`);
    
    // Try to get claims from the service
    try {
      const claimsResult = await amazonService.fetchClaims(userId);
      const claims = claimsResult.data || claimsResult.claims || [];
      
      if (Array.isArray(claims) && claims.length > 0) {
        // Calculate totals from actual claims
        const totalAmount = claims
          .filter((claim: any) => claim.status === 'approved')
          .reduce((sum: number, claim: any) => sum + (parseFloat(claim.amount) || 0), 0);
        const claimCount = claims.length;
        
        logger.info(`Found ${claimCount} claims, total approved: $${totalAmount}`);
        
        return res.json({
          totalAmount: totalAmount,
          currency: 'USD',
          claimCount: claimCount,
          source: 'spapi_sandbox'
        });
      }
    } catch (error: any) {
      logger.warn(`Error fetching claims for recoveries: ${error.message}`);
      // Fall through to return zeros
    }
    
    // If no claims found or error, return zeros
    // Frontend will use mock data as fallback
    logger.info('No claims found, returning zeros');
    res.json({
      totalAmount: 0.0,
      currency: 'USD',
      claimCount: 0,
      message: 'No data found. Please sync your Amazon account first.'
    });
  } catch (error: any) {
    logger.error('Error in recoveries endpoint:', error);
    res.status(500).json({
      totalAmount: 0.0,
      currency: 'USD',
      claimCount: 0,
      error: error.message
    });
  }
}));

export default router;
