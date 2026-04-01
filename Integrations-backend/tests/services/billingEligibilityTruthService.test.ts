import { describe, expect, test } from '@jest/globals';
import {
  buildStableBillingIdempotencyKey,
  deriveCanonicalBillingEligibility,
  shouldEnqueueBackstopBilling,
} from '../../src/services/billingCanonicalTruth';

describe('billingEligibilityTruthService', () => {
  test('Test 1 - Approved, No Payout: not charge eligible without confirmed payout', () => {
    const eligibility = deriveCanonicalBillingEligibility({
      input_id: 'case-no-payout',
      dispute_case_id: 'case-no-payout',
      payout_status: 'not_paid',
      verified_paid_amount: 0,
      outstanding_amount: 100,
      variance_amount: 100,
      proof_of_payment: null,
    });

    expect(eligibility.charge_eligible).toBe(false);
    expect(eligibility.eligibility_reason).toBe('payout_not_confirmed');
    expect(eligibility.payout_status).toBe('not_paid');
    expect(shouldEnqueueBackstopBilling({
      billingStatus: null,
      billingTransactionId: null,
      chargeEligible: eligibility.charge_eligible,
    })).toBe(false);
  });

  test('Test 2 - Confirmed Payout: charge eligible only when canonical payout is fully paid', () => {
    const eligibility = deriveCanonicalBillingEligibility({
      input_id: 'case-paid',
      dispute_case_id: 'case-paid',
      payout_status: 'paid',
      verified_paid_amount: 125.44,
      outstanding_amount: 0,
      variance_amount: 0,
      proof_of_payment: {
        event_date: '2026-04-02T10:00:00.000Z',
        settlement_id: 'SET-123',
        payout_batch_id: 'PB-123',
      },
    });

    expect(eligibility.charge_eligible).toBe(true);
    expect(eligibility.eligibility_reason).toBe('payout_confirmed');
    expect(eligibility.verified_paid_amount).toBe(125.44);
    expect(shouldEnqueueBackstopBilling({
      billingStatus: null,
      billingTransactionId: null,
      chargeEligible: eligibility.charge_eligible,
    })).toBe(true);
  });

  test('Test 3 - Duplicate Event: stable billing idempotency key stays identical for the same payout identity', () => {
    const first = buildStableBillingIdempotencyKey({
      recoveryId: 'recovery-1',
      disputeCaseId: 'case-1',
    });
    const second = buildStableBillingIdempotencyKey({
      recoveryId: 'recovery-1',
      disputeCaseId: 'case-1',
    });

    expect(first).toBe('billing-recovery-recovery-1');
    expect(second).toBe(first);
  });

  test('Test 4 - Backstop Sweep: only payout-confirmed unresolved rows are eligible for enqueue', () => {
    const eligible = deriveCanonicalBillingEligibility({
      input_id: 'case-eligible',
      dispute_case_id: 'case-eligible',
      payout_status: 'paid',
      verified_paid_amount: 200,
      outstanding_amount: 0,
      variance_amount: 0,
      proof_of_payment: null,
    });
    const partial = deriveCanonicalBillingEligibility({
      input_id: 'case-partial',
      dispute_case_id: 'case-partial',
      payout_status: 'partially_paid',
      verified_paid_amount: 80,
      outstanding_amount: 20,
      variance_amount: 20,
      proof_of_payment: null,
    });

    expect(shouldEnqueueBackstopBilling({
      billingStatus: 'pending',
      billingTransactionId: 'tx-existing',
      chargeEligible: eligible.charge_eligible,
    })).toBe(false);
    expect(shouldEnqueueBackstopBilling({
      billingStatus: 'failed',
      billingTransactionId: 'tx-existing',
      chargeEligible: eligible.charge_eligible,
    })).toBe(true);
    expect(shouldEnqueueBackstopBilling({
      billingStatus: null,
      billingTransactionId: null,
      chargeEligible: partial.charge_eligible,
    })).toBe(false);
  });
});
