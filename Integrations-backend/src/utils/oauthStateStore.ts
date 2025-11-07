/**
 * OAuth State Store
 * 
 * Stores OAuth state with associated frontend URL for dynamic redirect handling.
 * Supports both in-memory (development) and Redis (production) storage.
 */

import logger from './logger';

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
  set(state: string, data: OAuthStateData): void {
    this.states.set(state, {
      ...data,
      timestamp: Date.now()
    });

    // Auto-cleanup after TTL
    setTimeout(() => {
      this.delete(state);
    }, this.TTL_MS);

    logger.debug('OAuth state stored', { state, frontendUrl: data.frontendUrl, userId: data.userId });
  }

  /**
   * Store OAuth state with user ID (convenience method)
   */
  setState(state: string, userId: string, frontendUrl?: string): void {
    this.set(state, {
      userId,
      frontendUrl: frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000',
      timestamp: Date.now()
    });
  }

  /**
   * Get user ID from state
   */
  getUserId(state: string): string | null {
    const data = this.get(state);
    return data?.userId || null;
  }

  /**
   * Get frontend URL from state
   */
  getFrontendUrl(state: string): string | null {
    const data = this.get(state);
    return data?.frontendUrl || null;
  }

  /**
   * Remove state (alias for delete)
   */
  removeState(state: string): boolean {
    return this.delete(state);
  }

  /**
   * Get OAuth state data
   */
  get(state: string): OAuthStateData | null {
    const data = this.states.get(state);
    
    if (!data) {
      return null;
    }

    // Check if expired
    const age = Date.now() - data.timestamp;
    if (age > this.TTL_MS) {
      this.delete(state);
      logger.warn('OAuth state expired', { state, age });
      return null;
    }

    return data;
  }

  /**
   * Delete OAuth state (one-time use)
   */
  delete(state: string): boolean {
    const deleted = this.states.delete(state);
    if (deleted) {
      logger.debug('OAuth state deleted', { state });
    }
    return deleted;
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

