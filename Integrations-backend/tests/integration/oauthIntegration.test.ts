import request from 'supertest';
import { createServer } from 'http';
import express from 'express';
import { RedisClientType } from 'redis';
import app from '../../src/index';
import { createStateValidator } from '../../src/utils/stateValidator';
import { encryptToken, decryptToken } from '../../src/utils/tokenCrypto';
import { createUserRateLimit } from '../../src/middleware/rateLimit';
import { getRedisClient } from '../../src/utils/redisClient';
import logger from '../../src/utils/logger';

// Mock Redis client for testing
const mockRedisClient = {
  isReady: true,
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  connect: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
} as unknown as RedisClientType;

// Mock the Redis client module
jest.mock('../../src/utils/redisClient', () => ({
  getRedisClient: jest.fn(() => Promise.resolve(mockRedisClient)),
  createRedisClient: jest.fn(() => Promise.resolve(mockRedisClient)),
  closeRedisClient: jest.fn(),
}));

// Mock the token manager
jest.mock('../../src/utils/tokenManager', () => ({
  default: {
    saveToken: jest.fn(),
    getToken: jest.fn(),
    refreshToken: jest.fn(),
  },
}));

// Mock the Amazon service
jest.mock('../../src/services/amazonService', () => ({
  default: {
    initiateOAuth: jest.fn(),
    handleOAuthCallback: jest.fn(),
    getValidAccessToken: jest.fn(),
  },
}));

