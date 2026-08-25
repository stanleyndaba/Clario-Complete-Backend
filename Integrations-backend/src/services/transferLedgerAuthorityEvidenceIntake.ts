import crypto from 'crypto';
import {
  AUTHORITY_HIERARCHY,
  AuthorityAcquisitionTarget,
  AuthorityClass,
  EvidenceAcquisitionRecord,
  ProposedCatalogUpgrade,
  TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION,
} from './transferLedgerAuthorityAcquisitionPlan';

export const TRANSFER_AUTHORITY_EVIDENCE_INTAKE_VERSION = '1.0.0';

export type AuthorityEvidenceIntakeState =
  | 'ACCEPTED_FOR_REVIEW'
  | 'REJECTED'
  | 'UNRESOLVED';

export interface AuthorityEvidenceIntakeInput {
  target: AuthorityAcquisitionTarget;
  evidenceId: string;
  provider: 'amazon_inventory_ledger';
  artifactType: string;
  sourceReference: string;
  retrievedAt: string;
  artifactVersion: string;
  marketplaceId: string;
  reportType: string;
  eventType: string | null;
  field: string;
  proposedSemanticTarget: AuthorityAcquisitionTarget['semanticTarget'];
  proposition: string;
  evidenceReference: string;
  evidenceExcerptOrLocator: string;
  /** Supplied in memory only. It is never returned or persisted by this module. */
  artifactText: string;
  authorityClass: AuthorityClass;
  proposedCatalogUpgrade: ProposedCatalogUpgrade | null;
  negativeConditions: string[];
  scope: EvidenceAcquisitionRecord['scope'];
  notes?: string | null;
}

export interface AuthorityEvidenceIntakeResult {
  intakeVersion: string;
  intakeId: string;
  state: AuthorityEvidenceIntakeState;
  reasonCodes: string[];
  canonicalArtifactHash: string | null;
  record: EvidenceAcquisitionRecord | null;
  /** Raw artifact text is intentionally absent from every output. */
  rawArtifactReturned: false;
  reviewRequired: true;
  catalogMutationAuthorized: false;
  p3OverrideAuthorized: false;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim();
}

