# MARGIN — QuickBooks & Xero Accounting Integration
## Full Implementation Blueprint

---

## 1. FORENSIC PRE-AUDIT: CURRENT STATE OF ACCOUNTING INTEGRATIONS

Before specifying a single line of architecture, the codebase was exhaustively searched. The following is the certified truth.

### What Exists Today

| Layer | QuickBooks | Xero | Evidence |
|---|---|---|---|
| **Backend routes** | ❌ ABSENT | ❌ ABSENT | Zero files in `src/routes/` |
| **Backend services** | ❌ ABSENT | ❌ ABSENT | Zero files in `src/services/` |
| **Backend controllers** | ❌ ABSENT | ❌ ABSENT | Zero files in `src/controllers/` |
| **NPM dependencies** | ❌ ABSENT | ❌ ABSENT | No `node-quickbooks`, `intuit-oauth`, or `xero-node` in `package.json` |
| **Python services** | ❌ ABSENT | ❌ ABSENT | Zero mentions in any `.py` file |
| **Environment variables** | ❌ ABSENT | ❌ ABSENT | No `QB_*`, `QUICKBOOKS_*`, `XERO_*` in `.env` or `.env.example` |
| **Evidence provider type** | ❌ ABSENT | ❌ ABSENT | `EvidenceProvider` union in `evidenceSourceTruthService.ts` does not include `'quickbooks'` or `'xero'` |
| **Unified ingestion** | ❌ ABSENT | ❌ ABSENT | `unifiedIngestionService.ts` imports 7 providers — neither QuickBooks nor Xero |
| **Database schema** | ⚠️ PLACEHOLDER | ⚠️ PLACEHOLDER | Migration 055 has `source IN ('accounting_integration')` and `source_reference TEXT -- e.g., QuickBooks item ID` — but zero code writes to it |
| **PDF metadata scrubber** | ✅ STRING ONLY | ✅ STRING ONLY | `pdfMetadataScrubber.ts` uses "QuickBooks" and "Xero" as fake PDF creator strings to disguise automated documents |
| **Frontend IntegrationsHub** | ⚠️ LISTED AS ACTIVE | ⚠️ LISTED AS ACTIVE | Line 119: `ACTIVE_SECONDARY_PROVIDERS` includes `'quickbooks'`, `'xero'` — they render as connectable, not "coming soon" |
| **Frontend landing page** | ⚠️ LOGO DISPLAYED | ⚠️ LOGO DISPLAYED | `Index.tsx` references `quickbooks.png` and `xero.png` in 5+ locations (logo bars, orbit animations, integration grids) |
| **Demo workspace** | ⚠️ FAKE ACCOUNT | ⚠️ FAKE ACCOUNT | Demo accounts `books@acme-operations.test` and `ledger@acme-operations.test` are assigned |

### Verdict

> **QuickBooks and Xero integrations are COMPLETELY ABSENT from the backend.**
> The database schema anticipated them. The frontend actively presents them as available. But there is zero executable code — no OAuth, no API calls, no data sync, no ingestion, no COGS import. A real user clicking "Connect QuickBooks" today would hit a dead end.

---

## 2. WHY THIS INTEGRATION MATTERS

### 2.1 The COGS Problem

Margin's Agent 3 (The Auditor) detects Amazon reimbursement underpayments. To determine whether Amazon underpaid a reimbursement, the system must know the **fair market value** of the product.

Today, Margin calculates fair value from:
- **Rolling median sale prices** (from order history) → `product_price_history` table
- **Buy Box / list prices** (from Amazon catalog data)

What Margin **cannot** do today:
- Compare the reimbursement against the seller's **actual Cost of Goods Sold (COGS)**
- Detect cases where Amazon reimbursed below the seller's landed cost
- Generate evidence packets that include purchase invoices proving product value

The `product_costs` table exists with the `'accounting_integration'` source type, but nothing populates it.

### 2.2 The Evidence Problem

When Agent 7 (The Closer) files a claim with Amazon, one of the strongest proof types is a **supplier purchase invoice** proving ownership and value. Today, these invoices must be:
1. Manually uploaded by the seller, or
2. Ingested from Gmail/Slack/Drive if the seller happened to receive them there