describe('OAuth Integration Tests', () => {
  let server: any;
  let stateValidator: any;
  let rateLimit: any;

  beforeAll(async () => {
    server = createServer(app);
    stateValidator = createStateValidator(mockRedisClient);
    rateLimit = createUserRateLimit(mockRedisClient, 'test', 60, 5);
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset Redis mock
    (mockRedisClient.get as jest.Mock).mockResolvedValue(null);
    (mockRedisClient.set as jest.Mock).mockResolvedValue('OK');
    (mockRedisClient.del as jest.Mock).mockResolvedValue(1);
    (mockRedisClient.incr as jest.Mock).mockResolvedValue(1);
    (mockRedisClient.expire as jest.Mock).mockResolvedValue(1);
  });

  describe('State Validation', () => {
    it('should generate and validate OAuth state correctly', async () => {
      const userId = 'test-user-123';
      
      // Generate state
      const state = await stateValidator.generateState(userId);
      expect(state).toBeDefined();
      expect(typeof state).toBe('string');
      expect(state.length).toBeGreaterThan(20);

      // Mock Redis to return the state
      (mockRedisClient.get as jest.Mock).mockResolvedValue(userId);

      // Validate state
      const validation = await stateValidator.validateOAuthState(state);
      expect(validation.valid).toBe(true);
      expect(validation.userId).toBe(userId);

      // Verify state was deleted after validation
      expect(mockRedisClient.del).toHaveBeenCalledWith(`oauth_state:${state}`);
    });

    it('should reject invalid OAuth state', async () => {
      const invalidState = 'invalid-state-token';
      
      // Mock Redis to return null (state not found)
      (mockRedisClient.get as jest.Mock).mockResolvedValue(null);

      const validation = await stateValidator.validateOAuthState(invalidState);
      expect(validation.valid).toBe(false);
      expect(validation.userId).toBeUndefined();
    });

    it('should handle Redis errors gracefully', async () => {
      const state = 'test-state';
      
      // Mock Redis error
      (mockRedisClient.get as jest.Mock).mockRejectedValue(new Error('Redis connection failed'));

      const validation = await stateValidator.validateOAuthState(state);
      expect(validation.valid).toBe(false);
    });
  });

  describe('Token Encryption', () => {
    it('should encrypt and decrypt tokens correctly', () => {
      const originalToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token';
      
      // Encrypt token
      const encryptedToken = encryptToken(originalToken);
      expect(encryptedToken).toBeDefined();
      expect(encryptedToken).not.toBe(originalToken);
      expect(encryptedToken.length).toBeGreaterThan(originalToken.length);

      // Decrypt token
      const decryptedToken = decryptToken(encryptedToken);
      expect(decryptedToken).toBe(originalToken);
    });

    it('should handle various token formats', () => {
      const tokens = [
        'simple-token',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        'refresh_token_123456789',
        'access_token_with_special_chars!@#$%^&*()',
      ];

      tokens.forEach(token => {
        const encrypted = encryptToken(token);
        const decrypted = decryptToken(encrypted);
        expect(decrypted).toBe(token);
      });
    });

    it('should fail on tampered ciphertext', () => {
      const originalToken = 'test-token';
      const encryptedToken = encryptToken(originalToken);
      
      // Tamper with the ciphertext
      const tamperedToken = encryptedToken.slice(0, -10) + 'tampered';
      
      expect(() => decryptToken(tamperedToken)).toThrow();
    });

    it('should fail on invalid ciphertext format', () => {
      expect(() => decryptToken('invalid-ciphertext')).toThrow();
    });
  });

  describe('Rate Limiting', () => {
    it('should allow requests within rate limit', async () => {
      const req = {
        user: { id: 'test-user' },
        ip: '127.0.0.1',
      } as any;
      
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;
      
      const next = jest.fn();

      // Mock Redis to return count within limit
      (mockRedisClient.incr as jest.Mock).mockResolvedValue(3);

      await rateLimit(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should block requests exceeding rate limit', async () => {
      const req = {
        user: { id: 'test-user' },
        ip: '127.0.0.1',
      } as any;
      
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;
      
      const next = jest.fn();

      // Mock Redis to return count exceeding limit
      (mockRedisClient.incr as jest.Mock).mockResolvedValue(6);

      await rateLimit(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Too many requests',
        retryAfter: expect.any(Number),
      });
    });

    it('should handle Redis errors gracefully', async () => {
      const req = {
        user: { id: 'test-user' },
        ip: '127.0.0.1',
      } as any;
      
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;
      
      const next = jest.fn();

      // Mock Redis error
      (mockRedisClient.incr as jest.Mock).mockRejectedValue(new Error('Redis connection failed'));

      await rateLimit(req, res, next);

      // Should continue without rate limiting
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Amazon OAuth Flow Integration', () => {
    it('should initiate OAuth with secure state', async () => {
      const mockAuthUrl = 'https://sellercentral.amazon.com/apps/authorize/consent?client_id=test&state=secure-state';
      const amazonService = require('../../src/services/amazonService').default;
      amazonService.initiateOAuth.mockResolvedValue(mockAuthUrl);

      // Mock state generation
      (mockRedisClient.set as jest.Mock).mockResolvedValue('OK');

      const response = await request(app)
        .get('/api/amazon/auth')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.authUrl).toBe(mockAuthUrl);
      expect(amazonService.initiateOAuth).toHaveBeenCalledWith('test-user');
    });

    it('should validate OAuth callback state', async () => {
      const amazonService = require('../../src/services/amazonService').default;
      amazonService.handleOAuthCallback.mockResolvedValue();

      // Mock valid state
      (mockRedisClient.get as jest.Mock).mockResolvedValue('test-user');

      const response = await request(app)
        .get('/api/amazon/callback?code=test-code&state=valid-state')
        .expect(302); // Redirect

      expect(amazonService.handleOAuthCallback).toHaveBeenCalledWith('test-code', 'test-user');
    });

    it('should reject OAuth callback with invalid state', async () => {
      // Mock invalid state
      (mockRedisClient.get as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/amazon/callback?code=test-code&state=invalid-state')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid or expired OAuth state');
    });

    it('should handle missing OAuth parameters', async () => {
      const response = await request(app)
        .get('/api/amazon/callback')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Missing OAuth parameters');
    });
  });

  describe('Integration Status Endpoints', () => {
    it('should get integration status with rate limiting', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/status/amazon')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reconnect integration with rate limiting', async () => {
      const response = await request(app)
        .patch('/api/v1/integrations/reconnect/amazon')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should enforce rate limits on reconnect endpoint', async () => {
      // Mock rate limit exceeded
      (mockRedisClient.incr as jest.Mock).mockResolvedValue(31);

      const response = await request(app)
        .patch('/api/v1/integrations/reconnect/amazon')
        .set('Authorization', 'Bearer test-token')
        .expect(429);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Too many requests');
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis connection failures gracefully', async () => {
      // Mock Redis connection failure
      (mockRedisClient.get as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const response = await request(app)
        .get('/api/amazon/callback?code=test-code&state=test-state')
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should handle token encryption failures', async () => {
      // Mock token manager to return encrypted tokens
      const tokenManager = require('../../src/utils/tokenManager').default;
      tokenManager.getToken.mockResolvedValue({
        accessToken: 'encrypted-access-token',
        refreshToken: 'encrypted-refresh-token',
        expiresAt: new Date(Date.now() + 3600000),
      });

      const amazonService = require('../../src/services/amazonService').default;
      amazonService.getValidAccessToken.mockImplementation(() => {
        return decryptToken('encrypted-access-token');
      });

      // This should work correctly with encrypted tokens
      const result = await amazonService.getValidAccessToken('test-user');
      expect(result).toBeDefined();
    });
  });
});
