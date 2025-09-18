import { Router } from 'express';
import {
  initiateOAuth,
  handleOAuthCallback,
  getClaims,
  getInventory,
  getFees,
  refreshToken,
  disconnectAccount
} from '../controllers/amazonController';
import { amazonOAuthCallback } from '../controllers/authController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// OAuth routes (public)
router.get('/auth', initiateOAuth);
router.get('/callback', handleOAuthCallback);

// Enhanced OAuth callback that triggers historical sync
router.get('/oauth-callback', authenticateToken, amazonOAuthCallback);

// Protected routes
router.get('/claims/:userId', authenticateToken, getClaims);
router.get('/inventory/:userId', authenticateToken, getInventory);
router.get('/fees/:userId', authenticateToken, getFees);
router.post('/refresh/:userId', authenticateToken, refreshToken);
router.delete('/disconnect/:userId', authenticateToken, disconnectAccount);

export default router; 