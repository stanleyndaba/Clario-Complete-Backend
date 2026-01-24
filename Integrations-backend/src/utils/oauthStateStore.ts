/**
 * OAuth State Store
 * 
 * Stores OAuth state with associated frontend URL for dynamic redirect handling.
 * Supports both in-memory (development) and Redis (production) storage.
 */

import logger from './logger';
import { getRedisClient, isRedisAvailable } from './redisClient';

interface OAuthStateData {
  frontendUrl: string;
  timestamp: number;
  userId?: string;
}

/**
 * In-memory OAuth state store
 * For production, consider using Redis for persistence across restarts
 */
class InMemoryOAuthStateStore {
  private states: Map<string, OAuthStateData> = new Map();
  private readonly TTL_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Store OAuth state with frontend URL
   */
  async set(state: string, data: OAuthStateData): Promise<void> {
    const stateData = {
      ...data,
      timestamp: Date.now()
    };

    // Store in memory (fallback)
    this.states.set(state, stateData);

    // Auto-cleanup memory after TTL
    setTimeout(() => {
      this.states.delete(state);
    }, this.TTL_MS);

    // Store in Redis if available (Persistence for production)
    try {
      if (isRedisAvailable()) {
        const client = await getRedisClient();
        const redisKey = `oauth_state:${state}`;
        await client.set(redisKey, JSON.stringify(stateData), {
          EX: Math.floor(this.TTL_MS / 1000) // TTL in seconds
        });
        logger.info('OAuth state stored in Redis', { state, userId: data.userId });
      }
    } catch (err: any) {
      logger.warn('Failed to store OAuth state in Redis (falling back to memory)', { error: err.message });
    }

    logger.debug('OAuth state stored in memory', { state, frontendUrl: data.frontendUrl, userId: data.userId });
  }

  /**
   * Store OAuth state with user ID (convenience method)
   */
  async setState(state: string, userId: string, frontendUrl?: string): Promise<void> {
    await this.set(state, {
      userId,
      frontendUrl: frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000',
      timestamp: Date.now()
    });
  }

  /**
   * Get user ID from state
   */
  async getUserId(state: string): Promise<string | null> {
    const data = await this.get(state);
    return data?.userId || null;
  }

  /**
   * Get frontend URL from state
   */
  async getFrontendUrl(state: string): Promise<string | null> {
    const data = await this.get(state);
    return data?.frontendUrl || null;
  }

  /**
   * Remove state (alias for delete)
   */
  async removeState(state: string): Promise<boolean> {
    return await this.delete(state);
  }

  /**
   * Get OAuth state data
   */
  async get(state: string): Promise<OAuthStateData | null> {
    // 1. Try Memory first
    let data = this.states.get(state);

    // 2. If not in memory, try Redis (If available)
    if (!data) {
      try {
        if (isRedisAvailable()) {
          const client = await getRedisClient();
          const redisKey = `oauth_state:${state}`;
          const cached = await client.get(redisKey);
          if (cached) {
            data = JSON.parse(cached);
            logger.info('OAuth state recovered from Redis', { state });
            // Sync back to memory to speed up subsequent requests
            if (data) this.states.set(state, data);
          }
        }
      } catch (err: any) {
        logger.warn('Failed to get OAuth state from Redis', { error: err.message });
      }
    }

    if (!data) {
      return null;
    }

    // Check if expired (Memory check)
    const age = Date.now() - data.timestamp;
    if (age > this.TTL_MS) {
      await this.delete(state);
      logger.warn('OAuth state expired', { state, age });
      return null;
    }

    return data;
  }

  /**
   * Delete OAuth state (one-time use)
   */
  async delete(state: string): Promise<boolean> {
    // Delete from memory
    const deletedMemory = this.states.delete(state);

    // Delete from Redis if available
    let deletedRedis = false;
    try {
      if (isRedisAvailable()) {
        const client = await getRedisClient();
        const redisKey = `oauth_state:${state}`;
        const result = await client.del(redisKey);
        deletedRedis = result > 0;
      }
    } catch (err: any) {
      logger.warn('Failed to delete OAuth state from Redis', { error: err.message });
    }

    if (deletedMemory || deletedRedis) {
      logger.debug('OAuth state deleted', { state, deletedMemory, deletedRedis });
    }
    return deletedMemory || deletedRedis;
  }

  /**
   * Clean up expired states
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [state, data] of this.states.entries()) {
      const age = now - data.timestamp;
      if (age > this.TTL_MS) {
        this.states.delete(state);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up expired OAuth states', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * Get store size (for monitoring)
   */
  size(): number {
    return this.states.size;
  }
}

// Singleton instance
const oauthStateStore = new InMemoryOAuthStateStore();

// Cleanup expired states every 5 minutes
setInterval(() => {
  oauthStateStore.cleanup();
}, 5 * 60 * 1000);

export default oauthStateStore;

