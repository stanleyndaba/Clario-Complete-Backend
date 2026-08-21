import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  TransferLedgerObservationService,
  isExactWhseTransfersEvent,
} from '../../src/services/transferLedgerObservationService';

type Row = Record<string, any>;

const writes: Array<{ table: string; kind: 'insert' | 'upsert' | 'update'; rows: any; options?: any }> = [];
let ledgerRows: Row[] = [];
let queryError: string | null = null;
let observationPersistError: string | null = null;

function makeDb() {
  return {
    from: (table: string) => {
      const filters: Array<(row: Row) => boolean> = [];
      const builder: any = {
        select: () => builder,
        eq: (field: string, value: any) => {
          filters.push((row: Row) => row[field] === value);
          return builder;
        },
        update: (rows: any) => {
          writes.push({ table, kind: 'update', rows });
          return builder;
        },
        insert: async (rows: any) => {
          writes.push({ table, kind: 'insert', rows });
          return { error: null };
        },
        upsert: async (rows: any, options: any) => {
          writes.push({ table, kind: 'upsert', rows, options });
          return { error: table === 'transfer_ledger_observations' && observationPersistError ? { message: observationPersistError } : null };
        },
        then: (resolve: any, reject: any) => {
          if (table !== 'inventory_ledger_events') {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          if (queryError) {
            return Promise.resolve({ data: null, error: { message: queryError } }).then(resolve, reject);
          }
          const data = ledgerRows.filter(row => filters.every(filter => filter(row)));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const input = (overrides: Record<string, any> = {}) => ({
  userId: 'user-1',
  tenantId: 'tenant-a',
  storeId: 'store-1',
  marketplaceId: 'ATVPDKIKX0DER',
  syncId: 'audit-sync-1',
  ledgerSyncId: 'ledger-sync-1',
  historyCoverageStart: new Date('2025-01-01T00:00:00.000Z'),
  historyCoverageEnd: new Date('2026-01-01T00:00:00.000Z'),
  ledgerResult: { success: true, count: 1, message: 'ok' },
  observedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const ledgerRow = (overrides: Record<string, any> = {}): Row => ({
  tenant_id: 'tenant-a',
  user_id: 'user-1',
  store_id: 'store-1',
  sync_id: 'ledger-sync-1',
  source: 'sp_api',
  fnsku: 'FNSKU-1',
  sku: 'SKU-1',
  asin: 'ASIN-1',
  event_date: '2026-01-01T00:00:00.000Z',
  event_datetime: '2026-01-01T12:00:00.000Z',
  provider_event_type_raw: ' WhseTransfers ',
  reference_id: 'REF-1',
  raw_quantity: -5,
  quantity: 5,
  fulfillment_center: 'PHX7',
  country: 'US',
  disposition: 'SELLABLE',
  reason: 'internal movement',
  reconciled_quantity: 3,
  unreconciled_quantity: 2,
  provider_store: 'Amazon.com',
  provider_row_fingerprint: 'fingerprint-1',
  raw_payload: { 'Event Type': 'WhseTransfers', Quantity: '-5' },
  ...overrides,
});

describe('Transfer Auditor P1 zero-claim Ledger observation rail', () => {
  beforeEach(() => {
    writes.length = 0;
    ledgerRows = [];
    queryError = null;
    observationPersistError = null;
  });

  it('accepts only exact WhseTransfers taxonomy with defensive casing and whitespace', () => {
    expect(isExactWhseTransfersEvent(' WhseTransfers ')).toBe(true);
    expect(isExactWhseTransfersEvent('WHSETRANSFERS')).toBe(true);
    expect(isExactWhseTransfersEvent('Other Transfer')).toBe(false);
    expect(isExactWhseTransfersEvent('Transfer')).toBe(false);
  });

  it('preserves an exact WhseTransfers event as a non-claim observation', async () => {
    ledgerRows = [ledgerRow()];
    const result = await new TransferLedgerObservationService(makeDb() as any).observe(input());

    expect(result).toEqual(expect.objectContaining({
      healthStatus: 'AVAILABLE_DATA',
      observationCount: 1,
      ambiguityCount: 0,
      claimCapable: false,
    }));

    const observations = writes.find(write => write.table === 'transfer_ledger_observations');
    expect(observations?.rows).toEqual([expect.objectContaining({
      provider_event_type_raw: 'WhseTransfers',
      raw_quantity: -5,
      observation_state: 'PENDING_PROVIDER_SEMANTICS',
      marketplace_id: 'ATVPDKIKX0DER',
      provider_row_fingerprint: 'fingerprint-1',
    })]);
    expect(observations?.rows[0]).not.toHaveProperty('source_fc');
    expect(observations?.rows[0]).not.toHaveProperty('destination_fc');
    expect(observations?.rows[0]).not.toHaveProperty('quantity_sent');
    expect(observations?.rows[0]).not.toHaveProperty('quantity_received');
  });

  it('reports zero qualifying observations truthfully without writing a provider transfer', async () => {
    ledgerRows = [ledgerRow({ provider_event_type_raw: 'Shipments', provider_row_fingerprint: 'shipment-1' })];
    const result = await new TransferLedgerObservationService(makeDb() as any).observe(input());

    expect(result.healthStatus).toBe('AVAILABLE_ZERO_QUALIFYING_DATA');
    expect(result.observationCount).toBe(0);
    expect(writes.some(write => write.table === 'transfer_ledger_observations')).toBe(false);
  });

  it('fails closed for a broad transfer-like taxonomy that is not WhseTransfers', async () => {
    ledgerRows = [ledgerRow({ provider_event_type_raw: 'Other Transfer', provider_row_fingerprint: 'other-transfer-1' })];
    const result = await new TransferLedgerObservationService(makeDb() as any).observe(input());

    expect(result).toEqual(expect.objectContaining({
      healthStatus: 'UNSUPPORTED_EVENT_SEMANTICS',
      claimCapable: false,
      errorClass: 'NON_WHSETRANSFERS_TRANSFER_EVENT',
    }));
    expect(writes.some(write => write.table === 'transfer_ledger_observations')).toBe(false);
  });

  it('marks same-reference observations ambiguous and never promotes an exact pair', async () => {
    ledgerRows = [
      ledgerRow({ provider_row_fingerprint: 'outbound-row', raw_quantity: -5, fulfillment_center: 'PHX7' }),
      ledgerRow({ provider_row_fingerprint: 'inbound-row', raw_quantity: 5, fulfillment_center: 'ABE8' }),
    ];
    const result = await new TransferLedgerObservationService(makeDb() as any).observe(input());

    expect(result).toEqual(expect.objectContaining({
      healthStatus: 'AMBIGUOUS_TRANSFER_EVIDENCE',
      observationCount: 2,
      ambiguityCount: 2,
      claimCapable: false,
    }));
    const observations = writes.find(write => write.table === 'transfer_ledger_observations');
    expect(observations?.rows.map((row: Row) => row.observation_state)).toEqual(['AMBIGUOUS', 'AMBIGUOUS']);
    expect(JSON.stringify(observations?.rows)).not.toContain('EXACT_PAIR');
    expect(JSON.stringify(observations?.rows)).not.toContain('STRONG_PAIR');
  });

  it('records an unreferenced raw event as unpaired without inferring transfer direction or loss', async () => {
    ledgerRows = [ledgerRow({ reference_id: null, raw_quantity: -5, provider_row_fingerprint: 'unpaired-row' })];
    const result = await new TransferLedgerObservationService(makeDb() as any).observe(input());

    expect(result.healthStatus).toBe('AVAILABLE_DATA');
    const observations = writes.find(write => write.table === 'transfer_ledger_observations');
    expect(observations?.rows[0]).toEqual(expect.objectContaining({
      observation_state: 'UNPAIRED',
      raw_quantity: -5,
    }));
  });

  it('marks coverage partial instead of declaring a clean or mature transfer state', async () => {
    ledgerRows = [];
    const result = await new TransferLedgerObservationService(makeDb() as any).observe(input({ historyCoverageStatus: 'PARTIAL' }));

    expect(result).toEqual(expect.objectContaining({
      healthStatus: 'AVAILABLE_PARTIAL_HISTORY',
      historyCoverageStatus: 'PARTIAL',
      claimCapable: false,
    }));
  });

  it('fails closed on Ledger query failure', async () => {
    queryError = 'unexpected query failure';
    const result = await new TransferLedgerObservationService(makeDb() as any).observe(input());

    expect(result).toEqual(expect.objectContaining({
      healthStatus: 'PARSER_FAILURE',
      errorClass: 'LEDGER_OBSERVATION_QUERY_FAILURE',
      claimCapable: false,
    }));
  });

  it('keeps tenant, store, and parent sync scopes isolated and never touches claim paths', async () => {
    ledgerRows = [
      ledgerRow(),
      ledgerRow({ tenant_id: 'tenant-b', provider_row_fingerprint: 'other-tenant' }),
      ledgerRow({ store_id: 'store-2', provider_row_fingerprint: 'other-store' }),
      ledgerRow({ sync_id: 'ledger-sync-2', provider_row_fingerprint: 'other-sync' }),
    ];
    const result = await new TransferLedgerObservationService(makeDb() as any).observe(input());

    expect(result.observationCount).toBe(1);
    const touchedTables = new Set(writes.map(write => write.table));
    expect(touchedTables).toEqual(new Set([
      'transfer_ledger_source_runs',
      'transfer_ledger_observations',
    ]));
    expect(touchedTables.has('inventory_transfers')).toBe(false);
    expect(touchedTables.has('detection_results')).toBe(false);
    expect(touchedTables.has('financial_events')).toBe(false);
    expect(touchedTables.has('settlements')).toBe(false);
  });
});
