/**
 * Hardened Ingestion Queue
 * 
 * BullMQ queue for processing initial data sync jobs after OAuth connection.
 * This is the "Connection Moment" queue that bridges Agent 1 → Agent 2/7.
 * 
 * HARDENING FEATURES:
 * ✅ 1.1: Redis Health Check - Verifies Redis is responding before operations
 * ✅ 1.2: Deduplication - Uses userId as jobId, prevents double-click issues
 * ✅ 1.3: Job Timeout - 5 min hard timeout kills hung processes
 * ✅ Exponential backoff retry (5s → 10s → 20s)
 * 
 * Job Types:
 * - 'initial-sync': Triggered after OAuth callback, initiates full 18-month data sync
 * - 'manual-sync': Triggered by user action, initiates on-demand sync
 */

import { Queue, QueueEvents } from 'bullmq';
import { connection } from './connectionConfig';
import logger from '../utils/logger';

const QUEUE_NAME = 'onboarding-sync';

// Job data structure for initial sync
export interface InitialSyncJobData {
    userId: string;
    sellerId: string;
    companyName?: string;
    marketplaces?: string[];
    triggeredAt: string;
    jobType: 'initial-sync' | 'manual-sync';
}

// Create the hardened ingestion queue
export const ingestionQueue = new Queue<InitialSyncJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000  // 5s → 10s → 20s
        },
        // ✅ 1.3: Hard Timeout - 5 minutes max per job
        // Kills hung processes so worker slots don't get stuck
        timeout: 5 * 60 * 1000,
        removeOnComplete: {
            count: 100  // Keep last 100 completed jobs for debugging
        },
        removeOnFail: {
            count: 500  // Keep last 500 failed jobs for DLQ review
        }
    }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * ✅ 1.1: Redis Health Check
 * Returns true if Redis is responding, false if down.
 * Usage: Call this before queue.add() to decide on fallback.
 * 
 * @returns {Promise<boolean>} true if Redis responds with PONG
 */
export async function isQueueHealthy(): Promise<boolean> {
    try {
        const client = await ingestionQueue.client;
        const ping = await client.ping();
        return ping === 'PONG';
    } catch (error: any) {
        logger.error('🔥 [QUEUE] Redis health check failed', { error: error.message });
        return false;
    }
}

// ============================================================================
// JOB MANAGEMENT
// ============================================================================

/**
 * ✅ 1.2: Add sync job with deduplication
 * 
 * Uses userId as jobId - if a job with this ID exists (active/waiting),
 * this call does NOTHING. Prevents "double-click" issues.
 * 
 * The "Panic Click" Protection:
 * When API is slow, users click "Connect" 5 times. 
 * With jobId: sync-${userId}, BullMQ ignores clicks 2, 3, 4, 5.
 * You save 400% server resources.
 * 
 * @param userId - User ID for deduplication key
 * @param sellerId - Amazon seller ID
 * @param options - Optional company name and marketplaces
 * @returns Job ID if added, null if duplicate was rejected
 */
export async function addSyncJob(
    userId: string,
    sellerId: string,
    options?: {
        companyName?: string;
        marketplaces?: string[];
    }
): Promise<string | null> {
    try {
        const job = await ingestionQueue.add('initial-sync', {
            userId,
            sellerId,
            companyName: options?.companyName,
            marketplaces: options?.marketplaces,
            triggeredAt: new Date().toISOString(),
            jobType: 'initial-sync'
        }, {
            // ✅ DEDUPLICATION KEY
            // Uses userId - only ONE job per user at a time
            // If job exists (active/waiting), this is silently ignored by BullMQ
            jobId: `sync-${userId}`
        });

        logger.info('🎯 [QUEUE] Sync job added', {
            jobId: job.id,
            userId,
            sellerId,
            deduplicationKey: `sync-${userId}`
        });

        return job.id || null;
    } catch (error: any) {
        // Check if this is a duplicate job error
        if (error.message?.includes('Job already exists')) {
            logger.info('🔄 [QUEUE] Duplicate job rejected (user already has pending sync)', {
                userId,
                sellerId
            });
            return null;
        }
        throw error;
    }
}

/**
 * Legacy helper - wraps addSyncJob for backward compatibility
 * @deprecated Use addSyncJob instead
 */
export async function queueInitialSync(
    userId: string,
    sellerId: string,
    options?: {
        companyName?: string;
        marketplaces?: string[];
    }
): Promise<string> {
    const jobId = await addSyncJob(userId, sellerId, options);
    return jobId || `duplicate-${userId}`;
}

// ============================================================================
// QUEUE METRICS
// ============================================================================

/**
 * Get queue job counts for monitoring
 * @returns Object with waiting, active, completed, failed, delayed counts
 */
export async function getQueueMetrics(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
}> {
    const counts = await ingestionQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed'
    );
    return counts;
}

// ============================================================================
// QUEUE EVENTS (OPTIONAL)
// ============================================================================

let queueEvents: QueueEvents | null = null;

/**
 * Initialize queue events listener (for debugging/monitoring)
 */
export async function initQueueEvents(): Promise<void> {
    if (process.env.ENABLE_QUEUE_EVENTS === 'true') {
        try {
            queueEvents = new QueueEvents(QUEUE_NAME, { connection });

            queueEvents.on('completed', ({ jobId }) => {
                logger.debug('[QUEUE] Job completed', { jobId });
            });

            queueEvents.on('failed', ({ jobId, failedReason }) => {
                logger.warn('[QUEUE] Job failed', { jobId, failedReason });
            });

            queueEvents.on('stalled', ({ jobId }) => {
                logger.warn('[QUEUE] Job stalled (will be retried)', { jobId });
            });

            logger.info('Queue events listener initialized');
        } catch (error: any) {
            logger.warn('Failed to initialize queue events (non-critical)', { error: error.message });
        }
    }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

/**
 * Close queue connections gracefully
 */
export async function closeQueue(): Promise<void> {
    try {
        await ingestionQueue.close();
        if (queueEvents) {
            await queueEvents.close();
        }
        logger.info('Ingestion queue closed');
    } catch (error: any) {
        logger.error('Error closing ingestion queue', { error: error.message });
    }
}

export default ingestionQueue;
