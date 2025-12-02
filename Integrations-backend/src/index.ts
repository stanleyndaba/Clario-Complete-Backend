import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import config from './config/env';
import logger from './utils/logger';
import { errorHandler, notFoundHandler } from './utils/errorHandler';
import { initializeMonitoring, requestMetricsMiddleware, captureException } from './utils/monitoring';

// Import security utilities (must be imported first)
import { securityHeadersMiddleware, enforceHttpsMiddleware, validateTlsMiddleware } from './security/securityHeaders';
import { validateRedirectMiddleware } from './security/validateRedirect';
import { validateEnvironmentOrFail } from './security/envValidation';

// Import middleware
import { userIdMiddleware } from './middleware/userIdMiddleware';

// Import routes
import amazonRoutes from './routes/amazonRoutes';
import gmailRoutes from './routes/gmailRoutes';
import stripeRoutes from './routes/stripeRoutes';
import syncRoutes from './routes/syncRoutes';
import integrationRoutes from './routes/integrationRoutes';
import sseRoutes from './routes/sseRoutes';
// import enhancedDetectionRoutes from './routes/enhancedDetectionRoutes'; // Temporarily disabled
import enhancedSyncRoutes from './routes/enhancedSyncRoutes';
import authRoutes from './routes/authRoutes';
import syncAliasRoutes from './routes/syncAliasRoutes';
import detectionRoutes from './routes/detectionRoutes';
import disputeRoutes from './routes/disputeRoutes';
import autoclaimRoutes from './routes/autoclaimRoutes';
import internalEventsRoutes from './routes/internalEventsRoutes';
import stripeWebhookRoutes from './routes/stripeWebhookRoutes';
import workflowRoutes from './routes/workflowRoutes';
import evidenceRoutes from './routes/evidenceRoutes';
import evidenceSourcesRoutes from './routes/evidenceSourcesRoutes';
import healthRoutes from './routes/healthRoutes';

// Consolidated service routes (merged from separate microservices)
import consolidatedStripeRoutes from './routes/consolidated/stripeRoutes';
import consolidatedCostDocsRoutes from './routes/consolidated/costDocsRoutes';
import consolidatedRefundEngineRoutes from './routes/consolidated/refundEngineRoutes';
import consolidatedInventorySyncRoutes from './routes/consolidated/inventorySyncRoutes';

// Proxy routes to Python backend
import proxyRoutes from './routes/proxyRoutes';

// Import background jobs
import { deadlineMonitoringJob } from './jobs/deadlineMonitoringJob';
import OrchestrationJobManager from './jobs/orchestrationJob';
import websocketService from './services/websocketService';
import detectionService from './services/detectionService';
import backgroundSyncWorker from './jobs/backgroundSyncWorker';
import evidenceIngestionWorker from './workers/evidenceIngestionWorker';
import documentParsingWorker from './workers/documentParsingWorker';
import evidenceMatchingWorker from './workers/evidenceMatchingWorker';
import refundFilingWorker from './workers/refundFilingWorker';
import recoveriesWorker from './workers/recoveriesWorker';
import billingWorker from './workers/billingWorker';
import notificationsWorker from './workers/notificationsWorker';
import learningWorker from './workers/learningWorker';

const app = express();
const server = createServer(app);

// Behind Render/other proxies we trust the first hop to read TLS headers
app.set('trust proxy', 1);

// Initialize monitoring (Sentry, metrics) - do this early
initializeMonitoring().catch((err) => {
  logger.warn('Monitoring initialization failed (non-critical)', { error: err.message });
});

// Add request metrics middleware (must be early in the pipeline)
app.use(requestMetricsMiddleware);

// Initialize WebSocket service
websocketService.initialize(server);

// Validate environment variables at startup (fail fast if missing)
try {
  validateEnvironmentOrFail(process.env.NODE_ENV === 'production');
} catch (error: any) {
  logger.error('Environment validation failed - server will not start', {
    error: error.message,
  });
  process.exit(1);
}

// Security middleware - enforce HTTPS first
if (process.env.NODE_ENV === 'production') {
  app.use(enforceHttpsMiddleware({
    allowLocalhost: false,
    skipPaths: ['/health', '/healthz'],
  }));
  app.use(validateTlsMiddleware());
}

// Security headers
app.use(securityHeadersMiddleware());

