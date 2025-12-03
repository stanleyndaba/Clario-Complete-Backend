/**
 * Comprehensive Error Handling Utilities
 * Provides reusable error handling functions for common scenarios
 */

import logger from './logger';
import { 
  AppError, 
  AuthError, 
  SPAPIError, 
  DatabaseError, 
  NetworkError,
  ValidationError,
  BusinessError,
  ErrorCode,
  isRetryableError,
  getRetryDelay,
  withRetry
} from './errors';
import { SPAPIRateLimiter } from './rateLimitHandler';

// Default timeout for API calls (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

// Default retry configuration
const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Handle OAuth token errors with automatic refresh
 */
export async function handleOAuthTokenError<T>(
  error: any,
  refreshFn: () => Promise<void>,
  retryFn: () => Promise<T>,
  userId?: string,
  provider: string = 'amazon'
): Promise<T> {
  // Check if it's a token expiration error
  const isTokenError = 
    error.response?.status === 401 ||
    error.response?.status === 403 ||
    error.message?.toLowerCase().includes('token') ||
    error.message?.toLowerCase().includes('unauthorized') ||
    error.message?.toLowerCase().includes('expired');

  if (!isTokenError) {
    throw error;
  }

  logger.info(`🔄 [ERROR HANDLER] Token expired for ${provider}, attempting refresh`, {
    userId,
    provider,
    error: error.message
  });

  try {
    // Attempt to refresh token
    await refreshFn();
    
    // Retry the original request
    logger.info(`✅ [ERROR HANDLER] Token refreshed, retrying request`, { userId, provider });
    return await retryFn();
  } catch (refreshError: any) {
    logger.error(`❌ [ERROR HANDLER] Token refresh failed`, {
      userId,
      provider,
      error: refreshError.message
    });

    // If refresh fails, throw a user-friendly error
    throw AuthError.tokenExpired({
      userId,
      provider,
      originalError: refreshError.message,
      requiresReconnection: true
    });
  }
}

/**
 * Handle SP-API rate limit errors with automatic retry
 */
export async function handleRateLimitError<T>(
  error: any,
  rateLimiter: SPAPIRateLimiter,
  retryFn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  const isRateLimitError = 
    error.response?.status === 429 ||
    error.code === 'SPAPI_RATE_LIMITED' ||
    error.message?.toLowerCase().includes('rate limit') ||
    error.message?.toLowerCase().includes('too many requests');

  if (!isRateLimitError) {
    throw error;
  }

  logger.warn(`⏸️ [ERROR HANDLER] Rate limit detected, queuing request`, {
    status: error.response?.status,
    retryAfter: error.response?.headers?.['retry-after']
  });

  // Use rate limiter to execute with retry
  return rateLimiter.execute(retryFn, { maxRetries });
}

/**
 * Handle network timeout errors with retry
 */
export async function handleNetworkError<T>(
  error: any,
  service: string,
  retryFn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  const isNetworkError = 
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND' ||
    error.message?.toLowerCase().includes('timeout') ||
    error.message?.toLowerCase().includes('connection refused') ||
    error.message?.toLowerCase().includes('network');

  if (!isNetworkError) {
    throw error;
  }

  logger.warn(`🌐 [ERROR HANDLER] Network error for ${service}`, {
    service,
    code: error.code,
    message: error.message
  });

  // Retry with exponential backoff
  return withRetry(retryFn, {
    maxAttempts: maxRetries,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    onRetry: (attempt, err) => {
      logger.info(`🔄 [ERROR HANDLER] Retrying network request (attempt ${attempt}/${maxRetries})`, {
        service,
        attempt
      });
    }
  });
}

/**
 * Handle database connection errors with retry
 */
export async function handleDatabaseError<T>(
  error: any,
  operation: string,
  retryFn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  const isDbError = 
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT' ||
    error.message?.toLowerCase().includes('connection') ||
    error.message?.toLowerCase().includes('database') ||
    error.message?.toLowerCase().includes('query') ||
    error.message?.toLowerCase().includes('timeout');

  if (!isDbError) {
    throw error;
  }

  logger.warn(`💾 [ERROR HANDLER] Database error during ${operation}`, {
    operation,
    code: error.code,
    message: error.message
  });

  // Retry with exponential backoff
  return withRetry(retryFn, {
    maxAttempts: maxRetries,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    onRetry: (attempt, err) => {
      logger.info(`🔄 [ERROR HANDLER] Retrying database operation (attempt ${attempt}/${maxRetries})`, {
        operation,
        attempt
      });
    }
  });
}

/**
 * Wrap an API call with comprehensive error handling
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  options: {
    service?: string;
    operation?: string;
    userId?: string;
    provider?: string;
    refreshTokenFn?: () => Promise<void>;
    rateLimiter?: SPAPIRateLimiter;
    timeoutMs?: number;
    maxRetries?: number;
  } = {}
): Promise<T> {
  const {
    service = 'unknown',
    operation = 'operation',
    userId,
    provider,
    refreshTokenFn,
    rateLimiter,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = 3
  } = options;

  // Create a timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(NetworkError.timeout(service, timeoutMs));
    }, timeoutMs);
  });

  // Race between the function and timeout
  const executeWithTimeout = async (): Promise<T> => {
    return Promise.race([fn(), timeoutPromise]);
  };

  try {
    return await executeWithTimeout();
  } catch (error: any) {
    // Handle OAuth token errors
    if (refreshTokenFn) {
      try {
        return await handleOAuthTokenError(
          error,
          refreshTokenFn,
          executeWithTimeout,
          userId,
          provider
        );
      } catch (tokenError) {
        // If token refresh fails, continue to other handlers
        if (tokenError instanceof AuthError) {
          throw tokenError;
        }
      }
    }

    // Handle rate limit errors
    if (rateLimiter) {
      try {
        return await handleRateLimitError(
          error,
          rateLimiter,
          executeWithTimeout,
          maxRetries
        );
      } catch (rateLimitError) {
        // If rate limit handling fails, continue to other handlers
        if (rateLimitError instanceof SPAPIError) {
          throw rateLimitError;
        }
      }
    }

    // Handle network errors
    try {
      return await handleNetworkError(
        error,
        service,
        executeWithTimeout,
        maxRetries
      );
    } catch (networkError) {
      // If network retry fails, throw the original error
      if (networkError instanceof NetworkError) {
        throw networkError;
      }
    }

    // If none of the handlers worked, throw the original error
    throw error;
  }
}

/**
 * Validate claim data structure
 */