An accounting integration would allow Margin to **automatically pull purchase invoices, bills, and expense records** directly from the seller's accounting system — the single most authoritative source of COGS and ownership proof.

### 2.3 The Margin Intelligence Advantage

With COGS data from accounting software, Margin unlocks capabilities no competitor has:

| Capability | Without Accounting | With Accounting |
|---|---|---|
| Underpayment detection | Median sale price proxy only | Actual COGS comparison |
| Evidence strength | Uploaded PDFs, email attachments | Authoritative purchase invoices |
| True margin calculation | Impossible | Revenue − COGS − Amazon fees − recovery costs |
| Long-tail pattern detection | Fee-level only | Cost-weighted fee anomalies |
| ROI reporting | Recovery \$ only | Recovery as % of actual margin impact |

---

## 3. INTEGRATION ARCHITECTURE

### 3.1 Which APIs

| Platform | API | Auth | SDK |
|---|---|---|---|
| **QuickBooks Online** | Intuit QuickBooks Online Accounting API v3 | OAuth 2.0 (Authorization Code flow) | `intuit-oauth` (Node.js) + raw REST |
| **Xero** | Xero Accounting API v2 | OAuth 2.0 (Authorization Code flow with PKCE) | `xero-node` (official SDK) |

> [!IMPORTANT]
> Both QuickBooks Desktop and Xero Practice Manager are out of scope. This integration targets **QuickBooks Online** and **Xero cloud** only — the products used by 90%+ of Amazon FBA sellers who use accounting software.

### 3.2 Data We Need to Extract

The integration is **not** a general-purpose accounting sync. It is surgically scoped to three data categories:

#### Category A: COGS / Product Cost Data
| QuickBooks Entity | Xero Entity | Purpose |
|---|---|---|
| `Item` (Inventory type) | `Item` (TRACKED type) | SKU → unit cost mapping |
| `PurchaseOrder` | `PurchaseOrder` | Bulk purchase cost verification |
| `Bill` / `BillPayment` | `Invoice` (AP type) / `Payment` | Supplier invoice proof |
| `ItemBasedExpenseLine` | `LineItem` with `ItemCode` | Per-unit cost extraction |

#### Category B: Purchase Invoice Documents (Evidence)
| QuickBooks | Xero | Purpose |
|---|---|---|
| `Attachable` (linked to Bill/PO) | `Attachment` (linked to Invoice/PO) | PDF/image download for evidence vault |
| `Bill` PDF export | `Invoice` PDF render | Formatted proof of purchase |

#### Category C: Inventory Valuation (Optional, Phase 2)
| QuickBooks | Xero | Purpose |
|---|---|---|
| `InventoryValuationSummary` report | `InventoryItemSummary` report | Cross-validate Amazon inventory counts |

### 3.3 What We Explicitly Do NOT Sync

- Bank transactions
- Customer invoices (AR)
- Payroll
- Tax filings
- Journal entries (unless inventory-related)
- Chart of accounts (beyond inventory/COGS accounts)
- Employee data
- Contact lists

> [!CAUTION]
> **Scope discipline is critical.** Amazon FBA sellers are highly protective of their financial data. Requesting broad accounting permissions when we only need inventory costs and purchase invoices would damage trust and increase OAuth rejection rates. Request minimum viable scopes.

---

## 4. OAUTH FLOWS

### 4.1 QuickBooks Online OAuth 2.0

**Scopes requested:**
```
com.intuit.quickbooks.accounting.readonly
```

> [!NOTE]
> Read-only scope. Margin never writes to the seller's accounting system. This is a non-negotiable trust boundary.

**Flow:**

