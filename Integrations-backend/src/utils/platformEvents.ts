/**
 * Platform Event Emitter
 * 
 * Unified event system for real-time platform state:
 * - Job lifecycle events
 * - Agent invocation events  
 * - Financial impact events
 * - System health events
 * 
 * Automatically broadcasts to SSE and WebSocket.
 */

import sseHub from './sseHub';
import logger from './logger';

// Event types for the platform
export enum PlatformEventType {
    // Job lifecycle
    JOB_QUEUED = 'job.queued',
    JOB_STARTED = 'job.started',
    JOB_PROGRESS = 'job.progress',
    JOB_COMPLETED = 'job.completed',
    JOB_FAILED = 'job.failed',
    JOB_RETRYING = 'job.retrying',

    // Agent lifecycle
    AGENT_INVOKED = 'agent.invoked',
    AGENT_COMPLETED = 'agent.completed',
    AGENT_FAILED = 'agent.failed',

    // Detection lifecycle
    ANOMALY_DETECTED = 'detection.anomaly_detected',
    CLAIM_CREATED = 'detection.claim_created',
    CLAIM_FILED = 'detection.claim_filed',
    CLAIM_APPROVED = 'detection.claim_approved',
    CLAIM_REJECTED = 'detection.claim_rejected',
    PAYOUT_RECEIVED = 'detection.payout_received',

    // Financial
    FINANCIAL_IMPACT = 'financial.impact',
    METRICS_UPDATE = 'financial.metrics_update',

    // System
    SYSTEM_HEALTH = 'system.health',
    CIRCUIT_STATE = 'system.circuit_state',
    QUEUE_DEPTH = 'system.queue_depth'
}

// Event payload structure
export interface PlatformEvent {
    type: PlatformEventType;
    userId?: string;
    tenantId?: string;
    data: {
        // Common fields
        id?: string;
        timestamp: string;

        // Job fields
        jobId?: string;
        jobType?: string;
        progress?: number;

        // Agent fields
        agent?: string;

        // Detection fields
        detectionId?: string;
        claimId?: string;
        anomalyType?: string;
        confidence?: number;

        // Financial fields
        amount?: number;
        currency?: string;
        financialImpact?: number;

        // Explanation fields
        explanation?: string;
        rootCause?: string;
        recoveryProbability?: number;

        // Generic
        message?: string;
        metadata?: Record<string, any>;
    };
}

class PlatformEventEmitter {
    private eventHistory: PlatformEvent[] = [];
    private readonly maxHistorySize = 1000;

    /**
     * Emit an event to a specific user
     */
    emit(event: PlatformEvent): void {
        const timestamp = event.data.timestamp || new Date().toISOString();
        event.data.timestamp = timestamp;

        // Store in history
        this.eventHistory.push(event);
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }

        // Broadcast via SSE
        if (event.userId) {
            sseHub.sendEvent(event.userId, event.type, {
                type: event.type,
                data: event.data,
                timestamp
            });

            // Also send as generic 'message' for backward compatibility
            sseHub.sendEvent(event.userId, 'message', {
                type: event.type,
                data: event.data,
                timestamp
            });
        }

        // Log for observability (debug level to avoid noise)
        logger.debug(`[EVENT] ${event.type}`, {
            userId: event.userId,
            eventType: event.type,
            dataKeys: Object.keys(event.data)
        });
    }

    /**
     * Emit to all connected users
     */
    broadcast(event: Omit<PlatformEvent, 'userId'>): void {
        const timestamp = event.data.timestamp || new Date().toISOString();
        event.data.timestamp = timestamp;

        sseHub.broadcastEvent(event.type, {
            type: event.type,
            data: event.data,
            timestamp
        });
    }

    /**
     * Helper: Emit job queued event
     */
    emitJobQueued(userId: string, jobId: string, jobType: string, metadata?: Record<string, any>): void {
        this.emit({
            type: PlatformEventType.JOB_QUEUED,
            userId,
            data: {
                jobId,
                jobType,
                message: `Job queued: ${jobType}`,
                timestamp: new Date().toISOString(),
                metadata
            }
        });
    }

    /**
     * Helper: Emit job started event  
     */
    emitJobStarted(userId: string, jobId: string, jobType: string): void {
        this.emit({
            type: PlatformEventType.JOB_STARTED,
            userId,
            data: {
                jobId,
                jobType,
                message: `Job started: ${jobType}`,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Helper: Emit agent invoked event
     */
    emitAgentInvoked(userId: string, agent: string, jobId?: string): void {
        this.emit({
            type: PlatformEventType.AGENT_INVOKED,
            userId,
            data: {
                agent,
                jobId,
                message: `Agent invoked: ${agent}`,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Helper: Emit anomaly detected event with explanation
     */
    emitAnomalyDetected(
        userId: string,
        detectionId: string,
        anomalyType: string,
        amount: number,
        confidence: number,
        explanation: string,
        rootCause?: string
    ): void {
        this.emit({
            type: PlatformEventType.ANOMALY_DETECTED,
            userId,
            data: {
                detectionId,
                anomalyType,
                amount,
                currency: 'USD',
                confidence,
                explanation,
                rootCause,
                recoveryProbability: confidence * 0.85, // Conservative estimate
                message: `Detected: ${anomalyType} ($${amount.toFixed(2)})`,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Helper: Emit claim filed event
     */
    emitClaimFiled(userId: string, claimId: string, amount: number): void {
        this.emit({
            type: PlatformEventType.CLAIM_FILED,
            userId,
            data: {
                claimId,
                amount,
                currency: 'USD',
                message: `Claim filed: $${amount.toFixed(2)}`,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Helper: Emit payout received event
     */
    emitPayoutReceived(userId: string, claimId: string, amount: number): void {
        this.emit({
            type: PlatformEventType.PAYOUT_RECEIVED,
            userId,
            data: {
                claimId,
                amount,
                currency: 'USD',
                financialImpact: amount,
                message: `Payout received: $${amount.toFixed(2)}`,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Get recent events for a user
     */
    getRecentEvents(userId: string, limit: number = 50): PlatformEvent[] {
        return this.eventHistory
            .filter(e => e.userId === userId)
            .slice(-limit);
    }

    /**
     * Get event counts by type
     */
    getEventStats(): Record<string, number> {
        const stats: Record<string, number> = {};
        this.eventHistory.forEach(e => {
            stats[e.type] = (stats[e.type] || 0) + 1;
        });
        return stats;
    }
}

// Export singleton
export const platformEvents = new PlatformEventEmitter();
export default platformEvents;
