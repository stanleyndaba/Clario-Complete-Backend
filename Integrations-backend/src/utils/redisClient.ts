import { createClient, RedisClientType } from 'redis';
import config from '../config/env';
import logger from './logger';

let redisClient: RedisClientType | null = null;
let redisAvailable = false;
let redisConnectionAttempted = false;
let redisErrorLogged = false;

// Create a mock Redis client that does nothing (for when Redis is unavailable)
const createMockRedisClient = (): RedisClientType => {
  return {
    isReady: false,
    isOpen: false,
    connect: async () => {},
    disconnect: async () => {},
    quit: async () => {},
    lPush: async () => 0,
    rPush: async () => 0,
    lPop: async () => null,
    rPop: async () => null,
    brPop: async () => null,
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
    exists: async () => 0,
    expire: async () => 0,
    ttl: async () => -1,
    keys: async () => [],
    flushAll: async () => 'OK',
  } as any;
};

export async function createRedisClient(): Promise<RedisClientType> {
  // If Redis is already available, return it
  if (redisClient && redisClient.isReady && redisAvailable) {
    return redisClient;
  }

  // If we've already attempted and failed, return mock client
  if (redisConnectionAttempted && !redisAvailable) {
    return createMockRedisClient();
  }

  // Check if Redis URL is configured
  // If not set or set to localhost/default, disable Redis (common in production without Redis)
  if (!config.REDIS_URL || 
      config.REDIS_URL === 'redis://localhost:6379' || 
      config.REDIS_URL.includes('localhost') ||
      config.REDIS_URL.includes('127.0.0.1')) {
    if (!redisErrorLogged) {
      logger.warn('Redis URL not configured or pointing to localhost - Redis features will be disabled. Set REDIS_URL environment variable to enable Redis features.');
      redisErrorLogged = true;
    }
    redisConnectionAttempted = true;
    redisAvailable = false;
    return createMockRedisClient();
  }

  redisConnectionAttempted = true;

  try {
    redisClient = createClient({
      url: config.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            // After 3 retries, give up and use mock client
            if (!redisErrorLogged) {
              logger.warn('Redis connection failed after 3 retries - Redis features will be disabled. Check REDIS_URL configuration.');
              redisErrorLogged = true;
            }
            redisAvailable = false;
            return false; // Stop reconnecting
          }
          return Math.min(retries * 100, 1000);
        },
        connectTimeout: 5000, // 5 second timeout
      }
    });

    // Suppress repeated error logs
    let errorLogCount = 0;
    redisClient.on('error', (err) => {
      errorLogCount++;
      // Only log first error and every 100th error to reduce log spam
      if (errorLogCount === 1 || errorLogCount % 100 === 0) {
        logger.warn(`Redis client error (${errorLogCount}${errorLogCount === 1 ? 'st' : 'th'} error) - Redis features disabled: ${err.message}`);
      }
      redisAvailable = false;
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
      redisAvailable = true;
      redisErrorLogged = false; // Reset error flag on successful connection
    });

    redisClient.on('end', () => {
      logger.info('Redis client disconnected');
      redisAvailable = false;
    });

    // Attempt connection with timeout
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
      )
    ]).catch((error) => {
      if (!redisErrorLogged) {
        logger.warn(`Redis connection failed - Redis features will be disabled: ${error.message}`);
        redisErrorLogged = true;
      }
      redisAvailable = false;
      throw error;
    });

    redisAvailable = true;
    return redisClient;
  } catch (error: any) {
    if (!redisErrorLogged) {
      logger.warn(`Failed to create Redis client - Redis features will be disabled: ${error?.message || 'Unknown error'}`);
      redisErrorLogged = true;
    }
    redisAvailable = false;
    // Return mock client instead of throwing error
    return createMockRedisClient();
  }
}

export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient || !redisClient.isReady || !redisAvailable) {
    return await createRedisClient();
  }
  return redisClient;
}

// Check if Redis is available
export function isRedisAvailable(): boolean {
  return redisAvailable && redisClient !== null && redisClient.isReady;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient && redisClient.isReady) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis client closed');
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await closeRedisClient();
});

process.on('SIGINT', async () => {
  await closeRedisClient();
});
