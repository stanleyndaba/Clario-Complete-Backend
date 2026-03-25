import { Response } from 'express';
import logger from './logger';
import { buildCanonicalLiveEvent, CanonicalLiveEvent } from './agent10Event';

class SSEHub {
  private connections: Map<string, Map<string, Set<Response>>> = new Map();
  private eventHistory: Map<string, CanonicalLiveEvent[]> = new Map();
  private readonly maxHistorySize = 250;

  addConnection(userId: string, res: Response, tenantSlug: string = 'default'): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Map());
    }
    const userMap = this.connections.get(userId)!;
    if (!userMap.has(tenantSlug)) {
      userMap.set(tenantSlug, new Set());
    }
    userMap.get(tenantSlug)!.add(res);

    logger.info('✅ [SSE HUB] Connection added', {
      userId,
      tenantSlug,
      userConnectionsInTenant: userMap.get(tenantSlug)!.size,
      totalTenantsForUser: userMap.size,
      totalUsers: this.connections.size
    });
  }

  removeConnection(userId: string, res: Response, tenantSlug?: string): void {
    const userMap = this.connections.get(userId);
    if (!userMap) return;

    if (tenantSlug) {
      const set = userMap.get(tenantSlug);
      if (set) {
        set.delete(res);
        if (set.size === 0) userMap.delete(tenantSlug);
      }
    } else {
      // If slug not provided, find and remove from all
      for (const [slug, set] of userMap.entries()) {
        if (set.has(res)) {
          set.delete(res);
          if (set.size === 0) userMap.delete(slug);
          break;
        }
      }
    }

    if (userMap.size === 0) {
      this.connections.delete(userId);
      logger.info('✅ [SSE HUB] Last connection removed for user', { userId });
    }
  }

  /**
   * Check if user has active SSE connections
   */
  hasConnection(userId: string, tenantSlug?: string): boolean {
    const userMap = this.connections.get(userId);
    if (!userMap) return false;
    if (tenantSlug) {
      const set = userMap.get(tenantSlug);
      return set !== undefined && set.size > 0;
    }
    return userMap.size > 0;
  }

  /**
   * Get connection count for a user
   */
  getConnectionCount(userId: string, tenantSlug?: string): number {
    const userMap = this.connections.get(userId);
    if (!userMap) return 0;
    if (tenantSlug) {
      const set = userMap.get(tenantSlug);
      return set ? set.size : 0;
    }
    let total = 0;
    for (const set of userMap.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Get all connected user IDs
   */
  getConnectedUsers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Send SSE event to user with connection verification and error handling
   */
  sendEvent(userId: string, event: string, data: any, tenantSlug?: string): boolean {
    const userMap = this.connections.get(userId);
    const rawData = data && typeof data === 'object' ? data : {};
    const normalized = buildCanonicalLiveEvent(event, rawData, {
      userId,
      tenantSlug: tenantSlug || rawData?.tenantSlug || rawData?.tenant_slug || rawData?.slug
    });

    const history = this.eventHistory.get(userId) || [];
    history.push(normalized);
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
    this.eventHistory.set(userId, history);

    if (!userMap || userMap.size === 0) {
      return false;
    }

    // Determine target connections
    let targetSets: Set<Response>[] = [];
    const targetSlug = tenantSlug || rawData?.tenantSlug || rawData?.tenant_slug || rawData?.slug;

    if (targetSlug) {
      const set = userMap.get(targetSlug);
      if (set) targetSets.push(set);
    } else {
      // If no slug, send to all of user's connections (broadcast to user)
      targetSets = Array.from(userMap.values());
    }

    if (targetSets.length === 0) {
      return false;
    }

    const payload = `event: ${event}\ndata: ${JSON.stringify(normalized)}\n\n`;
    let successCount = 0;
    let errorCount = 0;
    const deadConnections: { res: Response, slug: string }[] = [];

    for (const [slug, set] of userMap.entries()) {
      // Skip if we are targeting a specific set and this isn't it
      if (targetSlug && slug !== targetSlug) continue;

      for (const res of set) {
        try {
          if (res.writable && !res.destroyed) {
            res.write(payload);
            successCount++;
          } else {
            deadConnections.push({ res, slug });
            errorCount++;
          }
        } catch (error: any) {
          logger.error('❌ [SSE HUB] Error sending event', { userId, event, error: error.message });
          deadConnections.push({ res, slug });
          errorCount++;
        }
      }
    }

    // Remove dead connections
    deadConnections.forEach(({ res, slug }) => {
      this.removeConnection(userId, res, slug);
    });

    return successCount > 0;
  }

  getRecentEvents(userId: string, tenantSlug?: string, limit: number = 50): CanonicalLiveEvent[] {
    const history = this.eventHistory.get(userId) || [];
    const normalizedSlug = String(tenantSlug || '').trim();

    const filtered = normalizedSlug
      ? history.filter((event) => {
          const eventSlug = String(
            event.tenant_slug ||
            event.payload?.tenant_slug ||
            event.payload?.tenantSlug ||
            event.payload?.slug ||
            ''
          ).trim();
          return !eventSlug || eventSlug === normalizedSlug;
        })
      : history;

    return filtered.slice(-Math.max(1, Math.min(limit, this.maxHistorySize)));
  }

  /**
   * Send event to all connected users (broadcast)
   */
  broadcastEvent(event: string, data: any): void {
    const users = this.getConnectedUsers();
    logger.info('📢 [SSE HUB] Broadcasting event', {
      event,
      userCount: users.length
    });

    users.forEach(userId => {
      this.sendEvent(userId, event, data);
    });
  }
}

export const sseHub = new SSEHub();
export default sseHub;


