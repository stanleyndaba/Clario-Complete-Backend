# Acme Operations Demo Seed

This seed creates a full read-only demo workspace for launch recordings without pretending the data is live Amazon production activity.

It targets the demo tenant slug `demo-workspace`, names it `Acme Operations`, fills the same backend tables used by the app pages, and returns the tenant to `read_only` at the end.

## What It Seeds

- Tenant, owner membership, and optional demo user profile.
- Amazon, Gmail, Google Drive, and Dropbox connection truth rows.
- Stores, tokens, sync progress, raw source data, product catalog, inventory, orders, shipments, returns, settlements, and financial events.
- Detection results, dispute cases, filing submissions, evidence documents, evidence links, proof packets, smart prompts, case messages, recoveries, work items, and billing truth.
- Case Detail demo truth for multiple lifecycle states: filing-ready inbound shortage, filed Amazon review, approved awaiting payout, paid/reconciled, rejected-needs-evidence, and existing Amazon-thread backfill.
- Notifications, recent platform events, subscription, and invoices.

## Safety Guards

- Requires `ALLOW_DEMO_SEED=true`.
- Requires a real Supabase service-role connection.
- Defaults to `demo-workspace` and refuses other slugs unless `ALLOW_NON_STANDARD_ACME_DEMO_SLUG=true`.
- Only proceeds against an existing tenant if it is the canonical demo slug or is explicitly marked with `metadata.is_demo_workspace=true`.
- Temporarily sets the tenant to `active` while writing, then always attempts to return it to `read_only`.
- Uses schema fallback for optional columns and optional tables so older/staged databases can still receive the core demo story.

## Run

From `Integrations-backend`:

```powershell
$env:ALLOW_DEMO_SEED = "true"
npm run seed:acme-demo
```

To seed for a specific authenticated user, pass their UUID:

```powershell
$env:ALLOW_DEMO_SEED = "true"
$env:ACME_DEMO_USER_ID = "<supabase-auth-user-uuid>"
$env:ACME_DEMO_USER_EMAIL = "demo@your-company.test"
$env:ALLOW_DEMO_PROFILE_UPSERT = "true"
npm run seed:acme-demo
```

Use the profile upsert flag only when you intentionally want the seed to update that user's demo profile fields for the Acme workspace.

If you also want the seed to replace that user's demo OAuth token rows for Gmail, Google Drive, and Dropbox, set `ALLOW_DEMO_TOKEN_OVERWRITE=true`. Leave it unset for a real user if you want to preserve their existing provider tokens.

## Expected Result

After the command succeeds, record the demo through `/app/demo-workspace/...`. The demo should show non-zero, internally consistent values across dashboard, integrations, recoveries, filing pipeline, approved reimbursements, dispute cases, appeals, evidence, documents, notifications, sync, billing, and settings surfaces.
