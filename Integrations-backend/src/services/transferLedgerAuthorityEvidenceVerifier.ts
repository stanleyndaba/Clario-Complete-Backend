import crypto from 'crypto';
import {
  AUTHORITY_HIERARCHY,
  AuthorityAcquisitionTarget,
  EvidenceAcquisitionRecord,
  TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION,
} from './transferLedgerAuthorityAcquisitionPlan';
import { AuthorityEvidenceIntakeResult } from './transferLedgerAuthorityEvidenceIntake';

export const TRANSFER_AUTHORITY_EVIDENCE_VERIFIER_VERSION = '1.0.0';

export type AuthorityEvidenceVerificationState =
  | 'VERIFIED_FOR_CATALOG_REVIEW'
  | 'INSUFFICIENT_EVIDENCE'
  | 'CONTEXT_MISMATCH'
  | 'PROPOSITION_MISMATCH'
  | 'AUTHORITY_MISMATCH'
  | 'NEGATIVE_CONDITION_UNSATISFIED'
  | 'AMBIGUOUS_EVIDENCE'
  | 'INVALIDATED'
  | 'UNSUPPORTED';

export interface AuthorityEvidenceVerificationInput {
  target: AuthorityAcquisitionTarget;
  intake: AuthorityEvidenceIntakeResult;
  /** Supplied locally/in memory. P8 never retrieves or persists it. */
  artifactText: string;
  /** Exact excerpt expected to support the target proposition. */
  assertedExcerpt: string;
  /** Synthetic fixtures exercise verifier logic but can never be authority. */
  syntheticFixture?: boolean;
}

