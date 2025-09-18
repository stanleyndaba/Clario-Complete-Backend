import { Request, Response, NextFunction } from 'express';
import { getLogger } from './logger';

const logger = getLogger('ErrorHandler');

// ========================================
// ERROR TYPES
// ========================================

export enum ErrorType {
  // Authentication & Authorization
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Business Logic
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  
  // External Services
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  AMAZON_API_ERROR = 'AMAZON_API_ERROR',
  GMAIL_API_ERROR = 'GMAIL_API_ERROR',
  STRIPE_API_ERROR = 'STRIPE_API_ERROR',
  
  // Database
  DATABASE_ERROR = 'DATABASE_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  QUERY_ERROR = 'QUERY_ERROR',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  
  // System
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  
  // Integration Specific
  SYNC_ERROR = 'SYNC_ERROR',
  OAUTH_ERROR = 'OAUTH_ERROR',
  WEBHOOK_ERROR = 'WEBHOOK_ERROR',
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// ========================================
// CUSTOM ERROR CLASSES
// ========================================

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly severity: ErrorSeverity;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, any>;
  public readonly originalError?: Error;

  constructor(
    message: string,
    type: ErrorType,
    statusCode: number = 500,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    isOperational: boolean = true,
    context?: Record<string, any>,
    originalError?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.type = type;
    this.statusCode = statusCode;
    this.severity = severity;
    this.isOperational = isOperational;
    this.context = context;
    this.originalError = originalError;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, ErrorType.VALIDATION_ERROR, 400, ErrorSeverity.LOW, true, context);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', context?: Record<string, any>) {
    super(message, ErrorType.UNAUTHORIZED, 401, ErrorSeverity.HIGH, true, context);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', context?: Record<string, any>) {
    super(message, ErrorType.FORBIDDEN, 403, ErrorSeverity.HIGH, true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, context?: Record<string, any>) {
    super(`${resource} not found`, ErrorType.RESOURCE_NOT_FOUND, 404, ErrorSeverity.LOW, true, context);
  }
}

export class ExternalServiceError extends AppError {
  constructor(
    service: string,
    message: string,
    statusCode?: number,
    context?: Record<string, any>
  ) {
    super(
      `${service} service error: ${message}`,
      ErrorType.EXTERNAL_SERVICE_ERROR,
      statusCode || 502,
      ErrorSeverity.HIGH,
      true,
      { service, ...context }
    );
  }
}

export class SyncError extends AppError {
  constructor(
    provider: string,
    message: string,
    context?: Record<string, any>
  ) {
    super(
      `${provider} sync error: ${message}`,
      ErrorType.SYNC_ERROR,
      500,
      ErrorSeverity.HIGH,
      true,
      { provider, ...context }
    );
  }
}

// ========================================
// ERROR RESPONSE FORMATTER
// ========================================

export interface ErrorResponse {
  success: false;
  error: {
    type: string;
    message: string;
    statusCode: number;
    severity: string;
    timestamp: string;
    requestId?: string;
    path?: string;
    method?: string;
    context?: Record<string, any>;
  };
}

export const formatErrorResponse = (
  error: AppError,
  req?: Request,
  requestId?: string
): ErrorResponse => {
  const response: ErrorResponse = {
    success: false,
    error: {
      type: error.type,
      message: error.message,
      statusCode: error.statusCode,
      severity: error.severity,
      timestamp: new Date().toISOString(),
      requestId,
      path: req?.path,
      method: req?.method,
      context: error.context
    }
  };

  // Remove undefined fields
  Object.keys(response.error).forEach(key => {
    if (response.error[key as keyof typeof response.error] === undefined) {
      delete response.error[key as keyof typeof response.error];
    }
  });

  return response;
};

// ========================================
// ERROR LOGGING
// ========================================

export const logError = (error: AppError, req?: Request, requestId?: string): void => {
  const logData = {
    type: error.type,
    message: error.message,
    statusCode: error.statusCode,
    severity: error.severity,
    requestId,
    path: req?.path,
    method: req?.method,
    userId: req?.user?.id,
    ip: req?.ip,
    userAgent: req?.get('User-Agent'),
    context: error.context,
    stack: error.stack,
    originalError: error.originalError ? {
      name: error.originalError.name,
      message: error.originalError.message,
      stack: error.originalError.stack
    } : undefined
  };

  switch (error.severity) {
    case ErrorSeverity.CRITICAL:
      logger.error('CRITICAL ERROR:', logData);
      break;
    case ErrorSeverity.HIGH:
      logger.error('HIGH SEVERITY ERROR:', logData);
      break;
    case ErrorSeverity.MEDIUM:
      logger.warn('MEDIUM SEVERITY ERROR:', logData);
      break;
    case ErrorSeverity.LOW:
      logger.info('LOW SEVERITY ERROR:', logData);
      break;
  }
};

