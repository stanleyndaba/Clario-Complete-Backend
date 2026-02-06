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
    connect: async () => { },
    disconnect: async () => { },
    quit: async () => { },
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

  // Force mock client to avoid crash due to Redis limit
  return createMockRedisClient();

  /*
  try {
    redisClient = createClient({
      // ...
    });
    // ...
  } catch (error: any) {
    // ...
  }
  */
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
