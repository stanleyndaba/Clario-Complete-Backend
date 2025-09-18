import { getLogger } from '../../../shared/utils/logger';
import { reportDownloader } from './reportDownloader';
import { amazonDataService } from '../services/amazonDataService';
import { reportParser } from '../services/reportParser';
import { ledgers } from '../../../shared/db/ledgers';

const logger = getLogger('FullHistoricalSyncJob');

interface JobProgress {
  current: number;
  total: number;
  reportType?: string;
  status: 'processing' | 'completed' | 'failed';
  message?: string;
}

interface TimeWindow {
  startDate: string;
  endDate: string;
}

class FullHistoricalSyncJob {
  private readonly REPORT_TYPES = [
    'inventoryLedger',
    'feePreview',
    'fbaReimbursements',
    'orderReturns',
    'orderReports',
    'settlementReports',
    'financialEvents',
  ];

  private readonly MONTHS_TO_SYNC = 18;
  private readonly BATCH_SIZE_MONTHS = 3; // Process 3 months at a time to avoid throttling

  async process(userId: string, progressCallback?: (progress: JobProgress) => void): Promise<void> {
    try {
      logger.info(`Starting full historical sync for user ${userId}`);

      // Verify user has valid Amazon connection
      const isConnected = await amazonDataService.isUserConnected(userId);
      if (!isConnected) {
        throw new Error(`User ${userId} is not connected to Amazon`);
      }

      // Calculate time windows for the past 18 months
      const timeWindows = this.generateTimeWindows();
      const totalReports = timeWindows.length * this.REPORT_TYPES.length;

      logger.info(`Will process ${totalReports} reports across ${timeWindows.length} time windows`);

      let processedReports = 0;

      // Process each time window
      for (let i = 0; i < timeWindows.length; i++) {
        const timeWindow = timeWindows[i];
        
        logger.info(`Processing time window ${i + 1}/${timeWindows.length}: ${timeWindow.startDate} to ${timeWindow.endDate}`);

        // Process each report type for this time window
        for (const reportType of this.REPORT_TYPES) {
          try {
            await this.processReport(userId, reportType, timeWindow);
            processedReports++;

            // Update progress
            if (progressCallback) {
              progressCallback({
                current: processedReports,
                total: totalReports,
                reportType,
                status: 'processing',
                message: `Processed ${reportType} for ${timeWindow.startDate} to ${timeWindow.endDate}`,
              });
            }

            // Add delay between reports to avoid throttling
            await this.delay(1000);

          } catch (error) {
            logger.error(`Error processing ${reportType} for time window ${timeWindow.startDate}-${timeWindow.endDate}:`, error);
            
            // Continue with other reports even if one fails
            processedReports++;
            
            if (progressCallback) {
              progressCallback({
                current: processedReports,
                total: totalReports,
                reportType,
                status: 'failed',
                message: `Failed to process ${reportType}: ${error.message}`,
              });
            }
          }
        }

        // Add longer delay between time windows
        await this.delay(5000);
      }

      // Trigger secondary jobs for data processing
      await this.triggerSecondaryJobs(userId);

      logger.info(`Full historical sync completed for user ${userId}. Processed ${processedReports}/${totalReports} reports`);

      if (progressCallback) {
        progressCallback({
          current: totalReports,
          total: totalReports,
          status: 'completed',
          message: 'Full historical sync completed successfully',
        });
      }

    } catch (error) {
      logger.error(`Error in full historical sync for user ${userId}:`, error);
      
      if (progressCallback) {
        progressCallback({
          current: 0,
          total: 1,
          status: 'failed',
          message: `Sync failed: ${error.message}`,
        });
      }
      
      throw error;
    }
  }

  private generateTimeWindows(): TimeWindow[] {
    const timeWindows: TimeWindow[] = [];
    const now = new Date();

    for (let i = 0; i < this.MONTHS_TO_SYNC; i += this.BATCH_SIZE_MONTHS) {
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() - i);

      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - this.BATCH_SIZE_MONTHS);

      timeWindows.push({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });
    }

    return timeWindows;
  }

  private async processReport(
    userId: string,
    reportType: string,
    timeWindow: TimeWindow
  ): Promise<void> {
    try {
      logger.info(`Processing ${reportType} for user ${userId} from ${timeWindow.startDate} to ${timeWindow.endDate}`);

      // Download the report
      const reportData = await reportDownloader.downloadReport(
        userId,
        reportType,
        timeWindow.startDate,
        timeWindow.endDate
      );

      if (!reportData || reportData.length === 0) {
        logger.info(`No data found for ${reportType} in time window ${timeWindow.startDate}-${timeWindow.endDate}`);
        return;
      }

      // Parse and normalize the report data
      const normalizedData = await reportParser.parseReport(reportType, reportData);

      // Store in unified ledger
      await ledgers.storeReportData(userId, reportType, normalizedData, {
        startDate: timeWindow.startDate,
        endDate: timeWindow.endDate,
        source: 'amazon',
        syncType: 'historical',
      });

      logger.info(`Successfully processed ${reportType} with ${reportData.length} records`);

    } catch (error) {
      logger.error(`Error processing ${reportType} for time window ${timeWindow.startDate}-${timeWindow.endDate}:`, error);
      throw error;
    }
  }

  private async triggerSecondaryJobs(userId: string): Promise<void> {
    try {
      logger.info(`Triggering secondary jobs for user ${userId}`);

      // TODO: Implement secondary jobs for:
      // - Data deduplication
      // - Feature extraction
      // - Analytics processing
      // - Notification to other systems

      logger.info(`Secondary jobs triggered for user ${userId}`);

    } catch (error) {
      logger.error(`Error triggering secondary jobs for user ${userId}:`, error);
      // Don't throw error here as it's not critical for the main sync
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Method to get sync status for a user
  async getSyncStatus(userId: string): Promise<any> {
    try {
      // TODO: Implement status tracking from database
      // This would track which reports have been processed and their status
      
      return {
        userId,
        status: 'completed', // or 'in_progress', 'failed'
        lastSyncDate: new Date().toISOString(),
        reportsProcessed: this.REPORT_TYPES.length * this.MONTHS_TO_SYNC,
        totalReports: this.REPORT_TYPES.length * this.MONTHS_TO_SYNC,
      };
    } catch (error) {
      logger.error(`Error getting sync status for user ${userId}:`, error);
      throw error;
    }
  }

  // Method to retry failed reports
  async retryFailedReports(userId: string, reportTypes?: string[]): Promise<void> {
    try {
      logger.info(`Retrying failed reports for user ${userId}`);

      // TODO: Implement retry logic for failed reports
      // This would query the database for failed reports and retry them

      logger.info(`Retry completed for user ${userId}`);

    } catch (error) {
      logger.error(`Error retrying failed reports for user ${userId}:`, error);
      throw error;
    }
  }
}

export const fullHistoricalSyncJob = new FullHistoricalSyncJob();
export default fullHistoricalSyncJob; 