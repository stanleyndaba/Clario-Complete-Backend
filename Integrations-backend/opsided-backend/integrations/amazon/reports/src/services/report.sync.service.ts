import { getLogger } from '@/shared/utils/logger';
import { 
  ReportType, 
  ReportStatus, 
  SyncStatus,
  AmazonAPIConfig,
  ReportRequestOptions 
} from '@/types';
import { AmazonAPIService } from './amazon.api.service';
import { ReportParserService } from './report.parser.service';
import { ReportStorageService, StorageConfig } from './report.storage.service';
import { reportModel } from '@/models/report.model';
import { syncLogModel } from '@/models/syncLog.model';
import { ReportNotifierService } from './report.notifier.service';

const logger = getLogger('ReportSyncService');

export interface SyncOptions {
  userId: string;
  reportTypes?: ReportType[];
  startDate?: Date;
  endDate?: Date;
  marketplaceIds: string[];
  syncType: 'full' | 'incremental';
  priority?: number;
}

export interface SyncProgress {
  syncId: string;
  status: SyncStatus;
  totalReports: number;
  processedReports: number;
  failedReports: number;
  currentReport?: {
    reportId: string;
    reportType: ReportType;
    status: ReportStatus;
  };
  startTime: Date;
  endTime?: Date;
  errorMessage?: string;
}

export class ReportSyncService {
  private amazonAPI: AmazonAPIService;
  private parser: ReportParserService;
  private storage: ReportStorageService;
  private notifier: ReportNotifierService;
  private config: {
    amazon: AmazonAPIConfig;
    storage: StorageConfig;
  };

  constructor(config: { amazon: AmazonAPIConfig; storage: StorageConfig }) {
    this.config = config;
    this.amazonAPI = new AmazonAPIService(config.amazon);
    this.parser = new ReportParserService();
    this.storage = new ReportStorageService(config.storage);
    this.notifier = new ReportNotifierService();
  }

  /**
   * Start a full sync for a user
   */
  async startFullSync(options: SyncOptions): Promise<string> {
    try {
      logger.info('Starting full sync', { userId: options.userId, reportTypes: options.reportTypes });

      // Create sync log
      const syncLog = await syncLogModel.create({
        userId: options.userId,
        syncType: 'full',
        status: SyncStatus.RUNNING,
        startTime: new Date(),
        totalReports: 0,
        processedReports: 0,
        failedReports: 0,
        metadata: {
          reportTypes: options.reportTypes,
          startDate: options.startDate,
          endDate: options.endDate,
          marketplaceIds: options.marketplaceIds
        }
      });

      // Start sync process in background
      this.processSync(syncLog.id, options).catch(error => {
        logger.error('Sync process failed:', error);
        syncLogModel.updateError(syncLog.id, error.message);
      });

      return syncLog.id;
    } catch (error) {
      logger.error('Failed to start full sync:', error);
      throw error;
    }
  }

  /**
   * Start an incremental sync for a user
   */
  async startIncrementalSync(options: SyncOptions): Promise<string> {
    try {
      logger.info('Starting incremental sync', { userId: options.userId });

      // Get last sync time
      const lastSync = await syncLogModel.findByUserId(options.userId, 1);
      const startDate = lastSync.length > 0 ? lastSync[0].endTime : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default to 24 hours ago

      const syncOptions: SyncOptions = {
        ...options,
        syncType: 'incremental',
        startDate
      };

      return this.startFullSync(syncOptions);
    } catch (error) {
      logger.error('Failed to start incremental sync:', error);
      throw error;
    }
  }

  /**
   * Process the sync operation
   */
  private async processSync(syncId: string, options: SyncOptions): Promise<void> {
    try {
      logger.info('Processing sync', { syncId, userId: options.userId });

      const reportTypes = options.reportTypes || this.getDefaultReportTypes();
      let totalReports = 0;
      let processedReports = 0;
      let failedReports = 0;

      // Update sync log with total reports
      await syncLogModel.updateStatus(syncId, SyncStatus.RUNNING, {
        totalReports: reportTypes.length
      });

      // Process each report type
      for (const reportType of reportTypes) {
        try {
          logger.info('Processing report type', { syncId, reportType });

          await syncLogModel.updateProgress(syncId, processedReports, failedReports, {
            currentReport: { reportId: '', reportType, status: ReportStatus.PENDING }
          });

          const reportId = await this.processReportType(syncId, options, reportType);
          
          if (reportId) {
            processedReports++;
            totalReports++;
          } else {
            failedReports++;
          }

          await syncLogModel.updateProgress(syncId, processedReports, failedReports);

        } catch (error) {
          logger.error('Failed to process report type:', error);
          failedReports++;
          await syncLogModel.updateProgress(syncId, processedReports, failedReports);
        }
      }

      // Complete sync
      await syncLogModel.completeSync(syncId, processedReports, failedReports);

      // Send notification
      await this.notifier.notifySyncCompleted(options.userId, syncId, {
        totalReports,
        processedReports,
        failedReports
      });

      logger.info('Sync completed', { syncId, processedReports, failedReports });

    } catch (error) {
      logger.error('Sync process failed:', error);
      await syncLogModel.updateError(syncId, error.message);
      await this.notifier.notifySyncFailed(options.userId, syncId, error.message);
      throw error;
    }
  }

