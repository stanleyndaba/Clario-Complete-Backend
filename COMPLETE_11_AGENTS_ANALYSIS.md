# Complete 11 Agents Analysis - Files & Databases

**Date:** 2025-01-27  
**Status:** Complete Repository Scan

---

## 📊 Executive Summary

This document provides a complete mapping of all **11 Agents** in the Clario Complete Backend system, including:
- **Files** that implement each agent
- **Databases/Tables** used by each agent
- **Integration points** between agents

---

## 🤖 Agent 1: Zero Agent Layer (OAuth)

### **Purpose:**
Handles OAuth authentication, user creation, and token storage. The entry point for all users.

### **Files:**
1. **Controllers:**
   - `Integrations-backend/src/controllers/amazonController.ts` - OAuth flow handlers
   - `Integrations-backend/src/controllers/gmailController.ts` - Gmail OAuth
   - `Integrations-backend/src/controllers/outlookController.ts` - Outlook OAuth

2. **Services:**
   - `Integrations-backend/src/services/amazonService.ts` - Amazon OAuth service
   - `Integrations-backend/src/services/gmailService.ts` - Gmail OAuth service
   - `Integrations-backend/src/services/outlookService.ts` - Outlook OAuth service
   - `Integrations-backend/src/services/stripeService.ts` - Stripe customer mapping

3. **Models:**
   - `Integrations-backend/src/models/oauthToken.ts` - Token model

4. **Utils:**
   - `Integrations-backend/src/utils/oauthStateStore.ts` - OAuth state management

5. **Orchestration:**
   - `Integrations-backend/src/jobs/orchestrationJob.ts` - Phase 1 OAuth completion workflow

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `tokens` - Encrypted OAuth tokens (migration: `020_create_tokens_table.sql`)
    - Stores: `access_token`, `refresh_token`, `expires_at`, `provider` (amazon/gmail/outlook)
    - Encryption: AES-256-CBC with PBKDF2 fallback
  - `users` - User/tenant management (migration: `021_create_users_table.sql`)
    - Stores: `id`, `email`, `stripe_customer_id`, `created_at`
  - `agent_events` - Event logging (shared with all agents)

### **Integration:**
- **Triggers:** Agent 2 (Data Sync) after OAuth completion
- **Creates:** Stripe customer mapping for Agent 9 (Billing)

---

## 🔄 Agent 2: Data Sync

### **Purpose:**
Continuously syncs Amazon SP-API data, normalizes it, and prepares it for claim detection.

### **Files:**
1. **Services:**
   - `Integrations-backend/src/services/agent2DataSyncService.ts` - **Main service** (1,715 lines)
   - `Integrations-backend/src/services/amazonService.ts` - Amazon SP-API client
   - `Integrations-backend/src/services/syncJobManager.ts` - Sync job orchestration
   - `Integrations-backend/src/services/ordersService.ts` - Orders sync
   - `Integrations-backend/src/services/shipmentsService.ts` - Shipments sync
   - `Integrations-backend/src/services/returnsService.ts` - Returns sync
   - `Integrations-backend/src/services/settlementsService.ts` - Settlements sync
   - `Integrations-backend/src/services/inventoryService.ts` - Inventory sync

2. **Jobs:**
   - `Integrations-backend/src/jobs/amazonSyncJob.ts` - Scheduled sync job

3. **Controllers:**
   - `Integrations-backend/src/controllers/syncController.ts` - Sync API endpoints

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `sync_progress` - Tracks sync jobs (migration: `003_create_sync_and_detection_tables.sql`)
    - Stores: `sync_id`, `status`, `progress`, `metadata`, `user_id`
  - `financial_events` - Raw financial events from Amazon
  - `orders` - Normalized orders data
  - `shipments` - Normalized shipments data
  - `returns` - Normalized returns data
  - `settlements` - Normalized settlements data
  - `inventory` - Normalized inventory data
  - `claims` - Normalized claims data
  - `detection_queue` - Queue for claim detection (migration: `003_create_sync_and_detection_tables.sql`)
  - `agent_events` - Event logging (migration: `022_add_agent2_data_sync_events.sql`)

