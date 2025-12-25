/**
 * Sync Fingerprint Utility
 * 
 * Creates unique fingerprints for sync operations to enable:
 * - Idempotent job detection (prevent duplicate syncs)
 * - Record hashing for deduplication
 * - Dataset versioning
 */

import crypto from 'crypto';
import logger from './logger';

/**
 * Create a hash from any object or string
 */
export function createHash(data: any): string {
    const str = typeof data === 'string' ? data : JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

/**
 * Create a sync fingerprint for idempotent job detection
 * Same user + same date range + within time window = same fingerprint
 */
export function createSyncFingerprint(
    userId: string,
    startDate: Date,
    endDate: Date,
    timeWindowMinutes: number = 5
): string {
    // Round to time window for idempotency
    const now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / (timeWindowMinutes * 60 * 1000)) * (timeWindowMinutes * 60 * 1000));

    const data = {
        userId,
        startDate: startDate.toISOString().split('T')[0], // Date only
        endDate: endDate.toISOString().split('T')[0],
        window: windowStart.toISOString()
    };

    return createHash(data);
}

/**
 * Create a record hash for deduplication
 * Same record content = same hash
 */
export function createRecordHash(record: any, primaryKeyFields: string[]): string {
    // Sort keys for consistent hashing
    const sortedRecord: any = {};
    const keys = Object.keys(record).sort();

    for (const key of keys) {
        // Skip metadata fields that change between syncs
        if (key.startsWith('_') || key === 'synced_at' || key === 'updated_at') {
            continue;
        }
        sortedRecord[key] = record[key];
    }

    return createHash(sortedRecord);
}

/**
 * Create a unique key for a record based on primary key fields
 */
export function createRecordKey(record: any, primaryKeyFields: string[]): string {
    const keyParts = primaryKeyFields.map(field => {
        const value = record[field];
        return value !== undefined && value !== null ? String(value) : '';
    });
    return keyParts.join(':');
}

/**
 * Sync coverage tracking
 */
export interface SyncCoverage {
    entity: string;
    synced: number;
    expected?: number;
    pending?: number;
    complete: boolean;
    details?: string;
}

export interface SyncCoverageReport {
    syncId: string;
    userId: string;
    timestamp: string;
    coverage: SyncCoverage[];
    overallComplete: boolean;
    summary: string;
}

/**
 * Required entities for a complete sync
 */
export const REQUIRED_ENTITIES = [
    'orders',
    'shipments',
    'returns',
    'settlements',
    'inventory',
    'fees',
    'claims'
] as const;

export type RequiredEntity = typeof REQUIRED_ENTITIES[number];

/**
 * Create a coverage report from sync results
 */
export function createCoverageReport(
    syncId: string,
    userId: string,
    results: Record<string, { synced: number; expected?: number; pending?: number; error?: string }>
): SyncCoverageReport {
    const coverage: SyncCoverage[] = [];
    let allComplete = true;

    for (const entity of REQUIRED_ENTITIES) {
        const result = results[entity] || { synced: 0, expected: undefined, pending: undefined, error: undefined };
        const isComplete = !result.pending && !result.error && result.synced >= 0;

        if (!isComplete) {
            allComplete = false;
        }

        coverage.push({
            entity,
            synced: result.synced || 0,
            expected: result.expected,
            pending: result.pending,
            complete: isComplete,
            details: result.error
        });
    }

    // Generate summary
    const completedCount = coverage.filter(c => c.complete).length;
    const totalSynced = coverage.reduce((sum, c) => sum + c.synced, 0);
    const summary = `${completedCount}/${REQUIRED_ENTITIES.length} entities complete, ${totalSynced} records synced`;

    return {
        syncId,
        userId,
        timestamp: new Date().toISOString(),
        coverage,
        overallComplete: allComplete,
        summary
    };
}

/**
 * Format coverage report for logging
 */
export function formatCoverageLog(report: SyncCoverageReport): string {
    const lines = ['📊 Sync Coverage Report'];

    for (const item of report.coverage) {
        const status = item.complete ? '✓' : (item.pending ? '⏳' : '⚠');
        const count = item.expected
            ? `${item.synced}/${item.expected}`
            : `${item.synced}`;
        const percent = item.expected
            ? ` (${Math.round((item.synced / item.expected) * 100)}%)`
            : '';
        const pending = item.pending ? ` - ${item.pending} pending` : '';

        lines.push(`├─ ${item.entity}: ${count}${percent} ${status}${pending}`);
    }

    lines.push(`└─ Overall: ${report.summary}`);

    return lines.join('\n');
}

/**
 * Sync snapshot for versioning
 */
export interface SyncSnapshot {
    syncId: string;
    userId: string;
    snapshotDate: string;
    metrics: {
        ordersCount: number;
        shipmentsCount: number;
        returnsCount: number;
        settlementsCount: number;
        inventoryCount: number;
        feesCount: number;
        claimsCount: number;
        totalRecoverableValue: number;
    };
    coverage: SyncCoverage[];
    createdAt: string;
}

/**
 * Create a snapshot from sync results
 */
export function createSyncSnapshot(
    syncId: string,
    userId: string,
    metrics: SyncSnapshot['metrics'],
    coverage: SyncCoverage[]
): SyncSnapshot {
    return {
        syncId,
        userId,
        snapshotDate: new Date().toISOString().split('T')[0],
        metrics,
        coverage,
        createdAt: new Date().toISOString()
    };
}

/**
 * Compare two snapshots to detect changes
 */
export function compareSnapshots(
    current: SyncSnapshot,
    previous: SyncSnapshot | null
): {
    hasChanges: boolean;
    changes: Array<{ metric: string; current: number; previous: number; change: number; changePercent: number }>;
} {
    if (!previous) {
        return { hasChanges: false, changes: [] };
    }

    const changes: Array<{ metric: string; current: number; previous: number; change: number; changePercent: number }> = [];

    for (const key of Object.keys(current.metrics) as (keyof SyncSnapshot['metrics'])[]) {
        const curr = current.metrics[key];
        const prev = previous.metrics[key];

        if (curr !== prev) {
            const change = curr - prev;
            const changePercent = prev > 0 ? Math.round((change / prev) * 100) : 0;

            changes.push({
                metric: key,
                current: curr,
                previous: prev,
                change,
                changePercent
            });
        }
    }

    return {
        hasChanges: changes.length > 0,
        changes
    };
}

export default {
    createHash,
    createSyncFingerprint,
    createRecordHash,
    createRecordKey,
    createCoverageReport,
    formatCoverageLog,
    createSyncSnapshot,
    compareSnapshots,
    REQUIRED_ENTITIES
};
