import { Router, Request, Response } from 'express';
import { costDocService } from '../services/costDocService';
import { authenticateToken, requireRole, requireUser } from '../middleware/auth';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * POST /api/v1/cost-documentation/generate/manual
 * Generate PDF documentation synchronously
 */
router.post('/generate/manual', requireUser, async (req: Request, res: Response) => {
  try {
    const { evidence, template_version = '1.0' } = req.body;

    if (!evidence || !evidence.seller_id || !evidence.anomaly_id) {
      return res.status(400).json({
        error: 'Missing required fields: evidence with seller_id and anomaly_id'
      });
    }

    const generatedPDF = await costDocService.generateManualDocumentation(evidence, template_version);

    res.status(200).json({
      success: true,
      data: generatedPDF,
      message: 'PDF generated successfully'
    });

  } catch (error) {
    console.error('Manual PDF generation failed:', error);
    res.status(500).json({
      error: 'PDF generation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/v1/cost-documentation/generate/auto
 * Enqueue automatic documentation job
 */
router.post('/generate/auto', requireUser, async (req: Request, res: Response) => {
  try {
    const { evidence, template_version = '1.0', priority = 'medium' } = req.body;

    if (!evidence || !evidence.seller_id || !evidence.anomaly_id) {
      return res.status(400).json({
        error: 'Missing required fields: evidence with seller_id and anomaly_id'
      });
    }

    const result = await costDocService.enqueueDocumentationJob(evidence, template_version, priority);

    res.status(202).json({
      success: true,
      data: result,
      message: 'Documentation job enqueued successfully'
    });

  } catch (error) {
    console.error('Auto job enqueue failed:', error);
    res.status(500).json({
      error: 'Job enqueue failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/v1/cost-documentation/job/:jobId
 * Get job status and signed URL when ready
 */
router.get('/job/:jobId', requireUser, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await costDocService.getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found'
      });
    }

    res.status(200).json({
      success: true,
      data: job
    });

  } catch (error) {
    console.error('Job status retrieval failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve job status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/v1/cost-documentation/anomaly/:anomalyId
 * Get documentation by anomaly ID
 */
router.get('/anomaly/:anomalyId', requireUser, async (req: Request, res: Response) => {
  try {
    const { anomalyId } = req.params;
    const documentation = await costDocService.getDocumentationByAnomalyId(anomalyId);

    if (!documentation) {
      return res.status(404).json({
        error: 'Documentation not found for this anomaly'
      });
    }

    res.status(200).json({
      success: true,
      data: documentation
    });

  } catch (error) {
    console.error('Documentation retrieval failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve documentation',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/v1/cost-documentation/seller/:sellerId
 * Get all documentation for a seller
 */
router.get('/seller/:sellerId', requireUser, async (req: Request, res: Response) => {
  try {
    const { sellerId } = req.params;
    const documentation = await costDocService.getDocumentationBySellerId(sellerId);

    res.status(200).json({
      success: true,
      data: documentation,
      count: documentation.length
    });

  } catch (error) {
    console.error('Seller documentation retrieval failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve seller documentation',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Admin/Agent only routes
/**
 * GET /api/v1/cost-documentation/queue/stats
 * Get queue statistics
 */
router.get('/queue/stats', requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const stats = await costDocService.getQueueStats();

    res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Queue stats retrieval failed:', error);
    res.status(500).json({
      error: 'Failed to retrieve queue statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/v1/cost-documentation/queue/job/:jobId/retry
 * Retry a failed job
 */
router.post('/queue/job/:jobId/retry', requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const success = await costDocService.retryJob(jobId);

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Job retried successfully'
      });
    } else {
      res.status(400).json({
        error: 'Job cannot be retried'
      });
    }

  } catch (error) {
    console.error('Job retry failed:', error);
    res.status(500).json({
      error: 'Failed to retry job',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/v1/cost-documentation/queue/job/:jobId
 * Remove a job from the queue
 */
router.delete('/queue/job/:jobId', requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const success = await costDocService.removeJob(jobId);

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Job removed successfully'
      });
    } else {
      res.status(404).json({
        error: 'Job not found'
      });
    }

  } catch (error) {
    console.error('Job removal failed:', error);
    res.status(500).json({
      error: 'Failed to remove job',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/v1/cost-documentation/queue/pause
 * Pause queue processing
 */
router.post('/queue/pause', requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    await costDocService.pauseQueue();

    res.status(200).json({
      success: true,
      message: 'Queue processing paused'
    });

  } catch (error) {
    console.error('Queue pause failed:', error);
    res.status(500).json({
      error: 'Failed to pause queue',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/v1/cost-documentation/queue/resume
 * Resume queue processing
 */
router.post('/queue/resume', requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    await costDocService.resumeQueue();

    res.status(200).json({
      success: true,
      message: 'Queue processing resumed'
    });

  } catch (error) {
    console.error('Queue resume failed:', error);
    res.status(500).json({
      error: 'Failed to resume queue',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/v1/cost-documentation/queue/clear
 * Clear all jobs from the queue
 */
router.delete('/queue/clear', requireRole(['admin', 'agent']), async (req: Request, res: Response) => {
  try {
    const count = await costDocService.clearQueue();

    res.status(200).json({
      success: true,
      message: `Cleared ${count} jobs from queue`,
      count
    });

  } catch (error) {
    console.error('Queue clear failed:', error);
    res.status(500).json({
      error: 'Failed to clear queue',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;





