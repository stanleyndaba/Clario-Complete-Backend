import { describe, expect, it } from '@jest/globals';
import {
  TRANSFER_P135_AUDIT_REGISTRY,
  TransferAuditEvidence,
  TransferAuditSafetySnapshot,
  createAuditEvidence,
  evaluateP135Certification,
  p135DetectorResult,
  registryHash,
  runLocalP135AuditHarness,
  validateAuditDependencyGraph,
} from '../../src/services/transferLedgerP135AuditRegistry';

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

function evidence(overrides: Partial<Record<string, TransferAuditEvidence['state']>> = {}): TransferAuditEvidence[] {
  return TRANSFER_P135_AUDIT_REGISTRY.map((gate) => createAuditEvidence(
    gate.id,
    overrides[gate.id] || 'PASS',
    `deterministic local evidence for ${gate.id}`,
  ));
}

describe('Margin Transfer P11–P135 local audit registry', () => {
  it('defines every P11 through P135 exactly once with all required audit metadata and permanent no-provider/no-production permissions', () => {
    expect(TRANSFER_P135_AUDIT_REGISTRY).toHaveLength(125);
    expect(TRANSFER_P135_AUDIT_REGISTRY.map((gate) => gate.id)).toEqual(
      Array.from({ length: 125 }, (_, index) => `P${index + 11}`),
    );
    for (const gate of TRANSFER_P135_AUDIT_REGISTRY) {
      expect(gate).toEqual(expect.objectContaining({
        id: `P${gate.number}`,
        title: expect.any(String),
        purpose: expect.any(String),
        invariant: expect.any(String),
        inputs: expect.any(Array),
        expectedBehavior: expect.any(String),
        forbiddenBehavior: expect.stringContaining('Provider access'),
        dependencies: expect.any(Array),
        codeAffected: expect.any(Array),
        testsRequired: expect.any(Array),
        adversarialScenarios: expect.any(Array),
        failureScenarios: expect.any(Array),
        isolationRequirements: expect.any(Array),
        evidenceProduced: expect.any(Array),
        passCriteria: expect.any(String),
        failCriteria: expect.any(String),
        productionAllowed: false,
        providerAllowed: false,
      }));
      expect(gate.scenarioMatrix).toEqual({
        normal: true,
        missing: true,
        malformed: true,
        ambiguous: true,
        contradictory: true,
        duplicate: true,
        replay: true,
        concurrent: true,
        wrongScope: true,
        wrongContext: true,
        dependencyFailure: true,
        adversarialBypass: true,
      });
    }
  });

  it('has a deterministic, acyclic dependency graph with P135 depending on the full regression gate', () => {
    const validation = validateAuditDependencyGraph();
    expect(validation).toEqual({ valid: true, reasonCodes: [] });
    expect(TRANSFER_P135_AUDIT_REGISTRY.find((gate) => gate.id === 'P134')?.dependencies).toHaveLength(123);
    expect(TRANSFER_P135_AUDIT_REGISTRY.find((gate) => gate.id === 'P135')?.dependencies).toEqual(['P134']);
    expect(registryHash()).toBe(registryHash());
  });

  it('rejects duplicate IDs, missing dependencies, cycles, and any request for provider or production permission', () => {
    const duplicate = TRANSFER_P135_AUDIT_REGISTRY.map((gate) => ({ ...gate }));
    duplicate[1] = { ...duplicate[1], id: 'P11' };
    expect(validateAuditDependencyGraph(duplicate).reasonCodes).toContain('DUPLICATE_GATE:P11');

    const missingDependency = TRANSFER_P135_AUDIT_REGISTRY.map((gate) => ({ ...gate }));
    missingDependency[0] = { ...missingDependency[0], dependencies: ['P999'] };
    expect(validateAuditDependencyGraph(missingDependency).reasonCodes).toContain('MISSING_DEPENDENCY:P11:P999');

    const cycle = TRANSFER_P135_AUDIT_REGISTRY.map((gate) => ({ ...gate }));
    cycle[0] = { ...cycle[0], dependencies: ['P12'] };
    cycle[1] = { ...cycle[1], dependencies: ['P11'] };
    expect(validateAuditDependencyGraph(cycle).reasonCodes).toContain('DEPENDENCY_CYCLE:P11');

    const unsafe = TRANSFER_P135_AUDIT_REGISTRY.map((gate) => ({ ...gate }));
    unsafe[0] = { ...unsafe[0], providerAllowed: true as false };
    expect(validateAuditDependencyGraph(unsafe).reasonCodes).toContain('UNSAFE_GATE_PERMISSION:P11');
  });

  it('creates replay-deterministic evidence identifiers and returns CERTIFIED only when every gate passes with a safe snapshot', () => {
    const first = createAuditEvidence('P11', 'PASS', 'same evidence');
    const replay = createAuditEvidence('P11', 'PASS', 'same evidence');
    expect(first).toEqual(replay);

    const result = evaluateP135Certification(evidence(), safeSnapshot);
    expect(result).toEqual(expect.objectContaining({
      verdict: 'CERTIFIED',
      gateSummary: expect.objectContaining({ PASS: 124, VERIFICATION_ONLY: 1 }),
      transferActivationAuthorized: false,
      detectorAuthorized: false,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
      detectorResult: null,
    }));
    expect(p135DetectorResult(result)).toBeNull();
  });

  it('fails certification closed for unresolved provider semantics, blocked/failed dependencies, missing evidence, and unsafe Transfer state', () => {
    const unresolvedProvider = evaluateP135Certification(evidence({ P13: 'NOT_TESTABLE_WITHOUT_PROVIDER_ACCESS' }), safeSnapshot);
    expect(unresolvedProvider).toEqual(expect.objectContaining({
      verdict: 'NOT_CERTIFIED',
      reasonCodes: expect.arrayContaining(['P3_PROVIDER_SEMANTICS_UNRESOLVED']),
      claimCapable: false,
      economicValue: null,
    }));

    const blocked = evaluateP135Certification(evidence({ P61: 'BLOCKED', P62: 'FAIL' }), safeSnapshot);
    expect(blocked).toEqual(expect.objectContaining({
      verdict: 'NOT_CERTIFIED',
      blockedGates: ['P61'],
      failedGates: ['P62'],
      dependencyFailures: expect.arrayContaining(['P62->P61']),
    }));

    const missing = evaluateP135Certification(evidence().filter((item) => item.gateId !== 'P134'), safeSnapshot);
    expect(missing).toEqual(expect.objectContaining({
      verdict: 'NOT_CERTIFIED',
      unresolvedGates: expect.arrayContaining(['P134']),
      dependencyFailures: expect.arrayContaining(['P135->P134']),
    }));

    const unsafe = evaluateP135Certification(evidence(), { ...safeSnapshot, transferEnabled: true as false });
    expect(unsafe).toEqual(expect.objectContaining({
      verdict: 'NOT_CERTIFIED',
      reasonCodes: expect.arrayContaining(['TRANSFER_SAFETY_SNAPSHOT_UNSAFE']),
      transferActivationAuthorized: false,
      detectorAuthorized: false,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
      detectorResult: null,
    }));
  });

  it('is conditionally certified only for non-blocking local evidence limitations, never as an activation authorization', () => {
    const conditional = evaluateP135Certification(evidence({ P129: 'VERIFICATION_ONLY' }), safeSnapshot);
    expect(conditional).toEqual(expect.objectContaining({
      verdict: 'CONDITIONALLY_CERTIFIED',
      reasonCodes: expect.arrayContaining(['LOCAL_CONTROLS_PASS_BUT_LIMITED_EVIDENCE_REMAINS']),
      transferActivationAuthorized: false,
      detectorAuthorized: false,
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
      detectorResult: null,
    }));
  });

  it('records local audit passes without fabricating provider authority and therefore returns a truthful not-certified verdict', () => {
    const localEvidence = runLocalP135AuditHarness({
      localGatePasses: TRANSFER_P135_AUDIT_REGISTRY.filter((gate) => gate.id !== 'P13' && gate.id !== 'P135').map((gate) => gate.id),
      providerSemanticAuthorityAvailable: false,
    });
    expect(localEvidence).toHaveLength(124);
    expect(localEvidence.find((item) => item.gateId === 'P13')).toEqual(expect.objectContaining({
      state: 'NOT_TESTABLE_WITHOUT_PROVIDER_ACCESS',
    }));
    const result = evaluateP135Certification(localEvidence, safeSnapshot);
    expect(result).toEqual(expect.objectContaining({
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

  it('is deterministic under concurrent local evaluation and fails closed for duplicate, unknown, or tampered evidence', async () => {
    const complete = evidence();
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve(evaluateP135Certification(complete, safeSnapshot))));
    expect(concurrent.every((result) => JSON.stringify(result) === JSON.stringify(concurrent[0]))).toBe(true);

    const duplicate = evaluateP135Certification([...complete, complete[0]], safeSnapshot);
    expect(duplicate).toEqual(expect.objectContaining({
      verdict: 'NOT_CERTIFIED',
      reasonCodes: expect.arrayContaining(['DUPLICATE_EVIDENCE:P11']),
    }));

    const unknown = evaluateP135Certification([...complete, createAuditEvidence('P999', 'PASS', 'unknown gate')], safeSnapshot);
    expect(unknown).toEqual(expect.objectContaining({
      verdict: 'NOT_CERTIFIED',
      reasonCodes: expect.arrayContaining(['UNKNOWN_EVIDENCE_GATE:P999']),
    }));

    const tampered = evaluateP135Certification([{ ...complete[0], deterministicHash: 'tampered' }, ...complete.slice(1)], safeSnapshot);
    expect(tampered).toEqual(expect.objectContaining({
      verdict: 'NOT_CERTIFIED',
      reasonCodes: expect.arrayContaining(['EVIDENCE_HASH_MISMATCH:P11']),
      claimCapable: false,
      recoveryDetected: false,
      economicValue: null,
      detectorResult: null,
    }));
  });
});
