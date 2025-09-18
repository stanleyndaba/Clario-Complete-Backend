import { createClient, RedisClientType } from 'redis';
import config from '../config/env';
import logger from './logger';

let redisClient: RedisClientType | null = null;

export async function createRedisClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isReady) {
    return redisClient;
  }

  try {
    redisClient = createClient({
      url: config.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('Redis connection failed after 10 retries');
            return new Error('Redis connection failed');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('error', (err) => {
      logger.error('Redis client error', { error: err.message });
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    redisClient.on('end', () => {
      logger.info('Redis client disconnected');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.error('Failed to create Redis client', { error });
    throw error;
  }
}

export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient || !redisClient.isReady) {
    return await createRedisClient();
  }
  return redisClient;
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
