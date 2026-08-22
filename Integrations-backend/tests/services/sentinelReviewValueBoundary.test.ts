import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/database/supabaseClient', () => {
  let sequence = 0;
  const makeBuilder = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let insertRows: Row[] | null = null;
    let limitCount: number | undefined;

    const rows = () => {
      let selected = [...(tables[table] || [])].filter((row) => filters.every((filter) => filter(row)));
      if (limitCount !== undefined) selected = selected.slice(0, limitCount);
      return selected;
    };

    const builder: any = {
      select: () => builder,
      eq: (field: string, value: any) => {
        filters.push((row) => row[field] === value);
        return builder;
      },
      gte: (field: string, value: any) => {
        filters.push((row) => row[field] >= value);
        return builder;
      },
      in: (field: string, values: any[]) => {
        filters.push((row) => values.includes(row[field]));
        return builder;
      },
      order: () => builder,
      limit: (value: number) => {
        limitCount = value;
        return builder;
      },
      insert: (payload: Row | Row[]) => {
        insertRows = Array.isArray(payload) ? payload : [payload];
        return builder;
      },
      update: () => builder,
      delete: () => builder,
      maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
      then: (resolve: any, reject: any) => {
        if (insertRows) {
          const persisted = insertRows.map((row) => ({ ...row, id: row.id || `${table}-${++sequence}` }));
          tables[table] = [...(tables[table] || []), ...persisted];
          return Promise.resolve({ data: persisted, error: null }).then(resolve, reject);
        }
        const selected = rows();
        return Promise.resolve({ data: selected, error: null, count: selected.length }).then(resolve, reject);
      },
    };
    return builder;
  };

  return { supabaseAdmin: { from: (table: string) => makeBuilder(table) } };
});

import { runSentinelDetection } from '../../src/services/detection/core/detectors/duplicateMissedReimbursementAlgorithm';

describe('Sentinel review value boundary', () => {
  beforeEach(() => {
    Object.keys(tables).forEach((table) => delete tables[table]);
    tables.tenant_memberships = [{ user_id: 'seller-sentinel', tenant_id: 'tenant-sentinel' }];
    tables.settlements = [{
      id: 'reimb-1',
      tenant_id: 'tenant-sentinel',
      user_id: 'seller-sentinel',
      sync_id: 'csv_sentinel_clawback_1',
      settlement_id: 'SETTLEMENT-1',
      transaction_type: 'reimbursement',
      amount: 40,
      currency: 'USD',
      order_id: 'ORDER-1',
      settlement_date: '2026-08-01T00:00:00.000Z',
      metadata: {},
      source: 'csv_upload',
      created_at: '2026-08-01T00:00:00.000Z',
    }];
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-22T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('persists orphan reimbursement clawback risk as zero-value review evidence, not recovery', async () => {
    const results = await runSentinelDetection('seller-sentinel', 'csv_sentinel_clawback_1');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      detection_type: 'clawback_risk',
      estimated_value: 0,
      clawback_risk_value: 40,
      recommended_action: 'review',
    });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'reimbursement_duplicate_missed',
      estimated_value: 0,
      tenant_id: 'tenant-sentinel',
      seller_id: 'seller-sentinel',
      source_type: 'csv_upload',
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      detection_type: 'clawback_risk',
      potential_exposure_value: 40,
      value_label: 'potential_exposure',
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
    });
  });
});