```
Seller clicks "Connect QuickBooks" in IntegrationsHub
    │
    ▼
Frontend → GET /api/integrations/quickbooks/auth
    │
    ▼
Backend generates OAuth URL:
  https://appcenter.intuit.com/connect/oauth2
  ?client_id={QB_CLIENT_ID}
  &redirect_uri={QB_REDIRECT_URI}
  &response_type=code
  &scope=com.intuit.quickbooks.accounting.readonly
  &state={encrypted_state: userId, tenantId, nonce}
    │
    ▼
Seller authorizes on Intuit
    │
    ▼
Intuit redirects → GET /api/integrations/quickbooks/callback
  ?code={authorization_code}
  &state={encrypted_state}
  &realmId={company_id}
    │
    ▼
Backend exchanges code for tokens:
  POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
    │
    ▼
Store in evidence_sources table:
  provider: 'quickbooks'
  tenant_id: {tenantId}
  metadata: {
    access_token: encrypted,
    refresh_token: encrypted,
    realm_id: {realmId},
    token_expires_at: {timestamp},
    company_name: {from API}
  }
    │
    ▼
Redirect seller back to IntegrationsHub with success state
```

**Token Refresh:**
- QuickBooks access tokens expire after **1 hour**
- Refresh tokens expire after **100 days**
- A pre-request interceptor must check expiry and refresh before every API call
- On refresh failure (revoked access), mark the `evidence_source` as `connected: false` and notify the seller

### 4.2 Xero OAuth 2.0 (with PKCE)

**Scopes requested:**
```
openid profile email accounting.transactions.read accounting.contacts.read accounting.attachments.read
```

**Flow:**

```
Seller clicks "Connect Xero" in IntegrationsHub
    │
    ▼
Frontend → GET /api/integrations/xero/auth
    │
    ▼
Backend generates PKCE challenge + OAuth URL:
  https://login.xero.com/identity/connect/authorize
  ?client_id={XERO_CLIENT_ID}
  &redirect_uri={XERO_REDIRECT_URI}
  &response_type=code
  &scope=openid profile email accounting.transactions.read accounting.contacts.read accounting.attachments.read
  &state={encrypted_state}
  &code_challenge={S256_challenge}
  &code_challenge_method=S256
    │
    ▼
Seller authorizes on Xero (selects organization)
    │
    ▼
Xero redirects → GET /api/integrations/xero/callback
  ?code={authorization_code}
  &state={encrypted_state}
    │
    ▼
Backend exchanges code + code_verifier for tokens:
  POST https://identity.xero.com/connect/token
    │
    ▼
Fetch tenant connections:
  GET https://api.xero.com/connections
  → returns [{tenantId, tenantName, tenantType}]
    │
    ▼
Store in evidence_sources table:
  provider: 'xero'
  tenant_id: {margin_tenantId}
  metadata: {
    access_token: encrypted,
    refresh_token: encrypted,
    xero_tenant_id: {xero_org_id},
    token_expires_at: {timestamp},
    organization_name: {tenantName}
  }
```

**Token Refresh:**
- Xero access tokens expire after **30 minutes**
- Refresh tokens are single-use (each refresh returns a new refresh token)
- Token refresh must be atomic — if two requests race, only one should refresh, the other retries with the new token

---

## 5. DATA SYNC ARCHITECTURE

### 5.1 Sync Strategy: Incremental, Overnight, Low-Frequency

Accounting data does not change in real-time the way Amazon settlement data does. A seller's purchase invoices and COGS update when they receive new inventory — weekly or monthly for most FBA sellers.

**Sync schedule:**
- **Initial sync:** Full pull of Items + Bills/Invoices from the last 12 months
- **Incremental sync:** Every 24 hours, pull items modified since `last_sync_timestamp`
- **Manual trigger:** Seller can trigger a re-sync from IntegrationsHub

> [!TIP]
> This low-frequency sync means the integration has minimal API quota impact. QuickBooks allows 500 requests/minute. Xero allows 60 requests/minute (per tenant). A typical FBA seller's inventory fits in 1–5 API pages.

### 5.2 Sync Pipeline

