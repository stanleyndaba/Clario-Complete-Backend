import { getLogger } from '../../../shared/utils/logger';

const logger = getLogger('RetryHandler');

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
}

class RetryHandler {
  private readonly DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    shouldRetry: this.defaultShouldRetry,
  };

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    const options: Required<RetryOptions> = {
      ...this.DEFAULT_OPTIONS,
      maxRetries,
      baseDelay,
    };

    let lastError: any;
    let delay = options.baseDelay;

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if we should retry this error
        if (attempt === options.maxRetries || !options.shouldRetry(error)) {
          logger.error(`Operation failed after ${attempt + 1} attempts:`, error);
          throw error;
        }

        logger.warn(`Operation failed (attempt ${attempt + 1}/${options.maxRetries + 1}), retrying in ${delay}ms:`, error);

        // Wait before retrying
        await this.delay(delay);

        // Calculate next delay with exponential backoff
        delay = Math.min(delay * options.backoffMultiplier, options.maxDelay);
      }
    }

    throw lastError;
  }

  private defaultShouldRetry(error: any): boolean {
    // Retry on rate limiting, timeout, and network errors
    const retryableErrors = [
      'ThrottlingException',
      'QuotaExceededException',
      'RequestThrottled',
      'TooManyRequestsException',
      'RequestTimeout',
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNREFUSED',
    ];

    // Check if error message contains retryable error keywords
    const errorMessage = error.message || error.toString();
    const isRetryableError = retryableErrors.some(retryableError =>
      errorMessage.includes(retryableError)
    );

    // Check HTTP status codes for retryable errors
    const isRetryableStatusCode = error.status >= 500 || error.status === 429;

    return isRetryableError || isRetryableStatusCode;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Method for handling Amazon SP-API specific retry logic
  async executeAmazonApiCall<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const amazonOptions: Required<RetryOptions> = {
      ...this.DEFAULT_OPTIONS,
      ...options,
      shouldRetry: this.amazonShouldRetry,
    };

    return this.executeWithRetry(operation, amazonOptions.maxRetries, amazonOptions.baseDelay);
  }

  private amazonShouldRetry(error: any): boolean {
    // Amazon SP-API specific retry logic
    const amazonRetryableErrors = [
      'ThrottlingException',
      'QuotaExceededException',
      'RequestThrottled',
      'TooManyRequestsException',
      'InternalServerError',
      'ServiceUnavailable',
      'RequestTimeout',
    ];

    const errorMessage = error.message || error.toString();
    const isAmazonRetryableError = amazonRetryableErrors.some(retryableError =>
      errorMessage.includes(retryableError)
    );

    // Check for rate limiting headers
    const hasRateLimitHeaders = error.response?.headers?.['x-amzn-ratelimit-remaining'] !== undefined;

    return isAmazonRetryableError || hasRateLimitHeaders;
  }

  // Method for handling batch operations with individual retry logic
  async executeBatchWithRetry<T, R>(
    items: T[],
    operation: (item: T) => Promise<R>,
    options: RetryOptions & { concurrency?: number } = {}
  ): Promise<R[]> {
    const { concurrency = 1, ...retryOptions } = options;
    const results: R[] = [];
    const errors: Array<{ item: T; error: any }> = [];

    // Process items in batches based on concurrency
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchPromises = batch.map(async (item) => {
        try {
          const result = await this.executeWithRetry(
            () => operation(item),
            retryOptions.maxRetries,
            retryOptions.baseDelay
          );
          return { success: true, result };
        } catch (error) {
          logger.error(`Failed to process item in batch:`, error);
          return { success: false, error, item };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      // Collect results and errors
      batchResults.forEach((result) => {
        if (result.success) {
          results.push(result.result);
        } else {
          errors.push({ item: result.item, error: result.error });
        }
      });

      // Add delay between batches to avoid overwhelming the API
      if (i + concurrency < items.length) {
        await this.delay(1000);
      }
    }

    // Log summary
    logger.info(`Batch operation completed: ${results.length} successful, ${errors.length} failed`);

    if (errors.length > 0) {
      logger.warn(`Batch operation had ${errors.length} failures:`, errors);
    }

    return results;
  }

  // Method for handling pagination with retry logic
  async executePaginatedWithRetry<T>(
    initialOperation: () => Promise<{ data: T[]; nextToken?: string }>,
    nextPageOperation: (nextToken: string) => Promise<{ data: T[]; nextToken?: string }>,
    options: RetryOptions = {}
  ): Promise<T[]> {
    const allData: T[] = [];
    let nextToken: string | undefined;

    try {
      // Get first page
      const firstPage = await this.executeWithRetry(
        initialOperation,
        options.maxRetries,
        options.baseDelay
      );

      allData.push(...firstPage.data);
      nextToken = firstPage.nextToken;

      // Get subsequent pages
      while (nextToken) {
        const page = await this.executeWithRetry(
          () => nextPageOperation(nextToken!),
          options.maxRetries,
          options.baseDelay
        );

        allData.push(...page.data);
        nextToken = page.nextToken;

        // Add delay between pages to avoid rate limiting
        if (nextToken) {
          await this.delay(500);
        }
      }

      logger.info(`Paginated operation completed: collected ${allData.length} items`);
      return allData;

    } catch (error) {
      logger.error('Error in paginated operation:', error);
      throw error;
    }
  }
}

export const retryHandler = new RetryHandler();
export default retryHandler; 