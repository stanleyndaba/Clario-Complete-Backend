/**
 * System Health Scorer
 * 
 * Calculates overall system health score (0-100) and provides
 * actionable insights for degradation modes.
 */

import logger from './logger';
import { getAllCircuitStats, CircuitState } from './circuitBreaker';
import cacheService from '../services/cacheService';
import { metricsService } from '../services/metricsService';

export interface SystemHealth {
    score: number;                        // 0-100
    status: 'healthy' | 'degraded' | 'critical' | 'down';
    components: {
        queue: { score: number; status: string; details: string };
        cache: { score: number; status: string; details: string };
        circuits: { score: number; status: string; details: string };
        agents: { score: number; status: string; details: string };
        api: { score: number; status: string; details: string };
    };
    degradationMode: 'normal' | 'read_only' | 'limited' | 'emergency';
    recommendations: string[];
    timestamp: string;
}

class SystemHealthScorer {
    private lastHealthCheck: SystemHealth | null = null;
    private readonly CACHE_TTL = 10; // 10 seconds

    /**
     * Calculate comprehensive system health
     */
    async calculateHealth(): Promise<SystemHealth> {
        const cacheKey = 'health:system:score';

        // Check cache first
        const cached = await cacheService.get<SystemHealth>(cacheKey);
        if (cached) return cached;

        const components: SystemHealth['components'] = {
            queue: await this.checkQueueHealth(),
            cache: await this.checkCacheHealth(),
            circuits: this.checkCircuitHealth(),
            agents: await this.checkAgentHealth(),
            api: await this.checkApiHealth()
        };

        // Calculate weighted score
        const weights = { queue: 0.25, cache: 0.15, circuits: 0.20, agents: 0.25, api: 0.15 };
        let totalScore = 0;
        for (const [component, weight] of Object.entries(weights)) {
            totalScore += (components[component as keyof typeof components].score * weight);
        }

        // Determine overall status
        let status: SystemHealth['status'];
        if (totalScore >= 90) status = 'healthy';
        else if (totalScore >= 70) status = 'degraded';
        else if (totalScore >= 40) status = 'critical';
        else status = 'down';

        // Determine degradation mode
        let degradationMode: SystemHealth['degradationMode'];
        if (totalScore >= 80) degradationMode = 'normal';
        else if (totalScore >= 60) degradationMode = 'limited';
        else if (totalScore >= 30) degradationMode = 'read_only';
        else degradationMode = 'emergency';

        // Generate recommendations
        const recommendations = this.generateRecommendations(components);

        const health: SystemHealth = {
            score: Math.round(totalScore),
            status,
            components,
            degradationMode,
            recommendations,
            timestamp: new Date().toISOString()
        };

        this.lastHealthCheck = health;
        await cacheService.set(cacheKey, health, this.CACHE_TTL);

        // Log if degraded
        if (status !== 'healthy') {
            logger.warn('[HEALTH] System degraded', {
                score: health.score,
                status,
                degradationMode
            });
        }

        return health;
    }

    private async checkQueueHealth(): Promise<{ score: number; status: string; details: string }> {
        try {
            const ingestionQueue = await import('../queues/ingestionQueue');
            const metrics = await ingestionQueue.getQueueMetrics();

            const { waiting, active, failed, delayed } = metrics;
            const totalPending = waiting + delayed;

            let score = 100;
            let status = 'healthy';

            // Penalize for queue depth
            if (totalPending > 100) { score -= 30; status = 'overloaded'; }
            else if (totalPending > 50) { score -= 15; status = 'busy'; }
            else if (totalPending > 20) { score -= 5; }

            // Penalize for failed jobs
            if (failed > 10) { score -= 30; status = 'failing'; }
            else if (failed > 5) { score -= 15; status = 'some_failures'; }
            else if (failed > 0) { score -= 5; }

            return {
                score: Math.max(0, score),
                status,
                details: `Waiting: ${waiting}, Active: ${active}, Failed: ${failed}`
            };
        } catch {
            return { score: 50, status: 'unknown', details: 'Queue unavailable' };
        }
    }

    private async checkCacheHealth(): Promise<{ score: number; status: string; details: string }> {
        try {
            // Test cache with a simple operation
            const testKey = 'health:test';
            await cacheService.set(testKey, 'ok', 5);
            const result = await cacheService.get(testKey);

            if (result === 'ok') {
                return { score: 100, status: 'connected', details: 'Redis responding' };
            }
            return { score: 50, status: 'degraded', details: 'Cache inconsistent' };
        } catch {
            return { score: 0, status: 'down', details: 'Redis unavailable' };
        }
    }

    private checkCircuitHealth(): { score: number; status: string; details: string } {
        const stats = getAllCircuitStats();
        const circuits = Object.entries(stats);

        if (circuits.length === 0) {
            return { score: 100, status: 'no_circuits', details: 'No circuits registered' };
        }

        let openCount = 0;
        let halfOpenCount = 0;

        for (const [, stat] of circuits) {
            if (stat.state === CircuitState.OPEN) openCount++;
            if (stat.state === CircuitState.HALF_OPEN) halfOpenCount++;
        }

        const totalCircuits = circuits.length;
        const healthyCircuits = totalCircuits - openCount - halfOpenCount;
        const score = Math.round((healthyCircuits / totalCircuits) * 100);

        let status = 'healthy';
        if (openCount > 0) status = 'circuits_open';
        else if (halfOpenCount > 0) status = 'recovering';

        return {
            score,
            status,
            details: `${healthyCircuits}/${totalCircuits} healthy, ${openCount} open`
        };
    }

    private async checkAgentHealth(): Promise<{ score: number; status: string; details: string }> {
        try {
            const systemMetrics = await metricsService.getSystemHealth();
            const failureRate = systemMetrics.failureRateLast24h;

            let score = 100;
            if (failureRate > 20) score = 30;
            else if (failureRate > 10) score = 60;
            else if (failureRate > 5) score = 80;
            else if (failureRate > 1) score = 90;

            return {
                score,
                status: failureRate > 10 ? 'high_failure_rate' : 'operational',
                details: `${failureRate.toFixed(1)}% failure rate (24h)`
            };
        } catch {
            return { score: 70, status: 'unknown', details: 'Metrics unavailable' };
        }
    }

    private async checkApiHealth(): Promise<{ score: number; status: string; details: string }> {
        // Simple health check - in production would ping endpoints
        const activeOps = metricsService.getActiveOperationCount();

        let score = 100;
        if (activeOps > 50) { score = 70; }
        else if (activeOps > 20) { score = 85; }

        return {
            score,
            status: 'operational',
            details: `${activeOps} active operations`
        };
    }

    private generateRecommendations(components: SystemHealth['components']): string[] {
        const recs: string[] = [];

        if (components.queue.score < 70) {
            recs.push('Increase worker concurrency or reduce job volume');
        }
        if (components.cache.score < 50) {
            recs.push('Check Redis connection and memory');
        }
        if (components.circuits.score < 80) {
            recs.push('External APIs experiencing issues - monitor circuit breakers');
        }
        if (components.agents.score < 70) {
            recs.push('High agent failure rate - review error logs');
        }

        return recs;
    }

    /**
     * Get last cached health without recalculating
     */
    getLastHealth(): SystemHealth | null {
        return this.lastHealthCheck;
    }

    /**
     * Check if system is in read-only mode
     */
    isReadOnlyMode(): boolean {
        return this.lastHealthCheck?.degradationMode === 'read_only' ||
            this.lastHealthCheck?.degradationMode === 'emergency';
    }
}

export const systemHealthScorer = new SystemHealthScorer();
export default systemHealthScorer;
