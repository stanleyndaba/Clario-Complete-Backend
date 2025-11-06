import { Router } from 'express';
import {
  getIntegrationStatus,
  reconnectIntegration, 
  disconnectIntegration,
  getAllIntegrations
} from '../controllers/integrationController';

const router = Router();

router.get('/', getAllIntegrations);
// General status endpoint (returns all integrations) - MUST come before /:provider/status
router.get('/status', getAllIntegrations);
// Provider-specific status endpoint
router.get('/:provider/status', getIntegrationStatus);
router.post('/:provider/reconnect', reconnectIntegration);
router.post('/:provider/disconnect', disconnectIntegration);
// Handle GET requests with query params (for frontend compatibility)
router.get('/disconnect', disconnectIntegration);
router.post('/disconnect', disconnectIntegration);

export default router;
