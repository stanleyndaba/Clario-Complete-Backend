/**
 * Metrics Service
 * 
 * Provides system observability and agent performance tracking:
 * - Agent runtime, success rate, error rate
 * - Recovery yield and confidence metrics
 * - System health monitoring
 * - Queue performance tracking
 */

import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import cacheService from './cacheService';
import { AgentType } from './agentEventLogger';

// Agent performance metrics
export interface AgentMetrics {
    agent: string;
    totalExecutions: number;
    successCount: number;
    failureCount: number;
    successRate: number;           // 0-100%
    avgRuntimeMs: number;
    p95RuntimeMs: number;
    avgConfidence: number;
    totalRecoveryAmount: number;
    avgRecoveryPerRun: number;
    lastExecutedAt: string | null;
}

// System health metrics
export interface SystemHealthMetrics {
    queueDepth: number;
    activeWorkers: number;
    avgJobLatencyMs: number;
    jobsProcessedLast24h: number;
    jobsFailedLast24h: number;
    failureRateLast24h: number;
    cacheHitRate: number;
    sseConnectionCount: number;
    timestamp: string;
}

// Runtime tracking for in-progress operations
interface RuntimeTracker {
    startTime: number;
    agent: string;
    userId: string;
    operation: string;
}

class MetricsService {
    private activeOperations: Map<string, RuntimeTracker> = new Map();
    private runtimeSamples: Map<string, number[]> = new Map();
    private readonly MAX_SAMPLES = 100;
    private readonly CACHE_TTL = 60; // 1 minute

    /**
     * Start tracking an operation
     */
    startOperation(operationId: string, agent: string, userId: string, operation: string): void {
        this.activeOperations.set(operationId, {
            startTime: Date.now(),
            agent,
            userId,
            operation
        });
    }

    /**
     * End tracking and record metrics
     */
    async endOperation(
        operationId: string,
        success: boolean,
        metadata?: { recoveryAmount?: number; confidence?: number }
    ): Promise<number> {
        const tracker = this.activeOperations.get(operationId);
        if (!tracker) {
            logger.warn('[METRICS] Operation not found', { operationId });
            return 0;
        }

        const duration = Date.now() - tracker.startTime;
        this.activeOperations.delete(operationId);

        // Store runtime sample
        const samples = this.runtimeSamples.get(tracker.agent) || [];
        samples.push(duration);
        if (samples.length > this.MAX_SAMPLES) {
            samples.shift();
        }
        this.runtimeSamples.set(tracker.agent, samples);

        // Log to database for historical analysis
        try {
            await supabaseAdmin
                .from('agent_metrics')
                .insert({
                    agent: tracker.agent,
                    operation: tracker.operation,
                    user_id: tracker.userId,
                    success,
                    runtime_ms: duration,
                    recovery_amount: metadata?.recoveryAmount || 0,
                    confidence: metadata?.confidence || 0,
                    created_at: new Date().toISOString()
                });
        } catch (error: any) {
            logger.debug('[METRICS] Failed to store metrics (table may not exist)', {
                error: error.message
            });
        }

        logger.debug('[METRICS] Operation completed', {
            agent: tracker.agent,
            operation: tracker.operation,
            duration,
            success
        });

        return duration;
    }

    /**
     * Get metrics for a specific agent
     */
    async getAgentMetrics(agent: string, days: number = 30): Promise<AgentMetrics> {
        const cacheKey = `metrics:agent:${agent}:${days}`;
        const cached = await cacheService.get<AgentMetrics>(cacheKey);
        if (cached) return cached;

        try {
            const since = new Date();
            since.setDate(since.getDate() - days);

            const { data: events } = await supabaseAdmin
                .from('agent_events')
                .select('success, metadata, created_at')
                .eq('agent', agent)
                .gte('created_at', since.toISOString());

            const metrics: AgentMetrics = {
                agent,
                totalExecutions: 0,
                successCount: 0,
                failureCount: 0,
                successRate: 0,
                avgRuntimeMs: 0,
                p95RuntimeMs: 0,
                avgConfidence: 0,
                totalRecoveryAmount: 0,
                avgRecoveryPerRun: 0,
                lastExecutedAt: null
            };

            if (!events || events.length === 0) {
                return metrics;
            }

            metrics.totalExecutions = events.length;

            let totalRuntime = 0;
            let totalConfidence = 0;
            let confidenceCount = 0;
            const runtimes: number[] = [];

            for (const event of events) {
                if (event.success) {
                    metrics.successCount++;
                } else {
                    metrics.failureCount++;
                }

                const meta = event.metadata as any;
                if (meta?.duration) {
                    totalRuntime += meta.duration;
                    runtimes.push(meta.duration);
                }
                if (meta?.confidence) {
                    totalConfidence += meta.confidence;
                    confidenceCount++;
                }
                if (meta?.amount) {
                    metrics.totalRecoveryAmount += meta.amount;
                }
            }

            metrics.successRate = (metrics.successCount / metrics.totalExecutions) * 100;
            metrics.avgRuntimeMs = runtimes.length > 0 ? totalRuntime / runtimes.length : 0;
            metrics.avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;
            metrics.avgRecoveryPerRun = metrics.totalExecutions > 0
                ? metrics.totalRecoveryAmount / metrics.totalExecutions
                : 0;

            // Calculate P95 runtime
            if (runtimes.length > 0) {
                runtimes.sort((a, b) => a - b);
                const p95Index = Math.floor(runtimes.length * 0.95);
                metrics.p95RuntimeMs = runtimes[p95Index] || runtimes[runtimes.length - 1];
            }

            metrics.lastExecutedAt = events[events.length - 1]?.created_at || null;

            await cacheService.set(cacheKey, metrics, this.CACHE_TTL);
            return metrics;

        } catch (error: any) {
            logger.error('[METRICS] Failed to get agent metrics', { agent, error: error.message });
            return {
                agent,
                totalExecutions: 0,
                successCount: 0,
                failureCount: 0,
                successRate: 0,
                avgRuntimeMs: 0,
                p95RuntimeMs: 0,
                avgConfidence: 0,
                totalRecoveryAmount: 0,
                avgRecoveryPerRun: 0,
                lastExecutedAt: null
            };
        }
    }

