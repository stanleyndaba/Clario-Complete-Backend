import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { getLogger } from '../../../shared/utils/logger';
import { getDatabase } from '../../../shared/db/connection';
import config from '../config/env';
import { S3Archiver } from './s3ArchiverService';

const logger = getLogger('AmazonSPAPIService');

export interface AmazonInventoryItem {
  sku: string;
  fnSku?: string;
  asin?: string;
  title?: string;
  quantity: number;
  condition: 'New' | 'Used' | 'Collectible' | 'Refurbished';
  location?: string;
  lastUpdated: Date;
  marketplaceId: string;
  sellerId: string;
}

export interface AmazonInventorySummary {
  asin: string;
  fnSku?: string;
  sellerSku: string;
  condition: string;
  inventoryDetails: {
    availableQuantity: number;
    reservedQuantity: number;
    totalQuantity: number;
    inStockQuantity: number;
    damagedQuantity: number;
    lostQuantity: number;
    unfulfillableQuantity: number;
  };
  lastUpdatedTime: string;
  marketplaceId: string;
}

export interface AmazonInventoryReport {
  reportId: string;
  reportType: string;
  dataStartTime: string;
  dataEndTime: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  reportDocumentId?: string;
}

export interface AmazonFinancialEvent {
  postedDate: string;
  amount: number;
  currency: string;
  type: string; // e.g., FBA Inventory Reimbursement, ServiceFee
  orderId?: string;
  shipmentId?: string;
  description?: string;
}

export interface AmazonSPAPIConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  marketplaceId: string;
  sellerId: string;
  region: string;
  roleArn?: string;
}

export class AmazonSPAPIService {
  private config: AmazonSPAPIConfig;
  private httpClient: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private rateLimitDelay: number = 1000; // 1 second between requests
  private lastRequestTime: number = 0;

