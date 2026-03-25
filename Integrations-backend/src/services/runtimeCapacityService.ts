type WorkerRuntimeSnapshot = {
  workerName: string;
  isRunning: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  skippedRuns: number;
  processed: number;
  succeeded: number;
  failed: number;
  lastError: string | null;
  backlogDepth: number | null;
  oldestItemAgeMs: number | null;
  metadata: Record<string, any>;
};

type CircuitBreakerSnapshot = {
  breakerName: string;
  state: 'closed' | 'open';
  reason: string | null;
  updatedAt: string;
};

type RuntimeAlert = {
  code: string;
  severity: 'info' | 'warn' | 'critical';
  message: string;
};

class RuntimeCapacityService {
  private readonly workerSnapshots = new Map<string, WorkerRuntimeSnapshot>();
  private readonly circuitBreakers = new Map<string, CircuitBreakerSnapshot>();
  private readonly counters = new Map<string, number>();
  private readonly queueDepthThresholds = {
    filing: Number(process.env.ALERT_FILING_BACKLOG_DEPTH || '120'),
    parsing: Number(process.env.ALERT_PARSING_BACKLOG_DEPTH || '400'),
    matching: Number(process.env.ALERT_MATCHING_BACKLOG_DEPTH || '400'),
    recoveries: Number(process.env.ALERT_RECOVERY_BACKLOG_DEPTH || '120'),
    billing: Number(process.env.ALERT_BILLING_BACKLOG_DEPTH || '120')
  };
  private redisHealth: { available: boolean; reason: string | null; updatedAt: string } = {
    available: false,
    reason: 'unknown',
    updatedAt: new Date(0).toISOString()
  };

  private ensureWorker(workerName: string): WorkerRuntimeSnapshot {
    const existing = this.workerSnapshots.get(workerName);
    if (existing) return existing;

    const created: WorkerRuntimeSnapshot = {
      workerName,
      isRunning: false,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastDurationMs: null,
      skippedRuns: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      lastError: null,
      backlogDepth: null,
      oldestItemAgeMs: null,
      metadata: {}
    };
    this.workerSnapshots.set(workerName, created);
    return created;
  }

  recordWorkerStart(workerName: string, metadata?: Record<string, any>): void {
    const worker = this.ensureWorker(workerName);
    worker.isRunning = true;
    worker.lastStartedAt = new Date().toISOString();
    if (metadata) {
      worker.metadata = { ...worker.metadata, ...metadata };
    }
  }

  recordWorkerEnd(
    workerName: string,
    outcome: {
      processed?: number;
      succeeded?: number;
      failed?: number;
      lastError?: string | null;
      backlogDepth?: number | null;
      oldestItemAgeMs?: number | null;
      metadata?: Record<string, any>;
    } = {}
  ): void {
    const worker = this.ensureWorker(workerName);
    worker.isRunning = false;
    worker.lastFinishedAt = new Date().toISOString();
    worker.lastDurationMs = worker.lastStartedAt
      ? Math.max(0, Date.now() - new Date(worker.lastStartedAt).getTime())
      : null;
    worker.processed = outcome.processed ?? worker.processed;
    worker.succeeded = outcome.succeeded ?? worker.succeeded;
    worker.failed = outcome.failed ?? worker.failed;
    worker.lastError = outcome.lastError ?? null;
    worker.backlogDepth = outcome.backlogDepth ?? worker.backlogDepth;
    worker.oldestItemAgeMs = outcome.oldestItemAgeMs ?? worker.oldestItemAgeMs;
    if (outcome.metadata) {
      worker.metadata = { ...worker.metadata, ...outcome.metadata };
    }
  }

  recordWorkerSkip(workerName: string, reason: string): void {
    const worker = this.ensureWorker(workerName);
    worker.skippedRuns += 1;
    worker.lastError = reason;
    worker.metadata = { ...worker.metadata, lastSkipReason: reason };
  }

