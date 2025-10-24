import { Router } from 'express';
import {
  getIntegrationStatus,
  reconnectIntegration, 
  disconnectIntegration,
  getAllIntegrations,
  connectAmazon,
  amazonCallback,
  amazonSandboxCallback,
  getRecoveries
} from '../controllers/integrationController';

const router = Router();

router.get('/', getAllIntegrations);
router.get('/:provider/status', getIntegrationStatus);
router.post('/:provider/reconnect', reconnectIntegration);
router.post('/:provider/disconnect', disconnectIntegration);

// Step 1 endpoints (Amazon Auth flow + status + recoveries)
router.get('/connect-amazon', connectAmazon);
router.get('/amazon/callback', amazonCallback);
router.post('/amazon/sandbox/callback', amazonSandboxCallback);
router.get('/amazon/recoveries', getRecoveries);

export default router;
