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
    const state: { insertPayload?: Row[]; conflictKey?: string } = {};

    const api: any = {
      insert: (payload: any) => {
        state.insertPayload = Array.isArray(payload) ? payload : [payload];
        return api;
      },
      upsert: (payload: any, options?: { onConflict?: string }) => {
        state.insertPayload = Array.isArray(payload) ? payload : [payload];
        state.conflictKey = options?.onConflict;
        return api;
      },
      select: async () => {
        if (insertError) {
          return { data: null, error: insertError };
        }

        const persisted: Row[] = [];
        for (const row of state.insertPayload || []) {
          const existing = state.conflictKey
            ? insertedRows.find((candidate) =>
                candidate.tenant_id === row.tenant_id
                && candidate.seller_id === row.seller_id
                && candidate.sync_id === row.sync_id
                && candidate.anomaly_type === row.anomaly_type
                && candidate.finding_fingerprint === row.finding_fingerprint)
            : undefined;
          if (existing) {
            Object.assign(existing, row);
            persisted.push(existing);
          } else {
            insertedRows.push(row);
            persisted.push(row);
          }
        }
        return {
          data: persisted.map((row, index) => ({
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

  it('is replay-idempotent for the same review-only fee finding and retains one zero-value row', async () => {
    const results = detectFeeSignPolarityReview('seller-1', 'csv_1', {
      seller_id: 'seller-1',
      sync_id: 'csv_1',
      product_catalog: [],
      fee_events: [{
        id: 'FEE-REPLAY-1', seller_id: 'seller-1', sku: 'SKU-REPLAY', fee_type: 'monthly storage', fee_amount: -45,
        raw_amount: 45, raw_event_type: 'storage_fee', reference_id: 'FEE-REPLAY-1', currency: 'USD',
        fee_date: '2026-04-01T00:00:00.000Z', created_at: '2026-04-17T00:00:00.000Z',
      }],
    });

    const [first, replay] = await Promise.all([
      storeFeeDetectionResults(results),
      storeFeeDetectionResults(results),
    ]);

    expect(first).toMatchObject({ success: true, attemptedCount: 1, persistedCount: 1 });
    expect(replay).toMatchObject({ success: true, attemptedCount: 1, persistedCount: 1 });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      anomaly_type: 'fee_sign_polarity_review',
      estimated_value: 0,
      related_event_ids: ['FEE-REPLAY-1'],
    });
    expect(insertedRows[0].finding_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is replay-idempotent for the same monetary fee finding without doubling recovery value', async () => {
    const monetaryFinding: any = {
      seller_id: 'seller-1',
      sync_id: 'csv_1',
      anomaly_type: 'weight_fee_overcharge',
      severity: 'medium',
      estimated_value: 18.5,
      currency: 'USD',
      confidence_score: 0.92,
      related_event_ids: ['FEE-MONETARY-1'],
      discovery_date: new Date('2026-04-17T00:00:00.000Z'),
      deadline_date: new Date('2026-07-17T00:00:00.000Z'),
      days_remaining: 90,
      sku: 'SKU-MONETARY',
      evidence: {
        fee_type: 'fulfillment_fee',
        reference_id: 'FEE-MONETARY-1',
        sku: 'SKU-MONETARY',
        charged_amount: 30,
        expected_amount: 11.5,
        overcharge_amount: 18.5,
      },
    };

    await storeFeeDetectionResults([monetaryFinding]);
    await storeFeeDetectionResults([monetaryFinding]);

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      anomaly_type: 'weight_fee_overcharge',
      estimated_value: 18.5,
      related_event_ids: ['FEE-MONETARY-1'],
    });
    expect(insertedRows.reduce((sum, row) => sum + Number(row.estimated_value || 0), 0)).toBe(18.5);
  });

  it('retains distinct fee events as distinct findings rather than collapsing them under the replay fingerprint', async () => {
    const first = detectFeeSignPolarityReview('seller-1', 'csv_1', {
      seller_id: 'seller-1', sync_id: 'csv_1', product_catalog: [], fee_events: [{
        id: 'FEE-DISTINCT-1', seller_id: 'seller-1', sku: 'SKU-ONE', fee_type: 'monthly storage', fee_amount: -45,
        raw_amount: 45, raw_event_type: 'storage_fee', reference_id: 'FEE-DISTINCT-1', currency: 'USD',
        fee_date: '2026-04-01T00:00:00.000Z', created_at: '2026-04-17T00:00:00.000Z',
      }],
    });
    const second = detectFeeSignPolarityReview('seller-1', 'csv_1', {
      seller_id: 'seller-1', sync_id: 'csv_1', product_catalog: [], fee_events: [{
        id: 'FEE-DISTINCT-2', seller_id: 'seller-1', sku: 'SKU-TWO', fee_type: 'monthly storage', fee_amount: -55,
        raw_amount: 55, raw_event_type: 'storage_fee', reference_id: 'FEE-DISTINCT-2', currency: 'USD',
        fee_date: '2026-04-02T00:00:00.000Z', created_at: '2026-04-18T00:00:00.000Z',
      }],
    });

    await storeFeeDetectionResults(first);
    await storeFeeDetectionResults(second);

    expect(insertedRows).toHaveLength(2);
    expect(new Set(insertedRows.map((row) => row.finding_fingerprint)).size).toBe(2);
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

