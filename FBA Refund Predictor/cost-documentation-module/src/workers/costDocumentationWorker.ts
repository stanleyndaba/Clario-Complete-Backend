import Bull from 'bull';
import { logger } from '../utils/logger';
import { CostDocumentationService } from '../services/costDocumentationService';
import { AnomalyEvidence } from '../types/costDocumentation';

export class CostDocumentationWorker {
  private queue: Bull.Queue;
  private service: CostDocumentationService;
  private isProcessing = false;

  constructor() {
    this.queue = new Bull('cost-documentation-queue', {
      redis: {
        host: process.env['REDIS_HOST'] || 'localhost',
        port: parseInt(process.env['REDIS_PORT'] || '6379'),
        password: process.env['REDIS_PASSWORD'],
        db: parseInt(process.env['REDIS_DB'] || '0')
      }
    });

    this.service = new CostDocumentationService();

    this.setupQueueHandlers();
    this.setupErrorHandling();
  }

  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    try {
      await this.service.initialize();
      logger.info('Cost Documentation Worker initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Cost Documentation Worker', { error });
      throw error;
    }
  }

  /**
   * Setup queue event handlers
   */
  private setupQueueHandlers(): void {
    // Process jobs
    this.queue.process(async (job: Bull.Job) => {
      try {
        logger.info('Processing cost documentation job', { 
          job_id: job.id, 
          data: job.data 
        });

        const evidence: AnomalyEvidence = job.data.evidence;
        const result = await this.service.processDocumentationJob(job.id.toString());

        logger.info('Cost documentation job completed successfully', { 
          job_id: job.id, 
          pdf_id: result.id 
        });

        return result;
      } catch (error) {
        logger.error('Failed to process cost documentation job', { 
          error, 
          job_id: job.id 
        });
        throw error;
      }
    });

    // Job completed
    this.queue.on('completed', (job: Bull.Job, result: any) => {
      logger.info('Cost documentation job completed', { 
        job_id: job.id, 
        result_id: result.id 
      });
    });

    // Job failed
    this.queue.on('failed', (job: Bull.Job, error: Error) => {
      logger.error('Cost documentation job failed', { 
        job_id: job.id, 
        error: error.message 
      });
    });

    // Job stalled
    this.queue.on('stalled', (job: Bull.Job) => {
      logger.warn('Cost documentation job stalled', { job_id: job.id });
    });
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    this.queue.on('error', (error: Error) => {
      logger.error('Cost documentation queue error', { error });
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully');
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully');
      await this.shutdown();
      process.exit(0);
    });
  }

  /**
   * Add a job to the queue
   */
  async addJob(evidence: AnomalyEvidence, options: {
    priority?: 'low' | 'normal' | 'high' | 'critical';
    delay?: number;
    attempts?: number;
  } = {}): Promise<Bull.Job> {
    try {
      const job = await this.queue.add('cost-documentation', { evidence }, {
        priority: this.getPriorityNumber(options.priority || 'normal'),
        delay: options.delay || 0,
        attempts: options.attempts || 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      });

      logger.info('Cost documentation job added to queue', { 
        job_id: job.id, 
        anomaly_id: evidence.anomaly_id 
      });

      return job;
    } catch (error) {
      logger.error('Failed to add cost documentation job to queue', { error, evidence });
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaiting(),
        this.queue.getActive(),
        this.queue.getCompleted(),
        this.queue.getFailed(),
        this.queue.getDelayed()
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length
      };
    } catch (error) {
      logger.error('Failed to get queue statistics', { error });
      throw error;
    }
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Bull.Job | null> {
    try {
      return await this.queue.getJob(jobId);
    } catch (error) {
      logger.error('Failed to get job', { error, job_id: jobId });
      return null;
    }
  }

  /**
   * Get all jobs with status
   */
  async getJobs(status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'): Promise<Bull.Job[]> {
    try {
      switch (status) {
        case 'waiting':
          return await this.queue.getWaiting();
        case 'active':
          return await this.queue.getActive();
        case 'completed':
          return await this.queue.getCompleted();
        case 'failed':
          return await this.queue.getFailed();
        case 'delayed':
          return await this.queue.getDelayed();
        default:
          return [];
      }
    } catch (error) {
      logger.error('Failed to get jobs', { error, status });
      return [];
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.retry();
        logger.info('Job retry initiated', { job_id: jobId });
      }
    } catch (error) {
      logger.error('Failed to retry job', { error, job_id: jobId });
      throw error;
    }
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(jobId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.remove();
        logger.info('Job removed from queue', { job_id: jobId });
      }
    } catch (error) {
      logger.error('Failed to remove job', { error, job_id: jobId });
      throw error;
    }
  }

  /**
   * Clear the queue
   */
  async clearQueue(): Promise<void> {
    try {
      await this.queue.empty();
      logger.info('Queue cleared');
    } catch (error) {
      logger.error('Failed to clear queue', { error });
      throw error;
    }
  }

  /**
   * Pause the queue
   */
  async pauseQueue(): Promise<void> {
    try {
      await this.queue.pause();
      this.isProcessing = false;
      logger.info('Queue paused');
    } catch (error) {
      logger.error('Failed to pause queue', { error });
      throw error;
    }
  }

  /**
   * Resume the queue
   */
  async resumeQueue(): Promise<void> {
    try {
      await this.queue.resume();
      this.isProcessing = true;
      logger.info('Queue resumed');
    } catch (error) {
      logger.error('Failed to resume queue', { error });
      throw error;
    }
  }

  /**
   * Convert priority string to number for Bull
   */
  private getPriorityNumber(priority: 'low' | 'normal' | 'high' | 'critical'): number {
    switch (priority) {
      case 'low':
        return 10;
      case 'normal':
        return 5;
      case 'high':
        return 1;
      case 'critical':
        return 0;
      default:
        return 5;
    }
  }

  /**
   * Shutdown the worker gracefully
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('Shutting down Cost Documentation Worker');
      
      // Close the queue
      await this.queue.close();
      
      // Cleanup the service
      await this.service.cleanup();
      
      logger.info('Cost Documentation Worker shut down successfully');
    } catch (error) {
      logger.error('Error during shutdown', { error });
    }
  }
}

// Export singleton instance
export const costDocumentationWorker = new CostDocumentationWorker();

// Auto-initialize when imported
costDocumentationWorker.initialize().catch((error) => {
  logger.error('Failed to auto-initialize Cost Documentation Worker', { error });
});