  /**
   * Process a single report type
   */
  private async processReportType(
    syncId: string, 
    options: SyncOptions, 
    reportType: ReportType
  ): Promise<string | null> {
    try {
      logger.info('Processing report type', { syncId, reportType });

      // Request report from Amazon
      const reportRequest = await this.requestReport(options, reportType);
      if (!reportRequest.success || !reportRequest.data) {
        throw new Error(`Failed to request report: ${reportRequest.error}`);
      }

      const reportId = reportRequest.data.reportId;

      // Create report record in database
      const reportRecord = await reportModel.create({
        userId: options.userId,
        reportId,
        reportType,
        dataStartTime: reportRequest.data.dataStartTime,
        dataEndTime: reportRequest.data.dataEndTime,
        marketplaceIds: reportRequest.data.marketplaceIds,
        processingStatus: ReportStatus.PENDING,
        metadata: {
          syncId,
          syncType: options.syncType
        }
      });

      // Monitor report status and download when ready
      const downloaded = await this.monitorAndDownloadReport(reportRecord.id, reportId, reportType);
      if (!downloaded) {
        await reportModel.updateError(reportRecord.id, 'Report download failed');
        return null;
      }

      // Parse and store the report
      await this.parseAndStoreReport(reportRecord.id, reportType);

      return reportId;

    } catch (error) {
      logger.error('Failed to process report type:', error);
      return null;
    }
  }

  /**
   * Request a report from Amazon
   */
  private async requestReport(options: SyncOptions, reportType: ReportType) {
    const requestOptions: ReportRequestOptions = {
      reportType,
      dataStartTime: options.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default to 30 days ago
      dataEndTime: options.endDate || new Date(),
      marketplaceIds: options.marketplaceIds
    };

    return this.amazonAPI.requestReport(requestOptions);
  }

  /**
   * Monitor report status and download when ready
   */
  private async monitorAndDownloadReport(
    reportRecordId: string, 
    reportId: string, 
    reportType: ReportType
  ): Promise<boolean> {
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const statusResponse = await this.amazonAPI.getReportStatus(reportId);
        
        if (!statusResponse.success) {
          logger.error('Failed to get report status:', statusResponse.error);
          return false;
        }

        if (statusResponse.data?.reportDocumentId) {
          // Report is ready, download it
          return await this.downloadReport(reportRecordId, statusResponse.data);
        }

        // Report is still processing, wait and try again
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        attempts++;

        // Update report status
        await reportModel.updateStatus(reportRecordId, ReportStatus.IN_PROGRESS);

      } catch (error) {
        logger.error('Error monitoring report status:', error);
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    logger.error('Report monitoring timed out', { reportId, reportType });
    return false;
  }

  /**
   * Download report document
   */
  private async downloadReport(
    reportRecordId: string, 
    documentInfo: { reportDocumentId: string; url: string; compressionAlgorithm?: string }
  ): Promise<boolean> {
    try {
      logger.info('Downloading report document', { reportRecordId, documentInfo });

      // Update report record with document info
      await reportModel.updateStatus(reportRecordId, ReportStatus.IN_PROGRESS, {
        reportDocumentId: documentInfo.reportDocumentId
      });

      // Download the file
      const reportRecord = await reportModel.findById(reportRecordId);
      if (!reportRecord) {
        throw new Error('Report record not found');
      }

      const localFilePath = this.storage.generateTempFilePath(
        reportRecord.userId, 
        reportRecord.reportId
      );

      const downloadResult = await this.amazonAPI.downloadReportDocument(
        documentInfo.url, 
        localFilePath
      );

      if (!downloadResult.success) {
        throw new Error(`Download failed: ${downloadResult.error}`);
      }

      // Upload to S3
      const storageResult = await this.storage.uploadRawFile(
        localFilePath,
        reportRecord.userId,
        reportRecord.reportType,
        reportRecord.reportId
      );

      // Update report record with S3 info
      await reportModel.updateProcessingResults(
        reportRecordId,
        0, // Will be updated after parsing
        downloadResult.data?.size || 0,
        storageResult.s3Key
      );

      // Clean up local file
      await this.storage.cleanupTempFiles([localFilePath]);

      return true;

    } catch (error) {
      logger.error('Failed to download report:', error);
      return false;
    }
  }

