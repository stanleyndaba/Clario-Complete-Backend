import { describe, expect, it } from '@jest/globals';
import {
  AMAZON_REPORTS_API_ARTIFACT_VERSION,
  ProviderSemanticsCatalogEntry,
  ProviderSemanticsLookup,
  resolveProviderSemanticsCatalog,
  evaluateCatalogThenP3,
  TRANSFER_PROVIDER_SEMANTICS_CATALOG,
  TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
} from '../../src/services/transferLedgerProviderSemanticsCatalog';
import { AMAZON_LEDGER_DETAIL_REPORT_TYPE } from '../../src/services/transferLedgerProviderEvidenceReadiness';
import { TransferSemanticEvidence } from '../../src/services/transferLedgerSemanticEvidence';

const baseLookup = (overrides: Partial<ProviderSemanticsLookup> = {}): ProviderSemanticsLookup => ({
  providerSource: 'amazon_inventory_ledger',
  reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
  providerEventTypeRaw: null,
  providerField: '$reportType',
  semanticTarget: 'report_context',
  marketplaceId: 'ATVPDKIKX0DER',
  providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
  ...overrides,
});

const completeEvidence: TransferSemanticEvidence = {
  scope: {
    tenantId: 'tenant-a',
    userId: 'user-a',
    storeId: 'store-a',
    marketplaceId: 'ATVPDKIKX0DER',
  },
  sourceRunId: 'source-run-1',
  providerRowFingerprint: 'provider-row-primary-1',
  providerFingerprintOccurrences: 1,
  rawPayloadHash: 'payload-hash-primary-1',
  providerEventTypeRaw: 'WhseTransfers',
  providerSemantics: { status: 'VERIFIED_TRANSFER', evidenceReference: 'hypothetical-proof' },
  transferIdentity: 'transfer-123',
  sourceLocation: 'FC-SOURCE',
  destinationLocation: 'FC-DESTINATION',
  item: { fnsku: 'FNSKU-1', sku: 'SKU-1', asin: 'ASIN-1' },
  quantity: { sent: 7, received: 7 },
  timestamps: { sentAt: '2026-01-01T10:00:00.000Z', receivedAt: '2026-01-02T10:00:00.000Z', closedAt: null },
  lifecycle: 'RECEIVED',
  historyCoverage: 'FULL',
  counterpartCandidates: [{
    providerRowFingerprint: 'provider-row-counterpart-1',
    scope: {
      tenantId: 'tenant-a',
      userId: 'user-a',
      storeId: 'store-a',
      marketplaceId: 'ATVPDKIKX0DER',
    },
    transferIdentity: 'transfer-123',
    sourceLocation: 'FC-DESTINATION',
    destinationLocation: 'FC-SOURCE',
    fnsku: 'FNSKU-1',
    rawPayloadHash: 'payload-hash-counterpart-1',
  }],
};

function expectNonEconomic(result: { claimCapable: false; recoveryDetected: false; economicValue: null }) {
  expect(result).toEqual(expect.objectContaining({
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
  }));
}

