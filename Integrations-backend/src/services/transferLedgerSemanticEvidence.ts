export type TransferSemanticState =
  | 'PROVEN'
  | 'UNPAIRED'
  | 'AMBIGUOUS'
  | 'PENDING_PROVIDER_SEMANTICS';

export type TransferReconciliationConfidence = 'NONE' | 'LOW' | 'HIGH';
export type ProviderSemanticStatus = 'VERIFIED_TRANSFER' | 'PENDING_PROVIDER_SEMANTICS' | 'UNSUPPORTED';
export type TransferLifecycleState = 'DISPATCHED' | 'RECEIVED' | 'CLOSED' | 'UNKNOWN';
export type TransferHistoryCoverage = 'FULL' | 'PARTIAL' | 'UNKNOWN';

export interface TransferEvidenceScope {
  tenantId: string;
  userId: string;
  storeId: string;
  marketplaceId: string;
}

export interface TransferSemanticCounterpart {
  providerRowFingerprint: string;
  scope: TransferEvidenceScope;
  transferIdentity: string | null;
  sourceLocation: string | null;
  destinationLocation: string | null;
  fnsku: string | null;
  rawPayloadHash: string | null;
}

/**
 * This contract deliberately does not translate a provider event label into a
 * Transfer. The caller must supply an independently established provider
 * semantic status and provenance reference before PROVEN is possible.
 */
export interface TransferSemanticEvidence {
  scope: TransferEvidenceScope;
  sourceRunId: string | null;
  providerRowFingerprint: string | null;
  /** Number of raw rows carrying this fingerprint in the scoped input. */
  providerFingerprintOccurrences: number;
  rawPayloadHash: string | null;
  providerEventTypeRaw: string | null;
  providerSemantics: {
    status: ProviderSemanticStatus;
    evidenceReference: string | null;
  };
  transferIdentity: string | null;
  sourceLocation: string | null;
  destinationLocation: string | null;
  item: {
    fnsku: string | null;
    sku: string | null;
    asin: string | null;
  };
  quantity: {
    sent: number | null;
    received: number | null;
  };
  timestamps: {
    sentAt: string | null;
    receivedAt: string | null;
    closedAt: string | null;
  };
  lifecycle: TransferLifecycleState;
  historyCoverage: TransferHistoryCoverage;
  counterpartCandidates: TransferSemanticCounterpart[];
}

