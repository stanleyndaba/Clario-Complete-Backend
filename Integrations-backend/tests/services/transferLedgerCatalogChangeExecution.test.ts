import { describe, expect, it } from '@jest/globals';
import {
  CatalogMutationAuthorization,
  ImmutableCatalogState,
  catalogAuthorizationBindingHash,
  catalogChangeExecutionDetectorResult,
  catalogProposalBindingHash,
  executeAuthorizedCatalogChange,
  representCatalogRollback,
} from '../../src/services/transferLedgerCatalogChangeExecution';
import { evaluateCatalogChangeReview } from '../../src/services/transferLedgerCatalogChangeReview';
import { intakeAuthorityEvidence } from '../../src/services/transferLedgerAuthorityEvidenceIntake';
import { verifyAuthorityEvidenceProposition } from '../../src/services/transferLedgerAuthorityEvidenceVerifier';
import { TRANSFER_AUTHORITY_ACQUISITION_TARGETS } from '../../src/services/transferLedgerAuthorityAcquisitionPlan';
import { evaluateTransferSemanticEvidence, TransferSemanticEvidence } from '../../src/services/transferLedgerSemanticEvidence';
import {
  AMAZON_REPORTS_API_ARTIFACT_VERSION,
  ProviderSemanticsCatalogEntry,
  resolveProviderSemanticsCatalog,
} from '../../src/services/transferLedgerProviderSemanticsCatalog';

