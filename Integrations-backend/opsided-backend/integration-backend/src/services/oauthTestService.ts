import axios, { AxiosResponse } from 'axios';
import { getLogger } from '../../../shared/utils/logger';
import { 
  AppError, 
  ExternalServiceError, 
  AuthenticationError,
  ErrorType,
  ErrorSeverity 
} from '../../../shared/utils/errorHandler';
import config from '../config/env';

const logger = getLogger('OAuthTestService');

// ========================================
// INTERFACES
// ========================================

export interface OAuthTestResult {
  provider: string;
  status: 'success' | 'failed' | 'pending';
  message: string;
  details?: any;
  timestamp: string;
  responseTime: number;
}

export interface AmazonSPAPITestResult extends OAuthTestResult {
  provider: 'amazon';
  marketplaceId?: string;
  sellerId?: string;
  permissions?: string[];
  apiEndpoints?: string[];
}

export interface GmailAPITestResult extends OAuthTestResult {
  provider: 'gmail';
  emailAddress?: string;
  permissions?: string[];
  quota?: any;
}

export interface StripeAPITestResult extends OAuthTestResult {
  provider: 'stripe';
  accountId?: string;
  accountType?: string;
  permissions?: string[];
  capabilities?: any;
}

export type TestResult = AmazonSPAPITestResult | GmailAPITestResult | StripeAPITestResult;

// ========================================
// AMAZON SP-API TESTING
// ========================================

export class AmazonSPAPITester {
  private accessToken: string;
  private region: string;

  constructor(accessToken: string, region: string = 'us-east-1') {
    this.accessToken = accessToken;
    this.region = region;
  }

  async testConnection(): Promise<AmazonSPAPITestResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Testing Amazon SP-API connection', { region: this.region });

      // Test 1: Get catalog item (basic API access)
      const catalogResult = await this.testCatalogAPI();
      
      // Test 2: Get inventory (inventory permissions)
      const inventoryResult = await this.testInventoryAPI();
      
      // Test 3: Get reports (reports permissions)
      const reportsResult = await this.testReportsAPI();
      
      // Test 4: Get orders (orders permissions)
      const ordersResult = await this.testOrdersAPI();

      const responseTime = Date.now() - startTime;
      
      const result: AmazonSPAPITestResult = {
        provider: 'amazon',
        status: 'success',
        message: 'Amazon SP-API connection successful',
        timestamp: new Date().toISOString(),
        responseTime,
        marketplaceId: catalogResult.marketplaceId,
        sellerId: catalogResult.sellerId,
        permissions: this.determinePermissions({
          catalog: catalogResult.success,
          inventory: inventoryResult.success,
          reports: reportsResult.success,
          orders: ordersResult.success
        }),
        apiEndpoints: this.getTestedEndpoints({
          catalog: catalogResult.success,
          inventory: inventoryResult.success,
          reports: reportsResult.success,
          orders: ordersResult.success
        }),
        details: {
          catalog: catalogResult,
          inventory: inventoryResult,
          reports: reportsResult,
          orders: ordersResult
        }
      };

      logger.info('Amazon SP-API test completed successfully', result);
      return result;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Amazon SP-API test failed', { error: error.message, responseTime });

