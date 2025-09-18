import { Request, Response } from 'express';
import { DetectionService } from '../services/detectionService';
import { logger } from '../utils/logger';

export class DetectionController {
  private detectionService: DetectionService;

  constructor(detectionService: DetectionService) {
    this.detectionService = detectionService;
  }

  /**
   * Enqueue a detection job for a claim
   */
  async enqueueDetectionJob(req: Request, res: Response): Promise<void> {
    try {
      const { claimId, priority = 'MEDIUM' } = req.body;
      const userId = req.user?.id; // Assuming auth middleware sets this

      if (!claimId) {
        res.status(400).json({ error: 'claimId is required' });
        return;
      }

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const job = await this.detectionService.enqueueDetectionJob(claimId, userId, priority);

      res.status(201).json({
        message: 'Detection job enqueued successfully',
        job: {
          id: job.id,
          claimId: job.claimId,
          status: job.status,
          priority: job.priority,
          createdAt: job.createdAt
        }
      });

      logger.info('Detection job enqueued via API', { jobId: job.id, claimId, userId, priority });
    } catch (error) {
      logger.error('Failed to enqueue detection job via API', { error, body: req.body });
      res.status(500).json({ error: 'Failed to enqueue detection job' });
    }
  }

  /**
   * Get detection results for a claim
   */
  async getDetectionResults(req: Request, res: Response): Promise<void> {
    try {
      const { claimId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const results = await this.detectionService.getDetectionResults(claimId);

      res.status(200).json({
        claimId,
        results: results.map(result => ({
          id: result.id,
          anomalyType: result.anomalyType,
          severity: result.severity,
          confidence: result.confidence,
          thresholdValue: result.thresholdValue,
          actualValue: result.actualValue,
          evidenceUrl: result.evidenceUrl,
          createdAt: result.createdAt
        }))
      });
    } catch (error) {
      logger.error('Failed to get detection results', { error, params: req.params });
      res.status(500).json({ error: 'Failed to get detection results' });
    }
  }

  /**
   * Get detection statistics for a user
   */
  async getDetectionStatistics(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const stats = await this.detectionService.getDetectionStatistics(userId);

      res.status(200).json({
        userId,
        statistics: stats
      });
    } catch (error) {
      logger.error('Failed to get detection statistics', { error, userId: req.user?.id });
      res.status(500).json({ error: 'Failed to get detection statistics' });
    }
  }

  /**
   * Start the detection worker
   */
  async startDetectionWorker(req: Request, res: Response): Promise<void> {
    try {
      const { intervalMs = 5000 } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      // Check if user has admin role
      if (req.user?.role !== 'admin') {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      this.detectionService.startDetectionWorker(intervalMs);

      res.status(200).json({
        message: 'Detection worker started successfully',
        intervalMs
      });

      logger.info('Detection worker started via API', { userId, intervalMs });
    } catch (error) {
      logger.error('Failed to start detection worker', { error, body: req.body });
      res.status(500).json({ error: 'Failed to start detection worker' });
    }
  }

  /**
   * Stop the detection worker
   */
  async stopDetectionWorker(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      // Check if user has admin role
      if (req.user?.role !== 'admin') {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      this.detectionService.stopDetectionWorker();

      res.status(200).json({
        message: 'Detection worker stopped successfully'
      });

      logger.info('Detection worker stopped via API', { userId });
    } catch (error) {
      logger.error('Failed to stop detection worker', { error });
      res.status(500).json({ error: 'Failed to stop detection worker' });
    }
  }

  /**
   * Get detection job status
   */
  async getDetectionJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      // This would require extending the DetectionService to get job by ID
      // For now, return a placeholder response
      res.status(200).json({
        message: 'Job status endpoint - implementation pending',
        jobId
      });
    } catch (error) {
      logger.error('Failed to get detection job status', { error, params: req.params });
      res.status(500).json({ error: 'Failed to get detection job status' });
    }
  }

  /**
   * Health check for detection service
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json({
        service: 'detection',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    } catch (error) {
      logger.error('Detection service health check failed', { error });
      res.status(500).json({
        service: 'detection',
        status: 'unhealthy',
        error: 'Health check failed'
      });
    }
  }
}


