/**
 * Comprehensive Error Types for Clario Backend
 * Provides typed errors for all common failure scenarios
 */

export enum ErrorCode {
  // Authentication errors (1xxx)
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',
  
  // Amazon SP-API errors (2xxx)
  SPAPI_RATE_LIMITED = 'SPAPI_RATE_LIMITED',
  SPAPI_TOKEN_EXPIRED = 'SPAPI_TOKEN_EXPIRED',
  SPAPI_INVALID_CREDENTIALS = 'SPAPI_INVALID_CREDENTIALS',
  SPAPI_REQUEST_FAILED = 'SPAPI_REQUEST_FAILED',
  SPAPI_QUOTA_EXCEEDED = 'SPAPI_QUOTA_EXCEEDED',
  
  // Database errors (3xxx)
  DB_CONNECTION_FAILED = 'DB_CONNECTION_FAILED',
  DB_QUERY_FAILED = 'DB_QUERY_FAILED',
  DB_RECORD_NOT_FOUND = 'DB_RECORD_NOT_FOUND',
  DB_DUPLICATE_ENTRY = 'DB_DUPLICATE_ENTRY',
  DB_CONSTRAINT_VIOLATION = 'DB_CONSTRAINT_VIOLATION',
  
  // Network errors (4xxx)
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  NETWORK_CONNECTION_REFUSED = 'NETWORK_CONNECTION_REFUSED',
  NETWORK_DNS_FAILED = 'NETWORK_DNS_FAILED',
  
  // Validation errors (5xxx)
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  VALIDATION_MISSING_FIELD = 'VALIDATION_MISSING_FIELD',
  VALIDATION_INVALID_FORMAT = 'VALIDATION_INVALID_FORMAT',
  
  // Business logic errors (6xxx)
  CLAIM_NOT_FOUND = 'CLAIM_NOT_FOUND',
  CLAIM_ALREADY_FILED = 'CLAIM_ALREADY_FILED',
  CLAIM_EXPIRED = 'CLAIM_EXPIRED',
  EVIDENCE_NOT_FOUND = 'EVIDENCE_NOT_FOUND',
  EVIDENCE_MATCH_FAILED = 'EVIDENCE_MATCH_FAILED',
  
  // External service errors (7xxx)
  STRIPE_ERROR = 'STRIPE_ERROR',
  GMAIL_ERROR = 'GMAIL_ERROR',
  REDIS_ERROR = 'REDIS_ERROR',
  
  // Generic errors (9xxx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  BAD_REQUEST = 'BAD_REQUEST',
}

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  statusCode: number;
  retryable: boolean;
  retryAfterMs?: number;
  context?: Record<string, any>;
}

/**
 * Base Application Error
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly context?: Record<string, any>;
  public readonly timestamp: Date;

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = this.constructor.name;
    this.code = details.code;
    this.statusCode = details.statusCode;
    this.isOperational = true;
    this.retryable = details.retryable;
    this.retryAfterMs = details.retryAfterMs;
    this.context = details.context;
    this.timestamp = new Date();
    
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, any> {
    return {
      error: true,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

/**
 * Authentication Errors
 */
export class AuthError extends AppError {
  constructor(code: ErrorCode, message: string, context?: Record<string, any>) {
    super({
      code,
      message,
      statusCode: code === ErrorCode.AUTH_FORBIDDEN ? 403 : 401,
      retryable: code === ErrorCode.AUTH_TOKEN_EXPIRED,
      context,
    });
  }

  static tokenExpired(context?: Record<string, any>): AuthError {
    return new AuthError(
      ErrorCode.AUTH_TOKEN_EXPIRED,
      'Authentication token has expired. Please re-authenticate.',
      context
    );
  }

  static unauthorized(message = 'Authentication required'): AuthError {
    return new AuthError(ErrorCode.AUTH_UNAUTHORIZED, message);
  }

  static forbidden(message = 'Access denied'): AuthError {
    return new AuthError(ErrorCode.AUTH_FORBIDDEN, message);
  }
}

/**
 * Amazon SP-API Errors
 */