### **Integration:**
- **Triggered by:** Agent 1 (OAuth completion)
- **Triggers:** Agent 3 (Claim Detection) via `detection_queue`
- **Calls:** Python API `/api/v1/claim-detector/predict/batch` for claim detection

---

## 🔍 Agent 3: Claim Detection (Discovery Agent)

### **Purpose:**
Detects claimable opportunities from normalized data using ML models.

### **Files:**
1. **TypeScript (Integrations Backend):**
   - `Integrations-backend/src/services/detectionService.ts` - Detection service wrapper
   - `Integrations-backend/src/services/agent2DataSyncService.ts` - Calls Python API (lines 810-1137)

2. **Python (Claim Detector Model):**
   - `Claim Detector Model/claim_detector/src/ml_detector/enhanced_ml_detector.py` - ML detector
   - `Claim Detector Model/claim_detector/src/ml_detector/baseline_models.py` - Baseline models
   - `Claim Detector Model/claim_detector/src/ml_detector/confidence_calibrator.py` - Confidence calibration
   - `Claim Detector Model/claim_detector/src/rules_engine/rules_engine.py` - Rules engine
   - `Claim Detector Model/claim_detector/src/preprocessing/pipeline.py` - Data preprocessing
   - `Claim Detector Model/claim_detector/src/preprocessing/feature_engineering.py` - Feature engineering
   - `src/api/detections.py` - FastAPI detection endpoints
   - `src/ml_detector/router.py` - Detection router

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `detection_results` - Claim detection results (migration: `003_create_sync_and_detection_tables.sql`)
    - Stores: `claim_id`, `category`, `confidence`, `severity`, `anomaly_type`, `status`
  - `detection_queue` - Queue for processing (shared with Agent 2)
  - `agent_events` - Event logging (migration: `023_add_agent3_claim_detection_events.sql`)

### **Integration:**
- **Triggered by:** Agent 2 (Data Sync) via `detection_queue`
- **Triggers:** Agent 4 (Evidence Ingestion) when claims are detected
- **API Endpoint:** `POST /api/v1/claim-detector/predict/batch`

---

## 📥 Agent 4: Evidence Ingestion

### **Purpose:**
Ingests evidence documents from multiple sources (Gmail, Outlook, Google Drive, Dropbox).

### **Files:**
1. **Services:**
   - `Integrations-backend/src/services/evidenceIngestionService.ts` - Main ingestion service
   - `Integrations-backend/src/services/gmailIngestionService.ts` - Gmail ingestion
   - `Integrations-backend/src/services/outlookIngestionService.ts` - Outlook ingestion
   - `Integrations-backend/src/services/googleDriveIngestionService.ts` - Google Drive ingestion
   - `Integrations-backend/src/services/dropboxIngestionService.ts` - Dropbox ingestion

2. **Workers:**
   - `Integrations-backend/src/workers/evidenceIngestionWorker.ts` - Background worker

3. **Controllers:**
   - `Integrations-backend/src/controllers/evidenceController.ts` - Evidence API endpoints

4. **Python (Evidence Engine):**
   - `src/evidence/ingestion_service.py` - Python ingestion service
   - `src/evidence/storage.py` - Document storage

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `evidence_sources` - OAuth connections to sources (migration: `007_evidence_engine.sql`)
    - Stores: `provider`, `user_id`, `last_synced_at`, `credentials`
  - `evidence_documents` - Raw documents (migration: `007_evidence_engine.sql`)
    - Stores: `document_id`, `source_id`, `filename`, `file_size`, `mime_type`, `storage_path`, `user_id`
  - `evidence_ingestion_errors` - Error logging (migration: `011_evidence_ingestion_worker.sql`)
  - `agent_events` - Event logging (shared with all agents)

### **Integration:**
- **Triggered by:** Scheduled worker (every 5 minutes) or manual trigger
- **Triggers:** Agent 5 (Document Parsing) when documents are ingested
- **Sources:** Gmail, Outlook, Google Drive, Dropbox

---

## 📄 Agent 5: Document Parsing

### **Purpose:**
Extracts structured data from documents using regex, OCR, and ML.

### **Files:**
1. **Services:**
   - `Integrations-backend/src/services/documentParsingService.ts` - Parsing service wrapper

2. **Workers:**
   - `Integrations-backend/src/workers/documentParsingWorker.ts` - Background worker

