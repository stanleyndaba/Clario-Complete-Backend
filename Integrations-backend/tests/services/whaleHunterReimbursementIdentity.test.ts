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
});
