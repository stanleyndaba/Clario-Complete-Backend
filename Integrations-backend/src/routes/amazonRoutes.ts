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
import { syncJobManager } from '../services/syncJobManager';

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
      logger.info(`Attempting to fetch claims for recoveries`, { userId });
      const claimsResult = await amazonService.fetchClaims(userId);
      const claims = claimsResult.data || claimsResult.claims || [];
      
      logger.info(`Claims fetch result:`, {
        hasData: !!claimsResult,
        claimsType: Array.isArray(claims) ? 'array' : typeof claims,
        claimsLength: Array.isArray(claims) ? claims.length : 'N/A',
        claimsResultKeys: claimsResult ? Object.keys(claimsResult) : []
      });
      
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
      } else {
        logger.info('No claims found in response (empty array or no data)', {
          claimsResultType: typeof claimsResult,
          claimsResultKeys: claimsResult ? Object.keys(claimsResult) : [],
          claimsType: typeof claims,
          claimsIsArray: Array.isArray(claims)
        });
      }
    } catch (error: any) {
      logger.error(`Error fetching claims for recoveries:`, {
        error: error.message,
        stack: error.stack,
        userId
      });
      // Fall through to return zeros
    }
    
    // If no claims found, trigger a sync automatically (if not already running)
    // This ensures data is synced when user connects Amazon
    try {
      // Check if there's already a sync in progress by checking sync history
      // We'll attempt to start sync - it will check internally if one is already running
      logger.info('No claims found - attempting to trigger automatic sync', { userId });
      
      // Trigger sync in background - don't block the response
      // syncJobManager.startSync will check if sync is already in progress
      syncJobManager.startSync(userId).then((result) => {
        logger.info('Successfully triggered automatic sync from recoveries endpoint', { 
          userId, 
          syncId: result.syncId 
        });
      }).catch((syncError: any) => {
        // If sync is already in progress, that's OK - just log it
        if (syncError.message && syncError.message.includes('already in progress')) {
          logger.info('Sync already in progress, skipping automatic trigger', { userId });
        } else {
          logger.warn('Failed to trigger automatic sync from recoveries endpoint', {
            userId,
            error: syncError.message,
            // Don't fail the recoveries endpoint if sync fails
          });
        }
      });
    } catch (syncTriggerError: any) {
      // Log but don't fail - sync trigger is optional
      logger.warn('Error triggering sync from recoveries endpoint', {
        userId,
        error: syncTriggerError.message
      });
    }
    
    // Return zeros with message
    logger.info('No claims found, returning zeros - sync may be in progress');
    res.json({
      totalAmount: 0.0,
      currency: 'USD',
      claimCount: 0,
      message: 'No data found. Syncing your Amazon account... Please refresh in a few moments.',
      needsSync: true,
      syncTriggered: true
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