  updateBacklog(workerName: string, backlogDepth: number, oldestItemAgeMs: number | null, metadata?: Record<string, any>): void {
    const worker = this.ensureWorker(workerName);
    worker.backlogDepth = backlogDepth;
    worker.oldestItemAgeMs = oldestItemAgeMs;
    if (metadata) {
      worker.metadata = { ...worker.metadata, ...metadata };
    }
  }

  setCircuitBreaker(breakerName: string, state: 'closed' | 'open', reason: string | null): void {
    this.circuitBreakers.set(breakerName, {
      breakerName,
      state,
      reason,
      updatedAt: new Date().toISOString()
    });
  }

  updateRedisHealth(available: boolean, reason: string | null): void {
    this.redisHealth = {
      available,
      reason,
      updatedAt: new Date().toISOString()
    };
  }

  incrementCounter(counterName: string, amount: number = 1): void {
    this.counters.set(counterName, (this.counters.get(counterName) || 0) + amount);
  }

  getWorkerSnapshot(workerName: string): WorkerRuntimeSnapshot | null {
    return this.workerSnapshots.get(workerName) || null;
  }

  getCounter(counterName: string): number {
    return this.counters.get(counterName) || 0;
  }

  getAlerts(): RuntimeAlert[] {
    const alerts: RuntimeAlert[] = [];

    if (!this.redisHealth.available) {
      alerts.push({
        code: 'redis_unavailable',
        severity: 'critical',
        message: this.redisHealth.reason || 'Redis is unavailable'
      });
    }

    for (const worker of this.workerSnapshots.values()) {
      if ((worker.oldestItemAgeMs || 0) > 15 * 60 * 1000) {
        alerts.push({
          code: `${worker.workerName}_age_slo_exceeded`,
          severity: 'warn',
          message: `${worker.workerName} oldest item age exceeded 15 minutes`
        });
      }

      const backlogDepth = worker.backlogDepth || 0;
      const threshold = worker.workerName.startsWith('document-parsing')
        ? this.queueDepthThresholds.parsing
        : worker.workerName.startsWith('evidence-matching')
          ? this.queueDepthThresholds.matching
          : worker.workerName.startsWith('recoveries')
            ? this.queueDepthThresholds.recoveries
            : worker.workerName.startsWith('billing')
              ? this.queueDepthThresholds.billing
              : worker.workerName.startsWith('refund-filing')
                ? this.queueDepthThresholds.filing
                : null;

      if (threshold !== null && backlogDepth >= threshold) {
        alerts.push({
          code: `${worker.workerName}_backlog_depth_exceeded`,
          severity: 'warn',
          message: `${worker.workerName} backlog depth exceeded ${threshold}`
        });
      }

      if (worker.skippedRuns >= 3) {
        alerts.push({
          code: `${worker.workerName}_skipped_runs`,
          severity: 'warn',
          message: `${worker.workerName} skipped ${worker.skippedRuns} runs`
        });
      }
    }

    for (const breaker of this.circuitBreakers.values()) {
      if (breaker.state === 'open') {
        alerts.push({
          code: `${breaker.breakerName}_open`,
          severity: 'critical',
          message: breaker.reason || `${breaker.breakerName} circuit breaker is open`
        });
      }
    }

    if ((this.counters.get('ambiguous_recoveries') || 0) > 0) {
      alerts.push({
        code: 'ambiguous_recoveries_present',
        severity: 'warn',
        message: `${this.counters.get('ambiguous_recoveries')} ambiguous recoveries are quarantined`
      });
    }

    if ((this.counters.get('duplicate_recovery_conflicts') || 0) > 0) {
      alerts.push({
        code: 'duplicate_recovery_conflicts',
        severity: 'critical',
        message: `${this.counters.get('duplicate_recovery_conflicts')} duplicate recovery conflicts were observed`
      });
    }

    return alerts;
  }

  getSnapshot() {
    return {
      workers: Array.from(this.workerSnapshots.values()),
      circuitBreakers: Array.from(this.circuitBreakers.values()),
      redis: this.redisHealth,
      counters: Object.fromEntries(this.counters.entries()),
      alerts: this.getAlerts()
    };
  }
}

const runtimeCapacityService = new RuntimeCapacityService();

export default runtimeCapacityService;
