import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    initiateGoogleDriveOAuth,
    handleGoogleDriveCallback,
    getGoogleDriveStatus,
    listGoogleDriveFiles,
    disconnectGoogleDrive
} from '../controllers/googleDriveController';

const router = Router();

// OAuth routes (no authentication required for callback)
router.get('/callback', handleGoogleDriveCallback);

// OAuth initiation - allow X-User-Id header (for testing without full auth)
router.get('/auth', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, initiateGoogleDriveOAuth);

// Alias for /auth/start
router.get('/auth/start', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, initiateGoogleDriveOAuth);

// Connection status - allow X-User-Id header
router.get('/status', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, getGoogleDriveStatus);

// File operations - require authentication
router.get('/files', authenticateToken, listGoogleDriveFiles);

// Disconnect endpoint
router.post('/disconnect', authenticateToken, disconnectGoogleDrive);

export default router;
