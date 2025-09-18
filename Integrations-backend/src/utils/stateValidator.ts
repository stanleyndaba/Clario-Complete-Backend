import { RedisClientType } from 'redis';
import logger from './logger';

/**
 * State validation helper for OAuth flows
 * Validates and consumes OAuth state tokens stored in Redis
 */
export class StateValidator {
  private redisClient: RedisClientType;
  private readonly statePrefix = 'oauth_state:';
  private readonly stateExpirySeconds = 300; // 5 minutes

  constructor(redisClient: RedisClientType) {
    this.redisClient = redisClient;
  }

  /**
   * Generate a new OAuth state token and store it in Redis
   */
  async generateState(userId: string): Promise<string> {
    try {
      const state = this.generateRandomState();
      const key = `${this.statePrefix}${state}`;
      
      await this.redisClient.setEx(key, this.stateExpirySeconds, userId);
      
      logger.info('OAuth state generated', {
        userId,
        state,
        expirySeconds: this.stateExpirySeconds
      });
      
      return state;
    } catch (error) {
      logger.error('Failed to generate OAuth state', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to generate OAuth state');
    }
  }

  /**
   * Validate OAuth state token and consume it (one-time use)
   */
  async validateOAuthState(state: string): Promise<{ valid: boolean; userId?: string }> {
    try {
      if (!state || typeof state !== 'string' || state.length < 16) {
        logger.warn('Invalid OAuth state format', { state });
        return { valid: false };
      }

      const key = `${this.statePrefix}${state}`;
      
      // Get the stored userId for this state
      const userId = await this.redisClient.get(key);
      
      if (!userId) {
        logger.warn('OAuth state not found or expired', { state });
        return { valid: false };
      }

      // Delete the state immediately (one-time use)
      await this.redisClient.del(key);
      
      logger.info('OAuth state validated and consumed', {
        state,
        userId
      });
      
      return { valid: true, userId };
    } catch (error) {
      logger.error('Failed to validate OAuth state', {
        state,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Fail closed - treat as invalid on any error
      return { valid: false };
    }
  }

  /**
   * Clean up expired state tokens (can be called periodically)
   */
  async cleanupExpiredStates(): Promise<number> {
    try {
      const pattern = `${this.statePrefix}*`;
      const keys = await this.redisClient.keys(pattern);
      
      if (keys.length === 0) {
        return 0;
      }

      const deletedCount = await this.redisClient.del(keys);
      
      logger.info('Cleaned up expired OAuth states', {
        deletedCount,
        totalKeys: keys.length
      });
      
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup expired OAuth states', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Generate a cryptographically secure random state token
   */
  private generateRandomState(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
}

/**
 * Factory function to create StateValidator instance
 */
export function createStateValidator(redisClient: RedisClientType): StateValidator {
  return new StateValidator(redisClient);
}
