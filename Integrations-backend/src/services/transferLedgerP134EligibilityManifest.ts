import crypto from 'crypto';

export const TRANSFER_P110_P133_MANIFEST_VERSION = '1.0.0';

export type P110P133GateId =
  | 'P110' | 'P111' | 'P112' | 'P113' | 'P114' | 'P115' | 'P116' | 'P117'
  | 'P118' | 'P119' | 'P120' | 'P121' | 'P122' | 'P123' | 'P124' | 'P125'
  | 'P126' | 'P127' | 'P128' | 'P129' | 'P130' | 'P131' | 'P132' | 'P133';

export type P110P133EvidenceState = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';
export type P134EligibilityState = 'ELIGIBLE_TO_RUN' | 'NOT_RUN';

export interface P110P133SafetySnapshot {
  transferEnabled: false;
  rolloutPercentage: 0;
  mode: 'OFF';
  claimCapable: false;
  providerTouched: false;
  productionTouched: false;
  observationInvoked: false;
  detectorInvoked: false;
  catalogExecuted: false;
  claimCreated: false;
  recoveryCreated: false;
  financialTruthInvoked: false;
  economicValueCalculated: false;
  p3OverrideAuthorized: false;
  liveP5CatalogMutated: false;
}

export interface P110P133GateDefinition {
  id: P110P133GateId;
  title: string;
  sourcePaths: readonly string[];
  testIdentifiers: readonly string[];
  requiresProviderSemanticResolution: boolean;
  invariant: string;
}

export interface P110P133EvidenceRecord {
  gateId: P110P133GateId;
  state: P110P133EvidenceState;
  sourceRevision: string;
  testIdentifier: string;
  testResultHash: string;
  observedAt: string;
  reason: string;
  evidenceId: string;
  deterministicHash: string;
}

export interface P110P133GateEvaluation {
  gateId: P110P133GateId;
  state: P110P133EvidenceState;
  reasonCodes: string[];
  evidenceId: string | null;
}

export interface P134EligibilityResult {
  manifestVersion: string;
  manifestHash: string;
  state: P134EligibilityState;
  eligible: false;
  reasonCodes: string[];
  gateEvaluations: readonly P110P133GateEvaluation[];
  safetySnapshot: P110P133SafetySnapshot;
  transferActivationAuthorized: false;
  detectorAuthorized: false;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
  detectorResult: null;
}

const allGateIds: readonly P110P133GateId[] = [
  'P110', 'P111', 'P112', 'P113', 'P114', 'P115', 'P116', 'P117',
  'P118', 'P119', 'P120', 'P121', 'P122', 'P123', 'P124', 'P125',
  'P126', 'P127', 'P128', 'P129', 'P130', 'P131', 'P132', 'P133',
] as const;

const test = (file: string, name: string): string => `${file}::${name}`;

/**
 * This manifest maps every P110–P133 requirement to existing implementation
 * and independently executed deterministic test evidence. It does not create
 * evidence; callers must supply a signed/hash-bound record after a real test
 * execution against the exact source revision.
 */
