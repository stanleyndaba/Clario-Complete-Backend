# Opside | Platform Intelligence Report
## Executive Summary: The 11-Agent Autonomous Engine

**Opside** is a high-frequency autonomous FBA Audit Platform designed to recover lost Amazon revenue with zero human intervention. The system is built on a **11-Agent Distributed Architecture**, where each agent handles a specific node in the recovery lifecycle.

### 💰 Business Model & Revenue
*   **Main Goal**: Complete automation of the $400B Amazon FBA reconciliation problem.
*   **Revenue Generation**: The system is hardcoded to extract a **20% platform fee** on all recovered capital (Agent 9 - The Banker).
*   **Scalability**: Built as a "Radar-Style" always-on system that continuously scans for discrepancies across 18 months of historical data.

---

### 🤖 The Autonomous 11 (Agent Mapping)

| Agent | Code Identity | Dedicated Migration | Function |
| :--- | :--- | :--- | :--- |
| **Agent 1** | **The Gatekeeper** | `020_create_tokens_table` | Connectivity Hub (OAuth for Amazon, Gmail, Slack, etc.) |
| **Agent 2** | **The Pulse** | `022_add_agent2_data_sync_events` | Pulse (Normalization & Continuous Data Sync) |
| **Agent 3** | **The Discovery** | `023_add_agent3_claim_detection_events` | Brain (9 Detection Algorithms + ML Predictor) |
| **Agent 4** | **The Locker** | `011_evidence_ingestion_worker` | Harvesting (Evidence retrieval from Inbox/Cloud) |
| **Agent 5** | **The Eye** | `012_document_parsing_worker` | Vision (OCR & Computer Vision Parsing of BOL/POD) |
| **Agent 6** | **The Link** | `013_evidence_matching_worker` | Intelligence (Cross-referencing docs with discrepancies) |
| **Agent 7** | **The Lawyer** | `015_refund_filing_worker` | Action (Autonomous case filing via Proxy/SP-API) |
| **Agent 8** | **The Auditor** | `015_recoveries_worker` | Validation (Reconciling Amazon payouts with filed cases) |
| **Agent 9** | **The Banker** | `016_billing_worker` | Profit (20% Commission Extraction via Stripe) |
| **Agent 10** | **The Herald** | `017_notifications_worker` | Signal (Real-time SSE & Multi-channel notifications) |
| **Agent 11** | **The Brain** | `019_agent11_full_implementation` | Evolution (Feedback loop to optimize detection thresholds) |

---

### 🚀 MVP Progress & Readiness Analysis

*   **Infrastructure (100% Ready)**:
    - Background workers for all 11 agents are initialized in `index.ts`.
    - SSE (Server-Sent Events) hub is live for real-time log streaming.
    - Full DB migration path (001-041) is complete and wired.

*   **Detection Loop (95% Ready)**:
    - Discovery Agent matches Amazon's "Pulse" data with high precision.
    - Python ML Predictor is integrated via `proxyRoutes`.

*   **Revenue Operations (90% Ready)**:
    - `BillingService.ts` is fully implemented.
    - **Blocked**: Requires `STRIPE_PAYMENTS_URL` for production settlement.

*   **Evidence Pipeline (85% Ready)**:
    - Gmail/Outlook/Drive harvesting is active.
    - Matching logic between PODs and Lost units is deployed.

**Conclusion**: The system is in "Ready To Launch" status. It is currently operating in a highly advanced MVP state, capable of discovering and filing thousands of dollars in claims automatically. The next critical path is scaling the "Proxy/Submission" layer to handle high-volume filing.

---

### 🏢 Multi-Tenant SaaS Architecture (NEW)

**Status**: Phase 1-2 Complete | Phase 3-5 Pending

The platform has been upgraded to support full **multi-tenant SaaS** architecture:

| Component | Status | Key Files |
| :--- | :---: | :--- |
| **Database Schema** | ✅ | 10 migrations (042-051) |
| **Tenant Tables** | ✅ | `tenants`, `tenant_memberships`, `tenant_invitations` |
| **Audit Logging** | ✅ | `audit_logs` table |
| **Backend Middleware** | ✅ | `tenantMiddleware.ts`, `tenantScopedClient.ts`, `tenantGuard.ts` |
| **API Routes** | ✅ | `tenantRoutes.ts` - workspace management |
| **Frontend Context** | ✅ | `TenantContext.tsx`, `TenantSwitcher.tsx` |
| **Worker Updates** | ⏳ | Pending Phase 3 |

**Architecture Highlights**:
- **Tenant Resolution**: URL slug (`/app/:tenantSlug/*`) → Header (`X-Tenant-Id`) → Session fallback
- **Data Isolation**: RLS policies + `tenant_id` on all 35+ tables
- **Role Hierarchy**: Owner → Admin → Member → Viewer
- **Plan Limits**: Free, Starter, Professional, Enterprise tiers
- **Lifecycle States**: active, trialing, suspended, read_only, canceled, deleted

See: [MULTI_TENANT_SAAS_ARCHITECTURE.md](./MULTI_TENANT_SAAS_ARCHITECTURE.md) for full details.

