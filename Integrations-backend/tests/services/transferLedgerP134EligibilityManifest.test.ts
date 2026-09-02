import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import {
  createP110P133EvidenceRecord,
  evaluateP134Eligibility,
  P110P133EvidenceRecord,
  P110P133SafetySnapshot,
  TRANSFER_P110_P133_EVIDENCE_MANIFEST,
  validateP110P133Manifest,
} from '../../src/services/transferLedgerP134EligibilityManifest';

const revision = 'a'.repeat(40);
const hash = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const safeSnapshot: P110P133SafetySnapshot = {
  transferEnabled: false,
  rolloutPercentage: 0,
  mode: 'OFF',
  claimCapable: false,
  providerTouched: false,
  productionTouched: false,
  observationInvoked: false,
  detectorInvoked: false,
  catalogExecuted: false,
  claimCreated: false,
  recoveryCreated: false,
  financialTruthInvoked: false,
  economicValueCalculated: false,
  p3OverrideAuthorized: false,
  liveP5CatalogMutated: false,
};

function validEvidence(sourceRevision = revision): P110P133EvidenceRecord[] {
  return TRANSFER_P110_P133_EVIDENCE_MANIFEST.map((definition) => createP110P133EvidenceRecord({
    gateId: definition.id,
    state: 'PASS',
    sourceRevision,
    testIdentifier: definition.testIdentifiers[0],
    testResultHash: hash(`executed:${definition.id}`),
    observedAt: '2026-08-25T16:21:38.000Z',
    reason: `A real deterministic test execution is required for ${definition.id}; this unit fixture tests only evaluator integrity.`,
  }));
}