```
Cron trigger (daily) or manual trigger
    │
    ▼
accountingSyncWorker (new BullMQ worker)
    │
    ▼
For each tenant with connected 'quickbooks' or 'xero' evidence_source:
    │
    ├─── Refresh token if needed
    │
    ├─── Fetch Items (inventory/tracked items only)
    │    │
    │    ▼
    │    Transform → product_costs rows
    │    {
    │      seller_id, tenant_id, sku, asin,
    │      product_name, cogs_value, cost_currency,
    │      source: 'accounting_integration',
    │      source_reference: '{qb_item_id}' or '{xero_item_id}',
    │      confidence_score: 0.95,  ← accounting data is high-confidence
    │      effective_date_start: item.last_updated
    │    }
    │
    ├─── Fetch Bills / Purchase Invoices (last N months)
    │    │
    │    ▼
    │    For each Bill with line items referencing inventory Items:
    │    │
    │    ├── Extract per-unit cost from line item
    │    ├── Update product_costs if more recent
    │    ├── Download attached PDF/image if exists
    │    │   │
    │    │   ▼
    │    │   Store in evidence_documents table
    │    │   {
    │    │     provider: 'quickbooks' or 'xero',
    │    │     filename: 'PO-2024-0847.pdf',
    │    │     source_id: evidence_source.id,
    │    │     tenant_id,
    │    │     processing_status: 'pending'
    │    │   }
    │    │   │
    │    │   ▼
    │    │   Trigger Python parsing pipeline
    │    │   POST /api/documents/{documentId}/parse
    │    │
    │    └── Store Bill metadata for evidence graph linking
    │
    ├─── Update evidence_source.last_ingested_at
    │
    └─── Log sync event to agent_events table
```

### 5.3 SKU Mapping — The Hard Problem

The central challenge of accounting integration is **SKU resolution**. QuickBooks and Xero do not natively use Amazon SKUs. Sellers use their own part numbers, names, or codes.

**Resolution strategy (layered):**

| Priority | Method | Confidence |
|---|---|---|
| 1 | Exact SKU match: QB/Xero `Item.Sku` field matches Amazon `seller_sku` | 0.98 |
| 2 | Item name contains ASIN (some sellers put ASINs in item descriptions) | 0.85 |
| 3 | Item name fuzzy match against `product_name` in `product_price_history` | 0.60 |
| 4 | Manual mapping table: seller manually maps QB items → Amazon SKUs | 1.00 |
| 5 | Unmatched: store the cost data with `sku: null`, flag for manual resolution | 0.00 |

**The manual mapping table** (new migration required):

```sql
CREATE TABLE IF NOT EXISTS accounting_sku_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    seller_id TEXT NOT NULL,
    
    -- Accounting system identifiers
    accounting_provider TEXT NOT NULL CHECK (accounting_provider IN ('quickbooks', 'xero')),
    accounting_item_id TEXT NOT NULL,
    accounting_item_name TEXT,
    
    -- Amazon identifiers
    amazon_sku TEXT,
    amazon_asin TEXT,
    amazon_fnsku TEXT,
    
    -- Mapping metadata
    mapping_method TEXT CHECK (mapping_method IN ('auto_exact', 'auto_fuzzy', 'manual', 'ai_suggested')),
    confidence_score NUMERIC(3,2) DEFAULT 1.00,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mapped_by TEXT, -- 'system' or user_id
    
    UNIQUE(tenant_id, accounting_provider, accounting_item_id)
);
```

---

## 6. HOW THIS PLUGS INTO THE EXISTING AGENT PIPELINE

### 6.1 Agent 3 Enhancement (Reimbursement Underpayment Detection)

The archived `reimbursementUnderpaymentAlgorithm.ts` already defines the interface:

```typescript
source: 'uploaded_invoice' | 'manual_input' | 'accounting_integration' | 'estimated';
```

With the accounting integration live, Agent 3's underpayment detector gains:

```
Amazon reimbursement event
    │
    ▼
Lookup product_costs WHERE sku = {reimbursed_sku}
  AND source = 'accounting_integration'
  AND effective_date_start <= {event_date}
    │
    ▼
Compare:
  actual_reimbursement vs. cogs_value (seller's cost)
  actual_reimbursement vs. median_sale_price_90d (fair market value)
    │
    ▼
If actual_reimbursement < cogs_value:
  → Flag as CRITICAL underpayment (Amazon paid less than the seller's cost)
  → confidence_score boosted by 0.15 because COGS source is authoritative
    │
    ▼
If actual_reimbursement < median_sale_price * 0.75:
  → Flag as underpayment
  → Attach purchase invoice from evidence_documents as proof
```

### 6.2 Agent 7 Enhancement (Filing with Purchase Invoice Evidence)

