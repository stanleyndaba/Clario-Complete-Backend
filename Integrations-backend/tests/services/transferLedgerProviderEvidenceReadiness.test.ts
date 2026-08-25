import { describe, expect, it } from '@jest/globals';
import {
  AMAZON_LEDGER_DETAIL_REPORT_TYPE,
  assessTransferProviderEvidenceReadiness,
  TransferProviderEvidenceInput,
} from '../../src/services/transferLedgerProviderEvidenceReadiness';

const scope = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  storeId: 'store-a',
  marketplaceId: 'ATVPDKIKX0DER',
};

function input(overrides: Partial<TransferProviderEvidenceInput> = {}): TransferProviderEvidenceInput {
  return {
    scope,
    sourceRunId: 'source-run-1',
    providerRowFingerprint: 'provider-row-1',
    providerFingerprintOccurrences: 1,
    providerSource: 'amazon_inventory_ledger',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    rawPayload: {
      Date: '2026-01-01',
      'Date and Time': '2026-01-01T12:00:00Z',
      FNSKU: 'FNSKU-1',
      ASIN: 'ASIN-1',
      MSKU: 'SKU-1',
      'Event Type': 'WhseTransfers',
      'Reference ID': 'reference-1',
      Quantity: '-7',
      'Fulfillment Center': 'FC-ONE',
      Country: 'US',
    },
    pagination: { historyCoverage: 'FULL', pageIndex: 0, pageCount: 1 },
    ...overrides,
  };
}

function mapping(result: ReturnType<typeof assessTransferProviderEvidenceReadiness>, p3Field: string) {
  const found = result.fieldMappings.find((entry) => entry.p3Field === p3Field);
  if (!found) throw new Error(`Missing mapping for ${p3Field}`);
  return found;
}

function expectNonEconomicPending(result: ReturnType<typeof assessTransferProviderEvidenceReadiness>, reason?: string) {
  expect(result).toEqual(expect.objectContaining({
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    semanticResolution: expect.objectContaining({
      state: 'PENDING_PROVIDER_SEMANTICS',
      transferFact: null,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }),
  }));
  if (reason) {
    expect(result.semanticResolution.reasonCodes).toContain(reason);
  }
}

