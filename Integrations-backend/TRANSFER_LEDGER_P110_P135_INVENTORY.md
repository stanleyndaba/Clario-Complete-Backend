# Transfer-Ledger P110–P135 Inventory

**Scope.** This inventory is a local, source-and-test review of revision `d6610c60`. It does not run a migration, connect to a provider, use Redis, invoke a live transfer flow, or activate a feature. The user instruction identifies P110–P135 as the certification contract, but no pre-existing repository or uploaded artifact defines the individual P110–P128 gate texts. Consequently, the registry must record their explicit local definitions and not represent them as inherited facts.

## Named-artifact inventory

| Artifact | Current state | Evidence classification | Certification implication |
|---|---|---|---|
| `src/services/transferLedgerObservationService.ts` | Present. Reads persisted `inventory_ledger_events` scoped by tenant, user, store, and sync. It accepts only normalized exact `WhseTransfers`, preserves source facts, records ambiguity/unpaired states, and returns `claimCapable: false`. | **VERIFIED by source and local unit tests** | Strong observation-only foundation. |
| `tests/services/transferLedgerObservationService.test.ts` | Present. Covers exact taxonomy, zero qualifying data, unsupported transfer-like terms, ambiguity, unpaired evidence, partial history, query failure, tenant/store/sync scope, and no direct claim-table writes. | **VERIFIED by source** | Does not cover replay, staleness, concurrency, configuration, or integration separation. |
| `src/services/transferLedgerSemanticEvidence.ts` | Absent. | **VERIFIED absent** | Provider semantic interpretation is not implemented or certified. |
| `src/services/detection/core/detectors/warehouseTransferLossAlgorithm.ts` | Present. Legacy detection path derives route/loss/valuation and can write `detection_results`; it can recommend `file_claim`. | **VERIFIED by source** | It is an activation-capable legacy path and must be explicitly separated from the shadow observation rail. |
| `src/services/detection/algorithms/warehouseTransferLossAlgorithm.ts` | Present as a re-export only. | **VERIFIED by source** | No independent safety boundary. |
| `src/services/recoveryFinancialTruthService.ts` | Present. Reads dispute/detection and financial-event data to calculate payment truth. It contains no `transfer_ledger`, `WhseTransfers`, or `inventory_transfers` reference. | **VERIFIED by source** | No current direct transfer-ledger input; dedicated separation test is still missing. |
| `src/services/transferLedgerShadowEligibility.ts` | Absent. | **VERIFIED absent** | No explicit eligibility policy implementation exists. |
| `scripts/apply-transfer-ledger-reconciliation-133.ts` | Present. Requires exact apply confirmation and a hard-coded approved target, validates schema/flag state before and after apply, and refuses divergence. | **VERIFIED by source and local guard tests** | Must never be run in this certification task. |
| `src/services/transferLedgerCatalogChangeExecution.ts` | Absent. | **VERIFIED absent** | No catalog-change execution boundary exists. |
| `src/services/transferLedgerP135AuditRegistry.ts` | Absent. | **VERIFIED absent** | Required implementation gap. |
| `tests/services/transferLedgerP135AuditRegistry.test.ts` | Absent. | **VERIFIED absent** | Required test gap. |
| `migrations/133_reconcile_transfer_ledger_observation_rail.sql` | Present. Creates source-run and observation tables, immutable-fingerprint identities, constrained observation states, and an explicitly OFF zero-rollout non-claim flag. | **VERIFIED by source and local SQL contract tests** | Schema contract exists but is not Gate-1 runtime evidence. |

## Current execution-path findings

The observation service is invoked by Agent 2 only when the `connected_transfer_ledger_observation` feature flag is **enabled** and its mode is exactly `SHADOW`. Migration 133 sets that flag to disabled, zero rollout, and `claim_capable:false`. The observation service imports no legacy detector or financial-truth service.

A separate legacy warehouse-transfer detector remains callable through the enhanced detection service and can write detection records with economic values and a `file_claim` recommendation. This is a real architectural distinction: it does not prove the observation rail can activate, but it prevents any blanket statement that the repository has no activation-capable transfer path.

## Locked local registry contract proposal

The P135 registry will use exactly P110–P135 and no additional gate identifiers. P110–P128 are local explicit definitions required because no prior definitions were found; P129–P135 follow the stated attack, regression, and certification requirements.

