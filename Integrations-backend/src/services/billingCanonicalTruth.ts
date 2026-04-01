import recoveryFinancialTruthService from './recoveryFinancialTruthService';

export type BillingEligibilityReason =
  | 'payout_confirmed'
  | 'partial_payout_not_final'
  | 'payout_not_confirmed'
  | 'payout_truth_unavailable';

export type BillingEligibilitySource =
  | 'canonical_financial_truth'
  | 'unavailable';

export type MinimalFinancialTruthSummary = {
  input_id?: string | null;
  dispute_case_id?: string | null;
  detection_result_id?: string | null;
  verified_paid_amount?: number | null;
  payout_status?: 'not_paid' | 'partially_paid' | 'paid' | null;
  outstanding_amount?: number | null;
  variance_amount?: number | null;
  financial_event_count?: number | null;
  proof_of_payment?: {
    amount?: number | null;
    currency?: string | null;
    event_date?: string | null;
    reference_id?: string | null;
    settlement_id?: string | null;
    payout_batch_id?: string | null;
    source?: string | null;
  } | null;
};

export type CanonicalBillingEligibility = {
  dispute_case_id: string | null;
  detection_result_id: string | null;
  charge_eligible: boolean;
  eligibility_source: BillingEligibilitySource;
  eligibility_reason: BillingEligibilityReason;
  verified_paid_amount: number | null;
  verified_paid_amount_cents: number | null;
  payout_status: 'not_paid' | 'partially_paid' | 'paid' | null;
  outstanding_amount: number | null;
  variance_amount: number | null;
  financial_event_count: number;
  proof_of_payment: MinimalFinancialTruthSummary['proof_of_payment'] | null;
};

export function deriveCanonicalBillingEligibility(summary?: MinimalFinancialTruthSummary | null): CanonicalBillingEligibility {
  if (!summary) {
    return {
      dispute_case_id: null,
      detection_result_id: null,
      charge_eligible: false,
      eligibility_source: 'unavailable',
      eligibility_reason: 'payout_truth_unavailable',
      verified_paid_amount: null,
      verified_paid_amount_cents: null,
      payout_status: null,
      outstanding_amount: null,
      variance_amount: null,
      financial_event_count: 0,
      proof_of_payment: null,
    };
  }

  const verifiedPaidAmount = Number(summary.verified_paid_amount ?? 0);
  const normalizedVerifiedPaidAmount = Number.isFinite(verifiedPaidAmount)
    ? Number(verifiedPaidAmount.toFixed(2))
    : 0;
  const verifiedPaidAmountCents = Math.round(normalizedVerifiedPaidAmount * 100);
  const payoutStatus = summary.payout_status ?? null;
  const financialEventCount = Number(summary.financial_event_count ?? 0);

  let eligibilityReason: BillingEligibilityReason = 'payout_truth_unavailable';
  let chargeEligible = false;

  if (payoutStatus === 'paid' && verifiedPaidAmountCents > 0) {
    eligibilityReason = 'payout_confirmed';
    chargeEligible = true;
  } else if (payoutStatus === 'partially_paid' && verifiedPaidAmountCents > 0) {
    eligibilityReason = 'partial_payout_not_final';
  } else if (financialEventCount > 0 || payoutStatus === 'not_paid') {
    eligibilityReason = 'payout_not_confirmed';
  }

  return {
    dispute_case_id: summary.dispute_case_id ?? null,
    detection_result_id: summary.detection_result_id ?? null,
    charge_eligible: chargeEligible,
    eligibility_source: 'canonical_financial_truth',
    eligibility_reason: eligibilityReason,
    verified_paid_amount: normalizedVerifiedPaidAmount > 0 ? normalizedVerifiedPaidAmount : null,
    verified_paid_amount_cents: verifiedPaidAmountCents > 0 ? verifiedPaidAmountCents : null,
    payout_status: payoutStatus,
    outstanding_amount: typeof summary.outstanding_amount === 'number' && Number.isFinite(summary.outstanding_amount)
      ? Number(summary.outstanding_amount.toFixed(2))
      : null,
    variance_amount: typeof summary.variance_amount === 'number' && Number.isFinite(summary.variance_amount)
      ? Number(summary.variance_amount.toFixed(2))
      : null,
    financial_event_count: Number.isFinite(financialEventCount) ? financialEventCount : 0,
    proof_of_payment: summary.proof_of_payment ?? null,
  };
}

export async function resolveCanonicalBillingEligibility(params: {
  tenantId: string;
  disputeCaseId: string;
}): Promise<CanonicalBillingEligibility> {
  const truth = await recoveryFinancialTruthService.getFinancialTruth({
    tenantId: params.tenantId,
    caseIds: [params.disputeCaseId],
  });

  const matchingSummary =
    truth.summaries.find((summary) => String(summary.dispute_case_id || '').trim() === params.disputeCaseId)
    || truth.summaries.find((summary) => String(summary.input_id || '').trim() === params.disputeCaseId)
    || null;

  return deriveCanonicalBillingEligibility(matchingSummary);
}

export async function resolveCanonicalBillingEligibilityMap(params: {
  tenantId: string;
  disputeCaseIds: string[];
}): Promise<Record<string, CanonicalBillingEligibility>> {
  const disputeCaseIds = Array.from(new Set(params.disputeCaseIds.filter(Boolean)));
  if (!disputeCaseIds.length) return {};

  const truth = await recoveryFinancialTruthService.getFinancialTruth({
    tenantId: params.tenantId,
    caseIds: disputeCaseIds,
  });

  return Object.fromEntries(
    disputeCaseIds.map((disputeCaseId) => {
      const matchingSummary =
        truth.summaries.find((summary) => String(summary.dispute_case_id || '').trim() === disputeCaseId)
        || truth.summaries.find((summary) => String(summary.input_id || '').trim() === disputeCaseId)
        || null;

      return [disputeCaseId, deriveCanonicalBillingEligibility(matchingSummary)];
    })
  );
}

export function buildStableBillingIdempotencyKey(params: {
  recoveryId?: string | null;
  disputeCaseId: string;
}): string {
  return params.recoveryId
    ? `billing-recovery-${params.recoveryId}`
    : `billing-dispute-${params.disputeCaseId}`;
}

export function shouldEnqueueBackstopBilling(params: {
  chargeEligible: boolean;
  billingStatus?: string | null;
  billingTransactionId?: string | null;
}): boolean {
  if (!params.chargeEligible) return false;

  const normalizedStatus = String(params.billingStatus || '').trim().toLowerCase();
  if (normalizedStatus === 'failed') return true;
  if (normalizedStatus === 'charged' || normalizedStatus === 'credited' || normalizedStatus === 'refunded') return false;
  if (normalizedStatus === 'pending' || normalizedStatus === 'sent') {
    return !params.billingTransactionId;
  }
  return !params.billingTransactionId;
}
