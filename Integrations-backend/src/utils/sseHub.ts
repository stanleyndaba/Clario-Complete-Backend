import { Response } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from './logger';
import { buildCanonicalLiveEvent, CanonicalLiveEvent } from './agent10Event';
import { getCachedTenantSlug, resolveTenantSlug } from './tenantEventRouting';

class SSEHub {
  private connections: Map<string, Map<string, Set<Response>>> = new Map();
  private eventHistory: Map<string, CanonicalLiveEvent[]> = new Map();
  private readonly maxHistorySize = 250;
  private readonly replayRetentionHours = 72;

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

  private appendRecentEvent(userId: string, event: CanonicalLiveEvent): void {
    const history = this.eventHistory.get(userId) || [];
    history.push(event);
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
    this.eventHistory.set(userId, history);
  }

  private deliverNormalizedEvent(
    userId: string,
    eventName: string,
    normalized: CanonicalLiveEvent,
    tenantSlug?: string
  ): boolean {
    const userMap = this.connections.get(userId);
    if (!userMap || userMap.size === 0) {
      return false;
    }

    const targetSlug = tenantSlug;
    let targetSets: Set<Response>[] = [];

    if (targetSlug) {
      const set = userMap.get(targetSlug);
      if (set) targetSets.push(set);
    } else {
      targetSets = Array.from(userMap.values());
    }

    if (targetSets.length === 0) {
      return false;
    }

    const payload = `event: ${eventName}\ndata: ${JSON.stringify(normalized)}\n\n`;
    let successCount = 0;
    const deadConnections: { res: Response; slug: string }[] = [];

    for (const [slug, set] of userMap.entries()) {
      if (targetSlug && slug !== targetSlug) continue;

      for (const res of set) {
        try {
          if (res.writable && !res.destroyed) {
            res.write(payload);
            successCount++;
          } else {
            deadConnections.push({ res, slug });
          }
        } catch (error: any) {
          logger.error('❌ [SSE HUB] Error sending event', { userId, event: eventName, error: error.message });
          deadConnections.push({ res, slug });
        }
      }
    }

    deadConnections.forEach(({ res, slug }) => {
      this.removeConnection(userId, res, slug);
    });

    return successCount > 0;
  }

  private async resolveTenantAudienceUserIds(tenantId?: string, tenantSlug?: string): Promise<string[]> {
    if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
      return [];
    }

    let resolvedTenantId = tenantId;
    if (!resolvedTenantId && tenantSlug) {
      const { data: tenant, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('id')
        .eq('slug', tenantSlug)
        .is('deleted_at', null)
        .maybeSingle();

      if (tenantError) {
        throw tenantError;
      }

      resolvedTenantId = String(tenant?.id || '').trim() || undefined;
    }

    if (!resolvedTenantId) {
      return [];
    }

    const { data, error } = await supabaseAdmin
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', resolvedTenantId)
      .eq('is_active', true)
      .is('deleted_at', null);

    if (error) {
      throw error;
    }

    const audienceUserIds = (data || [])
      .map((row: any) => String(row?.user_id || '').trim())
      .filter((userId: string) => Boolean(userId));

    return Array.from(new Set<string>(audienceUserIds));
  }

  /**
   * Send SSE event to user with connection verification and error handling
   */
  sendEvent(userId: string, event: string, data: any, tenantSlug?: string): boolean {
    const rawData = data && typeof data === 'object' ? data : {};
    const inferredTenantId = rawData?.tenant_id || rawData?.tenantId;
    const cachedTenantSlug = tenantSlug || rawData?.tenantSlug || rawData?.tenant_slug || rawData?.slug || getCachedTenantSlug(inferredTenantId);
    const normalized = buildCanonicalLiveEvent(event, rawData, {
      userId,
      tenantSlug: cachedTenantSlug,
      tenantId: inferredTenantId
    });

    void this.persistRecentEvent(normalized);
    this.appendRecentEvent(userId, normalized);
    return this.deliverNormalizedEvent(userId, event, normalized, cachedTenantSlug);
  }

