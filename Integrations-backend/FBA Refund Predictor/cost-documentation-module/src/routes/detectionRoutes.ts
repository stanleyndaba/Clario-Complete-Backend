import { Router, Request, Response } from 'express';
import { DetectionService } from '../detection/services/detectionService';
import { DetectionJobRequest } from '../detection/queue/detectionQueue';
import { z } from 'zod';

const router = Router();

// Validation schemas
const enqueueJobSchema = z.object({
  sellerId: z.string().min(1),
  syncId: z.string().min(1),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional()
});

const getResultsSchema = z.object({
  sellerId: z.string().optional(),
  syncId: z.string().optional(),
  ruleType: z.enum(['LOST_UNITS', 'OVERCHARGED_FEES', 'DAMAGED_STOCK', 'DUPLICATE_CHARGES', 'INVALID_SHIPPING', 'PRICING_DISCREPANCY']).optional(),
  severity: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0)
});

export function createDetectionRoutes(detectionService: DetectionService) {
  // POST /api/detection/jobs - Enqueue manual detection job
  router.post('/jobs', async (req: Request, res: Response) => {
    try {
      const validatedData = enqueueJobSchema.parse(req.body);
      
      const jobRequest: DetectionJobRequest = {
        sellerId: validatedData.sellerId,
        syncId: validatedData.syncId,
        priority: validatedData.priority,
        triggeredAt: new Date()
      };

      const job = await detectionService.enqueueDetectionJob(jobRequest);
      
      res.status(201).json({
        success: true,
        data: {
          jobId: job.id,
          status: job.status,
          priority: job.priority,
          createdAt: job.createdAt
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      } else {
        console.error('Error enqueueing detection job:', error);
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  });

  // GET /api/detection/jobs/:id/status - Get job status
  router.get('/jobs/:id/status', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Job ID is required'
        });
      }

      const job = await detectionService.getJobStatus(id);
      
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found'
        });
      }

      res.json({
        success: true,
        data: {
          id: job.id,
          sellerId: job.sellerId,
          syncId: job.syncId,
          status: job.status,
          priority: job.priority,
          attempts: job.attempts,
          lastError: job.lastError,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt
        }
      });
    } catch (error) {
      console.error('Error getting job status:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // GET /api/detection/results/:syncId - Get detection results by sync ID
  router.get('/results/:syncId', async (req: Request, res: Response) => {
    try {
      const { syncId } = req.params;
      const queryParams = getResultsSchema.parse(req.query);
      
      if (!syncId) {
        return res.status(400).json({
          success: false,
          error: 'Sync ID is required'
        });
      }

      const filter = {
        ...queryParams,
        syncId
      };

      const results = await detectionService.getDetectionResults(filter);
      
      res.json({
        success: true,
        data: {
          results: results.results.map(result => ({
            id: result.id,
            sellerId: result.sellerId,
            syncId: result.syncId,
            ruleType: result.ruleType,
            severity: result.severity,
            score: result.score,
            summary: result.summary,
            evidenceS3Url: result.evidenceS3Url,
            createdAt: result.createdAt,
            detectionJob: result.detectionJob
          })),
          pagination: {
            total: results.total,
            limit: filter.limit,
            offset: filter.offset,
            hasMore: results.hasMore
          }
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      } else {
        console.error('Error getting detection results:', error);
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  });

  // GET /api/detection/results - Get detection results with filters
  router.get('/results', async (req: Request, res: Response) => {
    try {
      const queryParams = getResultsSchema.parse(req.query);
      
      const results = await detectionService.getDetectionResults(queryParams);
      
      res.json({
        success: true,
        data: {
          results: results.results.map(result => ({
            id: result.id,
            sellerId: result.sellerId,
            syncId: result.syncId,
            ruleType: result.ruleType,
            severity: result.severity,
            score: result.score,
            summary: result.summary,
            evidenceS3Url: result.evidenceS3Url,
            createdAt: result.createdAt,
            detectionJob: result.detectionJob
          })),
          pagination: {
            total: results.total,
            limit: queryParams.limit,
            offset: queryParams.offset,
            hasMore: results.hasMore
          }
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      } else {
        console.error('Error getting detection results:', error);
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  });

  // GET /api/detection/stats - Get detection statistics
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const { sellerId } = req.query;
      
      const stats = await detectionService.getDetectionStats(sellerId as string);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting detection stats:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // GET /api/detection/queue/stats - Get queue statistics
  router.get('/queue/stats', async (req: Request, res: Response) => {
    try {
      const queueStats = await detectionService.getQueueStats();
      
      res.json({
        success: true,
        data: queueStats
      });
    } catch (error) {
      console.error('Error getting queue stats:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // POST /api/detection/jobs/:id/retry - Retry failed job
  router.post('/jobs/:id/retry', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Job ID is required'
        });
      }

      const job = await detectionService.retryFailedJob(id);
      
      res.json({
        success: true,
        data: {
          id: job.id,
          status: job.status,
          updatedAt: job.updatedAt
        },
        message: 'Job reset to PENDING status for retry'
      });
    } catch (error) {
      console.error('Error retrying job:', error);
      
      if (error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: error.message
        });
      } else if (error.message.includes('not in FAILED status')) {
        res.status(400).json({
          success: false,
          error: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    }
  });

  // DELETE /api/detection/jobs/:id - Delete detection job
  router.delete('/jobs/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Job ID is required'
        });
      }

      await detectionService.deleteDetectionJob(id);
      
      res.json({
        success: true,
        message: 'Detection job and associated results deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting detection job:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  return router;
}


