/**
 * Onboarding Worker
 * 
 * BullMQ worker that processes initial sync jobs after OAuth connection.
 * 
 * LAZY INITIALIZATION: Worker only starts if Redis is available.
 * If Redis is unavailable, the worker won't start but the app won't crash.
 */

import { Worker, Job } from 'bullmq';
import logger from '../utils/logger';
import { InitialSyncJobData } from '../queues/ingestionQueue';

// Worker instance (singleton)
let worker: Worker<InitialSyncJobData> | null = null;
let initAttempted = false;

/**
 * Get connection config lazily
 */
function getConnection(): { host: string; port: number; password?: string; tls?: object } {
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
        try {
            const parsed = new URL(redisUrl);
            return {
                host: parsed.hostname,
                port: parseInt(parsed.port, 10) || 6379,
                ...(parsed.password && { password: decodeURIComponent(parsed.password) }),
                ...(parsed.protocol === 'rediss:' && { tls: {} })
            };
        } catch (error) {
            logger.warn('[WORKER] Failed to parse REDIS_URL');
        }
    }

    return {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10)
    };
}

/**
 * Process a sync job
 */
async function processSyncJob(job: Job<InitialSyncJobData>): Promise<void> {
    const { userId, sellerId, companyName, jobType } = job.data;
    const startTime = Date.now();

    logger.info(`🏭 [WORKER] Processing ${jobType} job`, {
        jobId: job.id,
        userId,
        sellerId,
        attempt: job.attemptsMade + 1
    });

    try {
        const agent2DataSyncService = (await import('../services/agent2DataSyncService')).default;

        // Send SSE event: sync started
        try {
            const sseHub = (await import('../utils/sseHub')).default;
            sseHub.sendEvent(userId, 'message', {
                type: 'sync',
                status: 'in_progress',
                data: { message: 'Starting data sync...', sellerId, companyName, jobId: job.id },
                timestamp: new Date().toISOString()
            });
        } catch (e) { /* SSE non-critical */ }

        // Run the sync
        const syncResult = await agent2DataSyncService.syncUserData(userId);
        const elapsedMs = Date.now() - startTime;

        logger.info(`✅ [WORKER] Sync completed`, {
            jobId: job.id,
            userId,
            syncId: syncResult.syncId,
            elapsedMs
        });

        // Send SSE event: sync completed
        try {
            const sseHub = (await import('../utils/sseHub')).default;
            sseHub.sendEvent(userId, 'message', {
                type: 'sync',
                status: 'completed',
                data: { message: 'Data sync completed!', syncId: syncResult.syncId },
                timestamp: new Date().toISOString()
            });
        } catch (e) { /* SSE non-critical */ }

        await job.updateProgress(100);

    } catch (error: any) {
        logger.error(`❌ [WORKER] Sync failed`, {
            jobId: job.id,
            userId,
            error: error.message
        });

        // Send SSE: failed
        try {
            const sseHub = (await import('../utils/sseHub')).default;
            const isLastAttempt = (job.attemptsMade + 1) >= (job.opts.attempts || 3);
            sseHub.sendEvent(userId, 'message', {
                type: 'sync',
                status: isLastAttempt ? 'failed' : 'retrying',
                data: { message: isLastAttempt ? 'Sync failed.' : 'Retrying...', error: error.message },
                timestamp: new Date().toISOString()
            });
        } catch (e) { /* SSE non-critical */ }

        throw error;
    }
}

/**
 * Start the worker (lazy - won't crash if Redis unavailable)
 */
export function startOnboardingWorker(): Worker<InitialSyncJobData> | null {
    if (worker) {
        logger.warn('[WORKER] Already running');
        return worker;
    }

    if (initAttempted) {
        return null;
    }

    initAttempted = true;

    try {
        const connection = getConnection();
        const concurrency = parseInt(process.env.ONBOARDING_WORKER_CONCURRENCY || '5', 10);

        logger.info('[WORKER] Starting onboarding worker...', {
            host: connection.host,
            concurrency
        });

        worker = new Worker<InitialSyncJobData>('onboarding-sync', processSyncJob, {
            connection,
            concurrency,
            lockDuration: 5 * 60 * 1000, // 5 min timeout
            limiter: { max: 10, duration: 60000 }
        });

        worker.on('ready', () => {
            logger.info('🏭 [WORKER] Onboarding worker ready', { concurrency });
        });

        worker.on('completed', (job) => {
            logger.debug('[WORKER] Job completed', { jobId: job.id });
        });

        worker.on('failed', (job, error) => {
            logger.warn('[WORKER] Job failed', { jobId: job?.id, error: error.message });
        });

        worker.on('error', (error) => {
            logger.error('[WORKER] Worker error', { error: error.message });
        });

        return worker;
    } catch (error: any) {
        logger.warn('[WORKER] Failed to start (Redis may be unavailable)', { error: error.message });
        return null;
    }
}

/**
 * Stop the worker gracefully
 */
export async function stopOnboardingWorker(): Promise<void> {
    if (worker) {
        await worker.close();
        worker = null;
        logger.info('[WORKER] Stopped');
    }
}

export default { start: startOnboardingWorker, stop: stopOnboardingWorker };
