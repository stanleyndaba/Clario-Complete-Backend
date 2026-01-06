import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import 'express-async-errors';
import winston from 'winston';
import config from '@/config/env';
import routes from '@/routes';
import { stripe, STRIPE_CONFIG } from '@/config/stripeConfig';
import { stripeRawBody } from '@/middlewares/verifyStripeWebhook';
import { PayoutJobQueue } from '@/jobs/payoutJob';

// Configure Winston logger
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'stripe-payments' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({
      filename: config.LOG_FILE_PATH,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Create Express app
const app = express();

// Validate Stripe live-mode configuration at startup
try {
  const isProduction = config.NODE_ENV === 'production';
  const isLiveKey = typeof process.env.STRIPE_SECRET_KEY === 'string' && process.env.STRIPE_SECRET_KEY.startsWith('sk_live_');
  if (isProduction && STRIPE_CONFIG.LIVE_MODE) {
    if (!isLiveKey) {
      throw new Error('In production with STRIPE_LIVE_MODE=true but STRIPE_SECRET_KEY is not a live key. Aborting startup.');
    }
    logger.info('Stripe live mode enabled with live keys.');
    // Verify Stripe connectivity (non-fatal if it fails but will log error)
    stripe.accounts.retrieve(STRIPE_CONFIG.PLATFORM_ACCOUNT_ID)
      .then((acct) => {
        logger.info(`Stripe connectivity OK. Platform account: ${acct.id}`);
      })
      .catch((err) => {
        logger.error('Stripe connectivity check failed at startup', err);
      });
  }
} catch (e) {
  logger.error(e instanceof Error ? e.message : 'Stripe live-mode validation failed');
  // Fail fast in production misconfiguration
  if (config.NODE_ENV === 'production') throw e as any;
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] // Replace with your domain
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Idempotency-Key'],
}));

// Compression middleware
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Stripe webhook route must receive raw body before JSON parser
app.post(['/webhooks/stripe', '/api/v1/webhooks/stripe'], stripeRawBody, (req, res, next) => next());

// Body parsing middleware (after webhook raw route)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });
  });
  
  next();
});

// Health check endpoint (before routes)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'stripe-payments',
    version: '1.0.0',
    environment: config.NODE_ENV,
    stripeLiveMode: STRIPE_CONFIG.LIVE_MODE,
  });
});

// API routes
app.use('/', routes);

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
  });

  // Don't expose internal errors in production
  const isProduction = config.NODE_ENV === 'production';
  const errorMessage = isProduction ? 'Internal server error' : error.message;

  res.status(error.status || 500).json({
    error: 'Internal server error',
    message: errorMessage,
    ...(isProduction ? {} : { stack: error.stack }),
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    await PayoutJobQueue.close();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    await PayoutJobQueue.close();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', {
    promise,
    reason,
  });
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

export default app; 