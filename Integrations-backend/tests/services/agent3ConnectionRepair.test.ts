import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const tables: Record<string, Row[]> = {};
const missingTables = new Set<string>();

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
      singleMode: boolean;
      maybeSingleMode: boolean;
    } = {
      filters: [],
      limitCount: null,
      singleMode: false,
      maybeSingleMode: false,
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
        if (op === 'lt') {
          state.filters.push((row) => row[field] < value);
        }
        return builder;
      },
      order: () => builder,
      limit: (count: number) => {
        state.limitCount = count;
        return builder;
      },
      maybeSingle: () => {
        state.maybeSingleMode = true;
        return builder;
      },
      single: () => {
        state.singleMode = true;
        return builder;
      },
      then: (resolve: any, reject: any) => {
        if (missingTables.has(table)) {
          return Promise.resolve({
            data: null,
            error: { message: `relation "public.${table}" does not exist` },
            count: 0,
          }).then(resolve, reject);
        }

        let data = [...(tables[table] || [])];
        for (const filter of state.filters) {
          data = data.filter(filter);
        }
        if (state.limitCount !== null) {
          data = data.slice(0, state.limitCount);
        }

        if (state.singleMode) {
          return Promise.resolve({
            data: data[0] || null,
            error: data.length === 1 ? null : data.length === 0 ? { code: 'PGRST116', message: 'not found' } : { code: 'PGRST116', message: 'multiple rows' },
          }).then(resolve, reject);
        }

        if (state.maybeSingleMode) {
          return Promise.resolve({
            data: data[0] || null,
            error: null,
          }).then(resolve, reject);
        }

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
  fetchInventoryLedger,
} from '../../src/services/detection/core/detectors/inventoryAlgorithms';
import {
  fetchInboundShipmentItems,
} from '../../src/services/detection/core/detectors/inboundAlgorithms';
import {
  fetchDamagedEvents,
} from '../../src/services/detection/core/detectors/damagedAlgorithms';
import {
  fetchRefundEvents,
} from '../../src/services/detection/core/detectors/refundAlgorithms';
import {
  fetchLossEvents,
} from '../../src/services/detection/core/detectors/duplicateMissedReimbursementAlgorithm';
import {
  getAgent3AlgorithmStatuses,
} from '../../src/services/detection/core/productionConnectionStatus';

describe('Agent 3 production connection repair', () => {
  beforeEach(() => {
    Object.keys(tables).forEach((key) => delete tables[key]);
    missingTables.clear();
  });

  it('Whale Hunter reads tenant-scoped inventory ledger events', async () => {
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
    tables.inventory_ledger_events = [
      {
        id: 'good',
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        fnsku: 'FNSKU-1',
        sku: 'SKU-1',
        asin: 'ASIN-1',
        event_type: 'Transfer',
        quantity: 2,
        quantity_direction: 'out',
        event_date: '2026-01-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'other-tenant',
        tenant_id: 'tenant-b',
        user_id: 'user-1',
        fnsku: 'FNSKU-2',
        event_type: 'Transfer',
        quantity: 9,
        quantity_direction: 'out',
        event_date: '2026-01-02T00:00:00Z',
        created_at: '2026-01-02T00:00:00Z',
      },
    ];
    tables.financial_events = [];
    tables.settlements = [];
    tables.inventory_ledger = [];

    const data = await fetchInventoryLedger('user-1', 'sync-1');

    expect(data.inventory_ledger).toHaveLength(1);
    expect(data.inventory_ledger[0].fnsku).toBe('FNSKU-1');
  });

  it('Inbound Inspector maps shipped_quantity and received_quantity from live rows', async () => {
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
    tables.shipments = [
      {
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        shipment_id: 'SHP-1',
        shipped_quantity: 7,
        received_quantity: 5,
        status: 'CLOSED',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        tenant_id: 'tenant-b',
        user_id: 'user-1',
        shipment_id: 'SHP-2',
        shipped_quantity: 10,
        received_quantity: 0,
        status: 'CLOSED',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    const items = await fetchInboundShipmentItems('user-1');

    expect(items).toHaveLength(1);
    expect(items[0].quantity_shipped).toBe(7);
    expect(items[0].quantity_received).toBe(5);
  });

  it('Broken Goods Hunter only derives damage from returns with minimum required fields', async () => {
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
    tables.returns = [
      {
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        return_id: 'RET-1',
        returned_date: '2026-01-01T00:00:00Z',
        metadata: { disposition: 'DAMAGED', reason_code: 'Q' },
        items: [{ sku: 'SKU-1', asin: 'ASIN-1', fnsku: 'FNSKU-1', quantity: 1, refund_amount: 12 }],
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        return_id: 'RET-2',
        returned_date: '2026-01-01T00:00:00Z',
        metadata: {},
        items: [],
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    const events = await fetchDamagedEvents('user-1');

    expect(events).toHaveLength(1);
    expect(events[0].fnsku).toBe('FNSKU-1');
  });

  it('Refund Trap reads tenant-scoped settlements only', async () => {
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
    tables.settlements = [
      {
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        id: 'SET-1',
        transaction_type: 'refund',
        amount: -25,
        settlement_date: '2026-01-01T00:00:00Z',
        currency: 'USD',
        order_id: 'ORDER-1',
        metadata: {},
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        tenant_id: 'tenant-b',
        user_id: 'user-1',
        id: 'SET-2',
        transaction_type: 'refund',
        amount: -30,
        settlement_date: '2026-01-01T00:00:00Z',
        currency: 'USD',
        order_id: 'ORDER-2',
        metadata: {},
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    const refunds = await fetchRefundEvents('user-1');

    expect(refunds).toHaveLength(1);
    expect(refunds[0].order_id).toBe('ORDER-1');
  });

  it('Sentinel falls back to inventory_ledger_events when inventory_ledger is unavailable', async () => {
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
    missingTables.add('inventory_ledger');
    tables.inventory_ledger_events = [
      {
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        id: 'EV-1',
        fnsku: 'FNSKU-1',
        sku: 'SKU-1',
        asin: 'ASIN-1',
        event_type: 'Lost',
        reason: 'Lost',
        quantity: 2,
        unit_cost: 15,
        event_date: '2026-01-01T00:00:00Z',
      },
    ];

    const lossEvents = await fetchLossEvents('user-1');

    expect(lossEvents).toHaveLength(1);
    expect(lossEvents[0].fnsku).toBe('FNSKU-1');
  });

  it('surfaces disconnected algorithms as disabled instead of silent zero output', async () => {
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
    tables.shipments = [];
    tables.returns = [{ tenant_id: 'tenant-a', user_id: 'user-1', metadata: {}, items: [] }];
    tables.settlements = [];
    tables.financial_events = [];
    tables.inventory_ledger_events = [];
    tables.inventory_ledger = [];
    missingTables.add('inventory_transfers');
    missingTables.add('fee_events');

    const statuses = await getAgent3AlgorithmStatuses('user-1');

    expect(statuses.transferLoss.status).toBe('DISABLED');
    expect(statuses.brokenGoodsHunter.status).toBe('DISABLED');
    expect(statuses.feePhantom.status).toBe('ACTIVE BUT NO QUALIFYING DATA');
  });
});
