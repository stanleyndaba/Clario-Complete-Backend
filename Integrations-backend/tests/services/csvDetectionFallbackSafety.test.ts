import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const tables: Record<string, Row[]> = {
  csv_ingestion_runs: [],
  csv_upload_runs: [],
  detection_queue: [],
  detection_results: [],
  orders: [],
};

const mockTriggerDetectionPipeline: any = jest.fn();
const mockLegacyEnqueueDetectionJob: any = jest.fn();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const applyFilters = (rows: Row[], filters: Array<{ field: string; value: any }>) =>
  rows.filter((row) => filters.every(({ field, value }) => row[field] === value));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/services/enhancedDetectionService', () => ({
  EnhancedDetectionService: jest.fn().mockImplementation(() => ({
    triggerDetectionPipeline: mockTriggerDetectionPipeline,
  })),
}));

jest.mock('../../src/services/detectionService', () => ({
  __esModule: true,
  default: {
    enqueueDetectionJob: mockLegacyEnqueueDetectionJob,
  },
}));

jest.mock('../../src/database/supabaseClient', () => {
  const makeQuery = (table: string) => {
    const state: {
      filters: Array<{ field: string; value: any }>;
      order?: { field: string; ascending: boolean };
      limit?: number;
      selectOptions?: any;
      insertPayload?: Row[];
      updatePayload?: Row;
      upsertPayload?: Row[];
    } = {
      filters: [],
    };

    const api: any = {
      select: (_columns?: string, options?: any) => {
        state.selectOptions = options;
        return api;
      },
      eq: (field: string, value: any) => {
        state.filters.push({ field, value });
        return api;
      },
      order: (field: string, options?: { ascending?: boolean }) => {
        state.order = { field, ascending: options?.ascending !== false };
        return api;
      },
      limit: (count: number) => {
        state.limit = count;
        return api;
      },
      maybeSingle: async () => {
        let rows = applyFilters(tables[table] || [], state.filters);
        if (state.order) {
          rows = [...rows].sort((left, right) => {
            const leftValue = left[state.order!.field];
            const rightValue = right[state.order!.field];
            if (leftValue === rightValue) return 0;
            if (leftValue == null) return 1;
            if (rightValue == null) return -1;
            return state.order!.ascending
              ? String(leftValue).localeCompare(String(rightValue))
              : String(rightValue).localeCompare(String(leftValue));
          });
        }
        return { data: rows[0] ? clone(rows[0]) : null, error: null };
      },
      insert: (payload: any) => {
        state.insertPayload = Array.isArray(payload) ? payload : [payload];
        return api;
      },
      update: (payload: any) => {
        state.updatePayload = payload;
        return api;
      },
      upsert: (payload: any) => {
        state.upsertPayload = Array.isArray(payload) ? payload : [payload];
        return api;
      },
      then: (resolve: any, reject: any) => {
        try {
          const currentRows = tables[table] || [];

          if (state.updatePayload) {
            const targetRows = applyFilters(currentRows, state.filters);
            targetRows.forEach((row) => Object.assign(row, clone(state.updatePayload)));
            return Promise.resolve({ data: clone(targetRows), error: null }).then(resolve, reject);
          }

          if (state.insertPayload) {
            const rows = state.insertPayload.map((row) => clone(row));
            currentRows.push(...rows);
            tables[table] = currentRows;
            return Promise.resolve({ data: clone(rows), error: null }).then(resolve, reject);
          }

          if (state.upsertPayload) {
            const rows = state.upsertPayload.map((row) => clone(row));
            currentRows.push(...rows);
            tables[table] = currentRows;
            return Promise.resolve({ data: clone(rows), error: null }).then(resolve, reject);
          }

          let rows = applyFilters(currentRows, state.filters);
          if (state.order) {
            rows = [...rows].sort((left, right) => {
              const leftValue = left[state.order!.field];
              const rightValue = right[state.order!.field];
              if (leftValue === rightValue) return 0;
              if (leftValue == null) return 1;
              if (rightValue == null) return -1;
              return state.order!.ascending
                ? String(leftValue).localeCompare(String(rightValue))
                : String(rightValue).localeCompare(String(leftValue));
            });
          }
          if (typeof state.limit === 'number') {
            rows = rows.slice(0, state.limit);
          }

          if (state.selectOptions?.head) {
            return Promise.resolve({ data: null, error: null, count: rows.length }).then(resolve, reject);
          }

          return Promise.resolve({ data: clone(rows), error: null, count: rows.length }).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      },
    };

    return api;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => makeQuery(table),
    },
  };
});

