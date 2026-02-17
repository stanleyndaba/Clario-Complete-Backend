import { Response } from 'express';
import logger from './logger';

class SSEHub {
  private connections: Map<string, Map<string, Set<Response>>> = new Map();

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

    if (!userMap || userMap.size === 0) {
      return false;
    }

    // Determine target connections
    let targetSets: Set<Response>[] = [];
    const targetSlug = tenantSlug || data?.tenantSlug || data?.tenant_slug || data?.slug;

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

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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


