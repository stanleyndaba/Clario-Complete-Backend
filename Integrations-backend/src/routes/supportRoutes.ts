import express from 'express';
import { createPublicSupportContact, createSupportRequest, listSupportRequests } from '../controllers/supportController';

const router = express.Router();

router.post('/public-contact', createPublicSupportContact);
router.get('/requests', listSupportRequests);
router.post('/requests', createSupportRequest);

export default router;