import { CSVIngestionService } from '../../src/services/csvIngestionService';

describe('CSV detection fallback safety', () => {
  const service = new CSVIngestionService();
  const userId = '11111111-1111-4111-8111-111111111111';
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const orderCsv = [
    'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal',
    'A-1,2026-03-18T00:00:00Z,Shipped,9.99',
  ].join('\n');

  beforeEach(() => {
    Object.keys(tables).forEach((table) => {
      tables[table].length = 0;
    });
    mockTriggerDetectionPipeline.mockReset();
    mockLegacyEnqueueDetectionJob.mockReset();
  });

  it('persists truthful failure state when enhanced detection fails', async () => {
    mockTriggerDetectionPipeline.mockResolvedValue({
      success: false,
      jobId: 'enhanced-fail-job',
      message: 'Enhanced pipeline exploded',
      detectionsFound: 0,
      estimatedRecovery: 0,
    });

    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(orderCsv), originalname: 'orders.csv', mimetype: 'text/csv' }],
      { explicitType: 'orders', triggerDetection: true, tenantId }
    );

    expect(result.success).toBe(false);
    expect(result.detectionTriggered).toBe(true);
    expect(result.detectionJobId).toBeUndefined();
    expect(mockLegacyEnqueueDetectionJob).not.toHaveBeenCalled();

    expect(tables.detection_queue).toHaveLength(1);
    expect(tables.detection_queue[0].status).toBe('failed');
    expect(tables.detection_queue[0].error_message).toContain('Enhanced pipeline exploded');
    expect(tables.detection_queue[0].payload.fallback_used).toBe(false);
    expect(tables.detection_queue[0].payload.failure_reason).toContain('Enhanced pipeline exploded');

    expect(tables.csv_upload_runs).toHaveLength(1);
    expect(tables.csv_upload_runs[0].status).toBe('failed');
    expect(tables.csv_upload_runs[0].error).toContain('Enhanced pipeline exploded');
  });

  it('fails honestly when enhanced detection reports findings but persists zero detection_results rows', async () => {
    mockTriggerDetectionPipeline.mockResolvedValue({
      success: true,
      jobId: 'enhanced-success-no-persist',
      message: 'Enhanced pipeline said success',
      detectionsFound: 3,
      estimatedRecovery: 42.5,
    });

    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(orderCsv), originalname: 'orders.csv', mimetype: 'text/csv' }],
      { explicitType: 'orders', triggerDetection: true, tenantId }
    );

    expect(result.success).toBe(false);
    expect(result.detectionTriggered).toBe(true);
    expect(result.detectionJobId).toBeUndefined();
    expect(mockLegacyEnqueueDetectionJob).not.toHaveBeenCalled();

    expect(tables.detection_results).toHaveLength(0);
    expect(tables.detection_queue).toHaveLength(1);
    expect(tables.detection_queue[0].status).toBe('failed');
    expect(tables.detection_queue[0].error_message).toContain('persisted 0 detection_results rows');
    expect(tables.detection_queue[0].payload.failure_stage).toBe('persistence_verification');
    expect(tables.detection_queue[0].payload.fallback_used).toBe(false);

    expect(tables.csv_upload_runs).toHaveLength(1);
    expect(tables.csv_upload_runs[0].status).toBe('failed');
    expect(tables.csv_upload_runs[0].error).toContain('persisted 0 detection_results rows');
  });
});
