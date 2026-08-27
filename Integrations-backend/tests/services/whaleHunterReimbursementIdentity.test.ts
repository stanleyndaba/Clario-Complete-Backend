import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { detectLostInventory } from '../../src/services/detection/core/detectors/inventoryAlgorithms';

const FIXED_NOW = new Date('2026-08-22T12:00:00.000Z');

describe('Whale Hunter reimbursement identity reconciliation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('suppresses a mature FNSKU loss when a matching seller-SKU reimbursement supplies the recovered unit', () => {
    const results = detectLostInventory('seller-whale', 'csv_whale_reimbursement_identity_1', {
      seller_id: 'seller-whale',
      sync_id: 'csv_whale_reimbursement_identity_1',
      inventory_ledger: [
        {
          id: 'receipt-1',
          seller_id: 'seller-whale',
          fnsku: 'FNSKU-WHALE-1',
          sku: 'SELLER-SKU-WHALE-1',
          event_type: 'Receipt',
          quantity: 1,
          quantity_direction: 'in',
          event_date: '2026-06-01T00:00:00.000Z',
          fulfillment_center_id: 'PHX6',
          created_at: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'loss-1',
          seller_id: 'seller-whale',
          fnsku: 'FNSKU-WHALE-1',
          sku: 'SELLER-SKU-WHALE-1',
          event_type: 'Adjustment',
          quantity: 1,
          quantity_direction: 'out',
          reason: 'M',
          event_date: '2026-06-02T00:00:00.000Z',
          fulfillment_center_id: 'PHX6',
          created_at: '2026-06-02T00:00:00.000Z',
        },
      ],
      financial_events: [
        {
          seller_id: 'seller-whale',
          fnsku: null,
          sku: 'SELLER-SKU-WHALE-1',
          quantity: 1,
          approval_date: '2026-06-05T00:00:00.000Z',
          fulfillment_center_id: 'PHX6',
          event_type: 'reimbursement',
          amount: 20,
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it('S10-R1: does not let a non-reimbursement financial event offset a mature inventory loss', () => {
    const results = detectLostInventory('seller-whale', 'csv_s10_fee_not_reimbursement_1', {
      seller_id: 'seller-whale',
      sync_id: 'csv_s10_fee_not_reimbursement_1',
      inventory_ledger: [
        { id: 's10-r1-receipt', seller_id: 'seller-whale', fnsku: 'S10-R1-FNSKU', sku: 'S10-R1-SKU', event_type: 'Receipt', quantity: 1, quantity_direction: 'in', event_date: '2026-06-01T00:00:00.000Z', fulfillment_center_id: 'PHX6', created_at: '2026-06-01T00:00:00.000Z' },
        { id: 's10-r1-loss', seller_id: 'seller-whale', fnsku: 'S10-R1-FNSKU', sku: 'S10-R1-SKU', event_type: 'Adjustment', quantity: 1, quantity_direction: 'out', reason: 'M', event_date: '2026-06-02T00:00:00.000Z', fulfillment_center_id: 'PHX6', created_at: '2026-06-02T00:00:00.000Z' },
      ],
      financial_events: [{ seller_id: 'seller-whale', fnsku: null, sku: 'S10-R1-SKU', quantity: 1, approval_date: '2026-06-05T00:00:00.000Z', fulfillment_center_id: 'PHX6', event_type: 'fee', amount: -20 }],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ anomaly_type: 'lost_warehouse', estimated_value: 20 });
    expect(results[0].evidence).toMatchObject({ netted_reimbursement_units: 0, net_unresolved_units: 1 });
  });

  it('S10-R2: consumes a SKU-only reimbursement once across distinct FNSKU loss groups', () => {
    const ledger = ['A', 'B'].flatMap((suffix) => [
      { id: `s10-r2-${suffix}-receipt`, seller_id: 'seller-whale', fnsku: `S10-R2-FNSKU-${suffix}`, sku: 'S10-R2-SKU', event_type: 'Receipt' as const, quantity: 1, quantity_direction: 'in' as const, event_date: '2026-06-01T00:00:00.000Z', fulfillment_center_id: 'PHX6', created_at: '2026-06-01T00:00:00.000Z' },
      { id: `s10-r2-${suffix}-loss`, seller_id: 'seller-whale', fnsku: `S10-R2-FNSKU-${suffix}`, sku: 'S10-R2-SKU', event_type: 'Adjustment' as const, quantity: 1, quantity_direction: 'out' as const, reason: 'M', event_date: '2026-06-02T00:00:00.000Z', fulfillment_center_id: 'PHX6', created_at: '2026-06-02T00:00:00.000Z' },
    ]);
    const results = detectLostInventory('seller-whale', 'csv_s10_reimbursement_once_1', {
      seller_id: 'seller-whale',
      sync_id: 'csv_s10_reimbursement_once_1',
      inventory_ledger: ledger,
      financial_events: [{ seller_id: 'seller-whale', fnsku: null, sku: 'S10-R2-SKU', quantity: 1, approval_date: '2026-06-05T00:00:00.000Z', fulfillment_center_id: 'PHX6', event_type: 'reimbursement', amount: 20 }],
    });

    expect(results).toHaveLength(1);
    expect(results.reduce((sum, row) => sum + row.estimated_value, 0)).toBe(20);
    expect(results[0].evidence).toMatchObject({ net_unresolved_units: 1, netted_reimbursement_units: 0 });
  });

  it('S10-R3: does not let a reimbursement dated before a loss offset that later loss', () => {
    const results = detectLostInventory('seller-whale', 'csv_s10_pre_loss_reimbursement_1', {
      seller_id: 'seller-whale',
      sync_id: 'csv_s10_pre_loss_reimbursement_1',
      inventory_ledger: [
        { id: 's10-r3-receipt', seller_id: 'seller-whale', fnsku: 'S10-R3-FNSKU', sku: 'S10-R3-SKU', event_type: 'Receipt', quantity: 1, quantity_direction: 'in', event_date: '2026-06-01T00:00:00.000Z', fulfillment_center_id: 'PHX6', created_at: '2026-06-01T00:00:00.000Z' },
        { id: 's10-r3-loss', seller_id: 'seller-whale', fnsku: 'S10-R3-FNSKU', sku: 'S10-R3-SKU', event_type: 'Adjustment', quantity: 1, quantity_direction: 'out', reason: 'M', event_date: '2026-06-02T00:00:00.000Z', fulfillment_center_id: 'PHX6', created_at: '2026-06-02T00:00:00.000Z' },
      ],
      financial_events: [{ seller_id: 'seller-whale', fnsku: null, sku: 'S10-R3-SKU', quantity: 1, approval_date: '2026-05-01T00:00:00.000Z', fulfillment_center_id: 'PHX6', event_type: 'reimbursement', amount: 20 }],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ anomaly_type: 'lost_warehouse', estimated_value: 20 });
    expect(results[0].evidence).toMatchObject({ netted_reimbursement_units: 0, net_unresolved_units: 1, reimbursement_linkage_mode: 'NONE' });
  });

  it('does not fabricate reimbursed units when matching reimbursement quantity is absent', () => {
    const results = detectLostInventory('seller-whale', 'csv_whale_reimbursement_quantity_absent_1', {
      seller_id: 'seller-whale',
      sync_id: 'csv_whale_reimbursement_quantity_absent_1',
      inventory_ledger: [
        {
          id: 'receipt-quantity-absent-1',
          seller_id: 'seller-whale',
          fnsku: 'FNSKU-WHALE-QUANTITY-ABSENT-1',
          sku: 'SELLER-SKU-WHALE-QUANTITY-ABSENT-1',
          event_type: 'Receipt',
          quantity: 1,
          quantity_direction: 'in',
          event_date: '2026-06-01T00:00:00.000Z',
          fulfillment_center_id: 'PHX6',
          created_at: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'loss-quantity-absent-1',
          seller_id: 'seller-whale',
          fnsku: 'FNSKU-WHALE-QUANTITY-ABSENT-1',
          sku: 'SELLER-SKU-WHALE-QUANTITY-ABSENT-1',
          event_type: 'Adjustment',
          quantity: 1,
          quantity_direction: 'out',
          reason: 'M',
          event_date: '2026-06-02T00:00:00.000Z',
          fulfillment_center_id: 'PHX6',
          created_at: '2026-06-02T00:00:00.000Z',
        },
      ],
      financial_events: [
        {
          seller_id: 'seller-whale',
          fnsku: null,
          sku: 'SELLER-SKU-WHALE-QUANTITY-ABSENT-1',
          approval_date: '2026-06-05T00:00:00.000Z',
          fulfillment_center_id: 'PHX6',
          event_type: 'reimbursement',
          amount: 20,
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      anomaly_type: 'lost_warehouse',
      estimated_value: 20,
    });
    expect(results[0].evidence).toMatchObject({
      netted_reimbursement_units: 0,
      net_unresolved_units: 1,
    });
  });
});