export function validateClaimData(claim: any): void {
  const errors: Record<string, string> = {};

  // Required fields
  if (!claim.claim_id && !claim.id) {
    errors.claim_id = 'Claim ID is required';
  }

  if (!claim.user_id && !claim.seller_id) {
    errors.user_id = 'User ID or Seller ID is required';
  }

  if (claim.amount === undefined || claim.amount === null) {
    errors.amount = 'Amount is required';
  } else if (typeof claim.amount !== 'number' || claim.amount <= 0) {
    errors.amount = 'Amount must be a positive number';
  }

  if (claim.amount && claim.amount > 100000) {
    errors.amount = 'Amount exceeds maximum allowed value ($100,000)';
  }

  // Date validation
  if (claim.claim_date) {
    const claimDate = new Date(claim.claim_date);
    if (isNaN(claimDate.getTime())) {
      errors.claim_date = 'Invalid claim date format';
    } else if (claimDate > new Date()) {
      errors.claim_date = 'Claim date cannot be in the future';
    }
  }

  // Category validation
  if (claim.category && typeof claim.category !== 'string') {
    errors.category = 'Category must be a string';
  }

  if (Object.keys(errors).length > 0) {
    throw ValidationError.multiple(errors);
  }
}

/**
 * Check for duplicate claims
 */
export async function checkDuplicateClaim(
  claimId: string,
  checkFn: (id: string) => Promise<boolean>
): Promise<void> {
  try {
    const exists = await checkFn(claimId);
    if (exists) {
      throw BusinessError.claimAlreadyFiled(claimId);
    }
  } catch (error) {
    // If it's already a BusinessError, re-throw it
    if (error instanceof BusinessError) {
      throw error;
    }
    // Otherwise, log and re-throw
    logger.error('Error checking for duplicate claim', {
      claimId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Handle empty evidence results
 */
export function handleEmptyEvidence(
  evidenceCount: number,
  claimId: string
): void {
  if (evidenceCount === 0) {
    logger.warn('⚠️ [ERROR HANDLER] No evidence found for claim', { claimId });
    // Don't throw - allow the process to continue but log it
    // The matching engine will handle empty evidence gracefully
  }
}

/**
 * Handle document parsing failures
 */
export function handleParsingFailure(
  error: any,
  documentId: string,
  retryCount: number = 0,
  maxRetries: number = 3
): { shouldRetry: boolean; error: AppError } {
  const isRetryable = 
    error.message?.toLowerCase().includes('timeout') ||
    error.message?.toLowerCase().includes('network') ||
    error.message?.toLowerCase().includes('connection');

  if (isRetryable && retryCount < maxRetries) {
    logger.info(`🔄 [ERROR HANDLER] Parsing failure is retryable, will retry`, {
      documentId,
      retryCount: retryCount + 1,
      maxRetries
    });
    return { shouldRetry: true, error: error as AppError };
  }

  // Non-retryable error or max retries reached
  logger.error(`❌ [ERROR HANDLER] Document parsing failed permanently`, {
    documentId,
    retryCount,
    error: error.message
  });

  return {
    shouldRetry: false,
    error: new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `Document parsing failed: ${error.message}`,
      statusCode: 422,
      retryable: false,
      context: { documentId, retryCount }
    })
  };
}

/**
 * Handle payment failures with retry logic
 */
export async function handlePaymentFailure(
  error: any,
  retryFn: () => Promise<any>,
  maxRetries: number = 3
): Promise<any> {
  // Card errors are NOT retryable (card declined, insufficient funds, etc.)
  const isNonRetryableError = 
    error.type === 'StripeCardError' ||
    error.message?.toLowerCase().includes('card declined') ||
    error.message?.toLowerCase().includes('insufficient funds');

  // Rate limit and timeout errors ARE retryable
  const isRetryablePaymentError = 
    error.type === 'StripeRateLimitError' ||
    error.message?.toLowerCase().includes('rate limit') ||
    error.message?.toLowerCase().includes('timeout');

  if (isNonRetryableError || !isRetryablePaymentError) {
    // Non-retryable payment errors (e.g., card declined, insufficient funds)
    throw new AppError({
      code: ErrorCode.STRIPE_ERROR,
      message: `Payment failed: ${error.message || error.type || 'Unknown error'}`,
      statusCode: 402,
      retryable: false,
      context: { stripeError: error.type || 'unknown' }
    });
  }

  // Retry with exponential backoff
  return withRetry(retryFn, {
    maxAttempts: maxRetries,
    baseDelayMs: 2000,
    maxDelayMs: 10000,
    onRetry: (attempt, err) => {
      logger.info(`🔄 [ERROR HANDLER] Retrying payment (attempt ${attempt}/${maxRetries})`, {
        attempt,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });
}

