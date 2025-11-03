/**
 * Consolidated Stripe Payments Routes
 * Routes from stripe-payments service merged into integrations-backend
 */

import { Router } from 'express';
import { Request, Response } from 'express';

const router = Router();

// Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'Stripe Payments (Consolidated)',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Placeholder routes - TODO: Import actual routes from stripe-payments service
router.get('/api/v1', (req: Request, res: Response) => {
  res.json({
    message: 'Stripe Payments API (Consolidated)',
    version: '1.0.0',
    endpoints: {
      payouts: '/api/v1/stripe/payouts',
      webhooks: '/api/v1/stripe/webhooks',
      accounts: '/api/v1/stripe/accounts'
    }
  });
});

// TODO: Add actual route handlers from stripe-payments/src/routes/

export default router;

