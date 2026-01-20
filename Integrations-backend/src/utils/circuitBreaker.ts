/**
 * Circuit Breaker Implementation
 * 
 * Protects external API calls with automatic failover:
 * - CLOSED: Normal operation
 * - OPEN: Fail fast, return fallback
 * - HALF_OPEN: Test recovery with limited requests
 */

import logger from '../utils/logger';

export enum CircuitState {
    CLOSED = 'CLOSED',     // Normal operation
    OPEN = 'OPEN',         // Failing fast
    HALF_OPEN = 'HALF_OPEN' // Testing recovery
}

interface CircuitBreakerOptions {
    name: string;
    failureThreshold: number;      // Failures before opening
    successThreshold: number;      // Successes to close from half-open
    timeout: number;               // Time in OPEN before trying HALF_OPEN (ms)
    fallback?: () => any;          // Fallback response when open
}

interface CircuitStats {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number | null;
    lastSuccessTime: number | null;
    totalRequests: number;
    totalFailures: number;
}

class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failures: number = 0;
    private successes: number = 0;
    private lastFailureTime: number | null = null;
    private lastSuccessTime: number | null = null;
    private totalRequests: number = 0;
    private totalFailures: number = 0;
    private readonly options: CircuitBreakerOptions;

    constructor(options: CircuitBreakerOptions) {
        this.options = {
            failureThreshold: 5,
            successThreshold: 3,
            timeout: 30000,
            ...options
        };
    }

    /**
     * Execute a function with circuit breaker protection
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        this.totalRequests++;

        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === CircuitState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.state = CircuitState.HALF_OPEN;
                logger.info(`[CIRCUIT:${this.options.name}] Transitioning to HALF_OPEN`);
            } else {
                // Fail fast
                logger.debug(`[CIRCUIT:${this.options.name}] Circuit OPEN, failing fast`);
                if (this.options.fallback) {
                    return this.options.fallback();
                }
                throw new Error(`Circuit breaker ${this.options.name} is OPEN`);
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failures = 0;
        this.successes++;
        this.lastSuccessTime = Date.now();

        if (this.state === CircuitState.HALF_OPEN) {
            if (this.successes >= this.options.successThreshold) {
                this.state = CircuitState.CLOSED;
                this.successes = 0;
                logger.info(`[CIRCUIT:${this.options.name}] Circuit CLOSED after recovery`);
            }
        }
    }

    private onFailure(): void {
        this.failures++;
        this.totalFailures++;
        this.lastFailureTime = Date.now();

        if (this.state === CircuitState.HALF_OPEN) {
            // Immediately open on failure during test
            this.state = CircuitState.OPEN;
            logger.warn(`[CIRCUIT:${this.options.name}] Circuit OPEN after HALF_OPEN failure`);
        } else if (this.failures >= this.options.failureThreshold) {
            this.state = CircuitState.OPEN;
            logger.warn(`[CIRCUIT:${this.options.name}] Circuit OPEN after ${this.failures} failures`);
        }
    }

    private shouldAttemptReset(): boolean {
        if (!this.lastFailureTime) return true;
        return Date.now() - this.lastFailureTime >= this.options.timeout;
    }

    /**
     * Get circuit stats
     */
    getStats(): CircuitStats {
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailureTime: this.lastFailureTime,
            lastSuccessTime: this.lastSuccessTime,
            totalRequests: this.totalRequests,
            totalFailures: this.totalFailures
        };
    }

    /**
     * Force circuit state (for testing/admin)
     */
    forceState(state: CircuitState): void {
        this.state = state;
        logger.warn(`[CIRCUIT:${this.options.name}] Force set to ${state}`);
    }
}

// Circuit breaker registry
const circuits: Map<string, CircuitBreaker> = new Map();

/**
 * Get or create a circuit breaker
 */
export function getCircuitBreaker(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!circuits.has(name)) {
        circuits.set(name, new CircuitBreaker({ name, ...options } as CircuitBreakerOptions));
    }
    return circuits.get(name)!;
}

/**
 * Get all circuit stats
 */
export function getAllCircuitStats(): Record<string, CircuitStats> {
    const stats: Record<string, CircuitStats> = {};
    circuits.forEach((breaker, name) => {
        stats[name] = breaker.getStats();
    });
    return stats;
}

// Pre-configured circuit breakers for common external services
export const amazonApiCircuit = getCircuitBreaker('amazon-api', {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 60000
});

export const pythonMlCircuit = getCircuitBreaker('python-ml', {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000
});

export const stripeCircuit = getCircuitBreaker('stripe', {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 45000
});

export default { getCircuitBreaker, getAllCircuitStats, CircuitState };
