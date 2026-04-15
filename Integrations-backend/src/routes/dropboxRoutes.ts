import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    initiateDropboxOAuth,
    getDropboxStatus,
    listDropboxFiles,
    disconnectDropbox
} from '../controllers/dropboxController';
import { handleEvidenceSourceCallback } from '../controllers/evidenceSourcesController';

const router = Router();

// OAuth routes (no authentication required for callback)
// Keep Dropbox on the same durable evidence_sources persistence path as Gmail/GDrive.
router.get('/callback', handleEvidenceSourceCallback);

// OAuth initiation - allow X-User-Id header (for testing without full auth)
router.get('/auth', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, initiateDropboxOAuth);

// Alias for /auth/start
router.get('/auth/start', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, initiateDropboxOAuth);

// Connection status - allow X-User-Id header
router.get('/status', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, getDropboxStatus);

// File operations - require authentication
router.get('/files', authenticateToken, listDropboxFiles);

// Disconnect endpoint
router.post('/disconnect', authenticateToken, disconnectDropbox);

export default router;
