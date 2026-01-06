# Evidence Ingestion Agent (Agent 4) - Investigation Report

## Executive Summary

**Status:** ✅ **PARTIALLY IMPLEMENTED** - Core functionality exists but missing automated background job scheduling

The Evidence Ingestion Agent has **substantial implementation** across all 4 required integrations (Gmail, Outlook, Google Drive, Dropbox), with document storage and metadata management. However, it **lacks fully automated background job scheduling** for continuous ingestion.

---

## ✅ What's Implemented

### 1. **All 4 Integrations Connected** ✅

#### Gmail Integration
- **File:** `Integrations-backend/src/services/gmailIngestionService.ts`
- **Status:** ✅ Fully implemented
- **Features:**
  - OAuth connection via `GmailService`
  - Email search with custom queries
  - Attachment extraction from emails
  - PDF/invoice/receipt detection
  - Metadata extraction (subject, from, date, etc.)
  - Document content download and storage

#### Outlook Integration
- **File:** `Integrations-backend/src/services/outlookIngestionService.ts`
- **Status:** ✅ Fully implemented
- **Features:**
  - Microsoft Graph API integration
  - OAuth token management
  - Email search with filters
  - Attachment extraction
  - Document metadata extraction

#### Google Drive Integration
- **File:** `Integrations-backend/src/services/googleDriveIngestionService.ts`
- **Status:** ✅ Fully implemented
- **Features:**
  - Google Drive API v3 integration
  - Metadata-first approach (check metadata before downloading)
  - File search by MIME type and name
  - Folder-specific ingestion
  - Document content download

#### Dropbox Integration
- **File:** `Integrations-backend/src/services/dropboxIngestionService.ts`
- **Status:** ✅ Fully implemented
- **Features:**
  - Dropbox API v2 integration
  - Metadata-first approach
  - Folder path traversal
  - File content download

### 2. **Unified Ingestion Service** ✅

- **File:** `Integrations-backend/src/services/unifiedIngestionService.ts`
- **Status:** ✅ Fully implemented
- **Features:**
  - Orchestrates all 4 providers
  - Parallel processing for efficiency
  - Error aggregation across providers
  - Provider filtering support

### 3. **Document Storage & Metadata** ✅

- **Database Table:** `evidence_documents`
- **Storage:**
  - ✅ Metadata stored in PostgreSQL (`evidence_documents` table)
  - ✅ Document metadata includes:
    - `source_id`, `user_id`, `provider`
    - `external_id`, `filename`, `size_bytes`, `content_type`
    - `created_at`, `modified_at`, `sender`, `subject`, `message_id`
    - `metadata` (JSONB) with full ingestion details
    - `processing_status` (pending/processing/completed/failed)
    - `ingested_at` timestamp
  - ⚠️ **Raw file storage:** Content is downloaded but **NOT stored in Supabase Storage bucket** (TODO in code)
  - **Evidence Sources:** `evidence_sources` table tracks connected accounts

### 4. **API Endpoints** ✅

- **File:** `Integrations-backend/src/routes/evidenceRoutes.ts`
- **Endpoints:**
  - ✅ `POST /api/evidence/ingest/gmail` - Manual Gmail ingestion
  - ✅ `POST /api/evidence/ingest/outlook` - Manual Outlook ingestion
  - ✅ `POST /api/evidence/ingest/gdrive` - Manual Google Drive ingestion
  - ✅ `POST /api/evidence/ingest/dropbox` - Manual Dropbox ingestion
  - ✅ `POST /api/evidence/ingest/all` - Unified ingestion from all sources
  - ✅ `POST /api/evidence/schedule` - **Schedule endpoint exists but not fully automated**

### 5. **Document Parsing Integration** ✅

- **File:** `Integrations-backend/src/services/gmailIngestionService.ts` (lines 434-543)
- **Status:** ✅ Implemented
- **Features:**
  - Triggers Python API parsing pipeline after ingestion
  - Updates document status to `processing`
  - Handles parsing failures gracefully
  - SSE events for parsing status

---

## ❌ What's Missing / Gaps