    /**
     * Get metrics for all agents
     */
    async getAllAgentMetrics(days: number = 30): Promise<AgentMetrics[]> {
        const agents = Object.values(AgentType);
        const metrics = await Promise.all(
            agents.map(agent => this.getAgentMetrics(agent, days))
        );
        return metrics.filter(m => m.totalExecutions > 0);
    }

    /**
     * Get system health metrics
     */
    async getSystemHealth(): Promise<SystemHealthMetrics> {
        const cacheKey = 'metrics:system:health';
        const cached = await cacheService.get<SystemHealthMetrics>(cacheKey);
        if (cached) return cached;

        try {
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            // Get queue metrics
            let queueDepth = 0;
            let activeWorkers = 0;
            try {
                const ingestionQueue = await import('../queues/ingestionQueue');
                const queueMetrics = await ingestionQueue.getQueueMetrics();
                queueDepth = queueMetrics.waiting + queueMetrics.delayed;
                activeWorkers = queueMetrics.active;
            } catch {
                // Queue may not be available
            }

            // Get job stats from last 24h
            const { count: processedCount } = await supabaseAdmin
                .from('agent_events')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', yesterday.toISOString());

            const { count: failedCount } = await supabaseAdmin
                .from('agent_events')
                .select('*', { count: 'exact', head: true })
                .eq('success', false)
                .gte('created_at', yesterday.toISOString());

            // Get SSE connection count
            let sseConnectionCount = 0;
            try {
                const sseHub = await import('../utils/sseHub');
                sseConnectionCount = sseHub.default.getConnectedUsers().length;
            } catch {
                // SSE hub may not be available
            }

            const health: SystemHealthMetrics = {
                queueDepth,
                activeWorkers,
                avgJobLatencyMs: 0, // Would need actual tracking
                jobsProcessedLast24h: processedCount || 0,
                jobsFailedLast24h: failedCount || 0,
                failureRateLast24h: processedCount
                    ? ((failedCount || 0) / processedCount) * 100
                    : 0,
                cacheHitRate: 0, // Would need actual tracking
                sseConnectionCount,
                timestamp: now.toISOString()
            };

            await cacheService.set(cacheKey, health, 30); // 30 second cache
            return health;

        } catch (error: any) {
            logger.error('[METRICS] Failed to get system health', { error: error.message });
            return {
                queueDepth: 0,
                activeWorkers: 0,
                avgJobLatencyMs: 0,
                jobsProcessedLast24h: 0,
                jobsFailedLast24h: 0,
                failureRateLast24h: 0,
                cacheHitRate: 0,
                sseConnectionCount: 0,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Get in-memory runtime stats (real-time)
     */
    getRuntimeStats(agent: string): { avg: number; p95: number; samples: number } {
        const samples = this.runtimeSamples.get(agent) || [];
        if (samples.length === 0) {
            return { avg: 0, p95: 0, samples: 0 };
        }

        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        const sorted = [...samples].sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        const p95 = sorted[p95Index] || sorted[sorted.length - 1];

        return { avg, p95, samples: samples.length };
    }

    /**
     * Get active operation count
     */
    getActiveOperationCount(): number {
        return this.activeOperations.size;
    }
}

// Export singleton
export const metricsService = new MetricsService();
export default metricsService;
