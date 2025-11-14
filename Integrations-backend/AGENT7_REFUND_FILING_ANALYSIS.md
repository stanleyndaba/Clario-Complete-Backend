# Agent 7: Refund Filing Agent — Analysis

**Date:** 2025-01-27  
**Status:** Analysis Complete — Ready for Implementation

---

## 📋 Agent 7 Requirements

1. **Auto-file cases via Amazon SP-API**
   - Submit disputes automatically
   - Handle SP-API authentication and rate limiting

2. **Track case status: Open → In Progress → Approved/Denied**
   - Poll Amazon for case status updates
   - Update database with status changes
   - Trigger downstream actions on status changes

3. **Retry logic with stronger evidence if denied**
   - Detect denied cases
   - Collect additional evidence
   - Resubmit with enhanced evidence package

---

## ✅ What Exists (Python Backend)

### 1. **Amazon SP-API Service** (`src/integrations/amazon_spapi_service.py`)
- ✅ `submit_dispute()` — Submits dispute to SP-API
- ✅ `check_submission_status()` — Polls case status
- ✅ Token management (LWA refresh)
- ✅ Rate limiting
- ✅ Error handling

**Key Methods:**
```python
async def submit_dispute(
    claim: SPAPIClaim,
    user_id: str,
    evidence_documents: List[Dict[str, Any]],
    confidence_score: float
) -> SubmissionResult

async def check_submission_status(
    submission_id: str,
    user_id: str
) -> Dict[str, Any]
```

### 2. **Auto-Submit Engine** (`src/evidence/auto_submit_engine.py`)
- ✅ `process_high_confidence_matches()` — Processes matches for auto-submission
- ✅ `submit_single_match()` — Submits individual match
- ✅ `retry_failed_submissions()` — Retries failed submissions
- ✅ Continuous processing loop
- ✅ Batch processing

**Key Features:**
- Confidence threshold: `>= 0.85`
- Max retries: `3`
- Retry delay: `300 seconds` (5 minutes)
- Batch size: `10`

### 3. **Auto-Submit Service** (`src/evidence/auto_submit_service.py`)
- ✅ `auto_submit_evidence()` — Handles auto-submit requests
- ✅ Evidence validation
- ✅ Evidence link creation
- ✅ Integration with dispute service

### 4. **Filing Agent Service** (Claim Detector Model)
- ✅ `FilingAgentService` — Python filing agent
- ✅ Mock SP-API adapter for testing
- ✅ Claim payload preparation
- ✅ Status tracking

### 5. **Case Status Tracking** (Partial)
- ✅ `dispute_cases` table with `status` column
- ✅ `dispute_submissions` table for submission tracking
- ✅ `AmazonSubmissionWorker` (refund-engine) — Polls status
- ✅ Status mapping: `pending` → `acknowledged` → `paid` / `failed`

---

## ❌ What's Missing (TypeScript Backend)

### 1. **No TypeScript Refund Filing Worker**
- ❌ No automated background worker (like Agents 4, 5, 6)
- ❌ No cron/queue scheduling for filing
- ❌ Filing only happens when Python API is called manually

### 2. **No TypeScript Refund Filing Service**
- ❌ No TypeScript service wrapping Python SP-API service
- ❌ No retry logic at TypeScript level
- ❌ No integration with TypeScript dispute service

### 3. **No Integration with Agent 6**
- ❌ Agent 6's `handleAutoSubmit()` calls Python API but doesn't trigger Agent 7
- ❌ No automatic filing when `action_taken = 'auto_submit'`
- ❌ No connection between matching and filing

### 4. **No Automated Case Status Polling**
- ❌ No background worker polling Amazon for status updates
- ❌ Status updates only happen on-demand
- ❌ No automatic status transitions: `Open` → `In Progress` → `Approved/Denied`

### 5. **No Retry Logic with Stronger Evidence**
- ❌ No detection of denied cases
- ❌ No logic to collect additional evidence
- ❌ No resubmission with enhanced evidence

### 6. **No Error Logging Table**
- ❌ No dedicated `refund_filing_errors` table
- ❌ Errors not logged for debugging

### 7. **No Database Migration**
- ❌ No migration for filing worker tables
- ❌ No `refund_filing_errors` table

---

## ⚠️ Critical Question: Can We Really Use Amazon SP-API?

### **Current Implementation:**
- Code assumes SP-API has `/disputes` endpoint
- Uses mock SP-API adapter for testing
- Python service has SP-API integration code

### **Reality Check:**
Amazon SP-API **does NOT have a direct dispute filing endpoint**. The actual SP-API endpoints are:
- `/finances/v0/financialEvents` — Read financial events
- `/fba/inventory/v1/summaries` — Read inventory
- `/orders/v0/orders` — Read orders
- **No `/disputes` or `/claims` endpoint**

