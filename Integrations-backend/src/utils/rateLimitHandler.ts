/**
 * Rate Limit Handler for Amazon SP-API
 * Implements exponential backoff and request queuing
 */

import logger from './logger';
import { SPAPIError } from './errors';

interface RateLimitState {
  requestCount: number;
  windowStart: number;
  backoffUntil: number | null;
  consecutiveFailures: number;
}

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  retries: number;
  maxRetries: number;
}

/**
 * SP-API Rate Limit Handler
 * - Tracks request counts per minute
 * - Implements exponential backoff on 429 errors
 * - Queues requests when rate limited
 */
export class SPAPIRateLimiter {
  private state: RateLimitState = {
    requestCount: 0,
    windowStart: Date.now(),
    backoffUntil: null,
    consecutiveFailures: 0,
  };
  
  private requestQueue: QueuedRequest<any>[] = [];
  private isProcessingQueue = false;
  private windowDurationMs = 60000; // 1 minute window
  private maxRequestsPerWindow: number;
  
  constructor(
    private readonly serviceName: string = 'amazon-sp-api',
    maxRequestsPerMinute: number = 30 // SP-API default is ~30 requests/minute
  ) {
    this.maxRequestsPerWindow = maxRequestsPerMinute;
    
    // Reset window periodically
    setInterval(() => this.resetWindowIfNeeded(), 10000);
  }
  
  /**
   * Reset the rate limit window if it has expired
   */
  private resetWindowIfNeeded(): void {
    const now = Date.now();
    if (now - this.state.windowStart >= this.windowDurationMs) {
      this.state.requestCount = 0;
      this.state.windowStart = now;
    }
  }
  
  /**
   * Calculate backoff delay using exponential backoff with jitter
   */
  private calculateBackoff(failures: number): number {
    // Base delay: 1 second, max: 5 minutes
    const baseDelay = 1000;
    const maxDelay = 300000;
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, failures), maxDelay);
    // Add jitter (0-20% of delay)
    const jitter = exponentialDelay * Math.random() * 0.2;
    return Math.floor(exponentialDelay + jitter);
  }
  
  /**
   * Check if we're currently rate limited
   */
  isRateLimited(): boolean {
    this.resetWindowIfNeeded();
    
    // Check if we're in backoff period
    if (this.state.backoffUntil && Date.now() < this.state.backoffUntil) {
      return true;
    }
    
    // Check if we've exceeded requests in this window
    return this.state.requestCount >= this.maxRequestsPerWindow;
  }
  
  /**
   * Get time until rate limit resets (in ms)
   */
  getTimeUntilReset(): number {
    if (this.state.backoffUntil && Date.now() < this.state.backoffUntil) {
      return this.state.backoffUntil - Date.now();
    }
    
    if (this.state.requestCount >= this.maxRequestsPerWindow) {
      return this.windowDurationMs - (Date.now() - this.state.windowStart);
    }
    
    return 0;
  }
  
  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.state.requestCount++;
    this.state.consecutiveFailures = 0;
    this.state.backoffUntil = null;
  }
  
  /**
   * Record a rate limit error (429)
   */
  recordRateLimit(retryAfterHeader?: string): void {
    this.state.consecutiveFailures++;
    
    // Parse Retry-After header if present
    let backoffMs: number;
    if (retryAfterHeader) {
      const retryAfterSeconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(retryAfterSeconds)) {
        backoffMs = retryAfterSeconds * 1000;
      } else {
        backoffMs = this.calculateBackoff(this.state.consecutiveFailures);
      }
    } else {
      backoffMs = this.calculateBackoff(this.state.consecutiveFailures);
    }
    
    this.state.backoffUntil = Date.now() + backoffMs;
    
    logger.warn('SP-API rate limit hit', {
      service: this.serviceName,
      consecutiveFailures: this.state.consecutiveFailures,
      backoffMs,
      backoffUntil: new Date(this.state.backoffUntil).toISOString(),
    });
  }
  
  /**
   * Execute a request with rate limit handling
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: { maxRetries?: number; priority?: 'high' | 'normal' | 'low' } = {}
  ): Promise<T> {
    const { maxRetries = 3, priority = 'normal' } = options;
    
    // If rate limited, queue the request
    if (this.isRateLimited()) {
      const timeUntilReset = this.getTimeUntilReset();
      logger.info('Request queued due to rate limit', {
        service: this.serviceName,
        timeUntilReset,
        queueSize: this.requestQueue.length,
      });
      
      return new Promise((resolve, reject) => {
        const queuedRequest: QueuedRequest<T> = {
          execute: fn,
          resolve,
          reject,
          retries: 0,
          maxRetries,
        };
        
        // Priority queue: high priority requests go to front
        if (priority === 'high') {
          this.requestQueue.unshift(queuedRequest);
        } else {
          this.requestQueue.push(queuedRequest);
        }
        
        // Start processing queue if not already doing so
        this.processQueue();
      });
    }
    
    // Execute immediately
    return this.executeWithRetry(fn, maxRetries);
  }
  
  /**
   * Execute a request with automatic retry on rate limit
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    currentRetry = 0
  ): Promise<T> {
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error: any) {
      // Check if it's a rate limit error
      const isRateLimitError = 
        error.response?.status === 429 ||
        error.code === 'SPAPI_RATE_LIMITED' ||
        error.message?.toLowerCase().includes('rate limit') ||
        error.message?.toLowerCase().includes('too many requests');
      
      if (isRateLimitError) {
        this.recordRateLimit(error.response?.headers?.['retry-after']);
        
        if (currentRetry < maxRetries) {
          const waitTime = this.getTimeUntilReset() || this.calculateBackoff(currentRetry);
          
          logger.info('Retrying after rate limit', {
            service: this.serviceName,
            retry: currentRetry + 1,
            maxRetries,
            waitTime,
          });
          
          await this.sleep(waitTime);
          return this.executeWithRetry(fn, maxRetries, currentRetry + 1);
        }
        
        throw SPAPIError.rateLimited(this.getTimeUntilReset(), {
          consecutiveFailures: this.state.consecutiveFailures,
          queueSize: this.requestQueue.length,
        });
      }
      
      // Check if it's a token expired error
      if (error.response?.status === 401 || error.message?.includes('token')) {
        throw SPAPIError.tokenExpired({
          originalError: error.message,
        });
      }
      
      // Re-throw other errors
      throw error;
    }
  }
  
  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    while (this.requestQueue.length > 0) {
      // Wait if rate limited
      if (this.isRateLimited()) {
        const waitTime = this.getTimeUntilReset();
        if (waitTime > 0) {
          await this.sleep(waitTime);
        }
      }
      
      const request = this.requestQueue.shift();
      if (!request) break;
      
      try {
        const result = await this.executeWithRetry(
          request.execute,
          request.maxRetries,
          request.retries
        );
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
      
      // Small delay between requests to be nice to the API
      await this.sleep(100);
    }
    
    this.isProcessingQueue = false;
  }
  
  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get current state for monitoring
   */
  getState(): {
    requestCount: number;
    isRateLimited: boolean;
    queueSize: number;
    consecutiveFailures: number;
  } {
    return {
      requestCount: this.state.requestCount,
      isRateLimited: this.isRateLimited(),
      queueSize: this.requestQueue.length,
      consecutiveFailures: this.state.consecutiveFailures,
    };
  }
}

// Global rate limiter instance for SP-API
export const spApiRateLimiter = new SPAPIRateLimiter('amazon-sp-api', 30);

export default SPAPIRateLimiter;

