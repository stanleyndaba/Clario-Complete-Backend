import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import config from './config/env';
import logger from './utils/logger';
import { errorHandler, notFoundHandler } from './utils/errorHandler';

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

// Consolidated service routes (merged from separate microservices)
import consolidatedStripeRoutes from './routes/consolidated/stripeRoutes';
import consolidatedCostDocsRoutes from './routes/consolidated/costDocsRoutes';
import consolidatedRefundEngineRoutes from './routes/consolidated/refundEngineRoutes';
import consolidatedInventorySyncRoutes from './routes/consolidated/inventorySyncRoutes';

const app = express();
const server = createServer(app);

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));
app.use(cors({
  origin: ['https://clario-refunds-frontend.onrender.com', 'https://clario-complete-backend-y5cd.onrender.com', 'http://localhost:8080', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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

// Health check endpoint
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API status endpoint
app.get('/api/status', (_, res) => {
  res.json({ 
    status: 'operational', 
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Mount routes
app.use('/api/v1/integrations/amazon', amazonRoutes);
// Backward-compatible mount without version prefix
app.use('/api/integrations/amazon', amazonRoutes);
app.use('/api/v1/integrations/gmail', gmailRoutes);
app.use('/api/v1/integrations/stripe', stripeRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/sse', sseRoutes);
// app.use('/api/enhanced-detections', enhancedDetectionRoutes); // Temporarily disabled
app.use('/api/enhanced-sync', enhancedSyncRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/v1/integrations/sync', syncAliasRoutes);
app.use('/api/v1/integrations', integrationRoutes);
app.use('/api/detections', detectionRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/autoclaim', autoclaimRoutes);
app.use('/api/internal-events', internalEventsRoutes);
app.use('/api/stripe-webhook', stripeWebhookRoutes);

// Consolidated service routes (merged from separate microservices)
app.use('/api/v1/stripe-payments', consolidatedStripeRoutes);
app.use('/api/v1/cost-docs', consolidatedCostDocsRoutes);
app.use('/api/v1/refund-engine', consolidatedRefundEngineRoutes);
app.use('/api/v1/inventory-sync', consolidatedInventorySyncRoutes);

// Root endpoint
app.get('/', (_, res) => {
  res.json({ 
    message: 'Opside Integrations API',
    version: '1.0.0'
  });
});

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = config.PORT || 3001;

server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log('Environment: ' + config.NODE_ENV);
});