describe('Transfer Ledger P5 authoritative provider semantics catalog', () => {
  it('accepts the narrow authoritative mapping for the report context only', () => {
    const result = resolveProviderSemanticsCatalog(baseLookup());

    expect(result).toEqual(expect.objectContaining({
      catalogVersion: TRANSFER_PROVIDER_SEMANTICS_CATALOG_VERSION,
      status: 'AUTHORITATIVELY_PROVEN',
      allowedAssertion: 'REPORT_CONTEXT_ONLY',
      entry: expect.objectContaining({ id: 'amazon-ledger-detail-report-context' }),
      p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
    }));
    expectNonEconomic(result);
  });

  it('keeps WhseTransfers alone unresolved and enforces its negative rule', () => {
    const result = resolveProviderSemanticsCatalog(baseLookup({
      providerEventTypeRaw: 'WhseTransfers',
      providerField: 'Event Type',
      semanticTarget: 'transfer_lifecycle',
    }));

    expect(result).toEqual(expect.objectContaining({
      status: 'UNRESOLVED_PROVIDER_SEMANTICS',
      allowedAssertion: 'NONE',
      entry: expect.objectContaining({
        id: 'amazon-ledger-detail-whse-transfers-unresolved',
        negativeCondition: expect.stringContaining('must not be interpreted'),
      }),
    }));
    expectNonEconomic(result);
  });

  it('keeps Reference ID, Fulfillment Center, Quantity, and timestamp mappings unresolved', () => {
    for (const lookup of [
      baseLookup({ providerField: 'Reference ID', semanticTarget: 'transfer_identity' }),
      baseLookup({ providerField: 'Fulfillment Center', semanticTarget: 'source_location' }),
      baseLookup({ providerField: 'Fulfillment Center', semanticTarget: 'destination_location' }),
      baseLookup({ providerField: 'Quantity', semanticTarget: 'quantity_sent' }),
      baseLookup({ providerField: 'Quantity', semanticTarget: 'quantity_received' }),
      baseLookup({ providerField: 'Date and Time', semanticTarget: 'dispatch_timestamp' }),
      baseLookup({ providerField: 'Date and Time', semanticTarget: 'receipt_timestamp' }),
    ]) {
      const result = resolveProviderSemanticsCatalog(lookup);
      expect(result.status).toBe('UNRESOLVED_PROVIDER_SEMANTICS');
      expect(result.allowedAssertion).toBe('NONE');
      expect(result.entry?.negativeCondition).toContain('must not');
      expectNonEconomic(result);
    }
  });

  it('marks lifecycle as unsupported rather than manufacturing a lifecycle enum', () => {
    const result = resolveProviderSemanticsCatalog(baseLookup({
      providerField: '$lifecycle',
      semanticTarget: 'transfer_lifecycle',
    }));

    expect(result).toEqual(expect.objectContaining({
      status: 'UNSUPPORTED',
      allowedAssertion: 'NONE',
      p3ProviderSemantics: { status: 'UNSUPPORTED', evidenceReference: null },
    }));
    expectNonEconomic(result);
  });

  it('allows raw event evidence to remain raw only rather than authoritative', () => {
    const result = resolveProviderSemanticsCatalog(baseLookup({
      providerEventTypeRaw: 'WhseTransfers',
      providerField: 'Event Type',
      semanticTarget: 'provider_event_type',
    }));

    expect(result).toEqual(expect.objectContaining({
      status: 'OBSERVED_RAW_ONLY',
      allowedAssertion: 'RAW_FIELD_ONLY',
      p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
    }));
    expectNonEconomic(result);
  });

  it('rejects incorrect report, marketplace, and provider-artifact contexts', () => {
    const incorrectReport = resolveProviderSemanticsCatalog(baseLookup({ reportType: 'GET_UNRELATED_REPORT' }));
    expect(incorrectReport).toEqual(expect.objectContaining({
      status: 'UNRESOLVED_PROVIDER_SEMANTICS',
      reasonCodes: ['NO_CATALOG_MAPPING'],
    }));

    const marketplaceScoped: ProviderSemanticsCatalogEntry = {
      ...TRANSFER_PROVIDER_SEMANTICS_CATALOG[0],
      id: 'marketplace-scoped-report-context',
      scope: { marketplaceIds: ['ATVPDKIKX0DER'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    };
    const incorrectMarketplace = resolveProviderSemanticsCatalog(
      baseLookup({ marketplaceId: 'A1PA6795UKMFR9' }),
      [marketplaceScoped],
    );
    expect(incorrectMarketplace.reasonCodes).toEqual(['NO_CATALOG_MAPPING']);

    const incorrectArtifact = resolveProviderSemanticsCatalog(baseLookup({ providerArtifactVersion: 'future-version' }));
    expect(incorrectArtifact.reasonCodes).toEqual(['NO_CATALOG_MAPPING']);
  });

  it('handles an approved-evidence catalog entry deterministically but still never upgrades P3 semantics', () => {
    const approvedEntry: ProviderSemanticsCatalogEntry = {
      ...TRANSFER_PROVIDER_SEMANTICS_CATALOG[3],
      id: 'approved-reference-id-fixture',
      status: 'APPROVED_EVIDENCE',
      allowedAssertion: 'RAW_FIELD_ONLY',
      authority: {
        kind: 'APPROVED_CONTROLLED_EVIDENCE',
        reference: 'fixture://approved-reference-id-v1',
        version: '1.0.0',
      },
    };
    const first = resolveProviderSemanticsCatalog(
      baseLookup({ providerField: 'Reference ID', semanticTarget: 'transfer_identity' }),
      [approvedEntry],
    );
    const replay = resolveProviderSemanticsCatalog(
      baseLookup({ providerField: 'Reference ID', semanticTarget: 'transfer_identity' }),
      [approvedEntry],
    );

    expect(first).toEqual(replay);
    expect(first).toEqual(expect.objectContaining({
      status: 'APPROVED_EVIDENCE',
      allowedAssertion: 'RAW_FIELD_ONLY',
      p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
    }));
    expectNonEconomic(first);
  });

  it('fails closed for ambiguous overlapping catalog entries', () => {
    const duplicateEntries = [TRANSFER_PROVIDER_SEMANTICS_CATALOG[0], {
      ...TRANSFER_PROVIDER_SEMANTICS_CATALOG[0],
      id: 'duplicate-report-context',
    }];
    const result = resolveProviderSemanticsCatalog(baseLookup(), duplicateEntries);

    expect(result).toEqual(expect.objectContaining({
      status: 'UNRESOLVED_PROVIDER_SEMANTICS',
      reasonCodes: ['AMBIGUOUS_CATALOG_MAPPING'],
      entry: null,
    }));
    expectNonEconomic(result);
  });

  it('cannot bypass P3 or make a complete hypothetical package claim-capable', () => {
    const catalogResolution = resolveProviderSemanticsCatalog(baseLookup());
    const result = evaluateCatalogThenP3(completeEvidence, catalogResolution);

    expect(result).toEqual(expect.objectContaining({
      state: 'PENDING_PROVIDER_SEMANTICS',
      reasonCodes: ['PROVIDER_SEMANTICS_UNVERIFIED'],
      transferFact: null,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
  });
});
