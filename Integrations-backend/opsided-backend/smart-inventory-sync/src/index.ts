import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { getLogger } from '../../shared/utils/logger';
import { ConnectorManager } from './connectors/connectorManager';
import { AmazonConnector } from './connectors/amazonConnector';
import { AmazonSPAPIService } from './services/amazonSPAPIService';
import { getDatabase, closeDatabase, checkDatabaseHealth } from '../../shared/db/connection';
import { inventoryJob } from './jobs/inventoryJob';
import { syncService } from './services/syncService';
import syncRoutes from './routes/syncRoutes';
import { ClaimDetectorIntegrationService } from './services/claimDetectorIntegrationService';
import { progressBus } from './services/progressBus';

// Load environment variables
dotenv.config();

const logger = getLogger('SmartInventorySync');
const app = express();
const PORT = process.env.PORT || 3002;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Logging middleware
app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.info(message.trim()),
  },
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint with comprehensive checks
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    
    // Check sync service health
    const syncMetrics = await syncService.getSyncMetrics();
    const activeJobsCount = await syncService.getAllJobStatuses().then(jobs => 
      jobs.filter(job => job.status === 'running').length
    );
    
    // Check claim detection health
    const claimDetectionHealth = await syncService.reconciliationService.getClaimDetectionHealth();
    
    const healthStatus = {
      status: dbHealth ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        sync_service: true,
        amazon_api: syncMetrics.sourceSystemHealth.amazon?.status === 'healthy',
        claim_detector: claimDetectionHealth.available ? claimDetectionHealth.status : 'not_configured',
      },
      metrics: {
        activeJobs: activeJobsCount,
        totalJobs: syncMetrics.totalJobs,
        lastSync: syncMetrics.lastSyncTimestamp,
        discrepanciesFound: syncMetrics.discrepanciesFound,
        claimDetection: {
          available: claimDetectionHealth.available,
          queueSize: claimDetectionHealth.queueSize,
          lastProcessed: claimDetectionHealth.lastProcessed,
        },
      },
      version: '2.0.0',
    };

    const isHealthy = healthStatus.services.database && 
                     healthStatus.services.sync_service && 
                     healthStatus.services.amazon_api;

    res.status(isHealthy ? 200 : 503).json(healthStatus);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: false,
        sync_service: false,
        amazon_api: false,
      },
      error: error instanceof Error ? error.message : 'Unknown error',
      version: '2.0.0',
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Smart Inventory Sync Service v2.0',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    features: [
      'Amazon SP-API Integration',
      'Intelligent Discrepancy Detection',
      'Automated Reconciliation',
      'Real-time Job Monitoring',
      'Comprehensive Metrics',
    ],
  });
});

// API routes
app.use('/api/v1/sync', syncRoutes);

// Simple JWT auth middleware for SSE
function requireJWT(req: any, res: any, next: any) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
    // Basic signature check using shared secret (no roles here)
    const jwt = require('jsonwebtoken');
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}

// Server-Sent Events (SSE) for progress updates
app.get('/api/v1/sync/progress/:jobId', requireJWT, (req, res) => {
  const { jobId } = req.params;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const onProgress = (payload: any) => {
    if (payload.jobId === jobId) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };
  progressBus.on('progress', onProgress);
  req.on('close', () => {
    progressBus.off('progress', onProgress);
  });
});

