import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
  testAmazonOAuth,
  testGmailOAuth,
  testStripeOAuth,
  testBulkOAuth,
  getOAuthTestStatus,
  getOAuthTestHistory,
  retryFailedOAuthTest,
  getOAuthTestHealth,
  validateAmazonTest,
  validateGmailTest,
  validateStripeTest,
  validateBulkTest
} from '../controllers/oauthTestController';

const router = Router();

// ========================================
// MIDDLEWARE
// ========================================

// Apply authentication to all routes
router.use(authenticateToken);

// ========================================
// INDIVIDUAL PROVIDER TESTING
// ========================================

/**
 * @route POST /api/v1/oauth/test/amazon
 * @desc Test Amazon SP-API OAuth connection
 * @access Private
 * @body { accessToken: string, region?: string }
 */
router.post('/amazon', validateAmazonTest, testAmazonOAuth);

/**
 * @route POST /api/v1/oauth/test/gmail
 * @desc Test Gmail API OAuth connection
 * @access Private
 * @body { accessToken: string }
 */
router.post('/gmail', validateGmailTest, testGmailOAuth);

/**
 * @route POST /api/v1/oauth/test/stripe
 * @desc Test Stripe API OAuth connection
 * @access Private
 * @body { accessToken: string }
 */
router.post('/stripe', validateStripeTest, testStripeOAuth);

// ========================================
// BULK TESTING
// ========================================

/**
 * @route POST /api/v1/oauth/test/bulk
 * @desc Test multiple OAuth providers simultaneously
 * @access Private
 * @body { amazon?: { accessToken: string, region?: string }, gmail?: { accessToken: string }, stripe?: { accessToken: string } }
 */
router.post('/bulk', validateBulkTest, testBulkOAuth);

// ========================================
// STATUS AND MONITORING
// ========================================

/**
 * @route GET /api/v1/oauth/test/status
 * @desc Get overall OAuth test service status
 * @access Private
 */
router.get('/status', getOAuthTestStatus);

/**
 * @route GET /api/v1/oauth/test/status/:provider
 * @desc Get OAuth test status for specific provider
 * @access Private
 * @param {string} provider - Provider name (amazon, gmail, stripe)
 */
router.get('/status/:provider', getOAuthTestStatus);

/**
 * @route GET /api/v1/oauth/test/history
 * @desc Get OAuth test history
 * @access Private
 * @query { provider?: string, limit?: number, offset?: number }
 */
router.get('/history', getOAuthTestHistory);

/**
 * @route GET /api/v1/oauth/test/history/:provider
 * @desc Get OAuth test history for specific provider
 * @access Private
 * @param {string} provider - Provider name (amazon, gmail, stripe)
 * @query { limit?: number, offset?: number }
 */
router.get('/history/:provider', getOAuthTestHistory);

// ========================================
// TEST MANAGEMENT
// ========================================

/**
 * @route POST /api/v1/oauth/test/retry/:testId
 * @desc Retry a failed OAuth test
 * @access Private
 * @param {string} testId - Test ID to retry
 */
router.post('/retry/:testId', retryFailedOAuthTest);

// ========================================
// HEALTH AND DIAGNOSTICS
// ========================================

/**
 * @route GET /api/v1/oauth/test/health
 * @desc Get OAuth test service health information
 * @access Private
 */
router.get('/health', getOAuthTestHealth);

// ========================================
// DOCUMENTATION
// ========================================

/**
 * @route GET /api/v1/oauth/test/docs
 * @desc Get OAuth test API documentation
 * @access Private
 */
