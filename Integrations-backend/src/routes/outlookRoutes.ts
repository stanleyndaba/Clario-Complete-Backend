import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    initiateOutlookOAuth,
    handleOutlookCallback,
    getOutlookStatus,
    getOutlookEmails,
    disconnectOutlook
} from '../controllers/outlookController';

const router = Router();

// OAuth routes (no authentication required for callback)
router.get('/callback', handleOutlookCallback);

// OAuth initiation - allow X-User-Id header (for testing without full auth)
router.get('/auth', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, initiateOutlookOAuth);

// Alias for /auth/start
router.get('/auth/start', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, initiateOutlookOAuth);

// Connection status - allow X-User-Id header
router.get('/status', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, getOutlookStatus);

// Email operations - require authentication
router.get('/emails', authenticateToken, getOutlookEmails);

// Disconnect endpoint
router.post('/disconnect', authenticateToken, disconnectOutlook);

export default router;
