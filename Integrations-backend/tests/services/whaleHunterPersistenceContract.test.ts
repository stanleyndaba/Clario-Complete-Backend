import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const tables: Record<string, Row[]> = {
  detection_results: [],
};

let forcedInsertError: string | null = null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: loggerMock,
}));

jest.mock('../../src/services/detection/core/detectors/shared/tenantUtils', () => ({
  requireDetectionSourceType: async () => 'csv_upload' as const,
  resolveTenantId: jest.fn(),
}));

jest.mock('../../src/database/supabaseClient', () => {
  const makeQuery = (table: string) => {
    const state: {
      filters: Array<{ field: string; value: any }>;
      inFilters: Array<{ field: string; values: any[] }>;
      insertPayload?: Row[];
      updatePayload?: Row;
      deleteMode?: boolean;
      selectColumns?: string;
    } = {
      filters: [],
      inFilters: [],
    };

    const applyFilters = (rows: Row[]) =>
      rows.filter((row) =>
        state.filters.every(({ field, value }) => row[field] === value)
        && state.inFilters.every(({ field, values }) => values.includes(row[field]))
      );

    const api: any = {
      select: (columns?: string) => {
        state.selectColumns = columns;
        return api;
      },
      eq: (field: string, value: any) => {
        state.filters.push({ field, value });
        return api;
      },
      in: (field: string, values: any[]) => {
        state.inFilters.push({ field, values });
        return api;
      },
      insert: (payload: any) => {
        state.insertPayload = Array.isArray(payload) ? payload : [payload];
        return api;
      },
      update: (payload: any) => {
        state.updatePayload = payload;
        return api;
      },
      delete: () => {
        state.deleteMode = true;
        return api;
      },
      then: (resolve: any, reject: any) => {
        try {
          const currentRows = tables[table] || [];

          if (state.updatePayload) {
            const rows = applyFilters(currentRows);
            rows.forEach((row) => Object.assign(row, clone(state.updatePayload)));
            return Promise.resolve({ data: clone(rows), error: null }).then(resolve, reject);
          }

          if (state.deleteMode) {
            const remaining = currentRows.filter((row) => !applyFilters([row]).length);
            tables[table] = remaining;
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }

          if (state.insertPayload) {
            if (forcedInsertError) {
              return Promise.resolve({ data: null, error: { message: forcedInsertError } }).then(resolve, reject);
            }

            const rows = state.insertPayload.map((row) => clone(row));
            currentRows.push(...rows);
            tables[table] = currentRows;
            return Promise.resolve({ data: clone(rows), error: null }).then(resolve, reject);
          }

          return Promise.resolve({ data: clone(applyFilters(currentRows)), error: null }).then(resolve, reject);
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

import { storeDetectionResults } from '../../src/services/detection/core/detectors/inventoryAlgorithms';

describe('Whale Hunter persistence contract', () => {
  beforeEach(() => {
    Object.keys(tables).forEach((table) => {
      tables[table].length = 0;
    });
    forcedInsertError = null;
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
  });

  it('maps detector extras into evidence metadata and persists only supported columns', async () => {
    await storeDetectionResults('seller-1', 'tenant-1', [
      {
        seller_id: 'seller-1',
        sync_id: 'csv_sync_1',
        anomaly_type: 'lost_in_transit',
        severity: 'medium',
        estimated_value: 80,
        currency: 'USD',
        confidence_score: 0.95,
        evidence: {
          fnsku: 'FN-1',
          physical_loss_units: 4,
        },
        discovery_date: new Date('2026-04-06T00:00:00.000Z'),
        deadline_date: new Date('2026-06-05T00:00:00.000Z'),
        days_remaining: 60,
        fnsku: 'FN-1',
        sku: 'SKU-1',
        asin: 'ASIN-1',
        product_name: 'Product 1',
        evidence_mode: 'SNAPSHOT_CONFIRMED',
        related_event_ids: ['event-1'],
      },
    ]);

    expect(tables.detection_results).toHaveLength(1);

    const row = tables.detection_results[0];
    expect(row.seller_id).toBe('seller-1');
    expect(row.sync_id).toBe('csv_sync_1');
    expect(row.anomaly_type).toBe('lost_in_transit');
    expect(row.source_type).toBe('csv_upload');
    expect(row.status).toBe('detected');

    expect(Object.prototype.hasOwnProperty.call(row, 'fnsku')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, 'sku')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, 'asin')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, 'product_name')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, 'evidence_mode')).toBe(false);

    expect(row.evidence.fnsku).toBe('FN-1');
    expect(row.evidence.metadata.whale_hunter).toEqual({
      fnsku: 'FN-1',
      sku: 'SKU-1',
      asin: 'ASIN-1',
      product_name: 'Product 1',
      evidence_mode: 'SNAPSHOT_CONFIRMED',
    });
    expect(row.related_event_ids).toEqual(['event-1']);
    expect(row.discovery_date).toBe('2026-04-06T00:00:00.000Z');
    expect(row.deadline_date).toBe('2026-06-05T00:00:00.000Z');
  });

  it('throws and logs structured details when insert fails', async () => {
    forcedInsertError = 'column does not exist';

    await expect(
      storeDetectionResults('seller-1', 'tenant-1', [
        {
          seller_id: 'seller-1',
          sync_id: 'csv_sync_2',
          anomaly_type: 'lost_in_transit',
          severity: 'medium',
          estimated_value: 100,
          currency: 'USD',
          confidence_score: 0.9,
          evidence: {
            fnsku: 'FN-2',
            physical_loss_units: 5,
          },
          discovery_date: new Date('2026-04-06T00:00:00.000Z'),
          deadline_date: new Date('2026-06-05T00:00:00.000Z'),
          days_remaining: 60,
          fnsku: 'FN-2',
          sku: 'SKU-2',
          asin: 'ASIN-2',
          product_name: 'Product 2',
          evidence_mode: 'LEDGER_RECONCILED',
        },
      ])
    ).rejects.toThrow('Whale Hunter detection insert failed: column does not exist');

    expect(loggerMock.error).toHaveBeenCalledWith(
      '🐋 [WHALE HUNTER] Error storing detection results',
      expect.objectContaining({
        sellerId: 'seller-1',
        syncId: 'csv_sync_2',
        anomalyTypes: ['lost_in_transit'],
        error: 'column does not exist',
        payload: expect.any(Array),
      })
    );
  });
});