3. **Python (Parsers):**
   - `src/parsers/pdf_parser.py` - PDF parsing
   - `src/parsers/image_parser.py` - Image/OCR parsing
   - `src/parsers/email_parser.py` - Email parsing
   - `src/parsers/parser_worker.py` - Parser worker
   - `src/api/parser.py` - FastAPI parser endpoints
   - `Claim Detector Model/claim_detector/src/evidence/parser.py` - Evidence parser

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `evidence_documents` - Documents with parsed metadata (migration: `012_document_parsing_worker.sql`)
    - Columns added: `parsed_metadata` (JSONB), `parser_status`, `parser_confidence`, `parser_error`, `parser_started_at`, `parser_completed_at`
  - `document_parsing_errors` - Error logging (migration: `012_document_parsing_worker.sql`)
  - `parser_job_results` - Parser job results (if exists)

### **Integration:**
- **Triggered by:** Agent 4 (Evidence Ingestion) when documents are stored
- **Triggers:** Agent 6 (Evidence Matching) when parsing completes
- **API Endpoint:** `POST /api/v1/evidence/parse/{documentId}`

---

## 🔗 Agent 6: Evidence Matching

### **Purpose:**
Matches evidence documents to claims using hybrid rules + ML.

### **Files:**
1. **Services:**
   - `Integrations-backend/src/services/evidenceMatchingService.ts` - Matching service wrapper
   - `Integrations-backend/src/services/smartPromptService.ts` - Smart prompts for ambiguous matches

2. **Workers:**
   - `Integrations-backend/src/workers/evidenceMatchingWorker.ts` - Background worker

3. **Python (Evidence Engine):**
   - `src/evidence/matching_engine.py` - Matching engine
   - `src/evidence/matching_worker.py` - Matching worker
   - `src/api/evidence_matching.py` - FastAPI matching endpoints
   - `Claim Detector Model/claim_detector/src/evidence/evidence_engine.py` - Evidence engine

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `dispute_evidence_links` - Links evidence to claims (migration: `005_add_dispute_system.sql`)
    - Stores: `dispute_id`, `evidence_id`, `confidence`, `match_type`
  - `detection_results` - Claims with match confidence (migration: `013_evidence_matching_worker.sql`)
    - Column added: `match_confidence` (DECIMAL)
  - `evidence_matching_errors` - Error logging (migration: `013_evidence_matching_worker.sql`)
  - `agent_events` - Event logging (shared with all agents)

### **Integration:**
- **Triggered by:** Agent 5 (Document Parsing) when parsing completes
- **Triggers:** Agent 7 (Refund Filing) when confidence >= 0.85 (auto-submit)
- **API Endpoint:** `POST /api/internal/evidence/matching/run`
- **Confidence Routing:**
  - `>= 0.85` → Auto-submit (Agent 7)
  - `0.5 - 0.85` → Smart prompt (user confirmation)
  - `< 0.5` → Hold (manual review)

---

## 📋 Agent 7: Refund Filing

### **Purpose:**
Files refund cases via Amazon SP-API and tracks case status.

### **Files:**
1. **Services:**
   - `Integrations-backend/src/services/refundFilingService.ts` - Filing service wrapper

2. **Workers:**
   - `Integrations-backend/src/workers/refundFilingWorker.ts` - Background worker

3. **Python (Filing Agent):**
   - `Claim Detector Model/claim_detector/src/filing/filing_agent_service.py` - Filing agent service
   - `Claim Detector Model/claim_detector/src/acg/service.py` - Auto Claims Generator service
   - `Claim Detector Model/claim_detector/src/acg/sp_api_adapter.py` - SP-API adapter
   - `Claim Detector Model/claim_detector/src/acg/filer.py` - Claim filer
   - `src/acg/router.py` - FastAPI filing endpoints
   - `src/api/dispute_submissions.py` - Dispute submission endpoints

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `dispute_cases` - Dispute cases (migration: `005_add_dispute_system.sql`)
    - Columns added: `filing_status`, `retry_count` (migration: `014_refund_filing_worker.sql`)
  - `dispute_submissions` - Submissions to Amazon (migration: `014_refund_filing_worker.sql`)
    - Stores: `submission_id`, `amazon_case_id`, `status`, `last_status_check`
  - `refund_filing_errors` - Error logging (migration: `014_refund_filing_worker.sql`)
  - `agent_events` - Event logging (shared with all agents)