// ========================================
// EXPRESS ERROR HANDLING MIDDLEWARE
// ========================================

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId = req.headers['x-request-id'] as string;

  // If it's our custom error, handle it
  if (error instanceof AppError) {
    logError(error, req, requestId);
    
    res.status(error.statusCode).json(formatErrorResponse(error, req, requestId));
    return;
  }

  // Handle validation errors from express-validator
  if (error.name === 'ValidationError') {
    const validationError = new ValidationError(
      'Validation failed',
      { details: error.message }
    );
    
    logError(validationError, req, requestId);
    res.status(validationError.statusCode).json(formatErrorResponse(validationError, req, requestId));
    return;
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    const authError = new AuthenticationError('Invalid token');
    logError(authError, req, requestId);
    res.status(authError.statusCode).json(formatErrorResponse(authError, req, requestId));
    return;
  }

  if (error.name === 'TokenExpiredError') {
    const authError = new AuthenticationError('Token expired');
    logError(authError, req, requestId);
    res.status(authError.statusCode).json(formatErrorResponse(authError, req, requestId));
    return;
  }

  // Handle unknown errors
  const unknownError = new AppError(
    'Internal server error',
    ErrorType.INTERNAL_SERVER_ERROR,
    500,
    ErrorSeverity.CRITICAL,
    false,
    { originalError: error.message },
    error
  );

  logError(unknownError, req, requestId);
  res.status(500).json(formatErrorResponse(unknownError, req, requestId));
};

// ========================================
// ASYNC ERROR WRAPPER
// ========================================

