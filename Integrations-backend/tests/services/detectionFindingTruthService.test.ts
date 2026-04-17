import { describe, expect, it } from '@jest/globals';
import { enrichDetectionFinding } from '../../src/services/detectionFindingTruthService';

describe('detectionFindingTruthService', () => {
  it('enriches claim-ready transfer losses with seller summary, policy basis, and filing movement', () => {
    const enriched = enrichDetectionFinding(
      {
        id: 'det-transfer-1',
        seller_id: 'seller-1',
        tenant_id: 'tenant-1',
        anomaly_type: 'warehouse_transfer_loss',
        estimated_value: 24,
        currency: 'USD',
        confidence_score: 0.82,
        created_at: '2026-04-16T16:58:00.000Z',
        evidence: {
          transfer_id: 'TRF8003',
          sku: 'SKU-TEST',
          quantity_sent: 40,
          quantity_received: 38,
          quantity_lost: 2,
          review_tier: 'claim_candidate',
          claim_readiness: 'claim_ready',
        },
      },
      {
        id: 'case-transfer-1',
        case_number: 'CASE-TRANSFER-1',
        status: 'submitted',
        filing_status: 'filed',
        eligibility_status: 'SAFETY_HOLD',
        block_reasons: [],
      }
    );

    expect(enriched.seller_summary.title).toBe('Warehouse Transfer Loss');
    expect(enriched.seller_summary.summary).toContain('40 sent, 38 received');
    expect(enriched.seller_summary.evidence_summary).toContain('Transfer TRF8003');
    expect(enriched.policy_basis.title).toContain('FBA inventory reimbursement');
    expect(enriched.filing_movement.label).toBe('Filed');
    expect(enriched.claim_readiness).toBe('claim_ready');
    expect(enriched.review_tier).toBe('claim_candidate');
  });

  it('keeps review-only findings visibly not claim-ready', () => {
    const enriched = enrichDetectionFinding({
      id: 'det-fee-1',
      seller_id: 'seller-1',
      tenant_id: 'tenant-1',
      anomaly_type: 'fee_sign_polarity_review',
      estimated_value: 0,
      currency: 'USD',
      created_at: '2026-04-16T16:58:00.000Z',
      evidence: {
        fee_type: 'storage_fee',
        raw_amount: 45,
        review_tier: 'review_only',
        claim_readiness: 'not_claim_ready',
        recommended_action: 'review',
        value_label: 'potential_exposure',
        why_not_claim_ready: 'Positive fee rows must be reviewed before claim value is inferred.',
      },
    });

    expect(enriched.seller_summary.title).toBe('Fee Sign Polarity Review');
    expect(enriched.review_tier).toBe('review_only');
    expect(enriched.claim_readiness).toBe('not_claim_ready');
    expect(enriched.value_label).toBe('potential_exposure');
    expect(enriched.why_not_claim_ready).toContain('Positive fee rows');
    expect(enriched.filing_movement.label).toBe('Preview finding');
  });
});
