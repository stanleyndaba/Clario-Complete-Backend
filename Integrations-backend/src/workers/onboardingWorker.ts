/**
 * Onboarding Worker
 * 
 * BullMQ worker that processes initial sync jobs after OAuth connection.
 * This is the "Factory" that runs 24/7, picking up jobs one by one.
 * 
 * Flow:
 * 1. User completes OAuth → Job added to queue
 * 2. This worker picks up job
 * 3. Calls Agent 2 (agent2DataSyncService.syncUserData)
 * 4. Sends SSE events for progress/completion
 * 5. On failure: Retries with exponential backoff
 */

import { Worker, Job } from 'bullmq';
import { connection } from '../queues/connectionConfig';
import logger from '../utils/logger';
import { InitialSyncJobData } from '../queues/ingestionQueue';

// Worker instance (singleton)
let worker: Worker<InitialSyncJobData> | null = null;

// Process a sync job
async function processSyncJob(job: Job<InitialSyncJobData>): Promise<void> {
    const { userId, sellerId, companyName, jobType } = job.data;
    const startTime = Date.now();

    logger.info(`🏭 [WORKER] Processing ${jobType} job`, {
        jobId: job.id,
        userId,
        sellerId,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts
    });

    try {
        // Import Agent 2 service
        const agent2DataSyncService = (await import('../services/agent2DataSyncService')).default;

        // Send SSE event: sync started
        try {
            const sseHub = (await import('../utils/sseHub')).default;
            sseHub.sendEvent(userId, 'message', {
                type: 'sync',
                status: 'in_progress',
                data: {
                    message: 'Starting data sync...',
                    sellerId,
                    companyName,
                    jobId: job.id
                },
                timestamp: new Date().toISOString()
            });
        } catch (sseError: any) {
            logger.debug('SSE event failed (non-critical)', { error: sseError.message });
        }

        // Run the sync (this is the heavy operation)
        const syncResult = await agent2DataSyncService.syncUserData(userId);

        const elapsedMs = Date.now() - startTime;

        logger.info(`✅ [WORKER] Sync completed`, {
            jobId: job.id,
            userId,
            sellerId,
            syncId: syncResult.syncId,
            success: syncResult.success,
            elapsedMs,
            summary: syncResult.summary
        });

        // Send SSE event: sync completed
        try {
            const sseHub = (await import('../utils/sseHub')).default;
            sseHub.sendEvent(userId, 'message', {
                type: 'sync',
                status: 'completed',
                data: {
                    message: 'Data sync completed successfully!',
                    sellerId,
                    companyName,
                    syncId: syncResult.syncId,
                    summary: syncResult.summary,
                    elapsedSeconds: Math.round(elapsedMs / 1000)
                },
                timestamp: new Date().toISOString()
            });
        } catch (sseError: any) {
            logger.debug('SSE event failed (non-critical)', { error: sseError.message });
        }

        // Update job progress (for monitoring)
        await job.updateProgress(100);

    } catch (error: any) {
        const elapsedMs = Date.now() - startTime;

        logger.error(`❌ [WORKER] Sync failed`, {
            jobId: job.id,
            userId,
            sellerId,
            error: error.message,
            attempt: job.attemptsMade + 1,
            elapsedMs
        });

        // Send SSE event: sync failed
        try {
            const sseHub = (await import('../utils/sseHub')).default;
            const isLastAttempt = (job.attemptsMade + 1) >= (job.opts.attempts || 3);
            sseHub.sendEvent(userId, 'message', {
                type: 'sync',
                status: isLastAttempt ? 'failed' : 'retrying',
                data: {
                    message: isLastAttempt
                        ? 'Data sync failed. Please try again or contact support.'
                        : 'Sync encountered an issue, retrying...',
                    sellerId,
                    error: error.message,
                    attempt: job.attemptsMade + 1,
                    willRetry: !isLastAttempt
                },
                timestamp: new Date().toISOString()
            });
        } catch (sseError: any) {
            logger.debug('SSE event failed (non-critical)', { error: sseError.message });
        }

        // Re-throw to trigger BullMQ retry mechanism
        throw error;
    }
}

// Start the worker
export function startOnboardingWorker(): Worker<InitialSyncJobData> {
    if (worker) {
        logger.warn('Onboarding worker already running');
        return worker;
    }

    // Configure concurrency (how many jobs to process in parallel)
    const concurrency = parseInt(process.env.ONBOARDING_WORKER_CONCURRENCY || '5', 10);

    worker = new Worker<InitialSyncJobData>('onboarding-sync', processSyncJob, {
        connection,
        concurrency,
        // ✅ Job timeout: 5 minutes max per job
        // If a job takes longer, it's considered stalled and retried
        lockDuration: 5 * 60 * 1000,
        // Limiter to prevent overwhelming Amazon SP-API
        limiter: {
            max: 10,       // Max 10 jobs
            duration: 60000 // Per minute
        }
    });

    // Worker lifecycle events
    worker.on('ready', () => {
        logger.info('🏭 [WORKER] Onboarding worker ready', { concurrency });
    });

    worker.on('completed', (job) => {
        logger.debug('[WORKER] Job completed', { jobId: job.id });
    });

    worker.on('failed', (job, error) => {
        logger.warn('[WORKER] Job failed', {
            jobId: job?.id,
            error: error.message,
            attempts: job?.attemptsMade
        });
    });

    worker.on('error', (error) => {
        logger.error('[WORKER] Worker error', { error: error.message });
    });

    logger.info('🏭 [WORKER] Onboarding worker started', { concurrency });

    return worker;
}

// Stop the worker gracefully
export async function stopOnboardingWorker(): Promise<void> {
    if (worker) {
        logger.info('[WORKER] Stopping onboarding worker...');
        await worker.close();
        worker = null;
        logger.info('[WORKER] Onboarding worker stopped');
    }
}

// Export for use in index.ts
export default {
    start: startOnboardingWorker,
    stop: stopOnboardingWorker
};
