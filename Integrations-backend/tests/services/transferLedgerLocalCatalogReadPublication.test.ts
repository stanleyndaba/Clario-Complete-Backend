import { describe, expect, it } from '@jest/globals';
import crypto from 'crypto';
import {
  LocalCatalogReadPublicationAuthorization,
  localCatalogReadPublicationAuthorizationBindingHash,
  localCatalogReadPublicationDetectorResult,
  publishLocalCatalogReadView,
} from '../../src/services/transferLedgerLocalCatalogReadPublication';
import {
  CatalogMutationAuthorization,
  ImmutableCatalogState,
  catalogAuthorizationBindingHash,
  catalogProposalBindingHash,
  executeAuthorizedCatalogChange,
} from '../../src/services/transferLedgerCatalogChangeExecution';
import { evaluateCatalogChangeReview } from '../../src/services/transferLedgerCatalogChangeReview';
import { intakeAuthorityEvidence } from '../../src/services/transferLedgerAuthorityEvidenceIntake';
import { verifyAuthorityEvidenceProposition } from '../../src/services/transferLedgerAuthorityEvidenceVerifier';
import { TRANSFER_AUTHORITY_ACQUISITION_TARGETS } from '../../src/services/transferLedgerAuthorityAcquisitionPlan';
import { evaluateTransferSemanticEvidence, TransferSemanticEvidence } from '../../src/services/transferLedgerSemanticEvidence';
import {
  ProviderSemanticsCatalogEntry,
  TRANSFER_PROVIDER_SEMANTICS_CATALOG,
  resolveProviderSemanticsCatalog,
} from '../../src/services/transferLedgerProviderSemanticsCatalog';

function target() {
  const value = TRANSFER_AUTHORITY_ACQUISITION_TARGETS.find((entry) => entry.id === 'transfer-identity');
  if (!value) throw new Error('transfer-identity target is required');
  return value;
}

function readyP9Review() {
  const targetDefinition = target();
  const artifactText = `${targetDefinition.proposition}\nP11 local-only deterministic fixture.`;
  const intake = intakeAuthorityEvidence({
    target: targetDefinition,
    evidenceId: 'p11-evidence-identity-1',
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
    evidenceReference: 'p11-section-transfer-identity',
    evidenceExcerptOrLocator: 'p11-transfer-identity-locator',
    artifactText,
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
    artifactText,
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
      reviewerId: 'p11-reviewer',
      reviewerReference: 'p11-review-ticket',
      reviewedAt: '2026-08-25T01:00:00.000Z',
      decision: 'ACCEPT',
      rationale: 'P11 test fixture is structurally complete only.',
      independentlyExaminedEvidence: true,
      conflictDeclaration: 'NO_CONFLICT',
      priorDecisions: [],
      p3RemainsFailClosed: true,
      catalogMutationRequested: false,
      syntheticFixture: false,
    },
  });
  if (!review.proposal) throw new Error('P9 proposal is required');
  return { review, proposal: review.proposal, targetDefinition };
}

function initialCatalog(): ImmutableCatalogState {
  const { proposal } = readyP9Review();
  const entry: ProviderSemanticsCatalogEntry = {
    id: 'p11-reference-id-us-unresolved',
    version: '1.0.0',
    providerSource: proposal.providerContext.provider,
    reportType: proposal.providerContext.reportType,
    providerEventTypeRaw: proposal.providerContext.eventType,
    providerField: proposal.providerContext.field,
    semanticTarget: proposal.p3SemanticTarget,
    declaredMeaning: 'P11 test-only unresolved predecessor.',
    authority: { kind: 'REPOSITORY_PROVENANCE', reference: 'repository://p11-test', version: 'p11-v1' },
    scope: { marketplaceIds: [proposal.providerContext.marketplaceId], providerArtifactVersion: proposal.providerContext.artifactVersion },
    status: 'UNRESOLVED_PROVIDER_SEMANTICS',
    allowedAssertion: 'NONE',
    negativeCondition: JSON.stringify(proposal.negativeConditions),
  };
  return { version: '1.0.0', entries: [entry], history: [] };
}

function p10Authorization(catalog: ImmutableCatalogState): CatalogMutationAuthorization {
  const { proposal } = readyP9Review();
  const payload = {
    authorizationId: 'p11-p10-authorization',
    decision: 'AUTHORIZE' as const,
    operatorReference: 'p11-p10-operator',
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
    expectedBeforeEntryHash: crypto.createHash('sha256').update(JSON.stringify(catalog.entries[0])).digest('hex'),
  };
  return { ...payload, authorizationBindingHash: catalogAuthorizationBindingHash(payload) };
}