export class SPAPIError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    retryAfterMs?: number,
    context?: Record<string, any>
  ) {
    super({
      code,
      message,
      statusCode: code === ErrorCode.SPAPI_RATE_LIMITED ? 429 : 502,
      retryable: [
        ErrorCode.SPAPI_RATE_LIMITED,
        ErrorCode.SPAPI_TOKEN_EXPIRED,
        ErrorCode.SPAPI_REQUEST_FAILED,
      ].includes(code),
      retryAfterMs,
      context,
    });
  }

  static rateLimited(retryAfterMs = 60000, context?: Record<string, any>): SPAPIError {
    return new SPAPIError(
      ErrorCode.SPAPI_RATE_LIMITED,
      `Amazon SP-API rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      retryAfterMs,
      context
    );
  }

  static tokenExpired(context?: Record<string, any>): SPAPIError {
    return new SPAPIError(
      ErrorCode.SPAPI_TOKEN_EXPIRED,
      'Amazon SP-API access token has expired. Refreshing token...',
      5000,
      context
    );
  }

  static invalidCredentials(context?: Record<string, any>): SPAPIError {
    return new SPAPIError(
      ErrorCode.SPAPI_INVALID_CREDENTIALS,
      'Invalid Amazon SP-API credentials. Please reconnect your Amazon account.',
      undefined,
      context
    );
  }

  static requestFailed(originalError: string, context?: Record<string, any>): SPAPIError {
    return new SPAPIError(
      ErrorCode.SPAPI_REQUEST_FAILED,
      `Amazon SP-API request failed: ${originalError}`,
      10000,
      context
    );
  }

  static quotaExceeded(context?: Record<string, any>): SPAPIError {
    return new SPAPIError(
      ErrorCode.SPAPI_QUOTA_EXCEEDED,
      'Amazon SP-API daily quota exceeded. Please try again tomorrow.',
      undefined,
      context
    );
  }
}

/**
 * Database Errors
 */
export class DatabaseError extends AppError {
  constructor(code: ErrorCode, message: string, context?: Record<string, any>) {
    super({
      code,
      message,
      statusCode: 503,
      retryable: [ErrorCode.DB_CONNECTION_FAILED, ErrorCode.DB_QUERY_FAILED].includes(code),
      retryAfterMs: code === ErrorCode.DB_CONNECTION_FAILED ? 5000 : 1000,
      context,
    });
  }

  static connectionFailed(originalError: string, context?: Record<string, any>): DatabaseError {
    return new DatabaseError(
      ErrorCode.DB_CONNECTION_FAILED,
      `Database connection failed: ${originalError}`,
      context
    );
  }

  static queryFailed(originalError: string, context?: Record<string, any>): DatabaseError {
    return new DatabaseError(
      ErrorCode.DB_QUERY_FAILED,
      `Database query failed: ${originalError}`,
      context
    );
  }

  static notFound(entity: string, id: string): DatabaseError {
    return new DatabaseError(
      ErrorCode.DB_RECORD_NOT_FOUND,
      `${entity} with ID ${id} not found`,
      { entity, id }
    );
  }

  static duplicateEntry(field: string, value: string): DatabaseError {
    return new DatabaseError(
      ErrorCode.DB_DUPLICATE_ENTRY,
      `Duplicate entry for ${field}: ${value}`,
      { field, value }
    );
  }
}

/**
 * Network Errors
 */
export class NetworkError extends AppError {
  constructor(code: ErrorCode, message: string, context?: Record<string, any>) {
    super({
      code,
      message,
      statusCode: 504,
      retryable: true,
      retryAfterMs: 5000,
      context,
    });
  }

  static timeout(service: string, timeoutMs: number): NetworkError {
    return new NetworkError(
      ErrorCode.NETWORK_TIMEOUT,
      `Request to ${service} timed out after ${timeoutMs}ms`,
      { service, timeoutMs }
    );
  }

  static connectionRefused(service: string, url: string): NetworkError {
    return new NetworkError(
      ErrorCode.NETWORK_CONNECTION_REFUSED,
      `Connection to ${service} refused`,
      { service, url }
    );
  }
}

/**
 * Validation Errors
 */
export class ValidationError extends AppError {
  public readonly fields: Record<string, string>;

  constructor(message: string, fields: Record<string, string> = {}) {
    super({
      code: ErrorCode.VALIDATION_FAILED,
      message,
      statusCode: 400,
      retryable: false,
      context: { fields },
    });
    this.fields = fields;
  }

  static missingField(field: string): ValidationError {
    return new ValidationError(
      `Missing required field: ${field}`,
      { [field]: 'This field is required' }
    );
  }

  static invalidFormat(field: string, expectedFormat: string): ValidationError {
    return new ValidationError(
      `Invalid format for field: ${field}`,
      { [field]: `Expected format: ${expectedFormat}` }
    );
  }

  static multiple(errors: Record<string, string>): ValidationError {
    const messages = Object.entries(errors).map(([field, msg]) => `${field}: ${msg}`);
    return new ValidationError(
      `Validation failed: ${messages.join(', ')}`,
      errors
    );
  }
}

/**
 * Business Logic Errors
 */
export class BusinessError extends AppError {
  constructor(code: ErrorCode, message: string, context?: Record<string, any>) {
    super({
      code,
      message,
      statusCode: 422,
      retryable: false,
      context,
    });
  }

  static claimNotFound(claimId: string): BusinessError {
    return new BusinessError(
      ErrorCode.CLAIM_NOT_FOUND,
      `Claim ${claimId} not found`,
      { claimId }
    );
  }

  static claimAlreadyFiled(claimId: string): BusinessError {
    return new BusinessError(
      ErrorCode.CLAIM_ALREADY_FILED,
      `Claim ${claimId} has already been filed`,
      { claimId }
    );
  }

  static claimExpired(claimId: string, deadline: Date): BusinessError {
    return new BusinessError(
      ErrorCode.CLAIM_EXPIRED,
      `Claim ${claimId} has expired. Deadline was ${deadline.toISOString()}`,
      { claimId, deadline: deadline.toISOString() }
    );
  }

  static evidenceNotFound(evidenceId: string): BusinessError {
    return new BusinessError(
      ErrorCode.EVIDENCE_NOT_FOUND,
      `Evidence ${evidenceId} not found`,
      { evidenceId }
    );
  }
}

/**
 * Utility to determine if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.retryable;
  }
  
  // Check for common retryable error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('service unavailable')
    );
  }
  
  return false;
}

/**
 * Utility to extract retry delay from error
 */
export function getRetryDelay(error: unknown, defaultMs = 5000): number {
  if (error instanceof AppError && error.retryAfterMs) {
    return error.retryAfterMs;
  }
  return defaultMs;
}

/**
 * Wrap an async function with automatic retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 30000, onRetry } = options;
  
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (!isRetryableError(error) || attempt === maxAttempts) {
        throw error;
      }
      
      const delay = Math.min(
        getRetryDelay(error, baseDelayMs * Math.pow(2, attempt - 1)),
        maxDelayMs
      );
      
      if (onRetry) {
        onRetry(attempt, error);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