export const TRANSFER_P110_P133_EVIDENCE_MANIFEST: readonly P110P133GateDefinition[] = Object.freeze([
  {
    id: 'P110', title: 'Independent no-provider observation execution proof',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerObservationService.test.ts', 'preserves an exact WhseTransfers event as a non-claim observation')],
    requiresProviderSemanticResolution: false,
    invariant: 'A persisted-ledger observation remains local, zero-claim, and non-economic without provider acquisition.',
  },
  {
    id: 'P111', title: 'Exact provider taxonomy',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerObservationService.test.ts', 'accepts only exact WhseTransfers taxonomy with defensive casing and whitespace')],
    requiresProviderSemanticResolution: false,
    invariant: 'Only exact normalized WhseTransfers taxonomy can enter the raw observation rail.',
  },
  {
    id: 'P112', title: 'Tenant, user, store, sync, and marketplace scope isolation',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [
      test('tests/services/transferLedgerObservationService.test.ts', 'keeps tenant, store, and parent sync scopes isolated and never touches claim paths'),
      test('tests/services/transferLedgerObservationService.test.ts', 'rejects a same-tenant/store/sync row from another marketplace instead of relabelling it into the requested scope'),
    ],
    requiresProviderSemanticResolution: false,
    invariant: 'An observation query cannot cross tenant, user, store, sync, or marketplace scope.',
  },
  {
    id: 'P113', title: 'Ambiguity and unpaired containment',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [
      test('tests/services/transferLedgerObservationService.test.ts', 'marks same-reference observations ambiguous and never promotes an exact pair'),
      test('tests/services/transferLedgerObservationService.test.ts', 'records an unreferenced raw event as unpaired without inferring transfer direction or loss'),
    ],
    requiresProviderSemanticResolution: false,
    invariant: 'Ambiguous or unpaired raw rows cannot become a transfer fact, claim, or value.',
  },
  {
    id: 'P114', title: 'Stale and incomplete-history containment',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [
      test('tests/services/transferLedgerObservationService.test.ts', 'marks stale full-history evidence as stale rather than clean and preserves the zero-claim boundary'),
      test('tests/services/transferLedgerObservationService.test.ts', 'contains unknown history as incomplete evidence instead of silently treating it as clean'),
    ],
    requiresProviderSemanticResolution: false,
    invariant: 'Stale or incomplete source history cannot present as clean/promotable evidence.',
  },
  {
    id: 'P115', title: 'Deterministic replay and source fingerprint',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerObservationService.test.ts', 'gives exact fixture replays the same deterministic source fingerprint while retaining distinct attempt IDs')],
    requiresProviderSemanticResolution: false,
    invariant: 'Equivalent source scope/content has a stable fingerprint without turning retry attempts into semantic promotion.',
  },
  {
    id: 'P116', title: 'Observation schema and OFF configuration safety',
    sourcePaths: ['migrations/133_reconcile_transfer_ledger_observation_rail.sql', 'src/services/transferLedgerShadowEligibility.ts'],
    testIdentifiers: [
      test('tests/scripts/transferLedgerReconciliationMigration.test.ts', 'forces the Transfer flag to an explicit disabled, zero-rollout, zero-claim contract'),
      test('tests/services/transferLedgerShadowEligibility.test.ts', 'keeps the certified production OFF result ineligible and zero-claim'),
    ],
    requiresProviderSemanticResolution: false,
    invariant: 'Schema and flags preserve OFF/zero-rollout/zero-claim state.',
  },
  {
    id: 'P117', title: 'Controlled migration apply guard',
    sourcePaths: ['scripts/apply-transfer-ledger-reconciliation-133.ts'],
    testIdentifiers: [test('tests/scripts/transferReconciliationApplyGuard.test.ts', 'accepts only the approved Neon host and database target')],
    requiresProviderSemanticResolution: false,
    invariant: 'Migration application is target-bound, confirmation-bound, and outside this local audit path.',
  },
  {
    id: 'P118', title: 'Observation to legacy-detector/recovery/financial separation',
    sourcePaths: ['src/services/agent2DataSyncService.ts', 'src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerShadowExecutionBoundary.test.ts', 'allows only the exact zero-claim SHADOW contract to invoke the observer with persisted-ledger provenance')],
    requiresProviderSemanticResolution: false,
    invariant: 'The real Agent 2 handoff has no detector, recovery, financial-truth, claim, or economic dependency.',
  },
  {
    id: 'P119', title: 'Fail-closed SHADOW eligibility',
    sourcePaths: ['src/services/transferLedgerShadowEligibility.ts'],
    testIdentifiers: [
      test('tests/services/transferLedgerShadowEligibility.test.ts', 'rejects a missing or unsafe claim-capability declaration'),
      test('tests/services/transferLedgerShadowEligibility.test.ts', 'rejects an unsupported or absent observation version'),
    ],
    requiresProviderSemanticResolution: false,
    invariant: 'Only exact SHADOW + boolean false claim capability + v1 observation can call the observer.',
  },
  {
    id: 'P120', title: 'Semantic evidence cannot become economic evidence',
    sourcePaths: ['src/services/transferLedgerSemanticEvidence.ts', 'src/services/transferLedgerProviderSemanticsCatalog.ts'],
    testIdentifiers: [test('tests/services/transferLedgerP135CrossGateAudit.test.ts', 'rejects a chronology, matching-ID, matching-quantity, and counterpart trap until P3 has independently verified provider semantics')],
    requiresProviderSemanticResolution: true,
    invariant: 'No local fixture or catalog representation can prove provider semantics or allow transfer economics.',
  },
  {
    id: 'P121', title: 'Catalog execution and activation boundary',
    sourcePaths: ['src/services/transferLedgerCatalogChangeExecution.ts', 'src/services/transferLedgerLocalCatalogReadPublication.ts'],
    testIdentifiers: [test('tests/services/transferLedgerLocalCatalogReadPublication.test.ts', 'is replay-deterministic and the local view cannot bypass P5 or P3')],
    requiresProviderSemanticResolution: false,
    invariant: 'Catalog review/publication is local, immutable, and never an activation path.',
  },
  {
    id: 'P122', title: 'Retry and fallback escape resistance',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerObservationService.test.ts', 'does not use an unsafe retry fallback after a failed source and allows only a later fresh persisted-ledger attempt')],
    requiresProviderSemanticResolution: false,
    invariant: 'Failed source attempts do not fall back into unsafe or economic behavior.',
  },
  {
    id: 'P123', title: 'Concurrent observation safety',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerObservationService.test.ts', 'keeps concurrent exact fixture replays deterministic, scope-bound, upsert-idempotent, and permanently non-economic')],
    requiresProviderSemanticResolution: false,
    invariant: 'Concurrent exact attempts retain scope/fingerprint consistency and zero economic output.',
  },
  {
    id: 'P124', title: 'Source-run provenance persistence and replay containment',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerObservationService.test.ts', 'gives exact fixture replays the same deterministic source fingerprint while retaining distinct attempt IDs')],
    requiresProviderSemanticResolution: false,
    invariant: 'Source-run metadata records origin, evidence state, and deterministic fingerprint.',
  },
  {
    id: 'P125', title: 'Fixture-origin separation',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerObservationService.test.ts', 'classifies unavailable source evidence without returning a promotable observation or provider-origin fixture claim')],
    requiresProviderSemanticResolution: false,
    invariant: 'Test fixture origin is explicit and cannot represent provider, production, or economic truth.',
  },
  {
    id: 'P126', title: 'Complete deterministic local regression evidence',
    sourcePaths: ['tests/scripts/transferLedgerReconciliationMigration.test.ts', 'tests/services/transferLedgerP135AuditRegistry.test.ts'],
    testIdentifiers: ['command:complete-local-transfer-regression'],
    requiresProviderSemanticResolution: false,
    invariant: 'The recorded regression command must pass against the exact source revision before P134 can be considered.',
  },
  {
    id: 'P127', title: 'Failed dependency propagation',
    sourcePaths: ['src/services/agent2DataSyncService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerShadowExecutionBoundary.test.ts', 'propagates a failed observation dependency without fallback, detector, claim, recovery, or economic output')],
    requiresProviderSemanticResolution: false,
    invariant: 'A failed observation dependency stops the handoff without a fallback activation route.',
  },
  {
    id: 'P128', title: 'Configuration adversarial resistance',
    sourcePaths: ['src/services/transferLedgerShadowEligibility.ts', 'src/services/agent2DataSyncService.ts'],
    testIdentifiers: [test('tests/services/transferLedgerShadowExecutionBoundary.test.ts', 'rejects unsafe or contradictory configuration without observing or activating: %o')],
    requiresProviderSemanticResolution: false,
    invariant: 'Contradictory, ON, unsafe, malformed, or version-mismatched configuration fails closed.',
  },
  {
    id: 'P129', title: 'Independent ambiguous-evidence adversarial containment',
    sourcePaths: ['src/services/transferLedgerSemanticEvidence.ts'],
    testIdentifiers: [test('tests/services/transferLedgerP135CrossGateAudit.test.ts', 'rejects cross-marketplace and duplicate-fingerprint counterpart attempts before any Transfer fact can be emitted')],
    requiresProviderSemanticResolution: false,
    invariant: 'Ambiguous, duplicate, or cross-marketplace candidates cannot create a transfer fact.',
  },
  {
    id: 'P130', title: 'Stale and replay adversarial containment',
    sourcePaths: ['src/services/transferLedgerObservationService.ts'],
    testIdentifiers: [
      test('tests/services/transferLedgerObservationService.test.ts', 'marks stale full-history evidence as stale rather than clean and preserves the zero-claim boundary'),
      test('tests/services/transferLedgerObservationService.test.ts', 'keeps concurrent exact fixture replays deterministic, scope-bound, upsert-idempotent, and permanently non-economic'),
    ],
    requiresProviderSemanticResolution: false,
    invariant: 'Stale/replayed source cannot be treated as fresh semantic or economic evidence.',
  },
  {
    id: 'P131', title: 'Cross-boundary adversarial resistance',
    sourcePaths: ['src/services/transferLedgerP135AuditRegistry.ts', 'src/services/transferLedgerSemanticEvidence.ts'],
    testIdentifiers: [test('tests/services/transferLedgerP135CrossGateAudit.test.ts', 'treats missing lifecycle, contradictory quantity, and partial history as non-economic unresolved states')],
    requiresProviderSemanticResolution: false,
    invariant: 'Composed malformed or contradictory local inputs do not cross semantic/economic boundaries.',
  },
  {
    id: 'P132', title: 'End-to-end audit-to-activation escape resistance',
    sourcePaths: ['src/services/agent2DataSyncService.ts', 'src/services/transferLedgerP135AuditRegistry.ts'],
    testIdentifiers: [test('tests/services/transferLedgerShadowExecutionBoundary.test.ts', 'is deterministic under concurrent exact SHADOW attempts and never converts observation results into activation output')],
    requiresProviderSemanticResolution: false,
    invariant: 'Observation/audit results cannot escape to detector, catalog, recovery, claim, or value output.',
  },
  {
    id: 'P133', title: 'Combined concurrency/retry/fallback/configuration resistance',
    sourcePaths: ['src/services/transferLedgerObservationService.ts', 'src/services/transferLedgerShadowEligibility.ts', 'src/services/agent2DataSyncService.ts'],
    testIdentifiers: [
      test('tests/services/transferLedgerObservationService.test.ts', 'keeps concurrent exact fixture replays deterministic, scope-bound, upsert-idempotent, and permanently non-economic'),
      test('tests/services/transferLedgerShadowExecutionBoundary.test.ts', 'rejects unsafe or contradictory configuration without observing or activating: %o'),
    ],
    requiresProviderSemanticResolution: false,
    invariant: 'Combined retry, concurrency, and malicious configuration inputs remain non-activating.',
  },
]);

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function isSourceRevision(value: string): boolean {
  return /^[a-f0-9]{40}$/.test(value) || /^workspace:[a-f0-9]{64}$/.test(value);
}