function p10Execution() {
  const catalog = initialCatalog();
  return executeAuthorizedCatalogChange({
    catalog,
    review: readyP9Review().review,
    authorization: p10Authorization(catalog),
    evaluationAt: '2026-08-25T03:00:00.000Z',
  });
}

function localCatalogHash(catalog: ImmutableCatalogState): string {
  return crypto.createHash('sha256').update(JSON.stringify({ version: catalog.version, entries: catalog.entries })).digest('hex');
}

function localChangeRecordHash(execution: ReturnType<typeof p10Execution>): string {
  return crypto.createHash('sha256').update(JSON.stringify(execution.changeRecord)).digest('hex');
}

function p11Authorization(
  execution = p10Execution(),
  overrides: Partial<LocalCatalogReadPublicationAuthorization> = {},
): LocalCatalogReadPublicationAuthorization {
  const catalog = execution.nextCatalog!;
  const record = execution.changeRecord!;
  const payload = {
    publicationId: 'p11-local-publication-001',
    decision: 'PUBLISH_LOCAL_READ_VIEW' as const,
    operatorReference: 'p11-publication-operator',
    authorizedAt: '2026-08-25T04:00:00.000Z',
    validUntil: '2026-08-26T04:00:00.000Z',
    lifecycleState: 'ACTIVE' as const,
    supersededBy: null,
    invalidatedAt: null,
    exactP10ChangeId: record.changeId,
    exactP9ReviewId: record.p9ReviewId,
    exactP8VerificationId: record.p8VerificationId,
    exactTargetId: record.targetId,
    exactProposedP5Status: record.nextEntry.status,
    exactProvider: record.nextEntry.providerSource,
    exactReportType: record.nextEntry.reportType,
    exactEventType: record.nextEntry.providerEventTypeRaw,
    exactField: record.nextEntry.providerField,
    exactMarketplaceId: record.marketplaceId,
    exactArtifactVersion: record.artifactVersion,
    exactProvenanceHash: record.provenanceHash,
    expectedCatalogVersion: catalog.version,
    expectedCatalogHash: localCatalogHash(catalog),
    expectedChangeRecordHash: localChangeRecordHash(execution),
    p3RemainsFailClosed: true,
    transferRemainsOff: true,
    localReadOnly: true,
    noPersistenceAuthorized: true,
    noObservationAuthorized: true,
    noDetectorAuthorized: true,
    noClaimRecoveryOrEconomicAuthorization: true,
    ...overrides,
  };
  return { ...payload, authorizationBindingHash: localCatalogReadPublicationAuthorizationBindingHash(payload) };
}

function input(overrides: Record<string, unknown> = {}) {
  const execution = p10Execution();
  return {
    execution,
    authorization: p11Authorization(execution),
    evaluationAt: '2026-08-25T05:00:00.000Z',
    ...overrides,
  };
}

function expectNonEconomic(result: ReturnType<typeof publishLocalCatalogReadView>) {
  expect(result).toEqual(expect.objectContaining({
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    transferActivationAuthorized: false,
    observationAuthorized: false,
    detectorAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  }));
}

