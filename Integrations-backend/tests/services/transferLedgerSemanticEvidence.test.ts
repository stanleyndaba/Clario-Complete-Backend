import { describe, expect, it } from '@jest/globals';
import {
  evaluateTransferSemanticEvidence,
  TransferSemanticEvidence,
} from '../../src/services/transferLedgerSemanticEvidence';

const scope = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  storeId: 'store-a',
  marketplaceId: 'ATVPDKIKX0DER',
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    providerRowFingerprint: 'provider-row-counterpart-1',
    scope,
    transferIdentity: 'transfer-123',
    sourceLocation: 'FC-DESTINATION',
    destinationLocation: 'FC-SOURCE',
    fnsku: 'FNSKU-1',
    rawPayloadHash: 'payload-hash-counterpart-1',
    ...overrides,
  };
}

function evidence(overrides: Record<string, unknown> = {}): TransferSemanticEvidence {
  return {
    scope,
    sourceRunId: 'source-run-1',
    providerRowFingerprint: 'provider-row-primary-1',
    providerFingerprintOccurrences: 1,
    rawPayloadHash: 'payload-hash-primary-1',
    providerEventTypeRaw: 'WhseTransfers',
    providerSemantics: {
      status: 'VERIFIED_TRANSFER',
      evidenceReference: 'provider-semantic-evidence-v1',
    },
    transferIdentity: 'transfer-123',
    sourceLocation: 'FC-SOURCE',
    destinationLocation: 'FC-DESTINATION',
    item: { fnsku: 'FNSKU-1', sku: 'SKU-1', asin: 'ASIN-1' },
    quantity: { sent: 7, received: 7 },
    timestamps: {
      sentAt: '2026-01-01T10:00:00.000Z',
      receivedAt: '2026-01-02T10:00:00.000Z',
      closedAt: null,
    },
    lifecycle: 'RECEIVED',
    historyCoverage: 'FULL',
    counterpartCandidates: [candidate()],
    ...overrides,
  } as TransferSemanticEvidence;
}

function expectUnresolved(
  input: TransferSemanticEvidence,
  state: 'UNPAIRED' | 'AMBIGUOUS' | 'PENDING_PROVIDER_SEMANTICS',
  reason: string,
) {
  const result = evaluateTransferSemanticEvidence(input);
  expect(result).toEqual(expect.objectContaining({
    state,
    reasonCodes: expect.arrayContaining([reason]),
    transferFact: null,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
  }));
}

