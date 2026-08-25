import crypto from 'crypto';

/**
 * P135 is intentionally a pure local audit registry. It performs no I/O,
 * imports no provider, database, queue, detector, recovery, or activation
 * service, and cannot change a feature flag or execute a transfer flow.
 */
export type TransferLedgerGateId = `P${number}`;
export type TransferLedgerTestStatus = 'PASS' | 'PARTIAL' | 'NOT_IMPLEMENTED' | 'NOT_RUN' | 'FAIL';
export type TransferLedgerGateVerdict = 'PASS' | 'BLOCKED';
export type TransferLedgerCertificationVerdict = 'CERTIFIED' | 'NOT_CERTIFIED';

export interface TransferLedgerP135GateDefinition {
  id: TransferLedgerGateId;
  title: string;
  domain: string;
  dependencies: readonly TransferLedgerGateId[];
  requiredEvidence: readonly string[];
  testStatus: TransferLedgerTestStatus;
  blockers: readonly string[];
  safetyAssertions: readonly string[];
}

export interface TransferLedgerP135Gate extends TransferLedgerP135GateDefinition {
  verdict: TransferLedgerGateVerdict;
}

export interface TransferLedgerP135Registry {
  schemaVersion: 'transfer-ledger-p135-v1';
  gates: readonly TransferLedgerP135Gate[];
  p134Status: TransferLedgerTestStatus;
  blockers: readonly string[];
  safetyAssertions: Readonly<{
    transferActivation: 'OFF';
    providerAccess: 'NONE';
    economicOutput: 'NONE';
    productionMutation: 'NONE';
  }>;
  verdict: TransferLedgerCertificationVerdict;
  registryHash: string;
}

export interface TransferLedgerP135RegistryOptions {
  /**
   * Test-only/runner-supplied evidence updates. These alter an in-memory
   * registry result only; they cannot enable a feature or start any service.
   */
  evidenceOverrides?: Readonly<Record<string, Partial<Pick<TransferLedgerP135GateDefinition, 'testStatus' | 'blockers'>>>>;
  p134Status?: TransferLedgerTestStatus;
}

const expectedGateIds = Object.freeze(
  Array.from({ length: 26 }, (_, offset) => `P${110 + offset}` as TransferLedgerGateId),
);

const globalSafetyAssertions = Object.freeze({
  transferActivation: 'OFF' as const,
  providerAccess: 'NONE' as const,
  economicOutput: 'NONE' as const,
  productionMutation: 'NONE' as const,
});

function frozenGate(definition: TransferLedgerP135GateDefinition): TransferLedgerP135GateDefinition {
  return Object.freeze({
    ...definition,
    dependencies: Object.freeze([...definition.dependencies]),
    requiredEvidence: Object.freeze([...definition.requiredEvidence]),
    blockers: Object.freeze([...definition.blockers]),
    safetyAssertions: Object.freeze([...definition.safetyAssertions]),
  });
}

/**
 * This is the sole P110–P135 contract. It deliberately records incomplete
 * evidence as incomplete instead of treating the current source review as a
 * release approval.
 */