  async sendTenantEvent(event: string, data: any, tenantSlug?: string, tenantId?: string): Promise<boolean> {
    const rawData = data && typeof data === 'object' ? data : {};
    const inferredTenantId = tenantId || rawData?.tenant_id || rawData?.tenantId;
    const cachedTenantSlug = tenantSlug || rawData?.tenantSlug || rawData?.tenant_slug || rawData?.slug || getCachedTenantSlug(inferredTenantId);
    const audienceUserIds = await this.resolveTenantAudienceUserIds(inferredTenantId, cachedTenantSlug);

    if (audienceUserIds.length === 0) {
      logger.warn('⚠️ [SSE HUB] No tenant audience resolved for event', {
        event,
        tenantId: inferredTenantId,
        tenantSlug: cachedTenantSlug
      });
      return false;
    }

    let delivered = false;
    for (const audienceUserId of audienceUserIds) {
      const normalized = buildCanonicalLiveEvent(event, rawData, {
        userId: audienceUserId,
        tenantId: inferredTenantId,
        tenantSlug: cachedTenantSlug
      });
      void this.persistRecentEvent(normalized);
      this.appendRecentEvent(audienceUserId, normalized);
      delivered = this.deliverNormalizedEvent(audienceUserId, event, normalized, cachedTenantSlug) || delivered;
    }

    return delivered;
  }

  private async persistRecentEvent(event: CanonicalLiveEvent): Promise<void> {
    if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
      return;
    }

    try {
      const tenantSlug = event.tenant_slug || await resolveTenantSlug(event.tenant_id);
      const persistedEvent = tenantSlug && !event.tenant_slug
        ? {
            ...event,
            tenant_slug: tenantSlug,
            payload: {
              ...event.payload,
              tenant_slug: tenantSlug
            }
          }
        : event;

      const { error } = await supabaseAdmin
        .from('recent_platform_events')
        .insert({
          user_id: persistedEvent.user_id,
          tenant_id: persistedEvent.tenant_id || null,
          tenant_slug: persistedEvent.tenant_slug || null,
          event_type: persistedEvent.event_type,
          entity_type: persistedEvent.entity_type || null,
          entity_id: persistedEvent.entity_id || null,
          payload: persistedEvent.payload,
          created_at: persistedEvent.timestamp
        });

      if (error) {
        throw error;
      }

      const retentionCutoff = new Date(Date.now() - this.replayRetentionHours * 60 * 60 * 1000).toISOString();
      const { error: cleanupError } = await supabaseAdmin
        .from('recent_platform_events')
        .delete()
        .lt('created_at', retentionCutoff);

      if (cleanupError) {
        logger.debug('Failed to trim recent platform event replay buffer', {
          error: cleanupError.message
        });
      }
    } catch (error: any) {
      logger.warn('Failed to persist recent live event for replay', {
        eventType: event.event_type,
        entityId: event.entity_id,
        error: error?.message || error
      });
    }
  }

  async getRecentEvents(userId: string, tenantSlug?: string, limit: number = 50): Promise<CanonicalLiveEvent[]> {
    if (supabaseAdmin && typeof supabaseAdmin.from === 'function') {
      try {
        let query = supabaseAdmin
          .from('recent_platform_events')
          .select('user_id, tenant_id, tenant_slug, event_type, entity_type, entity_id, payload, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(Math.max(1, Math.min(limit, this.maxHistorySize)));

        if (tenantSlug) {
          query = query.eq('tenant_slug', tenantSlug);
        }

        const { data, error } = await query;
        if (error) {
          throw error;
        }

        if (Array.isArray(data) && data.length > 0) {
          return data
            .slice()
            .reverse()
            .map((row: any) =>
              buildCanonicalLiveEvent(row.event_type, row.payload || {}, {
                eventType: row.event_type,
                userId: row.user_id,
                tenantId: row.tenant_id || undefined,
                tenantSlug: row.tenant_slug || undefined,
                timestamp: row.created_at,
                entityType: row.entity_type || undefined,
                entityId: row.entity_id || undefined
              })
            );
        }
      } catch (error: any) {
        logger.warn('Failed to load durable recent live events, falling back to memory', {
          userId,
          tenantSlug,
          error: error?.message || error
        });
      }
    }

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


