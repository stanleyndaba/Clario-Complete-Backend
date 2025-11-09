import { Router } from 'express';
import {
  getIntegrationStatus as getProviderStatus,
  reconnectIntegration, 
  disconnectIntegration,
  getAllIntegrations
} from '../controllers/integrationController';
import { getIntegrationStatus } from '../controllers/integrationStatusController';

const router = Router();

// GET /api/v1/integrations/status - Get all integrations status (including evidence providers)
// This must come BEFORE /:provider/status to avoid route conflicts
router.get('/status', getIntegrationStatus);

router.get('/', getAllIntegrations);
router.get('/:provider/status', getProviderStatus);
router.post('/:provider/reconnect', reconnectIntegration);
router.post('/:provider/disconnect', disconnectIntegration);
// Handle GET requests with query params (for frontend compatibility)
router.get('/disconnect', disconnectIntegration);
router.post('/disconnect', disconnectIntegration);

export default router;
