# P110–P135 Local Transfer-Ledger Certification Report

**Assessment scope:** local source review and deterministic Jest/TypeScript execution only.  
**Workspace baseline:** certification branch working tree based on revision `d6610c60`.  
**Assessment result:** **NOT_CERTIFIED**.

> The certification registry is an evidence recorder, not an activation mechanism. Its generated safety assertions remain: **Transfer activation OFF; provider access NONE; economic output NONE; production mutation NONE.**

## 1. Scope and operating boundary

This work implemented and exercised only the local transfer-ledger certification machinery. It did not run a migration, start an API or worker, access a provider, inspect seller/customer records, use Redis, access a live transfer, change a feature flag, create a detection, produce an economic value, or mutate production.

The requested P110–P135 identifiers were not previously defined as a complete contract in the repository or supplied instruction artifacts. The new registry therefore locks exactly those identifiers as an explicit local contract and records missing evidence as blockers rather than silently treating it as passed.

## 2. Implemented changes

| Change | Evidence classification | Purpose |
|---|---|---|
| `src/services/transferLedgerP135AuditRegistry.ts` | **VERIFIED locally** | Pure deterministic P110–P135 registry containing each gate’s title, domain, dependencies, evidence requirements, test status, blockers, safety assertions, verdict, and SHA-256 registry hash. It has no database, provider, queue, detector, recovery, or activation import. |
| `tests/services/transferLedgerP135AuditRegistry.test.ts` | **VERIFIED locally** | Seven tests for exact gate coverage, dependency metadata validity, truthful default verdict, hash stability, evidence override behavior, and permanent OFF/NONE safety assertions. |
| `scripts/run-transfer-ledger-p135-local-certification.ts` | **VERIFIED locally** | Pure local renderer for the independent P135 evidence artifact. |
| `src/services/transferLedgerObservationService.ts` | **VERIFIED locally** | Corrected a marketplace-boundary omission by adding the `marketplace_id` predicate to the persisted Ledger query. |
| `tests/services/transferLedgerObservationService.test.ts` | **VERIFIED locally** | Extended the scope attack to include a same-tenant, same-user, same-store, same-sync record from a different marketplace. |
| `TRANSFER_LEDGER_P110_P135_INVENTORY.md` | **VERIFIED locally** | Evidence-classified inventory of the named artifacts, present behavior, absences, and contract status. |

## 3. Adversarial finding: P131 marketplace boundary

The new P131 test intentionally supplied two otherwise matching Ledger rows: one from the requested marketplace and one from a different marketplace. Before remediation, the test failed because the service returned **2 observations where 1 was required**. This was a real local containment contradiction: the query scoped tenant, user, store, and sync, but not marketplace.

The remediation added the explicit persisted-source predicate `marketplace_id = input.marketplaceId`. The same attack then passed in the nine-test observation suite. This repair affects only observation selection; it does not enable the flag, invoke the legacy transfer detector, add provider access, or produce economic output.

| Attack result | Before remediation | After remediation |
|---|---:|---:|
| Same tenant/user/store/sync, different marketplace observed | **Failed** — 2 rows accepted | **Passed** — only the requested marketplace row accepted |
| Transfer activation | OFF | OFF |
| Provider/data action | NONE | NONE |

## 4. Local test and build evidence

The bounded local assessment compiled the backend and ran only the deterministic suites relevant to the present observation/migration/registry boundary.

| Check | Result | Evidence classification |
|---|---|---|
| TypeScript build (`npm run build`) | PASS | **VERIFIED locally** |
| Observation service suite | PASS — 9 tests | **VERIFIED locally** |
| Migration 133 SQL contract suite | PASS | **VERIFIED locally** |
| Controlled reconciliation apply-guard suite | PASS | **VERIFIED locally** |
| P135 registry suite | PASS — 7 tests | **VERIFIED locally** |
| Bounded regression total | PASS — 4 suites, 24 tests | **VERIFIED locally** |
| Independent P135 renderer | Produced deterministic evidence JSON | **VERIFIED locally** |

The local tests inject a mock database into the observation service. The test code did not execute a provider call, migration, queue operation, feature-flag mutation, Redis operation, or live transfer flow.

## 5. Current P110–P135 gate matrix

| Gate status | Gates | Meaning |
|---|---|---|
| **PASS** | P111, P112, P113, P116, P117, P131 | Focused local evidence exists for exact taxonomy, scope isolation including the repaired marketplace attack, ambiguity/unpaired containment, OFF schema flag, apply guard, and cross-boundary attack resistance. |
| **PARTIAL** | P110, P114, P115, P118, P120, P121, P123, P124, P126, P129, P135 | Source and/or focused tests exist, but adversarial, integration, replay, freshness, provenance, or full-suite evidence remains incomplete. |
| **NOT_IMPLEMENTED** | P119, P122, P125, P127, P128, P130, P132, P133 | Required policy/module/test machinery is absent. |
| **NOT_RUN** | P134 | The full local safety system cannot truthfully run as PASS while prerequisite gates remain incomplete. |

## 6. Independent P135 determination

The independent renderer produced this determination:

```text
VERDICT: NOT_CERTIFIED
P134: NOT_RUN
Transfer activation: OFF
Provider access: NONE
Economic output: NONE
Production mutation: NONE
Registry hash: fde403019202342033ab274c1192d32d2a0bb0154379263b26d53536c433dcdf
```

The material blockers are not hand-waved: explicit stale/replay policy and attacks are missing; the required shadow-eligibility module is absent; semantic-to-economic and audit-to-activation separation lack dedicated adversarial proof; concurrency, retry/fallback, configuration, fixture-origin, provenance, and dependency-propagation controls remain unimplemented or untested; and P134 cannot therefore be marked PASS.

## 7. Required next decision

No deployment or activation decision follows from this report. The next safe implementation decision is to address **one bounded unresolved gate at a time**, beginning with a fail-closed `transferLedgerShadowEligibility.ts` policy and its isolated denial-first tests, or with explicit stale/replay evidence controls. Either path must be locally tested, added to the registry evidence, and rerun through P135 before any provider-semantic or deployment-stage discussion.

Until then, the only truthful state is **NOT_CERTIFIED**. The observation rail remains separate from the legacy activation-capable warehouse-transfer detector, and that separation itself still requires more adversarial evidence before P132/P133 can clear.

## Supporting artifacts

| Artifact | Role |
|---|---|
| `TRANSFER_LEDGER_P110_P135_INVENTORY.md` | Current codebase/artifact inventory and initial contract mapping. |
| `P135_LOCAL_CERTIFICATION_EVIDENCE.json` | Generated machine-readable P135 verdict, blockers, safety assertions, gate outcomes, and registry hash. |
| `src/services/transferLedgerP135AuditRegistry.ts` | Deterministic local P135 source of truth. |
| `tests/services/transferLedgerP135AuditRegistry.test.ts` | Registry test evidence. |
| `tests/services/transferLedgerObservationService.test.ts` | Includes the P131 marketplace-boundary attack and regression test. |
