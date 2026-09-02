import crypto from 'crypto';

export const TRANSFER_P135_AUDIT_REGISTRY_VERSION = '1.0.0';

export type TransferAuditDomain =
  | 'SEMANTIC_CATALOG_INTEGRITY'
  | 'EVIDENCE_PROVENANCE'
  | 'PROVIDER_CONTEXT_CORRECTNESS'
  | 'OBSERVATION_NORMALIZATION'
  | 'DETECTION_CORRECTNESS'
  | 'FALSE_POSITIVE_RESISTANCE'
  | 'ISOLATION_SECURITY'
  | 'REPLAY_IDEMPOTENCY_CONCURRENCY'
  | 'FAILURE_PARTIAL_STATE'
  | 'CLAIM_RECOVERY_BOUNDARIES'
  | 'ECONOMIC_INTEGRITY'
  | 'PRODUCTION_READINESS'
  | 'ADVERSARIAL_END_TO_END'
  | 'FULL_REGRESSION'
  | 'FINAL_CERTIFICATION';

export type AuditEvidenceState =
  | 'PASS'
  | 'FAIL'
  | 'VERIFICATION_ONLY'
  | 'NOT_TESTABLE_WITHOUT_PROVIDER_ACCESS'
  | 'BLOCKED'
  | 'UNASSESSED';

export type P135Verdict = 'CERTIFIED' | 'CONDITIONALLY_CERTIFIED' | 'NOT_CERTIFIED';

export interface AuditScenarioMatrix {
  normal: boolean;
  missing: boolean;
  malformed: boolean;
  ambiguous: boolean;
  contradictory: boolean;
  duplicate: boolean;
  replay: boolean;
  concurrent: boolean;
  wrongScope: boolean;
  wrongContext: boolean;
  dependencyFailure: boolean;
  adversarialBypass: boolean;
}

export interface TransferAuditGateDefinition {
  id: string;
  number: number;
  title: string;
  domain: TransferAuditDomain;
  purpose: string;
  invariant: string;
  inputs: string[];
  expectedBehavior: string;
  forbiddenBehavior: string;
  dependencies: string[];
  codeAffected: string[];
  testsRequired: string[];
  adversarialScenarios: string[];
  failureScenarios: string[];
  isolationRequirements: string[];
  evidenceProduced: string[];
  passCriteria: string;
  failCriteria: string;
  codeRequired: boolean;
  testOnlySufficient: boolean;
  productionAllowed: false;
  providerAllowed: false;
  scenarioMatrix: AuditScenarioMatrix;
}

export interface TransferAuditEvidence {
  gateId: string;
  state: AuditEvidenceState;
  evidenceId: string;
  reason: string;
  testedAt: string;
  deterministicHash: string;
}

export interface TransferAuditSafetySnapshot {
  transferEnabled: false;
  rolloutPercentage: 0;
  mode: 'OFF';
  claimCapable: false;
  productionTouched: false;
  providerTouched: false;
  observationInvoked: false;
  detectorInvoked: false;
  claimCreated: false;
  recoveryCreated: false;
  economicValueCalculated: false;
  p3OverrideAuthorized: false;
  liveP5CatalogMutated: false;
}

