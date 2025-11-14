# Agent 6: Evidence Matching Engine - Codebase Analysis

## 🔍 **What Exists (Python Backend)**

### **1. Evidence Matching Engine** ✅ **COMPLETE**
**File**: `src/evidence/matching_engine.py`

**Features**:
- ✅ **Rule-Based Matching**: 
  - Exact invoice number + order ID → 0.95 confidence
  - Exact SKU + quantity + date proximity → 0.90 confidence
  - Supplier fuzzy match + amount match → 0.70 confidence
  - ASIN match in line items → 0.60 confidence
  - Date proximity → 0.40 confidence
  - Amount range match → 0.30 confidence
- ✅ **ML Integration Ready**: Placeholder for future ML-based matching
- ✅ **Confidence Scoring**: Automatic confidence calculation
- ✅ **Decision Logic**: 
  - `>= 0.85` → Auto-submit
  - `0.5 - 0.85` → Smart prompt
  - `< 0.5` → No action (hold)
- ✅ **Match Types**: exact_invoice, sku_match, asin_match, supplier_match, date_match, amount_match

### **2. Evidence Matching Worker** ✅ **COMPLETE**
**File**: `src/evidence/matching_worker.py`

**Features**:
- ✅ Background worker for processing matching jobs
- ✅ Job queue management
- ✅ Calls matching engine
- ✅ Triggers workflow webhook to Node.js (`/api/v1/workflow/phase/4`)
- ✅ Stores detailed matching results
- ✅ Metrics collection

### **3. API Endpoints** ✅ **COMPLETE**
**File**: `src/api/evidence_matching.py`

**Endpoints**:
- ✅ `POST /api/internal/evidence/matching/run` - Run immediate matching
- ✅ `POST /api/internal/evidence/matching/start` - Start matching job
- ✅ `GET /api/internal/evidence/matching/jobs/{id}` - Get job status
- ✅ `GET /api/internal/evidence/matching/metrics` - Get matching metrics
- ✅ `POST /api/internal/evidence/auto-submit` - Auto-submit evidence
- ✅ `POST /api/internal/events/smart-prompts/{id}/answer` - Answer smart prompts

### **4. Database Schema** ✅ **COMPLETE**
**File**: `src/migrations/005_evidence_matching.sql`

**Tables**:
- ✅ `dispute_cases` - Dispute cases that need evidence matching
- ✅ `dispute_evidence_links` - Links between disputes and evidence documents
- ✅ `smart_prompts` - Smart prompts for ambiguous matches
- ✅ `evidence_matching_jobs` - Background matching jobs
- ✅ `evidence_matching_results` - Detailed matching results

---

## ❌ **What's Missing (TypeScript Backend)**

### **1. No TypeScript Evidence Matching Worker** ❌
**Missing**:
- No automated background worker (like Agent 4 & 5)
- No scheduled job to match claims to documents
- Matching only happens when Python API is called manually

**Needed**:
- TypeScript worker that runs every X minutes
- Polls for:
  - New `detection_results` (claims) that need matching
  - New `evidence_documents` with `parser_status = 'completed'` that need matching
- Calls Python API matching endpoint
- Handles retry logic and error logging

### **2. No Evidence Matching Service** ❌
**Missing**:
- No unified TypeScript service that wraps Python API
- No retry logic at TypeScript level
- No structured error handling

**Needed**:
- `evidenceMatchingService.ts` that:
  - Wraps Python API `/api/internal/evidence/matching/run`
  - Handles retry logic with exponential backoff
  - Transforms data between TypeScript and Python formats
  - Logs errors to dedicated table

### **3. No Integration with Agent 5** ❌
**Missing**:
- Agent 5 (Document Parsing) doesn't trigger matching when documents are parsed
- No automatic matching when `parser_status` changes to `completed`

**Needed**:
- Integration in `documentParsingWorker.ts`:
  - After successful parsing, trigger matching for that user
  - Or queue a matching job for the user

### **4. No Confidence Threshold Handling in TypeScript** ❌
**Missing**:
- TypeScript backend doesn't handle confidence thresholds
- No logic to:
  - Auto-match when `>= 0.85`
  - Request manual confirm when `0.5 - 0.85`
  - Hold when `< 0.5`

**Needed**:
- Service methods to:
  - Process matching results
  - Route based on confidence:
    - `>= 0.85` → Auto-submit (call auto-submit service)
    - `0.5 - 0.85` → Create smart prompt (call smartPromptService)
    - `< 0.5` → Mark as "needs_review" or hold

### **5. No Matching Results Storage** ❌
**Missing**:
- No TypeScript-side storage of matching results
- Results only stored in Python backend database

