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
// Temporarily comment out problematic import
// import { disputeSubmissionWorker } from './jobs/disputeSubmissionWorker';

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
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) }
}));

// Health check endpoint (simplified)
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API status endpoint (simplified)
app.get('/api/status', (_, res) => {
  res.json({ 
    status: 'operational', 
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    services: {
      api: 'operational',
      database: 'operational',
      authentication: 'operational'
    }
  });
});

// Mount routes
app.use('/api/v1/integrations/amazon', amazonRoutes);
app.use('/api/v1/integrations/gmail', gmailRoutes);
app.use('/api/v1/integrations/stripe', stripeRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/sse', sseRoutes);
app.use('/api/enhanced-detections', enhancedDetectionRoutes);
app.use('/api/enhanced-sync', enhancedSyncRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/sync-alias', syncAliasRoutes);
app.use('/api/detections', detectionRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/autoclaim', autoclaimRoutes);
app.use('/api/internal-events', internalEventsRoutes);
app.use('/api/stripe-webhook', stripeWebhookRoutes);

// Root endpoint (simplified)
app.get('/', (_, res) => {
  res.json({ 
    message: 'Opside Integrations API',
    version: '1.0.0',
    documentation: '/api/docs'
  });
});

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = config.port || 3001;

server.listen(PORT, () => {
  logger.info(Server running on port );
  logger.info(Environment: );
  logger.info(CORS enabled for: );

  // Start background jobs
  amazonSyncJob.start();
  stripeSyncJob.start();
  
  // Initialize orchestration job manager
  const orchestrationJobManager = new OrchestrationJobManager();
  orchestrationJobManager.initialize();

  logger.info('Background jobs started');
});

export default app;
