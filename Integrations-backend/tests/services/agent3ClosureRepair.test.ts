import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const tables: Record<string, Row[]> = {};

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/database/supabaseClient', () => {
  const makeBuilder = (table: string) => {
    const state: {
      filters: Array<(row: Row) => boolean>;
      limitCount: number | null;
      insertRows: Row[] | null;
    } = {
      filters: [],
      limitCount: null,
      insertRows: null,
    };

    const builder: any = {
      select: () => builder,
      eq: (field: string, value: any) => {
        state.filters.push((row) => row[field] === value);
        return builder;
      },
      in: (field: string, values: any[]) => {
        state.filters.push((row) => values.includes(row[field]));
        return builder;
      },
      gte: (field: string, value: any) => {
        state.filters.push((row) => row[field] >= value);
        return builder;
      },
      filter: (field: string, op: string, value: any) => {
        if (op === 'lt') state.filters.push((row) => row[field] < value);
        if (op === 'gt') state.filters.push((row) => row[field] > value);
        return builder;
      },
      order: () => builder,
      limit: (count: number) => {
        state.limitCount = count;
        return builder;
      },
      maybeSingle: () => ({
        then: (resolve: any, reject: any) => {
          let data = [...(tables[table] || [])];
          for (const filter of state.filters) data = data.filter(filter);
          if (state.limitCount !== null) data = data.slice(0, state.limitCount);
          return Promise.resolve({ data: data[0] || null, error: null }).then(resolve, reject);
        },
      }),
      insert: (payload: any) => {
        state.insertRows = Array.isArray(payload) ? payload : [payload];
        return builder;
      },
      then: (resolve: any, reject: any) => {
        if (state.insertRows) {
          tables[table] = [...(tables[table] || []), ...state.insertRows];
          return Promise.resolve({ data: state.insertRows, error: null }).then(resolve, reject);
        }

        let data = [...(tables[table] || [])];
        for (const filter of state.filters) data = data.filter(filter);
        if (state.limitCount !== null) data = data.slice(0, state.limitCount);
        return Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => makeBuilder(table),
    },
  };
});

import {
  fetchRefundEvents,
} from '../../src/services/detection/core/detectors/refundAlgorithms';
import {
  fetchInboundShipmentItems,
  detectShipmentShortage,
} from '../../src/services/detection/core/detectors/inboundAlgorithms';
import {
  storeDamagedDetectionResults,
} from '../../src/services/detection/core/detectors/damagedAlgorithms';

describe('Agent 3 final closure repair', () => {
  beforeEach(() => {
    Object.keys(tables).forEach((key) => delete tables[key]);
  });

  it('Refund Trap connector sees capitalized refund rows within lookback', async () => {
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
    tables.settlements = [
      {
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        transaction_type: 'Refund',
        amount: -25,
        settlement_date: '2026-01-15T00:00:00Z',
        order_id: 'ORDER-1',
        metadata: {},
        created_at: '2026-01-15T00:00:00Z',
      },
      {
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        transaction_type: 'Refund',
        amount: -25,
        settlement_date: '2025-01-15T00:00:00Z',
        order_id: 'ORDER-OLD',
        metadata: {},
        created_at: '2025-01-15T00:00:00Z',
      },
    ];

    const refunds = await fetchRefundEvents('user-1', { startDate: '2026-01-01T00:00:00Z' });

    expect(refunds).toHaveLength(1);
    expect(refunds[0].order_id).toBe('ORDER-1');
  });

  it('Inbound Inspector uses business shipment dates so mature shortages can qualify', async () => {
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
    tables.shipments = [
      {
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        shipment_id: 'SHP-1',
        sku: 'SKU-1',
        shipped_date: '2025-01-20T00:00:00Z',
        created_at: '2026-03-18T00:00:00Z',
        status: 'RECEIVING',
        shipped_quantity: 120,
        received_quantity: 119,
        metadata: {},
      },
    ];

    const items = await fetchInboundShipmentItems('user-1');
    const results = detectShipmentShortage('user-1', 'sync-1', {
      seller_id: 'user-1',
      sync_id: 'sync-1',
      inbound_shipment_items: items,
      reimbursement_events: [],
    });

    expect(items[0].shipment_created_date).toBe('2025-01-20T00:00:00Z');
    expect(results).toHaveLength(1);
    expect(results[0].anomaly_type).toBe('shipment_shortage');
  });

  it('Broken Goods persistence inserts once and skips duplicate reruns', async () => {
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
    tables.detection_results = [];

    const results = [
      {
        seller_id: 'user-1',
        sync_id: 'sync-1',
        anomaly_type: 'damaged_warehouse',
        severity: 'low',
        estimated_value: 15,
        currency: 'USD',
        confidence_score: 0.8,
        evidence: { sku: 'SKU-1', fnsku: 'FNSKU-1' },
        related_event_ids: ['damage-1'],
        discovery_date: new Date('2026-03-18T00:00:00Z'),
        deadline_date: new Date('2026-05-17T00:00:00Z'),
        days_remaining: 60,
      } as any,
    ];

    await storeDamagedDetectionResults(results as any);
    await storeDamagedDetectionResults(results as any);

    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0].tenant_id).toBe('tenant-a');
  });
});
