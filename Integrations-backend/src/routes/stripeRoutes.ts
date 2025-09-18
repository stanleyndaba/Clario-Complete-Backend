import { Router } from 'express';
import { getStripeAccountStatus } from '../services/stripeService';
import { authenticateToken } from '../middleware/authMiddleware';
import {
  initiateStripeOAuth,
  handleStripeCallback,
  connectStripe,
  getStripeTransactions,
  getStripeAccountInfo,
  getStripeTransaction,
  disconnectStripe
} from '../controllers/stripeController';

const router = Router();

router.get('/status', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const status = await getStripeAccountStatus(userId);
  res.json({ success: true, status });
});

// OAuth routes (no authentication required for callback)
router.get('/callback', handleStripeCallback);

// Protected routes
router.use(authenticateToken);

// OAuth initiation
router.get('/auth', initiateStripeOAuth);

// Connection
router.post('/connect', connectStripe);

// Transaction operations
router.get('/transactions', getStripeTransactions);
router.get('/account', getStripeAccountInfo);
router.get('/transactions/:transactionId', getStripeTransaction);

// Disconnect
router.delete('/disconnect', disconnectStripe);

export default router; 