export const transferLedgerP135GateDefinitions: readonly TransferLedgerP135GateDefinition[] = Object.freeze([
  frozenGate({
    id: 'P110',
    title: 'Preserved-source observation only',
    domain: 'observation boundary',
    dependencies: [],
    requiredEvidence: ['Focused observation-service test', 'No provider acquisition or claim output assertion'],
    testStatus: 'PARTIAL',
    blockers: ['No independent end-to-end no-provider execution proof.'],
    safetyAssertions: ['Reads persisted Ledger rows only.', 'Never constructs a transfer lifecycle or claim output.'],
  }),
  frozenGate({
    id: 'P111',
    title: 'Exact provider taxonomy',
    domain: 'semantic containment',
    dependencies: ['P110'],
    requiredEvidence: ['Exact WhseTransfers acceptance test', 'Non-exact transfer-like rejection test'],
    testStatus: 'PASS',
    blockers: [],
    safetyAssertions: ['Only normalized exact WhseTransfers is accepted.', 'Broader transfer labels fail closed.'],
  }),
  frozenGate({
    id: 'P112',
    title: 'Scope isolation',
    domain: 'tenant and store boundary',
    dependencies: ['P110'],
    requiredEvidence: ['Tenant/store/sync query-scope test', 'Marketplace boundary attack test'],
    testStatus: 'PASS',
    blockers: [],
    safetyAssertions: ['Observation queries bind tenant, user, store, marketplace, and Ledger sync.'],
  }),
  frozenGate({
    id: 'P113',
    title: 'Ambiguity and unpaired containment',
    domain: 'evidence state',
    dependencies: ['P111', 'P112'],
    requiredEvidence: ['Ambiguous-reference test', 'Unpaired-event test'],
    testStatus: 'PASS',
    blockers: [],
    safetyAssertions: ['Ambiguous and unpaired records never become exact transfer pairs.'],
  }),
  frozenGate({
    id: 'P114',
    title: 'Incomplete history and source failure containment',
    domain: 'freshness and availability',
    dependencies: ['P110'],
    requiredEvidence: ['Partial-history test', 'Query-failure test', 'Explicit stale-evidence policy test'],
    testStatus: 'PARTIAL',
    blockers: ['No explicit stale-evidence policy or adversarial test.'],
    safetyAssertions: ['Partial history is not represented as a clean transfer state.'],
  }),
  frozenGate({
    id: 'P115',
    title: 'Replay and source-fingerprint integrity',
    domain: 'idempotency',
    dependencies: ['P112'],
    requiredEvidence: ['Fingerprint uniqueness schema assertion', 'Replay-idempotency test'],
    testStatus: 'PARTIAL',
    blockers: ['Replay behavior is not independently tested.'],
    safetyAssertions: ['Provider fingerprint remains scoped to the observation identity.'],
  }),
  frozenGate({
    id: 'P116',
    title: 'Observation schema and feature flag remain OFF',
    domain: 'schema safety',
    dependencies: ['P110'],
    requiredEvidence: ['Migration SQL contract test', 'OFF/zero-rollout/non-claim flag assertion'],
    testStatus: 'PASS',
    blockers: [],
    safetyAssertions: ['The migration defines an OFF, zero-rollout, non-claim flag.'],
  }),
  frozenGate({
    id: 'P117',
    title: 'Controlled migration apply guard',
    domain: 'migration control',
    dependencies: ['P116'],
    requiredEvidence: ['Exact confirmation test', 'Target guard test', 'Divergence refusal source review'],
    testStatus: 'PASS',
    blockers: [],
    safetyAssertions: ['Apply requires explicit confirmation and approved-target validation.'],
  }),
  frozenGate({
    id: 'P118',
    title: 'Legacy activation-path separation',
    domain: 'dependency graph',
    dependencies: ['P110', 'P116'],
    requiredEvidence: ['No observation-to-detector import assertion', 'No observation-to-financial-truth import assertion', 'Adversarial integration test'],
    testStatus: 'PARTIAL',
    blockers: ['Dedicated adversarial separation test is absent.'],
    safetyAssertions: ['Observation service has no direct legacy detector or financial-truth dependency.'],
  }),
  frozenGate({
    id: 'P119',
    title: 'Fail-closed shadow eligibility',
    domain: 'eligibility',
    dependencies: ['P116'],
    requiredEvidence: ['transferLedgerShadowEligibility implementation', 'Eligibility denial tests'],
    testStatus: 'NOT_IMPLEMENTED',
    blockers: ['transferLedgerShadowEligibility.ts is absent.'],
    safetyAssertions: ['No missing eligibility control may be treated as approval.'],
  }),
  frozenGate({
    id: 'P120',
    title: 'Semantic evidence cannot become economic evidence',
    domain: 'economic boundary',
    dependencies: ['P111', 'P113', 'P118'],
    requiredEvidence: ['Semantic-boundary implementation', 'Semantic-to-economic adversarial test'],
    testStatus: 'PARTIAL',
    blockers: ['No semantic-evidence module or explicit non-flow test exists.'],
    safetyAssertions: ['Observation facts are not valuations, losses, claims, or payment truth.'],
  }),
  frozenGate({
    id: 'P121',
    title: 'Catalog and activation execution remain unavailable',
    domain: 'activation boundary',
    dependencies: ['P118'],
    requiredEvidence: ['No catalog-execution import assertion', 'Audit-to-activation adversarial test'],
    testStatus: 'PARTIAL',
    blockers: ['Named catalog execution boundary and test are absent.'],
    safetyAssertions: ['Certification output cannot enable a transfer path.'],
  }),
  frozenGate({
    id: 'P122',
    title: 'Failed dependencies and OFF configuration fail closed',
    domain: 'failure handling',
    dependencies: ['P114', 'P116'],
    requiredEvidence: ['Failed-dependency bypass test', 'OFF-configuration bypass test'],
    testStatus: 'NOT_IMPLEMENTED',
    blockers: ['No dedicated fallback/configuration escape test exists.'],
    safetyAssertions: ['Failure and OFF state cannot be interpreted as safe evidence.'],
  }),
  frozenGate({
    id: 'P123',
    title: 'Concurrent observation safety',
    domain: 'concurrency',
    dependencies: ['P115'],
    requiredEvidence: ['Concurrent replay test', 'Scoped uniqueness assertion'],
    testStatus: 'PARTIAL',
    blockers: ['No concurrency test exists.'],
    safetyAssertions: ['Concurrent writes cannot create activation-capable output.'],
  }),
  frozenGate({
    id: 'P124',
    title: 'Source-run provenance is audit complete',
    domain: 'provenance',
    dependencies: ['P110', 'P115'],
    requiredEvidence: ['Source-run persistence test', 'Audit-registry evidence linkage'],
    testStatus: 'PARTIAL',
    blockers: ['No source-run provenance adversarial or replay test exists.'],
    safetyAssertions: ['Every observation is traceable to a non-claim source run.'],
  }),
  frozenGate({
    id: 'P125',
    title: 'Fixture evidence is never provider or economic evidence',
    domain: 'test-data boundary',
    dependencies: ['P120'],
    requiredEvidence: ['Fixture-origin classification policy', 'Fixture escalation denial test'],
    testStatus: 'NOT_IMPLEMENTED',
    blockers: ['No fixture-origin policy is implemented.'],
    safetyAssertions: ['Fixtures cannot prove provider semantics or financial truth.'],
  }),
  frozenGate({
    id: 'P126',
    title: 'Deterministic local safety suite',
    domain: 'local test environment',
    dependencies: ['P111', 'P113', 'P116', 'P117'],
    requiredEvidence: ['Focused isolated test suite', 'No-network/no-provider execution evidence'],
    testStatus: 'PARTIAL',
    blockers: ['No complete P110–P135 local safety suite yet exists.'],
    safetyAssertions: ['Certification tests use deterministic local fixtures only.'],
  }),
  frozenGate({
    id: 'P127',
    title: 'Dependency graph blocks unsafe promotion',
    domain: 'dependency graph',
    dependencies: ['P118', 'P120', 'P122'],
    requiredEvidence: ['Deterministic dependency graph', 'Failed-dependency propagation test'],
    testStatus: 'NOT_IMPLEMENTED',
    blockers: ['The registry defines dependencies, but no failed-dependency propagation test exists.'],
    safetyAssertions: ['A blocked prerequisite blocks downstream certification.'],
  }),
  frozenGate({
    id: 'P128',
    title: 'Configuration cannot bypass containment',
    domain: 'configuration safety',
    dependencies: ['P116', 'P122'],
    requiredEvidence: ['Configuration escape test', 'Legacy-path isolation test'],
    testStatus: 'NOT_IMPLEMENTED',
    blockers: ['No configuration adversarial test exists.'],
    safetyAssertions: ['No configuration state makes certification activate transfer work.'],
  }),
  frozenGate({
    id: 'P129',
    title: 'Ambiguous-evidence adversarial resistance',
    domain: 'adversarial testing',
    dependencies: ['P113'],
    requiredEvidence: ['Independent ambiguous-evidence attack test'],
    testStatus: 'PARTIAL',
    blockers: ['Existing unit case is not an independent adversarial gate.'],
    safetyAssertions: ['Ambiguity cannot produce a semantic, economic, or claim result.'],
  }),
  frozenGate({
    id: 'P130',
    title: 'Stale and replay-evidence adversarial resistance',
    domain: 'adversarial testing',
    dependencies: ['P114', 'P115'],
    requiredEvidence: ['Stale-evidence attack test', 'Replay attack test'],
    testStatus: 'NOT_IMPLEMENTED',
    blockers: ['Stale/replay adversarial coverage is absent.'],
    safetyAssertions: ['Stale or replayed evidence cannot become a safe result.'],
  }),
  frozenGate({
    id: 'P131',
    title: 'Cross-boundary adversarial resistance',
    domain: 'adversarial testing',
    dependencies: ['P112'],
    requiredEvidence: ['Tenant/store/marketplace boundary attack test'],
    testStatus: 'PASS',
    blockers: [],
    safetyAssertions: ['Evidence cannot cross tenant, store, or marketplace boundaries.'],
  }),
  frozenGate({
    id: 'P132',
    title: 'Semantic-to-economic and audit-to-activation resistance',
    domain: 'adversarial testing',
    dependencies: ['P118', 'P120', 'P121'],
    requiredEvidence: ['Semantic-to-economic attack test', 'Audit-to-activation attack test', 'Safe-to-detection/recovery attack test'],
    testStatus: 'NOT_IMPLEMENTED',
    blockers: ['No end-to-end adversarial separation suite exists.'],
    safetyAssertions: ['No safety output can become detection, claim, recovery, or financial truth.'],
  }),
  frozenGate({
    id: 'P133',
    title: 'Concurrency, retry, fallback, and configuration escape resistance',
    domain: 'adversarial testing',
    dependencies: ['P122', 'P123', 'P128'],
    requiredEvidence: ['Concurrency attack test', 'Retry/fallback attack test', 'Configuration escape test'],
    testStatus: 'NOT_IMPLEMENTED',
    blockers: ['No P133 adversarial test suite exists.'],
    safetyAssertions: ['No retry, fallback, race, or configuration may bypass containment.'],
  }),
  frozenGate({
    id: 'P134',
    title: 'Full local safety regression',
    domain: 'regression',
    dependencies: ['P110', 'P111', 'P112', 'P113', 'P114', 'P115', 'P116', 'P117', 'P118', 'P119', 'P120', 'P121', 'P122', 'P123', 'P124', 'P125', 'P126', 'P127', 'P128', 'P129', 'P130', 'P131', 'P132', 'P133'],
    requiredEvidence: ['Complete isolated local suite result', 'No-regression result'],
    testStatus: 'NOT_RUN',
    blockers: ['P110–P133 are not all passing and P134 has not run.'],
    safetyAssertions: ['Regression never triggers provider, transfer activation, economic output, or production mutation.'],
  }),
  frozenGate({
    id: 'P135',
    title: 'Independent deterministic certification registry',
    domain: 'certification',
    dependencies: ['P134'],
    requiredEvidence: ['Registry completeness test', 'Stable registry hash test', 'Independent verdict test'],
    testStatus: 'PARTIAL',
    blockers: ['Registry machinery is implemented locally but has not completed a passing P134/P135 execution.'],
    safetyAssertions: ['A certification verdict never activates transfer work or provider access.'],
  }),
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((output, key) => {
        output[key] = canonicalize((value as Record<string, unknown>)[key]);
        return output;
      }, {});
  }
  return value;
}