describe('Transfer Ledger P3 semantic evidence contract', () => {
  it('emits a semantic fact only for complete, scoped, provenance-backed evidence', () => {
    const result = evaluateTransferSemanticEvidence(evidence());

    expect(result).toEqual({
      state: 'PROVEN',
      confidence: 'HIGH',
      reasonCodes: ['COMPLETE_SCOPED_SEMANTIC_EVIDENCE'],
      transferFact: {
        transferIdentity: 'transfer-123',
        sourceLocation: 'FC-SOURCE',
        destinationLocation: 'FC-DESTINATION',
        fnsku: 'FNSKU-1',
        quantitySent: 7,
        quantityReceived: 7,
        lifecycle: 'RECEIVED',
      },
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    });
  });

  it('does not silently prove a missing source, destination, or item identity', () => {
    for (const input of [
      evidence({ sourceLocation: null }),
      evidence({ destinationLocation: null }),
      evidence({ item: { fnsku: null, sku: 'SKU-1', asin: 'ASIN-1' } }),
    ]) {
      expectUnresolved(input, 'PENDING_PROVIDER_SEMANTICS', 'REQUIRED_TRANSFER_FACT_MISSING');
    }
  });

  it('keeps missing, zero, and negative quantities unresolved', () => {
    for (const quantity of [
      { sent: null, received: 7 },
      { sent: 0, received: 7 },
      { sent: -7, received: 7 },
      { sent: 7, received: 0 },
    ]) {
      expectUnresolved(evidence({ quantity }), 'PENDING_PROVIDER_SEMANTICS', 'INVALID_TRANSFER_QUANTITY');
    }
  });

  it('marks conflicting sent and received quantities ambiguous instead of creating a loss', () => {
    expectUnresolved(
      evidence({ quantity: { sent: 7, received: 6 } }),
      'AMBIGUOUS',
      'CONFLICTING_QUANTITIES',
    );
  });

  it('rejects duplicate provider-fingerprint evidence before any pairing decision', () => {
    expectUnresolved(
      evidence({ providerFingerprintOccurrences: 2 }),
      'PENDING_PROVIDER_SEMANTICS',
      'DUPLICATE_PROVIDER_FINGERPRINT',
    );
  });

  it('marks multiple valid counterpart matches ambiguous', () => {
    expectUnresolved(
      evidence({ counterpartCandidates: [candidate(), candidate({ providerRowFingerprint: 'provider-row-counterpart-2', rawPayloadHash: 'payload-hash-counterpart-2' })] }),
      'AMBIGUOUS',
      'MULTIPLE_SCOPED_COUNTERPARTS',
    );
  });

  it('rejects missing, conflicting, malformed, and impossible lifecycle timestamps', () => {
    expectUnresolved(
      evidence({ timestamps: { sentAt: null, receivedAt: '2026-01-02T10:00:00.000Z', closedAt: null } }),
      'PENDING_PROVIDER_SEMANTICS',
      'IMPOSSIBLE_OR_INCOMPLETE_LIFECYCLE',
    );
    expectUnresolved(
      evidence({ timestamps: { sentAt: '2026-01-03T10:00:00.000Z', receivedAt: '2026-01-02T10:00:00.000Z', closedAt: null } }),
      'PENDING_PROVIDER_SEMANTICS',
      'IMPOSSIBLE_OR_INCOMPLETE_LIFECYCLE',
    );
    expectUnresolved(
      evidence({ timestamps: { sentAt: 'not-a-date', receivedAt: '2026-01-02T10:00:00.000Z', closedAt: null } }),
      'PENDING_PROVIDER_SEMANTICS',
      'IMPOSSIBLE_OR_INCOMPLETE_LIFECYCLE',
    );
    expectUnresolved(
      evidence({ lifecycle: 'CLOSED', timestamps: { sentAt: '2026-01-01T10:00:00.000Z', receivedAt: '2026-01-02T10:00:00.000Z', closedAt: '2026-01-01T10:00:00.000Z' } }),
      'PENDING_PROVIDER_SEMANTICS',
      'IMPOSSIBLE_OR_INCOMPLETE_LIFECYCLE',
    );
  });

  it('accepts a closed lifecycle only when it closes after a proven receipt', () => {
    const result = evaluateTransferSemanticEvidence(evidence({
      lifecycle: 'CLOSED',
      timestamps: {
        sentAt: '2026-01-01T10:00:00.000Z',
        receivedAt: '2026-01-02T10:00:00.000Z',
        closedAt: '2026-01-03T10:00:00.000Z',
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      state: 'PROVEN',
      confidence: 'HIGH',
      transferFact: expect.objectContaining({ lifecycle: 'CLOSED' }),
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
  });

  it('fails closed for unsupported provider event types and unverified provider semantics', () => {
    expectUnresolved(
      evidence({ providerSemantics: { status: 'UNSUPPORTED', evidenceReference: 'provider-doc' } }),
      'PENDING_PROVIDER_SEMANTICS',
      'UNSUPPORTED_PROVIDER_EVENT_TYPE',
    );
    expectUnresolved(
      evidence({ providerSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null } }),
      'PENDING_PROVIDER_SEMANTICS',
      'PROVIDER_SEMANTICS_UNVERIFIED',
    );
  });

  it('treats partial and unknown history as pending provider semantics', () => {
    expectUnresolved(evidence({ historyCoverage: 'PARTIAL' }), 'PENDING_PROVIDER_SEMANTICS', 'INCOMPLETE_HISTORY');
    expectUnresolved(evidence({ historyCoverage: 'UNKNOWN' }), 'PENDING_PROVIDER_SEMANTICS', 'INCOMPLETE_HISTORY');
  });

  it('returns unpaired when no defensible scoped counterpart exists', () => {
    expectUnresolved(evidence({ counterpartCandidates: [] }), 'UNPAIRED', 'NO_SCOPED_COUNTERPART');
  });

  it('never pairs across store, marketplace, or tenant boundaries', () => {
    for (const candidateScope of [
      { ...scope, storeId: 'store-b' },
      { ...scope, marketplaceId: 'A1PA6795UKMFR9' },
      { ...scope, tenantId: 'tenant-b' },
      { ...scope, userId: 'user-b' },
    ]) {
      expectUnresolved(
        evidence({ counterpartCandidates: [candidate({ scope: candidateScope })] }),
        'UNPAIRED',
        'NO_SCOPED_COUNTERPART',
      );
    }
  });

  it('is replay-idempotent for an exact duplicate candidate fingerprint', () => {
    const input = evidence({ counterpartCandidates: [candidate(), candidate()] });
    const first = evaluateTransferSemanticEvidence(input);
    const replay = evaluateTransferSemanticEvidence(input);

    expect(first).toEqual(replay);
    expect(first.state).toBe('PROVEN');
  });

  it('rejects malformed provenance and non-distinct source/destination before proving a transfer', () => {
    expectUnresolved(
      evidence({ sourceRunId: null }),
      'PENDING_PROVIDER_SEMANTICS',
      'MALFORMED_EVIDENCE',
    );
    expectUnresolved(
      evidence({ sourceLocation: 'FC-SAME', destinationLocation: 'FC-SAME' }),
      'PENDING_PROVIDER_SEMANTICS',
      'SOURCE_DESTINATION_NOT_DISTINCT',
    );
  });
});