export const asyncHandler = <T extends Request, U extends Response>(
  fn: (req: T, res: U, next: NextFunction) => Promise<any>
) => {
  return (req: T, res: U, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ========================================
// ERROR UTILITIES
// ========================================

export const isOperationalError = (error: Error): boolean => {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
};

export const handleUncaughtExceptions = (): void => {
  process.on('uncaughtException', (error: Error) => {
    logger.error('UNCAUGHT EXCEPTION:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Exit process with failure
    process.exit(1);
  });
};

export const handleUnhandledRejections = (): void => {
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('UNHANDLED REJECTION:', {
      reason,
      promise: promise.toString()
    });
    
    // Exit process with failure
    process.exit(1);
  });
};

// ========================================
// ERROR MAPPING
// ========================================

export const mapHttpStatusToErrorType = (statusCode: number): ErrorType => {
  switch (statusCode) {
    case 400: return ErrorType.VALIDATION_ERROR;
    case 401: return ErrorType.UNAUTHORIZED;
    case 403: return ErrorType.FORBIDDEN;
    case 404: return ErrorType.RESOURCE_NOT_FOUND;
    case 429: return ErrorType.RATE_LIMIT_EXCEEDED;
    case 500: return ErrorType.INTERNAL_SERVER_ERROR;
    case 502: return ErrorType.EXTERNAL_SERVICE_ERROR;
    case 503: return ErrorType.SERVICE_UNAVAILABLE;
    case 504: return ErrorType.TIMEOUT_ERROR;
    default: return ErrorType.INTERNAL_SERVER_ERROR;
  }
};

export const mapErrorTypeToHttpStatus = (errorType: ErrorType): number => {
  switch (errorType) {
    case ErrorType.VALIDATION_ERROR:
    case ErrorType.INVALID_INPUT:
    case ErrorType.MISSING_REQUIRED_FIELD:
      return 400;
    case ErrorType.UNAUTHORIZED:
    case ErrorType.INVALID_TOKEN:
    case ErrorType.TOKEN_EXPIRED:
      return 401;
    case ErrorType.FORBIDDEN:
    case ErrorType.INSUFFICIENT_PERMISSIONS:
      return 403;
    case ErrorType.RESOURCE_NOT_FOUND:
      return 404;
    case ErrorType.RESOURCE_ALREADY_EXISTS:
      return 409;
    case ErrorType.RATE_LIMIT_EXCEEDED:
    case ErrorType.TOO_MANY_REQUESTS:
      return 429;
    case ErrorType.EXTERNAL_SERVICE_ERROR:
    case ErrorType.AMAZON_API_ERROR:
    case ErrorType.GMAIL_API_ERROR:
    case ErrorType.STRIPE_API_ERROR:
      return 502;
    case ErrorType.SERVICE_UNAVAILABLE:
      return 503;
    case ErrorType.TIMEOUT_ERROR:
      return 504;
    default:
      return 500;
  }
};


import { getLogger } from './logger';

const logger = getLogger('ErrorHandler');

// ========================================
// ERROR TYPES
// ========================================

export enum ErrorType {
  // Authentication & Authorization
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Business Logic
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  
  // External Services
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  AMAZON_API_ERROR = 'AMAZON_API_ERROR',
  GMAIL_API_ERROR = 'GMAIL_API_ERROR',
  STRIPE_API_ERROR = 'STRIPE_API_ERROR',
  
  // Database
  DATABASE_ERROR = 'DATABASE_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  QUERY_ERROR = 'QUERY_ERROR',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  
  // System
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  
  // Integration Specific
  SYNC_ERROR = 'SYNC_ERROR',
  OAUTH_ERROR = 'OAUTH_ERROR',
  WEBHOOK_ERROR = 'WEBHOOK_ERROR',
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// ========================================
// CUSTOM ERROR CLASSES
// ========================================

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly severity: ErrorSeverity;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, any>;
  public readonly originalError?: Error;

  constructor(
    message: string,
    type: ErrorType,
    statusCode: number = 500,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    isOperational: boolean = true,
    context?: Record<string, any>,
    originalError?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.type = type;
    this.statusCode = statusCode;
    this.severity = severity;
    this.isOperational = isOperational;
    this.context = context;
    this.originalError = originalError;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, ErrorType.VALIDATION_ERROR, 400, ErrorSeverity.LOW, true, context);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', context?: Record<string, any>) {
    super(message, ErrorType.UNAUTHORIZED, 401, ErrorSeverity.HIGH, true, context);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', context?: Record<string, any>) {
    super(message, ErrorType.FORBIDDEN, 403, ErrorSeverity.HIGH, true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, context?: Record<string, any>) {
    super(`${resource} not found`, ErrorType.RESOURCE_NOT_FOUND, 404, ErrorSeverity.LOW, true, context);
  }
}

export class ExternalServiceError extends AppError {
  constructor(
    service: string,
    message: string,
    statusCode?: number,
    context?: Record<string, any>
  ) {
    super(
      `${service} service error: ${message}`,
      ErrorType.EXTERNAL_SERVICE_ERROR,
      statusCode || 502,
      ErrorSeverity.HIGH,
      true,
      { service, ...context }
    );
  }
}

export class SyncError extends AppError {
  constructor(
    provider: string,
    message: string,
    context?: Record<string, any>
  ) {
    super(
      `${provider} sync error: ${message}`,
      ErrorType.SYNC_ERROR,
      500,
      ErrorSeverity.HIGH,
      true,
      { provider, ...context }
    );
  }
}

// ========================================
// ERROR RESPONSE FORMATTER
// ========================================

export interface ErrorResponse {
  success: false;
  error: {
    type: string;
    message: string;
    statusCode: number;
    severity: string;
    timestamp: string;
    requestId?: string;
    path?: string;
    method?: string;
    context?: Record<string, any>;
  };
}

export const formatErrorResponse = (
  error: AppError,
  req?: Request,
  requestId?: string
): ErrorResponse => {
  const response: ErrorResponse = {
    success: false,
    error: {
      type: error.type,
      message: error.message,
      statusCode: error.statusCode,
      severity: error.severity,
      timestamp: new Date().toISOString(),
      requestId,
      path: req?.path,
      method: req?.method,
      context: error.context
    }
  };

  // Remove undefined fields
  Object.keys(response.error).forEach(key => {
    if (response.error[key as keyof typeof response.error] === undefined) {
      delete response.error[key as keyof typeof response.error];
    }
  });

  return response;
};

// ========================================
// ERROR LOGGING
// ========================================

export const logError = (error: AppError, req?: Request, requestId?: string): void => {
  const logData = {
    type: error.type,
    message: error.message,
    statusCode: error.statusCode,
    severity: error.severity,
    requestId,
    path: req?.path,
    method: req?.method,
    userId: req?.user?.id,
    ip: req?.ip,
    userAgent: req?.get('User-Agent'),
    context: error.context,
    stack: error.stack,
    originalError: error.originalError ? {
      name: error.originalError.name,
      message: error.originalError.message,
      stack: error.originalError.stack
    } : undefined
  };

  switch (error.severity) {
    case ErrorSeverity.CRITICAL:
      logger.error('CRITICAL ERROR:', logData);
      break;
    case ErrorSeverity.HIGH:
      logger.error('HIGH SEVERITY ERROR:', logData);
      break;
    case ErrorSeverity.MEDIUM:
      logger.warn('MEDIUM SEVERITY ERROR:', logData);
      break;
    case ErrorSeverity.LOW:
      logger.info('LOW SEVERITY ERROR:', logData);
      break;
  }
};

// ========================================
// EXPRESS ERROR HANDLING MIDDLEWARE
// ========================================

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId = req.headers['x-request-id'] as string;

  // If it's our custom error, handle it
  if (error instanceof AppError) {
    logError(error, req, requestId);
    
    res.status(error.statusCode).json(formatErrorResponse(error, req, requestId));
    return;
  }

  // Handle validation errors from express-validator
  if (error.name === 'ValidationError') {
    const validationError = new ValidationError(
      'Validation failed',
      { details: error.message }
    );
    
    logError(validationError, req, requestId);
    res.status(validationError.statusCode).json(formatErrorResponse(validationError, req, requestId));
    return;
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    const authError = new AuthenticationError('Invalid token');
    logError(authError, req, requestId);
    res.status(authError.statusCode).json(formatErrorResponse(authError, req, requestId));
    return;
  }

  if (error.name === 'TokenExpiredError') {
    const authError = new AuthenticationError('Token expired');
    logError(authError, req, requestId);
    res.status(authError.statusCode).json(formatErrorResponse(authError, req, requestId));
    return;
  }

  // Handle unknown errors
  const unknownError = new AppError(
    'Internal server error',
    ErrorType.INTERNAL_SERVER_ERROR,
    500,
    ErrorSeverity.CRITICAL,
    false,
    { originalError: error.message },
    error
  );

  logError(unknownError, req, requestId);
  res.status(500).json(formatErrorResponse(unknownError, req, requestId));
};

