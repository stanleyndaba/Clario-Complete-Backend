import { SellingPartnerAPI } from 'amazon-sp-api';
import { getLogger } from '@/shared/utils/logger';
import { 
  ReportType, 
  ReportStatus, 
  AmazonAPIResponse, 
  ReportRequestResponse, 
  ReportDocumentResponse,
  AmazonConfig 
} from '@/types';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('AmazonAPIService');

export interface AmazonAPIConfig {
  refreshToken: string;
  region: string;
  marketplaceIds: string[];
  roleArn?: string;
  clientId: string;
  clientSecret: string;
}

export interface ReportRequestOptions {
  reportType: ReportType;
  dataStartTime: Date;
  dataEndTime: Date;
  marketplaceIds: string[];
  reportOptions?: Record<string, string>;
}

export interface ReportDocument {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: string;
  size?: number;
}

export class AmazonAPIService {
  private spApi: SellingPartnerAPI;
  private config: AmazonAPIConfig;

  constructor(config: AmazonAPIConfig) {
    this.config = config;
    this.initializeSPAPI();
  }

  /**
   * Initialize the Selling Partner API client
   */
  private initializeSPAPI(): void {
    try {
      this.spApi = new SellingPartnerAPI({
        region: this.config.region,
        refresh_token: this.config.refreshToken,
        credentials: {
          SELLING_PARTNER_APP_CLIENT_ID: this.config.clientId,
          SELLING_PARTNER_APP_CLIENT_SECRET: this.config.clientSecret,
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID!,
          AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY!,
          AWS_SELLING_PARTNER_ROLE: this.config.roleArn
        }
      });

      logger.info('Amazon SP-API client initialized', { region: this.config.region });
    } catch (error) {
      logger.error('Failed to initialize Amazon SP-API client:', error);
      throw error;
    }
  }

