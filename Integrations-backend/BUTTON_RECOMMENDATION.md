You are now performing **PHASE 3.5 — FINANCIAL SAFETY HARDENING** for a production financial recovery platform.

This is NOT a redesign.
This is NOT a scale optimization pass.
This is NOT a generic audit.

This is a **surgical integrity repair mission**.

---

# NORTH STAR

The system must NEVER:

- delete live financial truth
- duplicate money
- duplicate filings
- corrupt cross-table state
- continue when financial safety cannot be verified

Even under retries, outages, or load.

---

# VERIFIED CRITICAL FAILURES

These are already confirmed and are the ONLY scope for this sprint:

## Failure 1 — Destructive sync cleanup
File:
- `syncJobManager.ts`

Observed:
- starting a sync can delete:
  - `detection_results`
  - `dispute_cases`
  - `recoveries`
for the user

This is existentially unsafe.

Required outcome:
- starting a sync must never delete live financial truth

---

## Failure 2 — Duplicate recovery truth
Files:
- `recoveriesService.ts`
- `015_recoveries_worker.sql`
(and any related migrations/schema paths)

Observed:
- recovery reconciliation can insert duplicate recovery rows
- no DB-level uniqueness on reimbursement/dispute identity

Required outcome:
- the same reimbursement / payout truth cannot be inserted twice

---

## Failure 3 — Fail-open duplicate filing / already-reimbursed checks
File:
- `refundFilingWorker.ts`
(and any adjacent filing safety paths)

Observed:
- duplicate-claim and already-reimbursed checks can fail open on:
  - lookup failure
  - missing order identifiers
  - query errors

Required outcome:
- if filing safety cannot be verified, the system must fail CLOSED

---

## Failure 4 — Non-atomic financial writes
Files likely involved:
- `AmazonSubmissionAutomator.ts`
- `refundFilingService.ts`
- `recoveriesService.ts`
- billing/submission/dispute write paths
- any tenant-scoped DB client wrappers

Observed:
- multi-step financial writes can partially succeed across:
  - `dispute_submissions`
  - `dispute_cases`
  - `recoveries`
  - billing tables

Required outcome:
- financial state transitions must be atomic or compensated safely

---

# YOUR TASK

Fix all four failures with the **smallest possible set of changes**.

No redesign.
No broad architecture rewrite.
No abstractions unless absolutely required.

Patch only what is necessary to make the system safe for controlled production exposure.

---

# REQUIRED PATCH SCOPE

## PATCH 1 — Remove destructive sync behavior

Inspect:
- `syncJobManager.ts`
- any helper invoked at sync start
- any cleanup path tied to sync restart / resync / replacement sync

Required fix:
- remove hard deletion of live financial truth
OR
- hard-gate it behind an explicit non-production/manual destructive maintenance mode
OR
- replace with safe archival / scoped invalidation if already very local

Rules:
- default runtime behavior must never delete detections, disputes, or recoveries
- sync start must preserve financial traceability

Goal:
- sync can restart safely without erasing money-related truth

---

## PATCH 2 — Enforce recovery idempotency at DB level

Inspect:
- `recoveriesService.ts`
- schema/migration for `recoveries`
- reconciliation worker logic
- recovery creation/upsert paths

Required fix:
- add DB-level uniqueness that prevents duplicate payout truth

Acceptable examples:
- unique on `amazon_reimbursement_id` when present
- unique on one-live-recovery-per-dispute where appropriate
- partial indexes if necessary
- upsert-on-conflict logic aligned to the uniqueness rule

Rules:
- app-layer checks alone are NOT enough
- same payout cannot create multiple live recovery rows

Goal:
- duplicate recovery insertion is impossible at the DB level

---

## PATCH 3 — Make filing safety checks fail CLOSED

Inspect:
- `refundFilingWorker.ts`
- already-reimbursed checks
- duplicate filing checks
- order identifier lookup paths
- query error handling / fallback branches

Required fix:
- if duplicate safety cannot be verified:
  - do not file
  - quarantine / retry / mark for review
  - emit truthful reason

Examples:
- lookup error → `pending_safety_verification` or equivalent
- missing identifiers → no auto-submit
- reimbursement verification unavailable → hold, not proceed

Rules:
- never continue to filing on uncertainty
- no fail-open money behavior

Goal:
- duplicate filing risk becomes fail-closed

---

## PATCH 4 — Make financial writes atomic or safely compensated

Inspect:
- submission creation path
- dispute case status transition path
- recovery insertion path
- billing insertion/charge path
- any multi-table write sequences

Required fix:
Choose the smallest truthful repair for each critical write chain:

Option A:
- wrap in DB transaction / RPC where feasible

Option B:
- if true transaction is hard across boundaries, add explicit compensating logic and durable failure marking so partial success cannot masquerade as success

Rules:
- success must mean whole financial transition succeeded
- partial write must surface explicitly and be recoverable
- no silent half-commits

Priority chains:
1. filing submission writes
2. recovery reconciliation writes
3. billing write path linked to recovery

Goal:
- financial tables cannot silently diverge during critical writes

---

# REQUIRED OUTPUT FORMAT

## 1. Executive Verdict
State:
- FIXED
- PARTIAL
- FAILED

Then 4–6 bullets only.

## 2. Patch 1 — Sync Safety
Explain:
- root cause
- file/function changed
- what destructive path was removed or gated
- new runtime behavior

## 3. Patch 2 — Recovery Idempotency
Explain:
- schema/migration changes
- service logic changes
- exact uniqueness rule now enforced
- how duplicates are prevented in runtime

## 4. Patch 3 — Filing Fail-Closed Safety
Explain:
- exact checks changed
- what used to fail open
- what now happens on uncertainty/query failure/missing identifiers

## 5. Patch 4 — Atomic / Compensated Financial Writes
Explain:
- exact file/function/path changed
- which write chains are now transactional or compensated
- how partial success is surfaced

## 6. New Runtime Semantics
State clearly:
- what happens when sync starts
- what happens on duplicate reimbursement attempt
- what happens when filing safety cannot be verified
- what happens when a multi-step financial write partially fails

## 7. Verification
Show:
- build/test output if available
- migration sanity
- static/runtime reasoning
- any safe proof performed

## 8. Anything Still Unresolved
List only real remaining financial-safety gaps after these patches.

## 9. Final Statement
End with one sentence only:

Either:
- “The system is now materially safer for controlled production exposure.”
or
- “The system is still not materially safe enough for controlled production exposure.”