import request from 'supertest';
import app from '../index';
import { supabase } from '../database/supabaseClient';
import { amazonService } from '../services/amazonService';
import { stripeService } from '../services/stripeService';
import { stripeOnboardingService } from '../services/stripeOnboardingService';
import { tokenManager } from '../utils/tokenManager';
import { notificationService } from '../services/notificationService';
import logger from '../utils/logger';

// Mock external dependencies
jest.mock('../database/supabaseClient');
jest.mock('../services/amazonService');
jest.mock('../services/stripeService');
jest.mock('../services/stripeOnboardingService');
jest.mock('../utils/tokenManager');
jest.mock('../services/notificationService');
jest.mock('../utils/logger');

const mockSupabase = supabase as jest.Mocked<typeof supabase>;
const mockAmazonService = amazonService as jest.Mocked<typeof amazonService>;
const mockStripeService = stripeService as jest.Mocked<typeof stripeService>;
const mockStripeOnboardingService = stripeOnboardingService as jest.Mocked<typeof stripeOnboardingService>;
const mockTokenManager = tokenManager as jest.Mocked<typeof tokenManager>;
const mockNotificationService = notificationService as jest.Mocked<typeof notificationService>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Discovery Stage Edge Cases', () => {
  const mockUserId = 'test-user-123';
  const mockToken = 'valid-jwt-token';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      upsert: jest.fn().mockResolvedValue({ data: null, error: null })
    } as any);
  });

  describe('Amazon OAuth Edge Cases', () => {
    it('handles OAuth callback missing params', async () => {
      const res = await request(app).get('/api/v1/amazon/callback');
      expect([400, 302]).toContain(res.status);
    });

    it('handles OAuth callback with invalid state', async () => {
      const res = await request(app)
        .get('/api/v1/amazon/callback?code=invalid&state=invalid');
      expect([400, 302]).toContain(res.status);
    });

    it('handles revoked Amazon token during API call', async () => {
      // Mock SP-API returning 401 Unauthorized
      mockAmazonService.fetchInventoryItems.mockRejectedValue({
        status: 401,
        message: 'Unauthorized'
      });

      // Mock token manager indicating token is valid initially
      mockTokenManager.isTokenValid.mockReturnValue(true);
      mockTokenManager.isTokenExpired.mockReturnValue(false);

      try {
        await mockAmazonService.fetchInventoryItems(mockUserId);
      } catch (error) {
        // Verify integration status was updated to 'revoked'
        expect(mockSupabase.from).toHaveBeenCalledWith('integration_status');
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Amazon API call failed with 401'),
          expect.objectContaining({
            userId: mockUserId,
            error: 'Unauthorized'
          })
        );
      }
    });

    it('handles expired Amazon token during refresh', async () => {
      // Mock token refresh failing
      mockTokenManager.refreshToken.mockRejectedValue(new Error('Token expired'));
      mockTokenManager.isTokenExpired.mockReturnValue(true);

      try {
        await mockAmazonService.getValidAccessToken(mockUserId);
      } catch (error) {
        // Verify integration status was updated to 'expired'
        expect(mockSupabase.from).toHaveBeenCalledWith('integration_status');
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to refresh Amazon token'),
          expect.objectContaining({
            userId: mockUserId
          })
        );
      }
    });

    it('creates notification when Amazon token becomes invalid', async () => {
      mockTokenManager.isTokenValid.mockReturnValue(false);

      await mockAmazonService.checkTokenValidity(mockUserId);

      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        mockUserId,
        'amazon_connection_lost',
        expect.objectContaining({
          title: 'Amazon Connection Lost',
          message: expect.stringContaining('reconnect')
        })
      );
    });
  });

  describe('Stripe Customer Creation Edge Cases', () => {
    it('handles Stripe customer creation failure with idempotency', async () => {
      // Mock Stripe API throwing an error
      mockStripeService.createCustomer.mockRejectedValue(new Error('Stripe API error'));

      try {
        await mockStripeOnboardingService.createSilentConnectAccount(mockUserId);
      } catch (error) {
        // Verify idempotency key was used
        expect(mockStripeService.createCustomer).toHaveBeenCalledWith(
          expect.objectContaining({
            idempotency_key: `acct_create_${mockUserId}`
          })
        );
        
        // Verify error was logged
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to create Stripe Connect account'),
          expect.objectContaining({
            userId: mockUserId,
            attempt: 1
          })
        );
      }
    });

    it('retries Stripe customer creation with exponential backoff', async () => {
      // Mock first attempt failing, second succeeding
      mockStripeService.createCustomer
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({ id: 'acct_123' });

      const result = await mockStripeOnboardingService.createSilentConnectAccount(mockUserId);

      expect(mockStripeService.createCustomer).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: 'acct_123' });
    });

    it('logs admin notification for repeated Stripe failures', async () => {
      // Mock repeated failures
      mockStripeService.createCustomer.mockRejectedValue(new Error('Persistent error'));

      try {
        await mockStripeOnboardingService.createSilentConnectAccount(mockUserId);
      } catch (error) {
        // Verify admin notification was created
        expect(mockNotificationService.createAdminNotification).toHaveBeenCalledWith(
          'stripe_onboarding_failure',
          expect.objectContaining({
            userId: mockUserId,
            error: 'Persistent error'
          })
        );
      }
    });
  });

  describe('Integration Status Endpoints', () => {
    it('GET /api/v1/integrations/status/:provider requires authentication', async () => {
      const res = await request(app).get('/api/v1/integrations/status/amazon');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/integrations/status/:provider returns integration status', async () => {
      const mockStatus = {
        id: 'status-123',
        user_id: mockUserId,
        provider: 'amazon',
        status: 'active',
        updated_at: new Date().toISOString(),
        metadata: { last_synced_at: new Date().toISOString() }
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockStatus, error: null })
      } as any);

      const res = await request(app)
        .get('/api/v1/integrations/status/amazon')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.provider).toBe('amazon');
      expect(res.body.data.status).toBe('active');
    });

    it('PATCH /api/v1/integrations/reconnect/:provider generates reconnect URL', async () => {
      const res = await request(app)
        .patch('/api/v1/integrations/reconnect/amazon')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reconnectUrl).toContain('/integrations/amazon/connect');
    });

    it('rejects unsupported provider for reconnection', async () => {
      const res = await request(app)
        .patch('/api/v1/integrations/reconnect/unsupported')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('not supported');
    });
  });

  describe('SSE Authentication Protection', () => {
    it('SSE endpoint requires JWT authentication', async () => {
      const res = await request(app)
        .get('/api/v1/sync/progress/test-job-id')
        .set('Accept', 'text/event-stream');

      expect(res.status).toBe(401);
    });

    it('SSE endpoint accepts valid JWT', async () => {
      const res = await request(app)
        .get('/api/v1/sync/progress/test-job-id')
        .set('Authorization', `Bearer ${mockToken}`)
        .set('Accept', 'text/event-stream');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    });
  });

  describe('Session Handling', () => {
    it('redirects to login on expired JWT', async () => {
      const res = await request(app)
        .get('/api/v1/integrations/status/amazon')
        .set('Authorization', 'Bearer expired-token');

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Invalid or expired token');
    });

    it('handles missing authorization header', async () => {
      const res = await request(app)
        .get('/api/v1/integrations/status/amazon');

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Access token required');
    });
  });

  describe('Error Logging and Monitoring', () => {
    it('logs all OAuth callback errors with structured metadata', async () => {
      const error = new Error('OAuth callback failed');
      
      try {
        await mockAmazonService.handleOAuthCallback('invalid-code', 'invalid-state');
      } catch (err) {
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('OAuth callback failed'),
          expect.objectContaining({
            userId: expect.any(String),
            endpoint: '/api/v1/amazon/callback',
            errorType: 'oauth_callback_failure'
          })
        );
      }
    });

    it('logs Stripe customer creation failures with retry information', async () => {
      mockStripeService.createCustomer.mockRejectedValue(new Error('Stripe API error'));

      try {
        await mockStripeOnboardingService.createSilentConnectAccount(mockUserId);
      } catch (error) {
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to create Stripe Connect account'),
          expect.objectContaining({
            userId: mockUserId,
            attempt: 1,
            error: 'Stripe API error'
          })
        );
      }
    });
  });
});




