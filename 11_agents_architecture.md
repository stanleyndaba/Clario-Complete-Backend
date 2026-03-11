# 🦁 The 11-Agent Audit Engine: Executive Architecture

This document provides a high-level executive and technical summary of the proprietary **11-Agent constellation** powering the Opside/Clario recovery ecosystem. This architecture is designed for institutional scale, extreme data fidelity, and autonomous financial reconciliation.

---

## 🏛️ Executive Summary (For the Board)

**The Problem**: Amazon FBA sellers lose 1-3% of their annual revenue to subtle warehouse variances, billing errors, and lost inventory. These leaks are too small for humans to catch but too large to ignore at scale.

**The Solution**: We have engineered an autonomous 11-Agent pipeline that mirrors a full-scale accounting and legal firm. Each agent is a specialized micro-service managing a specific segment of the "Recovery Lifecycle."

**The Result**: A zero-touch, high-authority recovery engine that converts "Ghost Inventory" into "Cessation of Loss" and liquid capital.

---

## 🤖 The 11-Agent Constellation

| Agent | Name | Role | Institutional Equivalent |
| :--- | :--- | :--- | :--- |
| **Agent 1** | **The Gatekeeper** | OAuth & Token Management | Security & Compliance Dept |
| **Agent 2** | **The Cartographer** | SP-API High-Fidelity Sync | Data Engineering |
| **Agent 3** | **The Auditor** | 26-Algo Detection Engine | Forensic Accounting |
| **Agent 4** | **The Harvester** | Email/Cloud Ingestion | Evidence Discovery |
| **Agent 5** | **The Analyst** | Cognitive Document Parsing | Data Entry / OCR |
| **Agent 6** | **The Matcher** | Neural Linker (Claim ↔ Proof) | Case Building & Review |
| **Agent 7** | **The Closer** | Automated Filing & Support | Legal/Dispute Resolution |
| **Agent 8** | **The Reconciler** | Approval & Payout Tracking | Treasury Management |
| **Agent 9** | **The Treasurer** | Billing & Stripe Integration | Accounts Receivable |
| **Agent 10**| **The Pulse** | Real-time SSE & Alerts | Stakeholder Relations |
| **Agent 11**| **The Oracle** | 7-Layer Adaptive Learning | R&D / Process Optimization |

---

## ⚙️ Technical Blueprint (Deep Dive)

### 1. Agent 1: OAuth Librarian
- **Primary Service**: [amazonService.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/amazonService.ts)
- **Migration**: [020_create_tokens_table.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/020_create_tokens_table.sql)
- **Function**: Manages the "Connection Moment." Secures and rotates LWA (Login with Amazon) tokens. Bridges the user to the SP-API.

### 2. Agent 2: Data Sync Engine
- **Primary Service**: [agent2DataSyncService.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/agent2DataSyncService.ts)
- **Migration**: [022_add_agent2_data_sync_events.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/022_add_agent2_data_sync_events.sql)
- **Function**: Pulls deep Inventory Ledgers, Settlement Reports, and Shipments. Uses snapshotting and coverage monitoring to ensure zero data gaps.

### 3. Agent 3: Forensic Detection
- **Primary Service**: [enhancedDetectionService.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/enhancedDetectionService.ts)
- **Migration**: [004_add_financial_events_and_detection.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/004_add_financial_events_and_detection.sql)
- **Function**: Runs 26 specific financial algorithms (e.g., Inbound Variance, Reversal Errors, Weight/Dimension overcharges) + ML calibration.

### 4. Agent 4: Evidence Ingestion
- **Primary Worker**: [evidenceIngestionWorker.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/evidenceIngestionWorker.ts)
- **Migration**: [011_evidence_ingestion_worker.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/011_evidence_ingestion_worker.sql)
- **Function**: Scans Gmail, Outlook, Dropbox, and Google Drive. Identifies invoices and PODs matching suspected lost assets.

### 5. Agent 5: Document Parsing
- **Primary Worker**: [documentParsingWorker.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/documentParsingWorker.ts)
- **Migration**: [012_document_parsing_worker.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/012_document_parsing_worker.sql)
- **Function**: Converts raw PDFs/Images into structured line items using Tesseract/Python APIs. Validates "Manufacturer Proof of Ownership."

### 6. Agent 6: Neural Matching
- **Primary Worker**: [evidenceMatchingWorker.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/evidenceMatchingWorker.ts)
- **Migration**: [013_evidence_matching_worker.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/013_evidence_matching_worker.sql)
- **Function**: The "Braintrust." It scores the relevance of an invoice against a claim. If score > 0.95, it auto-promotes the case to Agent 7.

### 7. Agent 7: Dispute Filing (The Closer)
- **Primary Worker**: [refundFilingWorker.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/refundFilingWorker.ts)
- **Migration**: [015_refund_filing_worker.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/015_refund_filing_worker.sql)
- **Function**: Submits the **NOTICE OF DEFICIENCY** directly to Amazon Seller Support. Manages the lifecycle of Case IDs.

### 8. Agent 8: Recovery Reconciliation
- **Primary Worker**: [recoveriesWorker.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/recoveriesWorker.ts)
- **Migration**: [015_recoveries_worker.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/015_recoveries_worker.sql)
- **Function**: The scavenger. It watches for "Approved" or "Reimbursed" statuses from Amazon and matches them back to the original detection.

### 9. Agent 9: Billing Architecture
- **Primary Worker**: [billingWorker.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/billingWorker.ts)
- **Migration**: [016_billing_worker.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/016_billing_worker.sql)
- **Function**: Calculates success-based fees. Integrates with Stripe to capture commission only after funds are recovered.

### 10. Agent 10: Notification Engine
- **Primary Worker**: [notificationsWorker.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/notificationsWorker.ts)
- **Migration**: [017_notifications_worker.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/017_notifications_worker.sql)
- **Function**: Sub-second responsiveness. Updates the UI via Server-Sent Events (SSE) and triggers investor-level email reports.

### 11. Agent 11: The Learning Engine (RLS 7-Layer)
- **Primary Service**: [learningService.ts](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/learningService.ts)
- **Migration**: [019_agent11_full_implementation.sql](file:///C:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/migrations/019_agent11_full_implementation.sql)
- **Function**: Self-Correction. If Agent 7 gets a rejection, Agent 11 analyzes the reason, updates the rule set for Agent 3/6, and prevents the error from repeating globally.

---

## 📈 Scalability & Compliance
- **Multi-Tenant Architecture**: Using Row-Level Security (RLS) and Tenant-IDs to isolate data between institutional sellers.
- **Audit Trails**: Every move made by an agent is logged in `audit_logs` for absolute transparency.
- **Fail-Safe Processing**: Backed by a high-availability BullMQ/Redis queue system.
