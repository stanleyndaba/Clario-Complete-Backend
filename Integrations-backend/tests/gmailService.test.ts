import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import gmailService from '../src/services/gmailService';
import tokenManager from '../src/utils/tokenManager';

// Mock dependencies
jest.mock('../src/utils/tokenManager');
jest.mock('../src/utils/logger');

describe('GmailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('connectGmail', () => {
    it('should connect Gmail successfully when not already connected', async () => {
      (tokenManager.isTokenValid as jest.Mock).mockResolvedValue(false);

      const result = await gmailService.connectGmail('test-user-id');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('Gmail connection initiated');
      expect(result.authUrl).toBeDefined();
    });

    it('should return already connected message when already connected', async () => {
      (tokenManager.isTokenValid as jest.Mock).mockResolvedValue(true);

      const result = await gmailService.connectGmail('test-user-id');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('Gmail already connected');
    });
  });

  describe('fetchEmails', () => {
    it('should fetch emails successfully', async () => {
      const mockToken = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000)
      };

      (tokenManager.getToken as jest.Mock).mockResolvedValue(mockToken);

      const result = await gmailService.fetchEmails('test-user-id');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('subject');
      expect(result[0]).toHaveProperty('from');
    });

    it('should handle errors when fetching emails', async () => {
      (tokenManager.getToken as jest.Mock).mockRejectedValue(new Error('Token not found'));

      await expect(gmailService.fetchEmails('test-user-id')).rejects.toThrow();
    });
  });

  describe('searchEmails', () => {
    it('should search emails successfully', async () => {
      const mockToken = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000)
      };

      (tokenManager.getToken as jest.Mock).mockResolvedValue(mockToken);

      const result = await gmailService.searchEmails('test-user-id', 'test query');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('subject');
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      (tokenManager.revokeToken as jest.Mock).mockResolvedValue(undefined);

      await expect(gmailService.disconnect('test-user-id')).resolves.not.toThrow();
      expect(tokenManager.revokeToken).toHaveBeenCalledWith('test-user-id', 'gmail');
    });
  });
}); 