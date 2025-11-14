# Filing Agent (Agent 3) - Complete Codebase Scan Summary

**Date:** 2025-11-14  
**Status:** ✅ **80% Complete** (per architecture docs)

---

## 📋 Executive Summary

The Filing Agent (Agent 3) has substantial existing implementation across multiple locations in the codebase. It consists of:

1. **Auto Claims Generator (ACG) Service** - Main orchestration service
2. **SP-API Adapter** - Amazon API integration layer
3. **Claim Packet Builder** - Formats claims for submission
4. **Filing Router** - FastAPI endpoints
5. **Database Integration** - Status tracking and persistence

**Key Finding:** The Filing Agent exists but needs to be adapted to work with Evidence Agent outputs (`evidence_package.json`) and produce `claim_status.json` as specified in the pipeline requirements.

---

## 🔍 Detailed Component Analysis

### 1. **Auto Claims Generator Service**

**Location:** 
- `Claim Detector Model/claim_detector/src/acg/service.py` (Primary)
- `src/acg/service.py` (Alternative location)

**Status:** ✅ **IMPLEMENTED**

**Key Features:**
- ✅ Processes claims through complete pipeline
- ✅ Validates evidence with EV service (optional)
- ✅ Prepares claim data for SP-API
- ✅ Submits claims via SP-API adapter
- ✅ Returns `FilingResult` with status
- ✅ Database integration (optional)
- ✅ Filing statistics tracking

**Key Methods:**
```python
- process_claim(claim_data) -> FilingResult
- _file_validated_claim(claim_data, validation_result) -> FilingResult
- _prepare_claim_for_sp_api(claim_data, validation_result) -> Dict
- get_filing_status(claim_id) -> Optional[FilingResult]
- get_filing_stats() -> Dict[str, Any]
```

**Dependencies:**
- Evidence Validator Service (EV) - Optional
- SP-API Adapter - Required
- Database (PostgreSQL) - Optional

**Current Input Format:**
```python
claim_data = {
    "claim_id": str,
    "metadata": {
        "seller_id": str,
        "marketplace": str,
        "claim_type": str,
        "amount": float,
        "quantity": int,
        "sku": str,
        "asin": str,
        ...
    },
    "documents": List[Dict]
}
```

**Current Output Format:**
```python
FilingResult {
    filing_id: str,
    claim_id: str,
    success: bool,
    amazon_case_id: Optional[str],
    status: str,  # "submitted", "failed", "rejected", "review"
    error: Optional[str],
    timestamp: str
}
```

**Gap:** Needs to accept `evidence_package.json` format and output `claim_status.json` format.

---

### 2. **SP-API Adapter**

**Location:**
- `Claim Detector Model/claim_detector/src/acg/sp_api_adapter.py` (Primary)
- `src/acg/sp_api_adapter.py` (Alternative)

**Status:** ✅ **IMPLEMENTED** (Mock mode available)

**Key Features:**
- ✅ Amazon SP-API integration
- ✅ Token management and refresh
- ✅ Claim payload preparation
- ✅ Mock mode for testing (90% success rate)
- ✅ Claim status checking
- ✅ Marketplace ID mapping
- ✅ Claim type to SP-API case type mapping

**Key Methods:**
```python
- file_claim(claim_data) -> Dict[str, Any]
- get_claim_status(case_id) -> Dict[str, Any]
- _prepare_claim_payload(claim_data) -> Dict
- _mock_file_claim(claim_data) -> Dict  # For testing
- is_available() -> bool
```

**Mock Mode:**
- ✅ 90% success rate simulation
- ✅ Generates mock Amazon case IDs
- ✅ Simulates processing delays
- ✅ Returns realistic response structure

**Real SP-API Integration:**
- ⚠️ Requires credentials (environment variables)
- ⚠️ Uses `sp-api` Python SDK (optional dependency)
- ⚠️ Falls back to mock if credentials missing

**Status Lifecycle:**
- `submitted` → `under_review` → `approved`/`rejected`/`pending_documents`

---

### 3. **Claim Packet Builder**

**Location:**
- `src/acg/builder.py`

**Status:** ✅ **IMPLEMENTED**

**Key Features:**
- ✅ Builds claim packets from claim detection + validation
- ✅ Creates narrative from claim data
- ✅ Converts evidence links to EvidenceItem objects
- ✅ Formats line items for claim
- ✅ Generates attachments manifest

**Key Function:**
```python
build_packet(claim: ClaimDetection, 
             validation: ValidationResult, 
             evidence_links: dict) -> ClaimPacket
```

**Dependencies:**
- `src.common.schemas.ClaimPacket`
- `src.common.schemas.EvidenceItem`
- `src.common.schemas.ClaimDetection`
- `src.common.schemas.ValidationResult`

---

### 4. **Filing Router (FastAPI)**

**Location:**
- `Claim Detector Model/claim_detector/src/acg/router.py`
- `src/acg/router.py`

**Status:** ✅ **IMPLEMENTED**

**Endpoints:**
- `POST /submit` - Submit claim for filing
- `GET /status/{claim_id}` - Get filing status
- `GET /stats` - Get ACG statistics
- `GET /health` - Health check

**Request/Response Models:**
- `ClaimSubmissionRequest`
- `ClaimSubmissionResponse`
- `FilingStatusResponse`
- `ACGStatsResponse`

---

### 5. **Filing Filer (Legacy)**

**Location:**
- `src/acg/filer.py`

**Status:** ✅ **IMPLEMENTED** (Database-dependent)

**Key Features:**
- ✅ Enqueues filing jobs
- ✅ Loads claim from database
- ✅ Loads validation from database
- ✅ Fetches evidence links
- ✅ Builds packet and submits
- ✅ Updates claim status in database

