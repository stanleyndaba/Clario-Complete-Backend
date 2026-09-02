import { describe, expect, it } from '@jest/globals';
import {
  assessTransferProviderEvidenceReadiness,
  AMAZON_LEDGER_DETAIL_REPORT_TYPE,
} from '../../src/services/transferLedgerProviderEvidenceReadiness';
import { evaluateTransferSemanticEvidence, TransferSemanticEvidence } from '../../src/services/transferLedgerSemanticEvidence';
import {
  AMAZON_REPORTS_API_ARTIFACT_VERSION,
  TRANSFER_PROVIDER_SEMANTICS_CATALOG,
  evaluateCatalogThenP3,
  resolveProviderSemanticsCatalog,
} from '../../src/services/transferLedgerProviderSemanticsCatalog';
import {
  TRANSFER_P135_AUDIT_REGISTRY,
  TransferAuditSafetySnapshot,
  evaluateP135Certification,
  runLocalP135AuditHarness,
} from '../../src/services/transferLedgerP135AuditRegistry';

const scope = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  storeId: 'store-a',
  marketplaceId: 'ATVPDKIKX0DER',
};

const safeSnapshot: TransferAuditSafetySnapshot = {
  transferEnabled: false,
  rolloutPercentage: 0,
  mode: 'OFF',
  claimCapable: false,
  productionTouched: false,
  providerTouched: false,
  observationInvoked: false,
  detectorInvoked: false,
  claimCreated: false,
  recoveryCreated: false,
  economicValueCalculated: false,
  p3OverrideAuthorized: false,
  liveP5CatalogMutated: false,
};

function completeLookingEvidence(overrides: Record<string, unknown> = {}): TransferSemanticEvidence {
  return {
    scope,
    sourceRunId: 'p135-source-run',
    providerRowFingerprint: 'p135-row-primary',
    providerFingerprintOccurrences: 1,
    rawPayloadHash: 'p135-raw-hash',
    providerEventTypeRaw: 'WhseTransfers',
    providerSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
    transferIdentity: 'matching-reference-id',
    sourceLocation: 'FC-A',
    destinationLocation: 'FC-B',
    item: { fnsku: 'FNSKU-1', sku: 'SKU-1', asin: 'ASIN-1' },
    quantity: { sent: 7, received: 7 },
    timestamps: { sentAt: '2026-01-01T00:00:00.000Z', receivedAt: '2026-01-02T00:00:00.000Z', closedAt: null },
    lifecycle: 'RECEIVED',
    historyCoverage: 'FULL',
    counterpartCandidates: [{
      providerRowFingerprint: 'p135-row-counterpart',
      scope,
      transferIdentity: 'matching-reference-id',
      sourceLocation: 'FC-B',
      destinationLocation: 'FC-A',
      fnsku: 'FNSKU-1',
      rawPayloadHash: 'p135-counterpart-hash',
    }],
    ...overrides,
  } as TransferSemanticEvidence;
}

function expectZeroClaim(value: { claimCapable: false; recoveryDetected: false; economicValue: null }) {
  expect(value).toEqual(expect.objectContaining({
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
  }));
}

