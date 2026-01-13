/**
 * BullMQ Connection Configuration
 * 
 * Shared Redis connection config for all BullMQ queues.
 * Reuses existing REDIS_URL from environment or falls back to localhost.
 */

import logger from '../utils/logger';

// Parse Redis URL into connection options
function parseRedisUrl(url: string): { host: string; port: number; password?: string; tls?: object } {
    try {
        const parsed = new URL(url);
        return {
            host: parsed.hostname,
            port: parseInt(parsed.port, 10) || 6379,
            ...(parsed.password && { password: parsed.password }),
            // Enable TLS for rediss:// URLs (common in production Redis like Upstash/Railway)
            ...(parsed.protocol === 'rediss:' && { tls: {} })
        };
    } catch (error) {
        logger.warn('Failed to parse REDIS_URL, using defaults', { url: url?.substring(0, 20) });
        return { host: 'localhost', port: 6379 };
    }
}

// Connection configuration for BullMQ
export const connection = process.env.REDIS_URL
    ? parseRedisUrl(process.env.REDIS_URL)
    : {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10)
    };

// Log connection target (without password)
logger.info('BullMQ connection configured', {
    host: connection.host,
    port: connection.port,
    hasTls: !!(connection as any).tls,
    hasPassword: !!(connection as any).password,
    source: process.env.REDIS_URL ? 'REDIS_URL' : 'REDIS_HOST/PORT'
});

export default connection;
