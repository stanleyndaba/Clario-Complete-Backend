import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CSVIngestionService } from '../../src/services/csvIngestionService';

type Row = Record<string, any>;

const inserts: Record<string, Row[]> = {};
const csvRuns: Row[] = [];
const csvUploadRuns: Row[] = [];

jest.mock('../../src/database/supabaseClient', () => {
  const makeQuery = (table: string) => {
    const state: {
      filters: Record<string, any>;
      orderField?: string;
      orderAscending?: boolean;
      limitCount?: number;
      updatePayload?: Row | null;
      pendingDelete?: boolean;
    } = { filters: {} };

    const api: any = {
      select: () => api,
      eq: (field: string, value: any) => {
        state.filters[field] = value;
        return api;
      },
      order: (field: string, options?: { ascending?: boolean }) => {
        state.orderField = field;
        state.orderAscending = options?.ascending !== false;
        return api;
      },
      limit: (count: number) => {
        state.limitCount = count;
        return api;
      },
      update: (payload: Row) => {
        state.updatePayload = payload;
        return api;
      },
      delete: () => {
        state.pendingDelete = true;
        return api;
      },
      maybeSingle: async () => {
        if (table === 'csv_ingestion_runs') {
          const found = csvRuns.find(
            r =>
              r.tenant_id === state.filters.tenant_id &&
              r.user_id === state.filters.user_id &&
              r.csv_type === state.filters.csv_type &&
              r.file_hash === state.filters.file_hash
          );
          return { data: found || null, error: null };
        }

        if (table === 'csv_upload_runs') {
          const found = csvUploadRuns.find(
            r =>
              Object.entries(state.filters).every(([field, value]) => r[field] === value)
          );
          return { data: found || null, error: null };
        }

        return { data: null, error: null };
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

        if (table === 'csv_upload_runs') {
          csvUploadRuns.push(...rows);
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
      then: (resolve: any, reject: any) => {
        if (table === 'csv_upload_runs' && state.updatePayload) {
          const updated: Row[] = [];
          csvUploadRuns.forEach((row) => {
            const matches = Object.entries(state.filters).every(([field, value]) => row[field] === value);
            if (!matches) return;
            Object.assign(row, state.updatePayload);
            updated.push(row);
          });
          return Promise.resolve({ data: updated, error: null }).then(resolve, reject);
        }

        if (table === 'csv_ingestion_runs' && state.pendingDelete) {
          let removed = 0;
          for (let index = csvRuns.length - 1; index >= 0; index -= 1) {
            const row = csvRuns[index];
            const matches = Object.entries(state.filters).every(([field, value]) => row[field] === value);
            if (matches) {
              csvRuns.splice(index, 1);
              removed += 1;
            }
          }
          return Promise.resolve({ data: null, error: null, count: removed }).then(resolve, reject);
        }

        if (table === 'csv_upload_runs') {
          let rows = csvUploadRuns.filter((row) =>
            Object.entries(state.filters).every(([field, value]) => row[field] === value)
          );

          if (state.orderField) {
            rows = [...rows].sort((left, right) => {
              const leftValue = left[state.orderField!];
              const rightValue = right[state.orderField!];
              if (leftValue === rightValue) return 0;
              if (leftValue == null) return 1;
              if (rightValue == null) return -1;
              return leftValue < rightValue
                ? (state.orderAscending === false ? 1 : -1)
                : (state.orderAscending === false ? -1 : 1);
            });
          }

          if (typeof state.limitCount === 'number') {
            rows = rows.slice(0, state.limitCount);
          }

          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }

        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
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
    csvUploadRuns.length = 0;
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
    const csv = ['ShipmentId,ShipmentDate,ShipmentStatus,SKU,ASIN,FNSKU', 'S-1,2026-03-18T00:00:00Z,RECEIVED,SKU-1,ASIN-1,FNSKU-1'].join('\n');
    await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'shipments.csv', mimetype: 'text/csv' }],
      { explicitType: 'shipments', triggerDetection: false, tenantId }
    );

    expect(inserts.shipments?.length).toBe(1);
    expect(Object.keys(inserts.shipments[0])).not.toContain('shipment_type');
    expect(inserts.shipments[0].tenant_id).toBe(tenantId);
    expect(inserts.shipments[0].items?.[0]?.sku).toBe('SKU-1');
    expect(inserts.shipments[0].metadata?.sku).toBe('SKU-1');
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

  it('releases stale duplicate registration after a failed upload run', async () => {
    const csv = ['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'A-1,2026-03-18T00:00:00Z,Shipped,9.99'].join('\n');
    const file = { buffer: Buffer.from(csv), originalname: 'orders.csv', mimetype: 'text/csv' };
    const fileHash = require('crypto').createHash('sha256').update(file.buffer).digest('hex');
    const staleStartedAt = '2026-04-10T10:00:00.000Z';

    csvRuns.push({
      id: 'stale-lock',
      tenant_id: tenantId,
      user_id: userId,
      csv_type: 'orders',
      file_name: 'orders.csv',
      file_hash: fileHash,
      created_at: staleStartedAt,
    });

    csvUploadRuns.push({
      tenant_id: tenantId,
      seller_id: userId,
      user_id: userId,
      sync_id: 'csv_failed_sync',
      started_at: staleStartedAt,
      updated_at: '2026-04-10T10:01:00.000Z',
      completed_at: '2026-04-10T10:01:00.000Z',
      status: 'failed',
      detection_triggered: true,
      error: 'Detection failed before persistence',
      files_summary: [
        {
          fileName: 'orders.csv',
          csvType: 'orders',
          status: 'ingested',
          rowsProcessed: 1,
          rowsInserted: 1,
          rowsSkipped: 0,
          rowsFailed: 0,
          errors: [],
          detectionTriggered: true,
        },
      ],
      ingestion_results: [],
      success: false,
      total_files: 1,
      file_count: 1,
      is_sandbox: false,
    });

    const result = await service.ingestFiles(userId, [file], { explicitType: 'orders', triggerDetection: false, tenantId });

    expect(result.success).toBe(true);
    expect(result.results[0].rowsInserted).toBe(1);
    expect(result.results[0].rowsSkipped).toBe(0);
    expect(csvRuns).toHaveLength(1);
    expect(csvRuns[0].id).not.toBe('stale-lock');
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
    expect(result.results[0].rowsProcessed).toBeGreaterThan(0);
    expect(result.results[0].errors[0]).toContain('Missing required headers');
  });

  it('auto-detects financial event header variants without false header failure', async () => {
    const csv = ['EventType,PostedDate,Amount,OrderId,SKU', 'AdjustmentEvent,2026-03-18T00:00:00Z,4.20,O-1,SKU-1'].join('\n');
    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'auto-detect.csv', mimetype: 'text/csv' }],
      { triggerDetection: false, tenantId }
    );

    expect(result.results[0].csvType).toBe('financial_events');
    expect(result.results[0].rowsFailed).toBe(0);
    expect(result.results[0].errors).toEqual([]);
  });

  it('recognizes and persists transfer CSV rows with tenant scope', async () => {
    const csv = [
      'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date',
      'XFER-1,SKU-1,PHX6,MDW2,10,9,2026-03-18T00:00:00Z',
    ].join('\n');

    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'inventory_transfers.csv', mimetype: 'text/csv' }],
      { explicitType: 'transfers', triggerDetection: false, tenantId }
    );

    expect(result.success).toBe(true);
    expect(result.results[0].csvType).toBe('transfers');
    expect(inserts.inventory_transfers?.length).toBe(1);
    expect(inserts.inventory_transfers[0].tenant_id).toBe(tenantId);
    expect(inserts.inventory_transfers[0].seller_id).toBe(userId);
    expect(inserts.inventory_transfers[0].transfer_id).toBe('XFER-1');
  });

  it('fails honestly on malformed transfer rows', async () => {
    const csv = [
      'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received',
      'XFER-1,SKU-1,PHX6,MDW2,10,9',
    ].join('\n');

    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'inventory_transfers.csv', mimetype: 'text/csv' }],
      { explicitType: 'transfers', triggerDetection: false, tenantId }
    );

    expect(result.success).toBe(false);
    expect(result.results[0].rowsInserted).toBe(0);
    expect(result.results[0].rowsProcessed).toBeGreaterThan(0);
    expect(result.results[0].errors[0]).toContain('Missing required fields');
  });

  it('exposes supported type enablement truth', () => {
    const types = service.getSupportedTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types.every(t => typeof t.enabled === 'boolean')).toBe(true);
    expect(types.find(t => t.type === 'inventory')?.enabled).toBe(true);
    expect(types.find(t => t.type === 'financial_events')?.enabled).toBe(true);
    expect(types.find(t => t.type === 'fees')?.enabled).toBe(true);
    expect(types.find(t => t.type === 'transfers')?.enabled).toBe(true);
  });
});
