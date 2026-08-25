import { describe, expect, it } from '@jest/globals';
import {
  AuthorityEvidenceIntakeInput,
  authorityEvidenceIntakeDetectorResult,
  intakeAuthorityEvidence,
} from '../../src/services/transferLedgerAuthorityEvidenceIntake';
import {
  reviewAuthorityAcquisitionRecord,
  TRANSFER_AUTHORITY_ACQUISITION_TARGETS,
} from '../../src/services/transferLedgerAuthorityAcquisitionPlan';
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

function input(overrides: Partial<AuthorityEvidenceIntakeInput> = {}): AuthorityEvidenceIntakeInput {
  const targetDefinition = target('transfer-identity');
  return {
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
    evidenceExcerptOrLocator: 'Locator only: future reviewer must inspect the cited provider artifact.',
    artifactText: 'A test artifact is hashed for deterministic P7 intake only.\n',
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
    notes: 'P7 intake fixture. This does not establish a provider semantic.',
    ...overrides,
  };
}

function expectNonEconomic(result: ReturnType<typeof intakeAuthorityEvidence>) {
  expect(result).toEqual(expect.objectContaining({
    rawArtifactReturned: false,
    reviewRequired: true,
    catalogMutationAuthorized: false,
    p3OverrideAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  }));
}

