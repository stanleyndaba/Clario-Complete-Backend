import { Router } from 'express';

const router = Router();

// Mock stripe status endpoint
router.get('/status', (_, res) => {
  res.json({
    success: true,
    connected: false,
    message: 'Stripe not configured - using mock mode'
  });
});

// Mock stripe connect endpoint  
router.post('/connect', (_, res) => {
  res.json({
    success: true,
    message: 'Stripe connection initiated (mock)',
    url: 'https://stripe.com/mock-connect'
  });
});

// Mock stripe webhook endpoint
router.post('/webhook', (_, res) => {
  res.json({
    success: true,
    message: 'Webhook received (mock)'
  });
});

export default router;