export interface AuthorityEvidenceVerificationResult {
  verifierVersion: string;
  verificationId: string;
  state: AuthorityEvidenceVerificationState;
  reasonCodes: string[];
  targetId: string;
  sourceReference: string | null;
  provenanceHash: string | null;
  evidenceLocator: string | null;
  authorityClass: EvidenceAcquisitionRecord['authorityClass'] | null;
  verificationRecord: EvidenceAcquisitionRecord | null;
  artifactTextReturned: false;
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

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function verificationId(targetId: string, provenanceHash: string | null, assertedExcerpt: string): string {
  return sha256(`${TRANSFER_AUTHORITY_EVIDENCE_VERIFIER_VERSION}:${targetId}:${provenanceHash || ''}:${normalize(assertedExcerpt)}`);
}

function recordFrom(input: AuthorityEvidenceVerificationInput): EvidenceAcquisitionRecord | null {
  return input.intake.record;
}

function failure(
  input: AuthorityEvidenceVerificationInput,
  state: Exclude<AuthorityEvidenceVerificationState, 'VERIFIED_FOR_CATALOG_REVIEW'>,
  ...reasonCodes: string[]
): AuthorityEvidenceVerificationResult {
  const record = recordFrom(input);
  return {
    verifierVersion: TRANSFER_AUTHORITY_EVIDENCE_VERIFIER_VERSION,
    verificationId: verificationId(input.target.id, record?.provenanceHash || null, input.assertedExcerpt),
    state,
    reasonCodes,
    targetId: input.target.id,
    sourceReference: record?.sourceReference || null,
    provenanceHash: record?.provenanceHash || null,
    evidenceLocator: record?.evidenceExcerptOrLocator || null,
    authorityClass: record?.authorityClass || null,
    verificationRecord: null,
    artifactTextReturned: false,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

function sourceReferenceIsAllowed(record: EvidenceAcquisitionRecord): boolean {
  const source = normalize(record.sourceReference).toLowerCase();
  if (record.authorityClass === 'AUTHORITATIVE_PROVIDER_DOCUMENTATION'
    || record.authorityClass === 'AUTHORITATIVE_PROVIDER_SCHEMA') {
    return source.startsWith('https://developer-docs.amazon/')
      || source.startsWith('https://developer.amazonservices.')
      || source.startsWith('https://sellercentral.amazon.')
      || source.startsWith('https://github.com/amzn/');
  }
  if (record.authorityClass === 'APPROVED_CONTROLLED_PROVIDER_EVIDENCE') {
    return source.startsWith('controlled-evidence://');
  }
  if (record.authorityClass === 'APPROVED_REDACTED_FIXTURE') {
    return source.startsWith('approved-fixture://');
  }
  return false;
}

function recordMatchesTarget(record: EvidenceAcquisitionRecord, target: AuthorityAcquisitionTarget): boolean {
  const expected = target.providerContext;
  const eventMatches = expected.eventType === null
    || normalize(expected.eventType).toUpperCase() === normalize(record.eventType).toUpperCase();
  const marketplaceMatches = expected.marketplaceIds.includes('*')
    || expected.marketplaceIds.includes(record.marketplaceId);

  return record.targetId === target.id
    && record.proposedSemanticTarget === target.semanticTarget
    && record.proposition === target.proposition
    && record.provider === expected.provider
    && record.reportType === expected.reportType
    && eventMatches
    && record.field.toLowerCase() === expected.field.toLowerCase()
    && record.artifactVersion === expected.artifactVersion
    && marketplaceMatches
    && record.scope.marketplaceId === record.marketplaceId
    && record.scope.crossTenantAssertionPermitted === false
    && record.scope.crossStoreAssertionPermitted === false
    && record.scope.crossMarketplaceAssertionPermitted === false;
}

/**
 * P8 tests whether a supplied artifact explicitly carries the exact P6
 * proposition and its required excerpt. A positive result is merely a
 * deterministic package for later human/P6/P5 review; no semantic is promoted.
 */
export function verifyAuthorityEvidenceProposition(
  input: AuthorityEvidenceVerificationInput,
): AuthorityEvidenceVerificationResult {
  if (!input.target || input.target.version !== TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION) {
    return failure(input, 'UNSUPPORTED', 'UNKNOWN_OR_VERSION_MISMATCHED_TARGET');
  }
  if (input.intake.state !== 'ACCEPTED_FOR_REVIEW' || !input.intake.record) {
    return failure(input, 'INSUFFICIENT_EVIDENCE', 'P7_INTAKE_NOT_ACCEPTED');
  }
  const record = input.intake.record;
  if (record.invalidatedAt || record.supersededBy) {
    return failure(input, 'INVALIDATED', record.invalidatedAt ? 'EVIDENCE_INVALIDATED' : 'EVIDENCE_SUPERSEDED');
  }
  if (!AUTHORITY_HIERARCHY[record.authorityClass].acceptableForReview
    || !input.target.acceptableAuthorityClasses.includes(record.authorityClass)) {
    return failure(input, 'UNSUPPORTED', 'UNSUPPORTED_AUTHORITY_CLASS');
  }
  if (!sourceReferenceIsAllowed(record)) {
    return failure(input, 'AUTHORITY_MISMATCH', 'UNTRUSTED_SOURCE_REFERENCE');
  }
  if (!recordMatchesTarget(record, input.target)) {
    return failure(input, 'CONTEXT_MISMATCH', 'RECORD_CONTEXT_OR_SCOPE_MISMATCH');
  }
  if (!input.target.negativeConditions.every((rule) => record.negativeConditions.includes(rule))) {
    return failure(input, 'NEGATIVE_CONDITION_UNSATISFIED', 'REQUIRED_NEGATIVE_CONDITION_MISSING');
  }
  if (!record.evidenceReference || !record.evidenceExcerptOrLocator || !normalize(input.assertedExcerpt)) {
    return failure(input, 'INSUFFICIENT_EVIDENCE', 'MISSING_EVIDENCE_LOCATOR_OR_EXCERPT');
  }
  if (input.syntheticFixture) {
    return failure(input, 'INSUFFICIENT_EVIDENCE', 'SYNTHETIC_FIXTURE_CANNOT_BE_PROVIDER_AUTHORITY');
  }

  const canonicalArtifact = canonicalizeArtifact(input.artifactText || '');
  if (!canonicalArtifact) return failure(input, 'INSUFFICIENT_EVIDENCE', 'MISSING_ARTIFACT_CONTENT');
  const actualHash = sha256(canonicalArtifact);
  if (!record.provenanceHash || record.provenanceHash !== actualHash) {
    return failure(input, 'INSUFFICIENT_EVIDENCE', 'PROVENANCE_HASH_MISMATCH');
  }
  const artifactLower = canonicalArtifact.toLowerCase();
  const propositionLower = normalize(record.proposition).toLowerCase();
  const excerptLower = normalize(input.assertedExcerpt).toLowerCase();
  if (!artifactLower.includes(propositionLower)) {
    return failure(input, 'PROPOSITION_MISMATCH', 'ARTIFACT_DOES_NOT_EXPLICITLY_STATE_TARGET_PROPOSITION');
  }
  if (!artifactLower.includes(excerptLower)) {
    return failure(input, 'INSUFFICIENT_EVIDENCE', 'ASSERTED_EXCERPT_NOT_FOUND_IN_ARTIFACT');
  }
  if (artifactLower.includes('ambiguous') || artifactLower.includes('not defined') || artifactLower.includes('unknown meaning')) {
    return failure(input, 'AMBIGUOUS_EVIDENCE', 'ARTIFACT_CONTAINS_AMBIGUITY_MARKER');
  }

  return {
    verifierVersion: TRANSFER_AUTHORITY_EVIDENCE_VERIFIER_VERSION,
    verificationId: verificationId(input.target.id, record.provenanceHash, input.assertedExcerpt),
    state: 'VERIFIED_FOR_CATALOG_REVIEW',
    reasonCodes: ['EXPLICIT_PROPOSITION_AND_CONTEXT_MATCH_REQUIRES_SEPARATE_HUMAN_P5_REVIEW'],
    targetId: input.target.id,
    sourceReference: record.sourceReference,
    provenanceHash: record.provenanceHash,
    evidenceLocator: record.evidenceExcerptOrLocator,
    authorityClass: record.authorityClass,
    verificationRecord: record,
    artifactTextReturned: false,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

/** P8 cannot create a detector result from an authority-verification outcome. */
export function authorityEvidenceVerificationDetectorResult(_: AuthorityEvidenceVerificationResult): null {
  return null;
}
