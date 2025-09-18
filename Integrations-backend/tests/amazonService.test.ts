import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import amazonService from '../src/services/amazonService';
import tokenManager from '../src/utils/tokenManager';

// Mock dependencies
jest.mock('../src/utils/tokenManager');
jest.mock('../src/utils/logger');

describe('AmazonService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchClaims', () => {
    it('should fetch claims successfully', async () => {
      const mockToken = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000)
      };

      (tokenManager.getToken as jest.Mock).mockResolvedValue(mockToken);

      const result = await amazonService.fetchClaims('test-user-id');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('claimId');
      expect(result[0]).toHaveProperty('claimType');
    });

    it('should handle errors when fetching claims', async () => {
      (tokenManager.getToken as jest.Mock).mockRejectedValue(new Error('Token not found'));

      await expect(amazonService.fetchClaims('test-user-id')).rejects.toThrow();
    });
  });

  describe('fetchInventory', () => {
    it('should fetch inventory successfully', async () => {
      const mockToken = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000)
      };

      (tokenManager.getToken as jest.Mock).mockResolvedValue(mockToken);

      const result = await amazonService.fetchInventory('test-user-id');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('sku');
      expect(result[0]).toHaveProperty('asin');
    });
  });

  describe('fetchFees', () => {
    it('should fetch fees successfully', async () => {
      const mockToken = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000)
      };

      (tokenManager.getToken as jest.Mock).mockResolvedValue(mockToken);

      const result = await amazonService.fetchFees('test-user-id');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('feeType');
      expect(result[0]).toHaveProperty('feeAmount');
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      (tokenManager.revokeToken as jest.Mock).mockResolvedValue(undefined);

      await expect(amazonService.disconnect('test-user-id')).resolves.not.toThrow();
      expect(tokenManager.revokeToken).toHaveBeenCalledWith('test-user-id', 'amazon');
    });
  });
}); 