import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../src/app';
import { getDatabase } from '../../../shared/db/connection';
import { OAuthTestService } from '../../src/services/oauthTestService';
import { getLogger } from '../../../shared/utils/logger';

const logger = getLogger('OAuthIntegrationTests');

describe('OAuth Integration Tests', () => {
  let app: Express;
  let db: any;
  let oauthTestService: OAuthTestService;

  beforeAll(async () => {
    // Create test app
    app = await createApp();
    
    // Initialize database connection
    db = getDatabase();
    
    // Initialize OAuth test service
    oauthTestService = new OAuthTestService();
    
    // Setup test database
    await setupTestDatabase();
  });

  afterAll(async () => {
    // Cleanup test database
    await cleanupTestDatabase();
    
    // Close database connection
    await db.destroy();
  });

  beforeEach(async () => {
    // Clear test data before each test
    await clearTestData();
  });

  describe('Amazon SP-API OAuth Integration', () => {
    it('should successfully test Amazon SP-API connection with valid token', async () => {
      const testToken = 'test_amazon_token';
      const region = 'us-east-1';

      const result = await oauthTestService.testAmazonSPAPI(testToken, region);

      expect(result.provider).toBe('amazon');
      expect(result.status).toBe('success');
      expect(result.marketplaceId).toBeDefined();
      expect(result.permissions).toContain('basic_access');
      expect(result.apiEndpoints).toHaveLength(1);
      expect(result.responseTime).toBeGreaterThan(0);
    });

    it('should handle Amazon SP-API authentication errors gracefully', async () => {
      const invalidToken = 'invalid_token';
      const region = 'us-east-1';

      const result = await oauthTestService.testAmazonSPAPI(invalidToken, region);

      expect(result.provider).toBe('amazon');
      expect(result.status).toBe('failed');
      expect(result.message).toContain('Amazon SP-API test failed');
      expect(result.details.error).toBeDefined();
    });

    it('should test all Amazon SP-API endpoints and permissions', async () => {
      const testToken = 'test_amazon_token';
      const region = 'us-east-1';

      const result = await oauthTestService.testAmazonSPAPI(testToken, region);

      // Verify all API endpoints are tested
      expect(result.apiEndpoints).toContain('/catalog/v0/items');
      expect(result.apiEndpoints).toContain('/fba/inventory/v1/summaries');
      expect(result.apiEndpoints).toContain('/reports/2021-06-30/reports');
      expect(result.apiEndpoints).toContain('/orders/v0/orders');

      // Verify permissions are correctly determined
      expect(result.permissions).toContain('catalog_read');
      expect(result.permissions).toContain('inventory_read');
      expect(result.permissions).toContain('reports_read');
      expect(result.permissions).toContain('orders_read');
    });
  });

  describe('Gmail API OAuth Integration', () => {
    it('should successfully test Gmail API connection with valid token', async () => {
      const testToken = 'test_gmail_token';

      const result = await oauthTestService.testGmailAPI(testToken);

      expect(result.provider).toBe('gmail');
      expect(result.status).toBe('success');
      expect(result.emailAddress).toBeDefined();
      expect(result.permissions).toContain('basic_access');
      expect(result.quota).toBeDefined();
      expect(result.responseTime).toBeGreaterThan(0);
    });

    it('should handle Gmail API authentication errors gracefully', async () => {
      const invalidToken = 'invalid_token';

      const result = await oauthTestService.testGmailAPI(invalidToken);

      expect(result.provider).toBe('gmail');
      expect(result.status).toBe('failed');
      expect(result.message).toContain('Gmail API test failed');
      expect(result.details.error).toBeDefined();
    });

    it('should test all Gmail API endpoints and permissions', async () => {
      const testToken = 'test_gmail_token';

      const result = await oauthTestService.testGmailAPI(testToken);

      // Verify all API endpoints are tested
      expect(result.details.profile.success).toBe(true);
      expect(result.details.labels.success).toBe(true);
      expect(result.details.emails.success).toBe(true);
      expect(result.details.quota.success).toBe(true);

      // Verify permissions are correctly determined
      expect(result.permissions).toContain('profile_read');
      expect(result.permissions).toContain('labels_read');
      expect(result.permissions).toContain('emails_read');
      expect(result.permissions).toContain('quota_read');
    });
  });

  describe('Stripe API OAuth Integration', () => {
    it('should successfully test Stripe API connection with valid token', async () => {
      const testToken = 'test_stripe_token';

      const result = await oauthTestService.testStripeAPI(testToken);

      expect(result.provider).toBe('stripe');
      expect(result.status).toBe('success');
      expect(result.accountId).toBeDefined();
      expect(result.accountType).toBeDefined();
      expect(result.permissions).toContain('basic_access');
      expect(result.capabilities).toBeDefined();
      expect(result.responseTime).toBeGreaterThan(0);
    });

    it('should handle Stripe API authentication errors gracefully', async () => {
      const invalidToken = 'invalid_token';

      const result = await oauthTestService.testStripeAPI(invalidToken);

      expect(result.provider).toBe('stripe');
      expect(result.status).toBe('failed');
      expect(result.message).toContain('Stripe API test failed');
      expect(result.details.error).toBeDefined();
    });

    it('should test all Stripe API endpoints and permissions', async () => {
      const testToken = 'test_stripe_token';

      const result = await oauthTestService.testStripeAPI(testToken);

      // Verify all API endpoints are tested
      expect(result.details.account.success).toBe(true);
      expect(result.details.charges.success).toBe(true);
      expect(result.details.customers.success).toBe(true);
      expect(result.details.subscriptions.success).toBe(true);

      // Verify permissions are correctly determined
      expect(result.permissions).toContain('account_read');
      expect(result.permissions).toContain('charges_read');
      expect(result.permissions).toContain('customers_read');
      expect(result.permissions).toContain('subscriptions_read');
    });
  });

  describe('Multi-Provider OAuth Testing', () => {
    it('should test all providers simultaneously', async () => {
      const tokens = {
        amazon: { accessToken: 'test_amazon_token', region: 'us-east-1' },
        gmail: { accessToken: 'test_gmail_token' },
        stripe: { accessToken: 'test_stripe_token' }
      };

      const results = await oauthTestService.testAllProviders(tokens);

      expect(results).toHaveLength(3);
      
      const amazonResult = results.find(r => r.provider === 'amazon');
      const gmailResult = results.find(r => r.provider === 'gmail');
      const stripeResult = results.find(r => r.provider === 'stripe');

      expect(amazonResult).toBeDefined();
      expect(gmailResult).toBeDefined();
      expect(stripeResult).toBeDefined();

      expect(amazonResult?.status).toBe('success');
      expect(gmailResult?.status).toBe('success');
      expect(stripeResult?.status).toBe('success');
    });

    it('should handle partial failures gracefully', async () => {
      const tokens = {
        amazon: { accessToken: 'invalid_token', region: 'us-east-1' },
        gmail: { accessToken: 'test_gmail_token' },
        stripe: { accessToken: 'test_stripe_token' }
      };

      const results = await oauthTestService.testAllProviders(tokens);

      expect(results).toHaveLength(3);
      
      const amazonResult = results.find(r => r.provider === 'amazon');
      const gmailResult = results.find(r => r.provider === 'gmail');
      const stripeResult = results.find(r => r.provider === 'stripe');

      expect(amazonResult?.status).toBe('failed');
      expect(gmailResult?.status).toBe('success');
      expect(stripeResult?.status).toBe('success');
    });
  });

  describe('OAuth Test Endpoints', () => {
    it('should provide OAuth test endpoint for Amazon', async () => {
      const response = await request(app)
        .post('/api/v1/oauth/test/amazon')
        .set('Authorization', 'Bearer test_jwt_token')
        .send({
          accessToken: 'test_amazon_token',
          region: 'us-east-1'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.provider).toBe('amazon');
      expect(response.body.data.status).toBe('success');
    });

    it('should provide OAuth test endpoint for Gmail', async () => {
      const response = await request(app)
        .post('/api/v1/oauth/test/gmail')
        .set('Authorization', 'Bearer test_jwt_token')
        .send({
          accessToken: 'test_gmail_token'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.provider).toBe('gmail');
      expect(response.body.data.status).toBe('success');
    });

    it('should provide OAuth test endpoint for Stripe', async () => {
      const response = await request(app)
        .post('/api/v1/oauth/test/stripe')
        .set('Authorization', 'Bearer test_jwt_token')
        .send({
          accessToken: 'test_stripe_token'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.provider).toBe('stripe');
      expect(response.body.data.status).toBe('success');
    });

    it('should provide bulk OAuth test endpoint', async () => {
      const response = await request(app)
        .post('/api/v1/oauth/test/bulk')
        .set('Authorization', 'Bearer test_jwt_token')
        .send({
          amazon: { accessToken: 'test_amazon_token', region: 'us-east-1' },
          gmail: { accessToken: 'test_gmail_token' },
          stripe: { accessToken: 'test_stripe_token' }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data.every((r: any) => r.status === 'success')).toBe(true);
    });
  });

  describe('OAuth Test Error Handling', () => {
    it('should handle missing access tokens', async () => {
      const response = await request(app)
        .post('/api/v1/oauth/test/amazon')
        .set('Authorization', 'Bearer test_jwt_token')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('VALIDATION_ERROR');
    });

    it('should handle invalid provider requests', async () => {
      const response = await request(app)
        .post('/api/v1/oauth/test/invalid_provider')
        .set('Authorization', 'Bearer test_jwt_token')
        .send({
          accessToken: 'test_token'
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('RESOURCE_NOT_FOUND');
    });

    it('should handle authentication failures', async () => {
      const response = await request(app)
        .post('/api/v1/oauth/test/amazon')
        .send({
          accessToken: 'test_amazon_token',
          region: 'us-east-1'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('UNAUTHORIZED');
    });
  });

  describe('OAuth Test Performance', () => {
    it('should complete Amazon SP-API test within reasonable time', async () => {
      const startTime = Date.now();
      
      const result = await oauthTestService.testAmazonSPAPI('test_token', 'us-east-1');
      
      const totalTime = Date.now() - startTime;
      
      expect(result.responseTime).toBeLessThan(10000); // 10 seconds
      expect(totalTime).toBeLessThan(15000); // 15 seconds total
    });

    it('should complete Gmail API test within reasonable time', async () => {
      const startTime = Date.now();
      
      const result = await oauthTestService.testGmailAPI('test_token');
      
      const totalTime = Date.now() - startTime;
      
      expect(result.responseTime).toBeLessThan(8000); // 8 seconds
      expect(totalTime).toBeLessThan(12000); // 12 seconds total
    });

    it('should complete Stripe API test within reasonable time', async () => {
      const startTime = Date.now();
      
      const result = await oauthTestService.testStripeAPI('test_token');
      
      const totalTime = Date.now() - startTime;
      
      expect(result.responseTime).toBeLessThan(6000); // 6 seconds
      expect(totalTime).toBeLessThan(10000); // 10 seconds total
    });
  });
});

// ========================================
// TEST HELPER FUNCTIONS
// ========================================

async function setupTestDatabase(): Promise<void> {
  try {
    // Run migrations
    await db.migrate.latest();
    
    // Run seeds
    await db.seed.run();
    
    logger.info('Test database setup completed');
  } catch (error) {
    logger.error('Failed to setup test database', { error: error.message });
    throw error;
  }
}

async function cleanupTestDatabase(): Promise<void> {
  try {
    // Rollback migrations
    await db.migrate.rollback();
    
    logger.info('Test database cleanup completed');
  } catch (error) {
    logger.error('Failed to cleanup test database', { error: error.message });
    throw error;
  }
}

async function clearTestData(): Promise<void> {
  try {
    // Clear test data from relevant tables
    await db('oauth_tokens').where('access_token', 'like', 'test_%').del();
    await db('integration_accounts').where('account_id', 'like', 'test_%').del();
    
    logger.info('Test data cleared');
  } catch (error) {
    logger.error('Failed to clear test data', { error: error.message });
    throw error;
  }
}

