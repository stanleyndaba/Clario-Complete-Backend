import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { getLogger } from '../../shared/utils/logger';

// Import routes
import amazonRoutes from './routes/amazonRoutes';
import authRoutes from './routes/authRoutes';
import gmailRoutes from './routes/gmailRoutes';
import stripeRoutes from './routes/stripeRoutes';

// Import services
import websocketService from './services/websocketService';
import queueManager from './jobs/queueManager';
import ledgers from '../../shared/db/ledgers';

// Load environment variables
dotenv.config();

const logger = getLogger('Server');
const app = express();
const server = createServer(app);

// Initialize WebSocket service
websocketService.initialize(server);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      websocket: websocketService.getConnectedUsersCount(),
      queue: 'active',
    },
  });
});

// Routes
app.use('/api/amazon', amazonRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/stripe', stripeRoutes);

// Job status endpoints
app.get('/api/jobs/:jobId/status', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await queueManager.getJobStatus(jobId);
    res.json(status);
  } catch (error) {
    logger.error('Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

app.get('/api/jobs/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const jobs = await queueManager.getJobsForUser(userId);
    res.json(jobs);
  } catch (error) {
    logger.error('Error getting user jobs:', error);
    res.status(500).json({ error: 'Failed to get user jobs' });
  }
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    // Close WebSocket service
    websocketService.close();
    
    // Close queue manager
    await queueManager.close();
    
    // Close server
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    // Close WebSocket service
    websocketService.close();
    
    // Close queue manager
    await queueManager.close();
    
    // Close server
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});

// Initialize database tables
ledgers.initializeTables()
  .then(() => {
    logger.info('Database tables initialized');
  })
  .catch((error) => {
    logger.error('Error initializing database tables:', error);
  });

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`WebSocket service initialized`);
  logger.info(`Queue manager initialized`);
});

export default app; 