function canonicalizeArtifact(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function hashArtifact(canonicalArtifact: string): string {
  return crypto.createHash('sha256').update(canonicalArtifact, 'utf8').digest('hex');
}

function buildIntakeId(targetId: string, provenanceHash: string): string {
  return crypto.createHash('sha256')
    .update(`${TRANSFER_AUTHORITY_EVIDENCE_INTAKE_VERSION}:${targetId}:${provenanceHash}`)
    .digest('hex');
}

function failure(
  input: AuthorityEvidenceIntakeInput,
  state: Extract<AuthorityEvidenceIntakeState, 'REJECTED' | 'UNRESOLVED'>,
  ...reasonCodes: string[]
): AuthorityEvidenceIntakeResult {
  return {
    intakeVersion: TRANSFER_AUTHORITY_EVIDENCE_INTAKE_VERSION,
    intakeId: crypto.createHash('sha256').update(`${TRANSFER_AUTHORITY_EVIDENCE_INTAKE_VERSION}:${input.evidenceId}`).digest('hex'),
    state,
    reasonCodes,
    canonicalArtifactHash: null,
    record: null,
    rawArtifactReturned: false,
    reviewRequired: true,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

function hasMatchingContext(input: AuthorityEvidenceIntakeInput): boolean {
  const context = input.target.providerContext;
  const marketplaceMatches = context.marketplaceIds.includes('*') || context.marketplaceIds.includes(input.marketplaceId);
  const eventMatches = context.eventType === null
    || normalize(context.eventType).toUpperCase() === normalize(input.eventType).toUpperCase();

  return input.provider === context.provider
    && input.reportType === context.reportType
    && eventMatches
    && input.field.toLowerCase() === context.field.toLowerCase()
    && input.proposedSemanticTarget === input.target.semanticTarget
    && input.proposition === input.target.proposition
    && input.artifactVersion === context.artifactVersion
    && marketplaceMatches
    && input.scope.marketplaceId === input.marketplaceId
    && input.scope.crossTenantAssertionPermitted === false
    && input.scope.crossStoreAssertionPermitted === false
    && input.scope.crossMarketplaceAssertionPermitted === false;
}

function hasAllowedSourceReference(input: AuthorityEvidenceIntakeInput): boolean {
  const source = normalize(input.sourceReference).toLowerCase();
  if (!source) return false;
  if (input.authorityClass === 'AUTHORITATIVE_PROVIDER_DOCUMENTATION'
    || input.authorityClass === 'AUTHORITATIVE_PROVIDER_SCHEMA') {
    return source.startsWith('https://developer-docs.amazon/')
      || source.startsWith('https://developer.amazonservices.')
      || source.startsWith('https://sellercentral.amazon.')
      || source.startsWith('https://github.com/amzn/');
  }
  if (input.authorityClass === 'APPROVED_CONTROLLED_PROVIDER_EVIDENCE') {
    return source.startsWith('controlled-evidence://');
  }
  if (input.authorityClass === 'APPROVED_REDACTED_FIXTURE') {
    return source.startsWith('approved-fixture://');
  }
  return false;
}

/**
 * Validates a proposed authority artifact without retrieving, persisting, or
 * interpreting provider data. A successful result is a deterministic P6
 * record with `NOT_SUBMITTED` review status, never a P5 catalog mutation.
 */
export function intakeAuthorityEvidence(
  input: AuthorityEvidenceIntakeInput,
): AuthorityEvidenceIntakeResult {
  if (!input.target || input.target.version !== TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION) {
    return failure(input, 'UNRESOLVED', 'UNKNOWN_OR_VERSION_MISMATCHED_TARGET');
  }
  if (!AUTHORITY_HIERARCHY[input.authorityClass].acceptableForReview
    || !input.target.acceptableAuthorityClasses.includes(input.authorityClass)) {
    return failure(input, 'REJECTED', 'UNSUPPORTED_AUTHORITY_CLASS');
  }
  if (!hasAllowedSourceReference(input)) {
    return failure(input, 'REJECTED', 'UNTRUSTED_SOURCE_REFERENCE');
  }
  if (!hasMatchingContext(input)) {
    return failure(input, 'UNRESOLVED', 'CONTEXT_SCOPE_OR_PROPOSITION_MISMATCH');
  }
  if (!input.proposedCatalogUpgrade || !input.target.resultingAllowedUpgrade.includes(input.proposedCatalogUpgrade)) {
    return failure(input, 'UNRESOLVED', 'UNAPPROVED_PROPOSED_UPGRADE');
  }
  if (input.proposedCatalogUpgrade === 'AUTHORITATIVELY_PROVEN'
    && input.authorityClass !== 'AUTHORITATIVE_PROVIDER_DOCUMENTATION'
    && input.authorityClass !== 'AUTHORITATIVE_PROVIDER_SCHEMA') {
    return failure(input, 'UNRESOLVED', 'INSUFFICIENT_AUTHORITY_FOR_PROPOSED_UPGRADE');
  }
  if (!input.target.negativeConditions.every((rule) => input.negativeConditions.includes(rule))) {
    return failure(input, 'UNRESOLVED', 'NEGATIVE_CONDITIONS_INCOMPLETE');
  }
  if (!normalize(input.evidenceReference) || !normalize(input.evidenceExcerptOrLocator)) {
    return failure(input, 'UNRESOLVED', 'MISSING_EVIDENCE_LOCATOR');
  }

  const canonicalArtifact = canonicalizeArtifact(input.artifactText || '');
  if (!canonicalArtifact) return failure(input, 'UNRESOLVED', 'MISSING_ARTIFACT_CONTENT');
  const provenanceHash = hashArtifact(canonicalArtifact);
  const intakeId = buildIntakeId(input.target.id, provenanceHash);
  const record: EvidenceAcquisitionRecord = {
    evidenceId: input.evidenceId,
    targetId: input.target.id,
    provider: input.provider,
    artifactType: input.artifactType,
    sourceReference: input.sourceReference,
    retrievedAt: input.retrievedAt,
    artifactVersion: input.artifactVersion,
    marketplaceId: input.marketplaceId,
    reportType: input.reportType,
    eventType: input.eventType,
    field: input.field,
    proposedSemanticTarget: input.proposedSemanticTarget,
    proposition: input.proposition,
    evidenceReference: input.evidenceReference,
    evidenceExcerptOrLocator: input.evidenceExcerptOrLocator,
    provenanceHash,
    authorityClass: input.authorityClass,
    evidenceAssessment: 'CLEAR',
    proposedCatalogUpgrade: input.proposedCatalogUpgrade,
    reviewerStatus: 'NOT_SUBMITTED',
    review: {
      reviewerId: null,
      reviewedAt: null,
      exactPropositionAnswered: false,
      exactArtifactAnswered: false,
      authorityAnswered: false,
      providerContextAnswered: false,
      marketplaceAnswered: false,
      artifactVersionAnswered: false,
      negativeBoundaryAnswered: false,
      reproducibilityAnswered: false,
      provenanceAnswered: false,
      independentAuditAnswered: false,
      proposedUpgradeAnswered: false,
      p3FailClosedAnswered: false,
      notes: null,
    },
    negativeConditions: input.negativeConditions,
    supersedes: null,
    supersededBy: null,
    invalidatedAt: null,
    invalidationReason: null,
    scope: input.scope,
    notes: input.notes || null,
  };

  return {
    intakeVersion: TRANSFER_AUTHORITY_EVIDENCE_INTAKE_VERSION,
    intakeId,
    state: 'ACCEPTED_FOR_REVIEW',
    reasonCodes: ['RECORD_CREATED_REVIEW_NOT_SUBMITTED'],
    canonicalArtifactHash: provenanceHash,
    record,
    rawArtifactReturned: false,
    reviewRequired: true,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

/** P7 has no detector behavior; evidence intake never emits a detector result. */
export function authorityEvidenceIntakeDetectorResult(_: AuthorityEvidenceIntakeResult): null {
  return null;
}
