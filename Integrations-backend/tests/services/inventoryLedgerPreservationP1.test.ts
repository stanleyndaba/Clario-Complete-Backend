import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const writes: Array<{ table: string; rows: any[]; options?: any }> = [];

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/security/auditLogger', () => ({
  logAuditEvent: jest.fn(async () => undefined),
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: jest.fn(async (rows: any[], options: any) => {
        writes.push({ table, rows, options });
        return { error: null };
      }),
      insert: jest.fn(async (rows: any[]) => {
        writes.push({ table, rows });
        return { error: null };
      }),
    }),
  },
}));

import { inventoryLedgerSyncService } from '../../src/services/inventoryLedgerSyncService';

const rawRow = (overrides: Record<string, string> = {}) => ({
  Date: '2026-01-10T00:00:00.000Z',
  'Date and Time': '2026-01-10T12:30:00.000Z',
  FNSKU: 'FNSKU-1',
  ASIN: 'ASIN-1',
  MSKU: 'SKU-1',
  Title: 'Example item',
  'Event Type': 'WhseTransfers',
  'Reference ID': 'REF-1',
  Quantity: '-5',
  'Fulfillment Center': 'PHX7',
  Country: 'US',
  Disposition: 'SELLABLE',
  Reason: 'internal movement',
  'Reconciled Quantity': '3',
  'Unreconciled Quantity': '2',
  Store: 'Amazon.com',
  ...overrides,
});

function convert(rows: Record<string, string>[]) {
  return (inventoryLedgerSyncService as any).convertReportRecords(
    rows,
    'user-1',
    'tenant-a',
    'store-1',
    'ledger-sync-1',
    'ATVPDKIKX0DER',
  );
}

async function persist(events: any[]) {
  await (inventoryLedgerSyncService as any).saveLedgerToDatabase(
    'user-1',
    events,
    'tenant-a',
    'store-1',
    'ledger-sync-1',
  );
}

describe('Transfer Auditor P1 Ledger preservation', () => {
  beforeEach(() => {
    writes.length = 0;
  });

  it('preserves material same-day WhseTransfers differences rather than collapsing them', async () => {
    const events = convert([
      rawRow(),
      rawRow({ 'Fulfillment Center': 'ABE8' }),
      rawRow({ Quantity: '-7' }),
      rawRow({ Quantity: '5' }),
      rawRow({ Country: 'CA', Disposition: 'DEFECTIVE' }),
      rawRow({ 'Reconciled Quantity': '4', 'Unreconciled Quantity': '1' }),
    ]);

    expect(new Set(events.map((event: any) => event.provider_row_fingerprint)).size).toBe(6);
    await persist(events);

    const canonicalWrite = writes.find(write => write.table === 'inventory_ledger');
    const providerEventWrite = writes.find(write =>
      write.table === 'inventory_ledger_events' && write.options?.onConflict === 'tenant_id,user_id,provider_row_fingerprint',
    );

    expect(canonicalWrite?.options.onConflict).toBe('tenant_id,seller_id,provider_row_fingerprint');
    expect(canonicalWrite?.rows).toHaveLength(6);
    expect(providerEventWrite?.rows).toHaveLength(6);
  });

  it('preserves raw signed quantity, reconciliation values, date-time, provider store, and compatibility direction', async () => {
    const [negative, positive] = convert([
      rawRow({ Quantity: '-5' }),
      rawRow({ Quantity: '5' }),
    ]);

    expect(negative).toEqual(expect.objectContaining({
      raw_quantity: -5,
      quantity: -5,
      provider_event_type_raw: 'WhseTransfers',
      event_datetime: '2026-01-10T12:30:00.000Z',
      provider_store: 'Amazon.com',
      reconciled_quantity: 3,
      unreconciled_quantity: 2,
    }));

    await persist([negative, positive]);
    const providerEventWrite = writes.find(write =>
      write.table === 'inventory_ledger_events' && write.options?.onConflict === 'tenant_id,user_id,provider_row_fingerprint',
    );

    expect(providerEventWrite?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ raw_quantity: -5, quantity: 5, quantity_direction: 'out' }),
      expect.objectContaining({ raw_quantity: 5, quantity: 5, quantity_direction: 'in' }),
    ]));
  });

  it('writes an exact duplicate provider row once and remains fingerprint-idempotent', async () => {
    const events = convert([rawRow(), rawRow()]);
    expect(events[0].provider_row_fingerprint).toBe(events[1].provider_row_fingerprint);

    await persist(events);

    const canonicalWrite = writes.find(write => write.table === 'inventory_ledger');
    const providerEventWrite = writes.find(write =>
      write.table === 'inventory_ledger_events' && write.options?.onConflict === 'tenant_id,user_id,provider_row_fingerprint',
    );
    expect(canonicalWrite?.rows).toHaveLength(1);
    expect(providerEventWrite?.rows).toHaveLength(1);
  });

  it('keeps raw taxonomy exact and does not collapse a transfer-like but distinct provider event', async () => {
    const events = convert([
      rawRow({ 'Event Type': 'WhseTransfers' }),
      rawRow({ 'Event Type': 'Other Transfer' }),
    ]);

    expect(events.map((event: any) => event.provider_event_type_raw)).toEqual(['WhseTransfers', 'Other Transfer']);
    expect(events[0].provider_row_fingerprint).not.toBe(events[1].provider_row_fingerprint);
  });
});
