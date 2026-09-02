import { describe, expect, it, jest } from '@jest/globals';
import { detectRefundWithoutReturn, type RefundSyncedData } from '../../src/services/detection/core/detectors/refundAlgorithms';

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('Refund Trap claim readiness contract', () => {
  it('marks a reconciled refund-without-return candidate as claim-ready', () => {
    const sellerId = 'seller-readiness-test';
    const syncId = 'sync-readiness-test';
    const data: RefundSyncedData = {
      seller_id: sellerId,
      sync_id: syncId,
      refund_events: [{
        id: 'refund-1', seller_id: sellerId, order_id: 'ORDER-001', sku: 'SKU-001',
        refund_amount: 150, currency: 'USD',
        refund_date: new Date(Date.now() - 60 * 86400000).toISOString(),
        created_at: new Date().toISOString(),
      }],
      return_events: [],
      reimbursement_events: [],
    };

    const [finding] = detectRefundWithoutReturn(sellerId, syncId, data);

    expect(finding?.anomaly_type).toBe('refund_no_return');
    expect(finding?.estimated_value).toBe(150);
    expect(finding?.evidence).toMatchObject({
      review_tier: 'claim_candidate',
      claim_readiness: 'claim_ready',
      recommended_action: 'file_claim',
      value_label: 'estimated_recovery',
    });
  });
});