function hashCanonical(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function assertContractShape(definitions: readonly TransferLedgerP135GateDefinition[]): void {
  const actualIds = definitions.map((gate) => gate.id);
  if (actualIds.length !== expectedGateIds.length || actualIds.some((id, index) => id !== expectedGateIds[index])) {
    throw new Error(`P135 registry must contain exactly ${expectedGateIds.join(', ')} in order.`);
  }

  const known = new Set(actualIds);
  for (const gate of definitions) {
    if (!gate.title.trim() || !gate.domain.trim() || !gate.requiredEvidence.length || !gate.safetyAssertions.length) {
      throw new Error(`P135 gate ${gate.id} is missing required deterministic metadata.`);
    }
    if (new Set(gate.dependencies).size !== gate.dependencies.length) {
      throw new Error(`P135 gate ${gate.id} has duplicate dependencies.`);
    }
    if (gate.dependencies.some((dependency) => dependency === gate.id || !known.has(dependency))) {
      throw new Error(`P135 gate ${gate.id} has an invalid dependency.`);
    }
  }
}

function resolveDefinition(
  definition: TransferLedgerP135GateDefinition,
  override: Partial<Pick<TransferLedgerP135GateDefinition, 'testStatus' | 'blockers'>> | undefined,
): TransferLedgerP135Gate {
  const testStatus = override?.testStatus || definition.testStatus;
  const blockers = override?.blockers ? [...override.blockers] : [...definition.blockers];
  return Object.freeze({
    ...definition,
    blockers: Object.freeze(blockers),
    testStatus,
    verdict: testStatus === 'PASS' && blockers.length === 0 ? 'PASS' : 'BLOCKED',
  });
}

/**
 * Builds a deterministic local evidence report. A `CERTIFIED` result is a
 * documentation verdict only: all hard safety assertions remain OFF/NONE and
 * no caller receives any activation capability.
 */
export function buildTransferLedgerP135Registry(
  options: TransferLedgerP135RegistryOptions = {},
): TransferLedgerP135Registry {
  assertContractShape(transferLedgerP135GateDefinitions);

  const gates = Object.freeze(transferLedgerP135GateDefinitions.map((definition) =>
    resolveDefinition(definition, options.evidenceOverrides?.[definition.id]),
  ));
  const p134Gate = gates.find((gate) => gate.id === 'P134');
  const p134Status = options.p134Status || p134Gate?.testStatus || 'NOT_RUN';
  const blockers = Object.freeze(gates
    .filter((gate) => gate.verdict === 'BLOCKED')
    .flatMap((gate) => gate.blockers.length
      ? gate.blockers.map((blocker) => `${gate.id}: ${blocker}`)
      : [`${gate.id}: test status is ${gate.testStatus}.`]),
  );
  const verdict: TransferLedgerCertificationVerdict = p134Status === 'PASS' && blockers.length === 0
    ? 'CERTIFIED'
    : 'NOT_CERTIFIED';

  const payload = {
    schemaVersion: 'transfer-ledger-p135-v1' as const,
    gates,
    p134Status,
    blockers,
    safetyAssertions: globalSafetyAssertions,
    verdict,
  };

  return Object.freeze({
    ...payload,
    registryHash: hashCanonical(payload),
  });
}

export function getExpectedTransferLedgerGateIds(): readonly TransferLedgerGateId[] {
  return expectedGateIds;
}

export const transferLedgerP135AuditRegistry = buildTransferLedgerP135Registry();
export default transferLedgerP135AuditRegistry;
