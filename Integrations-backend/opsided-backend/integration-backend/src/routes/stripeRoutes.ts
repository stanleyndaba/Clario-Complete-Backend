import { Router } from 'express';
import {
  initiateOAuth,
  handleOAuthCallback,
  getTransactions,
  getCharges,
  getRefunds,
  refreshToken,
  disconnectAccount
} from '../controllers/stripeController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// OAuth routes (public)
router.get('/auth', initiateOAuth);
router.get('/callback', handleOAuthCallback);

// Protected routes
router.get('/transactions/:userId', authenticateToken, getTransactions);
router.get('/charges/:userId', authenticateToken, getCharges);
router.get('/refunds/:userId', authenticateToken, getRefunds);
router.post('/refresh/:userId', authenticateToken, refreshToken);
router.delete('/disconnect/:userId', authenticateToken, disconnectAccount);

export default router; 