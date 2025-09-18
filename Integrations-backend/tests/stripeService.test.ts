import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import stripeService from '../src/services/stripeService';
import tokenManager from '../src/utils/tokenManager';

// Mock dependencies
jest.mock('../src/utils/tokenManager');
jest.mock('../src/utils/logger');

describe('StripeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('connectStripe', () => {
    it('should connect Stripe successfully when not already connected', async () => {
      (tokenManager.isTokenValid as jest.Mock).mockResolvedValue(false);

      const result = await stripeService.connectStripe('test-user-id');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('Stripe connection initiated');
      expect(result.authUrl).toBeDefined();
    });

    it('should return already connected message when already connected', async () => {
      (tokenManager.isTokenValid as jest.Mock).mockResolvedValue(true);

      const result = await stripeService.connectStripe('test-user-id');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('Stripe already connected');
    });
  });

  describe('fetchTransactions', () => {
    it('should fetch transactions successfully', async () => {
      const mockToken = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000)
      };

      (tokenManager.getToken as jest.Mock).mockResolvedValue(mockToken);

      const result = await stripeService.fetchTransactions('test-user-id');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('amount');
      expect(result[0]).toHaveProperty('currency');
      expect(result[0]).toHaveProperty('status');
    });

    it('should handle errors when fetching transactions', async () => {
      (tokenManager.getToken as jest.Mock).mockRejectedValue(new Error('Token not found'));

      await expect(stripeService.fetchTransactions('test-user-id')).rejects.toThrow();
    });
  });

  describe('getAccountInfo', () => {
    it('should fetch account info successfully', async () => {
      const mockToken = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000)
      };

      (tokenManager.getToken as jest.Mock).mockResolvedValue(mockToken);

      const result = await stripeService.getAccountInfo('test-user-id');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('businessType');
      expect(result).toHaveProperty('country');
      expect(result).toHaveProperty('email');
    });
  });

  describe('getTransaction', () => {
    it('should fetch specific transaction successfully', async () => {
      const mockToken = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000)
      };

      (tokenManager.getToken as jest.Mock).mockResolvedValue(mockToken);

      const result = await stripeService.getTransaction('test-user-id', 'txn_123');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('amount');
      expect(result).toHaveProperty('currency');
      expect(result).toHaveProperty('status');
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      (tokenManager.revokeToken as jest.Mock).mockResolvedValue(undefined);

      await expect(stripeService.disconnect('test-user-id')).resolves.not.toThrow();
      expect(tokenManager.revokeToken).toHaveBeenCalledWith('test-user-id', 'stripe');
    });
  });
}); 