describe('Transfer Ledger P4 provider evidence readiness mapper', () => {
  it('preserves the documented Ledger-detail raw fields and provenance without inferring a Transfer', () => {
    const result = assessTransferProviderEvidenceReadiness(input());

    expect(result).toEqual(expect.objectContaining({
      reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
      reportTypeReadiness: 'DOCUMENTED_RAW_SCHEMA',
      replayKey: 'provider-row-1',
      rawPayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
    expect(mapping(result, 'provider_event_type')).toEqual(expect.objectContaining({
      rawValue: 'WhseTransfers',
      readiness: 'OBSERVED_RAW',
      provenanceReference: 'raw_payload.Event Type',
    }));
    expect(mapping(result, 'fnsku')).toEqual(expect.objectContaining({
      rawValue: 'FNSKU-1',
      readiness: 'OBSERVED_RAW',
    }));
    expect(mapping(result, 'transfer_identity')).toEqual(expect.objectContaining({
      rawValue: 'reference-1',
      readiness: 'UNRESOLVED_PROVIDER_SEMANTICS',
    }));
    expect(mapping(result, 'source_location')).toEqual(expect.objectContaining({
      rawValue: 'FC-ONE',
      readiness: 'UNRESOLVED_PROVIDER_SEMANTICS',
    }));
    expect(mapping(result, 'quantity_sent')).toEqual(expect.objectContaining({
      rawValue: '-7',
      readiness: 'UNRESOLVED_PROVIDER_SEMANTICS',
    }));
    expectNonEconomicPending(result, 'PROVIDER_SEMANTICS_UNVERIFIED');
  });

  it('marks missing transfer identity, source, destination, FNSKU, sent quantity, received quantity, and timestamps explicitly missing', () => {
    const missingPayloads: Array<{ field: string; payload: Record<string, unknown> }> = [
      { field: 'transfer_identity', payload: { ...input().rawPayload, 'Reference ID': '' } },
      { field: 'source_location', payload: { ...input().rawPayload, 'Fulfillment Center': '' } },
      { field: 'destination_location', payload: { ...input().rawPayload, 'Fulfillment Center': '' } },
      { field: 'fnsku', payload: { ...input().rawPayload, FNSKU: '' } },
      { field: 'quantity_sent', payload: { ...input().rawPayload, Quantity: '' } },
      { field: 'quantity_received', payload: { ...input().rawPayload, Quantity: '' } },
      { field: 'dispatch_timestamp', payload: { ...input().rawPayload, Date: '', 'Date and Time': '' } },
      { field: 'receipt_timestamp', payload: { ...input().rawPayload, Date: '', 'Date and Time': '' } },
    ];

    for (const fixture of missingPayloads) {
      const result = assessTransferProviderEvidenceReadiness(input({ rawPayload: fixture.payload }));
      expect(mapping(result, fixture.field).readiness).toBe('MISSING');
      expectNonEconomicPending(result, 'PROVIDER_SEMANTICS_UNVERIFIED');
    }
  });

  it('does not assign sent or received roles from conflicting candidate quantity fields', () => {
    const result = assessTransferProviderEvidenceReadiness(input({
      rawPayload: {
        ...input().rawPayload,
        'Quantity Sent': '7',
        'Quantity Received': '6',
      },
    }));

    expect(mapping(result, 'quantity_sent')).toEqual(expect.objectContaining({
      rawValue: '-7',
      readiness: 'UNRESOLVED_PROVIDER_SEMANTICS',
    }));
    expect(mapping(result, 'quantity_received')).toEqual(expect.objectContaining({
      rawValue: '-7',
      readiness: 'UNRESOLVED_PROVIDER_SEMANTICS',
    }));
    expectNonEconomicPending(result, 'PROVIDER_SEMANTICS_UNVERIFIED');
  });

  it('does not assign lifecycle roles from impossible candidate timestamp ordering', () => {
    const result = assessTransferProviderEvidenceReadiness(input({
      rawPayload: {
        ...input().rawPayload,
        'Dispatch Date': '2026-01-03T10:00:00Z',
        'Receipt Date': '2026-01-02T10:00:00Z',
      },
    }));

    expect(mapping(result, 'dispatch_timestamp').readiness).toBe('UNRESOLVED_PROVIDER_SEMANTICS');
    expect(mapping(result, 'receipt_timestamp').readiness).toBe('UNRESOLVED_PROVIDER_SEMANTICS');
    expectNonEconomicPending(result, 'PROVIDER_SEMANTICS_UNVERIFIED');
  });

  it('keeps partial and unknown history pending', () => {
    for (const historyCoverage of ['PARTIAL', 'UNKNOWN'] as const) {
      const result = assessTransferProviderEvidenceReadiness(input({
        pagination: { historyCoverage, pageIndex: 0, pageCount: null },
      }));
      expect(result.semanticEvidence.historyCoverage).toBe(historyCoverage);
      expectNonEconomicPending(result, 'PROVIDER_SEMANTICS_UNVERIFIED');
    }
  });

  it('treats duplicate provider events as unresolved before any pairing behavior', () => {
    const result = assessTransferProviderEvidenceReadiness(input({ providerFingerprintOccurrences: 2 }));
    expectNonEconomicPending(result, 'DUPLICATE_PROVIDER_FINGERPRINT');
  });

  it('is replay-safe for the same immutable provider fingerprint and raw payload', () => {
    const first = assessTransferProviderEvidenceReadiness(input());
    const replay = assessTransferProviderEvidenceReadiness(input());

    expect(first).toEqual(replay);
    expect(first.replayKey).toBe('provider-row-1');
  });

  it('does not use duplicate raw reference identifiers to create a semantic Transfer', () => {
    const first = assessTransferProviderEvidenceReadiness(input());
    const second = assessTransferProviderEvidenceReadiness(input({
      providerRowFingerprint: 'provider-row-2',
      rawPayload: { ...input().rawPayload, Quantity: '7' },
    }));

    expect(first.fieldMappings.find((entry) => entry.p3Field === 'transfer_identity')?.rawValue).toBe('reference-1');
    expect(second.fieldMappings.find((entry) => entry.p3Field === 'transfer_identity')?.rawValue).toBe('reference-1');
    expectNonEconomicPending(first, 'PROVIDER_SEMANTICS_UNVERIFIED');
    expectNonEconomicPending(second, 'PROVIDER_SEMANTICS_UNVERIFIED');
  });

  it('preserves scope and refuses cross-tenant, cross-store, and cross-marketplace inference', () => {
    for (const scopedInput of [
      input({ scope: { ...scope, tenantId: 'tenant-b' } }),
      input({ scope: { ...scope, storeId: 'store-b' } }),
      input({ scope: { ...scope, marketplaceId: 'A1PA6795UKMFR9' } }),
    ]) {
      const result = assessTransferProviderEvidenceReadiness(scopedInput);
      expect(result.semanticEvidence.scope).toEqual(scopedInput.scope);
      expect(result.semanticEvidence.counterpartCandidates).toEqual([]);
      expectNonEconomicPending(result, 'PROVIDER_SEMANTICS_UNVERIFIED');
    }
  });

  it('marks an unsupported report type pending before it can be interpreted as a Transfer source', () => {
    const result = assessTransferProviderEvidenceReadiness(input({ reportType: 'GET_UNRELATED_REPORT' }));

    expect(result.reportTypeReadiness).toBe('UNSUPPORTED_REPORT_TYPE');
    expectNonEconomicPending(result, 'UNSUPPORTED_PROVIDER_EVENT_TYPE');
  });

  it('marks unsupported provider event types as pending rather than treating them as transfers', () => {
    const result = assessTransferProviderEvidenceReadiness(input({
      rawPayload: { ...input().rawPayload, 'Event Type': 'Other Transfer' },
    }));
    expectNonEconomicPending(result, 'UNSUPPORTED_PROVIDER_EVENT_TYPE');
  });

  it('fails closed for malformed provenance', () => {
    const result = assessTransferProviderEvidenceReadiness(input({
      sourceRunId: null,
      providerRowFingerprint: null,
    }));
    expectNonEconomicPending(result, 'MALFORMED_EVIDENCE');
  });
});
