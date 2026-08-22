import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const tables: Record<string, Row[]> = {};
const FIXED_NOW = new Date('2026-08-22T12:00:00.000Z');
const TENANT_A = 'truth-tenant-a';
const SELLER_A = 'truth-seller-a';
const STORE_A = 'truth-store-a';
const TENANT_B = 'truth-tenant-b';
const SELLER_B = 'truth-seller-b';
const STORE_B = 'truth-store-b';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  getLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

jest.mock('../../src/services/syncJobManager', () => ({
  syncJobManager: {
    startSync: jest.fn(),
    getSyncStatus: jest.fn(),
  },
}));

jest.mock('../../src/services/auditIntentService', () => ({ __esModule: true, default: {} }));
jest.mock('../../src/services/userWorkspaceBootstrap', () => ({ ensureAuthenticatedUserWorkspace: jest.fn() }));
jest.mock('../../src/services/workspaceEntitlementService', () => ({ __esModule: true, default: {} }));
jest.mock('../../src/database/postgresTransaction', () => ({ withPostgresTransaction: jest.fn() }));
jest.mock('../../src/utils/tokenManager', () => ({ __esModule: true, default: {} }));
jest.mock('../../src/notifications/services/system_signal_service', () => ({ systemSignalService: {} }));

jest.mock('../../src/database/supabaseClient', () => {
  let sequence = 0;
  const matches = (row: Row, filters: Array<(candidate: Row) => boolean>) => filters.every((filter) => filter(row));

  const makeBuilder = (table: string) => {
    const state: {
      filters: Array<(candidate: Row) => boolean>;
      orderBy?: { field: string; ascending: boolean };
      limitCount?: number;
      range?: { from: number; to: number };
      mutation?: { kind: 'insert' | 'upsert' | 'update' | 'delete'; payload?: Row[] | Row; onConflict?: string };
      countRequested?: boolean;
      head?: boolean;
    } = { filters: [] };

    const materialize = () => {
      let rows = [...(tables[table] || [])].filter((row) => matches(row, state.filters));
      if (state.orderBy) {
        const { field, ascending } = state.orderBy;
        rows = rows.sort((left, right) => {
          const a = left[field] ?? '';
          const b = right[field] ?? '';
          return a === b ? 0 : (a > b ? 1 : -1) * (ascending ? 1 : -1);
        });
      }
      if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);
      if (state.limitCount !== undefined) rows = rows.slice(0, state.limitCount);
      return rows;
    };

    const applyMutation = () => {
      if (table === 'fee_events') {
        return { data: null, error: { message: 'relation fee_events does not exist' }, count: 0 };
      }
      const current = tables[table] || [];
      const mutation = state.mutation;
      if (!mutation) return { data: materialize(), error: null, count: materialize().length };

      if (mutation.kind === 'delete') {
        const removed = current.filter((row) => matches(row, state.filters));
        tables[table] = current.filter((row) => !matches(row, state.filters));
        return { data: clone(removed), error: null, count: removed.length };
      }

      if (mutation.kind === 'update') {
        const rows = current.filter((row) => matches(row, state.filters));
        rows.forEach((row) => Object.assign(row, clone(mutation.payload as Row)));
        return { data: clone(rows), error: null, count: rows.length };
      }

      const incoming = (Array.isArray(mutation.payload) ? mutation.payload : [mutation.payload])
        .filter(Boolean)
        .map((row) => ({ ...clone(row as Row), id: (row as Row).id || `${table}-${++sequence}` }));

      if (mutation.kind === 'upsert' && mutation.onConflict) {
        const keys = mutation.onConflict.split(',').map((key) => key.trim()).filter(Boolean);
        for (const row of incoming) {
          const existing = current.find((candidate) => keys.every((key) => candidate[key] === row[key]));
          if (existing) Object.assign(existing, row);
          else current.push(row);
        }
      } else {
        current.push(...incoming);
      }
      tables[table] = current;
      return { data: clone(incoming), error: null, count: incoming.length };
    };

    const builder: any = {
      select: (_columns?: string, options?: { count?: 'exact'; head?: boolean }) => {
        state.countRequested = options?.count === 'exact';
        state.head = Boolean(options?.head);
        return builder;
      },
      eq: (field: string, value: any) => {
        state.filters.push((row) => row[field] === value);
        return builder;
      },
      neq: (field: string, value: any) => {
        state.filters.push((row) => row[field] !== value);
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
      lte: (field: string, value: any) => {
        state.filters.push((row) => row[field] <= value);
        return builder;
      },
      filter: (field: string, operator: string, value: any) => {
        if (operator === 'lt') state.filters.push((row) => row[field] < value);
        if (operator === 'gt') state.filters.push((row) => row[field] > value);
        if (operator === 'eq') state.filters.push((row) => row[field] === value);
        return builder;
      },
      order: (field: string, options?: { ascending?: boolean }) => {
        state.orderBy = { field, ascending: options?.ascending !== false };
        return builder;
      },
      limit: (count: number) => {
        state.limitCount = count;
        return builder;
      },
      range: (from: number, to: number) => {
        state.range = { from, to };
        return builder;
      },
      or: () => builder,
      not: () => builder,
      insert: (payload: Row | Row[]) => {
        state.mutation = { kind: 'insert', payload };
        return builder;
      },
      upsert: (payload: Row | Row[], options?: { onConflict?: string }) => {
        state.mutation = { kind: 'upsert', payload, onConflict: options?.onConflict };
        return builder;
      },
      update: (payload: Row) => {
        state.mutation = { kind: 'update', payload };
        return builder;
      },
      delete: () => {
        state.mutation = { kind: 'delete' };
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: clone(materialize()[0] || null), error: null }),
      single: () => {
        const result = applyMutation();
        return Promise.resolve({ data: clone((result.data || [])[0] || null), error: result.error });
      },
      then: (resolve: any, reject: any) => {
        const result = applyMutation();
        return Promise.resolve({
          data: state.head ? null : clone(result.data || []),
          error: result.error,
          count: result.count,
        }).then(resolve, reject);
      },
    };

    return builder;
  };

  return {
    convertUserIdToUuid: (value: string) => value,
    isRealDatabaseConfigured: true,
    supabaseAdmin: { from: (table: string) => makeBuilder(table) },
  };
});

jest.mock('../../src/services/financialImpactService', () => ({
  __esModule: true,
  ImpactStatus: { DETECTED: 'detected' },
  financialImpactService: { recordImpact: jest.fn(async () => undefined) },
}));

jest.mock('../../src/services/detection/confidenceCalibrator', () => ({
  calculateCalibratedConfidence: jest.fn(async (_anomalyType: string, confidence: number) => ({ calibrated_confidence: confidence })),
}));

jest.mock('../../src/services/closedLoopIntelligenceService', () => ({
  getAdaptiveDetectionDecision: jest.fn(async ({ rawConfidence }: { rawConfidence: number }) => ({
    suppressed: false,
    adjustedConfidence: rawConfidence,
    suppressionThreshold: 0,
    historicalApprovalRate: null,
    sampleSize: 0,
    adjustments: [],
  })),
}));

jest.mock('../../src/services/detection/patternAnalyzer', () => ({
  generateInsights: jest.fn(async () => undefined),
}));

import { CSVIngestionService } from '../../src/services/csvIngestionService';
import enhancedDetectionService from '../../src/services/enhancedDetectionService';
import { detectInboundAnomalies, storeInboundDetectionResults } from '../../src/services/detection/core/detectors/inboundAlgorithms';
import { classifyCommercialDecision } from '../../src/services/auditCommercialDecisionService';
import auditRunService from '../../src/services/auditRunService';

function file(name: string, text: string) {
  return { buffer: Buffer.from(text), originalname: name, mimetype: name.endsWith('.tsv') ? 'text/plain' : 'text/csv' };
}

async function ingestCleanManualAudit(service: CSVIngestionService) {
  return service.ingestFiles(SELLER_A, [
    file('truth-orders.csv', [
      'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal,CurrencyCode',
      'CLEAN-ORDER-1,2026-07-01T00:00:00Z,Shipped,100,USD',
    ].join('\n')),
    file('truth-shipments.csv', [
      'ShipmentId,ShipmentDate,AmazonOrderId,ReceivedDate,ShipmentStatus,QuantityShipped,QuantityReceived',
      'CLEAN-SHIP-1,2026-07-02T00:00:00Z,CLEAN-ORDER-1,2026-07-03T00:00:00Z,RECEIVED,1,1',
    ].join('\n')),
    file('truth-returns.csv', [
      'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId',
      'CLEAN-RETURN-1,2026-07-04T00:00:00Z,CUSTOMER_REQUEST,100,1,CLEAN-ORDER-1',
    ].join('\n')),
    file('truth-settlements.csv', [
      'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
      'CLEAN-SETTLEMENT-1,2026-07-05T00:00:00Z,refund,(100),0,USD,CLEAN-ORDER-1',
    ].join('\n')),
    file('truth-inventory.tsv', [
      'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID',
      'Receipt\t2026-07-01T00:00:00Z\tCLEAN-FNSKU-1\tCLEAN-SKU-1\t1\t\tCLEAN-RECEIPT-1',
      'Shipment\t2026-07-02T00:00:00Z\tCLEAN-FNSKU-1\tCLEAN-SKU-1\t1\t\tCLEAN-SHIPMENT-LEDGER-1',
    ].join('\n')),
    file('truth-financial-events.csv', [
      'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId',
      'Reimbursement,2026-07-06T00:00:00Z,0,USD,CLEAN-FINANCIAL-1',
    ].join('\n')),
    file('truth-fees.csv', [
      'FeeType,FeeAmount,PostedDate,CurrencyCode,EventId,Reference ID',
      'FBAFee,(15),2026-07-07T00:00:00Z,USD,CLEAN-FEE-1,CLEAN-FEE-REF-1',
    ].join('\n')),
    file('truth-transfers.csv', [
      'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value,currency',
      'CLEAN-TRANSFER-1,CLEAN-SKU-1,PHX6,MDW2,10,10,2026-07-01T00:00:00Z,25,USD',
    ].join('\n')),
  ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });
}