describe('P110–P133 executable evidence manifest and P134 eligibility gate', () => {
  it('maps every required P110–P133 gate exactly once to concrete source and test identifiers', () => {
    const validation = validateP110P133Manifest();

    expect(validation).toEqual({ valid: true, reasonCodes: [] });
    expect(TRANSFER_P110_P133_EVIDENCE_MANIFEST).toHaveLength(24);
    expect(TRANSFER_P110_P133_EVIDENCE_MANIFEST.map((definition) => definition.id)).toEqual(
      Array.from({ length: 24 }, (_, index) => `P${index + 110}`),
    );
    for (const definition of TRANSFER_P110_P133_EVIDENCE_MANIFEST) {
      expect(definition.sourcePaths.length).toBeGreaterThan(0);
      expect(definition.testIdentifiers.length).toBeGreaterThan(0);
      expect(definition.testIdentifiers.every((id) => id.includes('::') || id.startsWith('command:'))).toBe(true);
    }
  });

  it('binds every non-command manifest test identifier to an actual repository test definition', () => {
    for (const definition of TRANSFER_P110_P133_EVIDENCE_MANIFEST) {
      for (const identifier of definition.testIdentifiers) {
        if (identifier.startsWith('command:')) continue;
        const separator = identifier.indexOf('::');
        const relativePath = identifier.slice(0, separator);
        const testName = identifier.slice(separator + 2);
        const testPath = path.resolve(__dirname, '../..', relativePath);
        const content = fs.readFileSync(testPath, 'utf8');
        expect(
          content.includes(`it('${testName}'`)
          || content.includes(`])('${testName}'`),
        ).toBe(true);
      }
    }
  });

  it('keeps P134 NOT_RUN when P3 provider semantics are unresolved even when every local gate has integrity-valid evidence', () => {
    const result = evaluateP134Eligibility({
      expectedSourceRevision: revision,
      evidence: validEvidence(),
      safetySnapshot: safeSnapshot,
      providerSemanticAuthorityAvailable: false,
    });

    expect(result).toEqual(expect.objectContaining({
      state: 'NOT_RUN',
      eligible: false,
      transferActivationAuthorized: false,
      detectorAuthorized: false,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
      detectorResult: null,
      reasonCodes: expect.arrayContaining(['P3_PROVIDER_SEMANTICS_UNRESOLVED', 'P110_P133_EVIDENCE_INCOMPLETE_OR_BLOCKED']),
    }));
    expect(result.gateEvaluations.filter((gate) => gate.state === 'BLOCKED')).toEqual([
      expect.objectContaining({ gateId: 'P120', reasonCodes: ['P3_PROVIDER_SEMANTICS_UNRESOLVED'] }),
    ]);
  });

  it('accepts an exact deterministic workspace snapshot as the source revision for local-only evidence', () => {
    const workspaceRevision = `workspace:${'c'.repeat(64)}`;
    const result = evaluateP134Eligibility({
      expectedSourceRevision: workspaceRevision,
      evidence: validEvidence(workspaceRevision),
      safetySnapshot: safeSnapshot,
      providerSemanticAuthorityAvailable: false,
    });

    expect(result.gateEvaluations.find((gate) => gate.gateId === 'P110')).toEqual(expect.objectContaining({ state: 'PASS' }));
    expect(result.gateEvaluations.find((gate) => gate.gateId === 'P120')).toEqual(expect.objectContaining({ state: 'BLOCKED' }));
    expect(result.state).toBe('NOT_RUN');
  });

  it('fails closed for missing evidence rather than inferring a pass from neighboring gate records', () => {
    const evidence = validEvidence().filter((record) => record.gateId !== 'P112');
    const result = evaluateP134Eligibility({
      expectedSourceRevision: revision,
      evidence,
      safetySnapshot: safeSnapshot,
      providerSemanticAuthorityAvailable: false,
    });

    expect(result.gateEvaluations).toContainEqual(expect.objectContaining({
      gateId: 'P112', state: 'BLOCKED', reasonCodes: ['MISSING_EVIDENCE'], evidenceId: null,
    }));
    expect(result.state).toBe('NOT_RUN');
  });

  it.each([
    ['duplicate', (evidence: P110P133EvidenceRecord[]) => [...evidence, evidence[0]]],
    ['tampered', (evidence: P110P133EvidenceRecord[]) => evidence.map((record, index) => index === 0 ? { ...record, deterministicHash: '0'.repeat(64) } : record)],
    ['stale revision', (evidence: P110P133EvidenceRecord[]) => evidence.map((record, index) => index === 0 ? { ...record, sourceRevision: 'b'.repeat(40) } : record)],
    ['unmapped test identifier', (evidence: P110P133EvidenceRecord[]) => evidence.map((record, index) => index === 0
      ? createP110P133EvidenceRecord({ ...record, testIdentifier: 'tests/fictional.test.ts::manufactured green result' })
      : record)],
  ])('fails closed for %s evidence', (_name, mutate) => {
    const result = evaluateP134Eligibility({
      expectedSourceRevision: revision,
      evidence: mutate(validEvidence()) as P110P133EvidenceRecord[],
      safetySnapshot: safeSnapshot,
      providerSemanticAuthorityAvailable: false,
    });

    expect(result.state).toBe('NOT_RUN');
    expect(result.eligible).toBe(false);
    expect(result.gateEvaluations.find((gate) => gate.gateId === 'P110')).toEqual(expect.objectContaining({ state: 'BLOCKED' }));
  });

  it('fails closed when the recorded safety snapshot contradicts the permanent Transfer OFF boundary', () => {
    const result = evaluateP134Eligibility({
      expectedSourceRevision: revision,
      evidence: validEvidence(),
      safetySnapshot: { ...safeSnapshot, detectorInvoked: true } as any,
      providerSemanticAuthorityAvailable: false,
    });

    expect(result).toEqual(expect.objectContaining({
      state: 'NOT_RUN',
      eligible: false,
      reasonCodes: expect.arrayContaining(['TRANSFER_SAFETY_SNAPSHOT_UNSAFE']),
      detectorAuthorized: false,
      claimCapable: false,
      economicValue: null,
    }));
  });
});