| Gate | Local definition | Current evidence status |
|---|---|---|
| P110 | Preserved-source observation only; no provider acquisition, reconstruction, or claim output. | **PARTIAL** — unit coverage exists. |
| P111 | Exact provider taxonomy only; non-exact transfer-like terms fail closed. | **PASS (focused unit evidence)** |
| P112 | Tenant, user, store, marketplace, and sync boundaries are preserved. | **PASS (focused local adversarial evidence)** — a same-tenant/store/sync cross-marketplace row initially bypassed the query, was reproduced by a red test, then blocked by an explicit `marketplace_id` query predicate and passing regression. |
| P113 | Ambiguous/unpaired records remain non-semantic and non-economic. | **PASS (focused unit evidence)** |
| P114 | Partial/stale/failed source history remains non-clean and non-promotable. | **PARTIAL** — partial and query failure are covered; staleness policy is absent. |
| P115 | Replay/idempotency keeps provider facts isolated without semantic promotion. | **PARTIAL** — schema fingerprint identity exists; replay test is absent. |
| P116 | Observation-only schema and feature flag remain explicitly OFF and non-claim-capable. | **PASS (SQL contract evidence)** |
| P117 | Controlled migration apply is explicit, target-limited, and divergence-failing. | **PASS (focused guard evidence)** |
| P118 | Observation rail cannot enter legacy detection, catalog, recovery, or financial-truth paths. | **PARTIAL** — source separation observed; dedicated adversarial test absent. |
| P119 | Shadow eligibility is explicit and fail-closed. | **FAIL / NOT_IMPLEMENTED** — required module is absent. |
| P120 | Semantic evidence cannot become economic evidence without a distinct controlled path. | **PARTIAL** — semantic module absent and legacy detector is separate, but no contract test proves non-flow. |
| P121 | Catalog/activation execution remains unavailable from the observation rail. | **PARTIAL** — named catalog module is absent; no negative contract test. |
| P122 | Retry, fallback, and configuration cannot bypass a failed dependency or OFF state. | **NOT_IMPLEMENTED** — no dedicated contract test. |
| P123 | Concurrent writes preserve scope/fingerprint integrity and cannot activate output. | **PARTIAL** — unique indexes exist; no concurrency test. |
| P124 | Source-run provenance and audit metadata remain complete and non-claim-capable. | **PARTIAL** — source-run persistence exists and the audit registry is implemented, but provenance replay/adversarial coverage is absent. |
| P125 | Fixture-only test data cannot be represented as provider or economic evidence. | **NOT_IMPLEMENTED** — no fixture classification policy. |
| P126 | Local deterministic tests cover the observation and migration boundaries. | **PARTIAL** — focused tests exist, no full safety suite. |
| P127 | The dependency graph does not permit failed inputs to become safe outputs. | **NOT_IMPLEMENTED** — the P135 registry now declares the graph, but failed-dependency propagation coverage is absent. |
| P128 | Configuration cannot silently enable the shadow rail or a legacy activation path. | **NOT_IMPLEMENTED** — no configuration adversarial test. |
| P129 | Ambiguous evidence attack resistance. | **PARTIAL** — unit test exists; independent adversarial assertion absent. |
| P130 | Stale and replay evidence attack resistance. | **NOT_IMPLEMENTED** |
| P131 | Cross-tenant/store/marketplace boundary attack resistance. | **PASS (focused local adversarial evidence)** — the cross-marketplace attack was reproduced before remediation and passes after the marketplace predicate was added. |
| P132 | Semantic-to-economic, audit-to-activation, and safe-to-detection/recovery escape resistance. | **NOT_IMPLEMENTED** |
| P133 | Concurrency, retry/fallback, and configuration escape resistance. | **NOT_IMPLEMENTED** |
| P134 | Full isolated local regression gate. | **NOT_RUN** |
| P135 | Independent deterministic registry, hash, evidence, blocker, and verdict. | **PARTIAL** — the pure local registry and seven deterministic tests are implemented; its current evidence-driven verdict remains `NOT_CERTIFIED` because P134 and multiple prerequisite gates are unresolved. |

## Adversarial finding and remediation

A focused local P131 attack added an `inventory_ledger_events` fixture with the same tenant, user, store, and sync identifiers but a different marketplace. The first run failed: the observation count was `2` instead of the required `1`. This proved that the original query did not bind `marketplace_id`. The service was corrected to require `.eq('marketplace_id', input.marketplaceId)`, and the same nine-test observation suite then passed. No provider, database, Redis, production, or activation path was contacted during either run.

## Immediate conclusion

The source rail and migration safety controls are real, and the deterministic P135 registry now exists, but the P110–P135 certification contract remains incomplete. Its current truthful verdict must remain **NOT_CERTIFIED** until the missing gate implementations and adversarial evidence exist. This is a local safety determination only; it must not activate a transfer flow, call a provider, mutate production, or produce economic output.