function target(id: string) {
  const found = TRANSFER_AUTHORITY_ACQUISITION_TARGETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Target ${id} is missing`);
  return found;
}

function readyReview() {
  const targetDefinition = target('transfer-identity');
  const artifact = `${targetDefinition.proposition}\nDeterministic test-only authority artifact for P10 structural transformation.`;
  const intake = intakeAuthorityEvidence({
    target: targetDefinition,
    evidenceId: 'evidence-transfer-identity-v1',
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
    evidenceReference: 'section-transfer-identity',
    evidenceExcerptOrLocator: 'transfer-identity-locator',
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
  const record = verification.verificationRecord!;
  const review = evaluateCatalogChangeReview({
    target: targetDefinition,
    verification,
    context: {
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
    },
    reviewer: {
      reviewerId: 'reviewer-1',
      reviewerReference: 'review-ticket-001',
      reviewedAt: '2026-08-25T01:00:00.000Z',
      decision: 'ACCEPT',
      rationale: 'Independent review confirms the test package is structurally complete.',
      independentlyExaminedEvidence: true,
      conflictDeclaration: 'NO_CONFLICT',
      priorDecisions: [],
      p3RemainsFailClosed: true,
      catalogMutationRequested: false,
      syntheticFixture: false,
    },
  });
  if (!review.proposal) throw new Error('Expected P9 proposal');
  return { targetDefinition, review, proposal: review.proposal };
}

function scopedCatalog(): ImmutableCatalogState {
  const { proposal } = readyReview();
  const entry: ProviderSemanticsCatalogEntry = {
    id: 'amazon-ledger-detail-reference-id-us-unresolved',
    version: '1.0.0',
    providerSource: proposal.providerContext.provider,
    reportType: proposal.providerContext.reportType,
    providerEventTypeRaw: proposal.providerContext.eventType,
    providerField: proposal.providerContext.field,
    semanticTarget: proposal.p3SemanticTarget,
    declaredMeaning: 'Reference ID is a preserved raw value without established Transfer-identity semantics.',
    authority: {
      kind: 'REPOSITORY_PROVENANCE',
      reference: 'repository://p4-reference-id',
      version: 'p4-v1',
    },
    scope: {
      marketplaceIds: [proposal.providerContext.marketplaceId],
      providerArtifactVersion: proposal.providerContext.artifactVersion,
    },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: JSON.stringify(proposal.negativeConditions),
  };
  return { version: '1.0.0', entries: [entry], history: [] };
}

function authorization(
  catalog = scopedCatalog(),
  overrides: Partial<CatalogMutationAuthorization> = {},
): CatalogMutationAuthorization {
  const { proposal } = readyReview();
  const previousEntry = catalog.entries[0];
  const withoutBinding = {
    authorizationId: 'authorization-001',
    decision: 'AUTHORIZE' as const,
    operatorReference: 'operator-review-001',
    authorizedAt: '2026-08-25T02:00:00.000Z',
    validUntil: '2026-08-26T02:00:00.000Z',
    lifecycleState: 'ACTIVE' as const,
    supersededBy: null,
    invalidatedAt: null,
    exactP9ReviewId: proposal.p9ReviewId,
    exactTargetId: proposal.targetId,
    exactProposedP5Status: proposal.proposedP5Status,
    exactProvider: proposal.providerContext.provider,
    exactReportType: proposal.providerContext.reportType,
    exactEventType: proposal.providerContext.eventType,
    exactField: proposal.providerContext.field,
    exactMarketplaceId: proposal.providerContext.marketplaceId,
    exactArtifactVersion: proposal.providerContext.artifactVersion,
    exactProvenanceHash: proposal.provenanceHash,
    proposalBindingHash: catalogProposalBindingHash(proposal),
    p3RemainsFailClosed: true,
    transferRemainsOff: true,
    catalogOnly: true,
    noProductionMutationAuthorized: true,
    expectedCatalogVersion: catalog.version,
    expectedBeforeEntryHash: require('crypto').createHash('sha256').update(JSON.stringify(previousEntry)).digest('hex'),
    ...overrides,
  };
  return {
    ...withoutBinding,
    authorizationBindingHash: catalogAuthorizationBindingHash(withoutBinding),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  const catalog = scopedCatalog();
  return {
    catalog,
    review: readyReview().review,
    authorization: authorization(catalog),
    evaluationAt: '2026-08-25T03:00:00.000Z',
    ...overrides,
  };
}

function expectNonEconomic(result: ReturnType<typeof executeAuthorizedCatalogChange>) {
  expect(result).toEqual(expect.objectContaining({
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  }));
}

describe('Transfer Ledger P10 controlled catalog change execution seam', () => {
  it('represents one exact authorized local catalog transition, preserves history, and leaves the input catalog immutable', () => {
    const base = input();
    const original = JSON.stringify(base.catalog);
    const result = executeAuthorizedCatalogChange(base);

    expect(result).toEqual(expect.objectContaining({
      state: 'TRANSFORMED',
      catalogMutationAuthorized: false,
      localCatalogTransformationAuthorized: true,
      nextCatalog: expect.objectContaining({ version: '1.0.1' }),
      changeRecord: expect.objectContaining({
        catalogPreviousVersion: '1.0.0',
        catalogNextVersion: '1.0.1',
        lifecycleState: 'ACTIVE',
        deterministicDecision: 'CATALOG_TRANSFORMATION_REPRESENTED_NOT_PERSISTED',
      }),
    }));
    expect(JSON.stringify(base.catalog)).toBe(original);
    expect(JSON.stringify(result.changeRecord)).not.toContain('Deterministic test-only authority artifact');
    expect(result.nextCatalog?.history).toHaveLength(1);
    expect(result.nextCatalog?.entries[0]).toEqual(expect.objectContaining({
      status: 'AUTHORITATIVELY_PROVEN',
      allowedAssertion: 'NONE',
      scope: { marketplaceIds: ['ATVPDKIKX0DER'], providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION },
    }));
    expectNonEconomic(result);
  });

  it('requires P9 READY state and a distinct complete authorization', () => {
    const base = input();
    for (const state of ['REVIEW_REJECTED', 'REVIEW_INVALIDATED', 'REVIEW_SUPERSEDED', 'NOT_ELIGIBLE_FOR_CATALOG_CHANGE'] as const) {
      const notReady = executeAuthorizedCatalogChange({ ...base, review: { ...base.review, state, proposal: null } });
      expect(notReady.reasonCodes).toEqual(['P9_REVIEW_NOT_READY']);
    }

    const missing = executeAuthorizedCatalogChange({ ...base, authorization: null });
    expect(missing.reasonCodes).toEqual(['MISSING_AUTHORIZATION']);

    const rejectedAuthorization = authorization(base.catalog, { decision: 'REJECT' });
    const rejected = executeAuthorizedCatalogChange({ ...base, authorization: rejectedAuthorization });
    expect(rejected.reasonCodes).toEqual(['AUTHORIZATION_REJECTED']);
  });

  it('fails closed for incomplete, expired, unsafe, tampered, or proposal-mismatched authorization', () => {
    const base = input();
    const cases = [
      authorization(base.catalog, { operatorReference: null }),
      authorization(base.catalog, { validUntil: '2026-08-24T00:00:00.000Z' }),
      authorization(base.catalog, { authorizedAt: '2026-08-25T04:00:00.000Z' }),
      authorization(base.catalog, { validUntil: 'not-a-timestamp' }),
      authorization(base.catalog, { lifecycleState: 'SUPERSEDED', supersededBy: 'authorization-002' }),
      authorization(base.catalog, { lifecycleState: 'INVALIDATED', invalidatedAt: '2026-08-25T02:30:00.000Z' }),
      authorization(base.catalog, { transferRemainsOff: false }),
      { ...authorization(base.catalog), authorizationBindingHash: '0'.repeat(64) },
      authorization(base.catalog, { exactTargetId: 'different-target' }),
      authorization(base.catalog, { exactProvider: 'different-provider' as 'amazon_inventory_ledger' }),
      authorization(base.catalog, { exactReportType: 'GET_UNRELATED_REPORT' }),
      authorization(base.catalog, { exactEventType: 'OtherEvent' }),
      authorization(base.catalog, { exactField: 'Quantity' }),
      authorization(base.catalog, { exactMarketplaceId: 'A1PA6795UKMFR9' }),
      authorization(base.catalog, { exactArtifactVersion: 'future-version' }),
      authorization(base.catalog, { exactProvenanceHash: 'a'.repeat(64) }),
    ];
    for (const candidate of cases) {
      const result = executeAuthorizedCatalogChange({ ...base, authorization: candidate });
      expect(result.state).toBe('REJECTED');
      expect(result.changeRecord).toBeNull();
      expectNonEconomic(result);
    }
  });

  it('rejects unsupported authority/status transitions, stale before state, before-entry mismatches, and wildcard or multi-target catalog changes', () => {
    const base = input();
    const proposal = base.review.proposal!;
    const unsupportedReview = {
      ...base.review,
      proposal: { ...proposal, authorityClass: 'APPROVED_CONTROLLED_PROVIDER_EVIDENCE' as const, proposedP5Status: 'AUTHORITATIVELY_PROVEN' as const },
    };
    const unsupported = executeAuthorizedCatalogChange({ ...base, review: unsupportedReview, authorization: authorization(base.catalog) });
    expect(unsupported.reasonCodes).toEqual(['AUTHORIZATION_PROPOSAL_MISMATCH']);

    const stale = executeAuthorizedCatalogChange({ ...base, authorization: authorization(base.catalog, { expectedCatalogVersion: '0.9.9' }) });
    expect(stale.reasonCodes).toEqual(['STALE_CATALOG_VERSION']);

    const beforeMismatch = executeAuthorizedCatalogChange({ ...base, authorization: authorization(base.catalog, { expectedBeforeEntryHash: 'b'.repeat(64) }) });
    expect(beforeMismatch.reasonCodes).toEqual(['BEFORE_ENTRY_MISMATCH']);

    const prohibitedCatalog = { ...base.catalog, entries: [{ ...base.catalog.entries[0], status: 'AUTHORITATIVELY_PROVEN' as const }], history: [] };
    const prohibited = executeAuthorizedCatalogChange({ ...base, catalog: prohibitedCatalog, authorization: authorization(prohibitedCatalog) });
    expect(prohibited.reasonCodes).toEqual(['PROHIBITED_STATUS_TRANSITION']);

    const wildcardCatalog = { ...base.catalog, entries: [{ ...base.catalog.entries[0], scope: { ...base.catalog.entries[0].scope, marketplaceIds: ['*'] } }], history: [] };
    const wildcard = executeAuthorizedCatalogChange({ ...base, catalog: wildcardCatalog, authorization: authorization(wildcardCatalog) });
    expect(wildcard.reasonCodes).toEqual(['WILDCARD_CATALOG_ENTRY_REQUIRES_SEPARATE_RESCOPING_REVIEW']);

    const multiTargetCatalog = { ...base.catalog, entries: [...base.catalog.entries, { ...base.catalog.entries[0], id: 'duplicate-target-entry' }] };
    const multiTarget = executeAuthorizedCatalogChange({ ...base, catalog: multiTargetCatalog, authorization: authorization(multiTargetCatalog) });
    expect(multiTarget.reasonCodes).toEqual(['EXACT_SINGLE_TARGET_ENTRY_NOT_FOUND']);
  });

  it('rejects negative-condition removal or weakening and preserves rollback representation without executing it', () => {
    const base = input();
    const missingNegativeReview = { ...base.review, proposal: { ...base.review.proposal!, negativeConditions: [] } };
    const missingNegative = executeAuthorizedCatalogChange({ ...base, review: missingNegativeReview, authorization: authorization(base.catalog) });
    expect(missingNegative.reasonCodes).toEqual(['AUTHORIZATION_PROPOSAL_MISMATCH']);

    const weakenedCatalog = { ...base.catalog, entries: [{ ...base.catalog.entries[0], negativeCondition: 'weakened condition' }], history: [] };
    const weakened = executeAuthorizedCatalogChange({ ...base, catalog: weakenedCatalog, authorization: authorization(weakenedCatalog) });
    expect(weakened.reasonCodes).toEqual(['NEGATIVE_CONDITIONS_WEAKENED_OR_CHANGED']);

    const transformed = executeAuthorizedCatalogChange(base);
    const rollback = representCatalogRollback(transformed.changeRecord!);
    expect(rollback).toEqual(expect.objectContaining({
      state: 'ACTIVE',
      predecessorVersion: '1.0.0',
      successorVersion: '1.0.1',
      rollbackRequiresSeparateAuthorization: true,
      automaticRollbackExecuted: false,
    }));
  });

  it('is deterministic on replay and cannot mutate P5 or bypass P3 after a local transformation representation', () => {
    const first = executeAuthorizedCatalogChange(input());
    const replay = executeAuthorizedCatalogChange(input());
    expect(first).toEqual(replay);
    expect(first.changeRecord?.changeId).toBe(replay.changeRecord?.changeId);
    expect(catalogChangeExecutionDetectorResult(first)).toBeNull();

    const p5 = resolveProviderSemanticsCatalog({
      providerSource: 'amazon_inventory_ledger',
      reportType: 'GET_LEDGER_DETAIL_VIEW_DATA',
      providerEventTypeRaw: 'WhseTransfers',
      providerField: 'Reference ID',
      semanticTarget: 'transfer_identity',
      marketplaceId: 'ATVPDKIKX0DER',
      providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    });
    expect(p5).toEqual(expect.objectContaining({
      status: 'UNRESOLVED_PROVIDER_SEMANTICS',
      p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
    const independentlyGatedP3 = evaluateTransferSemanticEvidence({
      scope: { tenantId: 'tenant-1', userId: 'user-1', storeId: 'store-1', marketplaceId: 'ATVPDKIKX0DER' },
      sourceRunId: 'p10-does-not-override-p3',
      providerRowFingerprint: 'provider-row-1',
      providerFingerprintOccurrences: 1,
      rawPayloadHash: 'payload-1',
      providerEventTypeRaw: 'WhseTransfers',
      providerSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
      transferIdentity: 'transfer-1',
      sourceLocation: 'FC-SOURCE',
      destinationLocation: 'FC-DESTINATION',
      item: { fnsku: 'FNSKU-1', sku: 'SKU-1', asin: 'ASIN-1' },
      quantity: { sent: 1, received: 1 },
      timestamps: { sentAt: '2026-01-01T00:00:00.000Z', receivedAt: '2026-01-02T00:00:00.000Z', closedAt: null },
      lifecycle: 'RECEIVED',
      historyCoverage: 'FULL',
      counterpartCandidates: [{
        providerRowFingerprint: 'provider-row-2',
        scope: { tenantId: 'tenant-1', userId: 'user-1', storeId: 'store-1', marketplaceId: 'ATVPDKIKX0DER' },
        transferIdentity: 'transfer-1',
        sourceLocation: 'FC-DESTINATION',
        destinationLocation: 'FC-SOURCE',
        fnsku: 'FNSKU-1',
        rawPayloadHash: 'payload-2',
      }],
    } as TransferSemanticEvidence);
    expect(independentlyGatedP3).toEqual(expect.objectContaining({
      state: 'PENDING_PROVIDER_SEMANTICS',
      reasonCodes: expect.arrayContaining(['PROVIDER_SEMANTICS_UNVERIFIED']),
      transferFact: null,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
    expectNonEconomic(first);
  });
});