describe('Transfer Ledger P11 local catalog read publication gate', () => {
  it('publishes only an exact active P10 successor as an immutable local review-only read view', () => {
    const base = input();
    const originalSuccessor = JSON.stringify(base.execution.nextCatalog);
    const liveP5Before = JSON.stringify(TRANSFER_PROVIDER_SEMANTICS_CATALOG);
    const result = publishLocalCatalogReadView(base);

    expect(result).toEqual(expect.objectContaining({
      state: 'LOCAL_CATALOG_READ_VIEW_READY',
      readView: expect.objectContaining({
        catalogVersion: '1.0.1',
        localOnly: true,
        reviewOnly: true,
        immutable: true,
        p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
      }),
      publicationRecord: expect.objectContaining({
        deterministicDecision: 'LOCAL_READ_VIEW_REPRESENTED_NOT_PERSISTED',
        lifecycleState: 'ACTIVE',
      }),
    }));
    expect(JSON.stringify(base.execution.nextCatalog)).toBe(originalSuccessor);
    expect(JSON.stringify(TRANSFER_PROVIDER_SEMANTICS_CATALOG)).toBe(liveP5Before);
    expect(Object.isFrozen(result.readView)).toBe(true);
    expect(Object.isFrozen(result.readView?.entries)).toBe(true);
    expect(() => (result.readView!.entries as ProviderSemanticsCatalogEntry[]).push(base.execution.nextCatalog!.entries[0])).toThrow();
    expectNonEconomic(result);
  });

  it('requires a real P10 transformed successor and an explicit separate local-read authorization', () => {
    const base = input();
    const notTransformed = publishLocalCatalogReadView({ ...base, execution: { ...base.execution, state: 'REJECTED', nextCatalog: null, changeRecord: null } });
    expect(notTransformed.reasonCodes).toEqual(['P10_TRANSFORMED_SUCCESSOR_REQUIRED']);

    const missing = publishLocalCatalogReadView({ ...base, authorization: null });
    expect(missing.reasonCodes).toEqual(['MISSING_LOCAL_READ_PUBLICATION_AUTHORIZATION']);

    const rejected = publishLocalCatalogReadView({ ...base, authorization: p11Authorization(base.execution, { decision: 'REJECT' }) });
    expect(rejected.reasonCodes).toEqual(['LOCAL_READ_PUBLICATION_REJECTED']);
  });

  it('fails closed for incomplete, malformed, expired, superseded, invalidated, unsafe, or tampered publication authorization', () => {
    const base = input();
    const cases = [
      p11Authorization(base.execution, { operatorReference: null }),
      p11Authorization(base.execution, { authorizedAt: 'not-a-timestamp' }),
      p11Authorization(base.execution, { authorizedAt: '2026-08-25T06:00:00.000Z' }),
      p11Authorization(base.execution, { validUntil: '2026-08-25T03:00:00.000Z' }),
      p11Authorization(base.execution, { validUntil: '2026-08-24T00:00:00.000Z' }),
      p11Authorization(base.execution, { lifecycleState: 'SUPERSEDED', supersededBy: 'publication-002' }),
      p11Authorization(base.execution, { lifecycleState: 'INVALIDATED', invalidatedAt: '2026-08-25T04:30:00.000Z' }),
      p11Authorization(base.execution, { p3RemainsFailClosed: false }),
      p11Authorization(base.execution, { transferRemainsOff: false }),
      p11Authorization(base.execution, { localReadOnly: false }),
      p11Authorization(base.execution, { noPersistenceAuthorized: false }),
      p11Authorization(base.execution, { noObservationAuthorized: false }),
      p11Authorization(base.execution, { noDetectorAuthorized: false }),
      p11Authorization(base.execution, { noClaimRecoveryOrEconomicAuthorization: false }),
      { ...p11Authorization(base.execution), authorizationBindingHash: '0'.repeat(64) },
    ];
    for (const authorization of cases) {
      const result = publishLocalCatalogReadView({ ...base, authorization });
      expect(result.state).toBe('REJECTED');
      expect(result.readView).toBeNull();
      expectNonEconomic(result);
    }
  });

  it('rejects every exact chain, context, scope, provenance, stale-version, and stale-hash mismatch', () => {
    const base = input();
    const cases = [
      p11Authorization(base.execution, { exactP10ChangeId: 'wrong-change' }),
      p11Authorization(base.execution, { exactP9ReviewId: 'wrong-p9' }),
      p11Authorization(base.execution, { exactP8VerificationId: 'wrong-p8' }),
      p11Authorization(base.execution, { exactTargetId: 'wrong-target' }),
      p11Authorization(base.execution, { exactProposedP5Status: 'APPROVED_EVIDENCE' }),
      p11Authorization(base.execution, { exactProvider: 'wrong-provider' as 'amazon_inventory_ledger' }),
      p11Authorization(base.execution, { exactReportType: 'GET_UNRELATED_REPORT' }),
      p11Authorization(base.execution, { exactEventType: 'OtherEvent' }),
      p11Authorization(base.execution, { exactField: 'Quantity' }),
      p11Authorization(base.execution, { exactMarketplaceId: 'A1PA6795UKMFR9' }),
      p11Authorization(base.execution, { exactArtifactVersion: 'future-artifact' }),
      p11Authorization(base.execution, { exactProvenanceHash: 'a'.repeat(64) }),
      p11Authorization(base.execution, { expectedCatalogVersion: '9.9.9' }),
      p11Authorization(base.execution, { expectedCatalogHash: 'b'.repeat(64) }),
      p11Authorization(base.execution, { expectedChangeRecordHash: 'c'.repeat(64) }),
    ];
    for (const authorization of cases) {
      const result = publishLocalCatalogReadView({ ...base, authorization });
      expect(result.reasonCodes).toEqual(['LOCAL_READ_PUBLICATION_CONTEXT_OR_PREDECESSOR_MISMATCH']);
      expectNonEconomic(result);
    }
  });

  it('rejects a P10 successor with weakened negatives, wildcard scope, mismatched entry, invalid lifecycle, or contradictory P10 safety state', () => {
    const base = input();
    const record = base.execution.changeRecord!;
    const catalog = base.execution.nextCatalog!;
    const negativeWeakened = {
      ...base.execution,
      nextCatalog: { ...catalog, entries: [{ ...catalog.entries[0], negativeCondition: 'weakened' }], history: [] },
    };
    const wildcard = {
      ...base.execution,
      nextCatalog: { ...catalog, entries: [{ ...catalog.entries[0], scope: { ...catalog.entries[0].scope, marketplaceIds: ['*'] } }], history: [] },
    };
    const lifecycleInvalid = { ...base.execution, changeRecord: { ...record, lifecycleState: 'SUPERSEDED' as const } };
    const unsafeP10 = { ...base.execution, claimCapable: true as false };
    for (const execution of [negativeWeakened, wildcard, lifecycleInvalid, unsafeP10]) {
      const result = publishLocalCatalogReadView({
        ...base,
        execution,
        authorization: p11Authorization(execution as ReturnType<typeof p10Execution>),
      });
      expect(result.state).toBe('REJECTED');
      expectNonEconomic(result);
    }
  });

  it('is replay-deterministic and the local view cannot bypass P5 or P3', () => {
    const first = publishLocalCatalogReadView(input());
    const replay = publishLocalCatalogReadView(input());
    expect(first).toEqual(replay);
    expect(first.publicationRecord?.publicationHash).toBe(replay.publicationRecord?.publicationHash);
    expect(localCatalogReadPublicationDetectorResult(first)).toBeNull();

    const localP5 = resolveProviderSemanticsCatalog({
      providerSource: 'amazon_inventory_ledger',
      reportType: first.readView!.publication.reportType,
      providerEventTypeRaw: first.readView!.publication.eventType,
      providerField: first.readView!.publication.field,
      semanticTarget: first.readView!.entries[0].semanticTarget,
      marketplaceId: first.readView!.publication.marketplaceId,
      providerArtifactVersion: first.readView!.publication.artifactVersion,
    }, first.readView!.entries);
    expect(localP5).toEqual(expect.objectContaining({
      status: 'AUTHORITATIVELY_PROVEN',
      p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
    const p3 = evaluateTransferSemanticEvidence({
      scope: { tenantId: 'tenant-1', userId: 'user-1', storeId: 'store-1', marketplaceId: 'ATVPDKIKX0DER' },
      sourceRunId: 'p11-source-run',
      providerRowFingerprint: 'p11-row-1',
      providerFingerprintOccurrences: 1,
      rawPayloadHash: 'p11-payload-1',
      providerEventTypeRaw: 'WhseTransfers',
      providerSemantics: first.readView!.p3ProviderSemantics,
      transferIdentity: 'transfer-1',
      sourceLocation: 'FC-SOURCE',
      destinationLocation: 'FC-DESTINATION',
      item: { fnsku: 'FNSKU-1', sku: 'SKU-1', asin: 'ASIN-1' },
      quantity: { sent: 1, received: 1 },
      timestamps: { sentAt: '2026-01-01T00:00:00.000Z', receivedAt: '2026-01-02T00:00:00.000Z', closedAt: null },
      lifecycle: 'RECEIVED',
      historyCoverage: 'FULL',
      counterpartCandidates: [{
        providerRowFingerprint: 'p11-row-2',
        scope: { tenantId: 'tenant-1', userId: 'user-1', storeId: 'store-1', marketplaceId: 'ATVPDKIKX0DER' },
        transferIdentity: 'transfer-1',
        sourceLocation: 'FC-DESTINATION',
        destinationLocation: 'FC-SOURCE',
        fnsku: 'FNSKU-1',
        rawPayloadHash: 'p11-payload-2',
      }],
    } as TransferSemanticEvidence);
    expect(p3).toEqual(expect.objectContaining({
      state: 'PENDING_PROVIDER_SEMANTICS',
      transferFact: null,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
    expectNonEconomic(first);
  });
});
