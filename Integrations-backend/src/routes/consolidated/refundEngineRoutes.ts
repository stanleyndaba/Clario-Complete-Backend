/**
 * Consolidated Refund Engine Routes
 * Routes from refund-engine service merged into integrations-backend
 */

import { Router } from 'express';
import { Request, Response } from 'express';

const router = Router();

// Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'Refund Engine (Consolidated)',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Placeholder routes - TODO: Import actual routes from refund-engine service
router.get('/api/v1/refund-engine', (req: Request, res: Response) => {
  res.json({
    message: 'Refund Engine API (Consolidated)',
    version: '1.0.0',
    endpoints: {
      claims: '/api/v1/refund-engine/claims',
      ledger: '/api/v1/refund-engine/ledger',
      discrepancies: '/api/v1/refund-engine/discrepancies'
    }
  });
});

// TODO: Add actual route handlers from refund-engine/src/api/routes/

export default router;

