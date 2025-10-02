import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
  initiateAmazonOAuth,
  handleAmazonCallback,
  getAmazonClaims,
  getAmazonInventory,
  getAmazonFees,
  disconnectAmazon
} from '../controllers/amazonController';
import { createUserRateLimit } from '../middleware/rateLimit';
import { getRedisClient } from '../utils/redisClient';

const router = Router();

// OAuth routes (no authentication required for callback)
router.get('/callback', handleAmazonCallback);

// Sandbox routes for demo flow
router.post('/sandbox/callback', (req, res) => {
  // Mock sandbox authentication - always succeed
  return res.json({ 
    success: true, 
    message: 'Sandbox authentication successful',
    user: { id: 'sandbox-user', name: 'Sandbox Seller' }
  });
});

router.get('/recoveries', (req, res) => {
  // Mock recovery data for the big reveal
  return res.json({
    totalAmount: 14228,
    currency: 'USD',
    claimCount: 23
  });
});

// Protected routes
router.use(authenticateToken);

// Apply rate limiting to OAuth initiation (30 requests per minute)
router.get('/auth', async (req, res, next) => {
  try {
    const redisClient = await getRedisClient();
    const rateLimit = createUserRateLimit(redisClient, 'auth', 60, 30);
    return rateLimit(req, res, next);
  } catch (error) {
    // If Redis is unavailable, continue without rate limiting
    next();
  }
}, initiateAmazonOAuth);

// Data fetching routes
router.get('/claims', getAmazonClaims);
router.get('/inventory', getAmazonInventory);
router.get('/fees', getAmazonFees);

// Disconnect
router.delete('/disconnect', disconnectAmazon);

export default router;
