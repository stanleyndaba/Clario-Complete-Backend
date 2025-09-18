import { getLogger } from '../../../shared/utils/logger';
import { amazonDataService } from '../services/amazonDataService';
import { retryHandler } from '../utils/retryHandler';

const logger = getLogger('ReportDownloader');

interface ReportRequest {
  reportType: string;
  startDate: string;
  endDate: string;
  marketplaceIds?: string[];
  dataElements?: string[];
}

interface ReportDocument {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: string;
}

interface ReportData {
  [key: string]: any;
}

class ReportDownloader {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000;
  private readonly RATE_LIMIT_DELAY = 1000;

  async downloadReport(
    userId: string,
    reportType: string,
    startDate: string,
    endDate: string,
    marketplaceIds?: string[]
  ): Promise<ReportData[]> {
    try {
      logger.info(`Starting report download for user ${userId}, type: ${reportType}, period: ${startDate} to ${endDate}`);

      // Step 1: Create report request
      const reportRequest = await this.createReportRequest(userId, reportType, startDate, endDate, marketplaceIds);
      
      // Step 2: Wait for report to be processed
      const reportId = await this.waitForReportProcessing(userId, reportRequest.reportId);
      
      // Step 3: Get report document
      const reportDocument = await this.getReportDocument(userId, reportId);
      
      // Step 4: Download and parse report data
      const reportData = await this.downloadReportData(reportDocument);
      
      logger.info(`Successfully downloaded ${reportType} report with ${reportData.length} records`);
      
      return reportData;

    } catch (error) {
      logger.error(`Error downloading ${reportType} report for user ${userId}:`, error);
      throw error;
    }
  }

  private async createReportRequest(
    userId: string,
    reportType: string,
    startDate: string,
    endDate: string,
    marketplaceIds?: string[]
  ): Promise<{ reportId: string }> {
    try {
      logger.info(`Creating report request for ${reportType}`);

      const request: ReportRequest = {
        reportType,
        startDate,
        endDate,
        marketplaceIds: marketplaceIds || [process.env.AMAZON_MARKETPLACE_ID || ''],
        dataElements: this.getDataElementsForReportType(reportType),
      };

      const response = await retryHandler.executeWithRetry(
        () => amazonDataService.createReport(userId, request),
        this.MAX_RETRIES,
        this.RETRY_DELAY
      );

      logger.info(`Report request created with ID: ${response.reportId}`);
      return response;

    } catch (error) {
      logger.error(`Error creating report request for ${reportType}:`, error);
      throw error;
    }
  }

  private async waitForReportProcessing(userId: string, reportId: string): Promise<string> {
    try {
      logger.info(`Waiting for report ${reportId} to be processed`);

      const maxAttempts = 30; // Wait up to 5 minutes (30 * 10 seconds)
      let attempts = 0;

      while (attempts < maxAttempts) {
        const reportStatus = await retryHandler.executeWithRetry(
          () => amazonDataService.getReportStatus(userId, reportId),
          this.MAX_RETRIES,
          this.RETRY_DELAY
        );

        if (reportStatus.status === 'DONE') {
          logger.info(`Report ${reportId} processing completed`);
          return reportId;
        } else if (reportStatus.status === 'FATAL') {
          throw new Error(`Report ${reportId} processing failed: ${reportStatus.errorDetails || 'Unknown error'}`);
        } else if (reportStatus.status === 'CANCELLED') {
          throw new Error(`Report ${reportId} was cancelled`);
        }

        // Wait before checking again
        await this.delay(10000); // 10 seconds
        attempts++;
      }

      throw new Error(`Report ${reportId} processing timed out after ${maxAttempts} attempts`);

    } catch (error) {
      logger.error(`Error waiting for report ${reportId} processing:`, error);
      throw error;
    }
  }

  private async getReportDocument(userId: string, reportId: string): Promise<ReportDocument> {
    try {
      logger.info(`Getting report document for report ${reportId}`);

      const response = await retryHandler.executeWithRetry(
        () => amazonDataService.getReportDocument(userId, reportId),
        this.MAX_RETRIES,
        this.RETRY_DELAY
      );

      logger.info(`Report document retrieved: ${response.reportDocumentId}`);
      return response;

    } catch (error) {
      logger.error(`Error getting report document for report ${reportId}:`, error);
      throw error;
    }
  }

