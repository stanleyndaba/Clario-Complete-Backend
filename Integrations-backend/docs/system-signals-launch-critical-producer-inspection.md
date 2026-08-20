# System Signals Launch-Critical Producer Inspection

**Status:** Pre-implementation inspection completed before any producer wiring.

## Repository truth

| Repository | Local HEAD | `origin/main` | Working tree |
|---|---:|---:|---|
| Backend | `68fb056a` | `68fb056a` | Clean |
| Frontend | `fe70a9d8` | `fe70a9d8` | Clean |

The backend remains on the certified external-boundary baseline. The frontend contains that certified baseline plus the subsequently verified shared-toast presentation commit. The latest backend SQL migration is `126_align_agent7_filing_status_constraint.sql`; this pass requires **no schema migration**.

## Producer inspection matrix

| Event | Authoritative domain state exists? | Producer owner | Current persistence | Current user communication | Wire? |
|---|---|---|---|---|---|
| `audit.completed_findings` | Yes | `AuditRunService` for both `sp_api` and `csv_upload` runs | `audit_runs.status='completed'` plus persisted summary with `finalStatus` and findings | Audit results surface; no canonical signal | **WIRE** |
| `audit.completed_no_findings` | Yes | `AuditRunService` for both sources | Completed audit and persisted clean summary | Audit results surface; no canonical signal | **WIRE** |
| `audit.data_incomplete` | Partial state exists, but no authoritative seller-remediation lifecycle exists | `AuditRunService` persists limited completed results | Completed audit summary records unavailable sources / zero reviewed records | Audit results describe the limitation | **NO AUTHORITATIVE PRODUCER** for an action-required signal: current model has neither a per-audit data-supply transition nor a safe same-object resolution condition |
| `audit.failed_action_required` | No seller-action-required transition | `AuditRunService` records broad failures | `audit_runs.status='failed'` may represent worker, sync, or internal failure | Safe status text only | **NO AUTHORITATIVE PRODUCER**: failure does not reliably prove seller intervention is required |
| `audit.reentry_available` | Eligibility timestamp exists, but no eligibility-window transition owner exists | Commercial decision classifies 30-day eligibility | `audit_runs.next_eligible_at` | Results/history expose eligibility timing | **NO AUTHORITATIVE PRODUCER**: no scheduler-owned “became eligible” transition or one-per-window producer |
| `evidence.package_ready` | No durable package/version lifecycle | Evidence matching and proof snapshot helpers | Documents, matches, and proof snapshots only | Legacy evidence-found/update messages | **NO AUTHORITATIVE PRODUCER**: upload, parsing, matching, and worker completion are not package readiness |
| `evidence.certification_required` | No seller certification state machine | Evidence/case flows | Case evidence attachments and filing decisions | Existing case review and approval workflows | **NO AUTHORITATIVE PRODUCER**: no persisted seller-certification-required → certified transition |
| `evidence.collection_paused` | No tenant-scoped collection-paused episode | Source/admin settings only | Settings and source status, not a durable seller-impacting episode | None suitable | **NO AUTHORITATIVE PRODUCER** |
| `case.amazon_response_received` | Yes | `AmazonCaseThreadService` inbound ingestion | Dedupe-backed `case_messages` upsert, then tenant-scoped `dispute_cases` state application | Legacy thread/case notifications for material states | **WIRE** |
| `case.evidence_requested` | Yes | `AmazonCaseThreadService` | Unique inbound case message plus persisted `case_state='needs_evidence'` | Legacy urgent evidence-request notification | **WIRE** |
| `case.rejected` | Rejection state exists, but no post-review/reopen resolution lifecycle exists | `AmazonCaseThreadService` and polling worker | Persisted `dispute_cases.status/case_state='rejected'` | Legacy rejection notification | **NO AUTHORITATIVE PRODUCER** for an action-required canonical signal: current case-state ranking has no authoritative seller-resolution/reopen transition |
| `filing.failed` | Yes, at terminal retry exhaustion only | `RefundFilingWorker.handleFilingFailure` | Tenant-scoped case update to `filing_status='failed'`, `operational_state='FAILED_DURABLE'`, and durable error | Operational logs; no canonical signal | **WIRE** only after terminal failure, never for `retrying` |
| `integration.amazon.authentication_invalid` | Yes | Existing Amazon sync/auth path | Durable reconnect-required credential flow / certified signal path | Canonical signal already exists | **ALREADY WIRED** |
| `integration.amazon.sync_paused` | No outage-episode lifecycle | Token/sync layers | Individual sync and credential states only | Legacy sync state | **NO AUTHORITATIVE PRODUCER**: no durable outage episode distinct from auth invalidation |
| `integration.amazon.restored` | Active credentials are persisted, but not as closure of an identified outage episode | Token save/update paths | `credential_status='active'` clears reconnect fields | OAuth success / healthy requests | **NO AUTHORITATIVE PRODUCER**: an active write can be initial connect or refresh, so it cannot prove an outage ended |
| `integration.quickbooks.*` | Not inspected as a live provider episode for this pass | — | Registered definitions only | — | **REGISTERED — DEFERRED UNTIL PROVIDER ACTIVATION** |
| `integration.xero.*` | Not inspected as a live provider episode for this pass | — | Registered definitions only | — | **REGISTERED — DEFERRED UNTIL PROVIDER ACTIVATION** |

## Trust boundaries retained

The planned audit completion producers will run only after the final audit summary is persisted. They will use the audit run ID and the persisted final outcome as the transition identity. Manual-report audits retain `csv_upload` context and do not interact with Amazon connection producers.

Inbound Amazon case signals will use the durable upstream provider message ID that is already uniquely persisted on `(tenant_id, provider, provider_message_id)`. `case.evidence_requested` will be resolved only after an authenticated, tenant-scoped outbound Amazon reply with selected evidence attachments has been sent and persisted. Its route is the certified case-detail destination: `/app/:tenantSlug/cases/:caseId`.

The planned filing-failure producer will run only after the existing worker exhausts retry policy and persists `FAILED_DURABLE`; transient `retrying` updates remain silent. A later authoritative successful filing already persists `filing_status='filed'` before emitting `filing.submitted`; that transition will resolve open case-review failure signals for the same case.

## Frontend route support required

The certified resolver already routes a `dispute_case` action to `/app/:tenantSlug/cases/:caseId`. The only needed rendering correction is to provide a visible action label for the registered `review_evidence` action when the target is a case. No NotificationHub redesign is required.

## Planned implementation scope

1. Add a narrow audit-result producer helper inside the authoritative audit-run service and call it only after persisted completion/commercial outcome for both source types.
2. Replace only the material-state legacy case-thread notifications with canonical signals, preserving message-ID dedupe and resolving evidence-request signals after a persisted evidence reply.
3. Add `filing.failed` only at the worker’s already-defined terminal failure threshold, and resolve it when an authoritative `filed` transition succeeds.
4. Add focused truth tests for every wired event and the paired absent/duplicate cases.
5. Do not add migrations, new notification systems, channels, or any deferred provider-health producers.