### **Options:**
1. **Use Amazon Seller Central API (Headless Browser)**
   - Submit via Seller Central UI automation
   - More complex, requires browser automation
   - Existing `AmazonSubmissionClient` uses this approach

2. **Use Amazon Case Creation API (if available)**
   - Some sellers have access to case creation APIs
   - Not part of standard SP-API

3. **Mock/Simulate for MVP**
   - Use mock SP-API for development
   - Real filing requires Seller Central automation

### **Recommendation:**
- **For MVP:** Use mock SP-API adapter (already exists)
- **For Production:** Integrate with Seller Central automation or case creation API
- **Document:** Clearly mark SP-API limitations in code

---

## 🏗️ What Needs to Be Built

### 1. **`refundFilingWorker.ts`** — Automated Background Worker
- Runs every 5 minutes
- Polls for cases ready to file (`action_taken = 'auto_submit'` from Agent 6)
- Calls Python SP-API service
- Tracks submission status
- Polls for case status updates
- Handles retries with stronger evidence

### 2. **`refundFilingService.ts`** — Service Wrapper
- Wraps Python SP-API service with retry logic
- Handles data transformation
- Error handling
- Evidence collection for retries

### 3. **Integration with Agent 6**
- Agent 6's `handleAutoSubmit()` should trigger Agent 7
- Store filing-ready cases in database
- Agent 7 picks up and files them

### 4. **Case Status Polling**
- Poll Amazon for case status every 10 minutes
- Update `dispute_cases.status` and `dispute_submissions.status`
- Trigger notifications on status changes

### 5. **Retry Logic with Stronger Evidence**
- Detect denied cases (`status = 'rejected'`)
- Query for additional evidence documents
- Resubmit with enhanced evidence package
- Max 3 retries with exponential backoff

### 6. **Database Migration**
- Create `refund_filing_errors` table
- Add `filing_status` column to `dispute_cases`
- Add `amazon_case_id` to `dispute_submissions`

### 7. **Error Logging**
- Log all filing errors to `refund_filing_errors`
- Include retry count, error message, stack trace

---

## 📊 Database Schema Requirements

### **New Table: `refund_filing_errors`**
```sql
CREATE TABLE refund_filing_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  dispute_id UUID REFERENCES dispute_cases(id),
  submission_id UUID REFERENCES dispute_submissions(id),
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT FALSE
);
```

### **New Columns:**
- `dispute_cases.filing_status` — `pending`, `filing`, `filed`, `failed`
- `dispute_submissions.amazon_case_id` — Amazon case ID (if exists)
- `dispute_submissions.last_status_check` — Last time status was polled

---

## 🔄 Integration Flow

```
Agent 6 (Evidence Matching)
  ↓
  action_taken = 'auto_submit' (confidence >= 0.85)
  ↓
  Store in dispute_cases with filing_status = 'pending'
  ↓
Agent 7 (Refund Filing Worker)
  ↓
  Poll for cases with filing_status = 'pending'
  ↓
  Call Python SP-API service to file case
  ↓
  Update filing_status = 'filed', store amazon_case_id
  ↓
  Poll Amazon for case status (every 10 minutes)
  ↓
  Update dispute_cases.status: Open → In Progress → Approved/Denied
  ↓
  If Denied: Collect stronger evidence → Retry (max 3 times)
  ↓
  If Approved: Trigger Agent 8 (Recoveries Engine)
```

---

## 🎯 Implementation Plan

### **Phase 1: Core Filing Worker**
1. Create `refundFilingService.ts` — Wraps Python SP-API
2. Create `refundFilingWorker.ts` — Automated background worker
3. Create database migration
4. Register worker in `index.ts`

### **Phase 2: Integration with Agent 6**
1. Update Agent 6 to set `filing_status = 'pending'`
2. Agent 7 picks up and files cases

### **Phase 3: Case Status Polling**
1. Add status polling to worker
2. Update `dispute_cases.status` on status changes
3. Trigger notifications

### **Phase 4: Retry Logic with Stronger Evidence**
1. Detect denied cases
2. Collect additional evidence
3. Resubmit with enhanced package

### **Phase 5: Testing**
1. Create test script
2. Test filing flow
3. Test status polling
4. Test retry logic

---

## 📝 Summary

**Python Backend:** ✅ Complete
- SP-API service exists
- Auto-submit engine exists
- Filing logic exists

**TypeScript Backend:** ❌ Missing
- No automated filing worker
- No service wrapper
- No integration with Agent 6
- No status polling
- No retry logic with stronger evidence

**SP-API Reality:** ⚠️ Limitations
- Amazon SP-API does NOT have dispute filing endpoint
- Need to use Seller Central automation or mock for MVP

**Next Steps:**
1. Build TypeScript Refund Filing Worker
2. Integrate with Agent 6
3. Implement case status polling
4. Add retry logic with stronger evidence
5. Document SP-API limitations

---

**Ready to proceed with implementation?** 🚀

