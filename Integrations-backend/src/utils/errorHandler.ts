import { Request, Response, NextFunction } from 'express';
import logger from './logger';
import { AppError, ErrorCode, isRetryableError, getRetryDelay } from './errors';

export interface CustomError extends Error {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
  code?: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

// Add the missing asyncHandler with enhanced error capture
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch((error) => {
    // Enhance error with request context
    if (error instanceof Error && !error.message.includes(req.originalUrl)) {
      (error as any).requestUrl = req.originalUrl;
      (error as any).requestMethod = req.method;
    }
    next(error);
  });
};

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction) => {
  const error = new Error(`Not found - ${_req.originalUrl}`) as CustomError;
  error.statusCode = 404;
  error.status = 'fail';
  next(error);
};

/**
 * Enhanced global error handler with detailed logging and proper response formatting
 */
export const errorHandler = (err: CustomError | AppError, req: Request, res: Response, _next: NextFunction) => {
  // Generate unique error ID for tracking
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Determine if this is an AppError (our custom error type)
  const isAppError = err instanceof AppError;
  
  // Extract error details
  let statusCode = 500;
  let errorCode = ErrorCode.INTERNAL_ERROR;
  let message = 'Internal Server Error';
  let retryable = false;
  let retryAfterMs: number | undefined;
  
  if (isAppError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    message = err.message;
    retryable = err.retryable;
    retryAfterMs = err.retryAfterMs;
  } else if (err.statusCode) {
    statusCode = err.statusCode;
    message = err.message || message;
  }
  
  // Handle specific error types
  if (err.name === 'CastError') {
    statusCode = 404;
    message = 'Resource not found';
    errorCode = ErrorCode.NOT_FOUND;
  }

  if ((err as any).code === 11000) {
    statusCode = 400;
    message = 'Duplicate field value entered';
    errorCode = ErrorCode.DB_DUPLICATE_ENTRY;
  }

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values((err as any).errors).map((val: any) => val.message).join(', ');
    errorCode = ErrorCode.VALIDATION_FAILED;
  }
  
  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    errorCode = ErrorCode.AUTH_TOKEN_INVALID;
  }
  
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token has expired';
    errorCode = ErrorCode.AUTH_TOKEN_EXPIRED;
    retryable = true;
  }
  
  // Handle network errors
  if ((err as any).code === 'ECONNREFUSED') {
    statusCode = 503;
    message = 'Service temporarily unavailable';
    errorCode = ErrorCode.NETWORK_CONNECTION_REFUSED;
    retryable = true;
    retryAfterMs = 5000;
  }
  
  if ((err as any).code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
    statusCode = 504;
    message = 'Request timeout';
    errorCode = ErrorCode.NETWORK_TIMEOUT;
    retryable = true;
    retryAfterMs = 5000;
  }
  
  // Handle rate limiting
  if (statusCode === 429 || err.message?.toLowerCase().includes('rate limit')) {
    errorCode = ErrorCode.SPAPI_RATE_LIMITED;
    retryable = true;
    retryAfterMs = retryAfterMs || 60000;
  }

  // Log error with full context (server-side only)
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel]('Request error', {
    errorId,
    errorCode,
    message,
    statusCode,
    retryable,
    url: req.originalUrl,
    method: req.method,
    userId: (req as any).userId || 'anonymous',
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });
  
  // Set retry header if applicable
  if (retryable && retryAfterMs) {
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
  }

  // Send clean response to client (no stack traces in production)
  const response: Record<string, any> = {
    error: true,
    errorId,
    code: errorCode,
    message,
    statusCode,
  };
  
  if (retryable) {
    response.retryable = true;
    if (retryAfterMs) {
      response.retryAfterMs = retryAfterMs;
    }
  }
  
  // Include stack trace only in development
  if (process.env.NODE_ENV !== 'production') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

// Convenience helper to create typed errors
export const createError = (message: string, statusCode = 400, code?: ErrorCode): CustomError => {
  const e = new Error(message) as CustomError;
  e.statusCode = statusCode;
  e.status = statusCode >= 500 ? 'error' : 'fail';
  e.isOperational = true;
  if (code) {
    e.code = code;
  }
  return e;
};

/**
 * Circuit breaker for external services
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime: Date | null = null;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 60000
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.lastFailureTime && Date.now() - this.lastFailureTime.getTime() > this.resetTimeMs) {
        this.state = 'half-open';
      } else {
        throw createError('Service temporarily unavailable', 503);
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
      logger.warn('Circuit breaker opened', { failures: this.failures });
    }
  }
  
  getState(): string {
    return this.state;
  }
}
