import crypto from 'crypto';
import {
  AUTHORITY_HIERARCHY,
  AuthorityAcquisitionTarget,
  AuthorityClass,
  EvidenceAcquisitionRecord,
  ProposedCatalogUpgrade,
} from './transferLedgerAuthorityAcquisitionPlan';
import { AuthorityEvidenceVerificationResult } from './transferLedgerAuthorityEvidenceVerifier';

export const TRANSFER_CATALOG_CHANGE_REVIEW_VERSION = '1.0.0';

export type CatalogChangeReviewState =
  | 'REVIEW_REQUIRED'
  | 'REVIEW_INCOMPLETE'
  | 'REVIEW_REJECTED'
  | 'REVIEW_CONFLICTED'
  | 'REVIEW_INVALIDATED'
  | 'REVIEW_SUPERSEDED'
  | 'READY_FOR_CATALOG_CHANGE_REVIEW'
  | 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE';

export type ReviewerDecision = 'ACCEPT' | 'REJECT';
export type ConflictDeclaration = 'NO_CONFLICT' | 'CONFLICT';

export interface CatalogChangeReviewContext {
  provider: 'amazon_inventory_ledger';
  reportType: string;
  eventType: string | null;
  field: string;
  marketplaceId: string;
  artifactVersion: string;
  semanticTarget: AuthorityAcquisitionTarget['semanticTarget'];
  proposition: string;
  provenanceHash: string;
  sourceReference: string;
  evidenceLocator: string;
  assertedExcerpt: string;
  authorityClass: AuthorityClass;
  negativeConditions: string[];
  scope: EvidenceAcquisitionRecord['scope'];
}

export interface CatalogChangeReviewerInput {
  reviewerId: string | null;
  reviewerReference: string | null;
  reviewedAt: string | null;
  decision: ReviewerDecision | null;
  rationale: string | null;
  independentlyExaminedEvidence: boolean;
  conflictDeclaration: ConflictDeclaration | null;
  /** Deterministic review history for the same verification package, if known. */
  priorDecisions: ReviewerDecision[];
  p3RemainsFailClosed: boolean;
  catalogMutationRequested: false;
  syntheticFixture: boolean;
}

export interface CatalogChangeReviewInput {
  target: AuthorityAcquisitionTarget;
  verification: AuthorityEvidenceVerificationResult;
  context: CatalogChangeReviewContext;
  reviewer: CatalogChangeReviewerInput;
}

