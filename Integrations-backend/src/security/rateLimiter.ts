/**
 * Rate Limiting Utility
 * 
 * Provides rate limiting with IP logging for authentication endpoints
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { logSecurityEvent } from './auditLogger';
import { getRedisClient } from '../utils/redisClient';
import { rateLimit } from '../middleware/rateLimit';

/**
 * Get client IP address from request
 */
export function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

/**
 * Create a Redis-backed rate limiter with IP logging and audit events
 */
export function createRedisRateLimiter(options: {
  windowSec: number;
  maxHits: number;
  keyPrefix: string;
  message?: string;
}) {
  const { windowSec, maxHits, keyPrefix, message } = options;

  // We return a standard Express middleware
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const redisClient = await getRedisClient();

      // Use the Redis-backed middleware implementation
      const middleware = rateLimit({
        keyPrefix,
        windowSec,
        maxHits,
        redisClient,
        getKey: (request) => {
          const clientIp = getClientIp(request);
          // If authenticated, include userId in key for per-user limiting
          const userId = (request as any).userId || (request as any).user?.id || 'anonymous';
          return `${keyPrefix}:${userId}:${clientIp}`;
        },
        onLimitExceeded: async (request, response, info) => {
          const clientIp = getClientIp(request);
          const userId = (request as any).userId || (request as any).user?.id;

          // Log security event for audit trail
          await logSecurityEvent('rate_limit_exceeded', {
            userId,
            ip: clientIp,
            userAgent: request.headers['user-agent'],
            metadata: {
              path: request.path,
              method: request.method,
              limit: info.limit,
              currentHits: info.currentHits,
              windowSec: windowSec,
              key: info.key
            },
          });
        }
      });

      // Wrap the middleware to handle the result and log security events
      // The middleware itself calls next() if allowed, or res.status(429) if blocked
      // To intercept the "blocked" state for logging, we'd need to modify the middleware
      // but the core middleware already logs warnings.
      // We'll trust the middleware's internal logging for now, or wrap it if we need auditLogger specifically.

      // Let's modify the middleware call to check if it was blocked
      // Since it calls res.status(429).json(...), we can check res.statusCode afterwards?
      // No, it returns or calls next().

      return middleware(req, res, next);
    } catch (error) {
      logger.error('Failed to initialize Redis rate limiter', { error, keyPrefix });
      // Fail open to ensure user service is not interrupted
      next();
    }
  };
}

/**
 * Authentication endpoint rate limiter (1000 requests per 15 minutes)
 * Transitioned to Redis-backed persistent storage for Multi-Instance Standalone support
 */
export const authRateLimiter = createRedisRateLimiter({
  windowSec: 15 * 60, // 15 minutes
  maxHits: 1000,
  keyPrefix: 'auth',
  message: 'Too many authentication requests from this IP, please try again later.'
});

/**
 * General API rate limiter (10000 requests per 15 minutes)
 * Transitioned to Redis-backed persistent storage
 */
export const generalRateLimiter = createRedisRateLimiter({
  windowSec: 15 * 60, // 15 minutes
  maxHits: 10000,
  keyPrefix: 'gen',
  message: 'Too many requests from this IP, please try again later.'
});

/**
 * Legacy wrapper for compatibility (if needed)
 * @deprecated Use createRedisRateLimiter instead
 */
export function createRateLimiter(options: any) {
  return createRedisRateLimiter({
    windowSec: Math.ceil(options.windowMs / 1000),
    maxHits: options.max,
    keyPrefix: 'limiter',
    message: options.message
  });
}