describe('P41–P133 adversarial cross-gate Transfer audit', () => {
  it('preserves provider-shaped fields but refuses to infer semantic roles from a plausible WhseTransfers row', () => {
    const readiness = assessTransferProviderEvidenceReadiness({
      scope,
      sourceRunId: 'p135-readiness-source',
      providerRowFingerprint: 'p135-readiness-row',
      providerFingerprintOccurrences: 1,
      providerSource: 'amazon_inventory_ledger',
      reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
      rawPayload: {
        'Event Type': 'WhseTransfers',
        'Reference ID': 'matching-reference-id',
        'Fulfillment Center': 'FC-A',
        Quantity: '-7',
        'Date and Time': '2026-01-01T00:00:00.000Z',
        FNSKU: 'FNSKU-1',
      },
      pagination: { historyCoverage: 'FULL', pageIndex: 0, pageCount: 1 },
    });
    expect(readiness.fieldMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ p3Field: 'transfer_identity', readiness: 'UNRESOLVED_PROVIDER_SEMANTICS' }),
      expect.objectContaining({ p3Field: 'quantity_sent', readiness: 'UNRESOLVED_PROVIDER_SEMANTICS' }),
      expect.objectContaining({ p3Field: 'source_location', readiness: 'UNRESOLVED_PROVIDER_SEMANTICS' }),
    ]));
    expect(readiness.semanticResolution).toEqual(expect.objectContaining({
      state: 'PENDING_PROVIDER_SEMANTICS',
      transferFact: null,
    }));
    expectZeroClaim(readiness);
  });

  it('rejects a chronology, matching-ID, matching-quantity, and counterpart trap until P3 has independently verified provider semantics', () => {
    const result = evaluateTransferSemanticEvidence(completeLookingEvidence());
    expect(result).toEqual(expect.objectContaining({
      state: 'PENDING_PROVIDER_SEMANTICS',
      reasonCodes: ['PROVIDER_SEMANTICS_UNVERIFIED'],
      transferFact: null,
    }));
    expectZeroClaim(result);
  });

  it('rejects cross-marketplace and duplicate-fingerprint counterpart attempts before any Transfer fact can be emitted', () => {
    const crossMarketplace = evaluateTransferSemanticEvidence(completeLookingEvidence({
      providerSemantics: { status: 'VERIFIED_TRANSFER', evidenceReference: 'hypothetical-authority' },
      counterpartCandidates: [{
        providerRowFingerprint: 'p135-cross-market',
        scope: { ...scope, marketplaceId: 'A1PA6795UKMFR9' },
        transferIdentity: 'matching-reference-id',
        sourceLocation: 'FC-B',
        destinationLocation: 'FC-A',
        fnsku: 'FNSKU-1',
        rawPayloadHash: 'p135-cross-market-hash',
      }],
    }));
    expect(crossMarketplace).toEqual(expect.objectContaining({ state: 'UNPAIRED', transferFact: null }));
    expectZeroClaim(crossMarketplace);

    const duplicateFingerprint = evaluateTransferSemanticEvidence(completeLookingEvidence({
      providerSemantics: { status: 'VERIFIED_TRANSFER', evidenceReference: 'hypothetical-authority' },
      providerFingerprintOccurrences: 2,
    }));
    expect(duplicateFingerprint).toEqual(expect.objectContaining({
      state: 'PENDING_PROVIDER_SEMANTICS',
      reasonCodes: ['DUPLICATE_PROVIDER_FINGERPRINT'],
      transferFact: null,
    }));
    expectZeroClaim(duplicateFingerprint);
  });

  it('keeps even a local P5 authoritative catalog entry from bypassing P3 semantic truth', () => {
    const lookup = {
      providerSource: 'amazon_inventory_ledger' as const,
      reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
      providerEventTypeRaw: null,
      providerField: '$reportType',
      semanticTarget: 'report_context' as const,
      marketplaceId: 'ATVPDKIKX0DER',
      providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    };
    const resolution = resolveProviderSemanticsCatalog(lookup, TRANSFER_PROVIDER_SEMANTICS_CATALOG);
    expect(resolution).toEqual(expect.objectContaining({
      status: 'AUTHORITATIVELY_PROVEN',
      p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
    }));
    const result = evaluateCatalogThenP3(completeLookingEvidence(), resolution);
    expect(result).toEqual(expect.objectContaining({
      state: 'PENDING_PROVIDER_SEMANTICS',
      transferFact: null,
    }));
    expectZeroClaim(result);
  });

  it('treats missing lifecycle, contradictory quantity, and partial history as non-economic unresolved states', () => {
    for (const input of [
      completeLookingEvidence({ historyCoverage: 'PARTIAL' }),
      completeLookingEvidence({ providerSemantics: { status: 'VERIFIED_TRANSFER', evidenceReference: 'hypothetical-authority' }, quantity: { sent: 7, received: 6 } }),
      completeLookingEvidence({ providerSemantics: { status: 'VERIFIED_TRANSFER', evidenceReference: 'hypothetical-authority' }, lifecycle: 'UNKNOWN' }),
    ]) {
      const result = evaluateTransferSemanticEvidence(input);
      expect(['PENDING_PROVIDER_SEMANTICS', 'AMBIGUOUS']).toContain(result.state);
      expect(result.transferFact).toBeNull();
      expectZeroClaim(result);
    }
  });

  it('records the full local cross-gate program as not certified when authoritative provider semantics were intentionally not retrieved', () => {
    const evidence = runLocalP135AuditHarness({
      localGatePasses: TRANSFER_P135_AUDIT_REGISTRY.filter((gate) => gate.id !== 'P13' && gate.id !== 'P135').map((gate) => gate.id),
      providerSemanticAuthorityAvailable: false,
    });
    const certification = evaluateP135Certification(evidence, safeSnapshot);
    expect(certification).toEqual(expect.objectContaining({
      verdict: 'NOT_CERTIFIED',
      reasonCodes: expect.arrayContaining(['P3_PROVIDER_SEMANTICS_UNRESOLVED']),
      transferActivationAuthorized: false,
      detectorAuthorized: false,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
      detectorResult: null,
    }));
  });
});
