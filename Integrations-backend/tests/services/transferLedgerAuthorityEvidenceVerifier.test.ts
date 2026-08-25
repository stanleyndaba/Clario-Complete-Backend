import { describe, expect, it } from '@jest/globals';
import {
  AuthorityEvidenceVerificationInput,
  authorityEvidenceVerificationDetectorResult,
  verifyAuthorityEvidenceProposition,
} from '../../src/services/transferLedgerAuthorityEvidenceVerifier';
import { intakeAuthorityEvidence } from '../../src/services/transferLedgerAuthorityEvidenceIntake';
import { TRANSFER_AUTHORITY_ACQUISITION_TARGETS } from '../../src/services/transferLedgerAuthorityAcquisitionPlan';
import {
  AMAZON_REPORTS_API_ARTIFACT_VERSION,
  resolveProviderSemanticsCatalog,
} from '../../src/services/transferLedgerProviderSemanticsCatalog';
import { AMAZON_LEDGER_DETAIL_REPORT_TYPE } from '../../src/services/transferLedgerProviderEvidenceReadiness';

function target(id: string) {
  const found = TRANSFER_AUTHORITY_ACQUISITION_TARGETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Target ${id} is missing`);
  return found;
}

function intakeForArtifact(artifactText: string, overrides: Record<string, unknown> = {}) {
  const targetDefinition = target('transfer-identity');
  return intakeAuthorityEvidence({
    target: targetDefinition,
    evidenceId: 'evidence-transfer-identity-v1',
    provider: 'amazon_inventory_ledger',
    artifactType: 'official-provider-document',
    sourceReference: 'https://developer-docs.amazon/sp-api/docs/report-type-values-fba',
    retrievedAt: '2026-08-25T00:00:00.000Z',
    artifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    marketplaceId: 'ATVPDKIKX0DER',
    reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
    eventType: 'WhseTransfers',
    field: 'Reference ID',
    proposedSemanticTarget: 'transfer_identity',
    proposition: targetDefinition.proposition,
    evidenceReference: 'section-4.2',
    evidenceExcerptOrLocator: 'Exact local artifact locator for P8 verification.',
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
    notes: 'P8 deterministic test input; no provider semantic promotion occurs.',
    ...overrides,
  });
}

function verificationInput(artifactText: string, overrides: Partial<AuthorityEvidenceVerificationInput> = {}): AuthorityEvidenceVerificationInput {
  const targetDefinition = target('transfer-identity');
  return {
    target: targetDefinition,
    intake: intakeForArtifact(artifactText),
    artifactText,
    assertedExcerpt: targetDefinition.proposition,
    ...overrides,
  };
}

function expectNonEconomic(result: ReturnType<typeof verifyAuthorityEvidenceProposition>) {
  expect(result).toEqual(expect.objectContaining({
    artifactTextReturned: false,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  }));
}

describe('Transfer Ledger P8 authority-evidence semantic proposition verifier', () => {
  it('creates a review-only verification package when an explicitly supplied non-synthetic artifact states the exact proposition and excerpt', () => {
    const targetDefinition = target('transfer-identity');
    const artifact = `${targetDefinition.proposition}\n\nThis exact statement is supplied only to exercise P8 verification logic.`;
    const result = verifyAuthorityEvidenceProposition(verificationInput(artifact));

    expect(result).toEqual(expect.objectContaining({
      state: 'VERIFIED_FOR_CATALOG_REVIEW',
      reasonCodes: ['EXPLICIT_PROPOSITION_AND_CONTEXT_MATCH_REQUIRES_SEPARATE_HUMAN_P5_REVIEW'],
      verificationRecord: expect.objectContaining({ reviewerStatus: 'NOT_SUBMITTED' }),
      provenanceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expectNonEconomic(result);
  });

  it('fails proposition verification when an artifact makes only a broad report-context statement', () => {
    const broadArtifact = 'Inventory Ledger records inventory movements to and from fulfillment centers.';
    const result = verifyAuthorityEvidenceProposition(verificationInput(broadArtifact, {
      assertedExcerpt: broadArtifact,
    }));

    expect(result).toEqual(expect.objectContaining({
      state: 'PROPOSITION_MISMATCH',
      reasonCodes: ['ARTIFACT_DOES_NOT_EXPLICITLY_STATE_TARGET_PROPOSITION'],
    }));
    expectNonEconomic(result);
  });

  it('rejects context mismatches for report, event, field, marketplace, artifact version, provider scope, or target proposition', () => {
    const targetDefinition = target('transfer-identity');
    const artifact = targetDefinition.proposition;
    const intakeCases = [
      intakeForArtifact(artifact, { reportType: 'GET_UNRELATED_REPORT' }),
      intakeForArtifact(artifact, { eventType: 'OtherEvent' }),
      intakeForArtifact(artifact, { field: 'Quantity' }),
      intakeForArtifact(artifact, { artifactVersion: 'future-version' }),
      intakeForArtifact(artifact, { proposition: 'A different proposition' }),
    ];

    for (const intake of intakeCases) {
      const result = verifyAuthorityEvidenceProposition({
        target: targetDefinition,
        intake,
        artifactText: artifact,
        assertedExcerpt: targetDefinition.proposition,
      });
      expect(result.state).toBe('INSUFFICIENT_EVIDENCE');
      expect(result.reasonCodes).toEqual(['P7_INTAKE_NOT_ACCEPTED']);
      expectNonEconomic(result);
    }

    const marketplaceScopedTarget = {
      ...targetDefinition,
      providerContext: { ...targetDefinition.providerContext, marketplaceIds: ['ATVPDKIKX0DER'] },
    };
    const incorrectMarketplaceIntake = intakeForArtifact(artifact, {
      target: marketplaceScopedTarget,
      marketplaceId: 'A1PA6795UKMFR9',
      scope: { tenantId: null, userId: null, storeId: null, marketplaceId: 'A1PA6795UKMFR9', crossTenantAssertionPermitted: false, crossStoreAssertionPermitted: false, crossMarketplaceAssertionPermitted: false },
    });
    const incorrectMarketplace = verifyAuthorityEvidenceProposition({
      target: marketplaceScopedTarget,
      intake: incorrectMarketplaceIntake,
      artifactText: artifact,
      assertedExcerpt: targetDefinition.proposition,
    });
    expect(incorrectMarketplace).toEqual(expect.objectContaining({
      state: 'INSUFFICIENT_EVIDENCE',
      reasonCodes: ['P7_INTAKE_NOT_ACCEPTED'],
    }));
  });

  it('returns P8 context, authority, and unsupported states for a post-intake record mismatch', () => {
    const targetDefinition = target('transfer-identity');
    const artifact = targetDefinition.proposition;
    const intake = intakeForArtifact(artifact);
    if (!intake.record) throw new Error('Expected P7 accepted record');

    const contextMismatch = verifyAuthorityEvidenceProposition({
      target: targetDefinition,
      intake: { ...intake, record: { ...intake.record, reportType: 'GET_UNRELATED_REPORT' } },
      artifactText: artifact,
      assertedExcerpt: targetDefinition.proposition,
    });
    expect(contextMismatch).toEqual(expect.objectContaining({
      state: 'CONTEXT_MISMATCH',
      reasonCodes: ['RECORD_CONTEXT_OR_SCOPE_MISMATCH'],
    }));

    const authorityMismatch = verifyAuthorityEvidenceProposition({
      target: targetDefinition,
      intake: { ...intake, record: { ...intake.record, sourceReference: 'https://example.com/untrusted' } },
      artifactText: artifact,
      assertedExcerpt: targetDefinition.proposition,
    });
    expect(authorityMismatch).toEqual(expect.objectContaining({
      state: 'AUTHORITY_MISMATCH',
      reasonCodes: ['UNTRUSTED_SOURCE_REFERENCE'],
    }));

    const unsupported = verifyAuthorityEvidenceProposition({
      target: targetDefinition,
      intake: { ...intake, record: { ...intake.record, authorityClass: 'OBSERVED_RAW' } },
      artifactText: artifact,
      assertedExcerpt: targetDefinition.proposition,
    });
    expect(unsupported).toEqual(expect.objectContaining({
      state: 'UNSUPPORTED',
      reasonCodes: ['UNSUPPORTED_AUTHORITY_CLASS'],
    }));
  });

  it('rejects unsupported authority, an untrusted source, and a weak authority proposed as authoritative', () => {
    const targetDefinition = target('transfer-identity');
    const artifact = targetDefinition.proposition;
    const unsupported = intakeForArtifact(artifact, { authorityClass: 'OBSERVED_RAW' });
    const untrusted = intakeForArtifact(artifact, { sourceReference: 'https://example.com/blog' });
    const weak = intakeForArtifact(artifact, {
      authorityClass: 'APPROVED_REDACTED_FIXTURE',
      sourceReference: 'approved-fixture://reference-v1',
    });

    for (const intake of [unsupported, untrusted, weak]) {
      const result = verifyAuthorityEvidenceProposition({ target: targetDefinition, intake, artifactText: artifact, assertedExcerpt: targetDefinition.proposition });
      expect(result.state).toBe('INSUFFICIENT_EVIDENCE');
      expectNonEconomic(result);
    }
  });

  it('fails closed for missing locator, missing provenance, invalid artifact hash, missing required negative rule, ambiguous evidence, and invalidated evidence', () => {
    const targetDefinition = target('transfer-identity');
    const artifact = targetDefinition.proposition;
    const accepted = intakeForArtifact(artifact);
    if (!accepted.record) throw new Error('Expected P7 accepted record');

    const cases: Array<{ record: typeof accepted.record; artifactText: string; assertedExcerpt: string; expected: string }> = [
      { record: { ...accepted.record, evidenceExcerptOrLocator: '' }, artifactText: artifact, assertedExcerpt: targetDefinition.proposition, expected: 'MISSING_EVIDENCE_LOCATOR_OR_EXCERPT' },
      { record: { ...accepted.record, provenanceHash: null }, artifactText: artifact, assertedExcerpt: targetDefinition.proposition, expected: 'PROVENANCE_HASH_MISMATCH' },
      { record: { ...accepted.record, provenanceHash: 'f'.repeat(64) }, artifactText: artifact, assertedExcerpt: targetDefinition.proposition, expected: 'PROVENANCE_HASH_MISMATCH' },
      { record: { ...accepted.record, negativeConditions: [] }, artifactText: artifact, assertedExcerpt: targetDefinition.proposition, expected: 'REQUIRED_NEGATIVE_CONDITION_MISSING' },
      { record: accepted.record, artifactText: `${artifact}\nThe precise provider meaning is ambiguous.`, assertedExcerpt: targetDefinition.proposition, expected: 'PROVENANCE_HASH_MISMATCH' },
      { record: { ...accepted.record, invalidatedAt: '2026-08-26T00:00:00.000Z', invalidationReason: 'Provider changed the artifact.' }, artifactText: artifact, assertedExcerpt: targetDefinition.proposition, expected: 'EVIDENCE_INVALIDATED' },
    ];

    for (const testCase of cases) {
      const result = verifyAuthorityEvidenceProposition({
        target: targetDefinition,
        intake: { ...accepted, record: testCase.record },
        artifactText: testCase.artifactText,
        assertedExcerpt: testCase.assertedExcerpt,
      });
      expect(result.reasonCodes).toContain(testCase.expected);
      expectNonEconomic(result);
    }
  });

  it('flags an ambiguity marker only when the supplied artifact matches its preserved provenance', () => {
    const targetDefinition = target('transfer-identity');
    const artifact = `${targetDefinition.proposition}\nThe precise provider meaning is ambiguous.`;
    const intake = intakeForArtifact(artifact);
    const result = verifyAuthorityEvidenceProposition({ target: targetDefinition, intake, artifactText: artifact, assertedExcerpt: targetDefinition.proposition });

    expect(result).toEqual(expect.objectContaining({
      state: 'AMBIGUOUS_EVIDENCE',
      reasonCodes: ['ARTIFACT_CONTAINS_AMBIGUITY_MARKER'],
    }));
  });

  it('isolates explicitly marked synthetic fixtures from authority verification', () => {
    const targetDefinition = target('transfer-identity');
    const artifact = targetDefinition.proposition;
    const result = verifyAuthorityEvidenceProposition(verificationInput(artifact, { syntheticFixture: true }));

    expect(result).toEqual(expect.objectContaining({
      state: 'INSUFFICIENT_EVIDENCE',
      reasonCodes: ['SYNTHETIC_FIXTURE_CANNOT_BE_PROVIDER_AUTHORITY'],
    }));
    expectNonEconomic(result);
  });

  it('is deterministic on replay and preserves P7 intake provenance', () => {
    const targetDefinition = target('transfer-identity');
    const artifact = targetDefinition.proposition;
    const first = verifyAuthorityEvidenceProposition(verificationInput(artifact));
    const replay = verifyAuthorityEvidenceProposition(verificationInput(artifact));

    expect(first).toEqual(replay);
    expect(first.provenanceHash).toBe(first.verificationRecord?.provenanceHash);
    expect(authorityEvidenceVerificationDetectorResult(first)).toBeNull();
  });

  it('cannot mutate P5 or bypass P3 even after a positive review-package verification', () => {
    const targetDefinition = target('transfer-identity');
    const artifact = targetDefinition.proposition;
    const p8 = verifyAuthorityEvidenceProposition(verificationInput(artifact));
    const p5 = resolveProviderSemanticsCatalog({
      providerSource: 'amazon_inventory_ledger',
      reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
      providerEventTypeRaw: 'WhseTransfers',
      providerField: 'Reference ID',
      semanticTarget: 'transfer_identity',
      marketplaceId: 'ATVPDKIKX0DER',
      providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    });

    expect(p8.state).toBe('VERIFIED_FOR_CATALOG_REVIEW');
    expect(p8.catalogMutationAuthorized).toBe(false);
    expect(p8.p3OverrideAuthorized).toBe(false);
    expect(p5).toEqual(expect.objectContaining({
      status: 'UNRESOLVED_PROVIDER_SEMANTICS',
      p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
  });
});