### 1. **Fully Automated Background Job** ❌ **CRITICAL GAP**

**Current State:**
- ✅ Manual ingestion endpoints exist
- ✅ Schedule endpoint exists (`POST /api/evidence/schedule`)
- ❌ **NO automated cron job** that runs ingestion automatically
- ❌ **NO background worker** for evidence ingestion
- ❌ Schedule is stored but **NOT executed automatically**

**What's Needed:**
- Background worker similar to `backgroundSyncWorker.ts` (for Amazon sync)
- Cron job that:
  - Runs on schedule (daily/hourly/weekly)
  - Fetches all users with connected evidence sources
  - Triggers ingestion for each user automatically
  - Handles errors and retries
  - Logs ingestion results

**Reference Implementation:**
- `Integrations-backend/src/jobs/backgroundSyncWorker.ts` - Example of automated background job
- Uses `node-cron` for scheduling
- Runs every 6 hours for Amazon sync

### 2. **Raw File Storage** ⚠️ **PARTIAL GAP**

**Current State:**
- ✅ Document metadata stored in database
- ✅ Document content downloaded (in memory)
- ❌ **Content NOT stored in Supabase Storage bucket**
- ⚠️ Code has TODO comment: "TODO: Create 'evidence-documents' bucket in Supabase Storage"

**What's Needed:**
- Supabase Storage bucket: `evidence-documents`
- Store raw files with path: `{user_id}/{document_id}/{filename}`
- Update document metadata with storage path
- Handle storage errors gracefully

### 3. **Incremental Ingestion** ⚠️ **PARTIAL GAP**

**Current State:**
- ✅ Duplicate detection exists (checks `external_id` + `filename`)
- ⚠️ **No timestamp-based incremental sync**
- ⚠️ **No "last_sync_at" tracking per source**

**What's Needed:**
- Track `last_sync_at` in `evidence_sources` table
- Only fetch documents modified/created after `last_sync_at`
- Update `last_sync_at` after successful ingestion
- Handle full sync vs incremental sync

### 4. **Error Handling & Retries** ⚠️ **PARTIAL GAP**

**Current State:**
- ✅ Basic error handling in each service
- ✅ Error aggregation in unified service
- ❌ **No retry logic for failed ingestions**
- ❌ **No dead letter queue for failed documents**

**What's Needed:**
- Exponential backoff retry logic
- Max retry attempts (e.g., 3 attempts)
- Dead letter queue for permanently failed documents
- Alerting for repeated failures

### 5. **Rate Limiting** ⚠️ **MISSING**

**Current State:**
- ❌ **No rate limiting** for API calls
- ⚠️ Risk of hitting provider API limits (Gmail, Outlook, Drive, Dropbox)

**What's Needed:**
- Rate limiting per provider
- Respect API quotas (e.g., Gmail: 250 quota units per second)
- Queue-based throttling
- Backoff on rate limit errors

### 6. **Monitoring & Metrics** ⚠️ **PARTIAL GAP**

**Current State:**
- ✅ Basic logging exists
- ❌ **No metrics collection** (success rate, ingestion time, document counts)
- ❌ **No dashboard/monitoring** for ingestion health

**What's Needed:**
- Metrics: ingestion rate, success rate, error rate, latency
- Dashboard for ingestion status
- Alerts for ingestion failures

### 7. **Connection Status Management** ⚠️ **PARTIAL GAP**

**Current State:**
- ✅ OAuth connection exists
- ✅ Token refresh logic exists
- ❌ **No automatic token refresh** before expiration
- ❌ **No connection health checks**

**What's Needed:**
- Token refresh before expiration
- Connection health checks
- Automatic reconnection on token expiry
- User notification on connection issues

---

## 🔍 Code Analysis

### Key Files

1. **Ingestion Services:**
   - `Integrations-backend/src/services/gmailIngestionService.ts` (594 lines)
   - `Integrations-backend/src/services/outlookIngestionService.ts` (560 lines)
   - `Integrations-backend/src/services/googleDriveIngestionService.ts` (507 lines)
   - `Integrations-backend/src/services/dropboxIngestionService.ts` (504 lines)
   - `Integrations-backend/src/services/unifiedIngestionService.ts` (307 lines)

