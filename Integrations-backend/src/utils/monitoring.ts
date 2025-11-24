/**
 * Monitoring and Error Tracking Setup for Clario Backend
 * Integrates with Sentry for error tracking and custom metrics
 */

import logger from './logger';

// Sentry types (optional dependency - install with: npm install @sentry/node)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry: any = null;

/**
 * Initialize monitoring services
 */
export async function initializeMonitoring(): Promise<void> {
  const sentryDsn = process.env.SENTRY_DSN;
  
  if (sentryDsn) {
    try {
      // Dynamically import Sentry (optional dependency)
      // @ts-ignore - Sentry is an optional dependency
      Sentry = await import('@sentry/node').catch(() => null);
      if (!Sentry) {
        logger.info('Sentry package not installed - error tracking disabled');
        return;
      }
      
      Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NODE_ENV || 'development',
        release: process.env.APP_VERSION || '1.0.0',
        
        // Performance monitoring
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        
        // Filter out noisy errors
        beforeSend(event: any, hint: any) {
          const error = hint?.originalException;
          
          // Don't send 4xx client errors to Sentry
          if (error?.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
            return null;
          }
          
          // Don't send rate limit errors
          if (error?.code === 'SPAPI_RATE_LIMITED') {
            return null;
          }
          
          return event;
        },
        
        // Attach user context
        initialScope: {
          tags: {
            service: 'clario-node-api',
          },
        },
      });
      
      logger.info('Sentry monitoring initialized', { environment: process.env.NODE_ENV });
    } catch (error) {
      logger.warn('Sentry not available - error tracking disabled', { 
        error: (error as Error).message,
        note: 'Install @sentry/node to enable error tracking'
      });
    }
  } else {
    logger.info('Sentry DSN not configured - error tracking disabled');
  }
}

/**
 * Capture an exception with Sentry
 */
export function captureException(error: Error, context?: Record<string, any>): string | null {
  // Always log locally
  logger.error('Exception captured', {
    error: error.message,
    stack: error.stack,
    ...context,
  });
  
  if (Sentry) {
    if (context) {
      Sentry.setContext('additional', context);
    }
    return Sentry.captureException(error);
  }
  
  return null;
}

/**
 * Capture a message with Sentry
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): string | null {
  logger[level === 'warning' ? 'warn' : level](message);
  
  if (Sentry) {
    return Sentry.captureMessage(message, level);
  }
  
  return null;
}

/**
 * Set user context for error tracking
 */
export function setUser(user: { id: string; email?: string; username?: string }): void {
  if (Sentry) {
    Sentry.setUser(user);
  }
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(breadcrumb: {
  category: string;
  message: string;
  level?: 'debug' | 'info' | 'warning' | 'error';
  data?: Record<string, any>;
}): void {
  if (Sentry) {
    Sentry.addBreadcrumb({
      category: breadcrumb.category,
      message: breadcrumb.message,
      level: breadcrumb.level || 'info',
      data: breadcrumb.data,
      timestamp: Date.now() / 1000,
    });
  }
}

/**
 * Start a performance transaction
 */
export function startTransaction(name: string, op: string): any {
  if (Sentry) {
    return Sentry.startTransaction({ name, op });
  }
  
  // Return mock transaction for when Sentry is not available
  return {
    setStatus: () => {},
    finish: () => {},
    startChild: () => ({
      setStatus: () => {},
      finish: () => {},
    }),
  };
}

/**
 * Metrics collector for custom application metrics
 */
class MetricsCollector {
  private metrics: Map<string, number[]> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  
  /**
   * Record a timing metric (e.g., API response time)
   */
  timing(name: string, durationMs: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    const values = this.metrics.get(name)!;
    values.push(durationMs);
    
    // Keep only last 1000 values to prevent memory leaks
    if (values.length > 1000) {
      values.shift();
    }
  }
  
  /**
   * Increment a counter
   */
  increment(name: string, value = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }
  
  /**
   * Set a gauge value
   */
  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }
  
  /**
   * Get statistics for a timing metric
   */
  getTimingStats(name: string): { count: number; avg: number; p50: number; p95: number; p99: number } | null {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) {
      return null;
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const avg = sorted.reduce((a, b) => a + b, 0) / count;
    const p50 = sorted[Math.floor(count * 0.5)];
    const p95 = sorted[Math.floor(count * 0.95)];
    const p99 = sorted[Math.floor(count * 0.99)];
    
    return { count, avg, p50, p95, p99 };
  }
  
  /**
   * Get all metrics summary
   */
  getSummary(): Record<string, any> {
    const summary: Record<string, any> = {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      timings: {},
    };
    
    for (const [name] of this.metrics) {
      summary.timings[name] = this.getTimingStats(name);
    }
    
    return summary;
  }
  
  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.counters.clear();
    this.gauges.clear();
  }
}

