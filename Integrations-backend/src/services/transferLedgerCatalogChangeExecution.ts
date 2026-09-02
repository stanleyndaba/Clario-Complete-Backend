import crypto from 'crypto';
import { CatalogChangeProposal, CatalogChangeReviewResult } from './transferLedgerCatalogChangeReview';
import { AuthorityClass } from './transferLedgerAuthorityAcquisitionPlan';
import {
  AllowedAssertion,
  ProviderAuthorityKind,
  ProviderSemanticsCatalogEntry,
  ProviderSemanticsCatalogStatus,
} from './transferLedgerProviderSemanticsCatalog';

export const TRANSFER_CATALOG_CHANGE_EXECUTION_VERSION = '1.0.0';

export type CatalogChangeExecutionState = 'TRANSFORMED' | 'REJECTED';
export type CatalogChangeLifecycleState = 'ACTIVE' | 'SUPERSEDED' | 'INVALIDATED';

export interface ImmutableCatalogState {
  version: string;
  entries: readonly ProviderSemanticsCatalogEntry[];
  history: readonly CatalogChangeRecord[];
}

export interface CatalogMutationAuthorization {
  authorizationId: string;
  decision: 'AUTHORIZE' | 'REJECT';
  operatorReference: string | null;
  authorizedAt: string | null;
  validUntil: string | null;
  lifecycleState: CatalogChangeLifecycleState;
  supersededBy: string | null;
  invalidatedAt: string | null;
  exactP9ReviewId: string;
  exactTargetId: string;
  exactProposedP5Status: ProviderSemanticsCatalogStatus;
  exactProvider: 'amazon_inventory_ledger';
  exactReportType: string;
  exactEventType: string | null;
  exactField: string;
  exactMarketplaceId: string;
  exactArtifactVersion: string;
  exactProvenanceHash: string;
  proposalBindingHash: string;
  authorizationBindingHash: string;
  p3RemainsFailClosed: boolean;
  transferRemainsOff: boolean;
  catalogOnly: boolean;
  noProductionMutationAuthorized: boolean;
  expectedCatalogVersion: string;
  expectedBeforeEntryHash: string;
}

export interface RollbackRepresentation {
  state: CatalogChangeLifecycleState;
  predecessorVersion: string;
  successorVersion: string | null;
  rollbackRequiresSeparateAuthorization: true;
  automaticRollbackExecuted: false;
}

