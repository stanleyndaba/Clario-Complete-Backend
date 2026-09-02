import crypto from 'crypto';
import {
  CatalogChangeExecutionResult,
  CatalogChangeLifecycleState,
  CatalogChangeRecord,
  ImmutableCatalogState,
} from './transferLedgerCatalogChangeExecution';
import {
  ProviderSemanticsCatalogEntry,
  ProviderSemanticsCatalogStatus,
} from './transferLedgerProviderSemanticsCatalog';

export const TRANSFER_LOCAL_CATALOG_READ_PUBLICATION_VERSION = '1.0.0';

export type LocalCatalogReadPublicationState = 'LOCAL_CATALOG_READ_VIEW_READY' | 'REJECTED';

/**
 * P11 is a read-only local admission boundary. It is deliberately distinct from
 * P10: P10 constructs an authorized catalog successor; P11 decides whether that
 * exact successor may be exposed as an immutable, review-only local read view.
 */
export interface LocalCatalogReadPublicationAuthorization {
  publicationId: string;
  decision: 'PUBLISH_LOCAL_READ_VIEW' | 'REJECT';
  operatorReference: string | null;
  authorizedAt: string | null;
  validUntil: string | null;
  lifecycleState: CatalogChangeLifecycleState;
  supersededBy: string | null;
  invalidatedAt: string | null;
  exactP10ChangeId: string;
  exactP9ReviewId: string;
  exactP8VerificationId: string;
  exactTargetId: string;
  exactProposedP5Status: ProviderSemanticsCatalogStatus;
  exactProvider: 'amazon_inventory_ledger';
  exactReportType: string;
  exactEventType: string | null;
  exactField: string;
  exactMarketplaceId: string;
  exactArtifactVersion: string;
  exactProvenanceHash: string;
  expectedCatalogVersion: string;
  expectedCatalogHash: string;
  expectedChangeRecordHash: string;
  p3RemainsFailClosed: boolean;
  transferRemainsOff: boolean;
  localReadOnly: boolean;
  noPersistenceAuthorized: boolean;
  noObservationAuthorized: boolean;
  noDetectorAuthorized: boolean;
  noClaimRecoveryOrEconomicAuthorization: boolean;
  authorizationBindingHash: string;
}