      return {
        provider: 'amazon',
        status: 'failed',
        message: `Amazon SP-API test failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        responseTime,
        details: { error: error.message, stack: error.stack }
      };
    }
  }

  private async testCatalogAPI(): Promise<any> {
    try {
      const response = await axios.get(
        `${config.AMAZON_API_ENDPOINT}/catalog/v0/items/ASIN123`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'x-amz-access-token': this.accessToken
          },
          params: {
            marketplaceIds: config.AMAZON_MARKETPLACE_ID
          }
        }
      );

      return {
        success: true,
        marketplaceId: config.AMAZON_MARKETPLACE_ID,
        sellerId: response.data?.sellerId,
        statusCode: response.status
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testInventoryAPI(): Promise<any> {
    try {
      const response = await axios.get(
        `${config.AMAZON_API_ENDPOINT}/fba/inventory/v1/summaries`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'x-amz-access-token': this.accessToken
          },
          params: {
            marketplaceIds: config.AMAZON_MARKETPLACE_ID,
            granularityType: 'Marketplace'
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        inventoryCount: response.data?.inventorySummaries?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testReportsAPI(): Promise<any> {
    try {
      const response = await axios.get(
        `${config.AMAZON_API_ENDPOINT}/reports/2021-06-30/reports`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'x-amz-access-token': this.accessToken
          },
          params: {
            marketplaceIds: config.AMAZON_MARKETPLACE_ID,
            maxCount: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        reportsCount: response.data?.reports?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testOrdersAPI(): Promise<any> {
    try {
      const response = await axios.get(
        `${config.AMAZON_API_ENDPOINT}/orders/v0/orders`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'x-amz-access-token': this.accessToken
          },
          params: {
            MarketplaceIds: config.AMAZON_MARKETPLACE_ID,
            MaxResultsPerPage: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        ordersCount: response.data?.Orders?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private determinePermissions(testResults: any): string[] {
    const permissions: string[] = ['basic_access'];
    
    if (testResults.catalog) permissions.push('catalog_read');
    if (testResults.inventory) permissions.push('inventory_read');
    if (testResults.reports) permissions.push('reports_read');
    if (testResults.orders) permissions.push('orders_read');
    
    return permissions;
  }

  private getTestedEndpoints(testResults: any): string[] {
    const endpoints: string[] = [];
    
    if (testResults.catalog) endpoints.push('/catalog/v0/items');
    if (testResults.inventory) endpoints.push('/fba/inventory/v1/summaries');
    if (testResults.reports) endpoints.push('/reports/2021-06-30/reports');
    if (testResults.orders) endpoints.push('/orders/v0/orders');
    
    return endpoints;
  }
}

// ========================================
// GMAIL API TESTING
// ========================================

export class GmailAPITester {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async testConnection(): Promise<GmailAPITestResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Testing Gmail API connection');

      // Test 1: Get user profile
      const profileResult = await this.testProfileAPI();
      
      // Test 2: Get labels
      const labelsResult = await this.testLabelsAPI();
      
      // Test 3: Get emails
      const emailsResult = await this.testEmailsAPI();
      
      // Test 4: Get quota
      const quotaResult = await this.testQuotaAPI();

      const responseTime = Date.now() - startTime;
      
      const result: GmailAPITestResult = {
        provider: 'gmail',
        status: 'success',
        message: 'Gmail API connection successful',
        timestamp: new Date().toISOString(),
        responseTime,
        emailAddress: profileResult.emailAddress,
        permissions: this.determinePermissions({
          profile: profileResult.success,
          labels: labelsResult.success,
          emails: emailsResult.success,
          quota: quotaResult.success
        }),
        quota: quotaResult.quota,
        details: {
          profile: profileResult,
          labels: labelsResult,
          emails: emailsResult,
          quota: quotaResult
        }
      };

      logger.info('Gmail API test completed successfully', result);
      return result;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Gmail API test failed', { error: error.message, responseTime });

      return {
        provider: 'gmail',
        status: 'failed',
        message: `Gmail API test failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        responseTime,
        details: { error: error.message, stack: error.stack }
      };
    }
  }

  private async testProfileAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        emailAddress: response.data?.emailAddress,
        messagesTotal: response.data?.messagesTotal,
        threadsTotal: response.data?.threadsTotal
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testLabelsAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/labels',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        labelsCount: response.data?.labels?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testEmailsAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          },
          params: {
            maxResults: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        emailsCount: response.data?.messages?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testQuotaAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/quota',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        quota: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private determinePermissions(testResults: any): string[] {
    const permissions: string[] = ['basic_access'];
    
    if (testResults.profile) permissions.push('profile_read');
    if (testResults.labels) permissions.push('labels_read');
    if (testResults.emails) permissions.push('emails_read');
    if (testResults.quota) permissions.push('quota_read');
    
    return permissions;
  }
}

// ========================================
// STRIPE API TESTING
// ========================================

export class StripeAPITester {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async testConnection(): Promise<StripeAPITestResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Testing Stripe API connection');

      // Test 1: Get account details
      const accountResult = await this.testAccountAPI();
      
      // Test 2: Get charges
      const chargesResult = await this.testChargesAPI();
      
      // Test 3: Get customers
      const customersResult = await this.testCustomersAPI();
      
      // Test 4: Get subscriptions
      const subscriptionsResult = await this.testSubscriptionsAPI();

