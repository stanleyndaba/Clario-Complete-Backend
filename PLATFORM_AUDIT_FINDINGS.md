# Platform Audit Findings

Date: 2026-04-21

## Executive Summary

This audit reviewed the platform from backend to frontend to understand what it is, what it does, what is real, what is legacy or mock, and why the current demo experience can show `$0.00`, empty states, or conservative labels.

The platform is a multi-tenant Amazon FBA recovery system, currently branded across the repository as Margin, Opside, and Clario. Its core purpose is to help Amazon sellers identify recoverable discrepancies, gather supporting evidence, prepare or track Amazon dispute cases, verify payout truth, and manage subscription billing.

The recent move toward truthful data display is directionally correct. The product now avoids inventing reimbursement, approval, payout, or billing outcomes when the backend cannot prove them. The demo problem is not that the platform has no value. The problem is that the demo tenant is under-seeded for the new truth model.

## What The Platform Is

The product is not only a dashboard. It is a full workflow platform for Amazon FBA discrepancy recovery.

The main workflow is:

1. A seller signs in and enters a tenant workspace.
2. The seller connects an Amazon account through OAuth/SP-API.
3. The backend stores tenant-scoped and store-scoped tokens.
4. The system syncs Amazon or uploaded CSV data.
5. Detection services identify possible recoveries and filing candidates.
6. Evidence services ingest, parse, and match documents from uploads, Gmail, Google Drive, Dropbox, Outlook, and related sources.
7. Dispute and filing services prepare or track Amazon cases.
8. Recovery services reconcile approval and payout truth.
9. Billing services show flat subscription billing truth.
10. Notification, admin, support, and learning systems support operations around the workflow.

## Verified Product Surface

The frontend contains a substantial tenant application, including:

- Public/legal/sales pages.
- Login and onboarding.
- Tenant dashboard.
- Sync/audit page.
- Integrations hub.
- Recoveries in motion.
- Filing pipeline.
- Approved reimbursements.
- Dispute queue.
- Case detail pages.
- Evidence locker and document detail pages.
- Notifications.
- Settings.
- Billing.
- Data upload.
- Learning insights.
- Admin pages.
- Queue/revenue/user integration admin tools.

The main route map lives in:

`opside-complete-frontend/src/App.tsx`

The Node backend mounts the main operational API surface, including:

- Amazon integration routes.
- Gmail, Outlook, Google Drive, Dropbox, and Stripe routes.
- Sync and SSE routes.
- Detection routes.
- Dispute and dispute-case queue routes.
- Evidence and document routes.
- CSV upload routes.
- Recovery routes.
- Billing routes.
- Notification routes.
- Product update and manual broadcast routes.
- Tenant, store, support, invite, and notes routes.
- Admin and metrics routes.

The main backend entrypoint is:

`Integrations-backend/src/index.ts`

## Verified Data Model

The database migrations show a real multi-tenant data model:

- Tenants and tenant memberships.
- Tenant-scoped stores.
- Tenant/store-scoped Amazon tokens.
- Orders, shipments, returns, settlements, inventory, and financial events.
- Detection results and detection queue state.
- Dispute cases and dispute submissions.
- Evidence sources, evidence documents, and evidence links.
- Recovery and billing records.
- Notifications and product updates.
- Manual user broadcasts.
- Email delivery events.

Important migrations include:

- `042_create_tenants_table.sql`
- `044_add_tenant_id_columns.sql`
- `060_data_pipeline_tables.sql`
- `063_create_csv_data_tables.sql`
- `076_create_demo_workspace.sql`
- `084_agent1_connection_truth.sql`
- `109_email_delivery_tracking.sql`

## Existing Demo Workspace

There is already a seeded isolated demo workspace:

`demo-workspace`

It is created in:

`Integrations-backend/migrations/076_create_demo_workspace.sql`

That migration seeds:

- A demo tenant.
- Detection results.
- Dispute cases.
- Evidence documents.
- Dispute/evidence links.
- A billing transaction.
- Read-only tenant status.

This is the right foundation for a launch demo, but it is currently named `Demo Workspace` and does not appear to be polished for the new truth-first UI.

The recommended demo identity is:

`Acme Operations`

## Why The UI Shows $0.00 Or Empty States

The current empty states are mostly a truth-model outcome.

For example, Approved Reimbursements does not count detection projections as approved reimbursements. It requires real dispute-case approval or verified payout truth. It also hides claim-amount fallbacks rather than presenting them as approved value.

That logic lives in:

`opside-complete-frontend/src/lib/approvedReimbursementTruth.ts`

Billing also now presents flat subscription truth. Recoveries are proof of product value, but they no longer create new charges. Missing provider, invoice, payment-link, or confirmation truth renders as unavailable rather than inferred paid state.

That behavior is visible in:

`opside-complete-frontend/src/pages/Billing.tsx`

This means `$0.00` can be truthful, but not demo-friendly.

## Real Capabilities Verified

The platform has evidence-backed capability in these areas:

- Multi-tenant workspaces.
- Tenant membership and role-aware access.
- Amazon OAuth and SP-API integration paths.
- Store-scoped Amazon token truth.
- Sync/audit flows with SSE updates.
- CSV ingestion for seller data.
- Detection results and detector coverage.
- Evidence ingestion from external sources.
- Document parsing and matching workflows.
- Dispute queue and case-detail workflows.
- Recovery ledger and financial truth modeling.
- Billing based on flat subscription truth.
- Notifications, product updates, and manual broadcasts.
- Resend webhook delivery tracking.
- Admin visibility for users, integrations, revenue, and queues.

## Important Risks And Truth Gaps

The platform still has mock, fallback, legacy, and placeholder paths mixed with production paths.

Key risks:

- Some Amazon routes gracefully return successful empty responses when SP-API fails.
- The Amazon fees endpoint currently returns hardcoded mock fee rows.
- Sandbox/mock data generation paths still exist in parts of the Amazon service layer.
- The active Agent 2 sync path is stricter, but older mock-oriented comments and helpers remain.
- The Python backend exists but is partly proxy/consolidated service glue, with some placeholder service endpoints.
- Migration `063_create_csv_data_tables.sql` drops and recreates core CSV tables, which is dangerous if rerun against production data.
- Branding is inconsistent across Margin, Opside, and Clario.
- Several older documents overstate production readiness or describe older architectures.

These risks do not mean the platform is fake. They mean launch demo data and production messaging must be careful.

## Self-Dialogue From The Audit

Question: Is this a fake Amazon dashboard?

Answer: No. The repository contains real Amazon OAuth/SP-API routes, tenant/store token handling, sync jobs, detection services, evidence workflows, disputes, recoveries, billing, and admin tooling.

Question: Is every displayed dollar backed by verified Amazon payout truth?

Answer: No. The new frontend tries to avoid that mistake. It now hides or labels uncertain values instead of pretending they are verified.

Question: Is `$0.00` a bug?

Answer: Sometimes it may be a data-seeding gap, not a bug. In many places the platform is honestly saying: "No verified payout or approved amount exists yet."

Question: Can we demo without lying?

Answer: Yes. Use a read-only demo workspace called Acme Operations, seed it with clearly demo-scoped but internally consistent records, and avoid presenting those records as live Amazon production outcomes.

## Demo Recommendation

Create or update a dedicated read-only demo tenant:

Name: `Acme Operations`

Slug: `demo-workspace` or `acme-operations`

The demo should show a full lifecycle, not just totals.

Recommended seeded story:

- Amazon store connected.
- Last sync completed successfully.
- Several detections found.
- Some findings are monitoring only.
- Some findings are claim candidates.
- Some claims are missing evidence.
- Some have matched proof.
- Some are ready to file.
- Some are filed with Amazon case references.
- Some are approved but awaiting payout.
- Some have verified payout truth.
- Billing shows flat subscription invoices.
- Notifications show realistic product/recovery activity.
- Evidence locker contains invoices, proof of delivery, shipping, and return documents.

## Demo Data Principles

The demo should be truthful in structure even if the company is fictional.

Use these rules:

- Clearly scope the tenant as demo data.
- Never imply Amazon paid a real seller unless the row is marked demo or has real payout evidence.
- Do not use live customer data.
- Do not fake production SP-API responses inside normal production user flows.
- Prefer seeded database rows over frontend-only fake numbers.
- Make the data internally consistent across dashboard, recoveries, disputes, evidence, billing, and notifications.
- Keep the workspace read-only so the demo cannot accidentally mutate production-like state.

## Suggested Acme Operations Seed

Seed enough records to make every core page useful:

- 1 tenant: Acme Operations.
- 1 owner/demo user membership.
- 1 Amazon store record.
- 1 connected Amazon evidence source.
- 2-4 connected document sources.
- 15-25 detection results.
- 8-12 dispute cases.
- 4-6 evidence documents.
- 8-12 evidence links.
- 3 filed cases with Amazon-style case references.
- 2 approved cases awaiting payout.
- 2 verified paid cases with financial event truth.
- 1 subscription record.
- 1 paid invoice and 1 pending invoice.
- 8-12 notifications.
- 5-10 recent platform/launch monitor events.

## Recommended Next Engineering Step

Create a new migration or seed script rather than editing production logic:

`110_seed_acme_operations_demo.sql`

or

`scripts/seed-acme-operations-demo.ts`

The safer path is a seed script if this needs to be rerunnable and adjustable before launch.

The seed should:

1. Upsert the Acme tenant.
2. Mark it as demo/read-only.
3. Delete only prior Acme demo rows scoped to that tenant.
4. Insert coherent lifecycle data.
5. Tag rows with metadata such as:

```json
{
  "demo_workspace": true,
  "demo_company": "Acme Operations",
  "seed_version": "acme_operations_launch_demo_v1",
  "live_data_mixed": false
}
```

## Bottom Line

The product is real enough to demo, but the demo dataset needs to catch up with the truth-first UI.

The right launch move is not to reintroduce fake Amazon claims. The right move is to seed Acme Operations as a complete, read-only, fictional workspace whose data is internally consistent and clearly labeled as demo data.