export interface TransferSemanticResolution {
  state: TransferSemanticState;
  confidence: TransferReconciliationConfidence;
  reasonCodes: string[];
  /** A semantic fact only; it has no claim or monetary meaning. */
  transferFact: {
    transferIdentity: string;
    sourceLocation: string;
    destinationLocation: string;
    fnsku: string;
    quantitySent: number;
    quantityReceived: number;
    lifecycle: Exclude<TransferLifecycleState, 'UNKNOWN' | 'DISPATCHED'>;
  } | null;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nonEmptyScope(scope: TransferEvidenceScope): boolean {
  return Boolean(
    normalized(scope.tenantId)
    && normalized(scope.userId)
    && normalized(scope.storeId)
    && normalized(scope.marketplaceId),
  );
}

function sameScope(left: TransferEvidenceScope, right: TransferEvidenceScope): boolean {
  return left.tenantId === right.tenantId
    && left.userId === right.userId
    && left.storeId === right.storeId
    && left.marketplaceId === right.marketplaceId;
}

function parseIso(value: string | null): number | null {
  const normalizedValue = normalized(value);
  if (!normalizedValue) return null;
  const milliseconds = Date.parse(normalizedValue);
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

function validPositiveInteger(value: number | null): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function unresolved(
  state: Exclude<TransferSemanticState, 'PROVEN'>,
  reasonCodes: string[],
  confidence: TransferReconciliationConfidence = 'NONE',
): TransferSemanticResolution {
  return {
    state,
    confidence,
    reasonCodes,
    transferFact: null,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
  };
}

function hasCompleteProvenance(evidence: TransferSemanticEvidence): boolean {
  return Boolean(
    normalized(evidence.sourceRunId)
    && normalized(evidence.providerRowFingerprint)
    && normalized(evidence.rawPayloadHash)
    && normalized(evidence.providerEventTypeRaw),
  );
}

function scopedCounterparts(evidence: TransferSemanticEvidence): TransferSemanticCounterpart[] {
  const identity = normalized(evidence.transferIdentity);
  const source = normalized(evidence.sourceLocation);
  const destination = normalized(evidence.destinationLocation);
  const fnsku = normalized(evidence.item.fnsku);
  const primaryFingerprint = normalized(evidence.providerRowFingerprint);
  const byFingerprint = new Map<string, TransferSemanticCounterpart>();

  for (const candidate of evidence.counterpartCandidates) {
    const fingerprint = normalized(candidate.providerRowFingerprint);
    const isValidScopedCounterpart = Boolean(
      fingerprint
      && fingerprint !== primaryFingerprint
      && sameScope(evidence.scope, candidate.scope)
      && normalized(candidate.transferIdentity) === identity
      && normalized(candidate.sourceLocation) === destination
      && normalized(candidate.destinationLocation) === source
      && normalized(candidate.fnsku) === fnsku
      && normalized(candidate.rawPayloadHash),
    );
    if (isValidScopedCounterpart && !byFingerprint.has(fingerprint)) {
      byFingerprint.set(fingerprint, candidate);
    }
  }

  return [...byFingerprint.values()];
}

function lifecycleIsConsistent(evidence: TransferSemanticEvidence): boolean {
  const sentAt = parseIso(evidence.timestamps.sentAt);
  const receivedAt = parseIso(evidence.timestamps.receivedAt);
  const closedAt = parseIso(evidence.timestamps.closedAt);

  if (sentAt === null || receivedAt === null) return false;
  if (receivedAt < sentAt) return false;
  if (evidence.lifecycle === 'DISPATCHED' || evidence.lifecycle === 'UNKNOWN') return false;
  if (evidence.lifecycle === 'CLOSED' && (closedAt === null || closedAt < receivedAt)) return false;
  if (evidence.lifecycle === 'RECEIVED' && closedAt !== null) return false;
  return true;
}

/**
 * Resolves a Transfer fact only when the supplied evidence is complete,
 * scoped, provenance-backed, and explicitly semantically verified. It never
 * infers Amazon semantics from raw event text and never emits claim data.
 */
export function evaluateTransferSemanticEvidence(
  evidence: TransferSemanticEvidence,
): TransferSemanticResolution {
  if (!nonEmptyScope(evidence.scope) || !hasCompleteProvenance(evidence)) {
    return unresolved('PENDING_PROVIDER_SEMANTICS', ['MALFORMED_EVIDENCE']);
  }

  if (evidence.providerFingerprintOccurrences !== 1) {
    return unresolved('PENDING_PROVIDER_SEMANTICS', ['DUPLICATE_PROVIDER_FINGERPRINT']);
  }

  if (evidence.providerSemantics.status === 'UNSUPPORTED') {
    return unresolved('PENDING_PROVIDER_SEMANTICS', ['UNSUPPORTED_PROVIDER_EVENT_TYPE']);
  }

  if (
    evidence.providerSemantics.status !== 'VERIFIED_TRANSFER'
    || !normalized(evidence.providerSemantics.evidenceReference)
  ) {
    return unresolved('PENDING_PROVIDER_SEMANTICS', ['PROVIDER_SEMANTICS_UNVERIFIED']);
  }

  if (evidence.historyCoverage !== 'FULL') {
    return unresolved('PENDING_PROVIDER_SEMANTICS', ['INCOMPLETE_HISTORY']);
  }

  if (
    !normalized(evidence.transferIdentity)
    || !normalized(evidence.sourceLocation)
    || !normalized(evidence.destinationLocation)
    || !normalized(evidence.item.fnsku)
  ) {
    return unresolved('PENDING_PROVIDER_SEMANTICS', ['REQUIRED_TRANSFER_FACT_MISSING']);
  }

  if (normalized(evidence.sourceLocation) === normalized(evidence.destinationLocation)) {
    return unresolved('PENDING_PROVIDER_SEMANTICS', ['SOURCE_DESTINATION_NOT_DISTINCT']);
  }

  if (!validPositiveInteger(evidence.quantity.sent) || !validPositiveInteger(evidence.quantity.received)) {
    return unresolved('PENDING_PROVIDER_SEMANTICS', ['INVALID_TRANSFER_QUANTITY']);
  }

  if (evidence.quantity.sent !== evidence.quantity.received) {
    return unresolved('AMBIGUOUS', ['CONFLICTING_QUANTITIES'], 'LOW');
  }

  if (!lifecycleIsConsistent(evidence)) {
    return unresolved('PENDING_PROVIDER_SEMANTICS', ['IMPOSSIBLE_OR_INCOMPLETE_LIFECYCLE']);
  }

  const counterparts = scopedCounterparts(evidence);
  if (counterparts.length === 0) {
    return unresolved('UNPAIRED', ['NO_SCOPED_COUNTERPART'], 'LOW');
  }
  if (counterparts.length > 1) {
    return unresolved('AMBIGUOUS', ['MULTIPLE_SCOPED_COUNTERPARTS'], 'LOW');
  }

  return {
    state: 'PROVEN',
    confidence: 'HIGH',
    reasonCodes: ['COMPLETE_SCOPED_SEMANTIC_EVIDENCE'],
    transferFact: {
      transferIdentity: normalized(evidence.transferIdentity),
      sourceLocation: normalized(evidence.sourceLocation),
      destinationLocation: normalized(evidence.destinationLocation),
      fnsku: normalized(evidence.item.fnsku),
      quantitySent: evidence.quantity.sent,
      quantityReceived: evidence.quantity.received,
      lifecycle: evidence.lifecycle as Exclude<TransferLifecycleState, 'UNKNOWN' | 'DISPATCHED'>,
    },
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
  };
}
