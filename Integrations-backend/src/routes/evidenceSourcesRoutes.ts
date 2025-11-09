/**
 * Evidence Sources Routes
 * Handles OAuth connection for evidence providers
 */

import { Router } from 'express';
import { connectEvidenceSource, handleEvidenceSourceCallback } from '../controllers/evidenceSourcesController';

const router = Router();

/**
 * POST /api/v1/integrations/{provider}/connect
 * Generate OAuth URL for evidence source connection
 * Providers: gmail, outlook, gdrive, dropbox
 */
router.post('/:provider/connect', connectEvidenceSource);

/**
 * GET /api/v1/integrations/{provider}/callback
 * Handle OAuth callback from provider
 */
router.get('/:provider/callback', handleEvidenceSourceCallback);

export default router;

