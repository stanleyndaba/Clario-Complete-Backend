import Bull from 'bull';
import { PDFRenderer } from '../services/pdfRenderer';
import { CostDocumentationService } from '../services/costDocService';
import { computeEvidenceSha256 } from '../utils/canonicalize';

export interface WorkerJob {
  id: string;
  seller_id: string;
  anomaly_id: string;
  template_version: string;
  evidence: any;
  priority: 'low' | 'medium' | 'high';
}

export interface JobResult {
  success: boolean;
  s3Key?: string;
  s3Url?: string;
  error?: string;
}

export class CostDocumentationWorker {
  private queue: Bull.Queue;
  private pdfRenderer: PDFRenderer;
  private costDocService: CostDocumentationService;
  private isInitialized: boolean = false;

  constructor() {
    const queueName = 'cost-documentation';
    const redisConfig = {
      host: process.env['REDIS_HOST'] || 'localhost',
      port: parseInt(process.env['REDIS_PORT'] || '6379'),
      password: process.env['REDIS_PASSWORD'],
      db: parseInt(process.env['REDIS_DB'] || '0')
    };

    this.queue = new Bull(queueName, {
      redis: redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    });

    this.pdfRenderer = new PDFRenderer();
    this.costDocService = new CostDocumentationService();
  }

  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize PDF renderer
      await this.pdfRenderer.initialize();
      
      // Set up queue event handlers
      this.setupQueueHandlers();
      
      // Set up job processor
      this.setupJobProcessor();
      
