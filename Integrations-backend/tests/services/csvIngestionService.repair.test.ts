import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  CSVIngestionService,
  detectManualAuditDelimiter,
  parseManualAuditDelimitedRecords,
} from '../../src/services/csvIngestionService';

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

  it('ingests the canonical synthetic control fixture pack through every non-Transfer source mapper', async () => {
    const fixtureDirectory = path.resolve(__dirname, '../fixtures/syntheticAuditCertification');
    const fixtureSources: Array<{ fileName: string; csvType: any }> = [
      { fileName: 'orders_control.csv', csvType: 'orders' },
      { fileName: 'shipments_control.csv', csvType: 'shipments' },
      { fileName: 'returns_control.csv', csvType: 'returns' },
      { fileName: 'settlements_control.csv', csvType: 'settlements' },
      { fileName: 'financial_events_control.csv', csvType: 'financial_events' },
      { fileName: 'fees_control.csv', csvType: 'fees' },
      { fileName: 'inventory_ledger_control.txt', csvType: 'inventory' },
    ];

    for (const fixture of fixtureSources) {
      const result = await service.ingestFiles(
        userId,
        [{
          buffer: Buffer.from(fs.readFileSync(path.join(fixtureDirectory, fixture.fileName), 'utf8')),
          originalname: fixture.fileName,
          mimetype: fixture.fileName.endsWith('.txt') ? 'text/plain' : 'text/csv',
        }],
        { explicitType: fixture.csvType, triggerDetection: false, tenantId }
      );

      expect(result.success).toBe(true);
      expect(result.results[0]).toMatchObject({
        csvType: fixture.csvType,
        detectionTriggered: false,
      });
      expect(result.results[0].rowsInserted).toBeGreaterThan(0);
    }

    expect(inserts.orders?.some((row) => row.order_id === 'SYN-ORDER-001')).toBe(true);
    expect(inserts.shipments?.some((row) => row.shipment_id === 'SYN-SHIP-001')).toBe(true);
    expect(inserts.returns?.some((row) => row.return_id === 'SYN-RETURN-001')).toBe(true);
    expect(inserts.settlements?.some((row) => row.settlement_id === 'SYN-SETTLEMENT-002')).toBe(true);
    expect(inserts.financial_events?.some((row) => row.amazon_event_id === 'SYN-EVENT-REIMB-001')).toBe(true);
    expect(inserts.inventory_ledger_events?.some((row) => row.reference_id === 'SYN-LEDGER-RECEIPT-001')).toBe(true);
    expect(inserts.inventory_transfers).toBeUndefined();
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

  it('preserves optional shipment quantity absence and rejects invalid supplied quantities', async () => {
    const makeShipment = (shipmentId: string, shipped: string, received: string, missing: string) => [
      'ShipmentId,ShipmentDate,ShipmentStatus,SKU,ASIN,FNSKU,QuantityShipped,QuantityReceived,QuantityMissing',
      `${shipmentId},2026-03-18T00:00:00Z,RECEIVED,SKU-1,ASIN-1,FNSKU-1,${shipped},${received},${missing}`,
    ].join('\n');

    const blankResult = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(makeShipment('SHIP-BLANK-QUANTITIES', '', '', '')), originalname: 'shipment-blank-quantities.csv', mimetype: 'text/csv' }],
      { explicitType: 'shipments', triggerDetection: false, tenantId }
    );
    expect(blankResult.success).toBe(true);
    expect(inserts.shipments?.find((row) => row.shipment_id === 'SHIP-BLANK-QUANTITIES')).toMatchObject({
      shipped_quantity: null,
      received_quantity: null,
      missing_quantity: null,
    });

    const zeroResult = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(makeShipment('SHIP-EXPLICIT-ZERO', '0', '0', '0')), originalname: 'shipment-explicit-zero.csv', mimetype: 'text/csv' }],
      { explicitType: 'shipments', triggerDetection: false, tenantId }
    );
    expect(zeroResult.success).toBe(true);
    expect(inserts.shipments?.find((row) => row.shipment_id === 'SHIP-EXPLICIT-ZERO')).toMatchObject({
      shipped_quantity: 0,
      received_quantity: 0,
      missing_quantity: 0,
    });

    for (const [shipmentId, quantity] of [['SHIP-MALFORMED-QUANTITY', 'unknown'], ['SHIP-NONFINITE-QUANTITY', 'Infinity']] as Array<[string, string]>) {
      const result = await service.ingestFiles(
        userId,
        [{ buffer: Buffer.from(makeShipment(shipmentId, '10', quantity, '')), originalname: `${shipmentId}.csv`, mimetype: 'text/csv' }],
        { explicitType: 'shipments', triggerDetection: true, tenantId }
      );
      expect(result).toMatchObject({ success: false, detectionTriggered: false });
      expect(result.results[0]).toMatchObject({ rowsInserted: 0, rowsSkipped: 1 });
      expect(inserts.shipments?.find((row) => row.shipment_id === shipmentId)).toBeUndefined();
    }
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

  it('preserves Manual financial-event reimbursement quantity without fabricating absent values', async () => {
    const explicit = await service.ingestFiles(
      userId,
      [{
        buffer: Buffer.from([
          'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId,SellerSKU,Quantity,FulfillmentCenterId',
          'Reimbursement,2026-03-18T00:00:00Z,20,USD,REIMB-QUANTITY-1,SKU-QUANTITY-1,1,PHX6',
        ].join('\n')),
        originalname: 'financial-quantity-explicit.csv',
        mimetype: 'text/csv',
      }],
      { explicitType: 'financial_events', triggerDetection: false, tenantId }
    );
    expect(explicit.success).toBe(true);
    expect(inserts.financial_events?.find((row) => row.amazon_event_id === 'REIMB-QUANTITY-1')).toMatchObject({
      sku: 'SKU-QUANTITY-1',
      quantity: 1,
      fulfillment_center_id: 'PHX6',
    });

    const absent = await service.ingestFiles(
      userId,
      [{
        buffer: Buffer.from([
          'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId,SellerSKU,Quantity',
          'Reimbursement,2026-03-18T00:00:00Z,20,USD,REIMB-QUANTITY-ABSENT,SKU-QUANTITY-1,',
        ].join('\n')),
        originalname: 'financial-quantity-absent.csv',
        mimetype: 'text/csv',
      }],
      { explicitType: 'financial_events', triggerDetection: false, tenantId }
    );
    expect(absent.success).toBe(true);
    expect(inserts.financial_events?.find((row) => row.amazon_event_id === 'REIMB-QUANTITY-ABSENT')).toMatchObject({
      quantity: null,
    });

    const malformed = await service.ingestFiles(
      userId,
      [{
        buffer: Buffer.from([
          'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId,SellerSKU,Quantity',
          'Reimbursement,2026-03-18T00:00:00Z,20,USD,REIMB-QUANTITY-MALFORMED,SKU-QUANTITY-1,unknown',
        ].join('\n')),
        originalname: 'financial-quantity-malformed.csv',
        mimetype: 'text/csv',
      }],
      { explicitType: 'financial_events', triggerDetection: true, tenantId }
    );
    expect(malformed).toMatchObject({ success: false, detectionTriggered: false });
    expect(malformed.results[0]).toMatchObject({ rowsInserted: 0, rowsSkipped: 1 });
    expect(inserts.financial_events?.find((row) => row.amazon_event_id === 'REIMB-QUANTITY-MALFORMED')).toBeUndefined();
  });

  it('preserves explicit zero, blank, and absent optional monetary evidence across returns and settlements', async () => {
    const returns = await service.ingestFiles(userId, [{
      buffer: Buffer.from([
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId',
        'RETURN-ZERO,2026-03-18T00:00:00Z,CustomerReturn,0,0,ORDER-ZERO',
        'RETURN-BLANK,2026-03-18T00:00:00Z,CustomerReturn,,1,ORDER-BLANK',
      ].join('\n')),
      originalname: 'returns-s5-values.csv', mimetype: 'text/csv',
    }], { explicitType: 'returns', triggerDetection: false, tenantId });
    expect(returns.success).toBe(true);
    expect(inserts.returns?.find((row) => row.return_id === 'RETURN-ZERO')).toMatchObject({
      refund_amount: 0,
      items: [expect.objectContaining({ quantity: 0 })],
    });
    expect(inserts.returns?.find((row) => row.return_id === 'RETURN-BLANK')).toMatchObject({
      refund_amount: null,
      items: [expect.objectContaining({ quantity: 1 })],
    });

    const missingRefundColumn = await service.ingestFiles(userId, [{
      buffer: Buffer.from([
        'ReturnId,ReturnDate,ReturnReason,Quantity,AmazonOrderId',
        'RETURN-ABSENT,2026-03-18T00:00:00Z,CustomerReturn,1,ORDER-ABSENT',
      ].join('\n')),
      originalname: 'returns-s5-refund-absent.csv', mimetype: 'text/csv',
    }], { explicitType: 'returns', triggerDetection: false, tenantId });
    expect(missingRefundColumn.success).toBe(true);
    expect(inserts.returns?.find((row) => row.return_id === 'RETURN-ABSENT')).toMatchObject({ refund_amount: null });

    const malformedRefund = await service.ingestFiles(userId, [{
      buffer: Buffer.from([
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId',
        'RETURN-INVALID,2026-03-18T00:00:00Z,CustomerReturn,unknown,1,ORDER-INVALID',
      ].join('\n')),
      originalname: 'returns-s5-refund-invalid.csv', mimetype: 'text/csv',
    }], { explicitType: 'returns', triggerDetection: false, tenantId });
    expect(malformedRefund).toMatchObject({ success: false, detectionTriggered: false });
    expect(malformedRefund.results[0].errors[0]).toContain('Invalid monetary field (refund_amount)');
    expect(inserts.returns?.find((row) => row.return_id === 'RETURN-INVALID')).toBeUndefined();

    const settlements = await service.ingestFiles(userId, [{
      buffer: Buffer.from([
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,Quantity',
        'SET-ZERO,2026-03-18T00:00:00Z,reimbursement,0,0,USD,0',
        'SET-BLANK,2026-03-18T00:00:00Z,reimbursement,5,,USD,',
      ].join('\n')),
      originalname: 'settlements-s5-values.csv', mimetype: 'text/csv',
    }], { explicitType: 'settlements', triggerDetection: false, tenantId });
    expect(settlements.success).toBe(true);
    expect(inserts.settlements?.find((row) => row.settlement_id === 'SET-ZERO')).toMatchObject({
      amount: 0,
      fees: 0,
      metadata: expect.objectContaining({ quantity: 0 }),
    });
    expect(inserts.settlements?.find((row) => row.settlement_id === 'SET-BLANK')).toMatchObject({
      amount: 5,
      fees: null,
      metadata: expect.objectContaining({ quantity: null }),
    });

    const malformedOptionalFee = await service.ingestFiles(userId, [{
      buffer: Buffer.from([
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode',
        'SET-INVALID,2026-03-18T00:00:00Z,reimbursement,5,unknown,USD',
      ].join('\n')),
      originalname: 'settlements-s5-fee-invalid.csv', mimetype: 'text/csv',
    }], { explicitType: 'settlements', triggerDetection: false, tenantId });
    expect(malformedOptionalFee).toMatchObject({ success: false, detectionTriggered: false });
    expect(malformedOptionalFee.results[0].errors[0]).toContain('Invalid monetary field (fees)');
    expect(inserts.settlements?.find((row) => row.settlement_id === 'SET-INVALID')).toBeUndefined();
  });

  it('retains explicit zero monetary events and rejects unavailable, malformed, or negative non-directional quantity evidence', async () => {
    const orders = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'ORDER-ZERO,2026-03-18T00:00:00Z,Shipped,0'].join('\n')),
      originalname: 'orders-s5-zero.csv', mimetype: 'text/csv',
    }], { explicitType: 'orders', triggerDetection: false, tenantId });
    expect(orders.success).toBe(true);
    expect(inserts.orders?.find((row) => row.order_id === 'ORDER-ZERO')).toMatchObject({ total_amount: 0 });

    const financial = await service.ingestFiles(userId, [{
      buffer: Buffer.from([
        'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId,Quantity',
        'AdjustmentEvent,2026-03-18T00:00:00Z,0,USD,EVENT-ZERO,0',
        'AdjustmentEvent,2026-03-18T00:00:00Z,5,USD,EVENT-BLANK,',
      ].join('\n')),
      originalname: 'financial-s5-zero.csv', mimetype: 'text/csv',
    }], { explicitType: 'financial_events', triggerDetection: false, tenantId });
    expect(financial.success).toBe(true);
    expect(inserts.financial_events?.find((row) => row.amazon_event_id === 'EVENT-ZERO')).toMatchObject({ amount: 0, quantity: 0 });
    expect(inserts.financial_events?.find((row) => row.amazon_event_id === 'EVENT-BLANK')).toMatchObject({ amount: 5, quantity: null });

    const fee = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['FeeType,FeeAmount,PostedDate,CurrencyCode,EventId', 'FBAFee,0,2026-03-18T00:00:00Z,USD,FEE-ZERO'].join('\n')),
      originalname: 'fees-s5-zero.csv', mimetype: 'text/csv',
    }], { explicitType: 'fees', triggerDetection: false, tenantId });
    expect(fee.success).toBe(true);
    expect(inserts.financial_events?.find((row) => row.amazon_event_id === 'FEE-ZERO')).toMatchObject({ amount: 0 });

    const negativeShipment = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['ShipmentId,ShipmentDate,ShipmentStatus,QuantityShipped', 'SHIP-NEG,2026-03-18T00:00:00Z,RECEIVED,-1'].join('\n')),
      originalname: 'shipments-s5-negative.csv', mimetype: 'text/csv',
    }], { explicitType: 'shipments', triggerDetection: false, tenantId });
    expect(negativeShipment).toMatchObject({ success: false, detectionTriggered: false });
    expect(negativeShipment.results[0].errors[0]).toContain('Invalid negative numeric field (shipped_quantity)');

    const negativeReturn = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity', 'RETURN-NEG,2026-03-18T00:00:00Z,CustomerReturn,5,-1'].join('\n')),
      originalname: 'returns-s5-negative.csv', mimetype: 'text/csv',
    }], { explicitType: 'returns', triggerDetection: false, tenantId });
    expect(negativeReturn).toMatchObject({ success: false, detectionTriggered: false });
    expect(negativeReturn.results[0].errors[0]).toContain('Invalid negative numeric field (quantity)');

    const negativeFinancialQuantity = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId,Quantity', 'AdjustmentEvent,2026-03-18T00:00:00Z,5,USD,EVENT-NEG,-1'].join('\n')),
      originalname: 'financial-s5-negative.csv', mimetype: 'text/csv',
    }], { explicitType: 'financial_events', triggerDetection: false, tenantId });
    expect(negativeFinancialQuantity).toMatchObject({ success: false, detectionTriggered: false });
    expect(negativeFinancialQuantity.results[0].errors[0]).toContain('Invalid negative numeric field (quantity)');
  });

  it('normalizes source-specific dates and preserves valid future timestamps without inventing chronology', async () => {
    const inputs = [
      { type: 'orders' as const, name: 's6-orders.csv', table: 'orders', id: 'order_id', idValue: 'S6-ORDER', dateField: 'order_date', header: 'AmazonOrderId,PurchaseDate,OrderTotal', row: 'S6-ORDER,2026-08-01T23:30:00-02:00,5', expected: '2026-08-02T01:30:00.000Z' },
      { type: 'shipments' as const, name: 's6-shipments.csv', table: 'shipments', id: 'shipment_id', idValue: 'S6-SHIP', dateField: 'shipped_date', header: 'ShipmentId,ShipmentDate,ReceivedDate', row: 'S6-SHIP,2026-08-01,', expected: '2026-08-01T00:00:00.000Z' },
      { type: 'returns' as const, name: 's6-returns.csv', table: 'returns', id: 'return_id', idValue: 'S6-RETURN', dateField: 'returned_date', header: 'ReturnId,ReturnDate,Quantity', row: 'S6-RETURN,2026-08-31,1', expected: '2026-08-31T00:00:00.000Z' },
      { type: 'settlements' as const, name: 's6-settlements.csv', table: 'settlements', id: 'settlement_id', idValue: 'S6-SETTLE', dateField: 'settlement_date', header: 'SettlementId,TransactionType,PostedDate,Amount', row: 'S6-SETTLE,reimbursement,2026-08-31T23:59:59Z,1', expected: '2026-08-31T23:59:59.000Z' },
      { type: 'financial_events' as const, name: 's6-financial.csv', table: 'financial_events', id: 'amazon_event_id', idValue: 'S6-FIN', dateField: 'event_date', header: 'EventType,PostedDate,Amount,AdjustmentEventId', row: 'AdjustmentEvent,2026-08-15,0,S6-FIN', expected: '2026-08-15T00:00:00.000Z' },
      { type: 'fees' as const, name: 's6-fees.csv', table: 'financial_events', id: 'amazon_event_id', idValue: 'S6-FEE', dateField: 'event_date', header: 'FeeType,FeeAmount,PostedDate,EventId', row: 'FBAFee,0,2026-08-16,S6-FEE', expected: '2026-08-16T00:00:00.000Z' },
    ];
    for (const input of inputs) {
      const result = await service.ingestFiles(userId, [{
        buffer: Buffer.from([input.header, input.row].join('\n')),
        originalname: input.name, mimetype: 'text/csv',
      }], { explicitType: input.type, triggerDetection: false, tenantId });
      expect(result.success).toBe(true);
      expect(result.results[0].temporalEvidence).toMatchObject({
        status: 'available', earliestAt: input.expected, latestAt: input.expected, observedDateCount: 1, continuity: 'unknown',
      });
      expect(inserts[input.table]?.find((row) => row[input.id] === input.idValue)).toMatchObject({ [input.dateField]: input.expected });
    }

    expect(inserts.shipments?.find((row) => row.shipment_id === 'S6-SHIP')).toMatchObject({ received_date: null });
    const malformedOptionalReceipt = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['ShipmentId,ShipmentDate,ReceivedDate', 'S6-SHIP-BAD,2026-08-01,08/02/2026'].join('\n')),
      originalname: 's6-optional-receipt-malformed.csv', mimetype: 'text/csv',
    }], { explicitType: 'shipments', triggerDetection: false, tenantId });
    expect(malformedOptionalReceipt).toMatchObject({ success: false, detectionTriggered: false });
    expect(malformedOptionalReceipt.results[0].errors[0]).toContain('received_date');
    expect(inserts.shipments?.find((row) => row.shipment_id === 'S6-SHIP-BAD')).toBeUndefined();

    const future = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['AmazonOrderId,PurchaseDate,OrderTotal', 'S6-FUTURE,2100-01-01,1'].join('\n')),
      originalname: 's6-future-date.csv', mimetype: 'text/csv',
    }], { explicitType: 'orders', triggerDetection: false, tenantId });
    expect(future.success).toBe(true);
    expect(future.results[0].temporalEvidence).toMatchObject({ status: 'available', earliestAt: '2100-01-01T00:00:00.000Z' });

    const ledger = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['FNSKU,MSKU,Quantity,Event Type,Date', 'FNSKU-S6,S6,1,Receipt,2026-08-17'].join('\n')),
      originalname: 's6-ledger.csv', mimetype: 'text/csv',
    }], { explicitType: 'inventory', triggerDetection: false, tenantId });
    expect(ledger.success).toBe(true);
    expect(inserts.inventory_ledger_events?.find((row) => row.fnsku === 'FNSKU-S6' && row.event_type === 'Receipt')).toMatchObject({ event_date: '2026-08-17T00:00:00.000Z' });
  });

  it('rejects required invalid dates and conflicting critical date aliases before persistence', async () => {
    const invalidCases = [
      { type: 'orders' as const, table: 'orders', id: 'S6-BLANK', header: 'AmazonOrderId,PurchaseDate,OrderTotal', row: 'S6-BLANK,,5', expectation: 'order_date' },
      { type: 'shipments' as const, table: 'shipments', id: 'S6-INVALID', header: 'ShipmentId,ShipmentDate', row: 'S6-INVALID,not-a-date', expectation: 'shipped_date' },
      { type: 'returns' as const, table: 'returns', id: 'S6-IMPOSSIBLE', header: 'ReturnId,ReturnDate,Quantity', row: 'S6-IMPOSSIBLE,2026-02-30,1', expectation: 'returned_date' },
      { type: 'settlements' as const, table: 'settlements', id: 'S6-NONFINITE', header: 'SettlementId,TransactionType,PostedDate,Amount', row: 'S6-NONFINITE,reimbursement,Infinity,1', expectation: 'settlement_date' },
      { type: 'fees' as const, table: 'financial_events', id: 'S6-FEE-INVALID', header: 'FeeType,FeeAmount,PostedDate,EventId', row: 'FBAFee,1,2026/08/01,S6-FEE-INVALID', expectation: 'event_date' },
      { type: 'inventory' as const, table: 'inventory_ledger_events', id: 'FNSKU-MISSING-DATE', header: 'FNSKU,MSKU,Quantity,Event Type,Date', row: 'FNSKU-MISSING-DATE,S6,1,Receipt,', expectation: 'event_date' },
    ];
    for (const [index, input] of invalidCases.entries()) {
      const result = await service.ingestFiles(userId, [{
        buffer: Buffer.from([input.header, input.row].join('\n')),
        originalname: `s6-invalid-${index}.csv`, mimetype: 'text/csv',
      }], { explicitType: input.type, triggerDetection: false, tenantId });
      expect(result).toMatchObject({ success: false, detectionTriggered: false });
      expect(result.results[0].errors[0]).toContain(input.expectation);
      expect(result.results[0].temporalEvidence).toMatchObject({ status: 'unavailable', earliestAt: null, latestAt: null });
      expect(inserts[input.table]?.some((row) => Object.values(row).includes(input.id)) ?? false).toBe(false);
    }

    const conflict = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['AmazonOrderId,PurchaseDate,order_date,OrderTotal', 'S6-CONFLICT,2026-08-01,2026-08-03,1'].join('\n')),
      originalname: 's6-conflicting-date-alias.csv', mimetype: 'text/csv',
    }], { explicitType: 'orders', triggerDetection: false, tenantId });
    expect(conflict.results[0]).toMatchObject({ success: false, inputIssue: 'ambiguous' });
    expect(conflict.results[0].errors[0]).toContain('conflicting aliases for order date');

    const identicalAliases = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['AmazonOrderId,PurchaseDate,order_date,OrderTotal', 'S6-IDENTICAL,2026-08-01,2026-08-01,1'].join('\n')),
      originalname: 's6-identical-date-alias.csv', mimetype: 'text/csv',
    }], { explicitType: 'orders', triggerDetection: false, tenantId });
    expect(identicalAliases.success).toBe(true);
  });

  it('records per-file temporal ranges without inferring continuity from gaps, overlap, mixed batches, or snapshots without dates', async () => {
    const augustOneToTen = Buffer.from(['AmazonOrderId,PurchaseDate,OrderTotal', 'S6-GAP-A,2026-08-01,1', 'S6-GAP-B,2026-08-10,1'].join('\n'));
    const augustTwentyOneToEnd = Buffer.from(['AmazonOrderId,PurchaseDate,OrderTotal', 'S6-GAP-C,2026-08-21,1', 'S6-GAP-D,2026-08-31,1'].join('\n'));
    const overlap = Buffer.from(['AmazonOrderId,PurchaseDate,OrderTotal', 'S6-OVERLAP-A,2026-08-10,1', 'S6-OVERLAP-B,2026-08-25,1'].join('\n'));
    const snapshot = Buffer.from(['sellerSku,availableQuantity', 'S6-SNAPSHOT,0'].join('\n'));
    const invalid = Buffer.from(['ReturnId,ReturnDate,Quantity', 'S6-BAD,2026-02-30,1'].join('\n'));
    const unsupported = Buffer.from(['not,a,supported,report', '1,2,3,4'].join('\n'));
    const result = await service.ingestFiles(userId, [
      { buffer: augustOneToTen, originalname: 's6-gap-a.csv', mimetype: 'text/csv' },
      { buffer: augustTwentyOneToEnd, originalname: 's6-gap-b.csv', mimetype: 'text/csv' },
      { buffer: overlap, originalname: 's6-overlap.csv', mimetype: 'text/csv' },
      { buffer: snapshot, originalname: 's6-snapshot.csv', mimetype: 'text/csv' },
      { buffer: invalid, originalname: 's6-invalid.csv', mimetype: 'text/csv' },
      { buffer: unsupported, originalname: 's6-unsupported.csv', mimetype: 'text/csv' },
    ], { triggerDetection: false, tenantId });

    const byName = Object.fromEntries(result.results.map((file) => [file.fileName, file]));
    expect(byName['s6-gap-a.csv'].temporalEvidence).toMatchObject({ status: 'available', earliestAt: '2026-08-01T00:00:00.000Z', latestAt: '2026-08-10T00:00:00.000Z', continuity: 'unknown' });
    expect(byName['s6-gap-b.csv'].temporalEvidence).toMatchObject({ status: 'available', earliestAt: '2026-08-21T00:00:00.000Z', latestAt: '2026-08-31T00:00:00.000Z', continuity: 'unknown' });
    expect(byName['s6-overlap.csv'].temporalEvidence).toMatchObject({ status: 'available', earliestAt: '2026-08-10T00:00:00.000Z', latestAt: '2026-08-25T00:00:00.000Z', continuity: 'unknown' });
    expect(byName['s6-snapshot.csv'].temporalEvidence).toMatchObject({ status: 'unavailable', earliestAt: null, latestAt: null });
    expect(byName['s6-invalid.csv'].temporalEvidence).toMatchObject({ status: 'unavailable' });
    expect(byName['s6-unsupported.csv'].temporalEvidence).toBeUndefined();

    const mixedRows = await service.ingestFiles(userId, [{
      buffer: Buffer.from(['AmazonOrderId,PurchaseDate,OrderTotal', 'S6-MIXED-VALID,2026-08-15,1', 'S6-MIXED-INVALID,2026-02-30,1'].join('\n')),
      originalname: 's6-mixed-valid-invalid-dates.csv', mimetype: 'text/csv',
    }], { explicitType: 'orders', triggerDetection: false, tenantId });
    expect(mixedRows.results[0]).toMatchObject({ rowsInserted: 1, rowsSkipped: 1 });
    expect(mixedRows.results[0].temporalEvidence).toMatchObject({ status: 'partial', earliestAt: '2026-08-15T00:00:00.000Z', latestAt: '2026-08-15T00:00:00.000Z', observedDateCount: 1, continuity: 'unknown' });
  });

  it('skips duplicate file re-upload', async () => {
    const csv = ['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'A-1,2026-03-18T00:00:00Z,Shipped,9.99'].join('\n');
    const file = { buffer: Buffer.from(csv), originalname: 'orders.csv', mimetype: 'text/csv' };

    const first = await service.ingestFiles(userId, [file], { explicitType: 'orders', triggerDetection: false, tenantId });
    const second = await service.ingestFiles(userId, [file], { explicitType: 'orders', triggerDetection: false, tenantId });

    expect(first.results[0].rowsInserted).toBe(1);
    expect(second.results[0].rowsInserted).toBe(0);
    expect(second.results[0].rowsSkipped).toBeGreaterThan(0);
    expect(second.results[0].temporalEvidence).toBeUndefined();
  });

  it('treats identical content with a different filename as a trusted duplicate rather than releasing the completed registration', async () => {
    const csv = ['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'RENAMED-1,2026-03-18T00:00:00Z,Shipped,9.99'].join('\n');
    const original = { buffer: Buffer.from(csv), originalname: 'orders-original.csv', mimetype: 'text/csv' };
    const renamed = { buffer: Buffer.from(csv), originalname: 'seller-export-copy.csv', mimetype: 'text/csv' };

    const first = await service.ingestFiles(userId, [original], { explicitType: 'orders', triggerDetection: false, tenantId });
    const replay = await service.ingestFiles(userId, [renamed], { explicitType: 'orders', triggerDetection: false, tenantId });

    expect(first).toMatchObject({ submissionDisposition: 'new' });
    expect(replay).toMatchObject({ success: false, submissionDisposition: 'duplicate_reused' });
    expect(replay.results[0]).toMatchObject({ success: true, rowsInserted: 0, rowsSkipped: 1 });
    expect(replay.results[0].errors[0]).toContain('Duplicate file upload detected');
    expect(inserts.orders).toHaveLength(1);
    expect(csvRuns).toHaveLength(1);
  });

  it('reuses identical renamed synthetic evidence under the existing server-issued provenance context', async () => {
    const previousTrainingTenant = process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = tenantId;
    const csv = ['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'SYNTHETIC-DUP-1,2026-03-18T00:00:00Z,Shipped,9.99'].join('\n');

    try {
      const first = await service.ingestSyntheticTrainingFiles(userId, [
        { buffer: Buffer.from(csv), originalname: 'synthetic-original.csv', mimetype: 'text/csv' },
      ], { explicitType: 'orders', triggerDetection: false, tenantId });
      const replay = await service.ingestSyntheticTrainingFiles(userId, [
        { buffer: Buffer.from(csv), originalname: 'synthetic-renamed-copy.csv', mimetype: 'text/csv' },
      ], { explicitType: 'orders', triggerDetection: false, tenantId });

      expect(first).toMatchObject({ submissionDisposition: 'new' });
      expect(replay).toMatchObject({ success: false, submissionDisposition: 'duplicate_reused', detectionTriggered: false });
      expect(inserts.orders).toHaveLength(1);
    } finally {
      if (previousTrainingTenant === undefined) delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
      else process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = previousTrainingTenant;
    }
  });

  it('converges simultaneous same-tenant submissions on one content registration and one source-row write', async () => {
    const csv = ['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'RACE-1,2026-03-18T00:00:00Z,Shipped,9.99'].join('\n');
    const makeFile = (name: string) => ({ buffer: Buffer.from(csv), originalname: name, mimetype: 'text/csv' });

    const [first, second] = await Promise.all([
      service.ingestFiles(userId, [makeFile('race-a.csv')], { explicitType: 'orders', triggerDetection: false, tenantId }),
      service.ingestFiles(userId, [makeFile('race-b.csv')], { explicitType: 'orders', triggerDetection: false, tenantId }),
    ]);

    const runs = [first, second];
    expect(runs.filter((run) => run.submissionDisposition === 'new')).toHaveLength(1);
    expect(runs.filter((run) => run.submissionDisposition === 'duplicate_reused')).toHaveLength(1);
    expect(inserts.orders).toHaveLength(1);
    expect(csvRuns).toHaveLength(1);
    expect(new Set(runs.map((run) => run.syncId)).size).toBe(2);
  });

  it('retains a new file while explicitly skipping duplicate evidence in the same batch', async () => {
    const duplicateCsv = ['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'MIXED-DUP-1,2026-03-18T00:00:00Z,Shipped,9.99'].join('\n');
    const newCsv = ['AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal', 'MIXED-NEW-1,2026-03-19T00:00:00Z,Shipped,12.99'].join('\n');
    await service.ingestFiles(userId, [{ buffer: Buffer.from(duplicateCsv), originalname: 'first.csv', mimetype: 'text/csv' }], { explicitType: 'orders', triggerDetection: false, tenantId });

    const mixed = await service.ingestFiles(userId, [
      { buffer: Buffer.from(duplicateCsv), originalname: 'first-copy.csv', mimetype: 'text/csv' },
      { buffer: Buffer.from(newCsv), originalname: 'second.csv', mimetype: 'text/csv' },
    ], { explicitType: 'orders', triggerDetection: false, tenantId });

    expect(mixed).toMatchObject({ submissionDisposition: 'mixed', detectionTriggered: false });
    expect(mixed.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: 'first-copy.csv', rowsInserted: 0, rowsSkipped: 1 }),
      expect.objectContaining({ fileName: 'second.csv', rowsInserted: 1 }),
    ]));
    expect(inserts.orders).toHaveLength(2);
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

  it('rejects a schema that matches multiple report families rather than choosing by filename or priority', async () => {
    const ambiguousCsv = [
      'SettlementId,TransactionType,EventType,PostedDate,Amount,Description',
      'SET-1,reimbursement,AdjustmentEvent,2026-03-18T00:00:00Z,4.20,ambiguous source family',
    ].join('\n');
    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(ambiguousCsv), originalname: 'financial_settlement_export.csv', mimetype: 'text/csv' }],
      { triggerDetection: true, tenantId }
    );

    expect(result).toMatchObject({ success: false, detectionTriggered: false });
    expect(result.results[0]).toMatchObject({
      success: false,
      csvType: 'unknown',
      rowsProcessed: 0,
      rowsInserted: 0,
      inputIssue: 'ambiguous',
      detectionTriggered: false,
    });
    expect(result.results[0].errors.join(' ')).toContain('Ambiguous CSV type');
    expect(inserts.financial_events).toBeUndefined();
    expect(inserts.settlements).toBeUndefined();
    expect(csvUploadRuns[csvUploadRuns.length - 1]).toMatchObject({
      status: 'failed',
      detection_triggered: false,
      files_summary: [expect.objectContaining({ status: 'failed', inputIssue: 'ambiguous' })],
    });
  });

  it('allows an authoritative explicit type to process an otherwise cross-family header set without guessing', async () => {
    const combinedHeadersCsv = [
      'SettlementId,TransactionType,EventType,PostedDate,Amount,Description',
      'SET-1,reimbursement,AdjustmentEvent,2026-03-18T00:00:00Z,4.20,explicitly classified financial event',
    ].join('\n');
    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(combinedHeadersCsv), originalname: 'financial_settlement_export.csv', mimetype: 'text/csv' }],
      { explicitType: 'financial_events', triggerDetection: false, tenantId }
    );

    expect(result.results[0]).toMatchObject({ success: true, csvType: 'financial_events', inputIssue: undefined });
    expect(result.results[0].rowsInserted).toBeGreaterThan(0);
    expect(inserts.financial_events).toHaveLength(1);
    expect(inserts.settlements).toBeUndefined();
  });

  it('rejects conflicting critical aliases before persistence rather than selecting the first alias value', async () => {
    const conflictingAliases = [
      'AmazonOrderId,order_id,PurchaseDate,OrderStatus,OrderTotal',
      'A-CANONICAL,A-CONFLICT,2026-03-18T00:00:00Z,Shipped,9.99',
    ].join('\n');
    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(conflictingAliases), originalname: 'orders_conflicting_aliases.csv', mimetype: 'text/csv' }],
      { triggerDetection: true, tenantId }
    );

    expect(result).toMatchObject({ success: false, detectionTriggered: false });
    expect(result.results[0]).toMatchObject({
      success: false,
      csvType: 'orders',
      rowsProcessed: 1,
      rowsInserted: 0,
      inputIssue: 'ambiguous',
      detectionTriggered: false,
    });
    expect(result.results[0].errors.join(' ')).toContain('conflicting aliases for order identifier');
    expect(inserts.orders).toBeUndefined();
    expect(csvUploadRuns[csvUploadRuns.length - 1]).toMatchObject({
      status: 'failed',
      detection_triggered: false,
      files_summary: [expect.objectContaining({ status: 'failed', inputIssue: 'ambiguous' })],
    });
  });

  it('accepts consistent redundant aliases without treating them as contradictory evidence', async () => {
    const consistentAliases = [
      'AmazonOrderId,order_id,PurchaseDate,OrderStatus,OrderTotal',
      'A-SAME,A-SAME,2026-03-18T00:00:00Z,Shipped,9.99',
    ].join('\n');
    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(consistentAliases), originalname: 'orders_consistent_aliases.csv', mimetype: 'text/csv' }],
      { triggerDetection: false, tenantId }
    );

    expect(result.results[0]).toMatchObject({ success: true, csvType: 'orders', rowsInserted: 1, inputIssue: undefined });
    expect(inserts.orders?.[0]).toMatchObject({ order_id: 'A-SAME' });
  });

  it('keeps valid supported reports ingestible when they contain irrelevant non-conflicting extra columns', async () => {
    const csv = [
      'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal,Irrelevant Export Note',
      'A-EXTRA,2026-03-18T00:00:00Z,Shipped,9.99,kept as source-only context',
    ].join('\n');
    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'orders_with_extra_column.csv', mimetype: 'text/csv' }],
      { triggerDetection: false, tenantId }
    );

    expect(result).toMatchObject({ success: true, detectionTriggered: false });
    expect(result.results[0]).toMatchObject({ success: true, csvType: 'orders', rowsInserted: 1, inputIssue: undefined });
    expect(inserts.orders?.[0]).toMatchObject({ order_id: 'A-EXTRA', total_amount: 9.99 });
  });

  it('retains valid rows and explicit failed-file truth for a mixed batch without running detection when disabled', async () => {
    const validOrders = [
      'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal',
      'A-MIXED,2026-03-18T00:00:00Z,Shipped,9.99',
    ].join('\n');
    const malformedOrders = [
      'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal',
      'A-BAD,2026-03-18T00:00:00Z,Shipped,9.99,unexpected',
    ].join('\n');
    const result = await service.ingestFiles(
      userId,
      [
        { buffer: Buffer.from(validOrders), originalname: 'orders_valid.csv', mimetype: 'text/csv' },
        { buffer: Buffer.from(malformedOrders), originalname: 'orders_malformed.csv', mimetype: 'text/csv' },
      ],
      { triggerDetection: false, tenantId }
    );

    expect(result).toMatchObject({ success: false, detectionTriggered: false, totalFiles: 2 });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: 'orders_valid.csv', success: true, rowsInserted: 1 }),
      expect.objectContaining({ fileName: 'orders_malformed.csv', success: false, inputIssue: 'malformed', rowsInserted: 0 }),
    ]));
    expect(inserts.orders).toHaveLength(1);
    expect(csvUploadRuns[csvUploadRuns.length - 1]).toMatchObject({
      status: 'partial',
      detection_triggered: false,
      files_summary: expect.arrayContaining([
        expect.objectContaining({ fileName: 'orders_valid.csv', status: 'ingested' }),
        expect.objectContaining({ fileName: 'orders_malformed.csv', status: 'failed', inputIssue: 'malformed' }),
      ]),
    });
  });

  it('keeps an all-rejected batch failed with no detection, no source persistence, and no clean audit signal', async () => {
    const malformed = [
      'AmazonOrderId,PurchaseDate',
      'A-1,2026-03-18T00:00:00Z,unexpected',
    ].join('\n');
    const unsupported = [
      'UnrelatedId,UnrelatedValue',
      'X-1,value',
    ].join('\n');
    const result = await service.ingestFiles(
      userId,
      [
        { buffer: Buffer.from(malformed), originalname: 'malformed.csv', mimetype: 'text/csv' },
        { buffer: Buffer.from(unsupported), originalname: 'unsupported.csv', mimetype: 'text/csv' },
      ],
      { triggerDetection: true, tenantId }
    );

    expect(result).toMatchObject({ success: false, detectionTriggered: false, totalFiles: 2 });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: 'malformed.csv', inputIssue: 'malformed', rowsInserted: 0 }),
      expect.objectContaining({ fileName: 'unsupported.csv', inputIssue: 'unsupported', rowsInserted: 0 }),
    ]));
    expect(inserts.orders).toBeUndefined();
    expect(inserts.detection_queue).toBeUndefined();
    expect(csvUploadRuns[csvUploadRuns.length - 1]).toMatchObject({
      status: 'failed',
      detection_triggered: false,
    });
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

  it('S11 rejects explicit ordinary Transfer CSV rows before tenant-scoped canonical persistence', async () => {
    const csv = [
      'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date',
      'XFER-1,SKU-1,PHX6,MDW2,10,9,2026-03-18T00:00:00Z',
    ].join('\n');

    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'inventory_transfers.csv', mimetype: 'text/csv' }],
      { explicitType: 'transfers', triggerDetection: false, tenantId }
    );

    expect(result).toMatchObject({ success: false, detectionTriggered: false });
    expect(result.results[0]).toMatchObject({ csvType: 'transfers', inputIssue: 'prohibited', rowsInserted: 0 });
    expect(inserts.inventory_transfers).toBeUndefined();
    expect(csvRuns).toHaveLength(0);
    expect(csvUploadRuns).toHaveLength(0);
  });

  it('S11 prohibits Transfer report semantics before malformed Transfer-row validation or persistence', async () => {
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
    expect(result.results[0]).toMatchObject({ inputIssue: 'prohibited', rowsInserted: 0, rowsProcessed: 1 });
    expect(result.results[0].errors[0]).toContain('Transfer-like input is prohibited');
    expect(inserts.inventory_transfers).toBeUndefined();
  });

  it('detects tab-delimited Amazon-style headers and retains comma-delimited CSV detection', () => {
    expect(detectManualAuditDelimiter('Date\tEvent Type\tReference ID')).toBe('\t');
    expect(detectManualAuditDelimiter('AmazonOrderId,PurchaseDate,OrderTotal')).toBe(',');
  });

  it('fails closed when an upload header contains both unquoted delimiter candidates', () => {
    expect(() => detectManualAuditDelimiter('Date\tEvent Type,Reference ID')).toThrow(
      'Ambiguous delimiter in header'
    );
  });

  it('does not treat commas inside quoted TSV fields as delimiters', () => {
    const tsv = [
      'Date\t"Event, Type"\tReference ID',
      '2026-03-18T00:00:00Z\t"Receipt, received"\tREF-001',
    ].join('\n');

    expect(detectManualAuditDelimiter(tsv.split('\n')[0])).toBe('\t');
    expect(parseManualAuditDelimitedRecords(tsv)).toEqual([
      {
        Date: '2026-03-18T00:00:00Z',
        'Event, Type': 'Receipt, received',
        'Reference ID': 'REF-001',
      },
    ]);
  });

  it('parses Amazon Ledger-style TSV records as text at the shared parser boundary', () => {
    const tsv = [
      'Date\tEvent Type\tFNSKU\tReference ID\tQuantity',
      '2026-03-18T00:00:00Z\tReceipts\tFNSKU-001\t0123456789\t5',
    ].join('\n');

    expect(parseManualAuditDelimitedRecords(tsv)).toEqual([
      {
        Date: '2026-03-18T00:00:00Z',
        'Event Type': 'Receipts',
        FNSKU: 'FNSKU-001',
        'Reference ID': '0123456789',
        Quantity: '5',
      },
    ]);
  });

  it('rejects malformed quoted rows, inconsistent column counts, and duplicate normalized headers', () => {
    expect(() => parseManualAuditDelimitedRecords([
      'AmazonOrderId,PurchaseDate',
      'A-1,"2026-03-18T00:00:00Z',
    ].join('\n'))).toThrow('Malformed row 2: unterminated quoted field');

    expect(() => parseManualAuditDelimitedRecords([
      'AmazonOrderId,PurchaseDate',
      'A-1,2026-03-18T00:00:00Z,unexpected',
    ].join('\n'))).toThrow('Malformed row 2: expected 2 columns but received 3');

    expect(() => parseManualAuditDelimitedRecords([
      'AmazonOrderId,amazon_order_id,PurchaseDate',
      'A-1,A-1,2026-03-18T00:00:00Z',
    ].join('\n'))).toThrow('Duplicate normalized header');
  });

  it('fails malformed Manual Audit files before persistence or detection', async () => {
    const malformedCsv = [
      'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal',
      'A-1,2026-03-18T00:00:00Z,Shipped,9.99,unexpected',
    ].join('\n');

    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(malformedCsv), originalname: 'malformed_orders.csv', mimetype: 'text/csv' }],
      { explicitType: 'orders', triggerDetection: true, tenantId }
    );

    expect(result.success).toBe(false);
    expect(result.detectionTriggered).toBe(false);
    expect(result.results[0]).toMatchObject({
      success: false,
      rowsProcessed: 0,
      rowsInserted: 0,
      detectionTriggered: false,
    });
    expect(result.results[0].errors[0]).toContain('Malformed row 2: expected 4 columns but received 5');
    expect(inserts.orders).toBeUndefined();
  });

  it('preserves leading-zero and high-precision numeric identifiers exactly as strings', () => {
    const leadingZeroReference = '0123456789';
    const highPrecisionReference = '900719925474099312345';
    const records = parseManualAuditDelimitedRecords([
      'order_id,reference_id',
      `${leadingZeroReference},${highPrecisionReference}`,
    ].join('\n'));

    expect(records[0].order_id).toBe(leadingZeroReference);
    expect(typeof records[0].order_id).toBe('string');
    expect(records[0].reference_id).toBe(highPrecisionReference);
    expect(typeof records[0].reference_id).toBe('string');
  });

  it('keeps CSV parsing compatible while converting money only in its explicit ingestion mapping', async () => {
    const csv = [
      'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal',
      '0000123456,2026-03-18T00:00:00Z,Shipped,9.99',
    ].join('\n');

    expect(parseManualAuditDelimitedRecords(csv)).toEqual([
      {
        AmazonOrderId: '0000123456',
        PurchaseDate: '2026-03-18T00:00:00Z',
        OrderStatus: 'Shipped',
        OrderTotal: '9.99',
      },
    ]);

    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(csv), originalname: 'orders.csv', mimetype: 'text/csv' }],
      { explicitType: 'orders', triggerDetection: false, tenantId }
    );

    expect(result.success).toBe(true);
    expect(inserts.orders?.[0]?.order_id).toBe('0000123456');
    expect(inserts.orders?.[0]?.total_amount).toBe(9.99);
  });

  it('ingests an Amazon Ledger TSV end-to-end with lossless reference and SKU identifiers', async () => {
    const highPrecisionReference = '900719925474099312345';
    const tsv = [
      'Date\tEvent Type\tFNSKU\tASIN\tMSKU\tQuantity\tReference ID\tFulfillment Center\tDisposition\tUnit Cost',
      `2026-03-18T00:00:00Z\tReceipts\tFNSKU-001\tB000000001\t0000123456\t5\t${highPrecisionReference}\tPHX6\tSELLABLE\t15.75`,
    ].join('\n');

    const result = await service.ingestFiles(
      userId,
      [{ buffer: Buffer.from(tsv), originalname: 'amazon_inventory_ledger.tsv', mimetype: 'text/tab-separated-values' }],
      { explicitType: 'inventory', triggerDetection: false, tenantId }
    );

    expect(result.success).toBe(true);
    expect(result.results[0].csvType).toBe('inventory');
    expect(inserts.inventory_ledger_events?.length).toBe(2);
    expect(inserts.inventory_ledger_events?.[0]).toMatchObject({
      tenant_id: tenantId,
      fnsku: 'FNSKU-001',
      sku: '0000123456',
      reference_id: highPrecisionReference,
      quantity: 5,
      fulfillment_center: 'PHX6',
      unit_cost: 15.75,
    });
    expect(typeof inserts.inventory_ledger_events?.[0]?.reference_id).toBe('string');
    expect(inserts.inventory_ledger_events?.[0]?.raw_payload?.['Reference ID']).toBe(highPrecisionReference);
  });

  it('preserves literal zero and nullable inventory snapshot evidence without defaulting absence to zero', async () => {
    const snapshot = [
      'sellerSku,ASIN,FNSKU,availableQuantity,reservedQuantity,inboundQuantity,price,damagedQuantity,unfulfillableQuantity',
      'SNAP-ZERO,ASIN-ZERO,FNSKU-ZERO,0,0,0,0,0,0',
      'SNAP-MISSING,ASIN-MISSING,FNSKU-MISSING,,,,,,',
      'SNAP-MIXED,ASIN-MIXED,FNSKU-MIXED,5,,0,12.50,,0',
    ].join('\n');

    const result = await service.ingestFiles(userId, [
      { buffer: Buffer.from(snapshot), originalname: 'inventory-s5-snapshot.csv', mimetype: 'text/csv' },
    ], { explicitType: 'inventory', triggerDetection: false, tenantId });

    expect(result.success).toBe(true);
    expect(inserts.inventory_items?.find((row) => row.sku === 'SNAP-ZERO')).toMatchObject({
      quantity_available: 0,
      quantity_reserved: 0,
      quantity_inbound: 0,
      price: 0,
      dimensions: { damaged: 0, unfulfillable: 0 },
    });
    expect(inserts.inventory_items?.find((row) => row.sku === 'SNAP-MISSING')).toMatchObject({
      quantity_available: null,
      quantity_reserved: null,
      quantity_inbound: null,
      price: null,
      dimensions: { damaged: null, unfulfillable: null },
    });
    expect(inserts.inventory_items?.find((row) => row.sku === 'SNAP-MIXED')).toMatchObject({
      quantity_available: 5,
      quantity_reserved: null,
      quantity_inbound: 0,
      price: 12.5,
      dimensions: { damaged: null, unfulfillable: 0 },
    });
  });

  it('rejects malformed or negative inventory snapshot quantities rather than treating them as zero', async () => {
    const snapshot = [
      'sellerSku,ASIN,FNSKU,availableQuantity,reservedQuantity,inboundQuantity,price',
      'SNAP-VALID,ASIN-VALID,FNSKU-VALID,0,1,0,0',
      'SNAP-MALFORMED,ASIN-BAD,FNSKU-BAD,unknown,0,0,0',
      'SNAP-NEGATIVE,ASIN-NEG,FNSKU-NEG,-1,0,0,0',
    ].join('\n');

    const result = await service.ingestFiles(userId, [
      { buffer: Buffer.from(snapshot), originalname: 'inventory-s5-invalid.csv', mimetype: 'text/csv' },
    ], { explicitType: 'inventory', triggerDetection: false, tenantId });

    expect(result).toMatchObject({ success: true });
    expect(result.results[0].rowsSkipped).toBe(2);
    expect(result.results[0].errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Invalid numeric field (quantity_available)'),
      expect.stringContaining('Invalid negative numeric field (quantity_available)'),
    ]));
    expect(inserts.inventory_items?.find((row) => row.sku === 'SNAP-VALID')).toMatchObject({ quantity_available: 0 });
    expect(inserts.inventory_items?.find((row) => row.sku === 'SNAP-MALFORMED')).toBeUndefined();
    expect(inserts.inventory_items?.find((row) => row.sku === 'SNAP-NEGATIVE')).toBeUndefined();
  });

  it('rejects invalid required ledger quantities and preserves valid movement quantities', async () => {
    const makeLedger = (referenceId: string, quantity: string, eventType = 'Receipts') => [
      'Date\tEvent Type\tFNSKU\tASIN\tMSKU\tQuantity\tReference ID\tFulfillment Center\tDisposition',
      `2026-03-18T00:00:00Z\t${eventType}\tFNSKU-${referenceId}\tB000000001\tSKU-${referenceId}\t${quantity}\t${referenceId}\tPHX6\tSELLABLE`,
    ].join('\n');
    const invalidCases: Array<[string, string]> = [
      ['LEDGER-BLANK-QUANTITY', ''],
      ['LEDGER-WHITESPACE-QUANTITY', ' '],
      ['LEDGER-MALFORMED-QUANTITY', 'unknown'],
      ['LEDGER-NONFINITE-QUANTITY', 'Infinity'],
    ];

    for (const [referenceId, quantity] of invalidCases) {
      const result = await service.ingestFiles(
        userId,
        [{ buffer: Buffer.from(makeLedger(referenceId, quantity)), originalname: `${referenceId}.tsv`, mimetype: 'text/tab-separated-values' }],
        { explicitType: 'inventory', triggerDetection: true, tenantId }
      );
      expect(result).toMatchObject({ success: false, detectionTriggered: false });
      expect(result.results[0]).toMatchObject({ rowsInserted: 0, rowsSkipped: 1 });
      expect(inserts.inventory_ledger_events?.find((row) => row.reference_id === referenceId)).toBeUndefined();
    }

    const validCases: Array<[string, string, number, 'in' | 'out']> = [
      ['LEDGER-ZERO-QUANTITY', '0', 0, 'in'],
      ['LEDGER-POSITIVE-QUANTITY', '5', 5, 'in'],
      ['LEDGER-NEGATIVE-QUANTITY', '-7', 7, 'in'],
      ['LEDGER-LARGE-QUANTITY', '1000000', 1000000, 'in'],
    ];

    for (const [referenceId, quantity, expectedQuantity, direction] of validCases) {
      const result = await service.ingestFiles(
        userId,
        [{ buffer: Buffer.from(makeLedger(referenceId, quantity, 'Receipts')), originalname: `${referenceId}.tsv`, mimetype: 'text/tab-separated-values' }],
        { explicitType: 'inventory', triggerDetection: false, tenantId }
      );
      expect(result.success).toBe(true);
      expect(inserts.inventory_ledger_events?.find((row) => row.reference_id === referenceId)).toMatchObject({
        quantity: expectedQuantity,
        quantity_direction: direction,
      });
    }
  });

  it('rejects a blank required order amount but preserves explicit zero', async () => {
    const emptyAmount = await service.ingestFiles(userId, [
      { buffer: Buffer.from('AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal\nEMPTY-ORDER,2026-03-18T00:00:00Z,Shipped,'), originalname: 'empty-amount.csv', mimetype: 'text/csv' },
    ], { explicitType: 'orders', triggerDetection: true, tenantId });

    expect(emptyAmount).toMatchObject({ success: false, detectionTriggered: false });
    expect(emptyAmount.results[0]).toMatchObject({ rowsInserted: 0, rowsSkipped: 1 });
    expect(emptyAmount.results[0].errors[0]).toContain('Missing required numeric field (total_amount)');
    expect(inserts.orders?.find((row) => row.order_id === 'EMPTY-ORDER')).toBeUndefined();

    const zeroAmount = await service.ingestFiles(userId, [
      { buffer: Buffer.from('AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal\nZERO-ORDER,2026-03-18T00:00:00Z,Shipped,0'), originalname: 'zero-amount.csv', mimetype: 'text/csv' },
    ], { explicitType: 'orders', triggerDetection: false, tenantId });

    expect(zeroAmount.success).toBe(true);
    expect(inserts.orders?.find((row) => row.order_id === 'ZERO-ORDER')).toMatchObject({
      order_id: 'ZERO-ORDER',
      total_amount: 0,
    });
  });

  it('S11 prohibits every explicit Manual Transfer quantity shape before persistence', async () => {
    const blankReceived = [
      'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value',
      'XFER-BLANK-RECEIVED,SKU-1,PHX6,MDW2,10,,2026-03-18T00:00:00Z,25',
    ].join('\n');
    const blankSent = [
      'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value',
      'XFER-BLANK-SENT,SKU-1,PHX6,MDW2,,8,2026-03-18T00:00:00Z,25',
    ].join('\n');
    const explicitZero = [
      'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value',
      'XFER-EXPLICIT-ZERO,SKU-1,PHX6,MDW2,10,0,2026-03-18T00:00:00Z,25',
    ].join('\n');

    const blankReceivedResult = await service.ingestFiles(userId, [
      { buffer: Buffer.from(blankReceived), originalname: 'transfer-blank-received.csv', mimetype: 'text/csv' },
    ], { explicitType: 'transfers', triggerDetection: true, tenantId });
    const blankSentResult = await service.ingestFiles(userId, [
      { buffer: Buffer.from(blankSent), originalname: 'transfer-blank-sent.csv', mimetype: 'text/csv' },
    ], { explicitType: 'transfers', triggerDetection: true, tenantId });

    const zeroResult = await service.ingestFiles(userId, [
      { buffer: Buffer.from(explicitZero), originalname: 'transfer-explicit-zero.csv', mimetype: 'text/csv' },
    ], { explicitType: 'transfers', triggerDetection: false, tenantId });

    for (const result of [blankReceivedResult, blankSentResult, zeroResult]) {
      expect(result).toMatchObject({ success: false, detectionTriggered: false });
      expect(result.results[0]).toMatchObject({ inputIssue: 'prohibited', rowsInserted: 0 });
    }
    expect(inserts.inventory_transfers).toBeUndefined();
    expect(csvRuns).toHaveLength(0);
  });

  it('rejects invalid required settlement amounts and preserves valid monetary values', async () => {
    const makeSettlement = (settlementId: string, amount: string) => [
      'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode',
      `${settlementId},2026-03-18T00:00:00Z,refund,${amount},0,USD`,
    ].join('\n');
    const invalidCases: Array<[string, string]> = [
      ['SETTLEMENT-BLANK-AMOUNT', ''],
      ['SETTLEMENT-WHITESPACE-AMOUNT', '" "'],
      ['SETTLEMENT-MALFORMED-AMOUNT', 'not-money'],
      ['SETTLEMENT-NONFINITE-AMOUNT', 'Infinity'],
    ];

    for (const [settlementId, amount] of invalidCases) {
      const result = await service.ingestFiles(userId, [
        { buffer: Buffer.from(makeSettlement(settlementId, amount)), originalname: `${settlementId}.csv`, mimetype: 'text/csv' },
      ], { explicitType: 'settlements', triggerDetection: true, tenantId });

      expect(result).toMatchObject({ success: false, detectionTriggered: false });
      expect(result.results[0]).toMatchObject({ rowsInserted: 0, rowsSkipped: 1 });
      expect(inserts.settlements?.find((row) => row.settlement_id === settlementId)).toBeUndefined();
      expect(inserts.financial_events?.find((row) => row.settlement_id === settlementId)).toBeUndefined();
    }

    const validCases: Array<[string, string, number]> = [
      ['SETTLEMENT-ZERO', '0', 0],
      ['SETTLEMENT-ZERO-DECIMAL', '0.00', 0],
      ['SETTLEMENT-POSITIVE', '$12.50', 12.5],
      ['SETTLEMENT-NEGATIVE', '(12.50)', -12.5],
      ['SETTLEMENT-LARGE', '9000000000.25', 9000000000.25],
    ];

    for (const [settlementId, amount, expectedAmount] of validCases) {
      const result = await service.ingestFiles(userId, [
        { buffer: Buffer.from(makeSettlement(settlementId, amount)), originalname: `${settlementId}.csv`, mimetype: 'text/csv' },
      ], { explicitType: 'settlements', triggerDetection: false, tenantId });

      expect(result.success).toBe(true);
      expect(inserts.settlements?.find((row) => row.settlement_id === settlementId)).toMatchObject({ amount: expectedAmount });
      expect(inserts.financial_events?.find((row) => row.settlement_id === settlementId)).toMatchObject({ amount: expectedAmount });
    }
  });

  it('preserves supplied settlement reimbursement identity evidence for FNSKU-scoped reconciliation', async () => {
    const settlement = [
      'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId,FNSKU,SellerSKU,Quantity,FulfillmentCenterId,ASIN,Reason',
      'SETTLEMENT-REIMB-EVIDENCE-1,2026-03-18T00:00:00Z,reimbursement,20,0,USD,ORDER-REIMB-EVIDENCE-1,FNSKU-REIMB-EVIDENCE-1,SKU-REIMB-EVIDENCE-1,1,PHX6,ASIN-REIMB-EVIDENCE-1,DAMAGED',
    ].join('\n');

    const result = await service.ingestFiles(userId, [
      { buffer: Buffer.from(settlement), originalname: 'settlement-reimbursement-evidence.csv', mimetype: 'text/csv' },
    ], { explicitType: 'settlements', triggerDetection: false, tenantId });

    expect(result.success).toBe(true);
    const persistedSettlement = inserts.settlements?.find((row) => row.settlement_id === 'SETTLEMENT-REIMB-EVIDENCE-1');
    expect(persistedSettlement?.metadata).toMatchObject({
      fnsku: 'FNSKU-REIMB-EVIDENCE-1',
      sku: 'SKU-REIMB-EVIDENCE-1',
      quantity: 1,
      fulfillmentCenterId: 'PHX6',
      asin: 'ASIN-REIMB-EVIDENCE-1',
      reason: 'DAMAGED',
    });
  });

  it('rejects invalid required Financial Event amounts and preserves valid monetary values', async () => {
    const makeFinancialEvent = (eventId: string, amount: string) => [
      'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId',
      `Reimbursement,2026-03-18T00:00:00Z,${amount},USD,${eventId}`,
    ].join('\n');
    const invalidCases: Array<[string, string]> = [
      ['FINANCIAL-BLANK-AMOUNT', ''],
      ['FINANCIAL-WHITESPACE-AMOUNT', '" "'],
      ['FINANCIAL-MALFORMED-AMOUNT', 'not-money'],
      ['FINANCIAL-NONFINITE-AMOUNT', 'Infinity'],
    ];

    for (const [eventId, amount] of invalidCases) {
      const result = await service.ingestFiles(userId, [
        { buffer: Buffer.from(makeFinancialEvent(eventId, amount)), originalname: `${eventId}.csv`, mimetype: 'text/csv' },
      ], { explicitType: 'financial_events', triggerDetection: true, tenantId });

      expect(result).toMatchObject({ success: false, detectionTriggered: false });
      expect(result.results[0]).toMatchObject({ rowsInserted: 0, rowsSkipped: 1 });
      expect(inserts.financial_events?.find((row) => row.amazon_event_id === eventId)).toBeUndefined();
    }

    const validCases: Array<[string, string, number]> = [
      ['FINANCIAL-ZERO', '0', 0],
      ['FINANCIAL-ZERO-DECIMAL', '0.00', 0],
      ['FINANCIAL-POSITIVE', '$12.50', 12.5],
      ['FINANCIAL-NEGATIVE', '(12.50)', -12.5],
      ['FINANCIAL-LARGE', '9000000000.25', 9000000000.25],
    ];

    for (const [eventId, amount, expectedAmount] of validCases) {
      const result = await service.ingestFiles(userId, [
        { buffer: Buffer.from(makeFinancialEvent(eventId, amount)), originalname: `${eventId}.csv`, mimetype: 'text/csv' },
      ], { explicitType: 'financial_events', triggerDetection: false, tenantId });

      expect(result.success).toBe(true);
      expect(inserts.financial_events?.find((row) => row.amazon_event_id === eventId)).toMatchObject({
        amount: expectedAmount,
        event_type: 'reimbursement',
      });
    }
  });

  it('rejects invalid required fee amounts and preserves valid monetary values', async () => {
    const makeFee = (eventId: string, amount: string) => [
      'FeeType,FeeAmount,PostedDate,CurrencyCode,EventId',
      `FBAFee,${amount},2026-03-18T00:00:00Z,USD,${eventId}`,
    ].join('\n');
    const invalidCases: Array<[string, string]> = [
      ['FEE-BLANK-AMOUNT', ''],
      ['FEE-WHITESPACE-AMOUNT', '" "'],
      ['FEE-MALFORMED-AMOUNT', 'not-money'],
      ['FEE-NONFINITE-AMOUNT', 'Infinity'],
    ];

    for (const [eventId, amount] of invalidCases) {
      const result = await service.ingestFiles(userId, [
        { buffer: Buffer.from(makeFee(eventId, amount)), originalname: `${eventId}.csv`, mimetype: 'text/csv' },
      ], { explicitType: 'fees', triggerDetection: true, tenantId });

      expect(result).toMatchObject({ success: false, detectionTriggered: false });
      expect(result.results[0]).toMatchObject({ rowsInserted: 0, rowsSkipped: 1 });
      expect(inserts.financial_events?.find((row) => row.amazon_event_id === eventId)).toBeUndefined();
    }

    const validCases: Array<[string, string, number]> = [
      ['FEE-ZERO', '0', 0],
      ['FEE-ZERO-DECIMAL', '0.00', 0],
      ['FEE-POSITIVE', '$12.50', 12.5],
      ['FEE-NEGATIVE', '(12.50)', -12.5],
      ['FEE-LARGE', '9000000000.25', 9000000000.25],
    ];

    for (const [eventId, amount, expectedAmount] of validCases) {
      const result = await service.ingestFiles(userId, [
        { buffer: Buffer.from(makeFee(eventId, amount)), originalname: `${eventId}.csv`, mimetype: 'text/csv' },
      ], { explicitType: 'fees', triggerDetection: false, tenantId });

      expect(result.success).toBe(true);
      expect(inserts.financial_events?.find((row) => row.amazon_event_id === eventId)).toMatchObject({
        amount: expectedAmount,
        event_type: 'fee',
      });
    }
  });

  it('preserves supplied Manual Return FNSKU for damaged-return reimbursement reconciliation', async () => {
    const returnCsv = [
      'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId,SKU,ASIN,FNSKU,Disposition',
      'RETURN-FNSKU-EVIDENCE-1,2026-03-18T00:00:00Z,DAMAGED,20,1,ORDER-RETURN-FNSKU-EVIDENCE-1,SKU-RETURN-FNSKU-EVIDENCE-1,ASIN-RETURN-FNSKU-EVIDENCE-1,FNSKU-RETURN-FNSKU-EVIDENCE-1,DAMAGED',
    ].join('\n');

    const result = await service.ingestFiles(userId, [
      { buffer: Buffer.from(returnCsv), originalname: 'return-fnsku-evidence.csv', mimetype: 'text/csv' },
    ], { explicitType: 'returns', triggerDetection: false, tenantId });

    expect(result.success).toBe(true);
    expect(inserts.returns?.find((row) => row.return_id === 'RETURN-FNSKU-EVIDENCE-1')).toMatchObject({
      items: [{
        sku: 'SKU-RETURN-FNSKU-EVIDENCE-1',
        asin: 'ASIN-RETURN-FNSKU-EVIDENCE-1',
        fnsku: 'FNSKU-RETURN-FNSKU-EVIDENCE-1',
        quantity: 1,
      }],
    });
  });

  it('rejects invalid required Manual Return quantities and preserves explicit zero', async () => {
    const makeReturn = (returnId: string, quantity: string) => [
      'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId',
      `${returnId},2026-03-18T00:00:00Z,CUSTOMER_REQUEST,100,${quantity},ORDER-${returnId}`,
    ].join('\n');
    const invalidCases: Array<[string, string]> = [
      ['RETURN-BLANK-QUANTITY', ''],
      ['RETURN-WHITESPACE-QUANTITY', '" "'],
      ['RETURN-MALFORMED-QUANTITY', 'unknown'],
      ['RETURN-NONFINITE-QUANTITY', 'Infinity'],
    ];

    for (const [returnId, quantity] of invalidCases) {
      const result = await service.ingestFiles(userId, [
        { buffer: Buffer.from(makeReturn(returnId, quantity)), originalname: `${returnId}.csv`, mimetype: 'text/csv' },
      ], { explicitType: 'returns', triggerDetection: true, tenantId });

      expect(result).toMatchObject({ success: false, detectionTriggered: false });
      expect(result.results[0]).toMatchObject({ rowsInserted: 0, rowsSkipped: 1 });
      expect(result.results[0].errors[0]).toMatch(/required numeric field \(quantity\)|Invalid numeric field \(quantity\)/);
      expect(inserts.returns?.find((row) => row.return_id === returnId)).toBeUndefined();
    }

    const zeroResult = await service.ingestFiles(userId, [
      { buffer: Buffer.from(makeReturn('RETURN-EXPLICIT-ZERO', '0')), originalname: 'return-explicit-zero.csv', mimetype: 'text/csv' },
    ], { explicitType: 'returns', triggerDetection: false, tenantId });

    expect(zeroResult.success).toBe(true);
    expect(inserts.returns?.find((row) => row.return_id === 'RETURN-EXPLICIT-ZERO')).toMatchObject({
      refund_amount: 100,
      items: [{ quantity: 0 }],
    });
  });

  it('exposes supported type enablement truth with Transfer disabled', () => {
    const types = service.getSupportedTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types.every(t => typeof t.enabled === 'boolean')).toBe(true);
    expect(types.find(t => t.type === 'inventory')?.enabled).toBe(true);
    expect(types.find(t => t.type === 'financial_events')?.enabled).toBe(true);
    expect(types.find(t => t.type === 'fees')?.enabled).toBe(true);
    expect(types.find(t => t.type === 'transfers')?.enabled).toBe(false);
  });
});