export interface P135CertificationResult {
  registryVersion: string;
  registryHash: string;
  verdict: P135Verdict;
  reasonCodes: string[];
  gateSummary: Record<AuditEvidenceState, number>;
  dependencyFailures: string[];
  unresolvedGates: string[];
  blockedGates: string[];
  failedGates: string[];
  safetySnapshot: TransferAuditSafetySnapshot;
  transferActivationAuthorized: false;
  detectorAuthorized: false;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

const standardScenarios: AuditScenarioMatrix = Object.freeze({
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

const domainSpecs: Array<{
  start: number;
  end: number;
  domain: TransferAuditDomain;
  dependencyRoots: string[];
  codeRequired: boolean;
  titlePrefix: string;
  subjects: string[];
  invariant: string;
  purpose: string;
  codeAffected: string[];
}> = [
  {
    start: 11, end: 20, domain: 'SEMANTIC_CATALOG_INTEGRITY', dependencyRoots: ['P10'], codeRequired: false,
    titlePrefix: 'Semantic catalog',
    subjects: ['local read publication', 'target identity', 'P3 provider-semantic compatibility', 'authority hierarchy', 'catalog consistency', 'version progression', 'predecessor hash integrity', 'negative-condition preservation', 'semantic downgrade prevention', 'P3 compatibility'],
    invariant: 'A catalog representation never becomes a P3 override, live mutation, or Transfer activation.',
    purpose: 'Verify the P3–P11 semantic and catalog boundary chain.',
    codeAffected: ['transferLedgerProviderSemanticsCatalog.ts', 'transferLedgerCatalogChangeExecution.ts', 'transferLedgerLocalCatalogReadPublication.ts'],
  },
  {
    start: 21, end: 30, domain: 'EVIDENCE_PROVENANCE', dependencyRoots: ['P16', 'P20'], codeRequired: false,
    titlePrefix: 'Evidence provenance',
    subjects: ['artifact provenance hash', 'canonicalization', 'source authenticity', 'artifact integrity', 'context binding', 'replay identity', 'evidence invalidation', 'evidence supersession', 'chain continuity', 'raw-artifact exclusion'],
    invariant: 'Authority evidence remains exact, attributable, replay-safe, and non-leaking.',
    purpose: 'Verify the P6–P10 provenance chain without retrieving provider material.',
    codeAffected: ['transferLedgerAuthorityEvidenceIntake.ts', 'transferLedgerAuthorityEvidenceVerifier.ts', 'transferLedgerCatalogChangeReview.ts'],
  },
  {
    start: 31, end: 40, domain: 'PROVIDER_CONTEXT_CORRECTNESS', dependencyRoots: ['P25', 'P29'], codeRequired: false,
    titlePrefix: 'Provider-context',
    subjects: ['provider identity', 'marketplace binding', 'report type binding', 'event context binding', 'field context binding', 'artifact-version binding', 'scope binding', 'cross-marketplace contamination', 'cross-report contamination', 'cross-version contamination'],
    invariant: 'No semantic assertion crosses provider, marketplace, report, event, field, artifact, or scope boundaries.',
    purpose: 'Verify context specificity of catalog and evidence records.',
    codeAffected: ['transferLedgerProviderEvidenceReadiness.ts', 'transferLedgerProviderSemanticsCatalog.ts', 'transferLedgerCatalogChangeExecution.ts'],
  },
  {
    start: 41, end: 50, domain: 'OBSERVATION_NORMALIZATION', dependencyRoots: ['P4', 'P33'], codeRequired: false,
    titlePrefix: 'Observation normalization',
    subjects: ['raw observation boundary', 'raw payload normalization', 'schema handling', 'malformed record rejection', 'missing field handling', 'duplicate record handling', 'ordering non-inference', 'pagination representation', 'partial-data handling', 'normalization non-invention'],
    invariant: 'Raw observations preserve provider facts without inventing Transfer roles or economic meaning.',
    purpose: 'Verify P1/P4 raw observation behavior and fail-closed normalization.',
    codeAffected: ['transferLedgerObservationService.ts', 'transferLedgerProviderEvidenceReadiness.ts', 'transferLedgerSemanticEvidence.ts'],
  },
  {
    start: 51, end: 60, domain: 'DETECTION_CORRECTNESS', dependencyRoots: ['P3', 'P45'], codeRequired: false,
    titlePrefix: 'Detector boundary',
    subjects: ['detector input contract', 'semantic prerequisite', 'detector registration isolation', 'detector source isolation', 'positive-detection prohibition', 'negative-detection prohibition', 'ambiguous-evidence refusal', 'incomplete-evidence refusal', 'duplicate-detection refusal', 'deterministic fail-closed result'],
    invariant: 'No detector can consume unresolved Transfer evidence or create a claim-oriented result.',
    purpose: 'Audit the boundary between P3 evidence and the existing detector without invoking it.',
    codeAffected: ['warehouseTransferLossAlgorithm.ts', 'transferLedgerSemanticEvidence.ts', 'transferLedgerObservationService.ts'],
  },
  {
    start: 61, end: 70, domain: 'FALSE_POSITIVE_RESISTANCE', dependencyRoots: ['P51', 'P56'], codeRequired: false,
    titlePrefix: 'False-positive resistance',
    subjects: ['chronology trap', 'matching-ID trap', 'duplicate-ID trap', 'quantity-sign trap', 'fulfillment-center trap', 'WhseTransfers-label trap', 'missing-counterpart trap', 'partial-lifecycle trap', 'plausible-row trap', 'contradictory-evidence trap'],
    invariant: 'Plausible raw rows never become Transfer facts without complete independently verified evidence.',
    purpose: 'Attack semantic truth gates with realistic misleading inputs.',
    codeAffected: ['transferLedgerSemanticEvidence.ts', 'transferLedgerProviderEvidenceReadiness.ts', 'transferLedgerProviderSemanticsCatalog.ts'],
  },
  {
    start: 71, end: 80, domain: 'ISOLATION_SECURITY', dependencyRoots: ['P41', 'P51'], codeRequired: false,
    titlePrefix: 'Isolation security',
    subjects: ['tenant isolation', 'workspace isolation', 'seller isolation', 'marketplace isolation', 'account isolation', 'source isolation', 'authorization boundary', 'cross-scope read refusal', 'cross-scope write refusal', 'metadata/provenance leakage refusal'],
    invariant: 'Evidence, catalog review, and observations cannot cross identity or scope boundaries.',
    purpose: 'Verify local isolation controls without real customer data.',
    codeAffected: ['transferLedgerSemanticEvidence.ts', 'transferLedgerAuthorityAcquisitionPlan.ts', 'transferLedgerObservationService.ts'],
  },
  {
    start: 81, end: 90, domain: 'REPLAY_IDEMPOTENCY_CONCURRENCY', dependencyRoots: ['P41', 'P71'], codeRequired: false,
    titlePrefix: 'Replay and idempotency',
    subjects: ['exact replay', 'duplicate evidence intake', 'duplicate observation identity', 'duplicate detection refusal', 'concurrent publication', 'race-condition refusal', 'retry behavior', 'idempotent transformation', 'ordering independence', 'deterministic state transition'],
    invariant: 'Equivalent local inputs have stable identities and cannot create duplicate semantics or economic output.',
    purpose: 'Verify deterministic hashes and replay-safe state transitions.',
    codeAffected: ['transferLedgerAuthorityEvidenceIntake.ts', 'transferLedgerCatalogChangeExecution.ts', 'transferLedgerLocalCatalogReadPublication.ts'],
  },
  {
    start: 91, end: 100, domain: 'FAILURE_PARTIAL_STATE', dependencyRoots: ['P41', 'P81'], codeRequired: false,
    titlePrefix: 'Failure-state',
    subjects: ['provider-timeout representation', 'malformed-provider-response representation', 'missing-artifact rejection', 'incomplete-response rejection', 'interrupted-processing representation', 'retry after failure', 'partial-persistence refusal', 'duplicate-retry refusal', 'dependency-failure propagation', 'recovery-after-failure safety'],
    invariant: 'Every partial or failed path remains non-semantic, non-economic, and fail-closed.',
    purpose: 'Verify local failure-state handling without contacting a provider.',
    codeAffected: ['transferLedgerObservationService.ts', 'transferLedgerAuthorityEvidenceVerifier.ts', 'transferLedgerCatalogChangeExecution.ts'],
  },
  {
    start: 101, end: 110, domain: 'CLAIM_RECOVERY_BOUNDARIES', dependencyRoots: ['P51', 'P61', 'P91'], codeRequired: false,
    titlePrefix: 'Claim-recovery boundary',
    subjects: ['observation-to-semantic separation', 'semantic-to-detection separation', 'detection-to-claim separation', 'claim-to-recovery separation', 'recovery-to-payout separation', 'insufficient-evidence claim refusal', 'detector-is-not-claim proof', 'claim-is-not-recovery proof', 'semantic-is-not-economic proof', 'zero-claim invariant'],
    invariant: 'No earlier Transfer stage is equivalent to or may produce a claim, recovery, payout, or value.',
    purpose: 'Verify absolute non-economic separation across the recovery lifecycle.',
    codeAffected: ['transferLedgerObservationService.ts', 'transferLedgerSemanticEvidence.ts', 'warehouseTransferLossAlgorithm.ts'],
  },
  {
    start: 111, end: 120, domain: 'ECONOMIC_INTEGRITY', dependencyRoots: ['P101'], codeRequired: false,
    titlePrefix: 'Economic integrity',
    subjects: ['fabricated-value refusal', 'invented-quantity refusal', 'unsupported-reimbursement refusal', 'duplicate-recovery refusal', 'currency-confusion refusal', 'unit-confusion refusal', 'ambiguous-evidence valuation refusal', 'unresolved-semantics valuation refusal', 'deterministic-economic-boundary', 'economic-path fail-closed behavior'],
    invariant: 'Unresolved Transfer semantics cannot enter valuation, reimbursement, or economic computation.',
    purpose: 'Audit the economic firewall without calculating a real value.',
    codeAffected: ['warehouseTransferLossAlgorithm.ts', 'recoveryFinancialTruthService.ts', 'transferLedgerSemanticEvidence.ts'],
  },
  {
    start: 121, end: 128, domain: 'PRODUCTION_READINESS', dependencyRoots: ['P1', 'P2', 'P10', 'P11'], codeRequired: false,
    titlePrefix: 'Production-readiness',
    subjects: ['configuration safe default', 'feature-flag OFF lock', 'rollout zero lock', 'migration isolation', 'startup isolation', 'logging/observability boundary', 'rollback representation', 'secret/provider environment separation'],
    invariant: 'Production remains off, zero-rollout, isolated, and unable to activate Transfer accidentally.',
    purpose: 'Audit production safeguards locally without production access.',
    codeAffected: ['133_reconcile_transfer_ledger_observation_rail.sql', 'transferLedgerShadowEligibility.ts', 'apply-transfer-ledger-reconciliation-133.ts'],
  },
  {
    start: 129, end: 133, domain: 'ADVERSARIAL_END_TO_END', dependencyRoots: ['P61', 'P81', 'P91', 'P121'], codeRequired: true,
    titlePrefix: 'Adversarial cross-gate',
    subjects: ['ambiguous context plus retry', 'stale catalog plus concurrent processing', 'plausible rows plus missing lifecycle', 'cross-marketplace duplicate replay', 'dependency-failure bypass attempt'],
    invariant: 'Composed attacks cannot cross semantic, scope, idempotency, detection, claim, or economic boundaries.',
    purpose: 'Exercise multiple local controls as one hostile scenario.',
    codeAffected: ['transferLedgerP135AuditRegistry.ts', 'transferLedgerSemanticEvidence.ts', 'transferLedgerCatalogChangeExecution.ts'],
  },
];

function phaseId(number: number): string {
  return `P${number}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function dependencyFor(spec: typeof domainSpecs[number], number: number): string[] {
  if (number === spec.start) return [...spec.dependencyRoots];
  return [phaseId(number - 1), ...spec.dependencyRoots.filter((id) => id !== phaseId(number - 1))];
}

function createGate(spec: typeof domainSpecs[number], number: number, subject: string): TransferAuditGateDefinition {
  const id = phaseId(number);
  return {
    id,
    number,
    title: `${spec.titlePrefix}: ${subject}`,
    domain: spec.domain,
    purpose: spec.purpose,
    invariant: spec.invariant,
    inputs: ['Local source/test contracts', 'deterministic in-memory fixtures', 'upstream gate evidence'],
    expectedBehavior: 'Accept only exact, complete, scoped, deterministic, non-economic evidence and reject every unsafe or unsupported path.',
    forbiddenBehavior: 'Provider access, production mutation, Transfer activation, observation invocation, detector invocation, claim, recovery, economic calculation, P3 override, or live P5 mutation.',
    dependencies: dependencyFor(spec, number),
    codeAffected: spec.codeAffected,
    testsRequired: ['unit', 'integration', 'adversarial', 'regression', 'cross-gate where applicable'],
    adversarialScenarios: [`Attempt to bypass ${subject} using plausible but insufficient or cross-scope evidence.`, 'Attempt to convert a safe audit result into activation, detection, claim, recovery, or value.'],
    failureScenarios: ['missing input', 'malformed input', 'ambiguous input', 'contradictory input', 'duplicate/replay input', 'dependency failure'],
    isolationRequirements: ['tenant/user/store/marketplace boundaries remain exact', 'no raw artifact or customer metadata is emitted beyond permitted hashes/locators', 'no external connection is used'],
    evidenceProduced: ['deterministic test result', 'stable reason code', 'registry evidence record', 'zero-claim output assertion'],
    passCriteria: 'All required local assertions pass while every forbidden behavior remains unreachable.',
    failCriteria: 'Any unsafe activation, scope leak, semantic bypass, nondeterminism, persistence, provider call, detector/claim/recovery/value output, or missing required evidence.',
    codeRequired: spec.codeRequired,
    testOnlySufficient: !spec.codeRequired,
    productionAllowed: false,
    providerAllowed: false,
    scenarioMatrix: standardScenarios,
  };
}

function createFinalGate(number: 134 | 135): TransferAuditGateDefinition {
  const isFinal = number === 135;
  return {
    id: phaseId(number),
    number,
    title: isFinal ? 'Final independent certification gate' : 'Full system regression gate',
    domain: isFinal ? 'FINAL_CERTIFICATION' : 'FULL_REGRESSION',
    purpose: isFinal
      ? 'Determine whether the complete local evidence supports CERTIFIED, CONDITIONALLY_CERTIFIED, or NOT_CERTIFIED without activating Transfer.'
      : 'Run every local Transfer audit gate cumulatively and preserve exact evidence of results.',
    invariant: isFinal
      ? 'Certification is evidence-based and cannot silently certify unresolved provider semantics or unsafe runtime behavior.'
      : 'A later gate cannot regress an earlier safety invariant.',
    inputs: isFinal ? ['P11–P134 evidence records', 'safe Transfer configuration snapshot'] : ['P11–P133 evidence records', 'full local test execution result'],
    expectedBehavior: isFinal ? 'Emit a deterministic verdict with explicit blockers and no activation.' : 'Execute the complete local suite and record every gate result.',
    forbiddenBehavior: 'Provider access, production mutation, Transfer activation, observation invocation, detector invocation, claim, recovery, economic calculation, P3 override, or live P5 mutation.',
    dependencies: isFinal ? ['P134'] : Array.from({ length: 123 }, (_, index) => phaseId(index + 11)),
    codeAffected: ['transferLedgerP135AuditRegistry.ts', 'transferLedgerP135AuditRegistry.test.ts'],
    testsRequired: ['full regression', 'deterministic certification', 'adversarial certification blockers', 'static boundary review'],
    adversarialScenarios: ['Attempt to certify while a provider semantic remains unresolved.', 'Attempt to certify while Transfer is enabled, detector invoked, or economic value exists.'],
    failureScenarios: ['missing gate evidence', 'failed dependency', 'blocked provider evidence', 'unsafe safety snapshot', 'non-deterministic verdict'],
    isolationRequirements: ['local-only evidence', 'no external source retrieval', 'no production or provider connection'],
    evidenceProduced: ['full suite result', 'registry hash', 'P135 verdict', 'blocker list', 'safety snapshot'],
    passCriteria: isFinal ? 'Verdict exactly reflects evidence and safety state; no activation occurs.' : 'Every registered local gate has evidence and every runnable test passes.',
    failCriteria: 'Missing evidence, failed/unsafe gate, invalid dependency graph, or certification that ignores unresolved blockers.',
    codeRequired: true,
    testOnlySufficient: false,
    productionAllowed: false,
    providerAllowed: false,
    scenarioMatrix: standardScenarios,
  };
}

export const TRANSFER_P135_AUDIT_REGISTRY: readonly TransferAuditGateDefinition[] = Object.freeze([
  ...domainSpecs.flatMap((spec) => Array.from(
    { length: spec.end - spec.start + 1 },
    (_, index) => createGate(spec, spec.start + index, spec.subjects[index]),
  )),
  createFinalGate(134),
  createFinalGate(135),
]);

export function registryHash(registry: readonly TransferAuditGateDefinition[] = TRANSFER_P135_AUDIT_REGISTRY): string {
  return sha256(canonicalJson(registry));
}

export function validateAuditDependencyGraph(
  registry: readonly TransferAuditGateDefinition[] = TRANSFER_P135_AUDIT_REGISTRY,
): { valid: boolean; reasonCodes: string[] } {
  const ids = new Set<string>();
  const byId = new Map<string, TransferAuditGateDefinition>();
  const reasonCodes: string[] = [];
  for (const gate of registry) {
    if (ids.has(gate.id)) reasonCodes.push(`DUPLICATE_GATE:${gate.id}`);
    ids.add(gate.id);
    byId.set(gate.id, gate);
    if (gate.productionAllowed || gate.providerAllowed) reasonCodes.push(`UNSAFE_GATE_PERMISSION:${gate.id}`);
    if (gate.number < 11 || gate.number > 135 || gate.id !== phaseId(gate.number)) reasonCodes.push(`INVALID_GATE_ID:${gate.id}`);
  }
  if (registry.length !== 125) reasonCodes.push('REGISTRY_MUST_CONTAIN_P11_THROUGH_P135');
  for (let number = 11; number <= 135; number += 1) {
    if (!byId.has(phaseId(number))) reasonCodes.push(`MISSING_GATE:${phaseId(number)}`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { reasonCodes.push(`DEPENDENCY_CYCLE:${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const gate = byId.get(id);
    for (const dependency of gate?.dependencies || []) {
      if (!byId.has(dependency) && !/^P([1-9]|10)$/.test(dependency)) reasonCodes.push(`MISSING_DEPENDENCY:${id}:${dependency}`);
      if (byId.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  registry.forEach((gate) => visit(gate.id));
  const finalGate = byId.get('P135');
  if (!finalGate?.dependencies.includes('P134')) reasonCodes.push('P135_MUST_DEPEND_ON_P134');
  return { valid: reasonCodes.length === 0, reasonCodes };
}

export function createAuditEvidence(
  gateId: string,
  state: AuditEvidenceState,
  reason: string,
  testedAt = '2026-08-25T00:00:00.000Z',
): TransferAuditEvidence {
  const evidenceId = sha256(`${TRANSFER_P135_AUDIT_REGISTRY_VERSION}:${gateId}:${state}:${reason}:${testedAt}`);
  return { gateId, state, evidenceId, reason, testedAt, deterministicHash: evidenceId };
}

const emptySummary = (): Record<AuditEvidenceState, number> => ({
  PASS: 0,
  FAIL: 0,
  VERIFICATION_ONLY: 0,
  NOT_TESTABLE_WITHOUT_PROVIDER_ACCESS: 0,
  BLOCKED: 0,
  UNASSESSED: 0,
});

/**
 * P135 is a local certification evaluator, not a runtime activation path. A
 * provider-semantic blocker or any unsafe snapshot yields NOT_CERTIFIED.
 */
export function evaluateP135Certification(
  evidence: readonly TransferAuditEvidence[],
  safetySnapshot: TransferAuditSafetySnapshot,
  registry: readonly TransferAuditGateDefinition[] = TRANSFER_P135_AUDIT_REGISTRY,
): P135CertificationResult {
  const graph = validateAuditDependencyGraph(registry);
  const evidenceByGate = new Map<string, TransferAuditEvidence>();
  const reasonCodes = [...graph.reasonCodes];
  const knownGateIds = new Set(registry.map((gate) => gate.id));
  for (const item of evidence) {
    if (!knownGateIds.has(item.gateId)) reasonCodes.push(`UNKNOWN_EVIDENCE_GATE:${item.gateId}`);
    if (evidenceByGate.has(item.gateId)) reasonCodes.push(`DUPLICATE_EVIDENCE:${item.gateId}`);
    const expectedHash = sha256(`${TRANSFER_P135_AUDIT_REGISTRY_VERSION}:${item.gateId}:${item.state}:${item.reason}:${item.testedAt}`);
    if (item.evidenceId !== expectedHash || item.deterministicHash !== expectedHash) reasonCodes.push(`EVIDENCE_HASH_MISMATCH:${item.gateId}`);
    evidenceByGate.set(item.gateId, item);
  }
  const summary = emptySummary();
  const failedGates: string[] = [];
  const blockedGates: string[] = [];
  const unresolvedGates: string[] = [];
  const dependencyFailures: string[] = [];
  for (const gate of registry) {
    const item = evidenceByGate.get(gate.id);
    const state: AuditEvidenceState = gate.id === 'P135' ? 'VERIFICATION_ONLY' : (item?.state || 'UNASSESSED');
    summary[state] += 1;
    if (state === 'FAIL') failedGates.push(gate.id);
    if (state === 'BLOCKED') blockedGates.push(gate.id);
    if (state === 'NOT_TESTABLE_WITHOUT_PROVIDER_ACCESS' || state === 'UNASSESSED') unresolvedGates.push(gate.id);
    for (const dependency of gate.dependencies) {
      const dependencyEvidence = evidenceByGate.get(dependency);
      if (dependency.startsWith('P') && Number(dependency.slice(1)) >= 11
        && (!dependencyEvidence || dependencyEvidence.state === 'FAIL' || dependencyEvidence.state === 'BLOCKED')) {
        dependencyFailures.push(`${gate.id}->${dependency}`);
      }
    }
  }
  const unsafe = safetySnapshot.transferEnabled
    || safetySnapshot.rolloutPercentage !== 0
    || safetySnapshot.mode !== 'OFF'
    || safetySnapshot.claimCapable
    || safetySnapshot.productionTouched
    || safetySnapshot.providerTouched
    || safetySnapshot.observationInvoked
    || safetySnapshot.detectorInvoked
    || safetySnapshot.claimCreated
    || safetySnapshot.recoveryCreated
    || safetySnapshot.economicValueCalculated
    || safetySnapshot.p3OverrideAuthorized
    || safetySnapshot.liveP5CatalogMutated;
  if (unsafe) reasonCodes.push('TRANSFER_SAFETY_SNAPSHOT_UNSAFE');
  const p3SemanticBlocker = evidenceByGate.get('P13')?.state === 'NOT_TESTABLE_WITHOUT_PROVIDER_ACCESS'
    || evidenceByGate.get('P13')?.state === 'BLOCKED';
  if (p3SemanticBlocker) reasonCodes.push('P3_PROVIDER_SEMANTICS_UNRESOLVED');
  const evidenceIntegrityFailure = reasonCodes.some((code) => /^(DUPLICATE_EVIDENCE|UNKNOWN_EVIDENCE_GATE|EVIDENCE_HASH_MISMATCH):/.test(code));
  const hasHardFailure = !graph.valid || unsafe || evidenceIntegrityFailure || failedGates.length > 0 || blockedGates.length > 0 || dependencyFailures.length > 0 || p3SemanticBlocker;
  const allPass = registry.filter((gate) => gate.id !== 'P135').every((gate) => evidenceByGate.get(gate.id)?.state === 'PASS');
  const verdict: P135Verdict = hasHardFailure
    ? 'NOT_CERTIFIED'
    : allPass
      ? 'CERTIFIED'
      : 'CONDITIONALLY_CERTIFIED';
  if (verdict === 'CERTIFIED') reasonCodes.push('ALL_LOCAL_AND_PROVIDER_EVIDENCE_GATES_PASS');
  if (verdict === 'CONDITIONALLY_CERTIFIED') reasonCodes.push('LOCAL_CONTROLS_PASS_BUT_LIMITED_EVIDENCE_REMAINS');
  if (verdict === 'NOT_CERTIFIED' && reasonCodes.length === 0) reasonCodes.push('AUDIT_EVIDENCE_INCOMPLETE');
  return {
    registryVersion: TRANSFER_P135_AUDIT_REGISTRY_VERSION,
    registryHash: registryHash(registry),
    verdict,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    gateSummary: summary,
    dependencyFailures: [...new Set(dependencyFailures)].sort(),
    unresolvedGates: [...new Set(unresolvedGates)].sort(),
    blockedGates: [...new Set(blockedGates)].sort(),
    failedGates: [...new Set(failedGates)].sort(),
    safetySnapshot,
    transferActivationAuthorized: false,
    detectorAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}

export function p135DetectorResult(_: P135CertificationResult): null {
  return null;
}

export interface LocalP135AuditHarnessInput {
  localGatePasses: readonly string[];
  providerSemanticAuthorityAvailable: false;
  testedAt?: string;
}

/**
 * Produces evidence for the local audit surface only. The exact P3 semantic
 * compatibility gate remains NOT_TESTABLE_WITHOUT_PROVIDER_ACCESS until real,
 * separately authorized authoritative provider evidence exists; no fixture can
 * alter that state.
 */
export function runLocalP135AuditHarness(
  input: LocalP135AuditHarnessInput,
  registry: readonly TransferAuditGateDefinition[] = TRANSFER_P135_AUDIT_REGISTRY,
): TransferAuditEvidence[] {
  const passed = new Set(input.localGatePasses);
  const testedAt = input.testedAt || '2026-08-25T00:00:00.000Z';
  return registry
    .filter((gate) => gate.id !== 'P135')
    .map((gate) => {
      if (gate.id === 'P13' && input.providerSemanticAuthorityAvailable === false) {
        return createAuditEvidence(gate.id, 'NOT_TESTABLE_WITHOUT_PROVIDER_ACCESS', 'Authoritative provider semantics were not retrieved or asserted during this local-only audit.', testedAt);
      }
      if (passed.has(gate.id)) {
        return createAuditEvidence(gate.id, 'PASS', 'Deterministic local audit evidence passed.', testedAt);
      }
      return createAuditEvidence(gate.id, 'VERIFICATION_ONLY', 'The gate is registered but not independently exercised by this local harness invocation.', testedAt);
    });
}
