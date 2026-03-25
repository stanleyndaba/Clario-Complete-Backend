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

class RuntimeCapacityService {
  private readonly workerSnapshots = new Map<string, WorkerRuntimeSnapshot>();
  private readonly circuitBreakers = new Map<string, CircuitBreakerSnapshot>();
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

  getSnapshot() {
    return {
      workers: Array.from(this.workerSnapshots.values()),
      circuitBreakers: Array.from(this.circuitBreakers.values()),
      redis: this.redisHealth
    };
  }
}

const runtimeCapacityService = new RuntimeCapacityService();

export default runtimeCapacityService;