export function p110P133ManifestHash(
  manifest: readonly P110P133GateDefinition[] = TRANSFER_P110_P133_EVIDENCE_MANIFEST,
): string {
  return sha256(canonicalJson(manifest));
}

export function createP110P133EvidenceRecord(input: Omit<P110P133EvidenceRecord, 'evidenceId' | 'deterministicHash'>): P110P133EvidenceRecord {
  const evidenceId = sha256(canonicalJson({
    manifestVersion: TRANSFER_P110_P133_MANIFEST_VERSION,
    ...input,
  }));
  return { ...input, evidenceId, deterministicHash: evidenceId };
}

export function validateP110P133Manifest(
  manifest: readonly P110P133GateDefinition[] = TRANSFER_P110_P133_EVIDENCE_MANIFEST,
): { valid: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const ids = new Set<string>();
  for (const definition of manifest) {
    if (ids.has(definition.id)) reasonCodes.push(`DUPLICATE_GATE:${definition.id}`);
    ids.add(definition.id);
    if (!definition.sourcePaths.length) reasonCodes.push(`MISSING_SOURCE_PATHS:${definition.id}`);
    if (!definition.testIdentifiers.length) reasonCodes.push(`MISSING_TEST_IDENTIFIERS:${definition.id}`);
  }
  for (const id of allGateIds) {
    if (!ids.has(id)) reasonCodes.push(`MISSING_GATE:${id}`);
  }
  if (manifest.length !== allGateIds.length) reasonCodes.push('MANIFEST_MUST_CONTAIN_P110_THROUGH_P133');
  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)].sort() };
}

