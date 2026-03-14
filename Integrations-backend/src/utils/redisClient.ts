import { createClient, RedisClientType } from 'redis';
import config from '../config/env';
import logger from './logger';

let redisClient: RedisClientType | null = null;
let redisAvailable = false;
let redisConnectionAttempted = false;
let redisErrorLogged = false;

// Create a mock Redis client that does nothing (for when Redis is unavailable)
const createMockRedisClient = (): RedisClientType => {
  const mockClient = {
    isReady: true,
    isOpen: true,
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
    incr: async () => 1,
    flushAll: async () => 'OK',
    multi: function () {
      return {
        incr: () => this,
        expire: () => this,
        set: () => this,
        get: () => this,
        del: () => this,
        exec: async () => [1, 1] // Return dummy results for rate limiting [incrResult, expireResult]
      } as any;
    },
    on: () => mockClient,
    off: () => mockClient,
  } as any;
  return mockClient;
};

export async function createRedisClient(): Promise<RedisClientType> {
  // If Redis is already available, return it
  if (redisClient && redisClient.isReady && redisAvailable) {
    return redisClient;
  }

  // Check if Redis URL is configured
  const redisUrl = config.REDIS_URL;
  if (!redisUrl) {
    const errorMsg = '❌ [FATAL] REDIS_URL is not configured. This is required for background workers and caching. Server will not start.';
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Strict check: No localhost/loopback allowed in production/Render environment
  if (redisUrl.includes('localhost') || redisUrl.includes('127.0.0.1')) {
    const errorMsg = '🚨 [SECURITY] Localhost Redis detected. Secure external Redis provider required.';
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  try {
    const isSecure = redisUrl.startsWith('rediss:');
    
    redisClient = createClient({
      url: redisUrl,
      socket: {
        // BullMQ compliance
        reconnectStrategy: (retries) => {
          if (retries > 20) return new Error('Max retries reached');
          return Math.min(retries * 100, 3000);
        },
        // TLS for secure providers
        ...(isSecure && {
          tls: true,
          rejectUnauthorized: false
        })
      }
    });

    redisClient.on('error', (err) => {
      logger.error('❌ Redis Error', { error: err.message });
      redisAvailable = false;
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis Connected', { 
        url: redisUrl.split('@')[1] || 'hidden',
        secure: isSecure
      });
      redisAvailable = true;
    });

    await redisClient.connect();
    redisConnectionAttempted = true;
    
    return redisClient;
  } catch (error: any) {
    logger.error('❌ Failed to initialize Redis', { error: error.message });
    redisAvailable = false;
    redisConnectionAttempted = true;
    throw error;
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