// Enhanced job status endpoint
app.get('/api/v1/jobs/status', async (req, res) => {
  try {
    const { userId } = req.query;
    const jobStatuses = await syncService.getAllJobStatuses(userId as string);
    
    res.json({
      success: true,
      data: {
        activeJobs: jobStatuses.filter(job => job.status === 'running'),
        completedJobs: jobStatuses.filter(job => job.status === 'completed'),
        failedJobs: jobStatuses.filter(job => job.status === 'failed'),
        totalJobs: jobStatuses.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error getting job statuses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job statuses',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Individual job status endpoint
app.get('/api/v1/jobs/:jobId/status', async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobStatus = await syncService.getJobStatus(jobId);
    
    if (!jobStatus) {
      return res.status(404).json({
        success: false,
        message: 'Job not found',
        timestamp: new Date().toISOString(),
      });
    }
    
    res.json({
      success: true,
      data: jobStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting job status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job status',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Sync metrics endpoint
app.get('/api/v1/metrics', async (req, res) => {
  try {
    const { userId } = req.query;
    const metrics = await syncService.getSyncMetrics(userId as string);
    
    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting sync metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get sync metrics',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Job history endpoint
app.get('/api/v1/jobs/history', async (req, res) => {
  try {
    const { userId, limit = '50' } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      });
    }
    
    const history = await syncService.getJobHistory(userId as string, parseInt(limit as string));
    
    res.json({
      success: true,
      data: history,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting job history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job history',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Manual job triggers with enhanced options
app.post('/api/v1/jobs/sync', async (req, res) => {
  try {
    const { userId, syncType = 'full', sourceSystems = ['amazon'] } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      });
    }
    
    const result = await syncService.startSync(userId, sourceSystems[0], syncType);
    
    res.json({
      success: true,
      message: 'Sync job triggered successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error triggering sync job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger sync job',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/v1/jobs/discrepancies', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      });
    }
    
    const result = await syncService.startSync(userId, undefined, 'discrepancy_only');
    
    res.json({
      success: true,
      message: 'Discrepancy detection triggered successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error triggering discrepancy detection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger discrepancy detection',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Cancel job endpoint
app.post('/api/v1/jobs/:jobId/cancel', async (req, res) => {
  try {
    const { jobId } = req.params;
    const cancelled = await syncService.cancelSyncJob(jobId);
    
    if (cancelled) {
      res.json({
        success: true,
        message: 'Job cancelled successfully',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Job could not be cancelled',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error('Error cancelling job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel job',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Discrepancy summary endpoint
app.get('/api/v1/discrepancies/summary', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      });
    }
    
    const summary = await syncService.getDiscrepancySummary(userId as string);
    
    res.json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting discrepancy summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get discrepancy summary',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Reconciliation rules endpoints
app.get('/api/v1/reconciliation/rules', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      });
    }
    
    const rules = await syncService.getReconciliationRules(userId as string);
    
    res.json({
      success: true,
      data: rules,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting reconciliation rules:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get reconciliation rules',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/v1/reconciliation/rules', async (req, res) => {
  try {
    const { userId, rule } = req.body;
    
    if (!userId || !rule) {
      return res.status(400).json({
        success: false,
        message: 'User ID and rule are required',
        timestamp: new Date().toISOString(),
      });
    }
    
    const newRule = await syncService.addReconciliationRule(userId, rule);
    
    res.json({
      success: true,
      message: 'Reconciliation rule added successfully',
      data: newRule,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error adding reconciliation rule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reconciliation rule',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Initialize Connector Manager
const connectorManager = new ConnectorManager(syncService.reconciliationService['claimDetectorService'] || null);

// Register Amazon connector (config-driven enable)
const enableAmazon = process.env.ENABLE_AMAZON !== 'false';
if (enableAmazon) {
  const amazonSvc = new AmazonSPAPIService({
    clientId: process.env.AMAZON_CLIENT_ID || '',
    clientSecret: process.env.AMAZON_CLIENT_SECRET || '',
    refreshToken: process.env.AMAZON_REFRESH_TOKEN || '',
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID || '',
    sellerId: process.env.AMAZON_SELLER_ID || '',
    region: process.env.AMAZON_REGION || 'us-east-1',
  });
  connectorManager.register(new AmazonConnector(amazonSvc));
}

// Connector endpoints
app.post('/api/v1/connectors/run', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
    const result = await connectorManager.runAll(userId);
    res.json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Error running connectors:', error);
    res.status(500).json({ success: false, message: 'Failed to run connectors' });
  }
});

app.get('/api/v1/connectors/health', async (req, res) => {
  try {
    const health = await connectorManager.health();
    res.json({ success: true, data: health, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get connectors health' });
  }
});

// Claim Detection Integration Endpoints
app.post('/api/v1/claims/detect', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      });
    }
    
    const result = await syncService.reconciliationService.triggerManualClaimDetection(userId);
    
    res.json({
      success: true,
      message: 'Claim detection triggered successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error triggering claim detection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger claim detection',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Webhook to mark claim paid and propagate billing/notifications
app.post('/api/v1/claims/:id/paid', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, amountCents } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

    // Notify dashboard
    try {
      await syncService.notificationService.processEvent({
        type: 'claim_paid',
        userId,
        data: { claimId: id, amountCents },
        channels: ['inapp'],
      } as any);
    } catch {}

    res.json({ success: true, message: 'Marked as paid (logical webhook stub)' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed', error: error instanceof Error ? error.message : 'Unknown' });
  }
});

app.get('/api/v1/claims/summary/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      });
    }
    
    const summary = await syncService.reconciliationService.getClaimSummary(userId);
    
    res.json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting claim summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get claim summary',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/v1/claims/health', async (req, res) => {
  try {
    const health = await syncService.reconciliationService.getClaimDetectionHealth();
    
    res.json({
      success: true,
      data: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting claim detection health:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get claim detection health',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', error);
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString(),
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Stop background jobs
    await inventoryJob.stop();
    logger.info('Background jobs stopped');
    
    // Close database connection
    await closeDatabase();
    logger.info('Database connection closed');
    
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Start server
const startServer = async () => {
  try {
    // Test database connection
    const dbHealth = await checkDatabaseHealth();
    if (!dbHealth) {
      throw new Error('Database connection failed');
    }
    logger.info('Database connection established');

    // Start background jobs
    await inventoryJob.start();
    logger.info('Background jobs started');

    // Start Express server
    app.listen(PORT, () => {
      logger.info(`Smart Inventory Sync Service v2.0 running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info('Enhanced features: Amazon SP-API, Intelligent Reconciliation, Real-time Monitoring');
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
startServer(); 