When Agent 7 prepares a filing package for an underpayment or lost inventory claim:

```
canonicalEvidenceService.loadCanonicalEvidenceTruth(caseId)
    │
    ▼
Evidence includes:
  - Amazon settlement report (proves the reimbursement amount)
  - product_costs record (proves the COGS)
  - evidence_documents from accounting system (the actual purchase invoice PDF)
    │
    ▼
Agent 7 attaches the purchase invoice to the Amazon case
  → This is the strongest possible proof of product value
  → The pdfMetadataScrubber already knows how to clean QuickBooks/Xero metadata
```

### 6.3 Agent 11 Enhancement (Learning from Accounting-Backed Outcomes)

When a claim backed by accounting evidence succeeds or fails:

```
Outcome → learningService.analyzeOutcomesByDimension()
    │
    ▼
New dimension: byEvidenceSource
  'accounting_integration' claims: {approvalRate, avgTimeToResolution}
  'uploaded_invoice' claims:       {approvalRate, avgTimeToResolution}
  'estimated' claims:              {approvalRate, avgTimeToResolution}
    │
    ▼
Expected result: accounting-backed claims will have significantly higher
approval rates, providing data to prioritize accounting-connected sellers.
```

---

## 7. NEW FILES REQUIRED

### Backend (Integrations-backend)

| File | Purpose |
|---|---|
| `src/routes/quickbooksRoutes.ts` | OAuth endpoints + sync trigger |
| `src/routes/xeroRoutes.ts` | OAuth endpoints + sync trigger |
| `src/controllers/quickbooksController.ts` | Request handling, state validation |
| `src/controllers/xeroController.ts` | Request handling, state validation |
| `src/services/quickbooksIngestionService.ts` | Items, Bills, Attachments sync |
| `src/services/xeroIngestionService.ts` | Items, Invoices, Attachments sync |
| `src/services/accountingSkuMappingService.ts` | SKU resolution logic (shared) |
| `src/workers/accountingSyncWorker.ts` | BullMQ daily sync worker |
| `migrations/XXX_accounting_integrations.sql` | `accounting_sku_mappings` table + updates |

### Frontend (opside-complete-frontend)

| File | Change |
|---|---|
| `src/pages/IntegrationsHub.tsx` | Wire QuickBooks/Xero connect buttons to real OAuth routes |
| New: `src/components/AccountingSkuMapper.tsx` | UI for manual SKU mapping when auto-match fails |

### Configuration

| Variable | Purpose |
|---|---|
| `QB_CLIENT_ID` | QuickBooks OAuth app client ID |
| `QB_CLIENT_SECRET` | QuickBooks OAuth app client secret |
| `QB_REDIRECT_URI` | Callback URL for QuickBooks OAuth |
| `XERO_CLIENT_ID` | Xero OAuth app client ID |
| `XERO_CLIENT_SECRET` | Xero OAuth app client secret |
| `XERO_REDIRECT_URI` | Callback URL for Xero OAuth |

---

## 8. EXISTING INFRASTRUCTURE HOOKS (Zero Modification Required)

The architect who designed migration 055 and the evidence pipeline did the groundwork. The following existing systems require **zero modification** to support accounting data:

| Component | Why It Already Works |
|---|---|
| `product_costs` table | Already has `'accounting_integration'` as a valid source |
| `product_costs.source_reference` | Already commented `-- e.g., QuickBooks item ID` |
| `evidence_documents` table | Provider-agnostic — any `provider` string works |
| `evidence_sources` table | Provider-agnostic — stores OAuth tokens for any provider |
| `pdfMetadataScrubber.ts` | Already has QuickBooks and Xero in its metadata profiles |
| `unifiedIngestionService.ts` | Pattern is clear — add a new provider block |
| `evidenceSourceTruthService.ts` | Add `'quickbooks' \| 'xero'` to `EvidenceProvider` union |
| `tokenManager.ts` | Generic token refresh logic — works for any OAuth provider |
| Python parsing pipeline | Provider-agnostic — any PDF/image triggers OCR and extraction |
| `reimbursementUnderpaymentAlgorithm.ts` | Already typed for `'accounting_integration'` source |
| Agent 7 `canonicalEvidenceService` | Evidence-type-agnostic — any linked document is included |

