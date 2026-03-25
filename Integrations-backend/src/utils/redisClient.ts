import { createClient, RedisClientType } from 'redis';
import config from '../config/env';
import logger from './logger';
import runtimeCapacityService from '../services/runtimeCapacityService';

let redisClient: RedisClientType | null = null;
let redisAvailable = false;
let redisConnectionAttempted = false;
let redisErrorLogged = false;
let redisLastError: string | null = null;
let redisFailureCount = 0;
let nextReconnectAllowedAt = 0;
const REDIS_RETRY_COOLDOWN_MS = Number(process.env.REDIS_RETRY_COOLDOWN_MS || '15000');

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

  if (Date.now() < nextReconnectAllowedAt) {
    const waitMs = nextReconnectAllowedAt - Date.now();
    const errorMsg = `Redis reconnect cooling down for ${waitMs}ms after repeated failures`;
    runtimeCapacityService.updateRedisHealth(false, errorMsg);
    throw new Error(errorMsg);
  }

  // Check if Redis URL is configured
  const redisUrl = config.REDIS_URL;
  if (!redisUrl) {
    const errorMsg = '❌ [FATAL] REDIS_URL is not configured. This is required for background workers and caching. Server will not start.';
    logger.error(errorMsg);
    runtimeCapacityService.updateRedisHealth(false, errorMsg);
    throw new Error(errorMsg);
  }

  // No kill-switch or proximity checks - boot normally using REDIS_URL


  // Strict check: No localhost/loopback allowed in production/Render environment
  if (redisUrl.includes('localhost') || redisUrl.includes('127.0.0.1')) {
    const errorMsg = '🚨 [SECURITY] Localhost Redis detected. Secure external Redis provider required.';
    logger.error(errorMsg);
    runtimeCapacityService.updateRedisHealth(false, errorMsg);
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
      redisLastError = err.message;
      redisFailureCount += 1;
      nextReconnectAllowedAt = Date.now() + REDIS_RETRY_COOLDOWN_MS;
      if (!redisErrorLogged || redisLastError !== err.message) {
        logger.error('❌ Redis Error', { error: err.message, failureCount: redisFailureCount });
        redisErrorLogged = true;
      }
      redisAvailable = false;
      runtimeCapacityService.updateRedisHealth(false, err.message);
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis Connected', { 
        url: redisUrl.split('@')[1] || 'hidden',
        secure: isSecure
      });
      redisAvailable = true;
      redisErrorLogged = false;
      redisLastError = null;
      redisFailureCount = 0;
      nextReconnectAllowedAt = 0;
      runtimeCapacityService.updateRedisHealth(true, null);
    });

    await redisClient.connect();
    redisConnectionAttempted = true;
    
    return redisClient;
  } catch (error: any) {
    logger.error('❌ Failed to initialize Redis', { error: error.message });
    redisAvailable = false;
    redisConnectionAttempted = true;
    redisLastError = error.message;
    redisFailureCount += 1;
    nextReconnectAllowedAt = Date.now() + REDIS_RETRY_COOLDOWN_MS;
    runtimeCapacityService.updateRedisHealth(false, error.message);
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

export function getRedisHealthSnapshot() {
  return {
    available: isRedisAvailable(),
    connectionAttempted: redisConnectionAttempted,
    lastError: redisLastError,
    failureCount: redisFailureCount,
    nextReconnectAllowedAt: nextReconnectAllowedAt > 0 ? new Date(nextReconnectAllowedAt).toISOString() : null
  };
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient && redisClient.isReady) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis client closed');
  }
  runtimeCapacityService.updateRedisHealth(false, 'redis_client_closed');
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await closeRedisClient();
});

process.on('SIGINT', async () => {
  await closeRedisClient();
});
