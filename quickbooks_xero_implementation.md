# MARGIN — Executive Truth: QuickBooks & Xero Integration

## Overview
Yes, QuickBooks + Xero were implemented as a real backend “Phase-0 Financial Evidence Connection,” not just a visual placeholder.

**Built as code:** yes.  
**Mounted into backend routes:** yes.  
**Designed for OAuth + encrypted tokens + provider reads:** yes.  
**Fully certified with real QB/Xero accounts in production:** not proven yet.

This is not fake. It is also not yet “Amazon-level live-proven.”

## What Was Actually Built
The system adds QuickBooks and Xero as accounting evidence providers. The job is not to run the main Amazon audit. The job is to help Margin verify payout/accounting truth after recoveries, using accounting records like bills, purchases, and payable invoices.

The implementation lives mainly in:
- `Integrations-backend/src/routes/quickbooksRoutes.ts`
- `Integrations-backend/src/routes/xeroRoutes.ts`
- `Integrations-backend/src/controllers/evidenceSourcesController.ts`
- `Integrations-backend/src/controllers/accountingIntegrationController.ts`
- `Integrations-backend/src/services/quickbooksService.ts`
- `Integrations-backend/src/services/xeroService.ts`
- `Integrations-backend/src/services/accountingEvidenceService.ts`
- `Integrations-backend/migrations/131_create_accounting_records.sql`
- `opside-complete-frontend/src/pages/IntegrationsHub.tsx`

### Backend Routes
QuickBooks is mounted at: `/api/v1/integrations/quickbooks`
Xero is mounted at: `/api/v1/integrations/xero`

Both support:
- `GET /auth`
- `GET /auth/start`
- `GET /callback`
- `POST /sync`
- `POST /disconnect`

### OAuth
OAuth support exists through the shared `evidenceSourcesController`.

**QuickBooks:**
- Endpoints: `https://appcenter.intuit.com/connect/oauth2`, `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
- Scopes: `com.intuit.quickbooks.accounting`, `openid`, `profile`, `email`
- Stores: `realm_id`

**Xero:**
- Endpoints: `https://login.xero.com/identity/connect/authorize`, `https://identity.xero.com/connect/token`
- Scopes: `openid`, `profile`, `email`, `accounting.invoices.read`, `offline_access`
- Stores: `xero_tenant_id` (Required for Xero API reads)

### Token Handling
Tokens are intended to be stored through `tokenManager`, not as plaintext in `evidence_sources.metadata`. Migration 131 explicitly removes old token material from metadata (`metadata - 'access_token' - 'refresh_token'`).

Token uniqueness was adjusted to support tenant-scoped accounting connections (`user_id + provider + tenant_id`). The architecture expects credentials to belong to a specific workspace/tenant.

### Provider Read Logic
**QuickBooks:**
Reads `Bill` and `Purchase` from `/v3/company/{realmId}/query`. Paginates up to 1000 records per page, 100 pages per entity. Normalizes into canonical accounting evidence.

**Xero:**
Reads `ACCPAY invoices` from `https://api.xero.com/api.xro/2.0/Invoices` with `where: Type=="ACCPAY"`. Scoped strictly to accounts payable bills.

### Database
Migration 131 creates the `accounting_records` table to store canonical records. 
Uniqueness constraint: `tenant_id + provider + provider_record_id` (upserts on repeated syncs).

Adds accounting health fields to `evidence_sources`:
- `accounting_read_status` (pending, verified, no_data, failed, reconnect_required)
- `accounting_last_read_at`
- `accounting_last_error`
- `accounting_record_count`

### Sync Jobs & Manual Sync
After OAuth succeeds, an `accounting-sync` job is enqueued. The worker calls `syncQuickBooksFinancialEvidence` or `syncXeroFinancialEvidence` and emits SSE events (`in_progress`, `completed`, `failed`).

Manual syncs (`POST /sync`) require an authenticated user, active tenant membership, and a connected source.

### Disconnect
Disconnection resolves tenant membership, revokes the token through `tokenManager`, marks the source as disconnected, and clears the read status. It intentionally **does not** delete historical accounting records.

### Frontend & Integration Status
Exposed in `IntegrationsHub.tsx` as active secondary providers with icons and demo accounts (`books@acme-operations.test`, `ledger@acme-operations.test`).

`integrationStatusController.ts` aggregates connection, auth, and read health to tell the frontend whether providers are connected, verified, or needing reconnection.

### Tests
Focused provider-service tests (`accountingEvidenceServices.test.ts`) prove reading, pagination, normalization, and zero-record handling with mocks.

**What they do not prove:** Real OAuth works in production, real token refresh against live providers, render env vars are configured, full UI UX, or downstream recovery decisioning.

### Required Env Vars
- `QUICKBOOKS_CLIENT_ID`
- `QUICKBOOKS_CLIENT_SECRET`
- `QUICKBOOKS_REDIRECT_URI`
- `QUICKBOOKS_ENVIRONMENT` (defaults to `sandbox`)
- `XERO_CLIENT_ID`
- `XERO_CLIENT_SECRET`
- `XERO_REDIRECT_URI`

## What This Is For
This is a **financial closure / accounting reconciliation rail**, not the primary audit acquisition rail. It answers:
- Did the payout actually land?
- Does the amount match?
- Can we prepare an accounting-ready record?
- Is there a reversal/underpayment/mismatch?
- Can finance close the loop?

## Current Status Classification

| Capability | Status |
|---|---|
| QuickBooks OAuth scaffold | DONE in code |
| Xero OAuth scaffold | DONE in code |
| Encrypted token storage path | DONE in code |
| Tenant-scoped token model | DONE in migration |
| Canonical `accounting_records` table | DONE in migration |
| QuickBooks Bill/Purchase read service | DONE in code/tested with mocks |
| Xero ACCPAY read service | DONE in code/tested with mocks |
| Accounting sync queue job | DONE in code |
| Accounting worker path | DONE in code |
| Connection health states | DONE in code/schema |
| Frontend provider display | DONE |
| Frontend full live OAuth UX | UNCERTIFIED |
| Real QuickBooks account test | NOT PROVEN |
| Real Xero account test | NOT PROVEN |
| Recovery workflow integration | PARTIAL |
| **Production readiness** | **NOT CERTIFIED** |

## The Honest Founder-Level Sentence
**QuickBooks + Xero are implemented as a serious Phase-0 accounting evidence rail, but they are not yet production-certified integrations.**
