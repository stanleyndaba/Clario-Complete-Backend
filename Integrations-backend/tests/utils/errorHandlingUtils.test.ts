/**
 * Unit Tests for Error Handling Utilities
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  handleOAuthTokenError,
  handleRateLimitError,
  handleNetworkError,
  validateClaimData,
  checkDuplicateClaim,
  handleEmptyEvidence,
  handlePaymentFailure,
  withErrorHandling
} from '../../src/utils/errorHandlingUtils';
import { SPAPIRateLimiter } from '../../src/utils/rateLimitHandler';
import { AuthError, SPAPIError, NetworkError, ValidationError, BusinessError } from '../../src/utils/errors';
import { validateClaim } from '../../src/utils/claimValidation';
import { preventDuplicateClaim } from '../../src/utils/duplicateDetection';

// Mock dependencies
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/duplicateDetection');
jest.mock('../../src/database/supabaseClient');

describe('Error Handling Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleOAuthTokenError', () => {
    it('should refresh token on 401 error and retry', async () => {
      let refreshCalled = false;
      let retryCalled = false;

      const refreshFn = async () => {
        refreshCalled = true;
      };

      const retryFn = async () => {
        retryCalled = true;
        return { success: true };
      };

      const error = { response: { status: 401 }, message: 'Token expired' };

      const result = await handleOAuthTokenError(
        error,
        refreshFn,
        retryFn,
        'test-user',
        'amazon'
      );

      expect(refreshCalled).toBe(true);
      expect(retryCalled).toBe(true);
      expect(result).toEqual({ success: true });
    });

    it('should throw AuthError if refresh fails', async () => {
      const refreshFn = async () => {
        throw new Error('Refresh failed');
      };

      const retryFn = async () => ({ success: true });

      const error = { response: { status: 401 }, message: 'Token expired' };

      await expect(
        handleOAuthTokenError(error, refreshFn, retryFn, 'test-user', 'amazon')
      ).rejects.toThrow(AuthError);
    });

    it('should not handle non-token errors', async () => {
      const error = { response: { status: 500 }, message: 'Server error' };

      await expect(
        handleOAuthTokenError(
          error,
          async () => {},
          async () => ({ success: true }),
          'test-user',
          'amazon'
        )
      ).rejects.toEqual(error);
    });
  });

  describe('handleRateLimitError', () => {
    it('should handle rate limit errors with retry', async () => {
      const rateLimiter = new SPAPIRateLimiter('test-service', 10);
      const retryFn = jest.fn().mockResolvedValue({ success: true });

      const error = { response: { status: 429 }, message: 'Rate limit exceeded' };

      const result = await handleRateLimitError(error, rateLimiter, retryFn, 3);

      expect(result).toEqual({ success: true });
    });

    it('should not handle non-rate-limit errors', async () => {
      const rateLimiter = new SPAPIRateLimiter('test-service', 10);
      const error = { response: { status: 500 }, message: 'Server error' };

      await expect(
        handleRateLimitError(error, rateLimiter, async () => ({ success: true }), 3)
      ).rejects.toEqual(error);
    });
  });

  describe('handleNetworkError', () => {
    it('should retry on network timeout', async () => {
      let attemptCount = 0;
      const retryFn = async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw { code: 'ETIMEDOUT', message: 'Request timeout' };
        }
        return { success: true };
      };

      const error = { code: 'ETIMEDOUT', message: 'Request timeout' };

      const result = await handleNetworkError(error, 'test-service', retryFn, 3);

      expect(attemptCount).toBe(2);
      expect(result).toEqual({ success: true });
    });

    it('should not handle non-network errors', async () => {
      const error = { code: 'VALIDATION_ERROR', message: 'Invalid input' };

      await expect(
        handleNetworkError(error, 'test-service', async () => ({ success: true }), 3)
      ).rejects.toEqual(error);
    });
  });

  describe('validateClaimData', () => {
    it('should validate valid claim data', () => {
      const validClaim = {
        claim_id: 'test-claim-123',
        user_id: 'test-user',
        amount: 100.50
      };

      expect(() => validateClaimData(validClaim)).not.toThrow();
    });

    it('should reject claim with missing claim_id', () => {
      const invalidClaim = {
        user_id: 'test-user',
        amount: 100.50
      };

      expect(() => validateClaimData(invalidClaim)).toThrow(ValidationError);
    });

    it('should reject claim with invalid amount', () => {
      const invalidClaim = {
        claim_id: 'test-claim-123',
        user_id: 'test-user',
        amount: -100 // Negative amount
      };

      expect(() => validateClaimData(invalidClaim)).toThrow(ValidationError);
    });

    it('should reject claim with amount exceeding maximum', () => {
      const invalidClaim = {
        claim_id: 'test-claim-123',
        user_id: 'test-user',
        amount: 200000 // Exceeds $100,000
      };

      expect(() => validateClaimData(invalidClaim)).toThrow(ValidationError);
    });
  });

  describe('checkDuplicateClaim', () => {
    it('should pass for non-existent claim', async () => {
      const checkFn = jest.fn().mockResolvedValue(false);

      await expect(
        checkDuplicateClaim('new-claim-123', checkFn)
      ).resolves.not.toThrow();

      expect(checkFn).toHaveBeenCalledWith('new-claim-123');
    });

    it('should throw BusinessError for duplicate claim', async () => {
      const checkFn = jest.fn().mockResolvedValue(true);

      await expect(
        checkDuplicateClaim('duplicate-claim-123', checkFn)
      ).rejects.toThrow(BusinessError);
    });
  });

  describe('handleEmptyEvidence', () => {
    it('should not throw for empty evidence', () => {
      expect(() => handleEmptyEvidence(0, 'test-claim-123')).not.toThrow();
    });

    it('should not throw for non-empty evidence', () => {
      expect(() => handleEmptyEvidence(5, 'test-claim-123')).not.toThrow();
    });
  });

  describe('handlePaymentFailure', () => {
    it('should throw for non-retryable payment errors', async () => {
      const error = { type: 'StripeCardError', message: 'Card declined' };

      await expect(
        handlePaymentFailure(error, async () => ({ success: true }), 3)
      ).rejects.toThrow();
    });

    it('should retry for retryable payment errors', async () => {
      let attemptCount = 0;
      const retryFn = async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw { type: 'StripeRateLimitError', message: 'Rate limit' };
        }
        return { success: true };
      };

      const error = { type: 'StripeRateLimitError', message: 'Rate limit' };

      const result = await handlePaymentFailure(error, retryFn, 3);

      expect(attemptCount).toBe(2);
      expect(result).toEqual({ success: true });
    });
  });

  describe('withErrorHandling', () => {
    it('should execute function successfully', async () => {
      const fn = jest.fn().mockResolvedValue({ success: true });

      const result = await withErrorHandling(fn, {
        service: 'test-service',
        operation: 'test'
      });

      expect(result).toEqual({ success: true });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle timeout', async () => {
      const fn = async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true };
      };

      await expect(
        withErrorHandling(fn, {
          service: 'test-service',
          operation: 'test',
          timeoutMs: 50 // Very short timeout
        })
      ).rejects.toThrow(NetworkError);
    });

    it('should retry on network errors', async () => {
      let attemptCount = 0;
      const fn = async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw { code: 'ECONNREFUSED', message: 'Connection refused' };
        }
        return { success: true };
      };

      const result = await withErrorHandling(fn, {
        service: 'test-service',
        operation: 'test',
        maxRetries: 3
      });

      expect(attemptCount).toBe(2);
      expect(result).toEqual({ success: true });
    });
  });
});

