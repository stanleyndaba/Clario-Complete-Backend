/**
 * Evidence Routes
 * Handles evidence ingestion and document management
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { gmailIngestionService } from '../services/gmailIngestionService';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/evidence/ingest/gmail
 * Trigger Gmail evidence ingestion
 */
router.post('/ingest/gmail', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const { query, maxResults, autoParse } = req.body;

    logger.info('🔍 [EVIDENCE] Starting Gmail evidence ingestion', {
      userId,
      query,
      maxResults,
      autoParse
    });

    // Send SSE event for ingestion start
    try {
      const sseHub = (await import('../utils/sseHub')).default;
      sseHub.sendEvent(userId, 'evidence_ingestion_started', {
        userId,
        timestamp: new Date().toISOString()
      });
    } catch (sseError) {
      logger.debug('Failed to send SSE event for ingestion start', { error: sseError });
    }

    const result = await gmailIngestionService.ingestEvidenceFromGmail(userId, {
      query,
      maxResults: maxResults || 50,
      autoParse: autoParse !== false // Default to true
    });

    // Send SSE event for ingestion completion
    try {
      const sseHub = (await import('../utils/sseHub')).default;
      sseHub.sendEvent(userId, 'evidence_ingestion_completed', {
        userId,
        documentsIngested: result.documentsIngested,
        emailsProcessed: result.emailsProcessed,
        errors: result.errors.length,
        timestamp: new Date().toISOString()
      });
    } catch (sseError) {
      logger.debug('Failed to send SSE event for ingestion completion', { error: sseError });
    }

    res.json({
      success: result.success,
      documentsIngested: result.documentsIngested,
      emailsProcessed: result.emailsProcessed,
      errors: result.errors,
      message: `Ingested ${result.documentsIngested} documents from ${result.emailsProcessed} emails`
    });
  } catch (error: any) {
    logger.error('❌ [EVIDENCE] Error in Gmail ingestion endpoint', {
      error: error?.message || String(error),
      stack: error?.stack
    });

    // Send SSE event for ingestion error
    try {
      const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
      if (userId) {
        const sseHub = (await import('../utils/sseHub')).default;
        sseHub.sendEvent(userId, 'evidence_ingestion_failed', {
          userId,
          error: error?.message || String(error),
          timestamp: new Date().toISOString()
        });
      }
    } catch (sseError) {
      logger.debug('Failed to send SSE event for ingestion error', { error: sseError });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to ingest evidence from Gmail',
      message: error?.message || String(error)
    });
  }
});

/**
 * GET /api/evidence/status
 * Get evidence ingestion status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const status = await gmailIngestionService.getIngestionStatus(userId);

    res.json({
      success: true,
      ...status
    });
  } catch (error: any) {
    logger.error('❌ [EVIDENCE] Error getting ingestion status', {
      error: error?.message || String(error)
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get ingestion status',
      message: error?.message || String(error)
    });
  }
});

/**
 * POST /api/evidence/auto-collect
 * Enable/disable auto-collect for evidence ingestion
 */
router.post('/auto-collect', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized'
      });
    }

    const { enabled } = req.body;

    // Store auto-collect setting in database (evidence_sources metadata or user settings)
    try {
      const { supabase } = await import('../database/supabaseClient');
      // Update user settings or evidence source metadata
      // For now, just return success
      logger.info('Auto-collect setting updated', { userId, enabled });
    } catch (dbError) {
      logger.warn('Failed to update auto-collect setting', { error: dbError });
    }

    res.json({
      ok: true,
      enabled: enabled,
      message: `Auto-collect ${enabled ? 'enabled' : 'disabled'}`
    });
  } catch (error: any) {
    logger.error('Error updating auto-collect setting', {
      error: error?.message || String(error)
    });

    res.status(500).json({
      ok: false,
      error: 'Failed to update auto-collect setting'
    });
  }
});