  constructor(config: AmazonSPAPIConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: this.getBaseURL(),
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Opsided-Smart-Inventory-Sync/1.0.0',
      },
    });

    // Add request interceptor for rate limiting
    this.httpClient.interceptors.request.use(async (config) => {
      await this.enforceRateLimit();
      return config;
    });

    // Add response interceptor for token refresh
    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && this.accessToken) {
          logger.warn('Token expired, attempting refresh');
          await this.refreshAccessToken();
          // Retry the request with new token
          if (error.config) {
            error.config.headers.Authorization = `Bearer ${this.accessToken}`;
            return this.httpClient.request(error.config);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private getBaseURL(): string {
    const regionMap: { [key: string]: string } = {
      'us-east-1': 'https://sellingpartnerapi-na.amazon.com',
      'eu-west-1': 'https://sellingpartnerapi-eu.amazon.com',
      'us-west-2': 'https://sellingpartnerapi-fe.amazon.com',
    };
    
    return regionMap[this.config.region] || regionMap['us-east-1'];
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      const delay = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    await this.refreshAccessToken();
    return this.accessToken!;
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      logger.info('Refreshing Amazon SP-API access token');
      
      const response = await axios.post('https://api.amazon.com/auth/o2/token', {
        grant_type: 'refresh_token',
        refresh_token: this.config.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000));
      
      logger.info('Access token refreshed successfully');
    } catch (error) {
      logger.error('Failed to refresh access token:', error);
      throw new Error('Failed to authenticate with Amazon SP-API');
    }
  }

  async fetchInventorySummaries(marketplaceIds: string[]): Promise<AmazonInventorySummary[]> {
    try {
      const token = await this.getAccessToken();
      
      const response: AxiosResponse<{ payload: { inventorySummaries: AmazonInventorySummary[] } }> = 
        await this.httpClient.get('/fba/inventory/v1/summaries', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-amz-access-token': token,
          },
          params: {
            marketplaceIds: marketplaceIds.join(','),
            granularityType: 'Marketplace',
            granularityId: this.config.marketplaceId,
          },
        });

      const summaries = response.data.payload.inventorySummaries || [];
      logger.info(`Fetched ${summaries.length} inventory summaries from Amazon SP-API`);
      
      return summaries;
    } catch (error) {
      logger.error('Error fetching inventory summaries:', error);
      throw new Error(`Failed to fetch inventory summaries: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async fetchInventoryItems(marketplaceIds: string[], skus?: string[]): Promise<AmazonInventoryItem[]> {
    try {
      const token = await this.getAccessToken();
      
      const params: any = {
        marketplaceIds: marketplaceIds.join(','),
        granularityType: 'Marketplace',
        granularityId: this.config.marketplaceId,
      };

      if (skus && skus.length > 0) {
        params.sellerSkus = skus.join(',');
      }

      const response: AxiosResponse<{ payload: { inventorySummaries: AmazonInventorySummary[] } }> = 
        await this.httpClient.get('/fba/inventory/v1/summaries', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-amz-access-token': token,
          },
          params,
        });

      const rawPayload = response.data;
      const summaries = rawPayload.payload.inventorySummaries || [];
      const items: AmazonInventoryItem[] = summaries.map(summary => ({
        sku: summary.sellerSku,
        fnSku: summary.fnSku,
        asin: summary.asin,
        quantity: summary.inventoryDetails.availableQuantity,
        condition: summary.condition as any,
        lastUpdated: new Date(summary.lastUpdatedTime),
        marketplaceId: summary.marketplaceId,
        sellerId: this.config.sellerId,
      }));

      logger.info(`Fetched ${items.length} inventory items from Amazon SP-API`);

      // Archive raw response to S3 for audit/debug
      try {
        await S3Archiver.archiveJSON({
          bucket: config.S3_BUCKET,
          region: config.S3_REGION,
          prefix: `${config.S3_PREFIX}/amazon/inventory`,
          userId: this.config.sellerId,
          dataset: 'inventorySummaries',
          data: rawPayload,
        });
      } catch (e) {
        logger.warn('S3 archival failed (non-fatal)', e);
      }
      return items;
    } catch (error) {
      logger.error('Error fetching inventory items:', error);
      throw new Error(`Failed to fetch inventory items: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createInventoryReport(reportType: string, marketplaceIds: string[], dataStartTime?: string, dataEndTime?: string): Promise<AmazonInventoryReport> {
    try {
      const token = await this.getAccessToken();
      
      const requestBody = {
        reportType,
        marketplaceIds,
        dataStartTime: dataStartTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        dataEndTime: dataEndTime || new Date().toISOString(),
      };

      const response: AxiosResponse<{ payload: AmazonInventoryReport }> = 
        await this.httpClient.post('/reports/2021-06-30/reports', requestBody, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-amz-access-token': token,
          },
        });

      const report = response.data.payload;
      logger.info(`Created inventory report: ${report.reportId}`);
      
      return report;
    } catch (error) {
      logger.error('Error creating inventory report:', error);
      throw new Error(`Failed to create inventory report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getReport(reportId: string): Promise<AmazonInventoryReport> {
    try {
      const token = await this.getAccessToken();
      
      const response: AxiosResponse<{ payload: AmazonInventoryReport }> = 
        await this.httpClient.get(`/reports/2021-06-30/reports/${reportId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-amz-access-token': token,
          },
        });

      const report = response.data.payload;
      logger.info(`Retrieved report status: ${report.reportId} - ${report.status}`);
      
      return report;
    } catch (error) {
      logger.error('Error getting report:', error);
      throw new Error(`Failed to get report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async downloadReport(reportDocumentId: string): Promise<any> {
    try {
      const token = await this.getAccessToken();
      
      const response: AxiosResponse = await this.httpClient.get(`/reports/2021-06-30/documents/${reportDocumentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-amz-access-token': token,
        },
      });

      logger.info(`Downloaded report document: ${reportDocumentId}`);
      return response.data;
    } catch (error) {
      logger.error('Error downloading report:', error);
      throw new Error(`Failed to download report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Fetch financial events (simplified placeholder using reports API path; real SP-API requires Finances API)
  async fetchFinancialEvents(marketplaceIds: string[], startDateISO?: string, endDateISO?: string): Promise<AmazonFinancialEvent[]> {
    try {
      const token = await this.getAccessToken();
      const params: any = {
        marketplaceIds: marketplaceIds.join(','),
        startDate: startDateISO || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: endDateISO || new Date().toISOString(),
      };
      // NOTE: In production, use Finances API endpoints. Here we simulate via a generic endpoint for MVP shape.
      const response: AxiosResponse<{ payload: any[] }> = await this.httpClient.get('/finances/v0/events', {
        headers: { 'Authorization': `Bearer ${token}`, 'x-amz-access-token': token },
        params,
      } as any);

      const raw = response.data.payload || [];
      const events: AmazonFinancialEvent[] = raw.map((e: any) => ({
        postedDate: e.postedDate || e.posted_date || new Date().toISOString(),
        amount: Math.round(((e.amount?.amount ?? 0) as number) * 100) / 100,
        currency: e.amount?.currencyCode || 'USD',
        type: e.eventType || e.type || 'Unknown',
        orderId: e.amazonOrderId,
        shipmentId: e.shipmentId,
        description: e.description || e.memo,
      }));

      // Archive raw to S3
      try {
        await S3Archiver.archiveJSON({
          bucket: (require('../config/env').default.S3_BUCKET),
          region: (require('../config/env').default.S3_REGION),
          prefix: `${(require('../config/env').default.S3_PREFIX)}/amazon/financial_events`,
          userId: this.config.sellerId,
          dataset: 'financial_events',
          data: response.data,
        });
      } catch (err) {
        logger.warn('S3 archival failed for financial events (non-fatal)', err);
      }

      logger.info(`Fetched ${events.length} financial events from Amazon`);
      return events;
    } catch (error) {
      logger.error('Error fetching financial events:', error);
      // Non-fatal; return [] to avoid pipeline break
      return [];
    }
  }

  async waitForReportCompletion(reportId: string, maxWaitTime: number = 300000): Promise<AmazonInventoryReport> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const report = await this.getReport(reportId);
      
      if (report.status === 'COMPLETED') {
        logger.info(`Report ${reportId} completed successfully`);
        return report;
      }
      
      if (report.status === 'FAILED' || report.status === 'CANCELLED') {
        throw new Error(`Report ${reportId} failed with status: ${report.status}`);
      }
      
      // Wait 30 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 30000));
      logger.info(`Report ${reportId} still in progress, waiting...`);
    }
    
    throw new Error(`Report ${reportId} did not complete within ${maxWaitTime / 1000} seconds`);
  }

  async getInventoryHealth(): Promise<{ status: string; lastSync: Date | null; errorCount: number }> {
    try {
      // Test API connectivity by making a simple request
      await this.fetchInventorySummaries([this.config.marketplaceId]);
      
      return {
        status: 'healthy',
        lastSync: new Date(),
        errorCount: 0,
      };
    } catch (error) {
      logger.error('Amazon SP-API health check failed:', error);
      return {
        status: 'unhealthy',
        lastSync: null,
        errorCount: 1,
      };
    }
  }

  // Utility method to convert Amazon inventory to our internal format
  convertToInternalFormat(amazonItems: AmazonInventoryItem[], userId: string): any[] {
    return amazonItems.map(item => ({
      sku: item.sku,
      title: item.title || `SKU: ${item.sku}`,
      quantity_available: item.quantity,
      quantity_reserved: 0,
      quantity_shipped: 0,
      reorder_point: 10, // Default reorder point
      reorder_quantity: 50, // Default reorder quantity
      is_active: true,
      user_id: userId,
      metadata: {
        amazon_asin: item.asin,
        amazon_fnsku: item.fnSku,
        amazon_condition: item.condition,
        amazon_marketplace_id: item.marketplaceId,
        last_synced_from_amazon: item.lastUpdated,
      },
    }));
  }
}

