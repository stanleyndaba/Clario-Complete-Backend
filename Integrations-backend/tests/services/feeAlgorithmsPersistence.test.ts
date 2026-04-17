import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

let insertedRows: Row[] = [];
let insertError: any = null;

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/services/detection/core/detectors/shared/tenantUtils', () => ({
  relationExists: jest.fn(),
  resolveTenantId: jest.fn(async () => 'tenant-1'),
  requireDetectionSourceType: jest.fn(async () => 'csv_upload'),
}));

jest.mock('../../src/database/supabaseClient', () => {
  const makeQuery = () => {
    const state: { insertPayload?: Row[] } = {};

    const api: any = {
      insert: (payload: any) => {
        state.insertPayload = Array.isArray(payload) ? payload : [payload];
        return api;
      },
      select: async () => {
        if (insertError) {
          return { data: null, error: insertError };
        }

        insertedRows.push(...(state.insertPayload || []));
        return {
          data: (state.insertPayload || []).map((row, index) => ({
            id: `fee-detection-${index + 1}`,
            anomaly_type: row.anomaly_type,
          })),
          error: null,
        };
      },
    };

    return api;
  };

  return {
    supabaseAdmin: {
      from: jest.fn(() => makeQuery()),
    },
  };
});

import {
  detectFeeSignPolarityReview,
  storeFeeDetectionResults,
} from '../../src/services/detection/core/detectors/feeAlgorithms';

describe('Fee Phantom persistence', () => {
  beforeEach(() => {
    insertedRows = [];
    insertError = null;
  });

  it('persists positive fee sign-polarity review anomalies', async () => {
    const results = detectFeeSignPolarityReview('seller-1', 'csv_1', {
      seller_id: 'seller-1',
      sync_id: 'csv_1',
      product_catalog: [],
      fee_events: [
        {
          id: 'FEE9001',
          seller_id: 'seller-1',
          sku: 'SKU-TEST-B2',
          fee_type: 'monthly storage',
          fee_amount: -45,
          raw_amount: 45,
          raw_event_type: 'storage_fee',
          reference_id: 'FEE9001',
          currency: 'USD',
          fee_date: '2026-04-01T00:00:00.000Z',
          created_at: '2026-04-17T00:00:00.000Z',
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].anomaly_type).toBe('fee_sign_polarity_review');
    expect(results[0].estimated_value).toBe(0);
    expect(results[0].evidence.review_tier).toBe('review_only');

    const persisted = await storeFeeDetectionResults(results);

    expect(persisted).toEqual({
      success: true,
      attemptedCount: 1,
      persistedCount: 1,
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].anomaly_type).toBe('fee_sign_polarity_review');
    expect(insertedRows[0].tenant_id).toBe('tenant-1');
    expect(insertedRows[0].source_type).toBe('csv_upload');
    expect(insertedRows[0].status).toBe('detected');
  });

  it('returns a failed persistence result when Supabase rejects the insert', async () => {
    insertError = {
      message: 'insert rejected',
      code: 'TEST',
      details: 'test details',
      hint: 'test hint',
    };

    const results = detectFeeSignPolarityReview('seller-1', 'csv_1', {
      seller_id: 'seller-1',
      sync_id: 'csv_1',
      product_catalog: [],
      fee_events: [
        {
          id: 'FEE9001',
          seller_id: 'seller-1',
          sku: 'SKU-TEST-B2',
          fee_type: 'monthly storage',
          fee_amount: -45,
          raw_amount: 45,
          raw_event_type: 'storage_fee',
          reference_id: 'FEE9001',
          currency: 'USD',
          fee_date: '2026-04-01T00:00:00.000Z',
          created_at: '2026-04-17T00:00:00.000Z',
        },
      ],
    });

    const persisted = await storeFeeDetectionResults(results);

    expect(persisted.success).toBe(false);
    expect(persisted.attemptedCount).toBe(1);
    expect(persisted.persistedCount).toBe(0);
    expect(persisted.error).toContain('Fee detection persistence failed');
    expect(insertedRows).toHaveLength(0);
  });
});

