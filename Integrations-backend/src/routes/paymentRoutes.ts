import { Router } from 'express';
import { handlePaypalWebhook } from '../controllers/paymentController';

const router = Router();

/**
 * PayPal Webhook Pipeline
 * Mounted at /api/v1/payments
 */
router.post('/webhook', handlePaypalWebhook);

export default router;
