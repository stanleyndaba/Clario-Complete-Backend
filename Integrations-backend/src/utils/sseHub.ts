import { Response } from 'express';
import logger from './logger';

class SSEHub {
  private connections: Map<string, Set<Response>> = new Map();

  addConnection(userId: string, res: Response): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(res);
    logger.info('✅ [SSE HUB] Connection added', {
      userId,
      totalConnections: this.connections.get(userId)!.size,
      totalUsers: this.connections.size
    });
  }

  removeConnection(userId: string, res: Response): void {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) {
      this.connections.delete(userId);
      logger.info('✅ [SSE HUB] Last connection removed for user', { userId });
    } else {
      logger.info('✅ [SSE HUB] Connection removed', {
        userId,
        remainingConnections: set.size
      });
    }
  }

  /**
   * Check if user has active SSE connections
   */
  hasConnection(userId: string): boolean {
    const set = this.connections.get(userId);
    return set !== undefined && set.size > 0;
  }

  /**
   * Get connection count for a user
   */
  getConnectionCount(userId: string): number {
    const set = this.connections.get(userId);
    return set ? set.size : 0;
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
  sendEvent(userId: string, event: string, data: any): boolean {
    const set = this.connections.get(userId);
    
    if (!set || set.size === 0) {
      logger.warn('⚠️ [SSE HUB] No connections found for user', {
        userId,
        event,
        connectedUsers: this.getConnectedUsers()
      });
      return false;
    }

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    let successCount = 0;
    let errorCount = 0;
    const deadConnections: Response[] = [];

    for (const res of set) {
      try {
        // Check if response is still writable
        if (res.writable && !res.destroyed) {
          res.write(payload);
          successCount++;
        } else {
          deadConnections.push(res);
          errorCount++;
        }
      } catch (error: any) {
        logger.error('❌ [SSE HUB] Error sending event', {
          userId,
          event,
          error: error.message
        });
        deadConnections.push(res);
        errorCount++;
      }
    }

    // Remove dead connections
    if (deadConnections.length > 0) {
      deadConnections.forEach(deadRes => {
        this.removeConnection(userId, deadRes);
      });
    }

    if (successCount > 0) {
      logger.debug('✅ [SSE HUB] Event sent successfully', {
        userId,
        event,
        successCount,
        errorCount,
        totalConnections: set.size
      });
      return true;
    } else {
      logger.warn('⚠️ [SSE HUB] All connections failed for user', {
        userId,
        event,
        totalConnections: set.size,
        errorCount
      });
      return false;
    }
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


