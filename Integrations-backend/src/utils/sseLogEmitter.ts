/**
 * SSE Log Emitter
 * Sends real-time log events to frontend via SSE
 * Used by all agents to provide transparent activity reporting
 */

import sseHub from '../utils/sseHub';
import logger from '../utils/logger';

export type LogType = 'info' | 'success' | 'error' | 'warning' | 'progress';
export type AgentCategory =
    | 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent6'
    | 'agent7' | 'agent8' | 'agent9' | 'agent10' | 'agent11' | 'system';

export interface SyncLogEvent {
    type: 'log';
    syncId?: string;
    log: {
        type: LogType;
        category: AgentCategory;
        message: string;
        count?: number;
        metadata?: Record<string, any>;
    };
}

class SSELogEmitter {
    /**
     * Emit a log event to a specific user via SSE
     */
    emitLog(
        userId: string,
        type: LogType,
        category: AgentCategory,
        message: string,
        options?: {
            syncId?: string;
            count?: number;
            metadata?: Record<string, any>;
        }
    ): boolean {
        const logEvent: SyncLogEvent = {
            type: 'log',
            syncId: options?.syncId,
            log: {
                type,
                category,
                message,
                count: options?.count,
                metadata: options?.metadata
            }
        };

        // Send via SSE hub
        const sent = sseHub.sendEvent(userId, 'sync_progress', logEvent);

        if (sent) {
            logger.debug('📤 [SSE LOG] Log emitted', {
                userId,
                category,
                type,
                message: message.substring(0, 50) // Log first 50 chars
            });
        } else {
            logger.warn('⚠️ [SSE LOG] Failed to emit log (no active SSE connection)', {
                userId,
                category,
                type
            });
        }

        return sent;
    }

    /**
     * Agent 1: OAuth events
     */
    agent1Log(userId: string, message: string, type: LogType = 'info', syncId?: string) {
        return this.emitLog(userId, type, 'agent1', message, { syncId });
    }

    /**
     * Agent 2: Data Sync events
     */
    agent2Log(userId: string, message: string, type: LogType = 'info', options?: {
        syncId?: string;
        count?: number;
    }) {
        return this.emitLog(userId, type, 'agent2', message, options);
    }

    /**
     * Agent 3: Claim Detection events
     */
    agent3Log(userId: string, message: string, type: LogType = 'info', options?: {
        syncId?: string;
        count?: number;
        metadata?: Record<string, any>;
    }) {
        return this.emitLog(userId, type, 'agent3', message, options);
    }

    /**
     * Agent 4: Evidence Ingestion events
     */
    agent4Log(userId: string, message: string, type: LogType = 'info', options?: {
        count?: number;
        metadata?: Record<string, any>;
    }) {
        return this.emitLog(userId, type, 'agent4', message, options);
    }

    /**
     * Agent 5: Document Parsing events
     */
    agent5Log(userId: string, message: string, type: LogType = 'info', options?: {
        count?: number;
        metadata?: Record<string, any>;
    }) {
        return this.emitLog(userId, type, 'agent5', message, options);
    }

    /**
     * Agent 6: Evidence Matching events
     */
    agent6Log(userId: string, message: string, type: LogType = 'info', options?: {
        count?: number;
        metadata?: Record<string, any>;
    }) {
        return this.emitLog(userId, type, 'agent6', message, options);
    }

    /**
     * Agent 7: Refund Filing events
     */
    agent7Log(userId: string, message: string, type: LogType = 'info', options?: {
        count?: number;
        metadata?: Record<string, any>;
    }) {
        return this.emitLog(userId, type, 'agent7', message, options);
    }

    /**
     * Agent 8: Recoveries events
     */
    agent8Log(userId: string, message: string, type: LogType = 'info', options?: {
        count?: number;
        metadata?: Record<string, any>;
    }) {
        return this.emitLog(userId, type, 'agent8', message, options);
    }

    /**
     * Agent 9: Billing events
     */
    agent9Log(userId: string, message: string, type: LogType = 'info', options?: {
        count?: number;
        metadata?: Record<string, any>;
    }) {
        return this.emitLog(userId, type, 'agent9', message, options);
    }

    /**
     * Agent 10: Notifications events
     */
    agent10Log(userId: string, message: string, type: LogType = 'info', options?: {
        count?: number;
        metadata?: Record<string, any>;
    }) {
        return this.emitLog(userId, type, 'agent10', message, options);
    }

    /**
     * Agent 11: Learning events
     */
    agent11Log(userId: string, message: string, type: LogType = 'info', options?: {
        count?: number;
        metadata?: Record<string, any>;
    }) {
        return this.emitLog(userId, type, 'agent11', message, options);
    }

    /**
     * System events
     */
    systemLog(userId: string, message: string, type: LogType = 'info', syncId?: string) {
        return this.emitLog(userId, type, 'system', message, { syncId });
    }
}

// Export singleton instance
export const sseLogEmitter = new SSELogEmitter();
export default sseLogEmitter;
