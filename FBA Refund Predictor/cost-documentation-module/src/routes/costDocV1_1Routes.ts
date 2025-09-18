import { Router } from 'express';
import { costDocService } from '../services/costDocService';
import { authenticateToken, requireUser, requireRole } from '../middleware/authMiddleware';
import { validateBody, validateQuery } from '../middleware/validation';
import { LockDocParamsSchema, ExportDocsBodySchema, AuditTrailParamsSchema } from '../contracts';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * Document Locking & Immutability
 */

// POST /docs/:id/lock - Lock a document (make it immutable)
router.post('/docs/:id/lock', requireUser, async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.user.id;

    const lockedDocument = await costDocService.lockDocument(id, actor);

    res.json({
      success: true,
      message: 'Document locked successfully',
      data: {
        id: lockedDocument.id,
        status: lockedDocument.status,
        locked_at: lockedDocument.locked_at,
        locked_by: lockedDocument.locked_by
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to lock document'
    });
  }
});

/**
 * Export Functionality
 */

// POST /docs/export - Export selected documents
router.post('/docs/export', requireUser, validateBody(ExportDocsBodySchema), async (req, res) => {
  try {
    const { document_ids, bundle_name, description, format } = req.body;
    const actor = req.user.id;

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

    const exportBundle = await costDocService.exportDocuments(
      document_ids,
      bundle_name,
      description,
      format,
      actor
    );

    res.json({
      success: true,
      message: 'Export bundle created successfully',
      data: exportBundle
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create export bundle'
    });
  }
});

// GET /docs/export/bundles - Get user's export bundles
router.get('/docs/export/bundles', requireUser, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    const bundles = await costDocService.getUserExportBundles(
      userId,
      parseInt(page as string),
      parseInt(limit as string)
    );

    res.json({
      success: true,
      data: bundles
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get export bundles'
    });
  }
});

// GET /docs/export/bundles/:id - Get specific export bundle
router.get('/docs/export/bundles/:id', requireUser, async (req, res) => {
  try {
    const { id } = req.params;
    const bundle = await costDocService.getExportBundle(id);

    if (!bundle) {
      return res.status(404).json({
        success: false,
        error: 'Export bundle not found'
      });
    }

    // Check if user has access to this bundle
    if (bundle.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this export bundle'
      });
    }

    res.json({
      success: true,
      data: bundle
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get export bundle'
    });
  }
});

/**
 * Audit Trail
 */

// GET /docs/:id/audit - Get document audit trail
router.get('/docs/:id/audit', requireUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const auditTrail = await costDocService.getDocumentAuditTrail(
      id,
      parseInt(page as string),
      parseInt(limit as string)
    );

    res.json({
      success: true,
      data: auditTrail
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get audit trail'
    });
  }
});

// GET /docs/audit/summary - Get audit summary statistics (admin only)
router.get('/docs/audit/summary', requireRole('admin'), async (req, res) => {
  try {
    const { auditService } = await import('../services/auditService');
    const summary = await auditService.getAuditSummary();

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get audit summary'
    });
  }
});

/**
 * Sync Cross-Check
 */

// GET /docs/:id/sync-check - Perform sync cross-check for a document
router.get('/docs/:id/sync-check', requireUser, async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.user.id;

    const syncCheck = await costDocService.performSyncCrossCheck(id, actor);

    res.json({
      success: true,
      data: syncCheck
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to perform sync cross-check'
    });
  }
});

// POST /docs/:id/refresh - Refresh document with latest sync state
router.post('/docs/:id/refresh', requireUser, async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.user.id;

    const refreshResult = await costDocService.refreshDocument(id, actor);

    res.json({
      success: true,
      message: refreshResult.success ? 'Document refreshed successfully' : 'Document is already in sync',
      data: refreshResult
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to refresh document'
    });
  }
});

// GET /docs/sync/health - Get sync health metrics (admin only)
router.get('/docs/sync/health', requireRole('admin'), async (req, res) => {
  try {
    const metrics = await costDocService.getSyncHealthMetrics();

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get sync health metrics'
    });
  }
});

// GET /docs/sync/seller/:sellerId - Get sync summary for a specific seller
router.get('/docs/sync/seller/:sellerId', requireUser, async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { syncCrossCheckService } = await import('../services/syncCrossCheckService');
    
    const summary = await syncCrossCheckService.getSellerSyncSummary(sellerId);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get seller sync summary'
    });
  }
});

/**
 * Bulk Operations
 */

// POST /docs/sync-check/bulk - Perform sync cross-check for multiple documents
router.post('/docs/sync-check/bulk', requireUser, async (req, res) => {
  try {
    const { document_ids } = req.body;
    const actor = req.user.id;

    if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'document_ids array is required and must not be empty'
      });
    }

    const { syncCrossCheckService } = await import('../services/syncCrossCheckService');
    const results = await syncCrossCheckService.getBulkSyncCrossCheck(document_ids, actor);

    res.json({
      success: true,
      data: {
        total_documents: results.length,
        results
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to perform bulk sync cross-check'
    });
  }
});

/**
 * Dashboard Integration
 */

// GET /docs/dashboard/summary - Get dashboard summary data
router.get('/docs/dashboard/summary', requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { seller_id } = req.query;

    // Get user's documents summary
    const documentsSummary = await costDocService.getDocumentsBySeller(
      seller_id as string || req.user.seller_id,
      1,
      1000 // Get all for summary
    );

    // Get sync health if seller_id is provided
    let syncHealth = null;
    if (seller_id) {
      const { syncCrossCheckService } = await import('../services/syncCrossCheckService');
      syncHealth = await syncCrossCheckService.getSellerSyncSummary(seller_id as string);
    }

    // Get recent export bundles
    const recentExports = await costDocService.getUserExportBundles(userId, 1, 5);

    const summary = {
      total_documents: documentsSummary.documents.length,
      documents_by_status: documentsSummary.documents.reduce((acc: any, doc: any) => {
        acc[doc.status] = (acc[doc.status] || 0) + 1;
        return acc;
      }, {}),
      recent_exports: recentExports.bundles,
      sync_health: syncHealth
    };

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get dashboard summary'
    });
  }
});

export default router;


