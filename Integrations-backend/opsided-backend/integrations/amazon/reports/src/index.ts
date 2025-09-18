import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { getLogger } from '@/shared/utils/logger';
import reportRoutes from './routes/report.routes';
import { ReportSyncService } from './services/report.sync.service';
import { AmazonAPIService, AmazonAPIConfig } from './services/amazon.api.service';
import { ReportStorageService, StorageConfig } from './services/report.storage.service';
import { CronJobManager } from './utils/cron.jobs';

const logger = getLogger('FBAReportSync');

export class FBAReportSyncModule {
  private app: express.Application;
  private syncService: ReportSyncService;
  private cronManager: CronJobManager;
  private port: number;

  constructor() {
    this.port = parseInt(process.env.PORT || '3001');
    this.app = express();
    this.initializeServices();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Initialize services
   */
  private initializeServices(): void {
    try {
      logger.info('Initializing FBA Report Sync services');

      // Amazon API configuration
      const amazonConfig: AmazonAPIConfig = {
        refreshToken: process.env.AMAZON_REFRESH_TOKEN || '',
        region: process.env.AMAZON_REGION || 'us-east-1',
        marketplaceIds: (process.env.AMAZON_MARKETPLACE_IDS || '').split(','),
        clientId: process.env.AMAZON_CLIENT_ID || '',
        clientSecret: process.env.AMAZON_CLIENT_SECRET || '',
        roleArn: process.env.AMAZON_ROLE_ARN
      };

      // Storage configuration
      const storageConfig: StorageConfig = {
        s3Bucket: process.env.S3_BUCKET || 'opsided-fba-reports',
        s3Region: process.env.S3_REGION || 'us-east-1',
        s3Prefix: process.env.S3_PREFIX || 'reports',
        localTempDir: process.env.LOCAL_TEMP_DIR || '/tmp/fba-reports'
      };

      // Initialize sync service
      this.syncService = new ReportSyncService({
        amazon: amazonConfig,
        storage: storageConfig
      });

      // Initialize cron job manager
      this.cronManager = new CronJobManager(this.syncService);

      logger.info('Services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize services:', error);
      throw error;
    }
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true
    }));

    // Compression
    this.app.use(compression());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.'
    });
    this.app.use('/api/', limiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  /**
   * Setup routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        service: 'FBA Report Sync',
        timestamp: new Date().toISOString()
      });
    });

    // API routes
    this.app.use('/api/reports', reportRoutes);

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl
      });
    });

    // Error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting FBA Report Sync module');

      // Test connections
      const connections = await this.syncService.testConnections();
      logger.info('Connection test results:', connections);

      // Start cron jobs
      await this.cronManager.startJobs();
      logger.info('Cron jobs started');

      // Start server
      this.app.listen(this.port, () => {
        logger.info(`FBA Report Sync module started on port ${this.port}`);
        logger.info(`Health check available at http://localhost:${this.port}/health`);
        logger.info(`API available at http://localhost:${this.port}/api/reports`);
      });

    } catch (error) {
      logger.error('Failed to start FBA Report Sync module:', error);
      throw error;
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping FBA Report Sync module');

      // Stop cron jobs
      await this.cronManager.stopJobs();
      logger.info('Cron jobs stopped');

      logger.info('FBA Report Sync module stopped');
    } catch (error) {
      logger.error('Failed to stop FBA Report Sync module:', error);
      throw error;
    }
  }

  /**
   * Get sync service instance
   */
  getSyncService(): ReportSyncService {
    return this.syncService;
  }

  /**
   * Get cron manager instance
   */
  getCronManager(): CronJobManager {
    return this.cronManager;
  }

  /**
   * Get Express app instance
   */
  getApp(): express.Application {
    return this.app;
  }
}

// Create and export module instance
export const fbaReportSyncModule = new FBAReportSyncModule();

// Start the module if this file is run directly
if (require.main === module) {
  fbaReportSyncModule.start().catch(error => {
    logger.error('Failed to start module:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await fbaReportSyncModule.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await fbaReportSyncModule.stop();
    process.exit(0);
  });
}

export default fbaReportSyncModule; 