2. **Routes:**
   - `Integrations-backend/src/routes/evidenceRoutes.ts` (1501 lines)

3. **Background Jobs (Reference):**
   - `Integrations-backend/src/jobs/backgroundSyncWorker.ts` (331 lines) - **Use as template**

4. **Database:**
   - `evidence_sources` table - Tracks connected accounts
   - `evidence_documents` table - Stores document metadata

### Architecture Pattern

```
User → OAuth Connection → evidence_sources table
  ↓
Manual Trigger / Scheduled Job → Unified Ingestion Service
  ↓
Provider Services (Gmail/Outlook/Drive/Dropbox)
  ↓
Document Fetch → Metadata Extraction → Storage
  ↓
evidence_documents table → Parsing Pipeline (Python API)
```

---

## 📋 Implementation Checklist

### Critical (Must Have)
- [ ] **Create automated background job worker** (`evidenceIngestionWorker.ts`)
  - [ ] Cron scheduling (daily/hourly/weekly)
  - [ ] Fetch all users with connected sources
  - [ ] Trigger ingestion for each user
  - [ ] Error handling and logging
- [ ] **Implement raw file storage** in Supabase Storage
  - [ ] Create `evidence-documents` bucket
  - [ ] Store files with proper path structure
  - [ ] Update metadata with storage path
- [ ] **Add incremental ingestion**
  - [ ] Track `last_sync_at` per source
  - [ ] Only fetch new/modified documents
  - [ ] Update `last_sync_at` after sync

### Important (Should Have)
- [ ] **Add retry logic** for failed ingestions
- [ ] **Implement rate limiting** per provider
- [ ] **Add connection health checks** and auto-refresh
- [ ] **Add metrics collection** and monitoring

### Nice to Have
- [ ] **Add ingestion dashboard** for monitoring
- [ ] **Add dead letter queue** for failed documents
- [ ] **Add user notifications** for ingestion status

---

## 🎯 Recommended Next Steps

1. **Create `evidenceIngestionWorker.ts`** (Priority 1)
   - Model after `backgroundSyncWorker.ts`
   - Add cron scheduling
   - Integrate with existing ingestion services

2. **Implement Supabase Storage** (Priority 2)
   - Create storage bucket
   - Update all 4 ingestion services to store files
   - Update metadata with storage paths

3. **Add Incremental Sync** (Priority 3)
   - Update `evidence_sources` table with `last_sync_at`
   - Modify ingestion services to use timestamp filtering
   - Update sync logic

4. **Add Retry & Rate Limiting** (Priority 4)
   - Implement retry logic with exponential backoff
   - Add rate limiting per provider
   - Handle API quota errors

---

## 📊 Implementation Completeness

| Component | Status | Completeness |
|-----------|--------|--------------|
| Gmail Integration | ✅ | 95% |
| Outlook Integration | ✅ | 95% |
| Google Drive Integration | ✅ | 95% |
| Dropbox Integration | ✅ | 95% |
| Unified Service | ✅ | 90% |
| Document Storage (Metadata) | ✅ | 100% |
| Document Storage (Raw Files) | ❌ | 0% |
| Automated Background Job | ❌ | 0% |
| Incremental Sync | ⚠️ | 30% |
| Retry Logic | ❌ | 0% |
| Rate Limiting | ❌ | 0% |
| Monitoring | ⚠️ | 20% |

**Overall Completeness: ~65%**

---

## 🔗 Related Files

- `Integrations-backend/src/jobs/backgroundSyncWorker.ts` - **Reference for automated job**
- `Integrations-backend/src/jobs/orchestrationJob.ts` - Job orchestration pattern
- `Integrations-backend/src/routes/evidenceRoutes.ts` - API endpoints
- `Integrations-backend/migrations/007_evidence_engine.sql` - Database schema

---

**Investigation Date:** 2025-11-14  
**Investigator:** AI Assistant  
**Status:** Ready for implementation planning




