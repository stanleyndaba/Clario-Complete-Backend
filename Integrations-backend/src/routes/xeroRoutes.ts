import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { connectEvidenceSource, handleEvidenceSourceCallback } from '../controllers/evidenceSourcesController';
import { disconnectAccountingIntegration, requestAccountingSync } from '../controllers/accountingIntegrationController';

const router = Router();

// OAuth routes
router.get('/callback', handleEvidenceSourceCallback);

// Financial Evidence Connection actions. The controller verifies active
// membership of the explicitly supplied workspace before every operation.
router.post('/sync', requestAccountingSync);
router.post('/disconnect', disconnectAccountingIntegration);

// OAuth initiation
router.get('/auth', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, (req, res) => {
    (req.params as any).provider = 'xero';
    return connectEvidenceSource(req, res);
});

router.get('/auth/start', (req, res, next) => {
    const userId = (req as any).headers['x-user-id'] || (req as any).headers['x-forwarded-user-id'];
    if (userId) {
        (req as any).user = { id: userId };
        return next();
    }
    return authenticateToken(req, res, next);
}, (req, res) => {
    (req.params as any).provider = 'xero';
    return connectEvidenceSource(req, res);
});

export default router;
