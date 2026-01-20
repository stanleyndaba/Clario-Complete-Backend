/**
 * Redis Cache Service
 * 
 * Provides intelligent caching for frequently accessed data to improve
 * API response times and reduce database/external API load.
 * 
 * Uses the same Redis instance as BullMQ queue for simplicity.
 */

import Redis from 'ioredis';
import logger from '../utils/logger';

// Cache TTL defaults (in seconds)
const TTL = {
    DASHBOARD_METRICS: 60,      // 1 minute
    RECOVERIES_METRICS: 60,     // 1 minute
    USER_PROFILE: 300,          // 5 minutes
    REPORT_DATA: 300,           // 5 minutes
    DETECTION_RESULTS: 600,     // 10 minutes (invalidated on new detection)
};

// Key prefixes for organization
const PREFIX = {
    DASHBOARD: 'cache:dashboard:',
    RECOVERIES: 'cache:recoveries:',
    REPORTS: 'cache:reports:',
    DETECTIONS: 'cache:detections:',
    USER: 'cache:user:',
};

class CacheService {
    private redis: Redis | null = null;
    private initAttempted = false;
    private isAvailable = false;

    /**
     * Get Redis connection (lazy initialization)
     */
    private getConnection(): Redis | null {
        if (this.redis) return this.redis;
        if (this.initAttempted) return null;

        this.initAttempted = true;

        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            logger.warn('[CACHE] No REDIS_URL configured, caching disabled');
            return null;
        }

        try {
            this.redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => {
                    if (times > 3) return null;
                    return Math.min(times * 100, 3000);
                },
                lazyConnect: true,
            });

            this.redis.on('connect', () => {
                this.isAvailable = true;
                logger.info('[CACHE] Redis connected');
            });

            this.redis.on('error', (err) => {
                this.isAvailable = false;
                logger.warn('[CACHE] Redis error', { error: err.message });
            });

            this.redis.on('close', () => {
                this.isAvailable = false;
            });

            // Attempt connection
            this.redis.connect().catch(() => {
                logger.warn('[CACHE] Redis connection failed, caching disabled');
            });

            return this.redis;
        } catch (error: any) {
            logger.warn('[CACHE] Failed to initialize Redis', { error: error.message });
            return null;
        }
    }

    /**
     * Check if cache is available
     */
    isReady(): boolean {
        return this.isAvailable && this.redis !== null;
    }

    /**
     * Get cached value
     */
    async get<T>(key: string): Promise<T | null> {
        const redis = this.getConnection();
        if (!redis || !this.isAvailable) return null;

        try {
            const cached = await redis.get(key);
            if (!cached) return null;

            return JSON.parse(cached) as T;
        } catch (error: any) {
            logger.debug('[CACHE] Get failed', { key, error: error.message });
            return null;
        }
    }

    /**
     * Set cached value with TTL
     */
    async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
        const redis = this.getConnection();
        if (!redis || !this.isAvailable) return false;

        try {
            const serialized = JSON.stringify(value);
            if (ttlSeconds) {
                await redis.setex(key, ttlSeconds, serialized);
            } else {
                await redis.set(key, serialized);
            }
            return true;
        } catch (error: any) {
            logger.debug('[CACHE] Set failed', { key, error: error.message });
            return false;
        }
    }

    /**
     * Delete cached value(s)
     */
    async del(...keys: string[]): Promise<boolean> {
        const redis = this.getConnection();
        if (!redis || !this.isAvailable || keys.length === 0) return false;

        try {
            await redis.del(...keys);
            return true;
        } catch (error: any) {
            logger.debug('[CACHE] Del failed', { keys, error: error.message });
            return false;
        }
    }

    /**
     * Delete all keys matching pattern
     */
    async invalidatePattern(pattern: string): Promise<boolean> {
        const redis = this.getConnection();
        if (!redis || !this.isAvailable) return false;

        try {
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
                await redis.del(...keys);
                logger.debug('[CACHE] Invalidated keys', { pattern, count: keys.length });
            }
            return true;
        } catch (error: any) {
            logger.debug('[CACHE] Invalidate pattern failed', { pattern, error: error.message });
            return false;
        }
    }

    // ============================================================================
    // DOMAIN-SPECIFIC CACHE HELPERS
    // ============================================================================

    /**
     * Get/set dashboard metrics with caching
     */
    async getDashboardMetrics<T>(
        userId: string,
        tenantId: string,
        fetcher: () => Promise<T>
    ): Promise<T> {
        const key = `${PREFIX.DASHBOARD}${tenantId}:${userId}`;

        // Try cache first
        const cached = await this.get<T>(key);
        if (cached !== null) {
            logger.debug('[CACHE] Dashboard metrics HIT', { userId, tenantId });
            return cached;
        }

        // Fetch fresh data
        const data = await fetcher();

        // Cache it
        await this.set(key, data, TTL.DASHBOARD_METRICS);
        logger.debug('[CACHE] Dashboard metrics MISS, cached', { userId, tenantId });

        return data;
    }

    /**
     * Get/set recoveries metrics with caching
     */
    async getRecoveriesMetrics<T>(
        userId: string,
        tenantId: string,
        fetcher: () => Promise<T>
    ): Promise<T> {
        const key = `${PREFIX.RECOVERIES}${tenantId}:${userId}`;

        const cached = await this.get<T>(key);
        if (cached !== null) {
            logger.debug('[CACHE] Recoveries metrics HIT', { userId, tenantId });
            return cached;
        }

        const data = await fetcher();
        await this.set(key, data, TTL.RECOVERIES_METRICS);
        logger.debug('[CACHE] Recoveries metrics MISS, cached', { userId, tenantId });

        return data;
    }

    /**
     * Invalidate all caches for a user (call after sync/detection)
     */
    async invalidateUserCaches(userId: string, tenantId?: string): Promise<void> {
        const patterns = [
            `${PREFIX.DASHBOARD}*:${userId}`,
            `${PREFIX.RECOVERIES}*:${userId}`,
            `${PREFIX.DETECTIONS}${userId}:*`,
        ];

        if (tenantId) {
            patterns.push(`${PREFIX.DASHBOARD}${tenantId}:*`);
            patterns.push(`${PREFIX.RECOVERIES}${tenantId}:*`);
        }

        for (const pattern of patterns) {
            await this.invalidatePattern(pattern);
        }

        logger.info('[CACHE] User caches invalidated', { userId, tenantId });
    }

    /**
     * Graceful shutdown
     */
    async close(): Promise<void> {
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
            this.isAvailable = false;
            logger.info('[CACHE] Redis connection closed');
        }
    }
}

// Export singleton instance
export const cacheService = new CacheService();
export default cacheService;

// Export TTL and PREFIX for external use
export { TTL, PREFIX };