function unsafeSnapshot(snapshot: P110P133SafetySnapshot): boolean {
  return snapshot.transferEnabled
    || snapshot.rolloutPercentage !== 0
    || snapshot.mode !== 'OFF'
    || snapshot.claimCapable
    || snapshot.providerTouched
    || snapshot.productionTouched
    || snapshot.observationInvoked
    || snapshot.detectorInvoked
    || snapshot.catalogExecuted
    || snapshot.claimCreated
    || snapshot.recoveryCreated
    || snapshot.financialTruthInvoked
    || snapshot.economicValueCalculated
    || snapshot.p3OverrideAuthorized
    || snapshot.liveP5CatalogMutated;
}

/**
 * P134 is deliberately not executed here. This evaluator answers only whether
 * an exact, integrity-valid P110–P133 evidence set would be eligible to start
 * P134. It always returns eligible:false and contains no activation capability.
 */
export function evaluateP134Eligibility(args: {
  expectedSourceRevision: string;
  evidence: readonly P110P133EvidenceRecord[];
  safetySnapshot: P110P133SafetySnapshot;
  providerSemanticAuthorityAvailable: false;
  manifest?: readonly P110P133GateDefinition[];
}): P134EligibilityResult {
  const manifest = args.manifest || TRANSFER_P110_P133_EVIDENCE_MANIFEST;
  const manifestValidation = validateP110P133Manifest(manifest);
  const reasonCodes = [...manifestValidation.reasonCodes];
  const byGate = new Map<string, P110P133EvidenceRecord>();
  const duplicateGates = new Set<string>();

  if (!isSourceRevision(args.expectedSourceRevision)) reasonCodes.push('INVALID_EXPECTED_SOURCE_REVISION');
  for (const record of args.evidence) {
    if (byGate.has(record.gateId)) duplicateGates.add(record.gateId);
    const expectedEvidenceId = sha256(canonicalJson({
      manifestVersion: TRANSFER_P110_P133_MANIFEST_VERSION,
      gateId: record.gateId,
      state: record.state,
      sourceRevision: record.sourceRevision,
      testIdentifier: record.testIdentifier,
      testResultHash: record.testResultHash,
      observedAt: record.observedAt,
      reason: record.reason,
    }));
    if (record.evidenceId !== expectedEvidenceId || record.deterministicHash !== expectedEvidenceId) {
      reasonCodes.push(`EVIDENCE_HASH_MISMATCH:${record.gateId}`);
    }
    if (!isSha256(record.testResultHash)) reasonCodes.push(`INVALID_TEST_RESULT_HASH:${record.gateId}`);
    if (!isSourceRevision(record.sourceRevision) || record.sourceRevision !== args.expectedSourceRevision) {
      reasonCodes.push(`STALE_OR_MISMATCHED_SOURCE_REVISION:${record.gateId}`);
    }
    byGate.set(record.gateId, record);
  }
  for (const id of duplicateGates) reasonCodes.push(`DUPLICATE_EVIDENCE:${id}`);

  const gateEvaluations: P110P133GateEvaluation[] = manifest.map((definition) => {
    const record = byGate.get(definition.id);
    const gateReasonCodes: string[] = [];
    if (!record) {
      gateReasonCodes.push('MISSING_EVIDENCE');
    } else {
      if (record.state !== 'PASS') gateReasonCodes.push(`EVIDENCE_STATE_${record.state}`);
      if (!definition.testIdentifiers.includes(record.testIdentifier)) gateReasonCodes.push('UNMAPPED_TEST_IDENTIFIER');
      if (duplicateGates.has(definition.id)) gateReasonCodes.push('DUPLICATE_EVIDENCE');
      if (reasonCodes.includes(`EVIDENCE_HASH_MISMATCH:${definition.id}`)) gateReasonCodes.push('TAMPERED_EVIDENCE_HASH');
      if (reasonCodes.includes(`INVALID_TEST_RESULT_HASH:${definition.id}`)) gateReasonCodes.push('INVALID_TEST_RESULT_HASH');
      if (reasonCodes.includes(`STALE_OR_MISMATCHED_SOURCE_REVISION:${definition.id}`)) gateReasonCodes.push('STALE_OR_MISMATCHED_SOURCE_REVISION');
      if (definition.requiresProviderSemanticResolution && args.providerSemanticAuthorityAvailable === false) {
        gateReasonCodes.push('P3_PROVIDER_SEMANTICS_UNRESOLVED');
      }
    }
    return {
      gateId: definition.id,
      state: gateReasonCodes.length === 0 ? 'PASS' : 'BLOCKED',
      reasonCodes: gateReasonCodes.sort(),
      evidenceId: record?.evidenceId || null,
    };
  });

  if (unsafeSnapshot(args.safetySnapshot)) reasonCodes.push('TRANSFER_SAFETY_SNAPSHOT_UNSAFE');
  if (args.providerSemanticAuthorityAvailable !== false) reasonCodes.push('INVALID_PROVIDER_SEMANTIC_AUTHORITY_INPUT');
  if (gateEvaluations.some((evaluation) => evaluation.state !== 'PASS')) reasonCodes.push('P110_P133_EVIDENCE_INCOMPLETE_OR_BLOCKED');
  if (args.providerSemanticAuthorityAvailable === false) reasonCodes.push('P3_PROVIDER_SEMANTICS_UNRESOLVED');

  return {
    manifestVersion: TRANSFER_P110_P133_MANIFEST_VERSION,
    manifestHash: p110P133ManifestHash(manifest),
    state: 'NOT_RUN',
    eligible: false,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    gateEvaluations: Object.freeze(gateEvaluations),
    safetySnapshot: args.safetySnapshot,
    transferActivationAuthorized: false,
    detectorAuthorized: false,
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
    detectorResult: null,
  };
}