**Needed**:
- Store matching results in TypeScript database:
  - Link `detection_results` to `evidence_documents`
  - Store confidence scores
  - Store match types and reasoning
  - Update `detection_results` with matched evidence

### **6. No Error Logging Table** ❌
**Missing**:
- No dedicated table for matching errors
- Errors not logged systematically

**Needed**:
- `evidence_matching_errors` table (similar to `document_parsing_errors`)
- Log matching failures with retry counts

---

## 🎯 **What Needs to Be Built**

### **Priority 1: Core Matching Worker**
1. **`evidenceMatchingWorker.ts`** - Automated background worker
   - Runs every 3 minutes (configurable)
   - Polls for:
     - `detection_results` where `status = 'pending'` and no evidence linked
     - `evidence_documents` where `parser_status = 'completed'` and not matched
   - Calls Python API matching endpoint
   - Processes results and routes based on confidence

2. **`evidenceMatchingService.ts`** - Service wrapper
   - Wraps Python API `/api/internal/evidence/matching/run`
   - Retry logic with exponential backoff
   - Error handling and logging
   - Data transformation (TypeScript ↔ Python)

### **Priority 2: Integration & Routing**
3. **Integration with Agent 5**
   - Trigger matching when document parsing completes
   - Queue matching job for user after parsing

4. **Confidence Threshold Routing**
   - `>= 0.85` → Auto-submit (call existing auto-submit logic)
   - `0.5 - 0.85` → Smart prompt (call `smartPromptService`)
   - `< 0.5` → Mark as "needs_review"

### **Priority 3: Database & Storage**
5. **Matching Results Storage**
   - Store matches in `dispute_evidence_links` (or equivalent)
   - Update `detection_results` with matched evidence IDs
   - Store confidence scores and match types

6. **Error Logging**
   - Create `evidence_matching_errors` table
   - Log matching failures with retry counts

### **Priority 4: Migration**
7. **Database Migration**
   - Add `evidence_matching_errors` table
   - Add indexes for performance
   - Add RLS policies

---

## 📊 **Current State Summary**

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| **Python Matching Engine** | ✅ Complete | `src/evidence/matching_engine.py` | Full rule-based matching, ML ready |
| **Python Matching Worker** | ✅ Complete | `src/evidence/matching_worker.py` | Background worker, job queue |
| **Python API Endpoints** | ✅ Complete | `src/api/evidence_matching.py` | All endpoints implemented |
| **Database Schema** | ✅ Complete | `src/migrations/005_evidence_matching.sql` | All tables exist |
| **TypeScript Worker** | ❌ Missing | N/A | Need to build |
| **TypeScript Service** | ❌ Missing | N/A | Need to build |
| **Agent 5 Integration** | ❌ Missing | N/A | Need to add trigger |
| **Confidence Routing** | ❌ Missing | N/A | Need to implement |
| **Error Logging** | ❌ Missing | N/A | Need to create table |

---

## 🚀 **Implementation Plan**

### **Step 1: Create Evidence Matching Service**
- Wrap Python API with retry logic
- Handle data transformation
- Error handling and logging

### **Step 2: Create Evidence Matching Worker**
- Automated background worker (every 3 minutes)
- Poll for claims and documents needing matching
- Call Python API via service
- Process results and route based on confidence

### **Step 3: Integrate with Agent 5**
- Trigger matching when document parsing completes
- Queue matching job for user

### **Step 4: Implement Confidence Routing**
- `>= 0.85` → Auto-submit
- `0.5 - 0.85` → Smart prompt
- `< 0.5` → Hold/needs_review

### **Step 5: Database Migration**
- Create `evidence_matching_errors` table
- Add indexes and RLS policies

### **Step 6: Register Worker**
- Add to `src/index.ts`
- Enable via environment variable

---

## ✅ **Success Criteria**

1. ✅ **Automated Matching**: Worker runs every 3 minutes, matches claims to documents
2. ✅ **Python API Integration**: Wraps Python API with retry logic
3. ✅ **Confidence Routing**: Routes based on thresholds (>=0.85, 0.5-0.85, <0.5)
4. ✅ **Agent 5 Integration**: Triggers matching when documents are parsed
5. ✅ **Error Logging**: All errors logged to dedicated table
6. ✅ **Results Storage**: Matching results stored in database

---

## 🎯 **Ready to Build**

Agent 6 needs a **TypeScript background worker** similar to Agents 4 & 5 that:
- Automates the matching process
- Integrates with Python backend
- Handles confidence thresholds
- Routes to auto-submit or smart prompts

**Estimated Implementation**: Similar complexity to Agent 5 (Document Parsing Worker)

