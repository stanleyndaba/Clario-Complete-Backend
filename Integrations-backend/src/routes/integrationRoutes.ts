import { Router } from 'express';
import {
  getIntegrationStatus,
  reconnectIntegration, 
  disconnectIntegration,
  getAllIntegrations
} from '../controllers/integrationController';

const router = Router();

router.get('/', getAllIntegrations);
router.get('/:provider/status', getIntegrationStatus);
router.post('/:provider/reconnect', reconnectIntegration);
router.post('/:provider/disconnect', disconnectIntegration);

export default router;