      this.isInitialized = true;
      console.log('Cost Documentation Worker initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Cost Documentation Worker:', error);
      throw error;
    }
  }

  /**
   * Set up queue event handlers
   */
  private setupQueueHandlers(): void {
    this.queue.on('error', (error: Error) => {
      console.error('Queue error:', error);
    });

    this.queue.on('failed', (job: Bull.Job, error: Error) => {
      console.error(`Job ${job.id} failed:`, error);
      this.handleJobFailure(job, error);
    });

    this.queue.on('completed', (job: Bull.Job, result: any) => {
      console.log(`Job ${job.id} completed successfully`);
      this.handleJobCompletion(job, result);
    });

    this.queue.on('stalled', (job: Bull.Job) => {
      console.warn(`Job ${job.id} stalled, retrying...`);
      job.retry();
    });

    this.queue.on('waiting', (job: Bull.Job) => {
      console.log(`Job ${job.id} waiting to be processed`);
    });

    this.queue.on('active', (job: Bull.Job) => {
      console.log(`Job ${job.id} started processing`);
      this.handleJobStart(job);
    });
  }

  /**
   * Set up job processor
   */
  private setupJobProcessor(): void {
    const concurrency = parseInt(process.env.QUEUE_MAX_CONCURRENCY || '3');
    
    this.queue.process(concurrency, async (job: Bull.Job) => {
      return await this.processJob(job);
    });
  }

  /**
   * Process a single job
   */
  private async processJob(job: Bull.Job): Promise<JobResult> {
    const jobData: WorkerJob = job.data;
    
    try {
      console.log(`Processing job ${job.id} for anomaly ${jobData.anomaly_id}`);
      
      // Update job status to processing
      await this.costDocService.updateJobStatus(job.id, 'processing');
      
      // Render PDF
      const renderResult = await this.pdfRenderer.renderPdfBuffer(
        jobData.evidence,
        jobData.template_version
      );
      
      // Generate S3 key
      const s3Key = this.pdfRenderer.generateS3Key(
        jobData.seller_id,
        jobData.anomaly_id,
        jobData.template_version,
        renderResult.metadata.evidence_sha256
      );
      
      // Upload to S3
      const { s3Key: uploadedKey, url } = await this.pdfRenderer.renderPdfToS3(
        renderResult.buffer,
        s3Key
      );
      
      // Update job status to completed
      await this.costDocService.updateJobStatus(
        job.id,
        'completed',
        uploadedKey,
        url
      );
      
      console.log(`Job ${job.id} completed successfully`);
      
      return {
        success: true,
        s3Key: uploadedKey,
        s3Url: url
      };
      
    } catch (error) {
      console.error(`Job ${job.id} failed:`, error);
      
      // Update job status to failed
      await this.costDocService.updateJobStatus(
        job.id,
        'failed',
        undefined,
        undefined,
        error instanceof Error ? error.message : String(error)
      );
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle job start
   */
  private async handleJobStart(job: Bull.Job): Promise<void> {
    try {
      await this.costDocService.updateJobStatus(job.id, 'processing');
    } catch (error) {
      console.error(`Failed to update job ${job.id} status to processing:`, error);
    }
  }

  /**
   * Handle job completion
   */
  private async handleJobCompletion(job: Bull.Job, result: JobResult): Promise<void> {
    if (result.success) {
      try {
        await this.costDocService.updateJobStatus(
          job.id,
          'completed',
          result.s3Key,
          result.s3Url
        );
        
        // Emit costdoc.ready event
        this.emitCostDocReadyEvent(job.data, result);
        
      } catch (error) {
        console.error(`Failed to update job ${job.id} status to completed:`, error);
      }
    }
  }

  /**
   * Handle job failure
   */
  private async handleJobFailure(job: Bull.Job, error: Error): Promise<void> {
    try {
      await this.costDocService.updateJobStatus(
        job.id,
        'failed',
        undefined,
        undefined,
        error.message
      );
    } catch (updateError) {
      console.error(`Failed to update job ${job.id} status to failed:`, updateError);
    }
  }

  /**
   * Emit costdoc.ready event
   */
  private emitCostDocReadyEvent(jobData: WorkerJob, result: JobResult): void {
    const event = {
      event: 'costdoc.ready',
      data: {
        pdf_url: result.s3Url,
        anomaly_id: jobData.anomaly_id,
        seller_id: jobData.seller_id,
        template_version: jobData.template_version,
        s3_key: result.s3Key,
        timestamp: new Date().toISOString()
      }
    };
    
    console.log('Emitting costdoc.ready event:', event);
    
    // In production, this would emit to your event system
    // For now, we'll just log it
    // this.eventEmitter.emit('costdoc.ready', event);
  }

  /**
   * Add a job to the queue
   */
  async addJob(jobData: WorkerJob): Promise<Bull.Job> {
    const priority = this.mapPriorityToBull(jobData.priority);
    
    const job = await this.queue.add(jobData, {
      priority,
      jobId: jobData.id,
      delay: 0,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });
    
    console.log(`Job added to queue: ${job.id} with priority ${priority}`);
    return job;
  }

  /**
   * Map priority to Bull priority
   */
  private mapPriorityToBull(priority: 'low' | 'medium' | 'high'): number {
    switch (priority) {
      case 'high':
        return 1;
      case 'medium':
        return 5;
      case 'low':
        return 10;
      default:
        return 5;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<Bull.Queue.QueueStatus> {
    return await this.queue.getJobCounts();
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Bull.Job | null> {
    return await this.queue.getJob(jobId);
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job && job.failedReason) {
        await job.retry();
        console.log(`Job ${jobId} retried successfully`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to retry job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.remove();
        console.log(`Job ${jobId} removed successfully`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to remove job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Pause queue processing
   */
  async pauseQueue(): Promise<void> {
    await this.queue.pause();
    console.log('Queue processing paused');
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(): Promise<void> {
    await this.queue.resume();
    console.log('Queue processing resumed');
  }

  /**
   * Clear all jobs
   */
  async clearQueue(): Promise<void> {
    await this.queue.empty();
    console.log('Queue cleared');
  }

  /**
   * Get failed jobs
   */
  async getFailedJobs(): Promise<Bull.Job[]> {
    return await this.queue.getFailed();
  }

  /**
   * Get completed jobs
   */
  async getCompletedJobs(): Promise<Bull.Job[]> {
    return await this.queue.getCompleted();
  }

  /**
   * Get waiting jobs
   */
  async getWaitingJobs(): Promise<Bull.Job[]> {
    return await this.queue.getWaiting();
  }

  /**
   * Get active jobs
   */
  async getActiveJobs(): Promise<Bull.Job[]> {
    return await this.queue.getActive();
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      console.log('Cost Documentation Worker cleaned up');
    }
  }
}

// Export singleton instance
export const costDocWorker = new CostDocumentationWorker();