### **Integration:**
- **Triggered by:** Agent 6 (Evidence Matching) when confidence >= 0.85
- **Triggers:** Agent 8 (Recoveries) when case status = 'approved'
- **API Endpoint:** `POST /api/v1/acg/file-claim` (Python API)
- **Status Flow:** Open → In Progress → Approved/Denied

---

## 💰 Agent 8: Recoveries

### **Purpose:**
Detects payouts from Amazon, matches them to claims, and reconciles amounts.

### **Files:**
1. **Services:**
   - `Integrations-backend/src/services/recoveriesService.ts` - Recovery service
   - `Integrations-backend/src/services/amazonService.ts` - Amazon SP-API client (for payouts)

2. **Workers:**
   - `Integrations-backend/src/workers/recoveriesWorker.ts` - Background worker

3. **Controllers:**
   - `Integrations-backend/src/controllers/recoveriesController.ts` - Recoveries API endpoints
   - `src/api/recoveries.py` - FastAPI recoveries endpoints

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `recoveries` - Recovery records (migration: `015_recoveries_worker.sql`)
    - Stores: `dispute_id`, `amazon_case_id`, `expected_amount`, `actual_amount`, `discrepancy`, `reconciliation_status`
  - `recovery_lifecycle_logs` - Lifecycle tracking (migration: `015_recoveries_worker.sql`)
    - Stores: `recovery_id`, `event_type`, `event_data`
  - `dispute_cases` - Cases with recovery status (migration: `015_recoveries_worker.sql`)
    - Columns added: `recovery_status`, `reconciled_at`, `actual_payout_amount`
  - `financial_events` - Amazon financial events (for payout detection)
  - `agent_events` - Event logging (shared with all agents)

### **Integration:**
- **Triggered by:** Agent 7 (Refund Filing) when case status = 'approved'
- **Triggers:** Agent 9 (Billing) when `recovery_status = 'reconciled'`
- **Matching Strategies:**
  1. By `amazon_case_id` (most reliable)
  2. By `order_id` + amount (fuzzy match)
  3. By SKU + date range (last resort)

---

## 💳 Agent 9: Billing

### **Purpose:**
Charges users 20% platform fee after money is recovered.

### **Files:**
1. **Services:**
   - `Integrations-backend/src/services/billingService.ts` - Billing service
   - `Integrations-backend/src/services/stripeService.ts` - Stripe integration

2. **Workers:**
   - `Integrations-backend/src/workers/billingWorker.ts` - Background worker

3. **External Service:**
   - `stripe-payments/` - Stripe Payments service (separate service)
   - API Endpoint: `POST /api/v1/stripe/charge-commission`

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `billing_transactions` - Billing transactions (migration: `016_billing_worker.sql`)
    - Stores: `dispute_id`, `recovery_id`, `amount_recovered_cents`, `platform_fee_cents`, `seller_payout_cents`, `stripe_transaction_id`
  - `billing_errors` - Error logging (migration: `016_billing_worker.sql`)
  - `dispute_cases` - Cases with billing status (migration: `016_billing_worker.sql`)
    - Columns added: `billing_status`, `billing_transaction_id`, `platform_fee_cents`, `seller_payout_cents`, `billed_at`, `billing_retry_count`
  - `users` - User Stripe customer mapping (migration: `025_add_stripe_customer_id_to_users.sql`)
  - `agent_events` - Event logging (shared with all agents)

### **Integration:**
- **Triggered by:** Agent 8 (Recoveries) when `recovery_status = 'reconciled'`
- **Triggers:** Agent 10 (Notifications) when billing completes
- **Fee Calculation:** 20% platform fee (minimum $0.50), 80% seller payout
- **External Service:** Stripe Payments API

---

## 🔔 Agent 10: Notifications

### **Purpose:**
Sends real-time notifications (WebSocket + Email) for all critical events.

### **Files:**
1. **Services:**
   - `Integrations-backend/src/services/notificationHelper.ts` - Notification helper (unified API)
   - `Integrations-backend/src/services/websocketService.ts` - WebSocket service
   - `Integrations-backend/src/notifications/services/notification_service.ts` - Notification service
   - `Integrations-backend/src/notifications/services/email_service.ts` - Email service