export interface CatalogChangeProposal {
  proposalVersion: string;
  targetId: string;
  proposedP5Status: ProposedCatalogUpgrade;
  p3SemanticTarget: AuthorityAcquisitionTarget['semanticTarget'];
  providerContext: Pick<CatalogChangeReviewContext, 'provider' | 'reportType' | 'eventType' | 'field' | 'marketplaceId' | 'artifactVersion'>;
  proposition: string;
  provenanceHash: string;
  authorityClass: AuthorityClass;
  sourceReference: string;
  evidenceLocator: string;
  assertedExcerpt: string;
  negativeConditions: string[];
  p8VerificationId: string;
  p9ReviewId: string;
  reviewer: Pick<CatalogChangeReviewerInput, 'reviewerId' | 'reviewerReference' | 'reviewedAt' | 'decision' | 'rationale' | 'independentlyExaminedEvidence' | 'conflictDeclaration'>;
  deterministicDecision: 'READY_FOR_CATALOG_CHANGE_REVIEW';
  catalogMutationAuthorized: false;
  catalogChangeEligible: true;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

export interface CatalogChangeReviewResult {
  reviewVersion: string;
  reviewId: string;
  state: CatalogChangeReviewState;
  reasonCodes: string[];
  proposal: CatalogChangeProposal | null;
  catalogMutationAuthorized: false;
  catalogChangeEligible: boolean;
  p3OverrideAuthorized: false;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim();
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function reviewId(input: CatalogChangeReviewInput): string {
  return crypto.createHash('sha256').update(stableJson({
    version: TRANSFER_CATALOG_CHANGE_REVIEW_VERSION,
    verificationId: input.verification.verificationId,
    targetId: input.target.id,
    context: input.context,
    reviewer: input.reviewer,
  })).digest('hex');
}

function failure(
  input: CatalogChangeReviewInput,
  state: Exclude<CatalogChangeReviewState, 'READY_FOR_CATALOG_CHANGE_REVIEW'>,
  ...reasonCodes: string[]
): CatalogChangeReviewResult {
  return {
    reviewVersion: TRANSFER_CATALOG_CHANGE_REVIEW_VERSION,
    reviewId: reviewId(input),
    state,
    reasonCodes,
    proposal: null,
    catalogMutationAuthorized: false,
    catalogChangeEligible: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

function contextMatchesRecord(
  context: CatalogChangeReviewContext,
  record: EvidenceAcquisitionRecord,
  target: AuthorityAcquisitionTarget,
): boolean {
  const expected = target.providerContext;
  const marketplaceMatches = expected.marketplaceIds.includes('*') || expected.marketplaceIds.includes(context.marketplaceId);
  const eventMatches = expected.eventType === null
    || normalize(expected.eventType).toUpperCase() === normalize(context.eventType).toUpperCase();

  return context.provider === record.provider
    && context.provider === expected.provider
    && context.reportType === record.reportType
    && context.reportType === expected.reportType
    && normalize(context.eventType).toUpperCase() === normalize(record.eventType).toUpperCase()
    && eventMatches
    && context.field.toLowerCase() === record.field.toLowerCase()
    && context.field.toLowerCase() === expected.field.toLowerCase()
    && context.marketplaceId === record.marketplaceId
    && marketplaceMatches
    && context.artifactVersion === record.artifactVersion
    && context.artifactVersion === expected.artifactVersion
    && context.semanticTarget === record.proposedSemanticTarget
    && context.semanticTarget === target.semanticTarget
    && context.proposition === record.proposition
    && context.proposition === target.proposition
    && context.provenanceHash === record.provenanceHash
    && context.sourceReference === record.sourceReference
    && context.evidenceLocator === record.evidenceExcerptOrLocator
    && normalize(context.assertedExcerpt).length > 0
    && context.authorityClass === record.authorityClass
    && context.scope.marketplaceId === record.scope.marketplaceId
    && context.scope.crossTenantAssertionPermitted === false
    && context.scope.crossStoreAssertionPermitted === false
    && context.scope.crossMarketplaceAssertionPermitted === false;
}

function hasCompleteNegativeConditions(
  context: CatalogChangeReviewContext,
  record: EvidenceAcquisitionRecord,
  target: AuthorityAcquisitionTarget,
): boolean {
  return target.negativeConditions.every((rule) => context.negativeConditions.includes(rule)
    && record.negativeConditions.includes(rule));
}

function authorityCanPropose(
  authorityClass: AuthorityClass,
  proposedStatus: ProposedCatalogUpgrade | null,
): boolean {
  if (!proposedStatus || !AUTHORITY_HIERARCHY[authorityClass].acceptableForReview) return false;
  if (proposedStatus === 'AUTHORITATIVELY_PROVEN') {
    return authorityClass === 'AUTHORITATIVE_PROVIDER_DOCUMENTATION'
      || authorityClass === 'AUTHORITATIVE_PROVIDER_SCHEMA';
  }
  return authorityClass === 'AUTHORITATIVE_PROVIDER_DOCUMENTATION'
    || authorityClass === 'AUTHORITATIVE_PROVIDER_SCHEMA'
    || authorityClass === 'APPROVED_CONTROLLED_PROVIDER_EVIDENCE'
    || authorityClass === 'APPROVED_REDACTED_FIXTURE';
}

function missingReviewRequirement(reviewer: CatalogChangeReviewerInput): string | null {
  if (!normalize(reviewer.reviewerId)) return 'MISSING_REVIEWER_ID';
  if (!normalize(reviewer.reviewerReference)) return 'MISSING_REVIEWER_REFERENCE';
  if (!normalize(reviewer.reviewedAt)) return 'MISSING_REVIEW_TIMESTAMP';
  if (!reviewer.decision) return 'MISSING_REVIEW_DECISION';
  if (!normalize(reviewer.rationale)) return 'MISSING_REVIEW_RATIONALE';
  if (!reviewer.conflictDeclaration) return 'MISSING_CONFLICT_DECLARATION';
  if (!reviewer.independentlyExaminedEvidence) return 'INDEPENDENT_EXAMINATION_NOT_CONFIRMED';
  if (!reviewer.p3RemainsFailClosed) return 'P3_FAIL_CLOSED_NOT_CONFIRMED';
  if (reviewer.catalogMutationRequested !== false) return 'CATALOG_MUTATION_REQUESTED';
  return null;
}

/**
 * P9 is the human-review decision seam. It creates at most a non-mutating,
 * reviewable P5 catalog-change proposal; it contains no P5 mutation function.
 */
export function evaluateCatalogChangeReview(
  input: CatalogChangeReviewInput,
): CatalogChangeReviewResult {
  if (input.verification.state !== 'VERIFIED_FOR_CATALOG_REVIEW' || !input.verification.verificationRecord) {
    return failure(input, 'REVIEW_REQUIRED', 'P8_VERIFICATION_REQUIRED');
  }
  const record = input.verification.verificationRecord;
  if (record.invalidatedAt) return failure(input, 'REVIEW_INVALIDATED', 'EVIDENCE_INVALIDATED');
  if (record.supersededBy) return failure(input, 'REVIEW_SUPERSEDED', 'EVIDENCE_SUPERSEDED');
  if (input.reviewer.syntheticFixture) return failure(input, 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE', 'SYNTHETIC_FIXTURE_CANNOT_BE_PROVIDER_AUTHORITY');
  if (!contextMatchesRecord(input.context, record, input.target)) {
    return failure(input, 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE', 'REVIEW_CONTEXT_OR_PROPOSITION_MISMATCH');
  }
  if (!hasCompleteNegativeConditions(input.context, record, input.target)) {
    return failure(input, 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE', 'NEGATIVE_CONDITIONS_INCOMPLETE');
  }
  if (!authorityCanPropose(record.authorityClass, record.proposedCatalogUpgrade)) {
    return failure(input, 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE', 'AUTHORITY_CLASS_OR_PROPOSED_STATUS_INELIGIBLE');
  }
  const missing = missingReviewRequirement(input.reviewer);
  if (missing) return failure(input, 'REVIEW_INCOMPLETE', missing);
  if (input.reviewer.conflictDeclaration === 'CONFLICT') {
    return failure(input, 'REVIEW_CONFLICTED', 'REVIEWER_DECLARED_CONFLICT');
  }
  if (input.reviewer.priorDecisions.some((prior) => prior !== input.reviewer.decision)) {
    return failure(input, 'REVIEW_CONFLICTED', 'CONTRADICTORY_PRIOR_REVIEW_DECISION');
  }
  if (input.reviewer.decision === 'REJECT') {
    return failure(input, 'REVIEW_REJECTED', 'REVIEWER_REJECTED_PROPOSITION');
  }

  const currentReviewId = reviewId(input);
  const proposal: CatalogChangeProposal = {
    proposalVersion: TRANSFER_CATALOG_CHANGE_REVIEW_VERSION,
    targetId: input.target.id,
    proposedP5Status: record.proposedCatalogUpgrade as ProposedCatalogUpgrade,
    p3SemanticTarget: input.target.semanticTarget,
    providerContext: {
      provider: input.context.provider,
      reportType: input.context.reportType,
      eventType: input.context.eventType,
      field: input.context.field,
      marketplaceId: input.context.marketplaceId,
      artifactVersion: input.context.artifactVersion,
    },
    proposition: input.context.proposition,
    provenanceHash: input.context.provenanceHash,
    authorityClass: input.context.authorityClass,
    sourceReference: input.context.sourceReference,
    evidenceLocator: input.context.evidenceLocator,
    assertedExcerpt: input.context.assertedExcerpt,
    negativeConditions: [...input.context.negativeConditions],
    p8VerificationId: input.verification.verificationId,
    p9ReviewId: currentReviewId,
    reviewer: {
      reviewerId: input.reviewer.reviewerId,
      reviewerReference: input.reviewer.reviewerReference,
      reviewedAt: input.reviewer.reviewedAt,
      decision: input.reviewer.decision,
      rationale: input.reviewer.rationale,
      independentlyExaminedEvidence: input.reviewer.independentlyExaminedEvidence,
      conflictDeclaration: input.reviewer.conflictDeclaration,
    },
    deterministicDecision: 'READY_FOR_CATALOG_CHANGE_REVIEW',
    catalogMutationAuthorized: false,
    catalogChangeEligible: true,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };

  return {
    reviewVersion: TRANSFER_CATALOG_CHANGE_REVIEW_VERSION,
    reviewId: currentReviewId,
    state: 'READY_FOR_CATALOG_CHANGE_REVIEW',
    reasonCodes: ['SEPARATE_HUMAN_AUTHORIZATION_REQUIRED_BEFORE_ANY_P5_MUTATION'],
    proposal,
    catalogMutationAuthorized: false,
    catalogChangeEligible: true,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

/** P9 has no detector behavior and cannot create a detection result. */
export function catalogChangeReviewDetectorResult(_: CatalogChangeReviewResult): null {
  return null;
}
