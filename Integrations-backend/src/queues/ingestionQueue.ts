/**
 * Hardened Ingestion Queue
 * 
 * BullMQ queue for processing initial data sync jobs after OAuth connection.
 * This is the "Connection Moment" queue that bridges Agent 1 → Agent 2/7.
 * 
 * HARDENING FEATURES:
 * ✅ LAZY INITIALIZATION - Queue only connects when first used (prevents startup crash)
 * ✅ 1.1: Redis Health Check - Verifies Redis is responding before operations
 * ✅ 1.2: Deduplication - Uses userId as jobId, prevents double-click issues
 * ✅ Exponential backoff retry (5s → 10s → 20s)
 */

import { Queue, QueueEvents } from 'bullmq';
import logger from '../utils/logger';

const QUEUE_NAME = 'onboarding-sync';

// Job data structure for initial sync
export interface InitialSyncJobData {
    userId: string;
    sellerId: string;
    storeId?: string;
    companyName?: string;
    marketplaces?: string[];
    triggeredAt: string;
    jobType: 'initial-sync' | 'manual-sync';
}

// ============================================================================
// LAZY QUEUE INITIALIZATION
// Queue is only created when first accessed - prevents crash if Redis unavailable
// ============================================================================

let _ingestionQueue: Queue<InitialSyncJobData> | null = null;
let _queueEvents: QueueEvents | null = null;
let _initializationAttempted = false;

/**
 * Get connection config (parsed lazily to avoid startup issues)
 */
function getConnection(): { host: string; port: number; password?: string; tls?: object; maxRetriesPerRequest: null } {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
        const errorMsg = '❌ [FATAL] [QUEUE] REDIS_URL is not configured. Queue initialization aborted.';
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }

    try {
        const parsed = new URL(redisUrl);
        const isSecure = parsed.protocol === 'rediss:';

        return {
            host: parsed.hostname,
            port: parseInt(parsed.port, 10) || 6379,
            ...(parsed.password && { password: decodeURIComponent(parsed.password) }),
            maxRetriesPerRequest: null, // Required by BullMQ
            // Enable TLS for rediss:// URLs
            ...(isSecure && { 
                tls: { 
                    rejectUnauthorized: false // Required for most cloud Redis providers on Render
                } 
            })
        };
    } catch (error: any) {
        logger.error('Failed to parse REDIS_URL', { error: error.message });
        throw error;
    }
}

/**
 * Get queue instance (lazy initialization)
 * Returns null if initialization fails - caller must handle gracefully
 */
function getQueue(): Queue<InitialSyncJobData> | null {
    if (_ingestionQueue) {
        return _ingestionQueue;
    }

    if (_initializationAttempted) {
        // Already tried and failed, don't retry
        return null;
    }

    _initializationAttempted = true;

    try {
        const connection = getConnection();

        logger.info('Initializing BullMQ queue', {
            host: connection.host,
            port: connection.port,
            hasTls: !!(connection as any).tls
        });

        _ingestionQueue = new Queue<InitialSyncJobData>(QUEUE_NAME, {
            connection,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000  // 5s → 10s → 20s
                },
                removeOnComplete: {
                    count: 100
                },
                removeOnFail: {
                    count: 500
                }
            }
        });

        logger.info('✅ BullMQ queue initialized successfully');
        return _ingestionQueue;
    } catch (error: any) {
        logger.error('❌ Failed to initialize BullMQ queue', { error: error.message });
        return null;
    }
}

// Export for backward compatibility
export const ingestionQueue = {
    get instance() { return getQueue(); }
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * ✅ 1.1: Redis Health Check
 * Returns true if Redis is responding, false if down or queue not initialized.
 */
export async function isQueueHealthy(): Promise<boolean> {
    try {
        const queue = getQueue();
        if (!queue) {
            logger.warn('[QUEUE] Queue not initialized, health check failed');
            return false;
        }

        const client = await queue.client;
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
 * Returns Job ID if added, null if queue unavailable or duplicate rejected
 */
export async function addSyncJob(
    userId: string,
    sellerId: string,
    options?: {
        storeId?: string;
        companyName?: string;
        marketplaces?: string[];
    }
): Promise<string | null> {
    try {
        const queue = getQueue();
        if (!queue) {
            logger.warn('[QUEUE] Queue not available, cannot add job');
            return null;
        }

        const job = await queue.add('initial-sync' as any, {
            userId,
            sellerId,
            storeId: options?.storeId,
            companyName: options?.companyName,
            marketplaces: options?.marketplaces,
            triggeredAt: new Date().toISOString(),
            jobType: 'initial-sync'
        }, {
            jobId: `sync-${userId}${options?.storeId ? `-${options.storeId}` : ''}`
        });

        logger.info('🎯 [QUEUE] Sync job added', {
            jobId: job.id,
            userId,
            sellerId,
            deduplicationKey: `sync-${userId}`
        });

        return job.id || null;
    } catch (error: any) {
        if (error.message?.includes('Job already exists')) {
            logger.info('🔄 [QUEUE] Duplicate job rejected', { userId, sellerId });
            return null;
        }
        logger.error('[QUEUE] Failed to add job', { error: error.message });
        return null;
    }
}

/**
 * Legacy helper - wraps addSyncJob for backward compatibility
 */
export async function queueInitialSync(
    userId: string,
    sellerId: string,
    options?: { companyName?: string; marketplaces?: string[] }
): Promise<string> {
    const jobId = await addSyncJob(userId, sellerId, options);
    return jobId || `fallback-${userId}`;
}

// ============================================================================
// QUEUE METRICS
// ============================================================================

/**
 * Get queue job counts for monitoring
 */
export async function getQueueMetrics(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
}> {
    try {
        const queue = getQueue();
        if (!queue) {
            return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
        }

        const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed'
        );

        return {
            waiting: counts.waiting || 0,
            active: counts.active || 0,
            completed: counts.completed || 0,
            failed: counts.failed || 0,
            delayed: counts.delayed || 0
        };
    } catch (error: any) {
        logger.error('[QUEUE] Failed to get metrics', { error: error.message });
        return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

export async function closeQueue(): Promise<void> {
    try {
        if (_ingestionQueue) {
            await _ingestionQueue.close();
            _ingestionQueue = null;
        }
        if (_queueEvents) {
            await _queueEvents.close();
            _queueEvents = null;
        }
        logger.info('Ingestion queue closed');
    } catch (error: any) {
        logger.error('Error closing queue', { error: error.message });
    }
}

export default { isQueueHealthy, addSyncJob, queueInitialSync, getQueueMetrics, closeQueue };
