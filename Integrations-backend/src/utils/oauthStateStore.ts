/**
 * OAuth state store.
 *
 * The state is a server-owned, one-time authorization binding. Production requires
 * Redis durability so a callback cannot depend on process-local memory.
 */
import logger from './logger';
import { getRedisClient, isRedisAvailable } from './redisClient';

export interface OAuthStateData {
  frontendUrl: string;
  timestamp: number;
  userId?: string;
  tenantSlug?: string;
  marketplaceId?: string;
  storeId?: string;
  redirectUri?: string;
  adminOverride?: boolean;
  auditIntentId?: string;
  auditRunId?: string;
  provider?: string;
}

class OAuthStateStore {
  private states = new Map<string, OAuthStateData>();
  private readonly ttlMs = 10 * 60 * 1000;

  private get productionRequiresDurableState(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private validateFresh(data: OAuthStateData | null): OAuthStateData | null {
    if (!data) return null;
    if (Date.now() - data.timestamp > this.ttlMs) return null;
    return data;
  }

  /**
   * Production callback state must be durable, but a cold or recently recovered
   * process may not have initialized the shared Redis client yet. Attempt the
   * configured connection once before refusing OAuth; never fall back to memory.
   */
  private async resolveStateClient(): Promise<Awaited<ReturnType<typeof getRedisClient>> | null> {
    if (!this.productionRequiresDurableState) {
      return isRedisAvailable() ? getRedisClient() : null;
    }

    try {
      const client = await getRedisClient();
      if (!client || !client.isReady) {
        throw new Error('Redis client is not ready for durable OAuth state.');
      }
      return client;
    } catch {
      throw new Error('OAUTH_DURABLE_STATE_REQUIRED');
    }
  }

  async set(state: string, data: OAuthStateData): Promise<void> {
    const value = { ...data, timestamp: Date.now() };
    const stateClient = await this.resolveStateClient();

    try {
      if (stateClient) {
        await stateClient.set(`oauth_state:${state}`, JSON.stringify(value), { EX: Math.floor(this.ttlMs / 1000) });
      } else {
        this.states.set(state, value);
        const timer = setTimeout(() => this.states.delete(state), this.ttlMs);
        timer.unref?.();
      }
    } catch (error: any) {
      if (this.productionRequiresDurableState) throw new Error('OAUTH_DURABLE_STATE_REQUIRED');
      this.states.set(state, value);
      const timer = setTimeout(() => this.states.delete(state), this.ttlMs);
      timer.unref?.();
      logger.warn('OAuth state fell back to in-memory storage outside production', { error: error?.message || String(error) });
    }
    // Never log the opaque state value or any callback URL parameters.
    logger.debug('OAuth state stored', { provider: data.provider, tenantSlug: data.tenantSlug, userId: data.userId });
  }

  async setState(
    state: string,
    userId: string,
    frontendUrl?: string,
    tenantSlug?: string,
    marketplaceId?: string,
    storeId?: string,
    redirectUri?: string,
    adminOverride?: boolean,
    auditIntentId?: string,
    auditRunId?: string,
    provider?: string
  ): Promise<void> {
    await this.set(state, {
      userId,
      frontendUrl: frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000',
      tenantSlug,
      marketplaceId,
      storeId,
      redirectUri,
      adminOverride,
      auditIntentId,
      auditRunId,
      provider,
      timestamp: Date.now()
    });
  }

  async get(state: string): Promise<OAuthStateData | null> {
    let value: OAuthStateData | null = null;
    try {
      if (isRedisAvailable()) {
        const client = await getRedisClient();
        const raw = await client.get(`oauth_state:${state}`);
        value = raw ? JSON.parse(raw) : null;
      } else if (!this.productionRequiresDurableState) {
        value = this.states.get(state) || null;
      }
    } catch (error: any) {
      logger.warn('OAuth state lookup failed', { error: error?.message || String(error) });
      return null;
    }

    const fresh = this.validateFresh(value);
    if (!fresh && value) await this.delete(state);
    return fresh;
  }

  /** Atomically consumes state in Redis, preventing callback replay races. */
  async consume(state: string): Promise<OAuthStateData | null> {
    let value: OAuthStateData | null = null;
    try {
      if (isRedisAvailable()) {
        const client: any = await getRedisClient();
        const key = `oauth_state:${state}`;
        const raw = typeof client.getdel === 'function'
          ? await client.getdel(key)
          : await client.eval("local v=redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v", 1, key);
        value = raw ? JSON.parse(raw) : null;
      } else if (!this.productionRequiresDurableState) {
        value = this.states.get(state) || null;
        this.states.delete(state);
      }
    } catch (error: any) {
      logger.warn('OAuth state consume failed', { error: error?.message || String(error) });
      return null;
    }

    const fresh = this.validateFresh(value);
    if (!fresh) return null;
    this.states.delete(state);
    return fresh;
  }

  async getUserId(state: string): Promise<string | null> {
    return (await this.get(state))?.userId || null;
  }

  async getFrontendUrl(state: string): Promise<string | null> {
    return (await this.get(state))?.frontendUrl || null;
  }

  async removeState(state: string): Promise<boolean> {
    return this.delete(state);
  }

  async delete(state: string): Promise<boolean> {
    const deletedMemory = this.states.delete(state);
    try {
      if (isRedisAvailable()) {
        const client = await getRedisClient();
        const deleted = await client.del(`oauth_state:${state}`);
        return deletedMemory || Number(deleted || 0) > 0;
      }
    } catch (error: any) {
      logger.warn('OAuth state delete failed', { error: error?.message || String(error) });
    }
    return deletedMemory;
  }

  cleanup(): number {
    let count = 0;
    for (const [state, data] of this.states.entries()) {
      if (!this.validateFresh(data)) {
        this.states.delete(state);
        count += 1;
      }
    }
    return count;
  }

  size(): number {
    return this.states.size;
  }
}

const oauthStateStore = new OAuthStateStore();
const cleanupInterval = setInterval(() => oauthStateStore.cleanup(), 5 * 60 * 1000);
cleanupInterval.unref?.();
export default oauthStateStore;
