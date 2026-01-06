import { Request, Response } from 'express';
import { CostDocumentationService } from '../services/costDocumentationService';
import { costDocumentationWorker } from '../workers/costDocumentationWorker';
import { logger } from '../utils/logger';
import { AnomalyEvidence } from '../types/costDocumentation';

export class CostDocumentationController {
  private static service = new CostDocumentationService();

  /**
   * Generate cost documentation from evidence JSON (automatic trigger)
   */
  static async generateFromEvidence(req: Request, res: Response): Promise<void> {
    try {
      const evidence: AnomalyEvidence = req.body;

      // Validate evidence
      if (!evidence.anomaly_id || !evidence.type || !evidence.sku) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: anomaly_id, type, sku'
        });
        return;
      }

      // Add job to queue
      const job = await costDocumentationWorker.addJob(evidence, {
        priority: 'normal'
      });

      res.status(202).json({
        success: true,
        message: 'Cost documentation job queued successfully',
        job_id: job.id,
        anomaly_id: evidence.anomaly_id
      });

      logger.info('Cost documentation job queued from API', {
        job_id: job.id,
        anomaly_id: evidence.anomaly_id
      });
    } catch (error) {
      logger.error('Failed to generate cost documentation from evidence', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to queue cost documentation job'
      });
    }
  }

  /**
   * Generate cost documentation manually (manual trigger from dashboard)
   */
  static async generateManual(req: Request, res: Response): Promise<void> {
    try {
      const evidence: AnomalyEvidence = req.body;

      // Validate evidence
      if (!evidence.anomaly_id || !evidence.type || !evidence.sku) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: anomaly_id, type, sku'
        });
        return;
      }

      // Generate documentation immediately
      const result = await CostDocumentationController.service.generateManualDocumentation(evidence);

      res.status(200).json({
        success: true,
        message: 'Cost documentation generated successfully',
        pdf: {
          id: result.id,
          url: result.pdf_url,
          file_size: result.file_size,
          generated_at: result.generated_at
        }
      });

      logger.info('Manual cost documentation generated', {
        pdf_id: result.id,
        anomaly_id: evidence.anomaly_id
      });
    } catch (error) {
      logger.error('Failed to generate manual cost documentation', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to generate cost documentation'
      });
    }
  }

  /**
   * Get cost documentation by anomaly ID
   */
  static async getByAnomalyId(req: Request, res: Response): Promise<void> {
    try {
      const { anomalyId } = req.params;

      const documentation = await CostDocumentationController.service.getDocumentationByAnomalyId(anomalyId);

      if (!documentation) {
        res.status(404).json({
          success: false,
          error: 'Cost documentation not found for this anomaly'
        });
        return;
      }

      res.status(200).json({
        success: true,
        documentation: {
          id: documentation.id,
          url: documentation.pdf_url,
          file_size: documentation.file_size,
          generated_at: documentation.generated_at,
          metadata: documentation.metadata
        }
      });
    } catch (error) {
      logger.error('Failed to get cost documentation by anomaly ID', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve cost documentation'
      });
    }
  }

  /**
   * Get all cost documentation for a seller
   */
  static async getBySellerId(req: Request, res: Response): Promise<void> {
    try {
      const { sellerId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const documentation = await CostDocumentationController.service.getDocumentationBySellerId(sellerId);

      // Simple pagination
      const startIndex = (Number(page) - 1) * Number(limit);
      const endIndex = startIndex + Number(limit);
      const paginatedDocs = documentation.slice(startIndex, endIndex);

      res.status(200).json({
        success: true,
        documentation: paginatedDocs.map(doc => ({
          id: doc.id,
          anomaly_id: doc.anomaly_id,
          url: doc.pdf_url,
          file_size: doc.file_size,
          generated_at: doc.generated_at,
          metadata: doc.metadata
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: documentation.length,
          total_pages: Math.ceil(documentation.length / Number(limit))
        }
      });
    } catch (error) {
      logger.error('Failed to get cost documentation by seller ID', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve cost documentation'
      });
    }
  }

  /**
   * Get queue statistics
   */
  static async getQueueStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await costDocumentationWorker.getQueueStats();

      res.status(200).json({
        success: true,
        queue_stats: stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to get queue statistics', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve queue statistics'
      });
    }
  }

  /**
   * Get job status
   */
  static async getJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;

      const job = await costDocumentationWorker.getJob(jobId);

      if (!job) {
        res.status(404).json({
          success: false,
          error: 'Job not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        job: {
          id: job.id,
          status: await job.getState(),
          progress: job.progress(),
          data: job.data,
          created_at: job.timestamp,
          processed_at: job.processedOn,
          finished_at: job.finishedOn
        }
      });
    } catch (error) {
      logger.error('Failed to get job status', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve job status'
      });
    }
  }

  /**
   * Retry a failed job
   */
  static async retryJob(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;

      await costDocumentationWorker.retryJob(jobId);

      res.status(200).json({
        success: true,
        message: 'Job retry initiated successfully'
      });

      logger.info('Job retry initiated via API', { job_id: jobId });
    } catch (error) {
      logger.error('Failed to retry job', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retry job'
      });
    }
  }

  /**
   * Remove a job from the queue
   */
  static async removeJob(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;

      await costDocumentationWorker.removeJob(jobId);

      res.status(200).json({
        success: true,
        message: 'Job removed from queue successfully'
      });

      logger.info('Job removed from queue via API', { job_id: jobId });
    } catch (error) {
      logger.error('Failed to remove job', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to remove job'
      });
    }
  }

  /**
   * Pause the queue
   */
  static async pauseQueue(req: Request, res: Response): Promise<void> {
    try {
      await costDocumentationWorker.pauseQueue();

      res.status(200).json({
        success: true,
        message: 'Queue paused successfully'
      });

      logger.info('Queue paused via API');
    } catch (error) {
      logger.error('Failed to pause queue', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to pause queue'
      });
    }
  }

  /**
   * Resume the queue
   */
  static async resumeQueue(req: Request, res: Response): Promise<void> {
    try {
      await costDocumentationWorker.resumeQueue();

      res.status(200).json({
        success: true,
        message: 'Queue resumed successfully'
      });

      logger.info('Queue resumed via API');
    } catch (error) {
      logger.error('Failed to resume queue', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to resume queue'
      });
    }
  }

  /**
   * Clear the queue
   */
  static async clearQueue(req: Request, res: Response): Promise<void> {
    try {
      await costDocumentationWorker.clearQueue();

      res.status(200).json({
        success: true,
        message: 'Queue cleared successfully'
      });

      logger.info('Queue cleared via API');
    } catch (error) {
      logger.error('Failed to clear queue', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to clear queue'
      });
    }
  }
}