      const responseTime = Date.now() - startTime;
      
      const result: StripeAPITestResult = {
        provider: 'stripe',
        status: 'success',
        message: 'Stripe API connection successful',
        timestamp: new Date().toISOString(),
        responseTime,
        accountId: accountResult.accountId,
        accountType: accountResult.accountType,
        permissions: this.determinePermissions({
          account: accountResult.success,
          charges: chargesResult.success,
          customers: customersResult.success,
          subscriptions: subscriptionsResult.success
        }),
        capabilities: accountResult.capabilities,
        details: {
          account: accountResult,
          charges: chargesResult,
          customers: customersResult,
          subscriptions: subscriptionsResult
        }
      };

      logger.info('Stripe API test completed successfully', result);
      return result;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Stripe API test failed', { error: error.message, responseTime });

      return {
        provider: 'stripe',
        status: 'failed',
        message: `Stripe API test failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        responseTime,
        details: { error: error.message, stack: error.stack }
      };
    }
  }

  private async testAccountAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://api.stripe.com/v1/account',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Stripe-Version': '2023-10-16'
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        accountId: response.data?.id,
        accountType: response.data?.type,
        capabilities: response.data?.capabilities,
        country: response.data?.country,
        chargesEnabled: response.data?.charges_enabled
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testChargesAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://api.stripe.com/v1/charges',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Stripe-Version': '2023-10-16'
          },
          params: {
            limit: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        chargesCount: response.data?.data?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testCustomersAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://api.stripe.com/v1/customers',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Stripe-Version': '2023-10-16'
          },
          params: {
            limit: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        customersCount: response.data?.data?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testSubscriptionsAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://api.stripe.com/v1/subscriptions',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Stripe-Version': '2023-10-16'
          },
          params: {
            limit: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        subscriptionsCount: response.data?.data?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private determinePermissions(testResults: any): string[] {
    const permissions: string[] = ['basic_access'];
    
    if (testResults.account) permissions.push('account_read');
    if (testResults.charges) permissions.push('charges_read');
    if (testResults.customers) permissions.push('customers_read');
    if (testResults.subscriptions) permissions.push('subscriptions_read');
    
    return permissions;
  }
}

// ========================================
// MAIN TESTING SERVICE
// ========================================

export class OAuthTestService {
  async testAmazonSPAPI(accessToken: string, region?: string): Promise<AmazonSPAPITestResult> {
    const tester = new AmazonSPAPITester(accessToken, region);
    return await tester.testConnection();
  }

  async testGmailAPI(accessToken: string): Promise<GmailAPITestResult> {
    const tester = new GmailAPITester(accessToken);
    return await tester.testConnection();
  }

  async testStripeAPI(accessToken: string): Promise<StripeAPITestResult> {
    const tester = new StripeAPITester(accessToken);
    return await tester.testConnection();
  }

  async testAllProviders(tokens: {
    amazon?: { accessToken: string; region?: string };
    gmail?: { accessToken: string };
    stripe?: { accessToken: string };
  }): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const promises: Promise<TestResult>[] = [];

    if (tokens.amazon) {
      promises.push(this.testAmazonSPAPI(tokens.amazon.accessToken, tokens.amazon.region));
    }

    if (tokens.gmail) {
      promises.push(this.testGmailAPI(tokens.gmail.accessToken));
    }

    if (tokens.stripe) {
      promises.push(this.testStripeAPI(tokens.stripe.accessToken));
    }

    try {
      const testResults = await Promise.allSettled(promises);
      
      testResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          // Create error result for failed tests
          const provider = Object.keys(tokens)[index];
          const errorResult: TestResult = {
            provider: provider as any,
            status: 'failed',
            message: `Test failed: ${result.reason.message}`,
            timestamp: new Date().toISOString(),
            responseTime: 0,
            details: { error: result.reason.message }
          };
          results.push(errorResult);
        }
      });

      return results;
    } catch (error) {
      logger.error('Failed to run OAuth tests', { error: error.message });
      throw new AppError(
        'Failed to run OAuth tests',
        ErrorType.EXTERNAL_SERVICE_ERROR,
        500,
        ErrorSeverity.HIGH,
        true,
        { error: error.message }
      );
    }
  }
}

export default OAuthTestService;


import { getLogger } from '../../../shared/utils/logger';
import { 
  AppError, 
  ExternalServiceError, 
  AuthenticationError,
  ErrorType,
  ErrorSeverity 
} from '../../../shared/utils/errorHandler';
import config from '../config/env';

const logger = getLogger('OAuthTestService');

// ========================================
// INTERFACES
// ========================================

export interface OAuthTestResult {
  provider: string;
  status: 'success' | 'failed' | 'pending';
  message: string;
  details?: any;
  timestamp: string;
  responseTime: number;
}

export interface AmazonSPAPITestResult extends OAuthTestResult {
  provider: 'amazon';
  marketplaceId?: string;
  sellerId?: string;
  permissions?: string[];
  apiEndpoints?: string[];
}

export interface GmailAPITestResult extends OAuthTestResult {
  provider: 'gmail';
  emailAddress?: string;
  permissions?: string[];
  quota?: any;
}

export interface StripeAPITestResult extends OAuthTestResult {
  provider: 'stripe';
  accountId?: string;
  accountType?: string;
  permissions?: string[];
  capabilities?: any;
}

export type TestResult = AmazonSPAPITestResult | GmailAPITestResult | StripeAPITestResult;

// ========================================
// AMAZON SP-API TESTING
// ========================================

export class AmazonSPAPITester {
  private accessToken: string;
  private region: string;

  constructor(accessToken: string, region: string = 'us-east-1') {
    this.accessToken = accessToken;
    this.region = region;
  }

  async testConnection(): Promise<AmazonSPAPITestResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Testing Amazon SP-API connection', { region: this.region });

      // Test 1: Get catalog item (basic API access)
      const catalogResult = await this.testCatalogAPI();
      
      // Test 2: Get inventory (inventory permissions)
      const inventoryResult = await this.testInventoryAPI();
      
      // Test 3: Get reports (reports permissions)
      const reportsResult = await this.testReportsAPI();
      
      // Test 4: Get orders (orders permissions)
      const ordersResult = await this.testOrdersAPI();

      const responseTime = Date.now() - startTime;
      
      const result: AmazonSPAPITestResult = {
        provider: 'amazon',
        status: 'success',
        message: 'Amazon SP-API connection successful',
        timestamp: new Date().toISOString(),
        responseTime,
        marketplaceId: catalogResult.marketplaceId,
        sellerId: catalogResult.sellerId,
        permissions: this.determinePermissions({
          catalog: catalogResult.success,
          inventory: inventoryResult.success,
          reports: reportsResult.success,
          orders: ordersResult.success
        }),
        apiEndpoints: this.getTestedEndpoints({
          catalog: catalogResult.success,
          inventory: inventoryResult.success,
          reports: reportsResult.success,
          orders: ordersResult.success
        }),
        details: {
          catalog: catalogResult,
          inventory: inventoryResult,
          reports: reportsResult,
          orders: ordersResult
        }
      };

      logger.info('Amazon SP-API test completed successfully', result);
      return result;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Amazon SP-API test failed', { error: error.message, responseTime });

      return {
        provider: 'amazon',
        status: 'failed',
        message: `Amazon SP-API test failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        responseTime,
        details: { error: error.message, stack: error.stack }
      };
    }
  }

  private async testCatalogAPI(): Promise<any> {
    try {
      const response = await axios.get(
        `${config.AMAZON_API_ENDPOINT}/catalog/v0/items/ASIN123`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'x-amz-access-token': this.accessToken
          },
          params: {
            marketplaceIds: config.AMAZON_MARKETPLACE_ID
          }
        }
      );

      return {
        success: true,
        marketplaceId: config.AMAZON_MARKETPLACE_ID,
        sellerId: response.data?.sellerId,
        statusCode: response.status
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testInventoryAPI(): Promise<any> {
    try {
      const response = await axios.get(
        `${config.AMAZON_API_ENDPOINT}/fba/inventory/v1/summaries`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'x-amz-access-token': this.accessToken
          },
          params: {
            marketplaceIds: config.AMAZON_MARKETPLACE_ID,
            granularityType: 'Marketplace'
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        inventoryCount: response.data?.inventorySummaries?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testReportsAPI(): Promise<any> {
    try {
      const response = await axios.get(
        `${config.AMAZON_API_ENDPOINT}/reports/2021-06-30/reports`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'x-amz-access-token': this.accessToken
          },
          params: {
            marketplaceIds: config.AMAZON_MARKETPLACE_ID,
            maxCount: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        reportsCount: response.data?.reports?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testOrdersAPI(): Promise<any> {
    try {
      const response = await axios.get(
        `${config.AMAZON_API_ENDPOINT}/orders/v0/orders`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'x-amz-access-token': this.accessToken
          },
          params: {
            MarketplaceIds: config.AMAZON_MARKETPLACE_ID,
            MaxResultsPerPage: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        ordersCount: response.data?.Orders?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private determinePermissions(testResults: any): string[] {
    const permissions: string[] = ['basic_access'];
    
    if (testResults.catalog) permissions.push('catalog_read');
    if (testResults.inventory) permissions.push('inventory_read');
    if (testResults.reports) permissions.push('reports_read');
    if (testResults.orders) permissions.push('orders_read');
    
    return permissions;
  }

  private getTestedEndpoints(testResults: any): string[] {
    const endpoints: string[] = [];
    
    if (testResults.catalog) endpoints.push('/catalog/v0/items');
    if (testResults.inventory) endpoints.push('/fba/inventory/v1/summaries');
    if (testResults.reports) endpoints.push('/reports/2021-06-30/reports');
    if (testResults.orders) endpoints.push('/orders/v0/orders');
    
    return endpoints;
  }
}

// ========================================
// GMAIL API TESTING
// ========================================

export class GmailAPITester {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async testConnection(): Promise<GmailAPITestResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Testing Gmail API connection');

      // Test 1: Get user profile
      const profileResult = await this.testProfileAPI();
      
      // Test 2: Get labels
      const labelsResult = await this.testLabelsAPI();
      
      // Test 3: Get emails
      const emailsResult = await this.testEmailsAPI();
      
      // Test 4: Get quota
      const quotaResult = await this.testQuotaAPI();

      const responseTime = Date.now() - startTime;
      
      const result: GmailAPITestResult = {
        provider: 'gmail',
        status: 'success',
        message: 'Gmail API connection successful',
        timestamp: new Date().toISOString(),
        responseTime,
        emailAddress: profileResult.emailAddress,
        permissions: this.determinePermissions({
          profile: profileResult.success,
          labels: labelsResult.success,
          emails: emailsResult.success,
          quota: quotaResult.success
        }),
        quota: quotaResult.quota,
        details: {
          profile: profileResult,
          labels: labelsResult,
          emails: emailsResult,
          quota: quotaResult
        }
      };

      logger.info('Gmail API test completed successfully', result);
      return result;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Gmail API test failed', { error: error.message, responseTime });

      return {
        provider: 'gmail',
        status: 'failed',
        message: `Gmail API test failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        responseTime,
        details: { error: error.message, stack: error.stack }
      };
    }
  }

  private async testProfileAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        emailAddress: response.data?.emailAddress,
        messagesTotal: response.data?.messagesTotal,
        threadsTotal: response.data?.threadsTotal
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testLabelsAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/labels',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        labelsCount: response.data?.labels?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testEmailsAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          },
          params: {
            maxResults: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        emailsCount: response.data?.messages?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testQuotaAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/quota',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        quota: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private determinePermissions(testResults: any): string[] {
    const permissions: string[] = ['basic_access'];
    
    if (testResults.profile) permissions.push('profile_read');
    if (testResults.labels) permissions.push('labels_read');
    if (testResults.emails) permissions.push('emails_read');
    if (testResults.quota) permissions.push('quota_read');
    
    return permissions;
  }
}

// ========================================
// STRIPE API TESTING
// ========================================

export class StripeAPITester {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async testConnection(): Promise<StripeAPITestResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Testing Stripe API connection');

      // Test 1: Get account details
      const accountResult = await this.testAccountAPI();
      
      // Test 2: Get charges
      const chargesResult = await this.testChargesAPI();
      
      // Test 3: Get customers
      const customersResult = await this.testCustomersAPI();
      
      // Test 4: Get subscriptions
      const subscriptionsResult = await this.testSubscriptionsAPI();

      const responseTime = Date.now() - startTime;
      
      const result: StripeAPITestResult = {
        provider: 'stripe',
        status: 'success',
        message: 'Stripe API connection successful',
        timestamp: new Date().toISOString(),
        responseTime,
        accountId: accountResult.accountId,
        accountType: accountResult.accountType,
        permissions: this.determinePermissions({
          account: accountResult.success,
          charges: chargesResult.success,
          customers: customersResult.success,
          subscriptions: subscriptionsResult.success
        }),
        capabilities: accountResult.capabilities,
        details: {
          account: accountResult,
          charges: chargesResult,
          customers: customersResult,
          subscriptions: subscriptionsResult
        }
      };

      logger.info('Stripe API test completed successfully', result);
      return result;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Stripe API test failed', { error: error.message, responseTime });

      return {
        provider: 'stripe',
        status: 'failed',
        message: `Stripe API test failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        responseTime,
        details: { error: error.message, stack: error.stack }
      };
    }
  }

  private async testAccountAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://api.stripe.com/v1/account',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Stripe-Version': '2023-10-16'
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        accountId: response.data?.id,
        accountType: response.data?.type,
        capabilities: response.data?.capabilities,
        country: response.data?.country,
        chargesEnabled: response.data?.charges_enabled
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testChargesAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://api.stripe.com/v1/charges',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Stripe-Version': '2023-10-16'
          },
          params: {
            limit: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        chargesCount: response.data?.data?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testCustomersAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://api.stripe.com/v1/customers',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Stripe-Version': '2023-10-16'
          },
          params: {
            limit: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        customersCount: response.data?.data?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private async testSubscriptionsAPI(): Promise<any> {
    try {
      const response = await axios.get(
        'https://api.stripe.com/v1/subscriptions',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Stripe-Version': '2023-10-16'
          },
          params: {
            limit: 1
          }
        }
      );

      return {
        success: true,
        statusCode: response.status,
        subscriptionsCount: response.data?.data?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        statusCode: error.response?.status
      };
    }
  }

  private determinePermissions(testResults: any): string[] {
    const permissions: string[] = ['basic_access'];
    
    if (testResults.account) permissions.push('account_read');
    if (testResults.charges) permissions.push('charges_read');
    if (testResults.customers) permissions.push('customers_read');
    if (testResults.subscriptions) permissions.push('subscriptions_read');
    
    return permissions;
  }
}

// ========================================
// MAIN TESTING SERVICE
// ========================================

export class OAuthTestService {
  async testAmazonSPAPI(accessToken: string, region?: string): Promise<AmazonSPAPITestResult> {
    const tester = new AmazonSPAPITester(accessToken, region);
    return await tester.testConnection();
  }

  async testGmailAPI(accessToken: string): Promise<GmailAPITestResult> {
    const tester = new GmailAPITester(accessToken);
    return await tester.testConnection();
  }

  async testStripeAPI(accessToken: string): Promise<StripeAPITestResult> {
    const tester = new StripeAPITester(accessToken);
    return await tester.testConnection();
  }

  async testAllProviders(tokens: {
    amazon?: { accessToken: string; region?: string };
    gmail?: { accessToken: string };
    stripe?: { accessToken: string };
  }): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const promises: Promise<TestResult>[] = [];

    if (tokens.amazon) {
      promises.push(this.testAmazonSPAPI(tokens.amazon.accessToken, tokens.amazon.region));
    }

    if (tokens.gmail) {
      promises.push(this.testGmailAPI(tokens.gmail.accessToken));
    }

    if (tokens.stripe) {
      promises.push(this.testStripeAPI(tokens.stripe.accessToken));
    }

    try {
      const testResults = await Promise.allSettled(promises);
      
      testResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          // Create error result for failed tests
          const provider = Object.keys(tokens)[index];
          const errorResult: TestResult = {
            provider: provider as any,
            status: 'failed',
            message: `Test failed: ${result.reason.message}`,
            timestamp: new Date().toISOString(),
            responseTime: 0,
            details: { error: result.reason.message }
          };
          results.push(errorResult);
        }
      });

      return results;
    } catch (error) {
      logger.error('Failed to run OAuth tests', { error: error.message });
      throw new AppError(
        'Failed to run OAuth tests',
        ErrorType.EXTERNAL_SERVICE_ERROR,
        500,
        ErrorSeverity.HIGH,
        true,
        { error: error.message }
      );
    }
  }
}

export default OAuthTestService;


