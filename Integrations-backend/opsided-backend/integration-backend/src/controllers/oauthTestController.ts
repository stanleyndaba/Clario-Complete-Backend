import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { getLogger } from '../../../shared/utils/logger';
import { 
  AppError, 
  ValidationError, 
  AuthenticationError,
  ErrorType,
  ErrorSeverity 
} from '../../../shared/utils/errorHandler';
import { asyncHandler } from '../../../shared/utils/errorHandler';
import OAuthTestService from '../services/oauthTestService';
import config from '../config/env';

const logger = getLogger('OAuthTestController');
const oauthTestService = new OAuthTestService();

// ========================================
// VALIDATION SCHEMAS
// ========================================

export const validateAmazonTest = [
  body('accessToken')
    .notEmpty()
    .withMessage('Access token is required')
    .isString()
    .withMessage('Access token must be a string'),
  body('region')
    .optional()
    .isString()
    .withMessage('Region must be a string')
    .isIn(['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'])
    .withMessage('Invalid region specified')
];

export const validateGmailTest = [
  body('accessToken')
    .notEmpty()
    .withMessage('Access token is required')
    .isString()
    .withMessage('Access token must be a string')
];

export const validateStripeTest = [
  body('accessToken')
    .notEmpty()
    .withMessage('Access token is required')
    .isString()
    .withMessage('Access token must be a string')
];

export const validateBulkTest = [
  body('amazon.accessToken')
    .optional()
    .isString()
    .withMessage('Amazon access token must be a string'),
  body('amazon.region')
    .optional()
    .isString()
    .isIn(['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'])
    .withMessage('Invalid Amazon region specified'),
  body('gmail.accessToken')
    .optional()
    .isString()
    .withMessage('Gmail access token must be a string'),
  body('stripe.accessToken')
    .optional()
    .isString()
    .withMessage('Stripe access token must be a string'),
  body()
    .custom((value) => {
      const hasAtLeastOneProvider = value.amazon || value.gmail || value.stripe;
      if (!hasAtLeastOneProvider) {
        throw new Error('At least one provider must be specified');
      }
      return true;
    })
];

// ========================================
// CONTROLLER METHODS
// ========================================

export const testAmazonOAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', { details: errors.array() });
    }

    const { accessToken, region = 'us-east-1' } = req.body;
    const userId = req.user?.id;

    logger.info('Testing Amazon OAuth connection', { userId, region });

    // Test Amazon SP-API connection
    const result = await oauthTestService.testAmazonSPAPI(accessToken, region);

    // Log test result
    if (result.status === 'success') {
      logger.info('Amazon OAuth test successful', { userId, result });
    } else {
      logger.warn('Amazon OAuth test failed', { userId, result });
    }

    // Return response
    res.status(200).json({
      success: true,
      message: 'Amazon OAuth test completed',
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Amazon OAuth test error', { 
      userId: req.user?.id, 
      error: error.message,
      stack: error.stack 
    });
    next(error);
  }
});

export const testGmailOAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', { details: errors.array() });
    }

    const { accessToken } = req.body;
    const userId = req.user?.id;

    logger.info('Testing Gmail OAuth connection', { userId });

    // Test Gmail API connection
    const result = await oauthTestService.testGmailAPI(accessToken);

    // Log test result
    if (result.status === 'success') {
      logger.info('Gmail OAuth test successful', { userId, result });
    } else {
      logger.warn('Gmail OAuth test failed', { userId, result });
    }

    // Return response
    res.status(200).json({
      success: true,
      message: 'Gmail OAuth test completed',
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Gmail OAuth test error', { 
      userId: req.user?.id, 
      error: error.message,
      stack: error.stack 
    });
    next(error);
  }
});

export const testStripeOAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', { details: errors.array() });
    }

    const { accessToken } = req.body;
    const userId = req.user?.id;

    logger.info('Testing Stripe OAuth connection', { userId });

    // Test Stripe API connection
    const result = await oauthTestService.testStripeAPI(accessToken);

    // Log test result
    if (result.status === 'success') {
      logger.info('Stripe OAuth test successful', { userId, result });
    } else {
      logger.warn('Stripe OAuth test failed', { userId, result });
    }

    // Return response
    res.status(200).json({
      success: true,
      message: 'Stripe OAuth test completed',
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Stripe OAuth test error', { 
      userId: req.user?.id, 
      error: error.message,
      stack: error.stack 
    });
    next(error);
  }
});

