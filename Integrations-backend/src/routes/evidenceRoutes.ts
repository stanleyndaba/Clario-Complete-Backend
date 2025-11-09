/**
 * Evidence Routes
 * Handles evidence ingestion and document management
 */

import { Router, Request, Response } from 'express';
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

export default router;