**Dependencies:**
- Database (PostgreSQL) - Required
- `src.common.db_postgresql.DatabaseManager`

**Status Updates:**
- `submitted` - On successful submission
- `failed` - On submission failure
- `filing_failed` - On error

---

## 📊 Status Lifecycle Management

### Current Status Values Found:

**From Database Migrations:**
```sql
CREATE TYPE claim_status AS ENUM (
    'detected',
    'validated', 
    'ready_to_file',
    'submitted',
    'rejected',
    'approved', 
    'failed'
);
```

**From Code:**
- `submitted` - Claim filed with Amazon
- `under_review` - Amazon reviewing claim
- `approved` - Claim approved by Amazon
- `rejected` - Claim rejected by Amazon
- `pending_documents` - Waiting for additional documents
- `failed` - Filing failed
- `review` - Requires manual review
- `invalid` - Invalid claim

### Required Status Lifecycle (Per Spec):

```
FILED → IN_REVIEW → APPROVED/DENIED
```

**Gap:** Need to map current status values to required lifecycle and ensure `claim_status.json` output format.

---

## 🔗 Integration Points

### Current Integration:

1. **Discovery Agent → Filing Agent:**
   - ❌ Not directly connected
   - ⚠️ Uses database as intermediary

2. **Evidence Agent → Filing Agent:**
   - ❌ Not directly connected
   - ⚠️ Uses database as intermediary
   - ⚠️ Uses EV service (different from Evidence Agent)

### Required Integration (Per Spec):

1. **Evidence Agent → Filing Agent:**
   - ✅ Input: `evidence_package.json`
   - ✅ Output: `claim_status.json`
   - ✅ Standalone (no database required)
   - ✅ Mock SP-API submission

---

## 📁 File Structure

```
Claim Detector Model/claim_detector/src/acg/
├── service.py              ✅ Main ACG service
├── sp_api_adapter.py       ✅ SP-API integration
└── router.py               ✅ FastAPI endpoints

src/acg/
├── service.py              ✅ Alternative ACG service
├── sp_api_adapter.py       ✅ Alternative SP-API adapter
├── builder.py              ✅ Claim packet builder
├── filer.py                ✅ Legacy filing function
└── router.py               ✅ Alternative router
```

---

## 🎯 What Needs to Be Built/Adapted

### 1. **Unified Filing Agent Service**
   - ✅ Accept `evidence_package.json` as input
   - ✅ Generate claim payload from evidence package
   - ✅ Submit via mock SP-API
   - ✅ Output `claim_status.json` format
   - ✅ Standalone (no database dependencies)

### 2. **Claim Status JSON Format**
   ```json
   {
     "claim_id": "CLM-001239",
     "amazon_case_id": "AMZ-123456",
     "status": "FILED" | "IN_REVIEW" | "APPROVED" | "DENIED",
     "filed_at": "2025-11-14T10:31:20Z",
     "amount": 45.89,
     "metadata": {...}
   }
   ```

### 3. **Evidence → Filing Pipeline Script**
   - ✅ Read `evidence_package.json` files
   - ✅ Process through Filing Agent
   - ✅ Generate `claim_status.json` files
   - ✅ Log to `/output/filing/` directory

### 4. **Mock SP-API Submission**
   - ✅ Already exists in `sp_api_adapter.py`
   - ✅ Needs deterministic results
   - ✅ Needs status lifecycle simulation

---

## ✅ Strengths

1. **Comprehensive Implementation:** Most components already exist
2. **Mock Mode Available:** Can test without real SP-API
3. **Status Tracking:** Database integration for status lifecycle
4. **Error Handling:** Robust error handling in place
5. **API Endpoints:** FastAPI router for external access

---

## ⚠️ Gaps & Issues

1. **Input Format Mismatch:**
   - Current: Expects database-loaded claims
   - Required: Accept `evidence_package.json`

2. **Output Format Mismatch:**
   - Current: Returns `FilingResult` object
   - Required: Output `claim_status.json` file

3. **Database Dependency:**
   - Current: Requires database for some operations
   - Required: Standalone operation

4. **Status Lifecycle:**
   - Current: Multiple status values
   - Required: FILED → IN_REVIEW → APPROVED/DENIED

5. **Pipeline Integration:**
   - Current: No direct Evidence → Filing pipeline
   - Required: Script to connect agents

6. **Deterministic Mock:**
   - Current: Random success/failure
   - Required: Deterministic, reproducible results

---

## 🚀 Recommended Next Steps

1. **Create Unified Filing Agent Service:**
   - Adapt `AutoClaimsGeneratorService` to accept `evidence_package.json`
   - Remove database dependencies (make optional)
   - Add `claim_status.json` export functionality

2. **Create Evidence → Filing Pipeline Script:**
   - `scripts/run_evidence_to_filing.py`
   - Read evidence packages from `/output/evidence/`
   - Process through Filing Agent
   - Write claim status files to `/output/filing/`

3. **Enhance Mock SP-API:**
   - Make deterministic (seed-based)
   - Simulate status lifecycle transitions
   - Add configurable approval rates

4. **Create Claim Status Manager:**
   - Track status lifecycle
   - Simulate status transitions over time
   - Export status updates

5. **Testing:**
   - Test Evidence → Filing connection
   - Verify `claim_status.json` format
   - Test status lifecycle transitions

---

## 📝 Notes

- The Filing Agent is **80% complete** per architecture docs
- Most functionality exists but needs adaptation for the unified pipeline
- Mock SP-API is already implemented and working
- Database integration is optional and can be bypassed
- Status lifecycle needs standardization to match spec

---

**Next Action:** Build unified Filing Agent service that accepts `evidence_package.json` and outputs `claim_status.json` in standalone mode.