// ========================================
// ASYNC ERROR WRAPPER
// ========================================

export const asyncHandler = <T extends Request, U extends Response>(
  fn: (req: T, res: U, next: NextFunction) => Promise<any>
) => {
  return (req: T, res: U, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ========================================
// ERROR UTILITIES
// ========================================

export const isOperationalError = (error: Error): boolean => {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
};

export const handleUncaughtExceptions = (): void => {
  process.on('uncaughtException', (error: Error) => {
    logger.error('UNCAUGHT EXCEPTION:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Exit process with failure
    process.exit(1);
  });
};

export const handleUnhandledRejections = (): void => {
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('UNHANDLED REJECTION:', {
      reason,
      promise: promise.toString()
    });
    
    // Exit process with failure
    process.exit(1);
  });
};

// ========================================
// ERROR MAPPING
// ========================================

export const mapHttpStatusToErrorType = (statusCode: number): ErrorType => {
  switch (statusCode) {
    case 400: return ErrorType.VALIDATION_ERROR;
    case 401: return ErrorType.UNAUTHORIZED;
    case 403: return ErrorType.FORBIDDEN;
    case 404: return ErrorType.RESOURCE_NOT_FOUND;
    case 429: return ErrorType.RATE_LIMIT_EXCEEDED;
    case 500: return ErrorType.INTERNAL_SERVER_ERROR;
    case 502: return ErrorType.EXTERNAL_SERVICE_ERROR;
    case 503: return ErrorType.SERVICE_UNAVAILABLE;
    case 504: return ErrorType.TIMEOUT_ERROR;
    default: return ErrorType.INTERNAL_SERVER_ERROR;
  }
};

export const mapErrorTypeToHttpStatus = (errorType: ErrorType): number => {
  switch (errorType) {
    case ErrorType.VALIDATION_ERROR:
    case ErrorType.INVALID_INPUT:
    case ErrorType.MISSING_REQUIRED_FIELD:
      return 400;
    case ErrorType.UNAUTHORIZED:
    case ErrorType.INVALID_TOKEN:
    case ErrorType.TOKEN_EXPIRED:
      return 401;
    case ErrorType.FORBIDDEN:
    case ErrorType.INSUFFICIENT_PERMISSIONS:
      return 403;
    case ErrorType.RESOURCE_NOT_FOUND:
      return 404;
    case ErrorType.RESOURCE_ALREADY_EXISTS:
      return 409;
    case ErrorType.RATE_LIMIT_EXCEEDED:
    case ErrorType.TOO_MANY_REQUESTS:
      return 429;
    case ErrorType.EXTERNAL_SERVICE_ERROR:
    case ErrorType.AMAZON_API_ERROR:
    case ErrorType.GMAIL_API_ERROR:
    case ErrorType.STRIPE_API_ERROR:
      return 502;
    case ErrorType.SERVICE_UNAVAILABLE:
      return 503;
    case ErrorType.TIMEOUT_ERROR:
      return 504;
    default:
      return 500;
  }
};


