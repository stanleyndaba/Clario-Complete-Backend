import { Router } from 'express';
import {
  startSync,
  getSyncStatus,
  getSyncHistory,
  forceSync
} from '../controllers/syncController';

const router = Router();

router.post('/start', startSync);
router.get('/status', getSyncStatus);
router.get('/history', getSyncHistory);
router.post('/force', forceSync);

export default router;
