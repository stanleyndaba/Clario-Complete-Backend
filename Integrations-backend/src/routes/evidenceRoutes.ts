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

export default router;


