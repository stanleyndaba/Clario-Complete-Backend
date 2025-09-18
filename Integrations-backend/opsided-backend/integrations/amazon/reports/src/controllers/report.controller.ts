import { Request, Response } from 'express';
import { getLogger } from '@/shared/utils/logger';
import { ReportSyncService, SyncOptions } from '@/services/report.sync.service';
import { reportModel } from '@/models/report.model';
import { syncLogModel } from '@/models/syncLog.model';
import { ReportType, SyncStatus } from '@/types';

const logger = getLogger('ReportController');

export class ReportController {
  private syncService: ReportSyncService;

  constructor(syncService: ReportSyncService) {
    this.syncService = syncService;
  }

  /**
   * Start a full sync
   */
  async startFullSync(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { reportTypes, startDate, endDate, marketplaceIds } = req.body;

      const options: SyncOptions = {
        userId,
        reportTypes: reportTypes ? reportTypes.map((type: string) => type as ReportType) : undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        marketplaceIds: marketplaceIds || [],
        syncType: 'full'
      };

      logger.info('Starting full sync', { userId, options });

      const syncId = await this.syncService.startFullSync(options);

      res.status(200).json({
        success: true,
        data: {
          syncId,
          message: 'Full sync started successfully'
        }
      });

    } catch (error) {
      logger.error('Failed to start full sync:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Start an incremental sync
   */
  async startIncrementalSync(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { reportTypes, marketplaceIds } = req.body;

      const options: SyncOptions = {
        userId,
        reportTypes: reportTypes ? reportTypes.map((type: string) => type as ReportType) : undefined,
        marketplaceIds: marketplaceIds || [],
        syncType: 'incremental'
      };

      logger.info('Starting incremental sync', { userId, options });

      const syncId = await this.syncService.startIncrementalSync(options);

      res.status(200).json({
        success: true,
        data: {
          syncId,
          message: 'Incremental sync started successfully'
        }
      });

    } catch (error) {
      logger.error('Failed to start incremental sync:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get sync progress
   */
  async getSyncProgress(req: Request, res: Response): Promise<void> {
    try {
      const { syncId } = req.params;

      logger.info('Getting sync progress', { syncId });

      const progress = await this.syncService.getSyncProgress(syncId);

      if (!progress) {
        res.status(404).json({
          success: false,
          error: 'Sync not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: progress
      });

    } catch (error) {
      logger.error('Failed to get sync progress:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Cancel a sync
   */
  async cancelSync(req: Request, res: Response): Promise<void> {
    try {
      const { syncId } = req.params;

      logger.info('Cancelling sync', { syncId });

      await this.syncService.cancelSync(syncId);

      res.status(200).json({
        success: true,
        data: {
          message: 'Sync cancelled successfully'
        }
      });

    } catch (error) {
      logger.error('Failed to cancel sync:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get user's sync history
   */
  async getSyncHistory(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { limit = 20, offset = 0 } = req.query;

      logger.info('Getting sync history', { userId, limit, offset });

      const syncLogs = await syncLogModel.findByUserId(
        userId, 
        parseInt(limit as string), 
        parseInt(offset as string)
      );

      res.status(200).json({
        success: true,
        data: {
          syncLogs,
          pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            total: syncLogs.length // TODO: Add total count
          }
        }
      });

    } catch (error) {
      logger.error('Failed to get sync history:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get user's reports
   */
  async getUserReports(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { limit = 50, offset = 0, status, reportType } = req.query;

      logger.info('Getting user reports', { userId, limit, offset, status, reportType });

      let reports;
      if (status) {
        reports = await reportModel.findByStatus(status as any, parseInt(limit as string));
      } else {
        reports = await reportModel.findByUserId(
          userId, 
          parseInt(limit as string), 
          parseInt(offset as string)
        );
      }

      // Filter by report type if specified
      if (reportType) {
        reports = reports.filter(report => report.reportType === reportType);
      }

      res.status(200).json({
        success: true,
        data: {
          reports,
          pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            total: reports.length // TODO: Add total count
          }
        }
      });

    } catch (error) {
      logger.error('Failed to get user reports:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get report details
   */
  async getReportDetails(req: Request, res: Response): Promise<void> {
    try {
      const { reportId } = req.params;

      logger.info('Getting report details', { reportId });

      const report = await reportModel.findById(reportId);

      if (!report) {
        res.status(404).json({
          success: false,
          error: 'Report not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: report
      });

    } catch (error) {
      logger.error('Failed to get report details:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get sync statistics
   */
  async getSyncStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      logger.info('Getting sync statistics', { userId });

      const [syncStats, reportStats] = await Promise.all([
        syncLogModel.getStats(userId),
        reportModel.getStats(userId)
      ]);

      res.status(200).json({
        success: true,
        data: {
          sync: syncStats,
          reports: reportStats
        }
      });

    } catch (error) {
      logger.error('Failed to get sync statistics:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get active sync for user
   */
  async getActiveSync(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      logger.info('Getting active sync', { userId });

      const activeSync = await syncLogModel.findActiveSync(userId);

      res.status(200).json({
        success: true,
        data: activeSync
      });

    } catch (error) {
      logger.error('Failed to get active sync:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Test connections
   */
  async testConnections(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Testing connections');

      const connections = await this.syncService.testConnections();

      res.status(200).json({
        success: true,
        data: connections
      });

    } catch (error) {
      logger.error('Failed to test connections:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get supported report types
   */
  async getSupportedReportTypes(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Getting supported report types');

      const reportTypes = Object.values(ReportType);

      res.status(200).json({
        success: true,
        data: {
          reportTypes,
          count: reportTypes.length
        }
      });

    } catch (error) {
      logger.error('Failed to get supported report types:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Health check
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Health check requested');

      const connections = await this.syncService.testConnections();
      const isHealthy = connections.amazon && connections.s3 && connections.database;

      res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        data: {
          status: isHealthy ? 'healthy' : 'unhealthy',
          connections,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Health check failed:', error);
      res.status(503).json({
        success: false,
        error: 'Service unhealthy',
        data: {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        }
      });
    }
  }
} 