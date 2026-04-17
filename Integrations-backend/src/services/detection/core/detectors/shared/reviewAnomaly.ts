export type ReviewTier = 'claim_candidate' | 'review_only' | 'monitoring';
export type ClaimReadiness = 'claim_ready' | 'not_claim_ready';
export type RecommendedAction = 'file_claim' | 'review' | 'monitor';
export type ValueLabel = 'estimated_recovery' | 'potential_exposure' | 'no_recovery_value';

export interface ReviewAnomalyEvidence {
  review_tier: ReviewTier;
  claim_readiness: ClaimReadiness;
  recommended_action: RecommendedAction;
  value_label: ValueLabel;
  why_not_claim_ready?: string;
  filing_block_reason?: string;
}

export const REVIEW_ONLY_BLOCK_REASON = 'review_only_detection_not_claim_ready';

export function buildReviewAnomalyEvidence(
  whyNotClaimReady: string,
  overrides: Partial<ReviewAnomalyEvidence> & Record<string, any> = {}
): ReviewAnomalyEvidence & Record<string, any> {
  return {
    review_tier: 'review_only',
    claim_readiness: 'not_claim_ready',
    recommended_action: 'review',
    value_label: 'potential_exposure',
    why_not_claim_ready: whyNotClaimReady,
    filing_block_reason: REVIEW_ONLY_BLOCK_REASON,
    ...overrides,
  };
}

export function buildMonitoringEvidence(
  whyNotClaimReady: string,
  overrides: Partial<ReviewAnomalyEvidence> & Record<string, any> = {}
): ReviewAnomalyEvidence & Record<string, any> {
  return {
    review_tier: 'monitoring',
    claim_readiness: 'not_claim_ready',
    recommended_action: 'monitor',
    value_label: 'no_recovery_value',
    why_not_claim_ready: whyNotClaimReady,
    filing_block_reason: REVIEW_ONLY_BLOCK_REASON,
    ...overrides,
  };
}
