import { config } from 'dotenv';
import path from 'path';
import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('TestSetup');

// ========================================
// ENVIRONMENT CONFIGURATION
// ========================================

// Load test environment variables
config({ path: path.join(__dirname, '../../.env.test') });

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'opsided_test_db';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// ========================================
// TEST CONFIGURATION
// ========================================

export const testConfig = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'opsided_test_db',
    user: process.env.DB_USER || 'opsided_test_user',
    password: process.env.DB_PASSWORD || 'opsided_test_password'
  },
  server: {
    port: parseInt(process.env.TEST_PORT || '3001', 10),
    host: process.env.TEST_HOST || 'localhost'
  },
  timeouts: {
    test: 30000, // 30 seconds
    integration: 60000, // 1 minute
    e2e: 120000 // 2 minutes
  },
  retries: {
    max: 3,
    delay: 1000 // 1 second
  }
};

// ========================================
// MOCK CONFIGURATION
// ========================================

// Mock external services for testing
export const mockExternalServices = {
  amazon: {
    baseUrl: 'https://sellingpartnerapi-na.amazon.com',
    mockResponses: {
      catalog: { success: true, data: { items: [] } },
      inventory: { success: true, data: { summaries: [] } },
      reports: { success: true, data: { reports: [] } },
      orders: { success: true, data: { orders: [] } }
    }
  },
  gmail: {
    baseUrl: 'https://gmail.googleapis.com',
    mockResponses: {
      profile: { success: true, data: { emailAddress: 'test@gmail.com' } },
      labels: { success: true, data: { labels: [] } },
      emails: { success: true, data: { messages: [] } },
      quota: { success: true, data: { quotaBytesTotal: '15000000000' } }
    }
  },
  stripe: {
    baseUrl: 'https://api.stripe.com',
    mockResponses: {
      account: { success: true, data: { id: 'acct_test123', type: 'express' } },
      charges: { success: true, data: { data: [] } },
      customers: { success: true, data: { data: [] } },
      subscriptions: { success: true, data: { data: [] } }
    }
  }
};

// ========================================
// TEST UTILITIES
// ========================================

export const createTestUser = () => ({
  id: 'test-user-id',
  email: 'test@example.com',
  role: 'user',
  isActive: true
});

export const createTestToken = (provider: string) => ({
  id: `test-token-${provider}`,
  userId: 'test-user-id',
  provider,
  accessToken: `test_${provider}_access_token`,
  refreshToken: `test_${provider}_refresh_token`,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  isActive: true
});

export const createTestIntegration = (provider: string) => ({
  id: `test-integration-${provider}`,
  userId: 'test-user-id',
  provider,
  accountId: `test_${provider}_account`,
  accountName: `Test ${provider} Account`,
  accountStatus: 'active',
  isPrimary: true
});

// ========================================
// DATABASE HELPERS
// ========================================

export const clearTestDatabase = async (db: any) => {
  try {
    // Clear all test data
    await db('webhook_events').del();
    await db('api_logs').del();
    await db('notifications').del();
    await db('claims').del();
    await db('discrepancies').del();
    await db('inventory_sync_logs').del();
    await db('inventory_items').del();
    await db('stripe_integrations').del();
    await db('gmail_integrations').del();
    await db('amazon_integrations').del();
    await db('integration_accounts').del();
    await db('oauth_tokens').del();
    await db('users').del();
    
    logger.info('Test database cleared successfully');
  } catch (error) {
    logger.error('Failed to clear test database', { error: error.message });
    throw error;
  }
};

export const seedTestDatabase = async (db: any) => {
  try {
    // Insert test users
    await db('users').insert([
      createTestUser(),
      {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
        isActive: true
      }
    ]);

    // Insert test OAuth tokens
    await db('oauth_tokens').insert([
      createTestToken('amazon'),
      createTestToken('gmail'),
      createTestToken('stripe')
    ]);

    // Insert test integrations
    await db('integration_accounts').insert([
      createTestIntegration('amazon'),
      createTestIntegration('gmail'),
      createTestIntegration('stripe')
    ]);

    logger.info('Test database seeded successfully');
  } catch (error) {
    logger.error('Failed to seed test database', { error: error.message });
    throw error;
  }
};

// ========================================
// HTTP HELPERS
// ========================================

export const createTestRequest = (overrides: any = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test-jwt-token'
  },
  user: createTestUser(),
  ...overrides
});

export const createTestResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

export const createTestNext = () => jest.fn();

// ========================================
// VALIDATION HELPERS
// ========================================

export const validateResponseStructure = (response: any) => {
  expect(response).toHaveProperty('success');
  expect(response).toHaveProperty('message');
  expect(response).toHaveProperty('data');
  expect(response).toHaveProperty('timestamp');
  
  expect(typeof response.success).toBe('boolean');
  expect(typeof response.message).toBe('string');
  expect(typeof response.timestamp).toBe('string');
};

export const validateErrorResponse = (response: any, expectedStatus: number, expectedType: string) => {
  expect(response.success).toBe(false);
  expect(response.error).toBeDefined();
  expect(response.error.statusCode).toBe(expectedStatus);
  expect(response.error.type).toBe(expectedType);
  expect(response.error.message).toBeDefined();
  expect(response.error.timestamp).toBeDefined();
};

// ========================================
// PERFORMANCE HELPERS
// ========================================

export const measurePerformance = async <T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> => {
  const startTime = Date.now();
  const result = await fn();
  const duration = Date.now() - startTime;
  
  return { result, duration };
};

export const assertPerformance = (duration: number, maxDuration: number, operation: string) => {
  expect(duration).toBeLessThan(maxDuration);
  logger.info(`${operation} completed in ${duration}ms`);
};

// ========================================
// CLEANUP HELPERS
// ========================================

export const cleanupTestFiles = () => {
  // Clean up any test files created during testing
  const fs = require('fs');
  const path = require('path');
  
  const testDirs = ['logs', 'uploads', 'temp'];
  
  testDirs.forEach(dir => {
    const testDir = path.join(process.cwd(), dir);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
};

// ========================================
// GLOBAL TEST SETUP
// ========================================

beforeAll(async () => {
  logger.info('Setting up test environment');
  
  // Set longer timeout for integration tests
  jest.setTimeout(testConfig.timeouts.integration);
  
  // Clean up any existing test files
  cleanupTestFiles();
});

afterAll(async () => {
  logger.info('Cleaning up test environment');
  
  // Clean up test files
  cleanupTestFiles();
});

// ========================================
// TEST ENVIRONMENT EXPORTS
// ========================================

export default {
  testConfig,
  mockExternalServices,
  createTestUser,
  createTestToken,
  createTestIntegration,
  clearTestDatabase,
  seedTestDatabase,
  createTestRequest,
  createTestResponse,
  createTestNext,
  validateResponseStructure,
  validateErrorResponse,
  measurePerformance,
  assertPerformance,
  cleanupTestFiles
};