describe('Transfer Ledger P7 authority evidence intake', () => {
  it('creates a deterministic, review-pending P6 record from a canonicalized artifact without returning raw content', () => {
    const result = intakeAuthorityEvidence(input());

    expect(result).toEqual(expect.objectContaining({
      state: 'ACCEPTED_FOR_REVIEW',
      reasonCodes: ['RECORD_CREATED_REVIEW_NOT_SUBMITTED'],
      canonicalArtifactHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      record: expect.objectContaining({
        provenanceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewerStatus: 'NOT_SUBMITTED',
        evidenceAssessment: 'CLEAR',
      }),
    }));
    expect(result.record).not.toHaveProperty('artifactText');
    expectNonEconomic(result);
  });

  it('is replay-safe across equivalent line endings and trailing whitespace', () => {
    const first = intakeAuthorityEvidence(input({ artifactText: 'line one\r\nline two  \r\n' }));
    const replay = intakeAuthorityEvidence(input({ artifactText: 'line one\nline two\n' }));

    expect(first.state).toBe('ACCEPTED_FOR_REVIEW');
    expect(first.intakeId).toBe(replay.intakeId);
    expect(first.canonicalArtifactHash).toBe(replay.canonicalArtifactHash);
    expect(first.record?.provenanceHash).toBe(replay.record?.provenanceHash);
  });

  it('rejects missing artifact content or locator information', () => {
    const missingContent = intakeAuthorityEvidence(input({ artifactText: '   ' }));
    expect(missingContent).toEqual(expect.objectContaining({
      state: 'UNRESOLVED',
      reasonCodes: ['MISSING_ARTIFACT_CONTENT'],
      record: null,
    }));

    const missingLocator = intakeAuthorityEvidence(input({ evidenceExcerptOrLocator: '' }));
    expect(missingLocator.reasonCodes).toEqual(['MISSING_EVIDENCE_LOCATOR']);
  });

  it('rejects unsupported authority classes and untrusted source references', () => {
    const rawOnly = intakeAuthorityEvidence(input({ authorityClass: 'OBSERVED_RAW' }));
    expect(rawOnly).toEqual(expect.objectContaining({
      state: 'REJECTED',
      reasonCodes: ['UNSUPPORTED_AUTHORITY_CLASS'],
    }));

    const untrusted = intakeAuthorityEvidence(input({
      sourceReference: 'https://example.com/blog/whse-transfers-explained',
    }));
    expect(untrusted).toEqual(expect.objectContaining({
      state: 'REJECTED',
      reasonCodes: ['UNTRUSTED_SOURCE_REFERENCE'],
    }));
  });

  it('fails closed for wrong report, field, event, artifact version, marketplace, scope, or proposition', () => {
    for (const invalidInput of [
      input({ reportType: 'GET_UNRELATED_REPORT' }),
      input({ field: 'Quantity' }),
      input({ eventType: 'OtherEvent' }),
      input({ artifactVersion: 'future-provider-version' }),
      input({ scope: { ...input().scope, marketplaceId: 'A1PA6795UKMFR9' } }),
      input({ proposition: 'A different proposition' }),
    ]) {
      const result = intakeAuthorityEvidence(invalidInput);
      expect(result).toEqual(expect.objectContaining({
        state: 'UNRESOLVED',
        reasonCodes: ['CONTEXT_SCOPE_OR_PROPOSITION_MISMATCH'],
        record: null,
      }));
      expectNonEconomic(result);
    }

    const marketplaceScopedTarget = {
      ...input().target,
      providerContext: { ...input().target.providerContext, marketplaceIds: ['ATVPDKIKX0DER'] },
    };
    const incorrectMarketplace = intakeAuthorityEvidence(input({
      target: marketplaceScopedTarget,
      marketplaceId: 'A1PA6795UKMFR9',
      scope: { ...input().scope, marketplaceId: 'A1PA6795UKMFR9' },
    }));
    expect(incorrectMarketplace.reasonCodes).toEqual(['CONTEXT_SCOPE_OR_PROPOSITION_MISMATCH']);
  });

  it('requires every target-level negative condition and a compatible proposed upgrade', () => {
    const incompleteNegative = intakeAuthorityEvidence(input({ negativeConditions: [] }));
    expect(incompleteNegative.reasonCodes).toEqual(['NEGATIVE_CONDITIONS_INCOMPLETE']);

    const weakAuthorityUpgrade = intakeAuthorityEvidence(input({
      authorityClass: 'APPROVED_REDACTED_FIXTURE',
      sourceReference: 'approved-fixture://transfer-identity-redacted-v1',
    }));
    expect(weakAuthorityUpgrade.reasonCodes).toEqual(['INSUFFICIENT_AUTHORITY_FOR_PROPOSED_UPGRADE']);
  });

  it('hands the accepted record to P6 as under review rather than authorizing any catalog mutation', () => {
    const intake = intakeAuthorityEvidence(input());
    if (!intake.record) throw new Error('Expected an intake record');
    const p6 = reviewAuthorityAcquisitionRecord(input().target, intake.record);

    expect(p6).toEqual(expect.objectContaining({
      state: 'UNDER_REVIEW',
      reasonCodes: ['INCOMPLETE_REVIEW'],
      catalogMutationAuthorized: false,
      p3OverrideAuthorized: false,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
      detectorResult: null,
    }));
  });

  it('cannot alter P5 or turn the current unresolved Reference ID mapping into P3 proof', () => {
    const intake = intakeAuthorityEvidence(input());
    const p5 = resolveProviderSemanticsCatalog({
      providerSource: 'amazon_inventory_ledger',
      reportType: AMAZON_LEDGER_DETAIL_REPORT_TYPE,
      providerEventTypeRaw: 'WhseTransfers',
      providerField: 'Reference ID',
      semanticTarget: 'transfer_identity',
      marketplaceId: 'ATVPDKIKX0DER',
      providerArtifactVersion: AMAZON_REPORTS_API_ARTIFACT_VERSION,
    });

    expect(intake.catalogMutationAuthorized).toBe(false);
    expect(intake.p3OverrideAuthorized).toBe(false);
    expect(p5).toEqual(expect.objectContaining({
      status: 'UNRESOLVED_PROVIDER_SEMANTICS',
      p3ProviderSemantics: { status: 'PENDING_PROVIDER_SEMANTICS', evidenceReference: null },
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
    }));
    expect(authorityEvidenceIntakeDetectorResult(intake)).toBeNull();
  });
});
