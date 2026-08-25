import { describe, expect, it } from '@jest/globals';
import {
  CatalogChangeReviewInput,
  CatalogChangeReviewContext,
  catalogChangeReviewDetectorResult,
  evaluateCatalogChangeReview,
} from '../../src/services/transferLedgerCatalogChangeReview';
import { intakeAuthorityEvidence } from '../../src/services/transferLedgerAuthorityEvidenceIntake';
import { verifyAuthorityEvidenceProposition } from '../../src/services/transferLedgerAuthorityEvidenceVerifier';
import { TRANSFER_AUTHORITY_ACQUISITION_TARGETS } from '../../src/services/transferLedgerAuthorityAcquisitionPlan';
import {
  AMAZON_REPORTS_API_ARTIFACT_VERSION,
  resolveProviderSemanticsCatalog,
} from '../../src/services/transferLedgerProviderSemanticsCatalog';

function target(id: string) {
  const found = TRANSFER_AUTHORITY_ACQUISITION_TARGETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Target ${id} is missing`);
  return found;
}

function verifiedPackage(targetId = 'transfer-identity') {
  const targetDefinition = target(targetId);
  const artifact = `${targetDefinition.proposition}\nExact P8 test package for deterministic P9 decision evaluation.`;
  const intake = intakeAuthorityEvidence({
    target: targetDefinition,
    evidenceId: `evidence-${targetId}-v1`,
    provider: 'amazon_inventory_ledger',
    artifactType: 'official-provider-document',
    sourceReference: 'https://developer-docs.amazon/sp-api/docs/report-type-values-fba',
    retrievedAt: '2026-08-25T00:00:00.000Z',
    artifactVersion: targetDefinition.providerContext.artifactVersion,
    marketplaceId: 'ATVPDKIKX0DER',
    reportType: targetDefinition.providerContext.reportType,
    eventType: targetDefinition.providerContext.eventType,
    field: targetDefinition.providerContext.field,
    proposedSemanticTarget: targetDefinition.semanticTarget,
    proposition: targetDefinition.proposition,
    evidenceReference: `section-${targetId}`,
    evidenceExcerptOrLocator: `locator-${targetId}`,
    artifactText: artifact,
    authorityClass: 'AUTHORITATIVE_PROVIDER_DOCUMENTATION',
    proposedCatalogUpgrade: 'AUTHORITATIVELY_PROVEN',
    negativeConditions: targetDefinition.negativeConditions,
    scope: {
      tenantId: null,
      userId: null,
      storeId: null,
      marketplaceId: 'ATVPDKIKX0DER',
      crossTenantAssertionPermitted: false,
      crossStoreAssertionPermitted: false,
      crossMarketplaceAssertionPermitted: false,
    },
  });
  const verification = verifyAuthorityEvidenceProposition({
    target: targetDefinition,
    intake,
    artifactText: artifact,
    assertedExcerpt: targetDefinition.proposition,
  });
  if (!verification.verificationRecord) throw new Error('Expected verified P8 package');
  return { targetDefinition, artifact, verification };
}

function contextFor(targetId = 'transfer-identity'): CatalogChangeReviewContext {
  const { targetDefinition, verification } = verifiedPackage(targetId);
  const record = verification.verificationRecord!;
  return {
    provider: record.provider,
    reportType: record.reportType,
    eventType: record.eventType,
    field: record.field,
    marketplaceId: record.marketplaceId,
    artifactVersion: record.artifactVersion,
    semanticTarget: record.proposedSemanticTarget,
    proposition: record.proposition,
    provenanceHash: record.provenanceHash!,
    sourceReference: record.sourceReference,
    evidenceLocator: record.evidenceExcerptOrLocator,
    assertedExcerpt: targetDefinition.proposition,
    authorityClass: record.authorityClass,
    negativeConditions: record.negativeConditions,
    scope: record.scope,
  };
}

function reviewInput(targetId = 'transfer-identity', overrides: Partial<CatalogChangeReviewInput> = {}): CatalogChangeReviewInput {
  const { targetDefinition, verification } = verifiedPackage(targetId);
  return {
    target: targetDefinition,
    verification,
    context: contextFor(targetId),
    reviewer: {
      reviewerId: 'reviewer-1',
      reviewerReference: 'review-ticket-001',
      reviewedAt: '2026-08-25T01:00:00.000Z',
      decision: 'ACCEPT',
      rationale: 'The exact proposition, context, provenance, and negative boundaries were independently reviewed.',
      independentlyExaminedEvidence: true,
      conflictDeclaration: 'NO_CONFLICT',
      priorDecisions: [],
      p3RemainsFailClosed: true,
      catalogMutationRequested: false,
      syntheticFixture: false,
    },
    ...overrides,
  };
}

function expectNonEconomic(result: ReturnType<typeof evaluateCatalogChangeReview>) {
  expect(result).toEqual(expect.objectContaining({
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  }));
}

describe('Transfer Ledger P9 catalog-change review decision seam', () => {
  it('creates only a non-mutating catalog-change proposal for each of the ten independently verified P6 targets', () => {
    for (const targetDefinition of TRANSFER_AUTHORITY_ACQUISITION_TARGETS) {
      const result = evaluateCatalogChangeReview(reviewInput(targetDefinition.id));
      expect(result).toEqual(expect.objectContaining({
        state: 'READY_FOR_CATALOG_CHANGE_REVIEW',
        catalogMutationAuthorized: false,
        catalogChangeEligible: true,
        proposal: expect.objectContaining({
          targetId: targetDefinition.id,
          proposedP5Status: 'AUTHORITATIVELY_PROVEN',
          p3SemanticTarget: targetDefinition.semanticTarget,
          deterministicDecision: 'READY_FOR_CATALOG_CHANGE_REVIEW',
          catalogMutationAuthorized: false,
          catalogChangeEligible: true,
        }),
      }));
      expectNonEconomic(result);
    }
  });

  it('fails closed for every missing required independent-review item', () => {
    const base = reviewInput();
    const incompleteReviewers = [
      { ...base.reviewer, reviewerId: null },
      { ...base.reviewer, reviewerReference: null },
      { ...base.reviewer, reviewedAt: null },
      { ...base.reviewer, decision: null },
      { ...base.reviewer, rationale: null },
      { ...base.reviewer, conflictDeclaration: null },
      { ...base.reviewer, independentlyExaminedEvidence: false },
      { ...base.reviewer, p3RemainsFailClosed: false },
    ];
    for (const reviewer of incompleteReviewers) {
      const result = evaluateCatalogChangeReview({ ...base, reviewer });
      expect(result.state).toBe('REVIEW_INCOMPLETE');
      expect(result.proposal).toBeNull();
      expectNonEconomic(result);
    }
  });

  it('blocks conflicted, contradictory, and rejected review decisions', () => {
    const base = reviewInput();
    const conflicted = evaluateCatalogChangeReview({ ...base, reviewer: { ...base.reviewer, conflictDeclaration: 'CONFLICT' } });
    expect(conflicted).toEqual(expect.objectContaining({ state: 'REVIEW_CONFLICTED', reasonCodes: ['REVIEWER_DECLARED_CONFLICT'] }));

    const contradictory = evaluateCatalogChangeReview({ ...base, reviewer: { ...base.reviewer, priorDecisions: ['REJECT'] } });
    expect(contradictory).toEqual(expect.objectContaining({ state: 'REVIEW_CONFLICTED', reasonCodes: ['CONTRADICTORY_PRIOR_REVIEW_DECISION'] }));

    const rejected = evaluateCatalogChangeReview({ ...base, reviewer: { ...base.reviewer, decision: 'REJECT' } });
    expect(rejected).toEqual(expect.objectContaining({ state: 'REVIEW_REJECTED', reasonCodes: ['REVIEWER_REJECTED_PROPOSITION'] }));
  });

  it('blocks invalidated and superseded evidence even when review data is otherwise complete', () => {
    const base = reviewInput();
    const record = base.verification.verificationRecord!;
    const invalidated = evaluateCatalogChangeReview({
      ...base,
      verification: { ...base.verification, verificationRecord: { ...record, invalidatedAt: '2026-08-26T00:00:00.000Z', invalidationReason: 'Provider changed the artifact.' } },
    });
    expect(invalidated).toEqual(expect.objectContaining({ state: 'REVIEW_INVALIDATED', reasonCodes: ['EVIDENCE_INVALIDATED'] }));

    const superseded = evaluateCatalogChangeReview({
      ...base,
      verification: { ...base.verification, verificationRecord: { ...record, supersededBy: 'evidence-v2' } },
    });
    expect(superseded).toEqual(expect.objectContaining({ state: 'REVIEW_SUPERSEDED', reasonCodes: ['EVIDENCE_SUPERSEDED'] }));
  });

  it('blocks wrong target, provider, report, event, field, marketplace, version, provenance, source, locator, proposition, or scope', () => {
    const base = reviewInput();
    const mismatchedContexts: CatalogChangeReviewContext[] = [
      { ...base.context, proposition: 'Different proposition' },
      { ...base.context, provider: 'different-provider' as 'amazon_inventory_ledger' },
      { ...base.context, reportType: 'GET_UNRELATED_REPORT' },
      { ...base.context, eventType: 'OtherEvent' },
      { ...base.context, field: 'Quantity' },
      { ...base.context, marketplaceId: 'A1PA6795UKMFR9' },
      { ...base.context, artifactVersion: 'new-version' },
      { ...base.context, provenanceHash: 'f'.repeat(64) },
      { ...base.context, sourceReference: 'https://example.com/other' },
      { ...base.context, evidenceLocator: '' },
      { ...base.context, assertedExcerpt: '' },
      { ...base.context, scope: { ...base.context.scope, marketplaceId: 'A1PA6795UKMFR9' } },
    ];
    for (const context of mismatchedContexts) {
      const result = evaluateCatalogChangeReview({ ...base, context });
      expect(result).toEqual(expect.objectContaining({
        state: 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE',
        reasonCodes: ['REVIEW_CONTEXT_OR_PROPOSITION_MISMATCH'],
      }));
      expectNonEconomic(result);
    }
  });

  it('preserves negative evidence and rejects unsupported authority or synthetic fixture evidence', () => {
    const base = reviewInput();
    const missingNegative = evaluateCatalogChangeReview({ ...base, context: { ...base.context, negativeConditions: [] } });
    expect(missingNegative).toEqual(expect.objectContaining({ state: 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE', reasonCodes: ['NEGATIVE_CONDITIONS_INCOMPLETE'] }));

    const record = base.verification.verificationRecord!;
    const unsupportedAuthority = evaluateCatalogChangeReview({
      ...base,
      verification: { ...base.verification, verificationRecord: { ...record, authorityClass: 'OBSERVED_RAW' } },
      context: { ...base.context, authorityClass: 'OBSERVED_RAW' },
    });
    expect(unsupportedAuthority).toEqual(expect.objectContaining({ state: 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE', reasonCodes: ['AUTHORITY_CLASS_OR_PROPOSED_STATUS_INELIGIBLE'] }));

    const synthetic = evaluateCatalogChangeReview({ ...base, reviewer: { ...base.reviewer, syntheticFixture: true } });
    expect(synthetic).toEqual(expect.objectContaining({ state: 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE', reasonCodes: ['SYNTHETIC_FIXTURE_CANNOT_BE_PROVIDER_AUTHORITY'] }));
  });

  it('requires a verified P8 package before P9 review may begin', () => {
    const base = reviewInput();
    const result = evaluateCatalogChangeReview({ ...base, verification: { ...base.verification, state: 'AMBIGUOUS_EVIDENCE', verificationRecord: null } });
    expect(result).toEqual(expect.objectContaining({ state: 'REVIEW_REQUIRED', reasonCodes: ['P8_VERIFICATION_REQUIRED'] }));
  });

  it('is deterministic on replay and never emits a detector result', () => {
    const first = evaluateCatalogChangeReview(reviewInput());
    const replay = evaluateCatalogChangeReview(reviewInput());
    expect(first).toEqual(replay);
    expect(first.reviewId).toBe(replay.proposal?.p9ReviewId);
    expect(catalogChangeReviewDetectorResult(first)).toBeNull();
  });

  it('cannot mutate P5 or bypass P3 even after a ready catalog-change proposal', () => {
    const result = evaluateCatalogChangeReview(reviewInput());
    const p5 = resolveProviderSemanticsCatalog({
      providerSource: 'amazon_inventory_ledger',
      reportType: 'GET_LEDGER_DETAIL_VIEW_DATA',
      providerEventTypeRaw: 'WhseTransfers',
      providerField: 'Reference ID',
      semanticTarget: 'transfer_identity',
      marketplaceId: 'ATVPDKIKX0DER',
      providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    });

    expect(result.state).toBe('READY_FOR_CATALOG_CHANGE_REVIEW');
    expect(result.catalogMutationAuthorized).toBe(false);
    expect(result.proposal?.catalogMutationAuthorized).toBe(false);
    expect(p5).toEqual(expect.objectContaining({
      status: 'UNRESOLVED_PROVIDER_SEMANTICS',
      p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
    expectNonEconomic(result);
  });
});