export interface LocalCatalogReadPublicationRecord {
  publicationId: string;
  publicationVersion: string;
  publicationHash: string;
  publishedAt: string;
  catalogVersion: string;
  catalogHash: string;
  changeRecordHash: string;
  p10ChangeId: string;
  p8VerificationId: string;
  p9ReviewId: string;
  targetId: string;
  provider: 'amazon_inventory_ledger';
  reportType: string;
  eventType: string | null;
  field: string;
  marketplaceId: string;
  artifactVersion: string;
  provenanceHash: string;
  proposedP5Status: ProviderSemanticsCatalogStatus;
  negativeConditions: string[];
  deterministicDecision: 'LOCAL_READ_VIEW_REPRESENTED_NOT_PERSISTED';
  lifecycleState: 'ACTIVE';
  catalogMutationAuthorized: false;
  p3OverrideAuthorized: false;
  transferActivationAuthorized: false;
  observationAuthorized: false;
  detectorAuthorized: false;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

export interface LocalCatalogReadView {
  catalogVersion: string;
  catalogHash: string;
  entries: readonly ProviderSemanticsCatalogEntry[];
  publication: LocalCatalogReadPublicationRecord;
  /** P11 never upgrades P3 provider semantics, irrespective of entry status. */
  p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS'; evidenceReference: null };
  localOnly: true;
  reviewOnly: true;
  immutable: true;
  catalogMutationAuthorized: false;
  p3OverrideAuthorized: false;
  transferActivationAuthorized: false;
  observationAuthorized: false;
  detectorAuthorized: false;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

export interface LocalCatalogReadPublicationResult {
  publicationVersion: string;
  state: LocalCatalogReadPublicationState;
  reasonCodes: string[];
  readView: LocalCatalogReadView | null;
  publicationRecord: LocalCatalogReadPublicationRecord | null;
  catalogMutationAuthorized: false;
  p3OverrideAuthorized: false;
  transferActivationAuthorized: false;
  observationAuthorized: false;
  detectorAuthorized: false;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

export interface LocalCatalogReadPublicationInput {
  execution: CatalogChangeExecutionResult;
  authorization: LocalCatalogReadPublicationAuthorization | null;
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

function validIsoTimestamp(value: string | null): boolean {
  return Boolean(value) && !Number.isNaN(Date.parse(value as string));
}

function catalogHash(catalog: ImmutableCatalogState): string {
  return sha256(canonicalJson({ version: catalog.version, entries: catalog.entries }));
}

function changeRecordHash(record: CatalogChangeRecord): string {
  return sha256(canonicalJson(record));
}

function cloneAndFreeze<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (candidate: unknown): unknown => {
    if (candidate && typeof candidate === 'object' && !Object.isFrozen(candidate)) {
      Object.values(candidate as Record<string, unknown>).forEach(freeze);
      Object.freeze(candidate);
    }
    return candidate;
  };
  return freeze(clone) as T;
}

export function localCatalogReadPublicationAuthorizationBindingHash(
  authorization: Omit<LocalCatalogReadPublicationAuthorization, 'authorizationBindingHash'>,
): string {
  return sha256(canonicalJson(authorization));
}

function rejected(
  ...reasonCodes: string[]
): LocalCatalogReadPublicationResult {
  return {
    publicationVersion: TRANSFER_LOCAL_CATALOG_READ_PUBLICATION_VERSION,
    state: 'REJECTED',
    reasonCodes,
    readView: null,
    publicationRecord: null,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    transferActivationAuthorized: false,
    observationAuthorized: false,
    detectorAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

function exactSuccessorEntry(
  catalog: ImmutableCatalogState,
  record: CatalogChangeRecord,
): ProviderSemanticsCatalogEntry | null {
  const entries = catalog.entries.filter((entry) => entry.id === record.nextEntry.id);
  if (entries.length !== 1) return null;
  const entry = entries[0];
  return canonicalJson(entry) === canonicalJson(record.nextEntry) ? entry : null;
}

function successorPreservesP10Boundaries(
  record: CatalogChangeRecord,
  catalog: ImmutableCatalogState,
): boolean {
  const entry = exactSuccessorEntry(catalog, record);
  if (!entry) return false;
  return record.lifecycleState === 'ACTIVE'
    && record.deterministicDecision === 'CATALOG_TRANSFORMATION_REPRESENTED_NOT_PERSISTED'
    && record.catalogNextVersion === catalog.version
    && record.nextEntry.id === entry.id
    && record.nextEntry.allowedAssertion === record.previousEntry.allowedAssertion
    && record.nextEntry.negativeCondition === record.previousEntry.negativeCondition
    && record.negativeConditions.length > 0
    && record.nextEntry.negativeCondition === canonicalJson(record.negativeConditions)
    && entry.providerSource === 'amazon_inventory_ledger'
    && entry.providerSource === record.nextEntry.providerSource
    && entry.reportType === record.nextEntry.reportType
    && normalize(entry.providerEventTypeRaw) === normalize(record.nextEntry.providerEventTypeRaw)
    && entry.providerField.toLowerCase() === record.nextEntry.providerField.toLowerCase()
    && entry.semanticTarget === record.nextEntry.semanticTarget
    && entry.scope.marketplaceIds.length === 1
    && entry.scope.marketplaceIds[0] === record.marketplaceId
    && !entry.scope.marketplaceIds.includes('*')
    && entry.scope.providerArtifactVersion === record.artifactVersion
    && entry.status === record.nextEntry.status;
}

function authorizationMatches(
  authorization: LocalCatalogReadPublicationAuthorization,
  record: CatalogChangeRecord,
  catalog: ImmutableCatalogState,
): boolean {
  return authorization.exactP10ChangeId === record.changeId
    && authorization.exactP9ReviewId === record.p9ReviewId
    && authorization.exactP8VerificationId === record.p8VerificationId
    && authorization.exactTargetId === record.targetId
    && authorization.exactProposedP5Status === record.nextEntry.status
    && authorization.exactProvider === record.nextEntry.providerSource
    && authorization.exactReportType === record.nextEntry.reportType
    && normalize(authorization.exactEventType) === normalize(record.nextEntry.providerEventTypeRaw)
    && authorization.exactField.toLowerCase() === record.nextEntry.providerField.toLowerCase()
    && authorization.exactMarketplaceId === record.marketplaceId
    && authorization.exactArtifactVersion === record.artifactVersion
    && authorization.exactProvenanceHash === record.provenanceHash
    && authorization.expectedCatalogVersion === catalog.version
    && authorization.expectedCatalogHash === catalogHash(catalog)
    && authorization.expectedChangeRecordHash === changeRecordHash(record);
}

/**
 * P11 exposes only an immutable in-memory read view. It cannot persist the P10
 * successor, update the live P5 array, activate observation, or invoke a detector.
 */
export function publishLocalCatalogReadView(
  input: LocalCatalogReadPublicationInput,
): LocalCatalogReadPublicationResult {
  const execution = input.execution;
  if (execution.state !== 'TRANSFORMED'
    || !execution.localCatalogTransformationAuthorized
    || !execution.nextCatalog
    || !execution.changeRecord) {
    return rejected('P10_TRANSFORMED_SUCCESSOR_REQUIRED');
  }
  if (execution.catalogMutationAuthorized || execution.p3OverrideAuthorized
    || execution.claimCapable || execution.recoveryDetected
    || execution.economicValue !== null || execution.detectorResult !== null) {
    return rejected('P10_SAFETY_INVARIANT_MISMATCH');
  }
  const authorization = input.authorization;
  if (!authorization) return rejected('MISSING_LOCAL_READ_PUBLICATION_AUTHORIZATION');
  if (authorization.decision !== 'PUBLISH_LOCAL_READ_VIEW') return rejected('LOCAL_READ_PUBLICATION_REJECTED');
  if (!normalize(authorization.publicationId) || !normalize(authorization.operatorReference) || !normalize(authorization.authorizedAt)) {
    return rejected('LOCAL_READ_PUBLICATION_METADATA_INCOMPLETE');
  }
  if (!validIsoTimestamp(authorization.authorizedAt)
    || !validIsoTimestamp(input.evaluationAt)
    || (authorization.validUntil !== null && !validIsoTimestamp(authorization.validUntil))
    || (authorization.invalidatedAt !== null && !validIsoTimestamp(authorization.invalidatedAt))) {
    return rejected('LOCAL_READ_PUBLICATION_TIMESTAMP_MALFORMED');
  }
  if (authorization.lifecycleState !== 'ACTIVE' || authorization.supersededBy !== null || authorization.invalidatedAt !== null) {
    return rejected('LOCAL_READ_PUBLICATION_NOT_ACTIVE');
  }
  if (authorization.authorizedAt! > input.evaluationAt) return rejected('LOCAL_READ_PUBLICATION_NOT_YET_EFFECTIVE');
  if (authorization.validUntil && authorization.validUntil <= authorization.authorizedAt!) {
    return rejected('LOCAL_READ_PUBLICATION_VALIDITY_WINDOW_INVALID');
  }
  if (authorization.validUntil && input.evaluationAt > authorization.validUntil) return rejected('LOCAL_READ_PUBLICATION_EXPIRED');
  if (!authorization.p3RemainsFailClosed || !authorization.transferRemainsOff
    || !authorization.localReadOnly || !authorization.noPersistenceAuthorized
    || !authorization.noObservationAuthorized || !authorization.noDetectorAuthorized
    || !authorization.noClaimRecoveryOrEconomicAuthorization) {
    return rejected('LOCAL_READ_PUBLICATION_SAFETY_CONFIRMATION_MISMATCH');
  }
  const withoutBinding: Omit<LocalCatalogReadPublicationAuthorization, 'authorizationBindingHash'> = { ...authorization };
  delete (withoutBinding as Partial<LocalCatalogReadPublicationAuthorization>).authorizationBindingHash;
  if (authorization.authorizationBindingHash !== localCatalogReadPublicationAuthorizationBindingHash(withoutBinding)) {
    return rejected('LOCAL_READ_PUBLICATION_BINDING_HASH_MISMATCH');
  }
  const catalog = execution.nextCatalog;
  const record = execution.changeRecord;
  if (!authorizationMatches(authorization, record, catalog)) return rejected('LOCAL_READ_PUBLICATION_CONTEXT_OR_PREDECESSOR_MISMATCH');
  if (!successorPreservesP10Boundaries(record, catalog)) return rejected('P10_SUCCESSOR_BOUNDARY_MISMATCH');

  const finalCatalogHash = catalogHash(catalog);
  const finalChangeHash = changeRecordHash(record);
  const publicationHash = sha256(canonicalJson({
    version: TRANSFER_LOCAL_CATALOG_READ_PUBLICATION_VERSION,
    publicationId: authorization.publicationId,
    catalogHash: finalCatalogHash,
    changeRecordHash: finalChangeHash,
    p10ChangeId: record.changeId,
    authorizedAt: authorization.authorizedAt,
  }));
  const publicationRecord: LocalCatalogReadPublicationRecord = {
    publicationId: authorization.publicationId,
    publicationVersion: TRANSFER_LOCAL_CATALOG_READ_PUBLICATION_VERSION,
    publicationHash,
    publishedAt: authorization.authorizedAt!,
    catalogVersion: catalog.version,
    catalogHash: finalCatalogHash,
    changeRecordHash: finalChangeHash,
    p10ChangeId: record.changeId,
    p8VerificationId: record.p8VerificationId,
    p9ReviewId: record.p9ReviewId,
    targetId: record.targetId,
    provider: record.nextEntry.providerSource,
    reportType: record.nextEntry.reportType,
    eventType: record.nextEntry.providerEventTypeRaw,
    field: record.nextEntry.providerField,
    marketplaceId: record.marketplaceId,
    artifactVersion: record.artifactVersion,
    provenanceHash: record.provenanceHash,
    proposedP5Status: record.nextEntry.status,
    negativeConditions: [...record.negativeConditions],
    deterministicDecision: 'LOCAL_READ_VIEW_REPRESENTED_NOT_PERSISTED',
    lifecycleState: 'ACTIVE',
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    transferActivationAuthorized: false,
    observationAuthorized: false,
    detectorAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
  const readView: LocalCatalogReadView = cloneAndFreeze({
    catalogVersion: catalog.version,
    catalogHash: finalCatalogHash,
    entries: catalog.entries,
    publication: publicationRecord,
    p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
    localOnly: true,
    reviewOnly: true,
    immutable: true,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    transferActivationAuthorized: false,
    observationAuthorized: false,
    detectorAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  });
  return {
    publicationVersion: TRANSFER_LOCAL_CATALOG_READ_PUBLICATION_VERSION,
    state: 'LOCAL_CATALOG_READ_VIEW_READY',
    reasonCodes: ['EXACT_ACTIVE_P10_SUCCESSOR_REPRESENTED_AS_LOCAL_READ_ONLY_VIEW'],
    readView,
    publicationRecord: readView.publication,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    transferActivationAuthorized: false,
    observationAuthorized: false,
    detectorAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

/** P11 has no detector behavior and cannot create a detector result. */
export function localCatalogReadPublicationDetectorResult(_: LocalCatalogReadPublicationResult): null {
  return null;
}
