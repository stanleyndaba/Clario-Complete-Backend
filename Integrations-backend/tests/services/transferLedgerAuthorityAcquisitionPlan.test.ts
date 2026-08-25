import { describe, expect, it } from '@jest/globals';
import {
  AUTHORITY_HIERARCHY,
  AuthorityAcquisitionTarget,
  AuthorityReview,
  EvidenceAcquisitionRecord,
  P6_FUTURE_CONTROLLED_PROVIDER_TEST_PLAN,
  reviewAuthorityAcquisitionRecord,
  TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION,
  TRANSFER_AUTHORITY_ACQUISITION_TARGETS,
  authorityAcquisitionDetectorResult,
} from '../../src/services/transferLedgerAuthorityAcquisitionPlan';
import {
  AMAZON_REPORTS_API_ARTIFACT_VERSION,
  resolveProviderSemanticsCatalog,
} from '../../src/services/transferLedgerProviderSemanticsCatalog';
import { AMAZON_LEDGER_DETAIL_REPORT_TYPE } from '../../src/services/transferLedgerProviderEvidenceReadiness';
import { evaluateTransferSemanticEvidence, TransferSemanticEvidence } from '../../src/services/transferLedgerSemanticEvidence';

const target = (id: string): AuthorityAcquisitionTarget => {
  const found = TRANSFER_AUTHORITY_ACQUISITION_TARGETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Target ${id} was not found`);
  return found;
};

const completeReview: AuthorityReview = {
  reviewerId: 'reviewer-1',
  reviewedAt: '2026-08-25T00:00:00.000Z',
  exactPropositionAnswered: true,
  exactArtifactAnswered: true,
  authorityAnswered: true,
  providerContextAnswered: true,
  marketplaceAnswered: true,
  artifactVersionAnswered: true,
  negativeBoundaryAnswered: true,
  reproducibilityAnswered: true,
  provenanceAnswered: true,
  independentAuditAnswered: true,
  proposedUpgradeAnswered: true,
  p3FailClosedAnswered: true,
  notes: 'All required P6 review answers are present.',
};

function validRecord(targetDefinition: AuthorityAcquisitionTarget, overrides: Partial<EvidenceAcquisitionRecord> = {}): EvidenceAcquisitionRecord {
  const context = targetDefinition.providerContext;
  return {
    evidenceId: `evidence-${targetDefinition.id}-v1`,
    targetId: targetDefinition.id,
    provider: context.provider,
    artifactType: 'official-provider-document',
    sourceReference: 'https://example.invalid/official-provider-doc',
    retrievedAt: '2026-08-25T00:00:00.000Z',
    artifactVersion: context.artifactVersion,
    marketplaceId: 'ATVPDKIKX0DER',
    reportType: context.reportType,
    eventType: context.eventType,
    field: context.field,
    proposedSemanticTarget: targetDefinition.semanticTarget,
    proposition: targetDefinition.proposition,
    evidenceReference: 'section-4.2',
    evidenceExcerptOrLocator: 'Exact provider statement proving only this target proposition.',
    provenanceHash: 'a'.repeat(64),
    authorityClass: 'AUTHORITATIVE_PROVIDER_DOCUMENTATION',
    evidenceAssessment: 'CLEAR',
    proposedCatalogUpgrade: 'AUTHORITATIVELY_PROVEN',
    reviewerStatus: 'APPROVED',
    review: completeReview,
    negativeConditions: targetDefinition.negativeConditions,
    supersedes: null,
    supersededBy: null,
    invalidatedAt: null,
    invalidationReason: null,
    scope: {
      tenantId: null,
      userId: null,
      storeId: null,
      marketplaceId: 'ATVPDKIKX0DER',
      crossTenantAssertionPermitted: false,
      crossStoreAssertionPermitted: false,
      crossMarketplaceAssertionPermitted: false,
    },
    notes: null,
    ...overrides,
  };
}

function expectP6NonEconomic(result: ReturnType<typeof reviewAuthorityAcquisitionRecord>) {
  expect(result).toEqual(expect.objectContaining({
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  }));
}

describe('Transfer Ledger P6 controlled authority-acquisition plan', () => {
  it('contains every independently required semantic target with versioning and negative conditions', () => {
    const expectedIds = [
      'transfer-identity',
      'source-location',
      'destination-location',
      'sent-quantity',
      'received-quantity',
      'dispatch-timestamp',
      'receipt-timestamp',
      'lifecycle-status',
      'whse-transfers-meaning',
      'counterpart-pairing-semantics',
    ];
    expect(TRANSFER_AUTHORITY_ACQUISITION_TARGETS.map((entry) => entry.id)).toEqual(expectedIds);
    for (const entry of TRANSFER_AUTHORITY_ACQUISITION_TARGETS) {
      expect(entry).toEqual(expect.objectContaining({
        version: TRANSFER_AUTHORITY_ACQUISITION_PLAN_VERSION,
        currentStatus: 'UNRESOLVED_PROVIDER_SEMANTICS',
        providerContext: expect.objectContaining({
          reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
          artifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
        }),
      }));
      expect(entry.negativeConditions.length).toBeGreaterThan(0);
      expect(entry.reviewRequirements.length).toBeGreaterThan(0);
    }
  });

  it('keeps an incomplete acquisition plan unresolved', () => {
    const result = reviewAuthorityAcquisitionRecord(target('transfer-identity'), null);
    expect(result).toEqual(expect.objectContaining({
      state: 'EVIDENCE_REQUIRED',
      reasonCodes: ['MISSING_EVIDENCE_RECORD'],
      proposedCatalogUpgrade: null,
    }));
    expectP6NonEconomic(result);
  });

  it('rejects unsupported authority classes and raw-only evidence', () => {
    const targetDefinition = target('transfer-identity');
    for (const authorityClass of ['OBSERVED_RAW', 'UNRESOLVED', 'UNSUPPORTED'] as const) {
      const result = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition, { authorityClass }));
      expect(result).toEqual(expect.objectContaining({
        state: 'UNSUPPORTED',
        reasonCodes: ['UNSUPPORTED_AUTHORITY_CLASS'],
      }));
      expectP6NonEconomic(result);
    }
    expect(AUTHORITY_HIERARCHY.OBSERVED_RAW.acceptableForReview).toBe(false);
  });

  it('fails closed on wrong artifact version, marketplace, report context, and scope', () => {
    const targetDefinition = target('transfer-identity');
    for (const record of [
      validRecord(targetDefinition, { artifactVersion: 'new-provider-version' }),
      validRecord(targetDefinition, { reportType: 'GET_UNRELATED_REPORT' }),
      validRecord(targetDefinition, { scope: { ...validRecord(targetDefinition).scope, marketplaceId: 'A1PA6795UKMFR9' } }),
    ]) {
      const result = reviewAuthorityAcquisitionRecord(targetDefinition, record);
      expect(result.state).toBe('UNRESOLVED');
      expect(result.reasonCodes).toContain('CONTEXT_OR_SCOPE_MISMATCH');
      expectP6NonEconomic(result);
    }

    const marketplaceScopedTarget: AuthorityAcquisitionTarget = {
      ...targetDefinition,
      providerContext: { ...targetDefinition.providerContext, marketplaceIds: ['ATVPDKIKX0DER'] },
    };
    const incorrectMarketplace = reviewAuthorityAcquisitionRecord(
      marketplaceScopedTarget,
      validRecord(marketplaceScopedTarget, {
        marketplaceId: 'A1PA6795UKMFR9',
        scope: { ...validRecord(marketplaceScopedTarget).scope, marketplaceId: 'A1PA6795UKMFR9' },
      }),
    );
    expect(incorrectMarketplace.reasonCodes).toEqual(['CONTEXT_OR_SCOPE_MISMATCH']);

    const targetMismatch = reviewAuthorityAcquisitionRecord(
      targetDefinition,
      validRecord(targetDefinition, { proposition: 'A different assertion' }),
    );
    expect(targetMismatch).toEqual(expect.objectContaining({
      state: 'UNRESOLVED',
      reasonCodes: ['TARGET_MISMATCH'],
    }));
  });

  it('fails closed for missing provenance, incomplete review, ambiguous evidence, and rejected review', () => {
    const targetDefinition = target('source-location');
    const missingProvenance = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition, { provenanceHash: null }));
    expect(missingProvenance.reasonCodes).toEqual(['MISSING_OR_INVALID_PROVENANCE']);

    const incompleteReview = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition, {
      reviewerStatus: 'UNDER_REVIEW',
      review: { ...completeReview, reviewerId: null },
    }));
    expect(incompleteReview).toEqual(expect.objectContaining({ state: 'UNDER_REVIEW', reasonCodes: ['INCOMPLETE_REVIEW'] }));

    const ambiguous = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition, { evidenceAssessment: 'AMBIGUOUS' }));
    expect(ambiguous.reasonCodes).toEqual(['AMBIGUOUS_EVIDENCE']);

    const rejected = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition, { reviewerStatus: 'REJECTED' }));
    expect(rejected).toEqual(expect.objectContaining({ state: 'REJECTED', reasonCodes: ['REVIEW_REJECTED'] }));
  });

  it('keeps superseded and invalidated evidence inactive', () => {
    const targetDefinition = target('sent-quantity');
    const superseded = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition, { supersededBy: 'evidence-newer' }));
    expect(superseded).toEqual(expect.objectContaining({ state: 'SUPERSEDED', reasonCodes: ['EVIDENCE_SUPERSEDED'] }));

    const invalidated = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition, {
      invalidatedAt: '2026-08-26T00:00:00.000Z',
      invalidationReason: 'Provider schema version no longer applies.',
    }));
    expect(invalidated).toEqual(expect.objectContaining({ state: 'INVALIDATED', reasonCodes: ['EVIDENCE_INVALIDATED'] }));
  });

  it('does not permit weaker evidence to propose an authoritative upgrade', () => {
    const targetDefinition = target('received-quantity');
    const result = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition, {
      authorityClass: 'APPROVED_REDACTED_FIXTURE',
    }));
    expect(result).toEqual(expect.objectContaining({
      state: 'UNRESOLVED',
      reasonCodes: ['INSUFFICIENT_AUTHORITY_FOR_PROPOSED_UPGRADE'],
    }));
    expectP6NonEconomic(result);
  });

  it('records a complete authoritative evidence package only as ready for separate P5 catalog review', () => {
    const targetDefinition = target('whse-transfers-meaning');
    const result = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition));
    expect(result).toEqual(expect.objectContaining({
      state: 'READY_FOR_SEPARATE_CATALOG_REVIEW',
      reasonCodes: ['EVIDENCE_REQUIRES_SEPARATE_P5_CATALOG_REVIEW'],
      proposedCatalogUpgrade: 'AUTHORITATIVELY_PROVEN',
      catalogMutationAuthorized: false,
      p3OverrideAuthorized: false,
    }));
    expectP6NonEconomic(result);
  });

  it('is deterministic on replay and cannot emit a detector result', () => {
    const targetDefinition = target('counterpart-pairing-semantics');
    const record = validRecord(targetDefinition);
    const first = reviewAuthorityAcquisitionRecord(targetDefinition, record);
    const replay = reviewAuthorityAcquisitionRecord(targetDefinition, record);
    expect(first).toEqual(replay);
    expect(authorityAcquisitionDetectorResult(first)).toBeNull();
  });

  it('cannot bypass P5 or P3 even when the input evidence is otherwise complete', () => {
    const targetDefinition = target('transfer-identity');
    const p6Result = reviewAuthorityAcquisitionRecord(targetDefinition, validRecord(targetDefinition));
    const p5Result = resolveProviderSemanticsCatalog({
      providerSource: 'amazon_inventory_ledger',
      reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
      providerEventTypeRaw: 'WhseTransfers',
      providerField: 'Reference ID',
      semanticTarget: 'transfer_identity',
      marketplaceId: 'ATVPDKIKX0DER',
      providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    });
    const p3Evidence: TransferSemanticEvidence = {
      scope: { tenantId: 'tenant-a', userId: 'user-a', storeId: 'store-a', marketplaceId: 'ATVPDKIKX0DER' },
      sourceRunId: 'source-run-1',
      providerRowFingerprint: 'primary-row',
      providerFingerprintOccurrences: 1,
      rawPayloadHash: 'payload-primary',
      providerEventTypeRaw: 'WhseTransfers',
      providerSemantics: p5Result.p3ProviderSemantics,
      transferIdentity: 'transfer-1',
      sourceLocation: 'FC-A',
      destinationLocation: 'FC-B',
      item: { fnsku: 'FNSKU-1', sku: 'SKU-1', asin: 'ASIN-1' },
      quantity: { sent: 7, received: 7 },
      timestamps: { sentAt: '2026-01-01T00:00:00.000Z', receivedAt: '2026-01-02T00:00:00.000Z', closedAt: null },
      lifecycle: 'RECEIVED',
      historyCoverage: 'FULL',
      counterpartCandidates: [{
        providerRowFingerprint: 'counterpart-row',
        scope: { tenantId: 'tenant-a', userId: 'user-a', storeId: 'store-a', marketplaceId: 'ATVPDKIKX0DER' },
        transferIdentity: 'transfer-1',
        sourceLocation: 'FC-B',
        destinationLocation: 'FC-A',
        fnsku: 'FNSKU-1',
        rawPayloadHash: 'payload-counterpart',
      }],
    };
    const p3Result = evaluateTransferSemanticEvidence(p3Evidence);

    expect(p6Result.catalogMutationAuthorized).toBe(false);
    expect(p6Result.p3OverrideAuthorized).toBe(false);
    expect(p5Result.p3ProviderSemantics.status).toBe('PENDING_PROVIDER_SEMANTICS');
    expect(p3Result).toEqual(expect.objectContaining({
      state: 'PENDING_PROVIDER_SEMANTICS',
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
      transferFact: null,
    }));
  });

  it('publishes a non-executable future controlled provider test plan with mandatory isolation controls', () => {
    expect(P6_FUTURE_CONTROLLED_PROVIDER_TEST_PLAN).toEqual(expect.objectContaining({
      status: 'DESIGN_ONLY_DO_NOT_EXECUTE',
      executionMode: 'OBSERVATION_ONLY_REVERSIBLE',
    }));
    expect(P6_FUTURE_CONTROLLED_PROVIDER_TEST_PLAN.requiredControls).toEqual(expect.arrayContaining([
      expect.stringContaining('tenant'),
      expect.stringContaining('claim'),
      expect.stringContaining('fingerprint'),
      expect.stringContaining('cross-tenant'),
    ]));
  });
});