export const testBulkOAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', { details: errors.array() });
    }

    const { amazon, gmail, stripe } = req.body;
    const userId = req.user?.id;

    logger.info('Testing bulk OAuth connections', { userId, providers: { amazon: !!amazon, gmail: !!gmail, stripe: !!stripe } });

    // Prepare tokens object
    const tokens: any = {};
    if (amazon?.accessToken) tokens.amazon = { accessToken: amazon.accessToken, region: amazon.region };
    if (gmail?.accessToken) tokens.gmail = { accessToken: gmail.accessToken };
    if (stripe?.accessToken) tokens.stripe = { accessToken: stripe.accessToken };

    // Test all specified providers
    const results = await oauthTestService.testAllProviders(tokens);

    // Log test results
    const successCount = results.filter(r => r.status === 'success').length;
    const totalCount = results.length;
    
    logger.info('Bulk OAuth test completed', { 
      userId, 
      successCount, 
      totalCount, 
      results: results.map(r => ({ provider: r.provider, status: r.status }))
    });

    // Return response
    res.status(200).json({
      success: true,
      message: `Bulk OAuth test completed: ${successCount}/${totalCount} successful`,
      data: results,
      summary: {
        total: totalCount,
        successful: successCount,
        failed: totalCount - successCount
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Bulk OAuth test error', { 
      userId: req.user?.id, 
      error: error.message,
      stack: error.stack 
    });
    next(error);
  }
});

export const getOAuthTestStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const { provider } = req.params;

    logger.info('Getting OAuth test status', { userId, provider });

    // Validate provider
    const validProviders = ['amazon', 'gmail', 'stripe'];
    if (provider && !validProviders.includes(provider)) {
      throw new ValidationError('Invalid provider specified', { provider });
    }

    // Get test status from database (this would be implemented based on your data model)
    const testStatus = {
      lastTested: new Date().toISOString(),
      status: 'available',
      providers: validProviders.map(p => ({
        name: p,
        lastTested: new Date().toISOString(),
        status: 'available'
      }))
    };

    // Return response
    res.status(200).json({
      success: true,
      message: 'OAuth test status retrieved',
      data: testStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Get OAuth test status error', { 
      userId: req.user?.id, 
      error: error.message,
      stack: error.stack 
    });
    next(error);
  }
});

export const getOAuthTestHistory = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const { provider, limit = 10, offset = 0 } = req.query;

    logger.info('Getting OAuth test history', { userId, provider, limit, offset });

    // Validate query parameters
    const validProviders = ['amazon', 'gmail', 'stripe'];
    if (provider && !validProviders.includes(provider as string)) {
      throw new ValidationError('Invalid provider specified', { provider });
    }

    // Mock test history (this would be implemented based on your data model)
    const testHistory = Array.from({ length: Math.min(Number(limit), 10) }, (_, i) => ({
      id: `test_${i + 1}`,
      provider: provider || validProviders[i % validProviders.length],
      status: i % 3 === 0 ? 'failed' : 'success',
      timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
      responseTime: Math.floor(Math.random() * 5000) + 1000,
      details: {
        message: i % 3 === 0 ? 'Test failed due to invalid token' : 'Test completed successfully',
        permissions: ['basic_access', 'read_access'],
        endpoints: ['/api/v1/test']
      }
    }));

    // Return response
    res.status(200).json({
      success: true,
      message: 'OAuth test history retrieved',
      data: testHistory,
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        total: testHistory.length,
        hasMore: false
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Get OAuth test history error', { 
      userId: req.user?.id, 
      error: error.message,
      stack: error.stack 
    });
    next(error);
  }
});

export const retryFailedOAuthTest = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const { testId } = req.params;

    logger.info('Retrying failed OAuth test', { userId, testId });

    // Validate test ID
    if (!testId) {
      throw new ValidationError('Test ID is required', { testId });
    }

    // Mock retry logic (this would be implemented based on your data model)
    const retryResult = {
      testId,
      status: 'retrying',
      message: 'Test retry initiated',
      timestamp: new Date().toISOString()
    };

    // Return response
    res.status(200).json({
      success: true,
      message: 'OAuth test retry initiated',
      data: retryResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Retry failed OAuth test error', { 
      userId: req.user?.id, 
      error: error.message,
      stack: error.stack 
    });
    next(error);
  }
});

// ========================================
// HEALTH CHECK ENDPOINT
// ========================================

export const getOAuthTestHealth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const healthStatus = {
      service: 'OAuth Test Service',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      providers: {
        amazon: { status: 'available', endpoints: ['/api/v1/oauth/test/amazon'] },
        gmail: { status: 'available', endpoints: ['/api/v1/oauth/test/gmail'] },
        stripe: { status: 'available', endpoints: ['/api/v1/oauth/test/stripe'] }
      },
      features: [
        'Individual provider testing',
        'Bulk provider testing',
        'Test history tracking',
        'Performance monitoring',
        'Error handling and logging'
      ]
    };

    res.status(200).json({
      success: true,
      message: 'OAuth test service health check',
      data: healthStatus
    });

  } catch (error) {
    logger.error('OAuth test health check error', { error: error.message });
    next(error);
  }
});

