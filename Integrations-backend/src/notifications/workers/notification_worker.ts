import { getLogger } from '../../utils/logger';
import { Queue, Worker, Job, JobsOptions } from 'bullmq';
import Notification, { NotificationStatus } from '../models/notification';
import { notificationService } from '../services/notification_service';

const logger = getLogger('NotificationWorker');

export interface NotificationJobData {
  notificationId: string;
  userId: string;
  type: string;
  priority: string;
  channel: string;
}

export interface NotificationJobResult {
  success: boolean;
  deliveredAt: Date;
  error?: string;
}

export class NotificationWorker {
  private queue: Queue<NotificationJobData>;
  private worker: Worker<NotificationJobData, NotificationJobResult>;
  private isInitialized: boolean = false;

  constructor() {
    this.queue = new Queue('notifications', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0')
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 }
      }
    });

    // QueueScheduler removed in newer versions of BullMQ

    this.worker = new Worker<NotificationJobData, NotificationJobResult>(
      'notifications',
      async (job) => this.processNotificationJob(job),
      {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
          db: parseInt(process.env.REDIS_DB || '0')
        },
        concurrency: parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || '5'),
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 }
      }
    );

    this.setupEventHandlers();
  }

  /**
   * Initialize the notification worker
   */
  async initialize(): Promise<void> {
    try {
      // Wait for queue and worker to be ready
      await this.queue.waitUntilReady();
      await this.worker.waitUntilReady();
      // Scheduler removed in newer BullMQ versions

      this.isInitialized = true;
      logger.info('Notification worker initialized successfully', {
        queueName: this.queue.name,
        concurrency: this.worker.concurrency
      });
    } catch (error) {
      logger.error('Failed to initialize notification worker:', error);
      throw error;
    }
  }

  /**
   * Setup worker event handlers
   */
  private setupEventHandlers(): void {
    // Worker events
    this.worker.on('completed', (job, result) => {
      logger.info('Notification job completed successfully', {
        jobId: job.id,
        notificationId: job.data.notificationId,
        result
      });
    });

    this.worker.on('failed', (job, err) => {
      logger.error('Notification job failed', {
        jobId: job.id,
        notificationId: job.data.notificationId,
        error: err.message,
        attempts: job.attemptsMade
      });
    });

    this.worker.on('error', (err) => {
      logger.error('Notification worker error:', err);
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn('Notification job stalled', { jobId });
    });

    // Queue events
    this.queue.on('waiting', (job) => {
      logger.debug('Notification job waiting', {
        jobId: job.id,
        notificationId: job.data.notificationId
      });
    });

    // Queue event listeners commented out due to type issues in newer BullMQ versions
    // this.queue.on('active', (job) => {
    //   logger.debug('Notification job started processing', {
    //     jobId: job.id,
    //     notificationId: job.data.notificationId
    //   });
    // });

    // this.queue.on('completed', (job, result) => {
    //   logger.debug('Notification job completed', {
    //     jobId: job.id,
    //     notificationId: job.data.notificationId,
    //     result
    //   });
    // });

    // this.queue.on('failed', (job, err) => {
    //   logger.error('Notification job failed in queue', {
    //     jobId: job.id,
    //     notificationId: job.data.notificationId,
    //     error: err.message
    //   });
    // });

    logger.info('Notification worker event handlers set up');
  }

  /**
   * Queue a notification for processing
   */
  async queueNotification(notificationId: string, options?: JobsOptions): Promise<void> {
    try {
      if (!this.isInitialized) {
        throw new Error('Notification worker not initialized');
      }

      // Get notification details from database
      const notification = await Notification.findById(notificationId);
      if (!notification) {
        throw new Error(`Notification not found: ${notificationId}`);
      }

      const jobData: NotificationJobData = {
        notificationId: notification.id,
        userId: notification.user_id,
        type: notification.type,
        priority: notification.priority,
        channel: notification.channel
      };

      // Determine job options based on priority
      const jobOptions: JobsOptions = {
        ...options,
        priority: this.getJobPriority(notification.priority),
        delay: this.getJobDelay(notification.priority),
        ...(notification.expires_at && {
          removeOnComplete: true,
          removeOnFail: true
        })
      };

      await this.queue.add('process-notification', jobData, jobOptions);

      logger.info('Notification queued successfully', {
        notificationId,
        userId: notification.user_id,
        priority: notification.priority,
        jobOptions
      });
    } catch (error) {
      logger.error('Error queuing notification:', error);
      throw error;
    }
  }

  /**
   * Process a notification job
   */
  private async processNotificationJob(job: Job<NotificationJobData>): Promise<NotificationJobResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Processing notification job', {
        jobId: job.id,
        notificationId: job.data.notificationId,
        userId: job.data.userId,
        type: job.data.type
      });

      // Get the notification from database
      const notification = await Notification.findById(job.data.notificationId);
      if (!notification) {
        throw new Error(`Notification not found: ${job.data.notificationId}`);
      }

      // Check if notification is still pending
      if (notification.status !== NotificationStatus.PENDING) {
        logger.warn('Notification is no longer pending, skipping', {
          notificationId: notification.id,
          status: notification.status
        });
        
        return {
          success: true,
          deliveredAt: new Date(),
          error: 'Notification already processed'
        };
      }

      // Check if notification has expired
      if (notification.isExpired()) {
        logger.warn('Notification has expired, marking as expired', {
          notificationId: notification.id,
          expiresAt: notification.expires_at
        });

        await notification.update({ status: NotificationStatus.EXPIRED });
        
        return {
          success: true,
          deliveredAt: new Date(),
          error: 'Notification expired'
        };
      }

      // Deliver the notification
      await this.deliverNotification(notification);

      const processingTime = Date.now() - startTime;
      
      logger.info('Notification job processed successfully', {
        jobId: job.id,
        notificationId: notification.id,
        processingTime,
        userId: notification.user_id
      });

      return {
        success: true,
        deliveredAt: new Date()
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      logger.error('Error processing notification job:', {
        jobId: job.id,
        notificationId: job.data.notificationId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime
      });

      // Mark notification as failed if max attempts reached
      if (job.attemptsMade >= (job.opts.attempts || 3)) {
        try {
          const notification = await Notification.findById(job.data.notificationId);
          if (notification) {
            await notification.markAsFailed();
            logger.info('Notification marked as failed after max attempts', {
              notificationId: notification.id
            });
          }
        } catch (markFailedError) {
          logger.error('Error marking notification as failed:', markFailedError);
        }
      }

      return {
        success: false,
        deliveredAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Deliver notification through appropriate channels
   */
  private async deliverNotification(notification: Notification): Promise<void> {
    try {
      // Use the notification service to deliver the notification
      // This will handle both WebSocket and email delivery
      await notificationService['deliverNotification'](notification);
      
      logger.info('Notification delivered successfully', {
        notificationId: notification.id,
        userId: notification.user_id,
        channel: notification.channel
      });
    } catch (error) {
      logger.error('Error delivering notification:', error);
      throw error;
    }
  }

  /**
   * Get job priority based on notification priority
   */
  private getJobPriority(notificationPriority: string): number {
    switch (notificationPriority) {
      case 'urgent':
        return 1;
      case 'high':
        return 2;
      case 'normal':
        return 3;
      case 'low':
        return 4;
      default:
        return 3;
    }
  }

  /**
   * Get job delay based on notification priority
   */
  private getJobDelay(notificationPriority: string): number {
    switch (notificationPriority) {
      case 'urgent':
        return 0; // Immediate
      case 'high':
        return 1000; // 1 second
      case 'normal':
        return 5000; // 5 seconds
      case 'low':
        return 30000; // 30 seconds
      default:
        return 5000;
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
      logger.error('Error getting queue stats:', error);
      throw error;
    }
  }

  /**
   * Clean up completed and failed jobs
   */
  async cleanupJobs(): Promise<{
    completed: number;
    failed: number;
  }> {
    try {
      const [completedJobs, failedJobs] = await Promise.all([
        this.queue.clean(0, 1000, 'completed'),
        this.queue.clean(0, 1000, 'failed')
      ]);

      const completed = completedJobs.length;
      const failed = failedJobs.length;

      logger.info('Job cleanup completed', { completed, failed });
      return { completed, failed };
    } catch (error) {
      logger.error('Error during job cleanup:', error);
      throw error;
    }
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    try {
      await this.worker.pause();
      logger.info('Notification worker paused');
    } catch (error) {
      logger.error('Error pausing notification worker:', error);
      throw error;
    }
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    try {
      await this.worker.resume();
      logger.info('Notification worker resumed');
    } catch (error) {
      logger.error('Error resuming notification worker:', error);
      throw error;
    }
  }

  /**
   * Shutdown the notification worker
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('Shutting down notification worker...');

      // Close the worker
      await this.worker.close();
      
      // Close the queue
      await this.queue.close();
      
      // Scheduler removed in newer BullMQ versions

      this.isInitialized = false;
      logger.info('Notification worker shutdown completed');
    } catch (error) {
      logger.error('Error during notification worker shutdown:', error);
      throw error;
    }
  }
}

export default NotificationWorker;


