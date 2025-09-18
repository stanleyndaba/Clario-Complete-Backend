import { Queue, Worker, Job } from 'bullmq';
import { getLogger } from '../../../shared/utils/logger';
import { fullHistoricalSyncJob } from './fullHistoricalSyncJob';
import { reportDownloader } from './reportDownloader';

const logger = getLogger('QueueManager');

interface JobData {
  userId: string;
  reportType?: string;
  startDate?: string;
  endDate?: string;
  priority?: number;
}

interface JobProgress {
  current: number;
  total: number;
  reportType?: string;
  status: 'processing' | 'completed' | 'failed';
  message?: string;
}

class QueueManager {
  private fullHistoricalSyncQueue: Queue;
  private reportDownloadQueue: Queue;
  private worker: Worker;

  constructor() {
    // Initialize Redis connection
    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    };

    // Create queues
    this.fullHistoricalSyncQueue = new Queue('fullHistoricalSync', {
      connection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.reportDownloadQueue = new Queue('reportDownload', {
      connection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    // Create worker to process jobs
    this.worker = new Worker(
      'fullHistoricalSync',
      async (job: Job<JobData>) => {
        logger.info(`Processing full historical sync for user ${job.data.userId}`);
        
        try {
          await fullHistoricalSyncJob.process(job.data.userId, (progress: JobProgress) => {
            job.updateProgress(progress);
          });
          
          logger.info(`Full historical sync completed for user ${job.data.userId}`);
        } catch (error) {
          logger.error(`Error in full historical sync for user ${job.data.userId}:`, error);
          throw error;
        }
      },
      { connection }
    );

    // Handle worker events
    this.worker.on('completed', (job: Job<JobData>) => {
      logger.info(`Job ${job.id} completed for user ${job.data.userId}`);
    });

    this.worker.on('failed', (job: Job<JobData>, err: Error) => {
      logger.error(`Job ${job?.id} failed for user ${job?.data.userId}:`, err);
    });

    this.worker.on('progress', (job: Job<JobData>, progress: JobProgress) => {
      logger.info(`Job ${job.id} progress: ${progress.current}/${progress.total} - ${progress.status}`);
    });
  }

  async addFullHistoricalSync(userId: string, priority: number = 1): Promise<Job<JobData>> {
    try {
      logger.info(`Adding full historical sync job for user ${userId}`);
      
      const job = await this.fullHistoricalSyncQueue.add(
        'fullHistoricalSync',
        { userId, priority },
        {
          priority,
          jobId: `fullHistoricalSync_${userId}_${Date.now()}`,
        }
      );

      logger.info(`Full historical sync job added with ID: ${job.id}`);
      return job;
    } catch (error) {
      logger.error(`Error adding full historical sync job for user ${userId}:`, error);
      throw error;
    }
  }

  async addReportDownload(
    userId: string,
    reportType: string,
    startDate: string,
    endDate: string,
    priority: number = 2
  ): Promise<Job<JobData>> {
    try {
      logger.info(`Adding report download job for user ${userId}, report: ${reportType}`);
      
      const job = await this.reportDownloadQueue.add(
        'reportDownload',
        { userId, reportType, startDate, endDate, priority },
        {
          priority,
          jobId: `reportDownload_${userId}_${reportType}_${Date.now()}`,
        }
      );

      logger.info(`Report download job added with ID: ${job.id}`);
      return job;
    } catch (error) {
      logger.error(`Error adding report download job for user ${userId}:`, error);
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<any> {
    try {
      // Check both queues for the job
      let job = await this.fullHistoricalSyncQueue.getJob(jobId);
      if (!job) {
        job = await this.reportDownloadQueue.getJob(jobId);
      }

      if (!job) {
        return { status: 'not_found' };
      }

      return {
        id: job.id,
        status: await job.getState(),
        progress: job.progress,
        data: job.data,
        failedReason: job.failedReason,
        timestamp: job.timestamp,
      };
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}:`, error);
      throw error;
    }
  }

  async getJobsForUser(userId: string): Promise<any[]> {
    try {
      const [historicalJobs, reportJobs] = await Promise.all([
        this.fullHistoricalSyncQueue.getJobs(['active', 'waiting', 'completed', 'failed']),
        this.reportDownloadQueue.getJobs(['active', 'waiting', 'completed', 'failed']),
      ]);

      const allJobs = [...historicalJobs, ...reportJobs];
      return allJobs
        .filter(job => job.data.userId === userId)
        .map(job => ({
          id: job.id,
          name: job.name,
          status: job.getState(),
          progress: job.progress,
          data: job.data,
          timestamp: job.timestamp,
        }));
    } catch (error) {
      logger.error(`Error getting jobs for user ${userId}:`, error);
      throw error;
    }
  }

  async removeJob(jobId: string): Promise<void> {
    try {
      let job = await this.fullHistoricalSyncQueue.getJob(jobId);
      if (job) {
        await job.remove();
        logger.info(`Removed job ${jobId} from fullHistoricalSync queue`);
        return;
      }

      job = await this.reportDownloadQueue.getJob(jobId);
      if (job) {
        await job.remove();
        logger.info(`Removed job ${jobId} from reportDownload queue`);
        return;
      }

      logger.warn(`Job ${jobId} not found in any queue`);
    } catch (error) {
      logger.error(`Error removing job ${jobId}:`, error);
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      await this.worker.close();
      await this.fullHistoricalSyncQueue.close();
      await this.reportDownloadQueue.close();
      logger.info('Queue manager closed successfully');
    } catch (error) {
      logger.error('Error closing queue manager:', error);
      throw error;
    }
  }
}

export const queueManager = new QueueManager();
export default queueManager; 