export interface CatalogChangeRecord {
  changeId: string;
  executionVersion: string;
  catalogPreviousVersion: string;
  catalogNextVersion: string;
  targetId: string;
  previousEntry: ProviderSemanticsCatalogEntry;
  nextEntry: ProviderSemanticsCatalogEntry;
  p6TargetReference: string;
  p8VerificationId: string;
  p9ReviewId: string;
  authorizationId: string;
  authorizationReference: string;
  authorizationTimestamp: string;
  provenanceHash: string;
  sourceReference: string;
  evidenceLocator: string;
  authorityClass: AuthorityClass;
  proposition: string;
  marketplaceId: string;
  artifactVersion: string;
  negativeConditions: string[];
  deterministicDecision: 'CATALOG_TRANSFORMATION_REPRESENTED_NOT_PERSISTED';
  lifecycleState: CatalogChangeLifecycleState;
  rollback: RollbackRepresentation;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

export interface CatalogChangeExecutionResult {
  executionVersion: string;
  state: CatalogChangeExecutionState;
  reasonCodes: string[];
  previousCatalog: ImmutableCatalogState;
  nextCatalog: ImmutableCatalogState | null;
  changeRecord: CatalogChangeRecord | null;
  catalogMutationAuthorized: false;
  localCatalogTransformationAuthorized: boolean;
  p3OverrideAuthorized: false;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

export interface CatalogChangeExecutionInput {
  catalog: ImmutableCatalogState;
  review: CatalogChangeReviewResult;
  authorization: CatalogMutationAuthorization | null;
  evaluationAt: string;
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim();
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function entryHash(entry: ProviderSemanticsCatalogEntry): string {
  return sha256(canonicalJson(entry));
}

/** P10 encodes the full ordered P6 negative-boundary set without dropping a condition. */
function encodedNegativeConditions(conditions: readonly string[]): string {
  return canonicalJson([...conditions]);
}

export function catalogProposalBindingHash(proposal: CatalogChangeProposal): string {
  return sha256(canonicalJson({
    targetId: proposal.targetId,
    proposedP5Status: proposal.proposedP5Status,
    p3SemanticTarget: proposal.p3SemanticTarget,
    providerContext: proposal.providerContext,
    proposition: proposal.proposition,
    provenanceHash: proposal.provenanceHash,
    authorityClass: proposal.authorityClass,
    sourceReference: proposal.sourceReference,
    evidenceLocator: proposal.evidenceLocator,
    negativeConditions: proposal.negativeConditions,
    p8VerificationId: proposal.p8VerificationId,
    p9ReviewId: proposal.p9ReviewId,
  }));
}

export function catalogAuthorizationBindingHash(authorization: Omit<CatalogMutationAuthorization, 'authorizationBindingHash'>): string {
  return sha256(canonicalJson(authorization));
}

function failure(
  input: CatalogChangeExecutionInput,
  ...reasonCodes: string[]
): CatalogChangeExecutionResult {
  return {
    executionVersion: TRANSFER_CATALOG_CHANGE_EXECUTION_VERSION,
    state: 'REJECTED',
    reasonCodes,
    previousCatalog: input.catalog,
    nextCatalog: null,
    changeRecord: null,
    catalogMutationAuthorized: false,
    localCatalogTransformationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

function incrementPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return `${version}.next`;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function authorityKind(authorityClass: AuthorityClass): ProviderAuthorityKind | null {
  if (authorityClass === 'AUTHORITATIVE_PROVIDER_DOCUMENTATION') return 'OFFICIAL_AMAZON_DOCUMENT';
  if (authorityClass === 'AUTHORITATIVE_PROVIDER_SCHEMA') return 'OFFICIAL_AMAZON_MODEL';
  if (authorityClass === 'APPROVED_CONTROLLED_PROVIDER_EVIDENCE') return 'APPROVED_CONTROLLED_EVIDENCE';
  return null;
}

function permittedTransition(
  currentStatus: ProviderSemanticsCatalogStatus,
  authorityClass: AuthorityClass,
  nextStatus: ProviderSemanticsCatalogStatus,
): boolean {
  const officialAuthority = authorityClass === 'AUTHORITATIVE_PROVIDER_DOCUMENTATION'
    || authorityClass === 'AUTHORITATIVE_PROVIDER_SCHEMA';
  const approvedAuthority = officialAuthority
    || authorityClass === 'APPROVED_CONTROLLED_PROVIDER_EVIDENCE'
    || authorityClass === 'APPROVED_REDACTED_FIXTURE';
  if (nextStatus === 'AUTHORITATIVELY_PROVEN') {
    return officialAuthority && (currentStatus === 'UNRESOLVED_PROVIDER_SEMANTICS'
      || currentStatus === 'OBSERVED_RAW_ONLY'
      || currentStatus === 'APPROVED_EVIDENCE');
  }
  if (nextStatus === 'APPROVED_EVIDENCE') {
    return approvedAuthority && (currentStatus === 'UNRESOLVED_PROVIDER_SEMANTICS'
      || currentStatus === 'OBSERVED_RAW_ONLY');
  }
  return false;
}

function validIsoTimestamp(value: string | null): boolean {
  return Boolean(value) && !Number.isNaN(Date.parse(value as string));
}

function proposalMatchesAuthorization(
  proposal: CatalogChangeProposal,
  authorization: CatalogMutationAuthorization,
): boolean {
  return authorization.exactP9ReviewId === proposal.p9ReviewId
    && authorization.exactTargetId === proposal.targetId
    && authorization.exactProposedP5Status === proposal.proposedP5Status
    && authorization.exactProvider === proposal.providerContext.provider
    && authorization.exactReportType === proposal.providerContext.reportType
    && normalize(authorization.exactEventType) === normalize(proposal.providerContext.eventType)
    && authorization.exactField === proposal.providerContext.field
    && authorization.exactMarketplaceId === proposal.providerContext.marketplaceId
    && authorization.exactArtifactVersion === proposal.providerContext.artifactVersion
    && authorization.exactProvenanceHash === proposal.provenanceHash
    && authorization.proposalBindingHash === catalogProposalBindingHash(proposal);
}

function findExactEntry(
  entries: readonly ProviderSemanticsCatalogEntry[],
  proposal: CatalogChangeProposal,
): ProviderSemanticsCatalogEntry | null {
  const matches = entries.filter((entry) => entry.providerSource === proposal.providerContext.provider
    && entry.reportType === proposal.providerContext.reportType
    && normalize(entry.providerEventTypeRaw) === normalize(proposal.providerContext.eventType)
    && entry.providerField.toLowerCase() === proposal.providerContext.field.toLowerCase()
    && entry.semanticTarget === proposal.p3SemanticTarget
    && entry.scope.providerArtifactVersion === proposal.providerContext.artifactVersion
    && (entry.scope.marketplaceIds.includes(proposal.providerContext.marketplaceId)
      || entry.scope.marketplaceIds.includes('*')));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * P10 represents a catalog update only in memory. It intentionally has no
 * database, provider, flag, or P5-live-catalog write path.
 */
export function executeAuthorizedCatalogChange(
  input: CatalogChangeExecutionInput,
): CatalogChangeExecutionResult {
  if (input.review.state !== 'READY_FOR_CATALOG_CHANGE_REVIEW' || !input.review.proposal) {
    return failure(input, 'P9_REVIEW_NOT_READY');
  }
  const proposal = input.review.proposal;
  const authorization = input.authorization;
  if (!authorization) return failure(input, 'MISSING_AUTHORIZATION');
  if (authorization.decision !== 'AUTHORIZE') return failure(input, 'AUTHORIZATION_REJECTED');
  if (!normalize(authorization.authorizationId) || !normalize(authorization.operatorReference) || !normalize(authorization.authorizedAt)) {
    return failure(input, 'AUTHORIZATION_METADATA_INCOMPLETE');
  }
  if (!validIsoTimestamp(authorization.authorizedAt)
    || !validIsoTimestamp(input.evaluationAt)
    || (authorization.validUntil !== null && !validIsoTimestamp(authorization.validUntil))
    || (authorization.invalidatedAt !== null && !validIsoTimestamp(authorization.invalidatedAt))) {
    return failure(input, 'AUTHORIZATION_TIMESTAMP_MALFORMED');
  }
  if (authorization.lifecycleState !== 'ACTIVE' || authorization.supersededBy !== null || authorization.invalidatedAt !== null) {
    return failure(input, 'AUTHORIZATION_NOT_ACTIVE');
  }
  if (authorization.authorizedAt! > input.evaluationAt) return failure(input, 'AUTHORIZATION_NOT_YET_EFFECTIVE');
  if (authorization.validUntil && authorization.validUntil <= authorization.authorizedAt!) return failure(input, 'AUTHORIZATION_VALIDITY_WINDOW_INVALID');
  if (!authorization.p3RemainsFailClosed || !authorization.transferRemainsOff || !authorization.catalogOnly || !authorization.noProductionMutationAuthorized) {
    return failure(input, 'AUTHORIZATION_SAFETY_CONFIRMATION_MISMATCH');
  }
  if (authorization.validUntil && input.evaluationAt > authorization.validUntil) return failure(input, 'AUTHORIZATION_EXPIRED');
  const withoutBinding: Omit<CatalogMutationAuthorization, 'authorizationBindingHash'> = { ...authorization };
  delete (withoutBinding as Partial<CatalogMutationAuthorization>).authorizationBindingHash;
  if (authorization.authorizationBindingHash !== catalogAuthorizationBindingHash(withoutBinding)) {
    return failure(input, 'AUTHORIZATION_BINDING_HASH_MISMATCH');
  }
  if (!proposalMatchesAuthorization(proposal, authorization)) return failure(input, 'AUTHORIZATION_PROPOSAL_MISMATCH');
  if (authorization.expectedCatalogVersion !== input.catalog.version) return failure(input, 'STALE_CATALOG_VERSION');
  const kind = authorityKind(proposal.authorityClass);
  if (!kind) return failure(input, 'UNSUPPORTED_AUTHORITY_CLASS');
  const previousEntry = findExactEntry(input.catalog.entries, proposal);
  if (!previousEntry) return failure(input, 'EXACT_SINGLE_TARGET_ENTRY_NOT_FOUND');
  if (previousEntry.scope.marketplaceIds.includes('*')) return failure(input, 'WILDCARD_CATALOG_ENTRY_REQUIRES_SEPARATE_RESCOPING_REVIEW');
  if (authorization.expectedBeforeEntryHash !== entryHash(previousEntry)) return failure(input, 'BEFORE_ENTRY_MISMATCH');
  if (!permittedTransition(previousEntry.status, proposal.authorityClass, proposal.proposedP5Status)) {
    return failure(input, 'PROHIBITED_STATUS_TRANSITION');
  }
  if (previousEntry.negativeCondition !== encodedNegativeConditions(proposal.negativeConditions)) {
    return failure(input, 'NEGATIVE_CONDITIONS_WEAKENED_OR_CHANGED');
  }

  const nextVersion = incrementPatch(input.catalog.version);
  const nextEntry: ProviderSemanticsCatalogEntry = {
    ...previousEntry,
    version: nextVersion,
    declaredMeaning: proposal.proposition,
    authority: {
      kind,
      reference: proposal.sourceReference,
      version: proposal.providerContext.artifactVersion,
    },
    scope: {
      marketplaceIds: [proposal.providerContext.marketplaceId],
      providerArtifactVersion: proposal.providerContext.artifactVersion,
    },
    status: proposal.proposedP5Status,
    /** P10 does not broaden assertions; the predecessor's assertion is preserved. */
    allowedAssertion: previousEntry.allowedAssertion as AllowedAssertion,
    negativeCondition: previousEntry.negativeCondition,
  };
  const changeId = sha256(canonicalJson({
    version: TRANSFER_CATALOG_CHANGE_EXECUTION_VERSION,
    previousCatalogVersion: input.catalog.version,
    nextCatalogVersion: nextVersion,
    targetId: proposal.targetId,
    previousEntryHash: entryHash(previousEntry),
    nextEntryHash: entryHash(nextEntry),
    p9ReviewId: proposal.p9ReviewId,
    authorizationId: authorization.authorizationId,
    provenanceHash: proposal.provenanceHash,
  }));
  const record: CatalogChangeRecord = {
    changeId,
    executionVersion: TRANSFER_CATALOG_CHANGE_EXECUTION_VERSION,
    catalogPreviousVersion: input.catalog.version,
    catalogNextVersion: nextVersion,
    targetId: proposal.targetId,
    previousEntry,
    nextEntry,
    p6TargetReference: proposal.targetId,
    p8VerificationId: proposal.p8VerificationId,
    p9ReviewId: proposal.p9ReviewId,
    authorizationId: authorization.authorizationId,
    authorizationReference: authorization.operatorReference!,
    authorizationTimestamp: authorization.authorizedAt!,
    provenanceHash: proposal.provenanceHash,
    sourceReference: proposal.sourceReference,
    evidenceLocator: proposal.evidenceLocator,
    authorityClass: proposal.authorityClass,
    proposition: proposal.proposition,
    marketplaceId: proposal.providerContext.marketplaceId,
    artifactVersion: proposal.providerContext.artifactVersion,
    negativeConditions: [...proposal.negativeConditions],
    deterministicDecision: 'CATALOG_TRANSFORMATION_REPRESENTED_NOT_PERSISTED',
    lifecycleState: 'ACTIVE',
    rollback: {
      state: 'ACTIVE',
      predecessorVersion: input.catalog.version,
      successorVersion: null,
      rollbackRequiresSeparateAuthorization: true,
      automaticRollbackExecuted: false,
    },
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
  const nextCatalog: ImmutableCatalogState = {
    version: nextVersion,
    entries: input.catalog.entries.map((entry) => entry.id === previousEntry.id ? nextEntry : entry),
    history: [...input.catalog.history, record],
  };
  return {
    executionVersion: TRANSFER_CATALOG_CHANGE_EXECUTION_VERSION,
    state: 'TRANSFORMED',
    reasonCodes: ['LOCAL_ONLY_AUTHORIZED_CATALOG_TRANSFORMATION_REPRESENTED_NOT_PERSISTED'],
    previousCatalog: input.catalog,
    nextCatalog,
    changeRecord: record,
    catalogMutationAuthorized: false,
    localCatalogTransformationAuthorized: true,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

/** P10 represents rollback capability only; it never executes a rollback. */
export function representCatalogRollback(record: CatalogChangeRecord): RollbackRepresentation {
  return {
    state: record.lifecycleState,
    predecessorVersion: record.catalogPreviousVersion,
    successorVersion: record.catalogNextVersion,
    rollbackRequiresSeparateAuthorization: true,
    automaticRollbackExecuted: false,
  };
}

/** P10 cannot create a detector result from a catalog transformation. */
export function catalogChangeExecutionDetectorResult(_: CatalogChangeExecutionResult): null {
  return null;
}
