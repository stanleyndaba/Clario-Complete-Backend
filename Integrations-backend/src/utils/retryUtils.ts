/**
 * Retry Utility
 * 
 * Provides exponential backoff retry logic for API calls and async operations.
 * Used throughout the sync system to ensure reliability.
 */

import logger from './logger';

export interface RetryOptions {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    retryableErrors?: string[];
    onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
}

export interface RetryResult<T> {
    success: boolean;
    data?: T;
    error?: Error;
    attempts: number;
    totalTimeMs: number;
}

// Default retryable HTTP status codes
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

// Default retryable error codes
const RETRYABLE_ERROR_CODES = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    'RATE_LIMITED',
    'SERVICE_UNAVAILABLE',
    'GATEWAY_TIMEOUT'
];

/**
 * Sleep for a given number of milliseconds
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: any): boolean {
    // Check HTTP status codes
    if (error.status && RETRYABLE_STATUS_CODES.includes(error.status)) {
        return true;
    }
    if (error.response?.status && RETRYABLE_STATUS_CODES.includes(error.response.status)) {
        return true;
    }

    // Check error codes
    if (error.code && RETRYABLE_ERROR_CODES.includes(error.code)) {
        return true;
    }

    // Check error message for common transient issues
    const message = error.message?.toLowerCase() || '';
    if (
        message.includes('rate limit') ||
        message.includes('too many requests') ||
        message.includes('timeout') ||
        message.includes('temporarily unavailable') ||
        message.includes('service unavailable')
    ) {
        return true;
    }

    return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
    attempt: number,
    initialDelayMs: number,
    maxDelayMs: number,
    backoffMultiplier: number
): number {
    const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
    return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<RetryResult<T>> {
    const {
        maxRetries = 3,
        initialDelayMs = 1000,
        maxDelayMs = 30000,
        backoffMultiplier = 2,
        onRetry
    } = options;

    const startTime = Date.now();
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt <= maxRetries) {
        attempt++;

        try {
            const data = await fn();
            return {
                success: true,
                data,
                attempts: attempt,
                totalTimeMs: Date.now() - startTime
            };
        } catch (error: any) {
            lastError = error;

            // Check if we should retry
            if (attempt <= maxRetries && isRetryableError(error)) {
                const delayMs = calculateDelay(attempt, initialDelayMs, maxDelayMs, backoffMultiplier);

                logger.warn(`Retry attempt ${attempt}/${maxRetries} after ${delayMs}ms`, {
                    error: error.message,
                    code: error.code || error.status,
                    attempt
                });

                if (onRetry) {
                    onRetry(attempt, error, delayMs);
                }

                await sleep(delayMs);
                continue;
            }

            // Non-retryable error or max retries exceeded
            break;
        }
    }

    return {
        success: false,
        error: lastError,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime
    };
}

/**
 * Structured error response for sync operations
 */
export interface SyncError {
    code: SyncErrorCode;
    message: string;
    nextAction: SyncNextAction;
    retryInSeconds?: number;
    details?: string;
}

export type SyncErrorCode =
    | 'RATE_LIMITED'
    | 'AUTH_EXPIRED'
    | 'AUTH_INVALID'
    | 'API_DOWN'
    | 'TIMEOUT'
    | 'DATA_ERROR'
    | 'NETWORK_ERROR'
    | 'UNKNOWN';

export type SyncNextAction =
    | 'auto_retry'
    | 'needs_reconnect'
    | 'needs_wait'
    | 'contact_support'
    | 'check_data';

/**
 * Convert any error to a structured SyncError
 */
export function toSyncError(error: any): SyncError {
    const message = error.message || 'Unknown error occurred';
    const status = error.status || error.response?.status;
    const code = error.code;

    // Rate limited
    if (status === 429 || message.toLowerCase().includes('rate limit')) {
        return {
            code: 'RATE_LIMITED',
            message: 'Amazon API rate limit reached. Sync will retry automatically.',
            nextAction: 'auto_retry',
            retryInSeconds: 60
        };
    }

    // Auth issues
    if (status === 401 || status === 403 || message.includes('unauthorized') || message.includes('forbidden')) {
        return {
            code: 'AUTH_EXPIRED',
            message: 'Amazon connection expired. Please reconnect your account.',
            nextAction: 'needs_reconnect'
        };
    }

    // Server errors
    if (status >= 500 && status < 600) {
        return {
            code: 'API_DOWN',
            message: 'Amazon API is temporarily unavailable. Sync will retry automatically.',
            nextAction: 'auto_retry',
            retryInSeconds: 120
        };
    }

    // Timeout
    if (code === 'ETIMEDOUT' || code === 'TIMEOUT' || message.includes('timeout')) {
        return {
            code: 'TIMEOUT',
            message: 'Request timed out. Sync will retry automatically.',
            nextAction: 'auto_retry',
            retryInSeconds: 30
        };
    }

    // Network errors
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE') {
        return {
            code: 'NETWORK_ERROR',
            message: 'Network connection issue. Please check your internet connection.',
            nextAction: 'auto_retry',
            retryInSeconds: 15
        };
    }

    // Data errors (4xx except auth)
    if (status >= 400 && status < 500) {
        return {
            code: 'DATA_ERROR',
            message: 'Invalid request. Please contact support if this persists.',
            nextAction: 'contact_support',
            details: message
        };
    }

    // Unknown
    return {
        code: 'UNKNOWN',
        message: 'An unexpected error occurred. Please try again.',
        nextAction: 'contact_support',
        details: message
    };
}

export default { withRetry, isRetryableError, toSyncError };
