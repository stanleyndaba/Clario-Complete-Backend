/**
 * Consolidated Cost Documentation Routes
 * Routes from cost-documentation-module service merged into integrations-backend
 */

import { Router } from 'express';
import { Request, Response } from 'express';
import logger from '../../utils/logger';
import { exportService } from '../../services/exportService';
import axios from 'axios';

const router = Router();

// Helper to extract user ID from request
function extractUserId(req: Request): string {
  // Try to get from token (if auth middleware is used)
  const token = (req as any).user?.id || (req as any).user?.user_id;
  if (token) return token;
  
  // Try to get from Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // For now, return a default user ID
    // In production, decode JWT and extract user_id
    return 'default-user';
  }
  
  // Try to get from cookies
  const cookieToken = (req as any).cookies?.session_token;
  if (cookieToken) {
    // Decode JWT and extract user_id
    // For now, return default
    return 'default-user';
  }
  
  return 'default-user';
}

// Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'Cost Documentation (Consolidated)',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Export endpoint - POST /api/v1/cost-docs/docs/export
router.post('/docs/export', async (req: Request, res: Response) => {
  try {
    const { document_ids, bundle_name, description, format } = req.body;

    if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'document_ids array is required and must not be empty'
      });
    }

    if (!bundle_name || typeof bundle_name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'bundle_name is required'
      });
    }

    if (!format || !['zip', 'combined_pdf'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'format must be either "zip" or "combined_pdf"'
      });
    }

    const userId = extractUserId(req);

    logger.info('Export request received', {
      document_count: document_ids.length,
      bundle_name,
      format,
      userId
    });

    // Create export bundle using PDF generation service
    const exportResult = await exportService.createExportBundle(
      {
        document_ids,
        bundle_name,
        description,
        format
      },
      userId
    );

    if (exportResult.status === 'failed') {
      return res.status(500).json({
        success: false,
        error: 'Failed to create export bundle'
      });
    }

    res.json({
      success: true,
      message: 'Export bundle created successfully',
      data: exportResult
    });
  } catch (error: any) {
    logger.error('Export error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create export bundle'
    });
  }
});

// Get export bundles
router.get('/docs/export/bundles', async (req: Request, res: Response) => {
  try {
    // TODO: Implement fetching user's export bundles from database
    res.json({
      success: true,
      data: {
        bundles: [],
        total: 0,
        page: 1,
        limit: 20
      }
    });
  } catch (error: any) {
    logger.error('Get export bundles error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get export bundles'
    });
  }
});

// Placeholder routes
router.get('/api/v1/cost-docs', (req: Request, res: Response) => {
  res.json({
    message: 'Cost Documentation API (Consolidated)',
    version: '1.0.0',
    endpoints: {
      documents: '/api/v1/cost-docs/documents',
      generate: '/api/v1/cost-docs/generate',
      search: '/api/v1/cost-docs/search',
      export: '/api/v1/cost-docs/docs/export'
    }
  });
});

export default router;