  /**
   * Request a new report from Amazon SP-API
   */
  async requestReport(options: ReportRequestOptions): Promise<AmazonAPIResponse<ReportRequestResponse>> {
    try {
      logger.info('Requesting report from Amazon SP-API', {
        reportType: options.reportType,
        dataStartTime: options.dataStartTime,
        dataEndTime: options.dataEndTime
      });

      const response = await this.spApi.callAPI({
        operation: 'reports.createReport',
        query: {
          reportType: options.reportType,
          dataStartTime: options.dataStartTime.toISOString(),
          dataEndTime: options.dataEndTime.toISOString(),
          marketplaceIds: options.marketplaceIds,
          reportOptions: options.reportOptions
        }
      });

      const reportRequest = response.data;
      
      logger.info('Report request successful', { 
        reportId: reportRequest.reportId,
        reportType: reportRequest.reportType 
      });

      return {
        success: true,
        data: {
          reportId: reportRequest.reportId,
          reportType: reportRequest.reportType as ReportType,
          dataStartTime: new Date(reportRequest.dataStartTime),
          dataEndTime: new Date(reportRequest.dataEndTime),
          marketplaceIds: reportRequest.marketplaceIds
        }
      };
    } catch (error) {
      logger.error('Failed to request report:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get report status and document information
   */
  async getReportStatus(reportId: string): Promise<AmazonAPIResponse<ReportDocumentResponse>> {
    try {
      logger.info('Getting report status', { reportId });

      const response = await this.spApi.callAPI({
        operation: 'reports.getReport',
        path: {
          reportId
        }
      });

      const report = response.data;
      
      if (report.processingStatus === 'DONE' && report.reportDocumentId) {
        // Get the document information
        const documentResponse = await this.spApi.callAPI({
          operation: 'reports.getReportDocument',
          path: {
            reportDocumentId: report.reportDocumentId
          }
        });

        const document = documentResponse.data;

        logger.info('Report ready for download', { 
          reportId,
          reportDocumentId: report.reportDocumentId,
          url: document.url 
        });

        return {
          success: true,
          data: {
            reportDocumentId: report.reportDocumentId,
            url: document.url,
            compressionAlgorithm: document.compressionAlgorithm
          }
        };
      } else if (report.processingStatus === 'CANCELLED') {
        return {
          success: false,
          error: 'Report processing was cancelled'
        };
      } else if (report.processingStatus === 'FATAL') {
        return {
          success: false,
          error: 'Report processing failed fatally'
        };
      } else {
        // Report is still processing
        return {
          success: true,
          data: {
            reportDocumentId: '',
            url: '',
            processingStatus: report.processingStatus
          }
        };
      }
    } catch (error) {
      logger.error('Failed to get report status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Download report document
   */
  async downloadReportDocument(documentUrl: string, localPath: string): Promise<AmazonAPIResponse<{ size: number }>> {
    try {
      logger.info('Downloading report document', { documentUrl, localPath });

      // Ensure directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Download the file
      const response = await axios({
        method: 'GET',
        url: documentUrl,
        responseType: 'stream',
        timeout: 300000, // 5 minutes timeout
        headers: {
          'User-Agent': 'Opside-FBA-Report-Sync/1.0'
        }
      });

      const writer = fs.createWriteStream(localPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          const stats = fs.statSync(localPath);
          logger.info('Report document downloaded successfully', { 
            localPath, 
            size: stats.size 
          });
          
          resolve({
            success: true,
            data: { size: stats.size }
          });
        });

        writer.on('error', (error) => {
          logger.error('Failed to write report document:', error);
          reject({
            success: false,
            error: error.message
          });
        });
      });
    } catch (error) {
      logger.error('Failed to download report document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * List available reports
   */
  async listReports(
    reportTypes?: ReportType[],
    processingStatuses?: string[],
    dataStartTime?: Date,
    dataEndTime?: Date,
    nextToken?: string
  ): Promise<AmazonAPIResponse<{
    reports: any[];
    nextToken?: string;
  }>> {
    try {
      logger.info('Listing reports from Amazon SP-API');

      const query: any = {};
      
      if (reportTypes && reportTypes.length > 0) {
        query.reportTypes = reportTypes;
      }
      
      if (processingStatuses && processingStatuses.length > 0) {
        query.processingStatuses = processingStatuses;
      }
      
      if (dataStartTime) {
        query.dataStartTime = dataStartTime.toISOString();
      }
      
      if (dataEndTime) {
        query.dataEndTime = dataEndTime.toISOString();
      }
      
      if (nextToken) {
        query.nextToken = nextToken;
      }

      const response = await this.spApi.callAPI({
        operation: 'reports.getReports',
        query
      });

      const reports = response.data.reports || [];
      const responseNextToken = response.data.nextToken;

      logger.info('Retrieved reports list', { 
        count: reports.length,
        hasNextToken: !!responseNextToken 
      });

      return {
        success: true,
        data: {
          reports,
          nextToken: responseNextToken
        },
        pagination: {
          nextToken: responseNextToken,
          hasMore: !!responseNextToken
        }
      };
    } catch (error) {
      logger.error('Failed to list reports:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Cancel a report request
   */
  async cancelReport(reportId: string): Promise<AmazonAPIResponse<void>> {
    try {
      logger.info('Cancelling report', { reportId });

      await this.spApi.callAPI({
        operation: 'reports.cancelReport',
        path: {
          reportId
        }
      });

      logger.info('Report cancelled successfully', { reportId });

      return {
        success: true
      };
    } catch (error) {
      logger.error('Failed to cancel report:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get report schedules
   */
  async getReportSchedules(reportTypes?: ReportType[]): Promise<AmazonAPIResponse<any[]>> {
    try {
      logger.info('Getting report schedules');

      const query: any = {};
      if (reportTypes && reportTypes.length > 0) {
        query.reportTypes = reportTypes;
      }

      const response = await this.spApi.callAPI({
        operation: 'reports.getReportSchedules',
        query
      });

      const schedules = response.data.reportSchedules || [];

      logger.info('Retrieved report schedules', { count: schedules.length });

      return {
        success: true,
        data: schedules
      };
    } catch (error) {
      logger.error('Failed to get report schedules:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Create a report schedule
   */
  async createReportSchedule(
    reportType: ReportType,
    period: string,
    marketplaceIds: string[]
  ): Promise<AmazonAPIResponse<{ scheduleId: string }>> {
    try {
      logger.info('Creating report schedule', { reportType, period });

      const response = await this.spApi.callAPI({
        operation: 'reports.createReportSchedule',
        query: {
          reportType,
          period,
          marketplaceIds
        }
      });

      const schedule = response.data;
      
      logger.info('Report schedule created successfully', { 
        scheduleId: schedule.scheduleId 
      });

      return {
        success: true,
        data: {
          scheduleId: schedule.scheduleId
        }
      };
    } catch (error) {
      logger.error('Failed to create report schedule:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Delete a report schedule
   */
  async deleteReportSchedule(scheduleId: string): Promise<AmazonAPIResponse<void>> {
    try {
      logger.info('Deleting report schedule', { scheduleId });

      await this.spApi.callAPI({
        operation: 'reports.deleteReportSchedule',
        path: {
          scheduleId
        }
      });

      logger.info('Report schedule deleted successfully', { scheduleId });

      return {
        success: true
      };
    } catch (error) {
      logger.error('Failed to delete report schedule:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      logger.info('Testing Amazon SP-API connection');

      // Try to list reports with a small limit
      const response = await this.listReports([], [], undefined, undefined, undefined);
      
      if (response.success) {
        logger.info('Amazon SP-API connection test successful');
        return true;
      } else {
        logger.error('Amazon SP-API connection test failed:', response.error);
        return false;
      }
    } catch (error) {
      logger.error('Amazon SP-API connection test failed:', error);
      return false;
    }
  }

  /**
   * Get API rate limits and usage
   */
  async getRateLimitInfo(): Promise<{
    remainingRequests: number;
    resetTime: Date;
  } | null> {
    try {
      // Note: Amazon SP-API doesn't provide rate limit headers in responses
      // This is a placeholder for future implementation
      logger.info('Rate limit info not available from Amazon SP-API');
      return null;
    } catch (error) {
      logger.error('Failed to get rate limit info:', error);
      return null;
    }
  }
} 