2. **Workers:**
   - `Integrations-backend/src/workers/notificationsWorker.ts` - Background worker

3. **WebSocket:**
   - `Integrations-backend/src/websocket/websocket_manager.ts` - WebSocket manager
   - `src/websocket/websocket_manager.py` - Python WebSocket manager

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `notifications` - Notification records (migration: `017_notifications_worker.sql`)
    - Stores: `user_id`, `type`, `title`, `message`, `priority`, `status`, `metadata`
  - `agent_events` - Event logging (shared with all agents)

### **Integration:**
- **Triggered by:** All agents (4-9) for critical events
- **Event Types:**
  - `claim_detected` (Agent 3)
  - `evidence_found` (Agents 4, 5, 6)
  - `case_filed` (Agent 7)
  - `refund_approved` (Agent 7)
  - `funds_deposited` (Agents 8, 9)
- **Delivery:** WebSocket (real-time) + Email (async)

---

## 🧠 Agent 11: Learning

### **Purpose:**
Continuous learning from all agents, optimizes thresholds, triggers model retraining.

### **Files:**
1. **Services:**
   - `Integrations-backend/src/services/agentEventLogger.ts` - Centralized event logging
   - `Integrations-backend/src/services/learningService.ts` - Learning service wrapper

2. **Workers:**
   - `Integrations-backend/src/workers/learningWorker.ts` - Background worker

3. **Python (Feedback Loop):**
   - `Claim Detector Model/claim_detector/src/feedback_loop/rejection_logger.py` - Rejection logger
   - `Claim Detector Model/claim_detector/src/feedback_loop/detector_feedback_loop.py` - Feedback loop
   - `Claim Detector Model/claim_detector/src/feedback_loop/feedback_training_pipeline.py` - Training pipeline
   - `src/api/metrics.py` - Learning metrics endpoints

### **Database:**
- **Primary Database:** Supabase (PostgreSQL)
- **Tables:**
  - `agent_events` - Event-level logging (migration: `018_learning_worker.sql`)
    - Stores: `agent_id`, `event_type`, `success`, `metadata`, `confidence`, `duration`
  - `learning_metrics` - Model performance metrics (migration: `018_learning_worker.sql`)
    - Stores: `agent_id`, `metric_name`, `metric_value`, `period_start`, `period_end`
  - `threshold_optimizations` - Threshold update history (migration: `018_learning_worker.sql`)
    - Stores: `agent_id`, `threshold_name`, `old_value`, `new_value`, `reason`
  - `model_retraining_history` - Retraining records (migration: `018_learning_worker.sql`)
    - Stores: `model_name`, `trigger_reason`, `training_data_count`, `performance_improvement`
  - `learning_insights` - Generated insights (migration: `018_learning_worker.sql`)
    - Stores: `user_id`, `insight_type`, `insight_data`, `confidence`

### **Integration:**
- **Collects Events From:** All agents (4-10)
- **Triggers:** Python API for model retraining
- **API Endpoints:**
  - `POST /api/v1/claim-detector/rejections/log` - Log rejections
  - `POST /api/v1/claim-detector/feedback/retrain` - Trigger retraining
  - `GET /api/v1/claim-detector/model/performance` - Get performance metrics

---

## 📊 Database Summary

### **Primary Database: Supabase (PostgreSQL)**

All agents use the same Supabase PostgreSQL database, with different tables for each agent:

| Agent | Primary Tables | Error Tables | Event Logging |
|-------|---------------|--------------|---------------|
| **Agent 1** | `tokens`, `users` | - | `agent_events` |
| **Agent 2** | `sync_progress`, `detection_queue`, `financial_events`, `orders`, `shipments`, `returns`, `settlements`, `inventory`, `claims` | - | `agent_events` |
| **Agent 3** | `detection_results`, `detection_queue` | - | `agent_events` |
| **Agent 4** | `evidence_sources`, `evidence_documents` | `evidence_ingestion_errors` | `agent_events` |
| **Agent 5** | `evidence_documents` (parsed columns) | `document_parsing_errors` | `agent_events` |
| **Agent 6** | `dispute_evidence_links`, `detection_results` (match_confidence) | `evidence_matching_errors` | `agent_events` |
| **Agent 7** | `dispute_cases` (filing_status), `dispute_submissions` | `refund_filing_errors` | `agent_events` |
| **Agent 8** | `recoveries`, `recovery_lifecycle_logs`, `dispute_cases` (recovery_status) | - | `agent_events` |
| **Agent 9** | `billing_transactions`, `dispute_cases` (billing_status), `users` (stripe_customer_id) | `billing_errors` | `agent_events` |
| **Agent 10** | `notifications` | - | `agent_events` |
| **Agent 11** | `agent_events`, `learning_metrics`, `threshold_optimizations`, `model_retraining_history`, `learning_insights` | - | `agent_events` |

### **Shared Tables:**
- `agent_events` - Used by all agents for event logging
- `dispute_cases` - Used by Agents 6, 7, 8, 9
- `detection_results` - Used by Agents 3, 6
- `evidence_documents` - Used by Agents 4, 5, 6
- `users` - Used by Agents 1, 9

---

## 🔄 Agent Pipeline Flow

```
Agent 1 (OAuth)
  ↓
  Creates user, stores tokens
  ↓
Agent 2 (Data Sync)
  ↓
  Syncs Amazon SP-API data, normalizes
  ↓
Agent 3 (Claim Detection)
  ↓
  Detects claimable opportunities
  ↓
Agent 4 (Evidence Ingestion)
  ↓
  Ingests documents from Gmail/Outlook/Drive/Dropbox
  ↓
Agent 5 (Document Parsing)
  ↓
  Extracts structured data from documents
  ↓
Agent 6 (Evidence Matching)
  ↓
  Matches evidence to claims (confidence routing)
  ↓
Agent 7 (Refund Filing)
  ↓
  Files cases with Amazon, tracks status
  ↓
Agent 8 (Recoveries)
  ↓
  Detects payouts, reconciles amounts
  ↓
Agent 9 (Billing)
  ↓
  Charges 20% platform fee
  ↓
Agent 10 (Notifications)
  ↓
  Sends real-time notifications (all events)
  ↓
Agent 11 (Learning)
  ↓
  Learns from all events, optimizes thresholds, retrains models
```

---

## 🎯 Key Integration Points

1. **Agent 1 → Agent 2:** OAuth completion triggers data sync
2. **Agent 2 → Agent 3:** Normalized data triggers claim detection
3. **Agent 3 → Agent 4:** Claim detection triggers evidence ingestion
4. **Agent 4 → Agent 5:** Document ingestion triggers parsing
5. **Agent 5 → Agent 6:** Parsing completion triggers matching
6. **Agent 6 → Agent 7:** High confidence (>=0.85) triggers auto-filing
7. **Agent 7 → Agent 8:** Case approval triggers recovery detection
8. **Agent 8 → Agent 9:** Reconciliation triggers billing
9. **Agents 4-9 → Agent 10:** All critical events trigger notifications
10. **Agents 4-10 → Agent 11:** All events feed into learning system

---

## 📝 Migration Files

All database migrations are in `Integrations-backend/migrations/`:

- `020_create_tokens_table.sql` - Agent 1
- `021_create_users_table.sql` - Agent 1
- `003_create_sync_and_detection_tables.sql` - Agents 2, 3
- `022_add_agent2_data_sync_events.sql` - Agent 2
- `023_add_agent3_claim_detection_events.sql` - Agent 3
- `007_evidence_engine.sql` - Agent 4
- `011_evidence_ingestion_worker.sql` - Agent 4
- `012_document_parsing_worker.sql` - Agent 5
- `013_evidence_matching_worker.sql` - Agent 6
- `014_refund_filing_worker.sql` - Agent 7
- `015_recoveries_worker.sql` - Agent 8
- `016_billing_worker.sql` - Agent 9
- `017_notifications_worker.sql` - Agent 10
- `018_learning_worker.sql` - Agent 11
- `025_add_stripe_customer_id_to_users.sql` - Agent 9

---

## ✅ Status: All 11 Agents Complete

All agents are implemented, tested, and integrated. The system is production-ready in sandbox mode.

**Last Updated:** 2025-01-27

