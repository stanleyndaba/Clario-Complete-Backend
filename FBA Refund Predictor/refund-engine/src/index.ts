import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { initializeDatabase, db } from './utils/db';
import claimsRoutes from './api/routes/claimsRoutes';
import ledgerRoutes from './api/routes/ledgerRoutes';
import discrepancyRoutes from './api/routes/discrepancyRoutes';
import { AmazonSubmissionWorker } from './workers/amazonSubmissionWorker';
import amazonSubmissionRoutes from './api/routes/amazonSubmissionRoutes';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbConnected = await db.testConnection();
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbConnected ? 'connected' : 'disconnected',
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// Backwards-compatible alias for services expecting /api/health
app.get('/api/health', async (req, res) => {
  try {
    const dbConnected = await db.testConnection();
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbConnected ? 'connected' : 'disconnected',
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// API routes
app.use('/api/v1/claims', claimsRoutes);
app.use('/api/v1/ledger', ledgerRoutes);
app.use('/api/v1/discrepancies', discrepancyRoutes);
if (process.env.ENABLE_AMAZON_METRICS === 'true') {
  app.use('/api/v1/amazon-submissions', amazonSubmissionRoutes);
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Refund Engine API',
    version: '1.0.0',
    endpoints: {
      claims: '/api/v1/claims',
      ledger: '/api/v1/ledger',
      discrepancies: '/api/v1/discrepancies',
      health: '/health'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`
  });
});

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', error);
  
  res.status(error.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
  });
});

// Initialize database and start server
async function startServer() {
  try {
    console.log('Initializing database...');
    await initializeDatabase();
    console.log('Database initialized successfully');

    console.log('Testing database connection...');
    const dbConnected = await db.testConnection();
    if (!dbConnected) {
      throw new Error('Database connection failed');
    }
    console.log('Database connection successful');

    app.listen(PORT, () => {
      console.log(`🚀 Refund Engine API server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`📚 API documentation: http://localhost:${PORT}/`);
    });

    // Start Amazon submission worker if enabled
    if (process.env.ENABLE_AMAZON_SUBMISSION === 'true') {
      const worker = new AmazonSubmissionWorker(parseInt(process.env.AMAZON_SUBMISSION_INTERVAL_MS || '30000'));
      worker.start();
      console.log('▶️ AmazonSubmissionWorker started');
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await db.close();
  process.exit(0);
});

// Start the server
startServer(); 