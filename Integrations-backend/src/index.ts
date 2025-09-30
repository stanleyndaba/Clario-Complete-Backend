import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import config from './config/env';
import logger from './utils/logger';
import { errorHandler, notFoundHandler } from './utils/errorHandler';
// Temporarily disable WebSocket service for demo stability
// import websocketService from './services/websocketService';

// Import routes
import amazonRoutes from './routes/amazonRoutes';
import gmailRoutes from './routes/gmailRoutes';
import stripeRoutes from './routes/stripeRoutes';
import syncRoutes from './routes/syncRoutes';
import integrationRoutes from './routes/integrationRoutes';
import sseRoutes from './routes/sseRoutes';
import enhancedDetectionRoutes from './routes/enhancedDetectionRoutes';
import enhancedSyncRoutes from './routes/enhancedSyncRoutes';
import authRoutes from './routes/authRoutes';
import syncAliasRoutes from './routes/syncAliasRoutes';
import detectionRoutes from './routes/detectionRoutes';
import disputeRoutes from './routes/disputeRoutes';
import autoclaimRoutes from './routes/autoclaimRoutes';
import internalEventsRoutes from './routes/internalEventsRoutes';
import stripeWebhookRoutes from './routes/stripeWebhookRoutes';
import { disputeSubmissionWorker } from './jobs/disputeSubmissionWorker';

// Import background jobs
import amazonSyncJob from './jobs/amazonSyncJob';
import stripeSyncJob from './jobs/stripeSyncJob';
import OrchestrationJobManager from './jobs/orchestrationJob';
import detectionService from './services/detectionService';
import enhancedDetectionService from './services/enhancedDetectionService';

// Add Redis error handler at the VERY BEGINNING
process.on('unhandledRejection', (reason, promise) => {
  // Don't crash for Redis connection errors
  if (reason instanceof Error && reason.message.includes('ECONNREFUSED') && reason.message.includes('6379')) {
    console.warn('Redis connection failed - continuing without Redis', reason.message);
    return; // Don't crash the app
  }
  console.error('Unhandled Rejection', reason, promise);
  process.exit(1);
});

const app = express();
const server = createServer(app);

// Security middleware
app.use(helmet());

// CORS configuration (env-driven, supports comma-separated origins)
const corsOriginsEnv = process.env.CORS_ALLOW_ORIGINS || process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '';
const corsOrigins = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((o: string) => o.trim()).filter(Boolean)
  : ['http://localhost:3000'];
const corsRegex = process.env.ALLOWED_ORIGIN_REGEX;

app.use(cors({
  origin: corsOrigins.includes('*')
    ? true
    : (corsRegex
        ? new RegExp(corsRegex)
        : corsOrigins),
  credentials: !corsOrigins.includes('*')
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use(limiter);

// Logging middleware
app.use(morgan('combined', {
  stream: {
    write: (message: string) => {
      logger.info(message.trim());
    }
  }
}));

// Body parsing middleware
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Integrations Backend is running',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV
  });
});

// ADD THIS NEW ENDPOINT RIGHT HERE:
// Status endpoint for Orchestrator health checks
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'integrations-backend',
    timestamp: new Date().toISOString()
  });
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Public metrics endpoint (no auth required)
app.post('/api/metrics/track', (req, res) => {
  // Accept metrics but don't require auth
  console.log('Metrics received:', req.body);
  res.status(204).send(); // No content
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Integrations Backend is running',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV
  });
});

// API routes
app.use('/api/amazon', amazonRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/v1/integrations', integrationRoutes);
app.use('/api/sse', sseRoutes);
app.use('/api/enhanced-detection', enhancedDetectionRoutes);
app.use('/api/enhanced-sync', enhancedSyncRoutes);
// v1 unified routes exposed under gateway base path
app.use('/api/v1/integrations/auth', authRoutes);
app.use('/api/v1/integrations/sync', syncAliasRoutes);
app.use('/api/v1/integrations/detections', detectionRoutes);
app.use('/api/v1/integrations/disputes', disputeRoutes);
app.use('/api/v1/integrations/autoclaim', autoclaimRoutes);
app.use('/api/internal/events', internalEventsRoutes);
app.use('/api/v1/integrations/stripe', stripeWebhookRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Opside Integrations Hub Backend',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      amazon: '/api/amazon',
      gmail: '/api/gmail',
      stripe: '/api/stripe',
      sync: '/api/sync',
      enhancedDetection: '/api/enhanced-detection',
      enhancedSync: '/api/enhanced-sync'
    }
  });
});

// 404 handler
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start background jobs
const startBackgroundJobs = () => {
  try {
    amazonSyncJob.startScheduledSync();
    stripeSyncJob.startScheduledSync();
    OrchestrationJobManager.initialize();
    
    // Start legacy detection job processor
    setInterval(async () => {
      try {
        await detectionService.processDetectionJobs();
      } catch (error) {
        logger.error('Error processing legacy detection jobs', { error });
      }
    }, 5000); // Process every 5 seconds
    
    // Start enhanced detection job processor
    setInterval(async () => {
      try {
        await enhancedDetectionService.processDetectionJobs();
      } catch (error) {
        logger.error('Error processing enhanced detection jobs', { error });
      }
    }, 5000); // Process every 5 seconds
    
    logger.info('Background jobs started successfully');
  } catch (error) {
    logger.error('Error starting background jobs', { error });
  }
};

// Start server
const startServer = () => {
  const port = Number(process.env.PORT || config.PORT);
  
  // Initialize WebSocket service (skipped for demo)
  try {
    // const { websocketService } = await import('./services/websocketService');
    // websocketService.initialize(server);
    logger.info('WebSocket service temporarily disabled for demo');
  } catch (e) {
    logger.warn('WebSocket service skipped for demo', { error: (e as any)?.message });
  }
  
  server.listen(port, '0.0.0.0', () => {
    logger.info(`Server started on port ${port}`, {
      port,
      environment: config.NODE_ENV,
      timestamp: new Date().toISOString()
    });
    
    // Start background jobs after server is running
    startBackgroundJobs();
    // disputeSubmissionWorker.start(); // Disabled - Redis not available
  });
};

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully`);
  
  // Stop background jobs
  try {
    amazonSyncJob.stopScheduledSync();
    stripeSyncJob.stopScheduledSync();
    OrchestrationJobManager.cleanup();
    logger.info('Background jobs stopped');
  } catch (error) {
    logger.error('Error stopping background jobs', { error });
  }
  
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  // Don't crash for Redis connection errors
  if (reason instanceof Error && reason.message.includes('ECONNREFUSED') && reason.message.includes('6379')) {
    logger.warn('Redis connection failed - continuing without Redis', { reason: reason.message });
    return; // Don't crash the app
  }
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// Start the server
startServer();

export default app; // Deployment fix - Redis disabled

