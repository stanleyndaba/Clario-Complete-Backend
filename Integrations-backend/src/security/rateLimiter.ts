/**
 * Rate Limiting Utility
 * 
 * Provides rate limiting with IP logging for authentication endpoints
 */

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import logger from '../utils/logger';
import { logSecurityEvent } from './auditLogger';

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
 * Create rate limiter with IP logging
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  onLimitReached?: (req: Request, res: Response) => void;
}) {
  const limiter = rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: options.message || 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    handler: async (req: Request, res: Response) => {
      const clientIp = getClientIp(req);
      const userId = (req as any).userId || (req as any).user?.id;

      // Log rate limit exceeded event
      await logSecurityEvent('rate_limit_exceeded', {
        userId,
        ip: clientIp,
        userAgent: req.headers['user-agent'],
        metadata: {
          path: req.path,
          method: req.method,
          limit: options.max,
          windowMs: options.windowMs,
        },
      });

      logger.warn('Rate limit exceeded', {
        ip: clientIp,
        userId,
        path: req.path,
        method: req.method,
        limit: options.max,
        windowMs: options.windowMs,
      });

      // Call custom handler if provided
      if (options.onLimitReached) {
        options.onLimitReached(req, res);
      } else {
        res.status(429).json({
          error: 'Too many requests',
          message: options.message || 'Too many requests from this IP, please try again later.',
          retryAfter: Math.ceil(options.windowMs / 1000),
        });
      }
    },
  });

  return limiter;
}

/**
 * Authentication endpoint rate limiter (100 requests per 15 minutes)
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes (as specified)
  message: 'Too many authentication requests from this IP, please try again later.',
  skipSuccessfulRequests: false, // Count all requests
});

/**
 * General API rate limiter (1000 requests per 15 minutes)
 */
export const generalRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  message: 'Too many requests from this IP, please try again later.',
  skipSuccessfulRequests: false,
});