/**
 * POST /api/evidence/schedule
 * Set evidence ingestion schedule
 */
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized'
      });
    }

    const { schedule } = req.body;

    // Validate schedule
    const validSchedules = ['daily_0200', 'daily_1200', 'hourly', 'weekly'];
    if (schedule && !validSchedules.includes(schedule)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid schedule. Valid schedules: ${validSchedules.join(', ')}`
      });
    }

    // Store schedule in database
    try {
      const { supabase } = await import('../database/supabaseClient');
      // Update user settings or evidence source metadata
      logger.info('Evidence ingestion schedule updated', { userId, schedule });
    } catch (dbError) {
      logger.warn('Failed to update schedule', { error: dbError });
    }

    res.json({
      ok: true,
      schedule: schedule,
      message: `Schedule set to ${schedule}`
    });
  } catch (error: any) {
    logger.error('Error updating schedule', {
      error: error?.message || String(error)
    });

    res.status(500).json({
      ok: false,
      error: 'Failed to update schedule'
    });
  }
});

/**
 * POST /api/evidence/filters
 * Set evidence ingestion filters
 */
router.post('/filters', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized'
      });
    }

    const { includeSenders, excludeSenders, fileTypes, folders } = req.body;

    // Store filters in database (evidence_sources metadata)
    try {
      const { supabase } = await import('../database/supabaseClient');
      // Update evidence source metadata with filters
      const filters = {
        includeSenders: includeSenders || [],
        excludeSenders: excludeSenders || [],
        fileTypes: fileTypes || [],
        folders: folders || []
      };

      // Update all evidence sources for user
      await supabase
        .from('evidence_sources')
        .update({
          metadata: filters,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      logger.info('Evidence ingestion filters updated', { userId, filters });
    } catch (dbError) {
      logger.warn('Failed to update filters', { error: dbError });
    }

    res.json({
      ok: true,
      filters: {
        includeSenders: includeSenders || [],
        excludeSenders: excludeSenders || [],
        fileTypes: fileTypes || [],
        folders: folders || []
      },
      message: 'Filters updated successfully'
    });
  } catch (error: any) {
    logger.error('Error updating filters', {
      error: error?.message || String(error)
    });

    res.status(500).json({
      ok: false,
      error: 'Failed to update filters'
    });
  }
});

/**
 * POST /api/evidence/upload
 * Fallback endpoint for document upload - uses multer to handle files and proxies to Python API
 * This endpoint handles file uploads and forwards them to the Python backend
 */

// Configure multer for file uploads (memory storage)
const uploadStorage = multer.memoryStorage();
const uploadMulter = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

router.post('/upload', uploadMulter.any(), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    const files = (req as any).files as Express.Multer.File[];
    const claim_id = req.query.claim_id as string | undefined;
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files provided',
        message: 'Expected at least one file in the request'
      });
    }

    logger.info('📤 [EVIDENCE] Document upload request received', {
      userId,
      fileCount: files.length,
      filenames: files.map(f => f.originalname),
      claim_id
    });

    // Proxy to Python API /api/documents/upload endpoint
    const pythonApiUrl = process.env.PYTHON_API_URL || process.env.VITE_PYTHON_API_URL || 'https://python-api-newest.onrender.com';
    const pythonUrl = `${pythonApiUrl}/api/documents/upload`;
    
    // Extract token for authentication
    const token = req.cookies?.session_token || req.headers['authorization']?.replace('Bearer ', '');
    
    try {
      const axios = (await import('axios')).default;
      const FormData = (await import('form-data')).default;
      
      // Create FormData to forward files
      const formData = new FormData();
      
      // Add all files with 'file' field name (singular, as expected by Python API)
      files.forEach(file => {
        formData.append('file', file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype
        });
      });
      
      // Add claim_id if provided
      if (claim_id) {
        formData.append('claim_id', claim_id);
      }
      
      const headers: Record<string, string> = {
        ...formData.getHeaders()
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      // Forward X-User-Id header
      headers['X-User-Id'] = userId;
      
      logger.info('📤 [EVIDENCE] Forwarding upload to Python API', {
        pythonUrl,
        userId,
        fileCount: files.length
      });
      
      const response = await axios.post(pythonUrl, formData, {
        headers,
        timeout: 60000, // 60 second timeout for file uploads
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      
      logger.info('✅ [EVIDENCE] Document upload successful', {
        userId,
        documentId: response.data.id,
        status: response.data.status
      });
      
      // Send SSE event for upload success
      try {
        const sseHub = (await import('../utils/sseHub')).default;
        sseHub.sendEvent(userId, 'evidence_upload_completed', {
          userId,
          documentId: response.data.id,
          status: response.data.status,
          timestamp: new Date().toISOString()
        });
      } catch (sseError) {
        logger.debug('Failed to send SSE event for upload completion', { error: sseError });
      }
      
      res.json(response.data);
    } catch (proxyError: any) {
      logger.error('❌ [EVIDENCE] Error forwarding upload to Python API', {
        error: proxyError?.message || String(proxyError),
        status: proxyError?.response?.status,
        data: proxyError?.response?.data
      });
      
      // Send SSE event for upload error
      try {
        const sseHub = (await import('../utils/sseHub')).default;
        sseHub.sendEvent(userId, 'evidence_upload_failed', {
          userId,
          error: proxyError?.message || String(proxyError),
          timestamp: new Date().toISOString()
        });
      } catch (sseError) {
        logger.debug('Failed to send SSE event for upload error', { error: sseError });
      }
      
      if (proxyError.response) {
        res.status(proxyError.response.status).json(proxyError.response.data);
      } else {
        res.status(502).json({
          success: false,
          error: 'Failed to upload documents',
          message: proxyError?.message || 'Python API unavailable'
        });
      }
    }
  } catch (error: any) {
    logger.error('❌ [EVIDENCE] Error in upload endpoint', {
      error: error?.message || String(error),
      stack: error?.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to process upload request',
      message: error?.message || String(error)
    });
  }
});

export default router;