describe('Manual Audit truth test phase 1', () => {
  let service: CSVIngestionService;

  beforeEach(() => {
    Object.keys(tables).forEach((table) => delete tables[table]);
    tables.tenant_memberships = [{ user_id: SELLER_A, tenant_id: TENANT_A }];
    service = new CSVIngestionService();
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('CLEAN-R0-MULTI: a reconciled Manual Audit creates no actionable recovery value', async () => {
    const ingestion = await ingestCleanManualAudit(service);

    expect(ingestion.success).toBe(true);
    expect(ingestion.syncId).toMatch(/^csv_/);
    expect(tables.orders).toHaveLength(1);
    expect(tables.inventory_ledger_events).toHaveLength(3);
    expect(tables.inventory_transfers).toHaveLength(1);

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 0, estimatedRecovery: 0 });
    expect(tables.detection_results || []).toEqual([]);
  });

  it('CLEAN-INVENTORY: reconciled Manual ledger receipt and shipment movement produce no Whale Hunter loss value', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('clean-inventory.tsv', [
        'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReference ID',
        'Receipt\t2026-06-01T00:00:00Z\tCLEAN-INVENTORY-FNSKU-1\tCLEAN-INVENTORY-SKU-1\t1\tCLEAN-INVENTORY-RECEIPT-1',
        'Shipment\t2026-06-02T00:00:00Z\tCLEAN-INVENTORY-FNSKU-1\tCLEAN-INVENTORY-SKU-1\t1\tCLEAN-INVENTORY-SHIPMENT-1',
      ].join('\n')),
    ], { explicitType: 'inventory', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => ['lost_warehouse', 'lost_in_transit'].includes(row.anomaly_type))).toEqual([]);
  });

  it('CLEAN-REFUNDS: a mature Manual refund with one received matching return produces no Refund Trap value', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('clean-refunds-settlement.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
        'CLEAN-REFUNDS-SETTLEMENT-1,2026-06-01T00:00:00Z,refund,(100),0,USD,CLEAN-REFUNDS-ORDER-1',
      ].join('\n')),
      file('clean-refunds-return.csv', [
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId',
        'CLEAN-REFUNDS-RETURN-1,2026-06-02T00:00:00Z,CUSTOMER_REQUEST,100,1,CLEAN-REFUNDS-ORDER-1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => row.anomaly_type === 'refund_no_return')).toEqual([]);
  });

  it('CLEAN-TRANSFERS: equal Manual transfer sent and received quantities produce no Transfer Auditor value', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('clean-transfers.csv', [
        'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value,currency',
        'CLEAN-TRANSFERS-1,CLEAN-TRANSFERS-SKU-1,PHX6,MDW2,10,10,2026-06-01T00:00:00Z,25,USD',
      ].join('\n')),
    ], { explicitType: 'transfers', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => ['warehouse_transfer_loss', 'warehouse_transfer_overage_review'].includes(row.anomaly_type))).toEqual([]);
  });

  it('CLEAN-FEES: one legitimate uniquely referenced Manual fee produces no Fee Phantom duplicate value', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('clean-fees.csv', [
        'FeeType,FeeAmount,PostedDate,CurrencyCode,EventId,Reference ID,AmazonOrderId',
        'FBAFee,(15),2026-06-01T00:00:00Z,USD,CLEAN-FEES-EVENT-1,CLEAN-FEES-REF-1,CLEAN-FEES-ORDER-1',
      ].join('\n')),
    ], { explicitType: 'fees', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => row.anomaly_type === 'duplicate_fee_error')).toEqual([]);
  });

  it('ADVERSARIAL-SETTLEMENT-FEE-IS-NOT-REFUND: a negative settlement fee never becomes a Refund Trap recovery', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('adversarial-settlement-fee.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
        'ADVERSARIAL-FEE-SETTLEMENT-1,2026-06-01T00:00:00Z,fee,(100),0,USD,ADVERSARIAL-FEE-ORDER-1',
      ].join('\n')),
    ], { explicitType: 'settlements', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => row.anomaly_type === 'refund_no_return')).toEqual([]);
  });

  it('CLEAN-INBOUND: a mature closed inbound shipment with all units received produces no Inbound Inspector value', () => {
    const direct = detectInboundAnomalies(SELLER_A, 'csv_clean_inbound_1', {
      seller_id: SELLER_A,
      sync_id: 'csv_clean_inbound_1',
      inbound_shipment_items: [{
        id: 'CLEAN-INBOUND-ITEM-1',
        seller_id: SELLER_A,
        shipment_id: 'CLEAN-INBOUND-SHIPMENT-1',
        sku: 'CLEAN-INBOUND-SKU-1',
        fnsku: 'CLEAN-INBOUND-FNSKU-1',
        quantity_shipped: 10,
        quantity_received: 10,
        shipment_status: 'CLOSED',
        shipment_created_date: '2026-04-01T12:00:00.000Z',
        shipment_closed_date: '2026-05-01T12:00:00.000Z',
        created_at: '2026-05-01T12:00:00.000Z',
      }],
      reimbursement_events: [],
    } as any);

    expect(direct).toEqual([]);
  });

  it('WH-LOSS-ONE: a mature Manual Ledger loss produces one USD 20 estimated Whale Hunter recovery', async () => {
    const ledger = [
      'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID',
      'Receipt\t2026-06-01T00:00:00Z\tWH-FNSKU-1\tWH-SKU-1\t1\t\tWH-RECEIPT-1',
      'Damaged\t2026-06-02T00:00:00Z\tWH-FNSKU-1\tWH-SKU-1\t1\tM\tWH-DAMAGE-1',
    ].join('\n');
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('wh-loss-one.tsv', ledger),
    ], { explicitType: 'inventory', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    expect(tables.inventory_ledger_events).toHaveLength(3);

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 20 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      tenant_id: TENANT_A,
      seller_id: SELLER_A,
      sync_id: ingestion.syncId,
      anomaly_type: 'lost_warehouse',
      estimated_value: 20,
      source_type: 'csv_upload',
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      physical_loss_units: 1,
      valuation_source: 'DEFAULT_FALLBACK',
    });
  });

  it('WH-LOSS-MULTI: three mature unresolved Manual Ledger units produce one USD 60 Whale Hunter exposure', async () => {
    const ledger = [
      'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID',
      'Receipt\t2026-06-01T00:00:00Z\tWH-FNSKU-MULTI\tWH-SKU-MULTI\t3\t\tWH-MULTI-RECEIPT-1',
      'Damaged\t2026-06-02T00:00:00Z\tWH-FNSKU-MULTI\tWH-SKU-MULTI\t3\tM\tWH-MULTI-DAMAGE-1',
    ].join('\n');
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('wh-loss-multi.tsv', ledger),
    ], { explicitType: 'inventory', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 60 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'lost_warehouse',
      estimated_value: 60,
      sync_id: ingestion.syncId,
    });
    expect(tables.detection_results[0].evidence).toMatchObject({ physical_loss_units: 3 });
  });

  it('WH-FOUND-RECONCILED: a later found adjustment fully offsets the prior mature ledger loss', async () => {
    const ledger = [
      'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID',
      'Receipt\t2026-06-01T00:00:00Z\tWH-FNSKU-FOUND\tWH-SKU-FOUND\t1\t\tWH-FOUND-RECEIPT-1',
      'Damaged\t2026-06-02T00:00:00Z\tWH-FNSKU-FOUND\tWH-SKU-FOUND\t1\tM\tWH-FOUND-DAMAGE-1',
      'Found\t2026-06-03T00:00:00Z\tWH-FNSKU-FOUND\tWH-SKU-FOUND\t1\tF\tWH-FOUND-RECOVERY-1',
    ].join('\n');
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('wh-found-reconciled.tsv', ledger),
    ], { explicitType: 'inventory', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => ['lost_warehouse', 'lost_in_transit'].includes(row.anomaly_type))).toEqual([]);
  });

  it('WH-FULL-REIMB: a mature Manual Ledger loss with matching reimbursement leaves no Whale Hunter residual', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('wh-full-reimb-ledger.tsv', [
        'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID\tFulfillment Center',
        'Receipt\t2026-06-01T00:00:00Z\tWH-FULL-REIMB-FNSKU-1\tWH-FULL-REIMB-SKU-1\t1\t\tWH-FULL-REIMB-RECEIPT-1\tPHX6',
        'Damaged\t2026-06-02T00:00:00Z\tWH-FULL-REIMB-FNSKU-1\tWH-FULL-REIMB-SKU-1\t1\tM\tWH-FULL-REIMB-LOSS-1\tPHX6',
      ].join('\n')),
      file('wh-full-reimb-financial-events.csv', [
        'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId,SellerSKU,Quantity,FulfillmentCenterId',
        'Reimbursement,2026-06-05T00:00:00Z,20,USD,WH-FULL-REIMB-REIMB-1,WH-FULL-REIMB-SKU-1,1,PHX6',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => ['lost_warehouse', 'lost_in_transit'].includes(row.anomaly_type))).toEqual([]);
  });

  it('WH-PARTIAL-REIMB: a three-unit mature Manual Ledger loss with one reimbursed unit retains only a USD 40 Whale Hunter residual', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('wh-partial-reimb-ledger.tsv', [
        'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID\tFulfillment Center',
        'Receipt\t2026-06-01T00:00:00Z\tWH-PARTIAL-REIMB-FNSKU-1\tWH-PARTIAL-REIMB-SKU-1\t3\t\tWH-PARTIAL-REIMB-RECEIPT-1\tPHX6',
        'Damaged\t2026-06-02T00:00:00Z\tWH-PARTIAL-REIMB-FNSKU-1\tWH-PARTIAL-REIMB-SKU-1\t3\tM\tWH-PARTIAL-REIMB-LOSS-1\tPHX6',
      ].join('\n')),
      file('wh-partial-reimb-financial-events.csv', [
        'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId,SellerSKU,Quantity,FulfillmentCenterId',
        'Reimbursement,2026-06-05T00:00:00Z,20,USD,WH-PARTIAL-REIMB-REIMB-1,WH-PARTIAL-REIMB-SKU-1,1,PHX6',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    expect(tables.financial_events[0]).toMatchObject({
      sku: 'WH-PARTIAL-REIMB-SKU-1',
      quantity: 1,
    });
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 40 });
    const whale = (tables.detection_results || []).find((row) => ['lost_warehouse', 'lost_in_transit'].includes(row.anomaly_type));
    expect(whale).toMatchObject({ estimated_value: 40, sync_id: ingestion.syncId });
    expect(whale.evidence).toMatchObject({ physical_loss_units: 3, netted_reimbursement_units: 1, net_unresolved_units: 2 });
  });

  it('OVL-WHALE-SENTINEL: Whale Hunter owns the USD 40 unresolved loss while Sentinel stays zero-value integrity evidence', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('ovl-whale-sentinel-ledger.tsv', [
        'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID\tFulfillment Center',
        'Receipt\t2026-06-01T00:00:00Z\tOVL-WHALE-SENTINEL-FNSKU-1\tOVL-WHALE-SENTINEL-SKU-1\t3\t\tOVL-WHALE-SENTINEL-RECEIPT-1\tPHX6',
        'Damaged\t2026-06-02T00:00:00Z\tOVL-WHALE-SENTINEL-FNSKU-1\tOVL-WHALE-SENTINEL-SKU-1\t3\tM\tOVL-WHALE-SENTINEL-LOSS-1\tPHX6',
      ].join('\n')),
      file('ovl-whale-sentinel-financial-events.csv', [
        'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId,SellerSKU,Quantity,FulfillmentCenterId',
        'Reimbursement,2026-06-05T00:00:00Z,20,USD,OVL-WHALE-SENTINEL-REIMB-1,OVL-WHALE-SENTINEL-SKU-1,1,PHX6',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 40 });
    const whale = (tables.detection_results || []).find((row) => ['lost_warehouse', 'lost_in_transit'].includes(row.anomaly_type));
    const sentinel = (tables.detection_results || []).find((row) => row.anomaly_type === 'reimbursement_duplicate_missed');
    expect(whale).toMatchObject({ estimated_value: 40 });
    expect(sentinel).toMatchObject({ estimated_value: 0 });
    expect(sentinel.evidence).toMatchObject({
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
    });
    expect((tables.detection_results || []).reduce((sum, row) => sum + Number(row.estimated_value || 0), 0)).toBe(40);
  });

  it('WH-IMMATURE: a one-day-old Manual Ledger loss produces no positive Whale Hunter recovery', async () => {
    const ledger = [
      'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID',
      'Receipt\t2026-08-20T00:00:00Z\tWH-FNSKU-IMMATURE\tWH-SKU-IMMATURE\t1\t\tWH-IMMATURE-RECEIPT-1',
      'Damaged\t2026-08-21T00:00:00Z\tWH-FNSKU-IMMATURE\tWH-SKU-IMMATURE\t1\tM\tWH-IMMATURE-DAMAGE-1',
    ].join('\n');
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('wh-immature.tsv', ledger),
    ], { explicitType: 'inventory', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => ['lost_warehouse', 'lost_in_transit'].includes(row.anomaly_type))).toEqual([]);
  });

  it('RF-NO-RETURN: a mature USD 100 refund without a return produces one Refund Trap recovery', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('rf-orders.csv', [
        'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal,CurrencyCode',
        'RF-ORDER-1,2026-06-01T00:00:00Z,Shipped,100,USD',
      ].join('\n')),
      file('rf-settlements.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
        'RF-SETTLEMENT-1,2026-06-01T00:00:00Z,refund,(100),0,USD,RF-ORDER-1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 100 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'refund_no_return',
      estimated_value: 100,
      tenant_id: TENANT_A,
      seller_id: SELLER_A,
      sync_id: ingestion.syncId,
      source_type: 'csv_upload',
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      order_id: 'RF-ORDER-1',
      quantity_refunded: 1,
      unresolved_units: 1,
      reimbursed_value: 0,
      shortfall_delta: 100,
    });
  });

  it('RF-MATCHED-RETURN: a valid received return suppresses the mature refund-without-return claim', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('rf-match-orders.csv', [
        'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal,CurrencyCode',
        'RF-MATCH-ORDER-1,2026-06-01T00:00:00Z,Shipped,100,USD',
      ].join('\n')),
      file('rf-match-settlements.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
        'RF-MATCH-SETTLEMENT-1,2026-06-01T00:00:00Z,refund,(100),0,USD,RF-MATCH-ORDER-1',
      ].join('\n')),
      file('rf-match-returns.csv', [
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId',
        'RF-MATCH-RETURN-1,2026-06-02T00:00:00Z,CUSTOMER_REQUEST,100,1,RF-MATCH-ORDER-1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 0, estimatedRecovery: 0 });
    expect(tables.detection_results || []).toEqual([]);
  });

  it('RF-RETURN-REVIEW: a received return without refund evidence remains a zero-value review only', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('rf-return-review.csv', [
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId',
        'RF-RETURN-REVIEW-1,2026-06-01T00:00:00Z,CUSTOMER_REQUEST,,1,RF-RETURN-REVIEW-ORDER-1',
      ].join('\n')),
    ], { explicitType: 'returns', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 0 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'return_refund_missing_review',
      estimated_value: 0,
      sync_id: ingestion.syncId,
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
    });
  });

  it('RF-PARTIAL-RETURN: a two-unit USD 100 refund with one valid Manual return retains the USD 50 one-unit residual', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('rf-partial-return-settlement.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId,Quantity',
        'RF-PARTIAL-RETURN-REFUND-1,2026-06-01T00:00:00Z,refund,(100),0,USD,RF-PARTIAL-RETURN-ORDER-1,2',
      ].join('\n')),
      file('rf-partial-return-return.csv', [
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId',
        'RF-PARTIAL-RETURN-RETURN-1,2026-06-02T00:00:00Z,CUSTOMER_REQUEST,100,1,RF-PARTIAL-RETURN-ORDER-1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    expect(tables.settlements[0]).toMatchObject({
      amount: -100,
      metadata: { quantity: 2 },
    });
    expect(tables.returns[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantity: 1 }),
    ]));

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 50 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'refund_no_return',
      estimated_value: 50,
      tenant_id: TENANT_A,
      seller_id: SELLER_A,
      sync_id: ingestion.syncId,
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      order_id: 'RF-PARTIAL-RETURN-ORDER-1',
      quantity_refunded: 2,
      returned_units: 1,
      unresolved_units: 1,
      reimbursed_value: 0,
      shortfall_delta: 50,
    });
  });

  it('ISO-TENANT-SYNC: Tenant B return evidence with the same external order ID cannot suppress Tenant A refund recovery', async () => {
    tables.tenant_memberships.push({ user_id: SELLER_B, tenant_id: TENANT_B });
    const tenantA = await service.ingestFiles(SELLER_A, [
      file('iso-a-settlement.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
        'ISO-A-REFUND-1,2026-06-01T00:00:00Z,refund,(100),0,USD,ISO-SHARED-ORDER-1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });
    const tenantB = await service.ingestFiles(SELLER_B, [
      file('iso-b-return.csv', [
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId',
        'ISO-B-RETURN-1,2026-06-02T00:00:00Z,CUSTOMER_REQUEST,100,1,ISO-SHARED-ORDER-1',
      ].join('\n')),
    ], { explicitType: 'returns', tenantId: TENANT_B, storeId: STORE_B, triggerDetection: false });

    expect(tenantA.success).toBe(true);
    expect(tenantB.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      tenantA.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 100 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'refund_no_return',
      estimated_value: 100,
      tenant_id: TENANT_A,
      seller_id: SELLER_A,
      sync_id: tenantA.syncId,
    });
    expect((tables.detection_results || []).some((row) => row.tenant_id === TENANT_B)).toBe(false);
  });

  it('RF-PARTIAL-REIMB: a mature USD 100 refund with USD 40 reimbursement retains only the USD 60 residual', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('rf-partial-reimb-settlements.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
        'RF-PARTIAL-REFUND-1,2026-06-01T00:00:00Z,refund,(100),0,USD,RF-PARTIAL-ORDER-1',
        'RF-PARTIAL-REIMB-1,2026-06-05T00:00:00Z,reimbursement,40,0,USD,RF-PARTIAL-ORDER-1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 2, estimatedRecovery: 60 });
    const refund = (tables.detection_results || []).find((row) => row.anomaly_type === 'refund_no_return');
    const sentinel = (tables.detection_results || []).find((row) => row.anomaly_type === 'reimbursement_duplicate_missed');
    expect(refund).toMatchObject({
      anomaly_type: 'refund_no_return',
      estimated_value: 60,
      sync_id: ingestion.syncId,
    });
    expect(refund.evidence).toMatchObject({
      refund_amount: 100,
      reimbursed_value: 40,
      shortfall_delta: 60,
      unresolved_units: 1,
    });
    expect(sentinel).toMatchObject({
      anomaly_type: 'reimbursement_duplicate_missed',
      estimated_value: 0,
      sync_id: ingestion.syncId,
    });
    expect(sentinel.evidence).toMatchObject({
      detection_type: 'clawback_risk',
      potential_exposure_value: 40,
      value_label: 'potential_exposure',
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
    });
  });

  it('ADVERSARIAL-RF-ONE-REIMB-TWO-REFUNDS: one reimbursement cannot suppress two distinct mature refunds', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('adversarial-two-refunds-one-reimbursement.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId,Quantity',
        'ADVERSARIAL-RF-ONE-REIMB-REFUND-1,2026-06-01T00:00:00Z,refund,(100),0,USD,ADVERSARIAL-RF-ONE-REIMB-ORDER-1,1',
        'ADVERSARIAL-RF-ONE-REIMB-REFUND-2,2026-06-02T00:00:00Z,refund,(100),0,USD,ADVERSARIAL-RF-ONE-REIMB-ORDER-1,1',
        'ADVERSARIAL-RF-ONE-REIMB-REIMB-1,2026-06-05T00:00:00Z,reimbursement,100,0,USD,ADVERSARIAL-RF-ONE-REIMB-ORDER-1,1',
      ].join('\n')),
    ], { explicitType: 'settlements', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 100 });
    const refunds = (tables.detection_results || []).filter((row) => row.anomaly_type === 'refund_no_return');
    expect(refunds.reduce((sum, row) => sum + Number(row.estimated_value || 0), 0)).toBe(100);
  });

  it('OVL-REFUND-SENTINEL: Refund Trap owns the USD 60 refund residual while Sentinel stays zero-value integrity evidence', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('ovl-refund-sentinel-settlements.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
        'OVL-REFUND-SENTINEL-REFUND-1,2026-06-01T00:00:00Z,refund,(100),0,USD,OVL-REFUND-SENTINEL-ORDER-1',
        'OVL-REFUND-SENTINEL-REIMB-1,2026-06-05T00:00:00Z,reimbursement,40,0,USD,OVL-REFUND-SENTINEL-ORDER-1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 60 });
    const refund = (tables.detection_results || []).find((row) => row.anomaly_type === 'refund_no_return');
    const sentinel = (tables.detection_results || []).find((row) => row.anomaly_type === 'reimbursement_duplicate_missed');
    expect(refund).toMatchObject({ estimated_value: 60 });
    expect(sentinel).toMatchObject({ estimated_value: 0 });
    expect(sentinel.evidence).toMatchObject({
      detection_type: 'clawback_risk',
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
    });
    expect((tables.detection_results || []).reduce((sum, row) => sum + Number(row.estimated_value || 0), 0)).toBe(60);
  });

  it('RF-FULL-REIMB: a mature USD 100 refund with matching USD 100 reimbursement has no residual recovery', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('rf-full-reimb-settlements.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
        'RF-FULL-REFUND-1,2026-06-01T00:00:00Z,refund,(100),0,USD,RF-FULL-ORDER-1',
        'RF-FULL-REIMB-1,2026-06-05T00:00:00Z,reimbursement,100,0,USD,RF-FULL-ORDER-1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 0 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'reimbursement_duplicate_missed',
      estimated_value: 0,
      sync_id: ingestion.syncId,
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      detection_type: 'clawback_risk',
      potential_exposure_value: 100,
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
    });
    expect((tables.detection_results || []).some((row) => row.anomaly_type === 'refund_no_return')).toBe(false);
  });

  it('TR-PARTIAL: a declared Manual Transfer of ten sent and eight received produces one USD 50 recovery', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('tr-partial.csv', [
        'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value,currency',
        'TR-PARTIAL-1,TR-SKU-1,PHX6,MDW2,10,8,2026-06-01T00:00:00Z,25,USD',
      ].join('\n')),
    ], { explicitType: 'transfers', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 50 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'warehouse_transfer_loss',
      estimated_value: 50,
      tenant_id: TENANT_A,
      seller_id: SELLER_A,
      sync_id: ingestion.syncId,
      source_type: 'csv_upload',
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      transfer_id: 'TR-PARTIAL-1',
      quantity_sent: 10,
      quantity_received: 8,
      quantity_lost: 2,
      loss_type: 'partial_loss',
    });
  });

  it('TR-TOTAL: ten declared sent and zero received units produce one USD 250 Transfer Auditor recovery', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('tr-total.csv', [
        'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value,currency',
        'TR-TOTAL-1,TR-SKU-TOTAL,PHX6,MDW2,10,0,2026-06-01T00:00:00Z,25,USD',
      ].join('\n')),
    ], { explicitType: 'transfers', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 250 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'warehouse_transfer_loss',
      estimated_value: 250,
      sync_id: ingestion.syncId,
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      quantity_sent: 10,
      quantity_received: 0,
      quantity_lost: 10,
      loss_type: 'total_loss',
    });
  });

  it('OVL-WHALE-TRANSFER: a declared transfer shortage reconstructable from matching ledger legs has one USD 50 Transfer Auditor economic owner', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('ovl-whale-transfer.csv', [
        'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value,currency',
        'OVL-WHALE-TRANSFER-1,OVL-WHALE-TRANSFER-SKU-1,PHX6,MDW2,10,8,2026-06-01T00:00:00Z,25,USD',
      ].join('\n')),
      file('ovl-whale-transfer-ledger.tsv', [
        'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReference ID\tFulfillment Center\tUnit Cost',
        'Transfers\t2026-06-01T00:00:00Z\tOVL-WHALE-TRANSFER-FNSKU-1\tOVL-WHALE-TRANSFER-SKU-1\t-10\tOVL-WHALE-TRANSFER-1\tPHX6\t25',
        'Transfers\t2026-06-03T00:00:00Z\tOVL-WHALE-TRANSFER-FNSKU-1\tOVL-WHALE-TRANSFER-SKU-1\t8\tOVL-WHALE-TRANSFER-1\tMDW2\t25',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 50 });
    const transferRows = (tables.detection_results || []).filter((row) => row.anomaly_type === 'warehouse_transfer_loss');
    const whaleRows = (tables.detection_results || []).filter((row) => ['lost_warehouse', 'lost_in_transit'].includes(row.anomaly_type));
    expect(transferRows).toHaveLength(1);
    expect(transferRows[0]).toMatchObject({
      estimated_value: 50,
      evidence: expect.objectContaining({
        economic_rollup: expect.objectContaining({
          status: 'counted',
          counted_value: 50,
          authoritative_detector: 'Transfer Auditor',
        }),
      }),
    });
    expect(whaleRows).toHaveLength(1);
    expect(whaleRows[0]).toMatchObject({
      estimated_value: 50,
      evidence: expect.objectContaining({
        economic_rollup: expect.objectContaining({
          status: 'linked_not_counted',
          counted_value: 0,
          authoritative_detector: 'Transfer Auditor',
        }),
      }),
    });
    const countedRecovery = (tables.detection_results || []).reduce(
      (sum, row) => sum + Number(row.evidence?.economic_rollup?.counted_value ?? row.estimated_value ?? 0),
      0,
    );
    expect(countedRecovery).toBe(50);
  });

  it('TR-OVERAGE: eight sent and ten received units create only a zero-value overage review', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('tr-overage.csv', [
        'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value,currency',
        'TR-OVERAGE-1,TR-SKU-OVERAGE,PHX6,MDW2,8,10,2026-06-01T00:00:00Z,25,USD',
      ].join('\n')),
    ], { explicitType: 'transfers', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 0 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'warehouse_transfer_overage_review',
      estimated_value: 0,
      sync_id: ingestion.syncId,
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
      quantity_overage: 2,
    });
  });

  it('TR-BLANK-RECEIVED: unknown receipt quantity is rejected and never becomes a loss claim', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('tr-blank-received.csv', [
        'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value,currency',
        'TR-BLANK-RECEIVED-1,TR-SKU-2,PHX6,MDW2,10,,2026-06-01T00:00:00Z,25,USD',
      ].join('\n')),
    ], { explicitType: 'transfers', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: true });

    expect(ingestion).toMatchObject({ success: false, detectionTriggered: false });
    expect(ingestion.results[0].errors[0]).toContain('Missing required numeric field (quantity_received)');
    expect(tables.inventory_transfers || []).toEqual([]);
    expect(tables.detection_results || []).toEqual([]);
  });

  it('TR-BLANK-SENT: unknown sent quantity is rejected and never becomes an overage or loss claim', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('tr-blank-sent.csv', [
        'transfer_id,sku,from_fc,to_fc,quantity_sent,quantity_received,transfer_date,unit_value,currency',
        'TR-BLANK-SENT-1,TR-SKU-3,PHX6,MDW2,,10,2026-06-01T00:00:00Z,25,USD',
      ].join('\n')),
    ], { explicitType: 'transfers', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: true });

    expect(ingestion).toMatchObject({ success: false, detectionTriggered: false });
    expect(ingestion.results[0].errors[0]).toContain('Missing required numeric field (quantity_sent)');
    expect(tables.inventory_transfers || []).toEqual([]);
    expect(tables.detection_results || []).toEqual([]);
  });

  it('BG-DAMAGED: a mature Manual damaged-return record without reimbursement produces one Broken Goods recovery', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('bg-damaged-return.csv', [
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId,SKU,ASIN,Disposition',
        'BG-RETURN-1,2026-06-01T00:00:00Z,DAMAGED,20,1,BG-ORDER-1,BG-SKU-1,BG-ASIN-1,DAMAGED',
      ].join('\n')),
    ], { explicitType: 'returns', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 20 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'damaged_warehouse',
      estimated_value: 20,
      tenant_id: TENANT_A,
      seller_id: SELLER_A,
      sync_id: ingestion.syncId,
      source_type: 'csv_upload',
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      disposition: 'DAMAGED',
      reason_code: 'Q',
      unresolved_units: 1,
      reimbursed_value: 0,
    });
  });

  it('BG-FULL-REIMB: a mature damaged return with exact Manual reimbursement evidence leaves no Broken Goods residual', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('bg-full-reimb-return.csv', [
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId,SKU,ASIN,FNSKU,Disposition',
        'BG-FULL-REIMB-RETURN-1,2026-06-01T00:00:00Z,DAMAGED,20,1,BG-FULL-REIMB-ORDER-1,BG-FULL-REIMB-SKU-1,BG-FULL-REIMB-ASIN-1,BG-FULL-REIMB-FNSKU-1,DAMAGED',
      ].join('\n')),
      file('bg-full-reimb-settlement.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId,FNSKU,SellerSKU,Quantity',
        'BG-FULL-REIMB-SETTLEMENT-1,2026-06-05T00:00:00Z,reimbursement,20,0,USD,BG-FULL-REIMB-ORDER-1,BG-FULL-REIMB-FNSKU-1,BG-FULL-REIMB-SKU-1,1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => row.anomaly_type === 'damaged_warehouse')).toEqual([]);
  });

  it('BG-PARTIAL-REIMB: a mature two-unit damaged return with one exact reimbursement retains only the USD 20 Broken Goods residual', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('bg-partial-reimb-return.csv', [
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId,SKU,ASIN,FNSKU,Disposition',
        'BG-PARTIAL-REIMB-RETURN-1,2026-06-01T00:00:00Z,DAMAGED,20,2,BG-PARTIAL-REIMB-ORDER-1,BG-PARTIAL-REIMB-SKU-1,BG-PARTIAL-REIMB-ASIN-1,BG-PARTIAL-REIMB-FNSKU-1,DAMAGED',
      ].join('\n')),
      file('bg-partial-reimb-settlement.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId,FNSKU,SellerSKU,Quantity',
        'BG-PARTIAL-REIMB-SETTLEMENT-1,2026-06-05T00:00:00Z,reimbursement,20,0,USD,BG-PARTIAL-REIMB-ORDER-1,BG-PARTIAL-REIMB-FNSKU-1,BG-PARTIAL-REIMB-SKU-1,1',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 20 });
    const brokenGoods = (tables.detection_results || []).filter((row) => row.anomaly_type === 'damaged_warehouse');
    expect(brokenGoods).toHaveLength(1);
    expect(brokenGoods[0]).toMatchObject({
      estimated_value: 20,
    });
    expect(brokenGoods[0].evidence).toMatchObject({
      reimbursed_quantity: 1,
      reimbursed_value: 20,
      unresolved_units: 2,
      total_value: 40,
    });
    const nonBrokenGoods = (tables.detection_results || []).filter((row) => row.anomaly_type !== 'damaged_warehouse');
    expect(nonBrokenGoods.every((row) => row.estimated_value === 0)).toBe(true);
    expect(nonBrokenGoods).toEqual(expect.arrayContaining([
      expect.objectContaining({
        anomaly_type: 'reimbursement_duplicate_missed',
        estimated_value: 0,
        evidence: expect.objectContaining({
          detection_type: 'clawback_risk',
          review_tier: 'review_only',
          claim_readiness: 'not_claim_ready',
        }),
      }),
    ]));
  });

  it('BG-NORMAL-RETURN: a normal received return with a valid refund produces no Broken Goods claim', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('bg-normal-return.csv', [
        'ReturnId,ReturnDate,ReturnReason,RefundAmount,Quantity,AmazonOrderId,SKU,ASIN,Disposition',
        'BG-NORMAL-RETURN-1,2026-06-01T00:00:00Z,CUSTOMER_REQUEST,20,1,BG-NORMAL-ORDER-1,BG-NORMAL-SKU-1,BG-NORMAL-ASIN-1,SELLABLE',
      ].join('\n')),
    ], { explicitType: 'returns', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    expect((tables.detection_results || []).filter((row) => row.anomaly_type === 'damaged_warehouse')).toEqual([]);
    expect((tables.detection_results || []).every((row) => row.estimated_value === 0)).toBe(true);
  });

  it('OVL-INBOUND-WHALE: distinct inbound and ledger business references sharing an item identity retain separate USD 40 and USD 20 exposures', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('ovl-inbound-whale-ledger.tsv', [
        'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID',
        'Receipt\t2026-06-01T00:00:00Z\tOVL-INBOUND-WHALE-FNSKU-1\tOVL-INBOUND-WHALE-SKU-1\t1\t\tOVL-INBOUND-WHALE-LEDGER-RECEIPT-1',
        'Damaged\t2026-06-02T00:00:00Z\tOVL-INBOUND-WHALE-FNSKU-1\tOVL-INBOUND-WHALE-SKU-1\t1\tM\tOVL-INBOUND-WHALE-LEDGER-LOSS-1',
      ].join('\n')),
    ], { explicitType: 'inventory', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });
    const whalePipeline = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A, ingestion.syncId, 'manual', { tenantId: TENANT_A, source: 'manual_truth_test' },
    );
    const inbound = detectInboundAnomalies(SELLER_A, ingestion.syncId, {
      seller_id: SELLER_A,
      sync_id: ingestion.syncId,
      inbound_shipment_items: [{
        id: 'OVL-INBOUND-WHALE-ITEM-1',
        seller_id: SELLER_A,
        shipment_id: 'OVL-INBOUND-WHALE-SHIPMENT-1',
        sku: 'OVL-INBOUND-WHALE-SKU-1',
        fnsku: 'OVL-INBOUND-WHALE-FNSKU-1',
        quantity_shipped: 10,
        quantity_received: 8,
        shipment_status: 'CLOSED',
        shipment_created_date: '2026-04-01T00:00:00.000Z',
        shipment_closed_date: '2026-05-01T00:00:00.000Z',
        created_at: '2026-05-01T00:00:00.000Z',
      }],
      reimbursement_events: [],
    } as any);
    await storeInboundDetectionResults(inbound);

    expect(whalePipeline).toMatchObject({ success: true, estimatedRecovery: 20 });
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({ anomaly_type: 'shipment_shortage', estimated_value: 40, shipment_id: 'OVL-INBOUND-WHALE-SHIPMENT-1' });
    const whale = (tables.detection_results || []).find((row) => ['lost_warehouse', 'lost_in_transit'].includes(row.anomaly_type));
    const inboundRow = (tables.detection_results || []).find((row) => row.anomaly_type === 'shipment_shortage');
    expect(whale).toMatchObject({ estimated_value: 20 });
    expect(whale.evidence.transfer_reference_ids || []).not.toContain('OVL-INBOUND-WHALE-SHIPMENT-1');
    expect(inboundRow).toMatchObject({ estimated_value: 40 });
    expect(Number(whale.estimated_value) + Number(inboundRow.estimated_value)).toBe(60);
  });

  it('IN-SHORTAGE: a mature closed inbound shortage produces one USD 40 estimated Inbound Inspector recovery without Connected-v0 gate coupling', async () => {
    const syncId = 'csv_manual_inbound_shortage_1';
    const direct = detectInboundAnomalies(SELLER_A, syncId, {
      seller_id: SELLER_A,
      sync_id: syncId,
      inbound_shipment_items: [{
        id: 'IN-SHORTAGE-ITEM-1',
        seller_id: SELLER_A,
        shipment_id: 'IN-SHORTAGE-1',
        sku: 'IN-SKU-1',
        fnsku: 'IN-FNSKU-1',
        quantity_shipped: 10,
        quantity_received: 8,
        shipment_status: 'CLOSED',
        shipment_created_date: '2026-04-01T00:00:00.000Z',
        shipment_closed_date: '2026-05-01T00:00:00.000Z',
        created_at: '2026-05-01T00:00:00.000Z',
      }],
      reimbursement_events: [],
    } as any);

    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({
      anomaly_type: 'shipment_shortage',
      estimated_value: 40,
      shipment_id: 'IN-SHORTAGE-1',
      sku: 'IN-SKU-1',
    });
    expect(direct[0].evidence).toMatchObject({
      expected_sent_units: 10,
      observed_received_units: 8,
      unresolved_units: 2,
      claimable_units: 2,
    });

    await storeInboundDetectionResults(direct);
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'shipment_shortage',
      estimated_value: 40,
      tenant_id: TENANT_A,
      seller_id: SELLER_A,
      sync_id: syncId,
      source_type: 'csv_upload',
    });
  });

  it('IN-MISSING: a mature closed inbound shipment with ten expected and zero received produces one USD 200 missing claim', async () => {
    const syncId = 'csv_manual_inbound_missing_1';
    const direct = detectInboundAnomalies(SELLER_A, syncId, {
      seller_id: SELLER_A,
      sync_id: syncId,
      inbound_shipment_items: [{
        id: 'IN-MISSING-ITEM-1',
        seller_id: SELLER_A,
        shipment_id: 'IN-MISSING-1',
        sku: 'IN-SKU-MISSING-1',
        fnsku: 'IN-FNSKU-MISSING-1',
        quantity_shipped: 10,
        quantity_received: 0,
        shipment_status: 'CLOSED',
        shipment_created_date: '2026-04-01T00:00:00.000Z',
        shipment_closed_date: '2026-05-01T00:00:00.000Z',
        created_at: '2026-05-01T00:00:00.000Z',
      }],
      reimbursement_events: [],
    } as any);

    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({
      anomaly_type: 'shipment_missing',
      estimated_value: 200,
      shipment_id: 'IN-MISSING-1',
      sku: 'IN-SKU-MISSING-1',
    });
    expect(direct[0].evidence).toMatchObject({
      expected_sent_units: 10,
      observed_received_units: 0,
      unresolved_units: 10,
      claimable_units: 10,
    });

    await storeInboundDetectionResults(direct);
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'shipment_missing',
      estimated_value: 200,
      sync_id: syncId,
      source_type: 'csv_upload',
    });
  });

  it('IN-FULL-REIMB: a mature two-unit inbound shortage fully reimbursed by exact shipment evidence has no residual claim', () => {
    const direct = detectInboundAnomalies(SELLER_A, 'csv_manual_inbound_full_reimb_1', {
      seller_id: SELLER_A,
      sync_id: 'csv_manual_inbound_full_reimb_1',
      inbound_shipment_items: [{
        id: 'IN-FULL-REIMB-ITEM-1',
        seller_id: SELLER_A,
        shipment_id: 'IN-FULL-REIMB-1',
        sku: 'IN-FULL-REIMB-SKU-1',
        fnsku: 'IN-FULL-REIMB-FNSKU-1',
        quantity_shipped: 10,
        quantity_received: 8,
        shipment_status: 'CLOSED',
        shipment_created_date: '2026-04-01T00:00:00.000Z',
        shipment_closed_date: '2026-05-01T00:00:00.000Z',
        created_at: '2026-05-01T00:00:00.000Z',
      }],
      reimbursement_events: [{
        seller_id: SELLER_A,
        shipment_id: 'IN-FULL-REIMB-1',
        sku: 'IN-FULL-REIMB-SKU-1',
        reimbursement_amount: 40,
        reimbursement_date: '2026-05-05T00:00:00.000Z',
      }],
    } as any);

    expect(direct).toEqual([]);
  });

  it('IN-PARTIAL-REIMB: a mature two-unit inbound shortage with a USD 20 exact reimbursement retains only one USD 20 residual', () => {
    const direct = detectInboundAnomalies(SELLER_A, 'csv_manual_inbound_partial_reimb_1', {
      seller_id: SELLER_A,
      sync_id: 'csv_manual_inbound_partial_reimb_1',
      inbound_shipment_items: [{
        id: 'IN-PARTIAL-REIMB-ITEM-1',
        seller_id: SELLER_A,
        shipment_id: 'IN-PARTIAL-REIMB-1',
        sku: 'IN-PARTIAL-REIMB-SKU-1',
        fnsku: 'IN-PARTIAL-REIMB-FNSKU-1',
        quantity_shipped: 10,
        quantity_received: 8,
        shipment_status: 'CLOSED',
        shipment_created_date: '2026-04-01T00:00:00.000Z',
        shipment_closed_date: '2026-05-01T00:00:00.000Z',
        created_at: '2026-05-01T00:00:00.000Z',
      }],
      reimbursement_events: [{
        seller_id: SELLER_A,
        shipment_id: 'IN-PARTIAL-REIMB-1',
        sku: 'IN-PARTIAL-REIMB-SKU-1',
        reimbursement_amount: 20,
        reimbursement_date: '2026-05-05T00:00:00.000Z',
      }],
    } as any);

    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ anomaly_type: 'shipment_shortage', estimated_value: 20 });
    expect(direct[0].evidence).toMatchObject({
      reimbursed_value: 20,
      estimated_reimbursed_units_equivalent: 1,
      unresolved_units: 2,
      claimable_units: 1,
    });
  });

  it('IN-IMMATURE: a closed two-unit inbound shortage one day before the 90-day maturity threshold has zero claim value', () => {
    const direct = detectInboundAnomalies(SELLER_A, 'csv_manual_inbound_immature_1', {
      seller_id: SELLER_A,
      sync_id: 'csv_manual_inbound_immature_1',
      inbound_shipment_items: [{
        id: 'IN-IMMATURE-ITEM-1',
        seller_id: SELLER_A,
        shipment_id: 'IN-IMMATURE-1',
        sku: 'IN-IMMATURE-SKU-1',
        fnsku: 'IN-IMMATURE-FNSKU-1',
        quantity_shipped: 10,
        quantity_received: 8,
        shipment_status: 'CLOSED',
        shipment_created_date: '2026-05-01T12:00:00.000Z',
        shipment_closed_date: '2026-05-25T12:00:00.000Z',
        created_at: '2026-05-25T12:00:00.000Z',
      }],
      reimbursement_events: [],
    } as any);

    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({
      anomaly_type: 'inbound_shortage_review',
      estimated_value: 0,
      shipment_id: 'IN-IMMATURE-1',
    });
    expect(direct[0].evidence).toMatchObject({
      quantity_gap: 2,
      potential_value: 40,
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
      days_until_claim_maturity: 1,
    });
  });

  it('IN-NULL-RECEIPT: an absent provider receipt never becomes an inbound shortage or missing claim', () => {
    const direct = detectInboundAnomalies(SELLER_A, 'csv_manual_inbound_null_receipt_1', {
      seller_id: SELLER_A,
      sync_id: 'csv_manual_inbound_null_receipt_1',
      inbound_shipment_items: [{
        id: 'IN-NULL-RECEIPT-ITEM-1',
        seller_id: SELLER_A,
        shipment_id: 'IN-NULL-RECEIPT-1',
        sku: 'IN-SKU-2',
        fnsku: 'IN-FNSKU-2',
        quantity_shipped: 10,
        quantity_received: null,
        shipment_status: 'CLOSED',
        shipment_created_date: '2026-04-01T00:00:00.000Z',
        shipment_closed_date: '2026-05-01T00:00:00.000Z',
        created_at: '2026-05-01T00:00:00.000Z',
      }],
      reimbursement_events: [],
    } as any);

    expect(direct).toEqual([]);
  });

  it('FEE-DUPLICATE: two strictly identical Manual fee charges create one USD 15 Fee Phantom recovery', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('fee-duplicate.csv', [
        'FeeType,FeeAmount,PostedDate,CurrencyCode,EventId,Reference ID,AmazonOrderId,SellerSKU',
        'FBAFee,15,2026-07-01T00:00:00Z,USD,FEE-DUP-1,FEE-REF-1,FEE-ORDER-1,FEE-SKU-1',
        'FBAFee,15,2026-07-01T00:00:00Z,USD,FEE-DUP-2,FEE-REF-1,FEE-ORDER-1,FEE-SKU-1',
      ].join('\n')),
    ], { explicitType: 'fees', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    expect(tables.financial_events).toHaveLength(2);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 3, estimatedRecovery: 15 });
    const duplicate = (tables.detection_results || []).find((row) => row.anomaly_type === 'duplicate_fee_error');
    const reviews = (tables.detection_results || []).filter((row) => row.anomaly_type === 'fee_sign_polarity_review');
    expect(duplicate).toMatchObject({
      anomaly_type: 'duplicate_fee_error',
      estimated_value: 15,
      tenant_id: TENANT_A,
      seller_id: SELLER_A,
      sync_id: ingestion.syncId,
      source_type: 'csv_upload',
    });
    expect(duplicate.evidence).toMatchObject({
      fee_type: 'FBAFee',
      charged_amount: 30,
      expected_amount: 15,
      overcharge_amount: 15,
      evidence_class: 'STRICT_IDENTITY_MATCH',
    });
    expect(reviews).toHaveLength(2);
    expect(reviews.every((row) => row.estimated_value === 0)).toBe(true);
  });

  it('FEE-LEGIT-SAME-AMOUNT: equal-value fees with distinct hard order identities produce no duplicate claim', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('fee-legit-same-amount.csv', [
        'FeeType,FeeAmount,PostedDate,CurrencyCode,EventId,Reference ID,AmazonOrderId,SellerSKU',
        'FBAFee,15,2026-07-01T00:00:00Z,USD,FEE-LEGIT-1,FEE-LEGIT-REF-1,FEE-LEGIT-ORDER-1,FEE-LEGIT-SKU-1',
        'FBAFee,15,2026-07-01T00:00:00Z,USD,FEE-LEGIT-2,FEE-LEGIT-REF-2,FEE-LEGIT-ORDER-2,FEE-LEGIT-SKU-1',
      ].join('\n')),
    ], { explicitType: 'fees', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 2, estimatedRecovery: 0 });
    expect((tables.detection_results || []).some((row) => row.anomaly_type === 'duplicate_fee_error')).toBe(false);
    expect((tables.detection_results || []).filter((row) => row.anomaly_type === 'fee_sign_polarity_review')).toHaveLength(2);
    expect((tables.detection_results || []).every((row) => row.estimated_value === 0)).toBe(true);
  });

  it('FEE-SIGN-REVIEW: an isolated positive Manual fee remains zero-value review evidence, never recovery', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('fee-sign-review.csv', [
        'FeeType,FeeAmount,PostedDate,CurrencyCode,EventId,Reference ID,AmazonOrderId,SellerSKU',
        'FBAFee,45,2026-07-01T00:00:00Z,USD,FEE-SIGN-1,FEE-SIGN-REF-1,FEE-SIGN-ORDER-1,FEE-SIGN-SKU-1',
      ].join('\n')),
    ], { explicitType: 'fees', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 0 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'fee_sign_polarity_review',
      estimated_value: 0,
      sync_id: ingestion.syncId,
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
      value_label: 'potential_exposure',
    });
  });

  it('FEE-BLANK: an unknown Manual fee amount is rejected before canonical evidence or findings exist', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('fee-blank.csv', [
        'FeeType,FeeAmount,PostedDate,CurrencyCode,EventId,Reference ID',
        'FBAFee,,2026-07-01T00:00:00Z,USD,FEE-BLANK-1,FEE-BLANK-REF-1',
      ].join('\n')),
    ], { explicitType: 'fees', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: true });

    expect(ingestion).toMatchObject({ success: false, detectionTriggered: false });
    expect(ingestion.results[0].errors[0]).toContain('Missing required monetary field (fee_amount)');
    expect(tables.financial_events || []).toEqual([]);
    expect(tables.detection_results || []).toEqual([]);
  });

  it('SE-REIMB-EXCESS: a reimbursement above a fully matched Manual loss is review-only integrity evidence, never recovery', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('se-reimb-excess-ledger.tsv', [
        'Event Type\tDate\tFNSKU\tMSKU\tQuantity\tReason\tReference ID\tFulfillment Center\tUnit Cost',
        'Receipt\t2026-06-01T00:00:00Z\tSE-REIMB-EXCESS-KEY-1\tSE-REIMB-EXCESS-KEY-1\t1\t\tSE-REIMB-EXCESS-RECEIPT-1\tPHX6\t',
        'Damaged\t2026-06-02T00:00:00Z\tSE-REIMB-EXCESS-KEY-1\tSE-REIMB-EXCESS-KEY-1\t1\tM\tSE-REIMB-EXCESS-LOSS-1\tPHX6\t20',
      ].join('\n')),
      file('se-reimb-excess-financial.csv', [
        'EventType,PostedDate,Amount,CurrencyCode,AdjustmentEventId,SellerSKU,Quantity,FulfillmentCenterId',
        'Reimbursement,2026-06-05T00:00:00Z,40,USD,SE-REIMB-EXCESS-REIMB-1,SE-REIMB-EXCESS-KEY-1,1,PHX6',
      ].join('\n')),
    ], { tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, estimatedRecovery: 0 });
    const sentinel = (tables.detection_results || []).find((row) => row.anomaly_type === 'reimbursement_duplicate_missed');
    expect(sentinel).toMatchObject({ estimated_value: 0, sync_id: ingestion.syncId });
    expect(sentinel.evidence).toMatchObject({
      detection_type: 'duplicate_reimbursement',
      potential_exposure_value: 20,
      value_label: 'potential_exposure',
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
    });
    expect((tables.detection_results || []).filter((row) => ['lost_warehouse', 'lost_in_transit'].includes(row.anomaly_type))).toEqual([]);
  });

  it('SE-CLAWBACK: an asymmetric reimbursement reversal remains zero-value review evidence', async () => {
    const ingestion = await service.ingestFiles(SELLER_A, [
      file('se-clawback.csv', [
        'SettlementId,PostedDate,TransactionType,Amount,Fees,CurrencyCode,AmazonOrderId',
        'SE-CLAWBACK-REIMB-1,2026-06-01T00:00:00Z,reimbursement,100,0,USD,SE-CLAWBACK-ORDER-1',
        'SE-CLAWBACK-REVERSAL-1,2026-06-15T00:00:00Z,reimbursement,(120),0,USD,SE-CLAWBACK-ORDER-1',
      ].join('\n')),
    ], { explicitType: 'settlements', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(ingestion.success).toBe(true);
    const actual = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A,
      ingestion.syncId,
      'manual',
      { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(actual).toMatchObject({ success: true, detectionsFound: 1, estimatedRecovery: 0 });
    expect(tables.detection_results).toHaveLength(1);
    expect(tables.detection_results[0]).toMatchObject({
      anomaly_type: 'reimbursement_duplicate_missed',
      estimated_value: 0,
      sync_id: ingestion.syncId,
    });
    expect(tables.detection_results[0].evidence).toMatchObject({
      detection_type: 'ASYMMETRIC_CLAWBACK',
      potential_exposure_value: 20,
      review_tier: 'review_only',
      claim_readiness: 'not_claim_ready',
    });
  });

  it('IDEMPOTENT-RESUME: repeating identical Manual source evidence does not duplicate canonical rows or recovery value', async () => {
    const ordersCsv = [
      'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal,CurrencyCode',
      'IDEMPOTENT-RESUME-ORDER-1,2026-06-01T00:00:00Z,Shipped,100,USD',
    ].join('\n');

    const first = await service.ingestFiles(SELLER_A, [file('idempotent-resume-orders.csv', ordersCsv)], {
      explicitType: 'orders', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false,
    });
    const firstDetection = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A, first.syncId, 'manual', { tenantId: TENANT_A, source: 'manual_truth_test' },
    );
    const resumed = await service.ingestFiles(SELLER_A, [file('idempotent-resume-orders.csv', ordersCsv)], {
      explicitType: 'orders', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false,
    });
    const resumedDetection = await enhancedDetectionService.triggerDetectionPipeline(
      SELLER_A, resumed.syncId, 'manual', { tenantId: TENANT_A, source: 'manual_truth_test' },
    );

    expect(firstDetection).toMatchObject({ estimatedRecovery: 0 });
    expect(resumedDetection).toMatchObject({ estimatedRecovery: 0 });
    expect(tables.orders).toHaveLength(1);
    expect(tables.orders[0]).toMatchObject({ order_id: 'IDEMPOTENT-RESUME-ORDER-1', total_amount: 100 });
    expect(tables.detection_results || []).toEqual([]);
  });

  it('IDEMPOTENT-CHANGED: materially changed Manual source evidence is retained as updated canonical truth', async () => {
    const first = await service.ingestFiles(SELLER_A, [file('idempotent-changed-orders-v1.csv', [
      'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal,CurrencyCode',
      'IDEMPOTENT-CHANGED-ORDER-1,2026-06-01T00:00:00Z,Shipped,100,USD',
    ].join('\n'))], { explicitType: 'orders', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });
    const changed = await service.ingestFiles(SELLER_A, [file('idempotent-changed-orders-v2.csv', [
      'AmazonOrderId,PurchaseDate,OrderStatus,OrderTotal,CurrencyCode',
      'IDEMPOTENT-CHANGED-ORDER-1,2026-06-01T00:00:00Z,Shipped,125,USD',
    ].join('\n'))], { explicitType: 'orders', tenantId: TENANT_A, storeId: STORE_A, triggerDetection: false });

    expect(first.success).toBe(true);
    expect(changed.success).toBe(true);
    expect(tables.orders).toHaveLength(1);
    expect(tables.orders[0]).toMatchObject({ order_id: 'IDEMPOTENT-CHANGED-ORDER-1', total_amount: 125 });
  });

  it('COV-NO-RETURNS: otherwise usable Manual coverage with Returns unavailable is partial and never complete-clean', async () => {
    const summary = await (auditRunService as any).buildSummary(SELLER_A, TENANT_A, 'csv_cov_no_returns_1', {
      metadata: {
        ordersProcessed: 1,
        inventoryCount: 1,
        shipmentsCount: 1,
        settlementsCount: 1,
        feesCount: 1,
        totalItemsSynced: 5,
        sourceWarnings: [{ source: 'Returns' }],
      },
    });
    const decision = classifyCommercialDecision({
      currentAudit: { id: 'audit-cov-no-returns', user_id: SELLER_A, tenant_id: TENANT_A, completed_at: FIXED_NOW.toISOString() },
      currentSummary: summary,
      hasRecoveryWorkspace: false,
    });

    expect(summary).toMatchObject({
      finalStatus: 'partial_no_findings',
      sourcesUnavailable: ['Returns'],
      retryable: true,
    });
    expect(decision.commercial_state).not.toBe('R0-A');
    expect(decision.commercial_route).not.toBe('NO_SALE');
  });

  it.each([
    ['COV-NO-FINANCIAL', 'Financial Events'],
    ['COV-NO-INVENTORY', 'Inventory'],
    ['COV-NO-TRANSFERS', 'Transfers'],
    ['COV-NO-SETTLEMENTS', 'Settlements'],
    ['COV-MALFORMED-FEE', 'Fees'],
  ])('%s: one unavailable or failed Manual source remains partial and cannot be complete-clean', async (scenarioId, unavailableSource) => {
    const summary = await (auditRunService as any).buildSummary(SELLER_A, TENANT_A, `csv_${scenarioId.toLowerCase()}_1`, {
      metadata: {
        ordersProcessed: 1,
        inventoryCount: 1,
        shipmentsCount: 1,
        returnsCount: 1,
        settlementsCount: 1,
        feesCount: 1,
        totalItemsSynced: 6,
        sourceWarnings: [{ source: unavailableSource }],
      },
    });
    const decision = classifyCommercialDecision({
      currentAudit: { id: `audit-${scenarioId.toLowerCase()}`, user_id: SELLER_A, tenant_id: TENANT_A, completed_at: FIXED_NOW.toISOString() },
      currentSummary: summary,
      hasRecoveryWorkspace: false,
    });

    expect(summary).toMatchObject({
      finalStatus: 'partial_no_findings',
      sourcesUnavailable: [unavailableSource],
      retryable: true,
    });
    expect(decision.commercial_state).not.toBe('R0-A');
    expect(decision.commercial_route).not.toBe('NO_SALE');
  });

  it('COV-COMPLETE-CLEAN: usable metadata for all Manual sources produces complete no-findings coverage', async () => {
    const summary = await (auditRunService as any).buildSummary(SELLER_A, TENANT_A, 'csv_cov_complete_clean_1', {
      metadata: {
        ordersProcessed: 1,
        inventoryCount: 1,
        shipmentsCount: 1,
        returnsCount: 1,
        settlementsCount: 1,
        feesCount: 1,
        totalItemsSynced: 8,
        sourceWarnings: [],
      },
    });

    expect(summary).toMatchObject({
      finalStatus: 'complete_no_findings',
      sourcesUnavailable: [],
      retryable: false,
    });
  });

  it('COV-ZERO-ROW: recognized header-only source coverage is distinct from missing or malformed evidence', async () => {
    const summary = await (auditRunService as any).buildSummary(SELLER_A, TENANT_A, 'csv_cov_zero_row_1', {
      metadata: {
        totalItemsSynced: 0,
        sourceWarnings: [],
      },
    });

    expect(summary).toMatchObject({
      finalStatus: 'partial_no_findings',
      recordsReviewed: 0,
      sourcesUnavailable: [],
      retryable: true,
    });
  });

  it('ROUTE-RECOVER-ONCE: evidence-ready residual recovery routes to the one-time recovery path', () => {
    const decision = classifyCommercialDecision({
      currentAudit: {
        id: 'audit-recover-once',
        user_id: SELLER_A,
        tenant_id: TENANT_A,
        completed_at: FIXED_NOW.toISOString(),
      },
      currentSummary: {
        scopeValue: 60,
        findingsCount: 1,
        evidenceReadyCount: 1,
        recordsReviewed: 12,
        categories: ['refund_no_return'],
        sourcesReviewed: ['orders', 'settlements', 'returns'],
        sourcesUnavailable: [],
        finalStatus: 'complete_with_findings',
      },
      hasRecoveryWorkspace: false,
    });

    expect(decision).toMatchObject({
      commercial_state: 'VERIFIED_RECOVERY',
      commercial_route: 'RECOVER_ONCE',
      commercial_eligibility: 'eligible',
    });
  });

  it('ROUTE-CLEAN: a complete zero-recovery audit routes to R0-A / NO_SALE', () => {
    const decision = classifyCommercialDecision({
      currentAudit: {
        id: 'audit-clean',
        user_id: SELLER_A,
        tenant_id: TENANT_A,
        completed_at: FIXED_NOW.toISOString(),
      },
      currentSummary: {
        scopeValue: 0,
        findingsCount: 0,
        evidenceReadyCount: 0,
        recordsReviewed: 24,
        categories: [],
        sourcesReviewed: ['orders', 'shipments', 'returns', 'settlements', 'inventory_ledger_events', 'financial_events', 'fees', 'inventory_transfers'],
        sourcesUnavailable: [],
        finalStatus: 'complete_no_findings',
      },
      hasRecoveryWorkspace: false,
    });

    expect(decision).toMatchObject({
      commercial_state: 'R0-A',
      commercial_route: 'NO_SALE',
    });
  });

  it('ROUTE-RECOVERY-CONTROL: an active workspace entitlement routes positive evidence-ready recovery to Recovery Control', () => {
    const decision = classifyCommercialDecision({
      currentAudit: {
        id: 'audit-recovery-control',
        user_id: SELLER_A,
        tenant_id: TENANT_A,
        completed_at: FIXED_NOW.toISOString(),
      },
      currentSummary: {
        scopeValue: 60,
        findingsCount: 1,
        evidenceReadyCount: 1,
        recordsReviewed: 12,
        categories: ['refund_no_return'],
        sourcesReviewed: ['orders', 'settlements', 'returns'],
        sourcesUnavailable: [],
        finalStatus: 'complete_with_findings',
      },
      hasRecoveryWorkspace: true,
    });

    expect(decision).toMatchObject({
      commercial_state: 'WORKSPACE',
      commercial_route: 'RECOVERY_CONTROL',
      commercial_eligibility: 'eligible',
    });
  });

  it('ROUTE-EVIDENCE-LIMITED: no usable records routes to evidence remediation, never a clean audit', () => {
    const decision = classifyCommercialDecision({
      currentAudit: {
        id: 'audit-evidence-limited',
        user_id: SELLER_A,
        tenant_id: TENANT_A,
        completed_at: FIXED_NOW.toISOString(),
      },
      currentSummary: {
        scopeValue: 0,
        findingsCount: 0,
        evidenceReadyCount: 0,
        recordsReviewed: 0,
        categories: [],
        sourcesReviewed: [],
        sourcesUnavailable: ['inventory_ledger_events'],
        finalStatus: 'data_incomplete',
      },
      hasRecoveryWorkspace: false,
    });

    expect(decision).toMatchObject({
      commercial_state: 'R0-D',
      commercial_route: 'EVIDENCE_REMEDIATION',
      commercial_eligibility: 'recheck_later',
    });
  });
});
