/**
 * Job Reaper Service
 * 
 * Self-healing infrastructure that:
 * - Detects and resets stuck jobs
 * - Auto-retries failed jobs with backoff
 * - Monitors queue health
 * - Sends alerts for anomalies
 */

import { Queue, Job } from 'bullmq';
import logger from '../utils/logger';
import platformEvents, { PlatformEventType } from '../utils/platformEvents';

interface ReaperConfig {
    stuckJobThresholdMs: number;      // How long before a job is considered stuck
    checkIntervalMs: number;           // How often to check
    maxAutoRetries: number;            // Max retries for stuck jobs
    alertThreshold: number;            // Queue depth that triggers alert
}

interface ReaperStats {
    lastRun: string | null;
    stuckJobsFound: number;
    jobsRetried: number;
    jobsReaped: number;
    alertsSent: number;
}

class JobReaperService {
    private queues: Map<string, Queue> = new Map();
    private config: ReaperConfig;
    private stats: ReaperStats = {
        lastRun: null,
        stuckJobsFound: 0,
        jobsRetried: 0,
        jobsReaped: 0,
        alertsSent: 0
    };
    private intervalId: NodeJS.Timeout | null = null;

    constructor(config?: Partial<ReaperConfig>) {
        this.config = {
            stuckJobThresholdMs: 10 * 60 * 1000,  // 10 minutes
            checkIntervalMs: 60 * 1000,            // 1 minute
            maxAutoRetries: 3,
            alertThreshold: 100,
            ...config
        };
    }

    /**
     * Register a queue to be monitored
     */
    registerQueue(name: string, queue: Queue): void {
        this.queues.set(name, queue);
        logger.info(`[REAPER] Queue registered: ${name}`);
    }

    /**
     * Start the reaper service
     */
    start(): void {
        if (this.intervalId) {
            logger.warn('[REAPER] Already running');
            return;
        }

        logger.info('[REAPER] Starting job reaper service', {
            checkInterval: this.config.checkIntervalMs,
            stuckThreshold: this.config.stuckJobThresholdMs
        });

        this.intervalId = setInterval(() => {
            this.runReaperCycle().catch(err => {
                logger.error('[REAPER] Cycle failed', { error: err.message });
            });
        }, this.config.checkIntervalMs);

        // Run immediately
        this.runReaperCycle().catch(err => {
            logger.error('[REAPER] Initial cycle failed', { error: err.message });
        });
    }

    /**
     * Stop the reaper service
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logger.info('[REAPER] Stopped');
        }
    }

    /**
     * Run a single reaper cycle
     */
    async runReaperCycle(): Promise<void> {
        const startTime = Date.now();

        for (const [queueName, queue] of this.queues) {
            try {
                await this.checkQueue(queueName, queue);
            } catch (error: any) {
                logger.error(`[REAPER] Failed to check queue: ${queueName}`, {
                    error: error.message
                });
            }
        }

        this.stats.lastRun = new Date().toISOString();

        logger.debug('[REAPER] Cycle complete', {
            duration: Date.now() - startTime,
            queuesChecked: this.queues.size
        });
    }

    /**
     * Check a single queue for issues
     */
    private async checkQueue(name: string, queue: Queue): Promise<void> {
        // Get queue metrics
        const [waiting, active, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getFailedCount(),
            queue.getDelayedCount()
        ]);

        const totalPending = waiting + delayed;

        // Alert on queue depth
        if (totalPending > this.config.alertThreshold) {
            this.sendQueueAlert(name, totalPending);
        }

        // Check for stuck active jobs
        const activeJobs = await queue.getActive();
        const now = Date.now();

        for (const job of activeJobs) {
            const processedOn = job.processedOn || 0;
            const duration = now - processedOn;

            if (duration > this.config.stuckJobThresholdMs) {
                await this.handleStuckJob(name, job);
            }
        }

        // Auto-retry failed jobs if under threshold
        if (failed > 0 && failed <= 10) {
            const failedJobs = await queue.getFailed(0, 10);
            for (const job of failedJobs) {
                if ((job.attemptsMade || 0) < this.config.maxAutoRetries) {
                    await this.retryJob(name, job);
                }
            }
        }
    }

    /**
     * Handle a stuck job
     */
    private async handleStuckJob(queueName: string, job: Job): Promise<void> {
        this.stats.stuckJobsFound++;

        logger.warn('[REAPER] Stuck job detected', {
            queue: queueName,
            jobId: job.id,
            processedOn: job.processedOn,
            stuckFor: Date.now() - (job.processedOn || 0)
        });

        try {
            // Move to failed with error
            await job.moveToFailed(new Error('Job stuck - reaped by system'), job.token || '');
            this.stats.jobsReaped++;

            // Emit event
            const userId = (job.data as any)?.userId;
            if (userId) {
                platformEvents.emit({
                    type: PlatformEventType.JOB_FAILED,
                    userId,
                    data: {
                        jobId: job.id || '',
                        jobType: job.name,
                        message: 'Job stuck and automatically restarted',
                        timestamp: new Date().toISOString()
                    }
                });
            }

            // Retry if under threshold
            if ((job.attemptsMade || 0) < this.config.maxAutoRetries) {
                await job.retry();
                this.stats.jobsRetried++;
                logger.info('[REAPER] Stuck job retried', { jobId: job.id, queue: queueName });
            }
        } catch (error: any) {
            logger.error('[REAPER] Failed to handle stuck job', {
                jobId: job.id,
                error: error.message
            });
        }
    }

    /**
     * Retry a failed job
     */
    private async retryJob(queueName: string, job: Job): Promise<void> {
        try {
            await job.retry();
            this.stats.jobsRetried++;

            logger.info('[REAPER] Auto-retried failed job', {
                queue: queueName,
                jobId: job.id,
                attempt: (job.attemptsMade || 0) + 1
            });

            // Emit event
            const userId = (job.data as any)?.userId;
            if (userId) {
                platformEvents.emit({
                    type: PlatformEventType.JOB_RETRYING,
                    userId,
                    data: {
                        jobId: job.id || '',
                        jobType: job.name,
                        message: 'Retrying failed job',
                        timestamp: new Date().toISOString()
                    }
                });
            }
        } catch (error: any) {
            logger.error('[REAPER] Failed to retry job', {
                jobId: job.id,
                error: error.message
            });
        }
    }

    /**
     * Send queue depth alert
     */
    private sendQueueAlert(queueName: string, depth: number): void {
        this.stats.alertsSent++;

        logger.error('[REAPER] Queue depth alert', {
            queue: queueName,
            depth,
            threshold: this.config.alertThreshold
        });

        // Broadcast system event
        platformEvents.broadcast({
            type: PlatformEventType.QUEUE_DEPTH,
            data: {
                message: `Queue ${queueName} has ${depth} pending jobs`,
                metadata: { queueName, depth },
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Get reaper stats
     */
    getStats(): ReaperStats {
        return { ...this.stats };
    }
}

export const jobReaper = new JobReaperService();
export default jobReaper;
