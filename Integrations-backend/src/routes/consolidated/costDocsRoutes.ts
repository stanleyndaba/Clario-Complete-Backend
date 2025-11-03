/**
 * Consolidated Cost Documentation Routes
 * Routes from cost-documentation-module service merged into integrations-backend
 */

import { Router } from 'express';
import { Request, Response } from 'express';

const router = Router();

// Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'Cost Documentation (Consolidated)',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Placeholder routes - TODO: Import actual routes from cost-documentation-module service
router.get('/api/v1/cost-docs', (req: Request, res: Response) => {
  res.json({
    message: 'Cost Documentation API (Consolidated)',
    version: '1.0.0',
    endpoints: {
      documents: '/api/v1/cost-docs/documents',
      generate: '/api/v1/cost-docs/generate',
      search: '/api/v1/cost-docs/search'
    }
  });
});

// TODO: Add actual route handlers from cost-documentation-module/src/routes/

export default router;