router.get('/docs', (req, res) => {
  res.json({
    success: true,
    message: 'OAuth Test API Documentation',
    data: {
      version: '1.0.0',
      description: 'Comprehensive OAuth testing endpoints for Amazon SP-API, Gmail API, and Stripe OAuth',
      endpoints: {
        'POST /amazon': {
          description: 'Test Amazon SP-API OAuth connection',
          body: {
            accessToken: 'string (required)',
            region: 'string (optional, default: us-east-1)'
          },
          response: 'Amazon SP-API test result with permissions and API endpoints'
        },
        'POST /gmail': {
          description: 'Test Gmail API OAuth connection',
          body: {
            accessToken: 'string (required)'
          },
          response: 'Gmail API test result with permissions and quota information'
        },
        'POST /stripe': {
          description: 'Test Stripe API OAuth connection',
          body: {
            accessToken: 'string (required)'
          },
          response: 'Stripe API test result with account details and capabilities'
        },
        'POST /bulk': {
          description: 'Test multiple OAuth providers simultaneously',
          body: {
            amazon: 'object (optional)',
            gmail: 'object (optional)',
            stripe: 'object (optional)'
          },
          response: 'Array of test results for all specified providers'
        },
        'GET /status': {
          description: 'Get overall OAuth test service status',
          response: 'Service status and provider availability information'
        },
        'GET /status/:provider': {
          description: 'Get OAuth test status for specific provider',
          params: {
            provider: 'string (amazon, gmail, or stripe)'
          },
          response: 'Provider-specific status information'
        },
        'GET /history': {
          description: 'Get OAuth test history',
          query: {
            provider: 'string (optional)',
            limit: 'number (optional, default: 10)',
            offset: 'number (optional, default: 0)'
          },
          response: 'Paginated test history with results and metadata'
        },
        'GET /health': {
          description: 'Get OAuth test service health information',
          response: 'Service health status, version, and feature information'
        }
      },
      features: [
        'Individual provider testing with detailed results',
        'Bulk testing for multiple providers',
        'Comprehensive error handling and logging',
        'Performance monitoring and response time tracking',
        'Test history and retry capabilities',
        'Real-time status monitoring',
        'Detailed permission and capability detection'
      ],
      supportedProviders: {
        amazon: {
          name: 'Amazon SP-API',
          description: 'Amazon Selling Partner API integration testing',
          endpoints: ['/catalog', '/inventory', '/reports', '/orders'],
          permissions: ['catalog_read', 'inventory_read', 'reports_read', 'orders_read']
        },
        gmail: {
          name: 'Gmail API',
          description: 'Gmail API integration testing',
          endpoints: ['/profile', '/labels', '/emails', '/quota'],
          permissions: ['profile_read', 'labels_read', 'emails_read', 'quota_read']
        },
        stripe: {
          name: 'Stripe API',
          description: 'Stripe API integration testing',
          endpoints: ['/account', '/charges', '/customers', '/subscriptions'],
          permissions: ['account_read', 'charges_read', 'customers_read', 'subscriptions_read']
        }
      },
      errorHandling: {
        validation: 'Comprehensive input validation with detailed error messages',
        authentication: 'JWT token validation and user authentication',
        rateLimiting: 'Built-in rate limiting to prevent abuse',
        logging: 'Structured logging for monitoring and debugging',
        retry: 'Automatic retry mechanisms for transient failures'
      },
      examples: {
        amazonTest: {
          request: {
            method: 'POST',
            url: '/api/v1/oauth/test/amazon',
            headers: {
              'Authorization': 'Bearer <jwt_token>',
              'Content-Type': 'application/json'
            },
            body: {
              accessToken: 'amzn_oauth_token_here',
              region: 'us-east-1'
            }
          },
          response: {
            success: true,
            message: 'Amazon OAuth test completed',
            data: {
              provider: 'amazon',
              status: 'success',
              message: 'Amazon SP-API connection successful',
              marketplaceId: 'ATVPDKIKX0DER',
              permissions: ['basic_access', 'catalog_read', 'inventory_read'],
              apiEndpoints: ['/catalog/v0/items', '/fba/inventory/v1/summaries'],
              responseTime: 2450
            }
          }
        }
      }
    }
  });
});

export default router;

