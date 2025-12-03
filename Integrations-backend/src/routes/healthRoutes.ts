/**
 * Health Check Routes
 * 
 * Provides health check endpoints for monitoring and load balancing
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import amazonService from '../services/amazonService';
import { metrics, performHealthCheck } from '../utils/monitoring';

const router = Router();

/**
 * Basic health check (fast, no dependencies)
 * GET /health
 */
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'integrations-backend',
    version: process.env.npm_package_version || '1.0.0',
  });
});

/**
 * Comprehensive health check (checks database and API keys)
 * GET /healthz
 */
router.get('/healthz', async (req: Request, res: Response) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'integrations-backend',
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      database: { status: 'unknown', error: null as string | null },
      amazonApi: { status: 'unknown', error: null as string | null },
      environment: { status: 'unknown', error: null as string | null },
    },
  };

  // Check database connectivity
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) {
      health.checks.database = {
        status: 'error',
        error: error.message,
      };
      health.status = 'degraded';
    } else {
      health.checks.database = {
        status: 'ok',
        error: null,
      };
    }
  } catch (error: any) {
    health.checks.database = {
      status: 'error',
      error: error.message,
    };
    health.status = 'degraded';
  }

  // Check Amazon API credentials (without making actual API call)
  try {
    const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
    const clientSecret =
      process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
    const refreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      health.checks.amazonApi = {
        status: 'error',
        error: 'Missing Amazon API credentials',
      };
      health.status = 'degraded';
    } else {
      health.checks.amazonApi = {
        status: 'ok',
        error: null,
      };
    }
  } catch (error: any) {
    health.checks.amazonApi = {
      status: 'error',
      error: error.message,
    };
    health.status = 'degraded';
  }

  // Check environment variables
  try {
    const requiredVars = [
      'AMAZON_CLIENT_ID',
      'AMAZON_CLIENT_SECRET',
      'AMAZON_SPAPI_REFRESH_TOKEN',
      'JWT_SECRET',
      'DATABASE_URL',
    ];

    const missingVars = requiredVars.filter((varName) => {
      const value = process.env[varName] || process.env[`AMAZON_SPAPI_${varName}`];
      return !value || value.trim() === '';
    });

    if (missingVars.length > 0) {
      health.checks.environment = {
        status: 'error',
        error: `Missing required environment variables: ${missingVars.join(', ')}`,
      };
      health.status = 'degraded';
    } else {
      health.checks.environment = {
        status: 'ok',
        error: null,
      };
    }
  } catch (error: any) {
    health.checks.environment = {
      status: 'error',
      error: error.message,
    };
    health.status = 'degraded';
  }

  // Return appropriate status code
  const statusCode = health.status === 'ok' ? 200 : 503;

  res.status(statusCode).json(health);
});

/**
 * Readiness check (for Kubernetes)
 * GET /ready
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Check if database is accessible
    const { error } = await supabase.from('users').select('id').limit(1);

    if (error) {
      return res.status(503).json({
        status: 'not ready',
        error: 'Database not accessible',
      });
    }

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Readiness check failed', { error: error.message });
    res.status(503).json({
      status: 'not ready',
      error: error.message,
    });
  }
});

/**
 * Liveness check (for Kubernetes)
 * GET /live
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Metrics endpoint for monitoring
 * GET /metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metricsData = metrics.getSummary();
    const healthData = await performHealthCheck();
    
    res.status(200).json({
      timestamp: new Date().toISOString(),
      health: healthData,
      metrics: metricsData,
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        nodeVersion: process.version,
        platform: process.platform,
      },
    });
  } catch (error: any) {
    logger.error('Failed to collect metrics', { error: error.message });
    res.status(500).json({
      error: 'Failed to collect metrics',
      message: error.message,
    });
  }
});

/**
 * Detailed health check with all service statuses
 * GET /health/detailed
 */
router.get('/health/detailed', async (req: Request, res: Response) => {
  try {
    const healthData = await performHealthCheck();
    const statusCode = healthData.status === 'healthy' ? 200 : 
                       healthData.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json(healthData);
  } catch (error: any) {
    logger.error('Detailed health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Test Sentry error tracking (Sentry's recommended test endpoint)
 * GET /health/test-sentry
 * 
 * This endpoint intentionally throws an error to test Sentry integration
 * Only available in non-production environments
 * 
 * This snippet contains an intentional error and can be used as a test 
 * to make sure that everything's working as expected.
 */
router.get('/health/test-sentry', async (req: Request, res: Response) => {
  // Only allow in development/staging
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Test endpoint not available in production',
    });
  }

  // Import Sentry
  const Sentry = require('@sentry/node');
  
  // Send a log before throwing the error
  Sentry.logger.info('User triggered test error', {
    action: 'test_error_endpoint',
  });
  
  // Send a test metric before throwing the error
  Sentry.metrics.count('test_counter', 1);
  
  // Throw an error (Sentry's recommended test pattern)
  throw new Error('My first Sentry error!');
});

export default router;

