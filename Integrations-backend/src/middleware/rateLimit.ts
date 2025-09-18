import { Request, Response, NextFunction } from 'express';
import { RedisClientType } from 'redis';
import logger from '../utils/logger';

export interface RateLimitOptions {
  keyPrefix: string;
  windowSec: number;
  maxHits: number;
  redisClient: RedisClientType;
  getKey?: (req: Request) => string;
}

export interface RateLimitResult {
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

/**
 * Rate limiting middleware using Redis
 * Uses INCR + EXPIRE for atomic counting and automatic cleanup
 */
export function rateLimit(options: RateLimitOptions) {
  const { keyPrefix, windowSec, maxHits, redisClient, getKey } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Generate rate limit key
      const key = getKey ? getKey(req) : generateDefaultKey(req, keyPrefix);
      const redisKey = `rate_limit:${key}`;

      // Use Redis pipeline for atomic operations
      const pipeline = redisClient.multi();
      
      // Increment counter and set expiry
      pipeline.incr(redisKey);
      pipeline.expire(redisKey, windowSec);
      
      const results = await pipeline.exec();
      
      if (!results || results.length < 2) {
        logger.error('Rate limit Redis operation failed', { key });
        // Fail open - allow request if Redis is unavailable
        next();
        return;
      }

      const currentHits = results[0] as number;
      const expirySet = results[1] as number;

      // Calculate rate limit info
      const limit = maxHits;
      const remaining = Math.max(0, limit - currentHits);
      const reset = Math.floor(Date.now() / 1000) + windowSec;

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': reset.toString()
      });

      // Check if limit exceeded
      if (currentHits > limit) {
        const retryAfter = windowSec;
        res.set('Retry-After', retryAfter.toString());
        
        logger.warn('Rate limit exceeded', {
          key,
          currentHits,
          limit,
          windowSec,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });

        res.status(429).json({
          error: 'Too many requests',
          retryAfter,
          limit,
          remaining: 0
        });
        return;
      }

      // Request allowed
      logger.debug('Rate limit check passed', {
        key,
        currentHits,
        remaining,
        limit
      });

      next();
    } catch (error) {
      logger.error('Rate limit middleware error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        keyPrefix,
        ip: req.ip
      });
      
      // Fail open - allow request if rate limiting fails
      next();
    }
  };
}

/**
 * Generate default rate limit key based on IP and user ID
 */
function generateDefaultKey(req: Request, keyPrefix: string): string {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userId = (req as any).user?.id || 'anonymous';
  
  return `${keyPrefix}:${userId}:${ip}`;
}

/**
 * Create rate limit middleware with common configurations
 */
export function createRateLimit(
  redisClient: RedisClientType,
  keyPrefix: string,
  windowSec: number,
  maxHits: number
) {
  return rateLimit({
    keyPrefix,
    windowSec,
    maxHits,
    redisClient
  });
}

/**
 * Rate limit by user ID (requires authentication)
 */
export function createUserRateLimit(
  redisClient: RedisClientType,
  keyPrefix: string,
  windowSec: number,
  maxHits: number
) {
  return rateLimit({
    keyPrefix,
    windowSec,
    maxHits,
    redisClient,
    getKey: (req: Request) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        throw new Error('User authentication required for rate limiting');
      }
      return `${keyPrefix}:${userId}`;
    }
  });
}

/**
 * Rate limit by IP address only
 */
export function createIPRateLimit(
  redisClient: RedisClientType,
  keyPrefix: string,
  windowSec: number,
  maxHits: number
) {
  return rateLimit({
    keyPrefix,
    windowSec,
    maxHits,
    redisClient,
    getKey: (req: Request) => {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      return `${keyPrefix}:${ip}`;
    }
  });
}

/**
 * Get current rate limit status for a key
 */
export async function getRateLimitStatus(
  redisClient: RedisClientType,
  key: string
): Promise<RateLimitResult | null> {
  try {
    const redisKey = `rate_limit:${key}`;
    const currentHits = await redisClient.get(redisKey);
    const ttl = await redisClient.ttl(redisKey);
    
    if (currentHits === null) {
      return null;
    }
    
    const hits = parseInt(currentHits, 10);
    const reset = Math.floor(Date.now() / 1000) + ttl;
    
    return {
      limit: 0, // Would need to be passed in or stored
      remaining: Math.max(0, 0 - hits),
      reset
    };
  } catch (error) {
    logger.error('Failed to get rate limit status', {
      error: error instanceof Error ? error.message : 'Unknown error',
      key
    });
    return null;
  }
}
