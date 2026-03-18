import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CSVIngestionService } from '../../src/services/csvIngestionService';

type Row = Record<string, any>;

const inserts: Record<string, Row[]> = {};
const csvRuns: Row[] = [];

jest.mock('../../src/database/supabaseClient', () => {
  const makeQuery = (table: string) => {
    const state: { filters: Record<string, any> } = { filters: {} };

    const api: any = {
      select: () => api,
      eq: (field: string, value: any) => {
        state.filters[field] = value;
        return api;
      },
      maybeSingle: async () => {
        if (table !== 'csv_ingestion_runs') return { data: null, error: null };
        const found = csvRuns.find(
          r =>
            r.tenant_id === state.filters.tenant_id &&
            r.user_id === state.filters.user_id &&
            r.csv_type === state.filters.csv_type &&
            r.file_hash === state.filters.file_hash
        );
        return { data: found || null, error: null };
      },
      insert: async (payload: any) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        if (!inserts[table]) inserts[table] = [];

        if (table === 'csv_ingestion_runs') {
          for (const row of rows) {
            const dup = csvRuns.find(
              r =>
                r.tenant_id === row.tenant_id &&
                r.user_id === row.user_id &&
                r.csv_type === row.csv_type &&
                r.file_hash === row.file_hash
            );
            if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } };
            csvRuns.push(row);
          }
          return { data: rows, error: null };
        }

        inserts[table].push(...rows);
        return { data: rows, error: null };
      },
      upsert: async (payload: any) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        if (!inserts[table]) inserts[table] = [];
        inserts[table].push(...rows);
        return { data: rows, error: null };
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

describe('CSV ingestion repair', () => {
  const service = new CSVIngestionService();
  const userId = '11111111-1111-4111-8111-111111111111';
  const tenantId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    Object.keys(inserts).forEach(k => delete inserts[k]);
    csvRuns.length = 0;
  });

  it('enforces tenant scoped orders writes', async () => {
    const csv = ['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'A-1,2026-03-18T00:00:00Z,Shipped,9.99'].join('\n');
    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'orders.csv', mimetype: 'text/csv' }],
      { explicitType: 'orders', triggerDetection: false, tenantId }
    );

    expect(result.success).toBe(true);
    expect(inserts.orders?.length).toBe(1);
    expect(inserts.orders[0].tenant_id).toBe(tenantId);
  });

  it('maps shipments without shipment_type column', async () => {
    const csv = ['ShipmentId,ShipmentDate,ShipmentStatus', 'S-1,2026-03-18T00:00:00Z,RECEIVED'].join('\n');
    await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'shipments.csv', mimetype: 'text/csv' }],
      { explicitType: 'shipments', triggerDetection: false, tenantId }
    );

    expect(inserts.shipments?.length).toBe(1);
    expect(Object.keys(inserts.shipments[0])).not.toContain('shipment_type');
    expect(inserts.shipments[0].tenant_id).toBe(tenantId);
  });

  it('uses real tenant semantics for financial events', async () => {
    const csv = ['EventType,PostedDate,Amount', 'AdjustmentEvent,2026-03-18T00:00:00Z,5.25'].join('\n');
    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'financial.csv', mimetype: 'text/csv' }],
      { explicitType: 'financial_events', triggerDetection: false, tenantId }
    );

    expect(result.success).toBe(true);
    expect(inserts.financial_events?.length).toBe(1);
    expect(inserts.financial_events[0].tenant_id).toBe(tenantId);
    expect(inserts.financial_events[0].seller_id).toBe(userId);
  });

  it('skips duplicate file re-upload', async () => {
    const csv = ['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'A-1,2026-03-18T00:00:00Z,Shipped,9.99'].join('\n');
    const file = { buffer: Buffer.from(csv), originalname: 'orders.csv', mimetype: 'text/csv' };

    const first = await service.ingestFiles(userId, [file], { explicitType: 'orders', triggerDetection: false, tenantId });
    const second = await service.ingestFiles(userId, [file], { explicitType: 'orders', triggerDetection: false, tenantId });

    expect(first.results[0].rowsInserted).toBe(1);
    expect(second.results[0].rowsInserted).toBe(0);
    expect(second.results[0].rowsSkipped).toBeGreaterThan(0);
  });

  it('fails honestly on malformed required headers', async () => {
    const csv = ['WrongCol,NoDate', 'x,y'].join('\n');
    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'bad_orders.csv', mimetype: 'text/csv' }],
      { explicitType: 'orders', triggerDetection: false, tenantId }
    );

    expect(result.success).toBe(false);
    expect(result.results[0].rowsInserted).toBe(0);
    expect(result.results[0].rowsFailed).toBeGreaterThan(0);
    expect(result.results[0].errors[0]).toContain('Missing required headers');
  });

  it('exposes supported type enablement truth', () => {
    const types = service.getSupportedTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types.every(t => typeof t.enabled === 'boolean')).toBe(true);
    expect(types.find(t => t.type === 'inventory')?.enabled).toBe(true);
    expect(types.find(t => t.type === 'financial_events')?.enabled).toBe(true);
    expect(types.find(t => t.type === 'fees')?.enabled).toBe(true);
  });
});
