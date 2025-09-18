import { Router } from 'express';
import {
  initiateOAuth,
  handleOAuthCallback,
  getEmails,
  getEmailById,
  refreshToken,
  disconnectAccount
} from '../controllers/gmailController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// OAuth routes (public)
router.get('/auth', initiateOAuth);
router.get('/callback', handleOAuthCallback);

// Protected routes
router.get('/emails/:userId', authenticateToken, getEmails);
router.get('/emails/:userId/:emailId', authenticateToken, getEmailById);
router.post('/refresh/:userId', authenticateToken, refreshToken);
router.delete('/disconnect/:userId', authenticateToken, disconnectAccount);

export default router; 