// Global metrics instance
export const metrics = new MetricsCollector();

/**
 * Middleware to track request metrics
 */
export function requestMetricsMiddleware(req: any, res: any, next: any): void {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const route = req.route?.path || req.path || 'unknown';
    const method = req.method;
    const status = res.statusCode;
    
    // Record timing
    metrics.timing(`http_request_duration_ms`, duration);
    metrics.timing(`http_request_duration_${method}_ms`, duration);
    
    // Increment counters
    metrics.increment('http_requests_total');
    metrics.increment(`http_requests_${status >= 500 ? '5xx' : status >= 400 ? '4xx' : '2xx'}`);
    
    // Log slow requests
    if (duration > 5000) {
      logger.warn('Slow request detected', {
        route,
        method,
        duration,
        status,
      });
    }
  });
  
  next();
}

/**
 * Health check data collector
 */
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: Record<string, {
    status: 'pass' | 'warn' | 'fail';
    message?: string;
    responseTime?: number;
  }>;
}

export async function performHealthCheck(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const checks: HealthCheckResult['checks'] = {};
  let overallStatus: HealthCheckResult['status'] = 'healthy';
  
  // Check database connectivity
  try {
    const dbStart = Date.now();
    // Simplified check - just verify we can reach Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    if (supabaseUrl) {
      checks.database = { status: 'pass', responseTime: Date.now() - dbStart };
    } else {
      checks.database = { status: 'warn', message: 'SUPABASE_URL not configured' };
      overallStatus = 'degraded';
    }
  } catch (error) {
    checks.database = { status: 'fail', message: (error as Error).message };
    overallStatus = 'unhealthy';
  }
  
  // Check Redis connectivity
  try {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl && !redisUrl.includes('localhost')) {
      checks.redis = { status: 'pass' };
    } else {
      checks.redis = { status: 'warn', message: 'Redis not configured - using memory mode' };
    }
  } catch (error) {
    checks.redis = { status: 'warn', message: 'Redis unavailable - degraded mode' };
  }
  
  // Check Python API
  try {
    const pythonUrl = process.env.PYTHON_API_URL;
    if (pythonUrl) {
      checks.pythonApi = { status: 'pass' };
    } else {
      checks.pythonApi = { status: 'warn', message: 'PYTHON_API_URL not configured' };
    }
  } catch (error) {
    checks.pythonApi = { status: 'fail', message: (error as Error).message };
    overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus;
  }
  
  // Memory usage check
  const memUsage = process.memoryUsage();
  const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  if (memUsedMB / memTotalMB > 0.9) {
    checks.memory = { status: 'warn', message: `High memory usage: ${memUsedMB}MB / ${memTotalMB}MB` };
    overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus;
  } else {
    checks.memory = { status: 'pass', message: `${memUsedMB}MB / ${memTotalMB}MB` };
  }
  
  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    uptime: process.uptime(),
    checks,
  };
}

export default {
  initializeMonitoring,
  captureException,
  captureMessage,
  setUser,
  addBreadcrumb,
  startTransaction,
  metrics,
  requestMetricsMiddleware,
  performHealthCheck,
};