  /**
   * Parse and store report data
   */
  private async parseAndStoreReport(reportRecordId: string, reportType: ReportType): Promise<void> {
    try {
      logger.info('Parsing and storing report', { reportRecordId, reportType });

      const reportRecord = await reportModel.findById(reportRecordId);
      if (!reportRecord || !reportRecord.s3Key) {
        throw new Error('Report record not found or no S3 key');
      }

      // Download from S3 for parsing
      const localFilePath = this.storage.generateTempFilePath(
        reportRecord.userId,
        reportRecord.reportId
      );

      await this.storage.downloadFromS3(reportRecord.s3Key, localFilePath);

      // Parse the report
      const parsedData = await this.parser.parseReport(localFilePath, reportType);

      // Store parsed data
      let storageResult;
      switch (reportType) {
        case ReportType.INVENTORY_LEDGER:
          storageResult = await this.storage.storeInventoryRecords(
            reportRecord.userId,
            reportRecord.reportId,
            parsedData.records
          );
          break;
        case ReportType.FBA_REIMBURSEMENTS:
          storageResult = await this.storage.storeReimbursementRecords(
            reportRecord.userId,
            reportRecord.reportId,
            parsedData.records
          );
          break;
        case ReportType.FBA_RETURNS:
          storageResult = await this.storage.storeReturnsRecords(
            reportRecord.userId,
            reportRecord.reportId,
            parsedData.records
          );
          break;
        case ReportType.FEE_PREVIEW:
          storageResult = await this.storage.storeFeeRecords(
            reportRecord.userId,
            reportRecord.reportId,
            parsedData.records
          );
          break;
        case ReportType.INVENTORY_ADJUSTMENTS:
          storageResult = await this.storage.storeAdjustmentRecords(
            reportRecord.userId,
            reportRecord.reportId,
            parsedData.records
          );
          break;
        default:
          storageResult = await this.storage.storeGenericRecords(
            reportRecord.userId,
            reportRecord.reportId,
            reportType,
            parsedData.records
          );
      }

      // Update report record with final results
      await reportModel.updateProcessingResults(
        reportRecordId,
        storageResult.recordCount,
        storageResult.processingTime
      );

      // Send notification
      await this.notifier.notifyReportProcessed(reportRecord.userId, {
        reportId: reportRecord.reportId,
        reportType: reportRecord.reportType,
        recordCount: storageResult.recordCount,
        processingTime: storageResult.processingTime
      });

      // Clean up local file
      await this.storage.cleanupTempFiles([localFilePath]);

      logger.info('Report parsed and stored successfully', {
        reportRecordId,
        recordCount: storageResult.recordCount,
        processingTime: storageResult.processingTime
      });

    } catch (error) {
      logger.error('Failed to parse and store report:', error);
      await reportModel.updateError(reportRecordId, error.message);
      throw error;
    }
  }

  /**
   * Get sync progress
   */
  async getSyncProgress(syncId: string): Promise<SyncProgress | null> {
    try {
      const syncLog = await syncLogModel.findById(syncId);
      if (!syncLog) {
        return null;
      }

      return {
        syncId: syncLog.id,
        status: syncLog.status,
        totalReports: syncLog.totalReports,
        processedReports: syncLog.processedReports,
        failedReports: syncLog.failedReports,
        startTime: syncLog.startTime,
        endTime: syncLog.endTime,
        errorMessage: syncLog.errorMessage
      };
    } catch (error) {
      logger.error('Failed to get sync progress:', error);
      throw error;
    }
  }

  /**
   * Cancel a sync
   */
  async cancelSync(syncId: string): Promise<void> {
    try {
      logger.info('Cancelling sync', { syncId });

      await syncLogModel.updateStatus(syncId, SyncStatus.FAILED, {
        cancelled: true,
        cancelledAt: new Date()
      });

      // TODO: Cancel any running report requests
      // This would require tracking active report requests

    } catch (error) {
      logger.error('Failed to cancel sync:', error);
      throw error;
    }
  }

  /**
   * Get default report types for full sync
   */
  private getDefaultReportTypes(): ReportType[] {
    return [
      ReportType.INVENTORY_LEDGER,
      ReportType.FBA_REIMBURSEMENTS,
      ReportType.FBA_RETURNS,
      ReportType.FEE_PREVIEW,
      ReportType.INVENTORY_ADJUSTMENTS
    ];
  }

  /**
   * Test all connections
   */
  async testConnections(): Promise<{
    amazon: boolean;
    s3: boolean;
    database: boolean;
  }> {
    try {
      const [amazon, s3, database] = await Promise.all([
        this.amazonAPI.testConnection(),
        this.storage.testS3Connection(),
        this.testDatabaseConnection()
      ]);

      return { amazon, s3, database };
    } catch (error) {
      logger.error('Connection test failed:', error);
      return { amazon: false, s3: false, database: false };
    }
  }

  /**
   * Test database connection
   */
  private async testDatabaseConnection(): Promise<boolean> {
    try {
      await reportModel.findByUserId('test', 1);
      return true;
    } catch (error) {
      logger.error('Database connection test failed:', error);
      return false;
    }
  }
} 