  private async downloadReportData(reportDocument: ReportDocument): Promise<ReportData[]> {
    try {
      logger.info(`Downloading report data from ${reportDocument.url}`);

      const response = await retryHandler.executeWithRetry(
        () => this.fetchReportData(reportDocument.url),
        this.MAX_RETRIES,
        this.RETRY_DELAY
      );

      // Parse the report data based on compression
      let reportData: ReportData[];
      
      if (reportDocument.compressionAlgorithm === 'GZIP') {
        reportData = await this.parseGzippedData(response);
      } else {
        reportData = await this.parsePlainData(response);
      }

      logger.info(`Successfully parsed ${reportData.length} records from report`);
      return reportData;

    } catch (error) {
      logger.error(`Error downloading report data:`, error);
      throw error;
    }
  }

  private async fetchReportData(url: string): Promise<string> {
    try {
      // Use the amazonDataService to fetch the report data
      // This ensures proper authentication and headers
      const response = await amazonDataService.fetchReportData(url);
      return response;
    } catch (error) {
      logger.error(`Error fetching report data from URL:`, error);
      throw error;
    }
  }

  private async parseGzippedData(data: string): Promise<ReportData[]> {
    try {
      // TODO: Implement GZIP decompression
      // For now, return empty array as placeholder
      logger.info('GZIP decompression not yet implemented');
      return [];
    } catch (error) {
      logger.error('Error parsing GZIP data:', error);
      throw error;
    }
  }

  private async parsePlainData(data: string): Promise<ReportData[]> {
    try {
      // Parse TSV or CSV data
      const lines = data.trim().split('\n');
      const headers = lines[0].split('\t'); // Assuming TSV format
      const records: ReportData[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split('\t');
        const record: ReportData = {};

        headers.forEach((header, index) => {
          record[header.trim()] = values[index]?.trim() || '';
        });

        records.push(record);
      }

      return records;
    } catch (error) {
      logger.error('Error parsing plain data:', error);
      throw error;
    }
  }

  private getDataElementsForReportType(reportType: string): string[] {
    // Define which data elements to include for each report type
    const dataElementsMap: { [key: string]: string[] } = {
      inventoryLedger: ['snapshot-date', 'sku', 'fnsku', 'asin', 'product-name', 'quantity', 'fulfillment-center-id'],
      feePreview: ['fee-type', 'fee-amount', 'currency', 'marketplace-name'],
      fbaReimbursements: ['reimbursement-id', 'reimbursement-type', 'amount', 'currency', 'reason'],
      orderReturns: ['order-id', 'return-date', 'return-reason', 'sku', 'quantity'],
      orderReports: ['order-id', 'order-date', 'sku', 'quantity', 'currency', 'item-price'],
      settlementReports: ['settlement-id', 'settlement-start-date', 'settlement-end-date', 'total-amount'],
      financialEvents: ['event-type', 'event-date', 'amount', 'currency', 'marketplace-name'],
    };

    return dataElementsMap[reportType] || [];
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Method to download multiple reports in parallel (with rate limiting)
  async downloadMultipleReports(
    userId: string,
    reports: Array<{ type: string; startDate: string; endDate: string }>
  ): Promise<{ [key: string]: ReportData[] }> {
    try {
      logger.info(`Downloading ${reports.length} reports for user ${userId}`);

      const results: { [key: string]: ReportData[] } = {};

      // Process reports sequentially to avoid rate limiting
      for (const report of reports) {
        try {
          const data = await this.downloadReport(
            userId,
            report.type,
            report.startDate,
            report.endDate
          );
          results[report.type] = data;

          // Add delay between reports
          await this.delay(this.RATE_LIMIT_DELAY);

        } catch (error) {
          logger.error(`Error downloading report ${report.type}:`, error);
          results[report.type] = [];
        }
      }

      return results;

    } catch (error) {
      logger.error(`Error downloading multiple reports for user ${userId}:`, error);
      throw error;
    }
  }
}

export const reportDownloader = new ReportDownloader();
export default reportDownloader; 