// Helmet for additional security (with CSP disabled as we handle it in securityHeadersMiddleware)
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false, // We handle CSP in securityHeadersMiddleware
  hsts: false, // We handle HSTS in securityHeadersMiddleware
}));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      logger.debug('CORS: Allowing request with no origin', { origin: 'null' });
      return callback(null, true);
    }

    const allowedOrigins = [
      'https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app',
      'https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app',
      'https://opside-complete-frontend-nwcors9h1-mvelo-ndabas-projects.vercel.app',
      'https://opside-complete-frontend-6t3yn3p2y-mvelo-ndabas-projects.vercel.app', // New frontend deployment
      'https://clario-refunds-frontend.onrender.com',
      'https://opside-complete-frontend.onrender.com',
      'http://localhost:8080',
      'http://localhost:5173',
      'http://localhost:3000'
    ];

    // Allow all Vercel preview deployments and onrender.com domains (pattern matching)
    // This handles changing frontend domains automatically
    // Check for vercel.app, onrender.com, or vercel.com domains
    const isVercelApp = origin.includes('vercel.app') || origin.includes('vercel.com');
    const isOnRender = origin.includes('onrender.com');

    if (isVercelApp || isOnRender) {
      logger.info('CORS: Allowing dynamic domain', {
        origin,
        type: isVercelApp ? 'vercel' : 'onrender',
        matched: true
      });
      return callback(null, true);
    }

    // Check exact match
    if (allowedOrigins.includes(origin)) {
      logger.debug('CORS: Allowing exact match', { origin });
      return callback(null, true);
    }

    // Log rejected origin for debugging
    logger.warn('CORS: Rejecting origin', {
      origin,
      allowedPatterns: ['vercel.app', 'onrender.com', 'vercel.com'],
      allowedOrigins: allowedOrigins.length
    });
    callback(new Error(`CORS: Origin ${origin} is not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-User-Id',
    'X-Forwarded-User-Id',
    'X-Frontend-URL',
    'Origin',
    'Referer',
    'Accept',
    'Cache-Control'
  ],
  exposedHeaders: ['X-User-Id', 'X-Request-Id'],
  maxAge: 86400 // 24 hours
}));

// Import rate limiters
import { generalRateLimiter, authRateLimiter } from './security/rateLimiter';

// Apply general rate limiting
app.use(generalRateLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Cookie parsing middleware (required for cookie-based auth)
app.use(cookieParser());
// Public metrics endpoint (no auth required)
app.post('/api/metrics/track', (req, res) => {
  // Accept metrics but don't require auth
  console.log('Metrics received:', req.body);
  res.status(204).send(); // No content
});

// Logging middleware
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) }
}));

// User ID extraction middleware (extracts user ID from headers/cookies)
// This should be early in the pipeline so all routes have access to req.userId
app.use(userIdMiddleware);

// Mount health routes (before other routes for fast health checks)
app.use('/', healthRoutes);

// Root health check (for Render)
app.get('/', (_, res) => {
  res.status(200).json({
    message: 'Opside Integrations API',
    status: 'operational',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// API status endpoint
app.get('/api/status', (_, res) => {
  res.json({
    status: 'operational',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Note: Rate limiting and redirect validation are applied at the route level
// See individual route files (amazonRoutes.ts, gmailRoutes.ts, etc.) for implementation

// Mount routes
app.use('/api/v1/integrations/amazon', amazonRoutes);
// Backward-compatible mount without version prefix
app.use('/api/integrations/amazon', amazonRoutes);
// Legacy connect endpoint (for frontend compatibility)
app.get('/api/v1/integrations/connectamazon', (req, res) => {
  res.redirect(302, '/api/v1/integrations/amazon/auth/start');
});
app.use('/api/v1/integrations/gmail', gmailRoutes);
app.use('/api/v1/integrations/stripe', stripeRoutes);
// Evidence sources routes (must be registered before generic integration routes)
app.use('/api/v1/integrations', evidenceSourcesRoutes);
logger.info('Evidence sources routes registered at /api/v1/integrations/{provider}/connect');
// Sync routes - must be registered before proxy routes
app.use('/api/sync', syncRoutes);
logger.info('Sync routes registered at /api/sync');
app.use('/api/integrations', integrationRoutes);
app.use('/api/sse', sseRoutes);
// app.use('/api/enhanced-detections', enhancedDetectionRoutes); // Temporarily disabled
app.use('/api/enhanced-sync', enhancedSyncRoutes);

// Phase 1 diagnostic routes
import phase1DiagnosticRoutes from './routes/phase1DiagnosticRoutes';
app.use('/api/phase1', phase1DiagnosticRoutes);
logger.info('Phase 1 diagnostic routes registered at /api/phase1');
app.use('/api/auth', authRoutes);
app.use('/api/v1/integrations/sync', syncAliasRoutes);
app.use('/api/v1/integrations', integrationRoutes);
app.use('/api/detections', detectionRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/autoclaim', autoclaimRoutes);
app.use('/api/internal-events', internalEventsRoutes);
app.use('/api/stripe-webhook', stripeWebhookRoutes);
app.use('/api/v1/workflow', workflowRoutes);
logger.info('Workflow routes registered at /api/v1/workflow');
app.use('/api/evidence', evidenceRoutes);
logger.info('Evidence routes registered at /api/evidence');

// Documents routes (replaces Python proxy for documents)
import documentsRoutes from './routes/documentsRoutes';
app.use('/api/documents', documentsRoutes);
logger.info('Documents routes registered at /api/documents');

// Consolidated service routes (merged from separate microservices)
app.use('/api/v1/stripe-payments', consolidatedStripeRoutes);
app.use('/api/v1/cost-docs', consolidatedCostDocsRoutes);
app.use('/api/v1/refund-engine', consolidatedRefundEngineRoutes);
app.use('/api/v1/inventory-sync', consolidatedInventorySyncRoutes);

// Proxy routes to Python backend (recoveries, documents, metrics)
// IMPORTANT: These must be registered after all other routes to avoid conflicts
// These proxy requests to python-api-9.onrender.com
app.use('/', proxyRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = config.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
  console.log('Environment: ' + config.NODE_ENV);

  // Log all registered routes for debugging
  logger.info('All routes registered', {
    workflow: '/api/v1/workflow',
    proxy: '/ (proxyRoutes)',
    routeCount: 'See logs above for details'
  });

  // Initialize background jobs asynchronously (don't block server startup)
  setImmediate(() => {
    try {
      // Initialize orchestration job manager (sets up queue processors)
      OrchestrationJobManager.initialize();
      logger.info('Orchestration job manager initialized');

      // Start background jobs (non-blocking)
      deadlineMonitoringJob.start();

      // Start Phase 2 background sync worker (if enabled)
      if (process.env.ENABLE_BACKGROUND_SYNC !== 'false') {
        backgroundSyncWorker.start().catch((error: any) => {
          logger.error('Failed to start background sync worker', { error: error.message });
        });
        logger.info('Phase 2 background sync worker initialized');
      } else {
        logger.info('Phase 2 background sync worker disabled (ENABLE_BACKGROUND_SYNC=false)');
      }

      // Start Evidence Ingestion Worker (if enabled)
      if (process.env.ENABLE_EVIDENCE_INGESTION_WORKER !== 'false') {
        evidenceIngestionWorker.start().catch((error: any) => {
          logger.error('Failed to start evidence ingestion worker', { error: error.message });
        });
        logger.info('Evidence ingestion worker initialized');
      } else {
        logger.info('Evidence ingestion worker disabled (ENABLE_EVIDENCE_INGESTION_WORKER=false)');
      }

      // Start Document Parsing Worker (if enabled)
      if (process.env.ENABLE_DOCUMENT_PARSING_WORKER !== 'false') {
        documentParsingWorker.start().catch((error: any) => {
          logger.error('Failed to start document parsing worker', { error: error.message });
        });
        logger.info('Document parsing worker initialized');
      } else {
        logger.info('Document parsing worker disabled (ENABLE_DOCUMENT_PARSING_WORKER=false)');
      }

      // Start Evidence Matching Worker (if enabled)
      if (process.env.ENABLE_EVIDENCE_MATCHING_WORKER !== 'false') {
        evidenceMatchingWorker.start().catch((error: any) => {
          logger.error('Failed to start evidence matching worker', { error: error.message });
        });
        logger.info('Evidence matching worker initialized');
      } else {
        logger.info('Evidence matching worker disabled (ENABLE_EVIDENCE_MATCHING_WORKER=false)');
      }

      // Start Refund Filing Worker (if enabled)
      if (process.env.ENABLE_REFUND_FILING_WORKER !== 'false') {
        refundFilingWorker.start();
        logger.info('Refund filing worker initialized');
      } else {
        logger.info('Refund filing worker disabled (ENABLE_REFUND_FILING_WORKER=false)');
      }

      // Start Recoveries Worker (if enabled)
      if (process.env.ENABLE_RECOVERIES_WORKER !== 'false') {
        recoveriesWorker.start();
        logger.info('Recoveries worker initialized');
      } else {
        logger.info('Recoveries worker disabled (ENABLE_RECOVERIES_WORKER=false)');
      }

      // Start Billing Worker (requires Stripe payments configuration)
      const billingWorkerEnabled = process.env.ENABLE_BILLING_WORKER !== 'false';
      const stripePaymentsConfigured = Boolean(process.env.STRIPE_PAYMENTS_URL);
      if (billingWorkerEnabled && stripePaymentsConfigured) {
        billingWorker.start();
        logger.info('Billing worker initialized');
      } else {
        logger.info('Billing worker disabled', {
          enabledEnv: billingWorkerEnabled,
          stripePaymentsConfigured,
          reason: billingWorkerEnabled
            ? 'STRIPE_PAYMENTS_URL not configured'
            : 'ENABLE_BILLING_WORKER=false'
        });
      }

      // Start Notifications Worker (if enabled)
      if (process.env.ENABLE_NOTIFICATIONS_WORKER !== 'false') {
        notificationsWorker.start();
        logger.info('Notifications worker initialized');
      } else {
        logger.info('Notifications worker disabled (ENABLE_NOTIFICATIONS_WORKER=false)');
      }

      // Start Learning Worker (Agent 11)
      if (process.env.ENABLE_LEARNING_WORKER !== 'false') {
        learningWorker.start();
        logger.info('Learning worker initialized');
      } else {
        logger.info('Learning worker disabled (ENABLE_LEARNING_WORKER=false)');
      }

      // Start detection job processor (processes detection jobs from queue)
      // This runs continuously to process detection jobs queued after sync
      // Note: Will silently skip if Redis is not available (no log spam)
      const startDetectionProcessor = async () => {
        try {
          // Attempt to get Redis client - if it fails, we'll use mock client
          // This allows the processor to start but will skip processing if Redis is unavailable
          try {
            const { getRedisClient } = await import('./utils/redisClient');
            await getRedisClient(); // This will return mock client if Redis is unavailable
          } catch (error: any) {
            // Redis connection failed - this is OK, we'll skip processing
            logger.info('Redis not available - detection job processor will skip (this is OK if Redis is not configured)');
          }

          // Process detection jobs in a loop (non-blocking)
          // The processDetectionJobs method will check Redis availability internally
          const processLoop = async () => {
            try {
              await detectionService.processDetectionJobs();
            } catch (error: any) {
              // Suppress Redis connection errors - they're handled in redisClient.ts
              if (error?.message?.includes('ECONNREFUSED') || error?.message?.includes('Redis') || error?.message?.includes('connection')) {
                // Redis unavailable - continue loop but skip processing
                // Don't log to avoid spam
              } else {
                logger.error('Error in detection job processor', { error: error?.message || error });
              }
            }
            // Schedule next processing (every 5 seconds)
            setTimeout(processLoop, 5000);
          };
          processLoop();
          logger.info('Detection job processor started (will skip if Redis unavailable)');
        } catch (error: any) {
          // Suppress Redis connection errors on startup
          if (error?.message?.includes('ECONNREFUSED') || error?.message?.includes('Redis') || error?.message?.includes('connection')) {
            logger.info('Detection job processor started in degraded mode - Redis not available (this is OK if Redis is not configured)');
            // Start processor anyway - it will handle Redis unavailability gracefully
            const processLoop = async () => {
              try {
                await detectionService.processDetectionJobs();
              } catch (err: any) {
                // Suppress all errors - processor will skip if Redis unavailable
              }
              setTimeout(processLoop, 5000);
            };
            processLoop();
            return;
          }
          logger.error('Failed to start detection job processor', { error: error?.message || error });
        }
      };
      startDetectionProcessor();

      logger.info('Background jobs started', {
        deadline_monitoring: 'started',
        detection_processor: 'started',
        evidence_ingestion_worker: process.env.ENABLE_EVIDENCE_INGESTION_WORKER !== 'false' ? 'started' : 'disabled',
        document_parsing_worker: process.env.ENABLE_DOCUMENT_PARSING_WORKER !== 'false' ? 'started' : 'disabled',
        evidence_matching_worker: process.env.ENABLE_EVIDENCE_MATCHING_WORKER !== 'false' ? 'started' : 'disabled',
        refund_filing_worker: process.env.ENABLE_REFUND_FILING_WORKER !== 'false' ? 'started' : 'disabled',
        recoveries_worker: process.env.ENABLE_RECOVERIES_WORKER !== 'false' ? 'started' : 'disabled',
        billing_worker: process.env.ENABLE_BILLING_WORKER !== 'false' ? 'started' : 'disabled',
        notifications_worker: process.env.ENABLE_NOTIFICATIONS_WORKER !== 'false' ? 'started' : 'disabled',
        learning_worker: process.env.ENABLE_LEARNING_WORKER !== 'false' ? 'started' : 'disabled'
      });
    } catch (error: any) {
      logger.error('Error starting background jobs (non-blocking)', {
        error: error?.message || String(error),
        note: 'Server will continue to run without background jobs'
      });
    }
  });
});


