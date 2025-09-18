import { Router } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import { integrationController } from '../controllers/integrationController';
import { integrationsApiController } from '../controllers/integrationsApiController';
import { createUserRateLimit } from '../middleware/rateLimit';
import { getRedisClient } from '../utils/redisClient';
import evidenceIngestionService from '../services/evidenceIngestionService';

const router = Router();

// Apply authentication to all routes
// Public integrations API endpoints (for auth-service orchestration)
// If needed, protect with internal API key middleware here
// router.use(internalApiKeyMiddleware)

// Amazon OAuth processor
router.post('/amazon/oauth/process', integrationsApiController.processAmazonOAuth);

// Protected routes
router.use(authenticateToken);

// Get integration status for a specific provider
router.get('/status/:provider', integrationController.getIntegrationStatus);

// Reconnect integration for a specific provider (with rate limiting)
router.patch('/reconnect/:provider', async (req, res, next) => {
  try {
    const redisClient = await getRedisClient();
    const rateLimit = createUserRateLimit(redisClient, 'auth', 60, 30);
    return rateLimit(req, res, next);
  } catch (error) {
    // If Redis is unavailable, continue without rate limiting
    next();
  }
}, integrationController.reconnectIntegration);

// Get all integration statuses for the authenticated user
router.get('/status', integrationController.getAllIntegrationStatuses);

// POST /api/v1/integrations/evidence/sources
router.post('/evidence/sources', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { provider, displayName, metadata } = req.body || {};
    if (!provider) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'provider is required' } });
    const id = await evidenceIngestionService.registerSource(userId, provider, displayName, metadata);
    return res.json({ success: true, sourceId: id });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// POST /api/v1/integrations/evidence/documents (ingest a parsed document)
router.post('/evidence/documents', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { sourceId, document } = req.body || {};
    if (!document?.doc_type) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'document.doc_type is required' } });
    const id = await evidenceIngestionService.ingestParsedDocument(userId, sourceId || null, document);
    return res.json({ success: true, documentId: id });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

export default router;