---

## 9. IMPLEMENTATION PHASES

### Phase 1: QuickBooks Online (4–6 weeks)

QuickBooks first because:
- Larger market share among US Amazon FBA sellers
- Better API documentation and sandbox environment
- Higher item-level SKU fidelity (more sellers put Amazon SKUs in QB)

**Deliverables:**
1. OAuth flow (connect/disconnect)
2. Initial Items sync → `product_costs`
3. Bills/PO sync → `product_costs` + `evidence_documents`
4. Attachment download → evidence vault
5. Auto SKU matching (exact + fuzzy)
6. Manual SKU mapping UI
7. Frontend IntegrationsHub wiring (replace the dead button with a real OAuth redirect)

### Phase 2: Xero (2–3 weeks)

Xero second because:
- The architecture is identical — same tables, same sync worker, same SKU mapper
- Only the OAuth flow and API client differ
- Shared `accountingSkuMappingService.ts` is already built

**Deliverables:**
1. OAuth flow (with PKCE)
2. Items sync + Invoices sync → same tables
3. Attachment download
4. SKU mapping (same service)

### Phase 3: Agent 3 Underpayment Detector Activation (2 weeks)

- Move `reimbursementUnderpaymentAlgorithm.ts` from archive to production
- Wire it into `EnhancedDetectionService.ts` as the 8th flagship detector
- It now has real COGS data to operate on
- Add COGS-based confidence boosting

### Phase 4: Intelligence & Learning (1 week)

- Add `byEvidenceSource` dimension to Agent 11's outcome analysis
- Track approval rate differential: accounting-backed vs. non-accounting claims
- Surface "Connect your accounting software" as a recommendation when claims are filed without COGS proof

---

## 10. RISK ANALYSIS

| Risk | Severity | Mitigation |
|---|---|---|
| **SKU mismatch rate too high** | HIGH | Phase 1 must include manual mapping UI. Expect 30–50% of sellers to need manual mapping for at least some SKUs. |
| **Token expiry (QB 100 days, Xero single-use)** | MEDIUM | Aggressive token refresh monitoring. Alert seller when reconnection is needed. |
| **Seller trust / permission anxiety** | HIGH | Read-only scope only. Prominent "we never modify your books" messaging. Minimal scope request. |
| **QB/Xero rate limits** | LOW | Overnight sync, small data volumes. QB: 500 req/min. Xero: 60 req/min. |
| **Multi-currency COGS** | MEDIUM | Store `cost_currency` per record. Convert to seller's settlement currency at sync time. |
| **QuickBooks Desktop users** | LOW | Out of scope. Desktop API is deprecated. Redirect to QBO migration guides. |
| **Xero multi-org sellers** | MEDIUM | Xero OAuth returns multiple tenants. Let seller choose which org to connect. |

---

## 11. SUCCESS METRICS

After launch, measure:

| Metric | Target | Rationale |
|---|---|---|
| Accounting connection rate | 15–25% of active sellers | Sellers who use QB/Xero and trust Margin enough to connect |
| SKU auto-match rate | >70% | If lower, the manual mapping UX needs investment |
| Underpayment detection rate increase | +20–40% new findings | COGS data reveals underpayments invisible to price-proxy detection |
| Claim approval rate (accounting-backed) | >85% | Purchase invoices are the strongest proof type |
| Time to first COGS-backed filing | <48 hours after connection | Proves the pipeline works end-to-end |

---

## 12. THE COMPETITIVE MOAT

No major Amazon reimbursement competitor (Getida, SELLERBOARD, Refund Genie, Carbon6) integrates with QuickBooks or Xero for COGS-based underpayment detection. They all rely on Amazon's own valuation data.

By connecting to the seller's source-of-truth for product costs, Margin can:

1. **Detect underpayments that competitors literally cannot see** — because competitors don't know what the product actually cost the seller
2. **File claims with the strongest possible evidence** — a purchase invoice from the seller's own accounting system
3. **Build a proprietary dataset** — the relationship between COGS, Amazon reimbursement amounts, and approval rates across thousands of products

This is not a feature. This is a **data moat**.
