import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
  initiateGmailOAuth,
  handleGmailCallback,
  connectGmail,
  getGmailStatus,
  getGmailEmails,
  searchGmailEmails,
  disconnectGmail
} from '../controllers/gmailController';

const router = Router();

// OAuth routes (no authentication required for callback)
router.get('/callback', handleGmailCallback);

// Protected routes
router.use(authenticateToken);

// OAuth initiation
router.get('/auth', initiateGmailOAuth);

// Connection
router.post('/connect', connectGmail);
router.get('/status', getGmailStatus);

// Email operations
router.get('/emails', getGmailEmails);
router.get('/search', searchGmailEmails);

// Disconnect
router.delete('/disconnect', disconnectGmail);

export default router; 

