import { Router } from 'express';
import { ReportController } from '@/controllers/report.controller';
import { ReportSyncService } from '@/services/report.sync.service';
import { AmazonAPIService, AmazonAPIConfig } from '@/services/amazon.api.service';
import { ReportStorageService, StorageConfig } from '@/services/report.storage.service';

// Create router instance
const router = Router();

// Initialize services
const amazonConfig: AmazonAPIConfig = {
  refreshToken: process.env.AMAZON_REFRESH_TOKEN || '',
  region: process.env.AMAZON_REGION || 'us-east-1',
  marketplaceIds: (process.env.AMAZON_MARKETPLACE_IDS || '').split(','),
  clientId: process.env.AMAZON_CLIENT_ID || '',
  clientSecret: process.env.AMAZON_CLIENT_SECRET || '',
  roleArn: process.env.AMAZON_ROLE_ARN
};

const storageConfig: StorageConfig = {
  s3Bucket: process.env.S3_BUCKET || 'opsided-fba-reports',
  s3Region: process.env.S3_REGION || 'us-east-1',
  s3Prefix: process.env.S3_PREFIX || 'reports',
  localTempDir: process.env.LOCAL_TEMP_DIR || '/tmp/fba-reports'
};

const syncService = new ReportSyncService({
  amazon: amazonConfig,
  storage: storageConfig
});

const reportController = new ReportController(syncService);

// Authentication middleware (placeholder - should be imported from shared auth)
const authenticateUser = (req: any, res: any, next: any) => {
  // TODO: Implement proper authentication
  // For now, just add a mock user
  req.user = { id: 'mock-user-id' };
  next();
};

// Apply authentication to all routes
router.use(authenticateUser);

/**
 * @route POST /api/reports/sync/full
 * @desc Start a full sync for the authenticated user
 * @access Private
 */
router.post('/sync/full', reportController.startFullSync.bind(reportController));

/**
 * @route POST /api/reports/sync/incremental
 * @desc Start an incremental sync for the authenticated user
 * @access Private
 */
router.post('/sync/incremental', reportController.startIncrementalSync.bind(reportController));

/**
 * @route GET /api/reports/sync/:syncId/progress
 * @desc Get sync progress for a specific sync
 * @access Private
 */
router.get('/sync/:syncId/progress', reportController.getSyncProgress.bind(reportController));

/**
 * @route DELETE /api/reports/sync/:syncId
 * @desc Cancel a sync operation
 * @access Private
 */
router.delete('/sync/:syncId', reportController.cancelSync.bind(reportController));

/**
 * @route GET /api/reports/sync/history
 * @desc Get user's sync history
 * @access Private
 */
router.get('/sync/history', reportController.getSyncHistory.bind(reportController));

/**
 * @route GET /api/reports/sync/active
 * @desc Get active sync for the user
 * @access Private
 */
router.get('/sync/active', reportController.getActiveSync.bind(reportController));

/**
 * @route GET /api/reports/sync/stats
 * @desc Get sync statistics for the user
 * @access Private
 */
router.get('/sync/stats', reportController.getSyncStats.bind(reportController));

/**
 * @route GET /api/reports
 * @desc Get user's reports
 * @access Private
 */
router.get('/', reportController.getUserReports.bind(reportController));

/**
 * @route GET /api/reports/:reportId
 * @desc Get specific report details
 * @access Private
 */
router.get('/:reportId', reportController.getReportDetails.bind(reportController));

/**
 * @route GET /api/reports/types/supported
 * @desc Get supported report types
 * @access Private
 */
router.get('/types/supported', reportController.getSupportedReportTypes.bind(reportController));

/**
 * @route GET /api/reports/connections/test
 * @desc Test all connections (Amazon, S3, Database)
 * @access Private
 */
router.get('/connections/test', reportController.testConnections.bind(reportController));

/**
 * @route GET /api/reports/health
 * @desc Health check endpoint
 * @access Public
 */
router.get('/health', reportController.healthCheck.bind(reportController));

export default router; 