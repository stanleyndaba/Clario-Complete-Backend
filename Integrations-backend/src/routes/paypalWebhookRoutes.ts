import { Router } from 'express';
import { handlePaypalWebhook } from '../controllers/paymentController';

const router = Router();

router.post('/paypal', handlePaypalWebhook);

export default router;
