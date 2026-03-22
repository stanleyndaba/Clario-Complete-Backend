import express from 'express';
import { createSupportRequest, listSupportRequests } from '../controllers/supportController';

const router = express.Router();

router.get('/requests', listSupportRequests);
router.post('/requests', createSupportRequest);

export default router;
