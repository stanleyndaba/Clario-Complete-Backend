import { StateValidator, createStateValidator } from '../../src/utils/stateValidator';

// Mock Redis client
const mockRedisClient = {
  setEx: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  isReady: true,
  connect: jest.fn(),
  quit: jest.fn(),
  on: jest.fn()
} as any;

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('StateValidator', () => {
  let stateValidator: StateValidator;

  beforeEach(() => {
    jest.clearAllMocks();
    stateValidator = new StateValidator(mockRedisClient);
  });

  describe('generateState', () => {
    it('should generate and store a new OAuth state', async () => {
      const userId = 'test-user-123';
      mockRedisClient.setEx.mockResolvedValue('OK');

      const state = await stateValidator.generateState(userId);

      expect(state).toBeDefined();
      expect(state.length).toBe(64); // 32 bytes = 64 hex chars
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `oauth_state:${state}`,
        300,
        userId
      );
    });

    it('should throw error when Redis setEx fails', async () => {
      const userId = 'test-user-123';
      mockRedisClient.setEx.mockRejectedValue(new Error('Redis error'));

      await expect(stateValidator.generateState(userId)).rejects.toThrow(
        'Failed to generate OAuth state'
      );
    });

    it('should generate unique states for different calls', async () => {
      mockRedisClient.setEx.mockResolvedValue('OK');

      const state1 = await stateValidator.generateState('user1');
      const state2 = await stateValidator.generateState('user2');

      expect(state1).not.toBe(state2);
    });
  });

  describe('validateOAuthState', () => {
    it('should validate and consume a valid OAuth state', async () => {
      const state = 'valid-state-token-1234567890abcdef';
      const userId = 'test-user-123';
      
      mockRedisClient.get.mockResolvedValue(userId);
      mockRedisClient.del.mockResolvedValue(1);

      const result = await stateValidator.validateOAuthState(state);

      expect(result).toEqual({ valid: true, userId });
      expect(mockRedisClient.get).toHaveBeenCalledWith(`oauth_state:${state}`);
      expect(mockRedisClient.del).toHaveBeenCalledWith(`oauth_state:${state}`);
    });

    it('should return invalid for non-existent state', async () => {
      const state = 'non-existent-state';
      mockRedisClient.get.mockResolvedValue(null);

      const result = await stateValidator.validateOAuthState(state);

      expect(result).toEqual({ valid: false });
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should return invalid for expired state', async () => {
      const state = 'expired-state';
      mockRedisClient.get.mockResolvedValue(null);

      const result = await stateValidator.validateOAuthState(state);

      expect(result).toEqual({ valid: false });
    });

    it('should return invalid for malformed state', async () => {
      const invalidStates = ['', 'short', null, undefined];

      for (const state of invalidStates) {
        const result = await stateValidator.validateOAuthState(state as string);
        expect(result).toEqual({ valid: false });
      }
    });

    it('should return invalid when Redis get fails', async () => {
      const state = 'valid-state';
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      const result = await stateValidator.validateOAuthState(state);

      expect(result).toEqual({ valid: false });
    });

    it('should return invalid when Redis del fails', async () => {
      const state = 'valid-state';
      const userId = 'test-user-123';
      
      mockRedisClient.get.mockResolvedValue(userId);
      mockRedisClient.del.mockRejectedValue(new Error('Redis error'));

      const result = await stateValidator.validateOAuthState(state);

      expect(result).toEqual({ valid: false });
    });

    it('should handle state with special characters', async () => {
      const state = 'state-with-special-chars!@#$%^&*()';
      const userId = 'test-user-123';
      
      mockRedisClient.get.mockResolvedValue(userId);
      mockRedisClient.del.mockResolvedValue(1);

      const result = await stateValidator.validateOAuthState(state);

      expect(result).toEqual({ valid: true, userId });
    });
  });

  describe('cleanupExpiredStates', () => {
    it('should cleanup expired states successfully', async () => {
      const expiredKeys = ['oauth_state:expired1', 'oauth_state:expired2'];
      mockRedisClient.keys.mockResolvedValue(expiredKeys);
      mockRedisClient.del.mockResolvedValue(2);

      const deletedCount = await stateValidator.cleanupExpiredStates();

      expect(deletedCount).toBe(2);
      expect(mockRedisClient.keys).toHaveBeenCalledWith('oauth_state:*');
      expect(mockRedisClient.del).toHaveBeenCalledWith(expiredKeys);
    });

    it('should return 0 when no expired states exist', async () => {
      mockRedisClient.keys.mockResolvedValue([]);

      const deletedCount = await stateValidator.cleanupExpiredStates();

      expect(deletedCount).toBe(0);
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should handle Redis keys failure gracefully', async () => {
      mockRedisClient.keys.mockRejectedValue(new Error('Redis error'));

      const deletedCount = await stateValidator.cleanupExpiredStates();

      expect(deletedCount).toBe(0);
    });

    it('should handle Redis del failure gracefully', async () => {
      const expiredKeys = ['oauth_state:expired1'];
      mockRedisClient.keys.mockResolvedValue(expiredKeys);
      mockRedisClient.del.mockRejectedValue(new Error('Redis error'));

      const deletedCount = await stateValidator.cleanupExpiredStates();

      expect(deletedCount).toBe(0);
    });
  });

  describe('generateRandomState', () => {
    it('should generate cryptographically secure random states', async () => {
      const states = new Set();
      
      // Generate multiple states and ensure they're unique
      for (let i = 0; i < 100; i++) {
        const state = await stateValidator.generateState('user');
        states.add(state);
      }

      expect(states.size).toBe(100); // All states should be unique
    });
  });

  describe('createStateValidator', () => {
    it('should create StateValidator instance', () => {
      const validator = createStateValidator(mockRedisClient);
      expect(validator).toBeInstanceOf(StateValidator);
    });
  });

  describe('Edge Cases', () => {
    it('should handle Redis connection issues gracefully', async () => {
      mockRedisClient.setEx.mockRejectedValue(new Error('Connection refused'));
      
      await expect(stateValidator.generateState('user')).rejects.toThrow(
        'Failed to generate OAuth state'
      );
    });

    it('should handle Redis timeout gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis timeout'));
      
      const result = await stateValidator.validateOAuthState('test-state');
      expect(result).toEqual({ valid: false });
    });

    it('should handle malformed Redis responses', async () => {
      mockRedisClient.get.mockResolvedValue(''); // Empty string
      
      const result = await stateValidator.validateOAuthState('test-state');
      expect(result).toEqual({ valid: false });
    });
  });
});
