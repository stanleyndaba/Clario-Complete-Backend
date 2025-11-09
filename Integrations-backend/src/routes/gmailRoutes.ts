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

// OAuth initiation - allow X-User-Id header (for testing without full auth)
// This endpoint should work with either JWT token or X-User-Id header
router.get('/auth', (req, res, next) => {
  // Check if X-User-Id header is present (for testing)
  const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
  if (userId) {
    // Set req.user for downstream handlers
    (req as any).user = { id: userId };
    return next();
  }
  // Otherwise, require authentication
  return authenticateToken(req, res, next);
}, initiateGmailOAuth);

// Connection status - allow X-User-Id header (for testing without full auth)
router.get('/status', (req, res, next) => {
  // Check if X-User-Id header is present (for testing)
  const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
  if (userId) {
    // Set req.user for downstream handlers
    (req as any).user = { id: userId };
    return next();
  }
  // Otherwise, require authentication
  return authenticateToken(req, res, next);
}, getGmailStatus);

// Email operations - require authentication
router.get('/emails', authenticateToken, getGmailEmails);
router.get('/search', authenticateToken, searchGmailEmails);

export default router; 

