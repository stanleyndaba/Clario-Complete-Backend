import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const tables: Record<string, Row[]> = {
  dispute_cases: [],
  recoveries: [],
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/database/supabaseClient', () => {
  const makeQuery = (table: string) => {
    const state: {
      insertPayload?: Row[];
      inFilter?: { field: string; values: any[] };
    } = {};

    const api: any = {
      insert: (payload: any) => {
        state.insertPayload = Array.isArray(payload) ? payload : [payload];
        return api;
      },
      select: () => api,
      in: (field: string, values: any[]) => {
        state.inFilter = { field, values };
        return api;
      },
      then: (resolve: any, reject: any) => {
        try {
          if (state.insertPayload) {
            const rows = state.insertPayload.map((row, index) => {
              if (table === 'dispute_cases' && Object.prototype.hasOwnProperty.call(row, 'store_id')) {
                throw new Error("Could not find the 'store_id' column of 'dispute_cases' in the schema cache");
              }

              return {
                id: row.id || `${table}-${index + tables[table].length + 1}`,
                ...clone(row),
              };
            });

            tables[table].push(...rows);
            return Promise.resolve({ data: clone(rows), error: null }).then(resolve, reject);
          }

          let rows = tables[table] || [];
          if (state.inFilter) {
            rows = rows.filter((row) => state.inFilter!.values.includes(row[state.inFilter!.field]));
          }

          return Promise.resolve({ data: clone(rows), error: null }).then(resolve, reject);
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

import { upsertDisputesAndRecoveriesFromDetections } from '../../src/services/disputeBackfillService';

describe('disputeBackfillService', () => {
  beforeEach(() => {
    Object.keys(tables).forEach((table) => {
      tables[table].length = 0;
    });
  });

  it('creates dispute and recovery rows without persisting optional store_id drift', async () => {
    await upsertDisputesAndRecoveriesFromDetections([
      {
        id: 'detection-1',
        seller_id: 'seller-1',
        tenant_id: 'tenant-1',
        store_id: 'store-should-not-be-written',
        estimated_value: 42.5,
        currency: 'usd',
        severity: 'high',
        confidence_score: 0.95,
        anomaly_type: 'refund_no_return',
        created_at: '2026-04-06T14:00:00.000Z',
        sync_id: 'csv_1775484396213',
      },
    ]);

    expect(tables.dispute_cases).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(tables.dispute_cases[0], 'store_id')).toBe(false);
    expect(tables.dispute_cases[0].status).toBe('approved');
    expect(tables.dispute_cases[0].tenant_id).toBe('tenant-1');
    expect(tables.dispute_cases[0].seller_id).toBe('seller-1');
    expect(tables.dispute_cases[0].detection_result_id).toBe('detection-1');

    expect(tables.recoveries).toHaveLength(1);
    expect(tables.recoveries[0].tenant_id).toBe('tenant-1');
    expect(tables.recoveries[0].user_id).toBe('seller-1');
    expect(tables.recoveries[0].dispute_id).toBe(tables.dispute_cases[0].id);
  });

  it('keeps review-only detections out of submitted and approved case states', async () => {
    await upsertDisputesAndRecoveriesFromDetections([
      {
        id: 'review-detection-1',
        seller_id: 'seller-1',
        tenant_id: 'tenant-1',
        estimated_value: 0,
        currency: 'usd',
        severity: 'high',
        confidence_score: 0.99,
        anomaly_type: 'fee_sign_polarity_review',
        created_at: '2026-04-06T14:00:00.000Z',
        sync_id: 'csv_1775484396213',
        evidence: {
          review_tier: 'review_only',
          claim_readiness: 'not_claim_ready',
          recommended_action: 'review',
        },
      },
    ]);

    expect(tables.dispute_cases).toHaveLength(1);
    expect(tables.dispute_cases[0].status).toBe('review_needed');
    expect(tables.dispute_cases[0].filing_status).toBe('blocked');
    expect(tables.dispute_cases[0].eligible_to_file).toBe(false);
    expect(tables.dispute_cases[0].block_reasons).toContain('review_only_detection_not_claim_ready');
    expect(tables.dispute_cases[0].submission_date).toBeNull();
    expect(tables.dispute_cases[0].expected_payout_date).toBeNull();
    expect(tables.recoveries).toHaveLength(0);
  });
});
