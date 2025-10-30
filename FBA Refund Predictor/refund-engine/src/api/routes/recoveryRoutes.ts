import { Router } from 'express';
import ClaimsController from '../controllers/claimsController';

const router = Router();

// Frontend-compatible recovery endpoints
router.post('/recoveries/:id/submit', ClaimsController.submit);
router.post('/recoveries/:id/resubmit', ClaimsController.resubmit);
router.get('/recoveries/:id/events', ClaimsController.getEvents);
router.post('/recoveries/:id/documents/upload', ClaimsController.uploadEvidence);

export { router };
