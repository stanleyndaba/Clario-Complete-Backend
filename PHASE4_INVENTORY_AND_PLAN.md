# 🚀 Phase 4: Predictive Refund Orchestration - Inventory & Implementation Plan

## 📋 Phase 4 Definition

**Phase 4: Predictive Refund Orchestration**  
**Flow**: Evidence → Auto-Submit/Smart Prompts

After Phase 3 detects anomalies, Phase 4:
1. **Matches evidence** to detected claims
2. **Routes claims** by confidence:
   - **85%+ confidence** → Auto-submit (zero effort)
   - **50-85% confidence** → Smart prompts (2-second questions)
   - **<50% confidence** → Manual review
3. **Tracks submissions** and monitors recovery

---

## ✅ What We Already Have

### 1. **Orchestration Logic** ✅
- **File**: `Integrations-backend/src/jobs/orchestrationJob.ts`
- **Functions**:
  - `executePhase4_EvidenceMatching()` - Routes claims by confidence
  - `triggerPhase4_EvidenceMatching()` - Triggers Phase 4 workflow
- **Logic**: Categorizes claims into auto-submit, smart prompts, or manual review
- **Status**: ✅ Complete

### 2. **Smart Prompt Service** ✅
- **File**: `Integrations-backend/src/services/smartPromptService.ts`
- **Features**:
  - Create evidence selection prompts
  - Answer prompts
  - SSE real-time notifications
- **Status**: ✅ Basic implementation complete

### 3. **Proof Packet Service** ✅
- **File**: `Integrations-backend/src/services/proofPacketService.ts`
- **Features**: Create proof packets for claims
- **Status**: ✅ Basic implementation complete

### 4. **Workflow Routes** ✅
- **File**: `Integrations-backend/src/routes/workflowRoutes.ts`
- **Endpoint**: `POST /api/v1/workflow/phase/4`
- **Status**: ✅ Complete

### 5. **Internal Events Routes** ✅
- **File**: `Integrations-backend/src/routes/internalEventsRoutes.ts`
- **Endpoint**: `POST /api/internal/events/smart-prompts/:id/answer`
- **Status**: ✅ Complete

### 6. **Evidence Matching** ✅
- **Handled by**: Python API (`/api/internal/evidence/matching/run`)
- **Status**: ✅ Python backend handles this

---

## ❌ What We Need to Build

### 1. **Profit Recovery Dashboard** ❌

**Missing Components:**
- Recovery statistics aggregation
- Dashboard API endpoints
- Recovery history tracking
- Pending recoveries view

**Required Endpoints:**
```
GET  /api/recovery/dashboard       - Overall recovery stats
GET  /api/recovery/history         - Recovery history with filters
GET  /api/recovery/statistics      - Detailed metrics (by type, status, etc.)
GET  /api/recovery/pending         - Pending recoveries
GET  /api/recovery/trends          - Recovery trends over time
```

**Data Sources:**
- `detection_results` table (from Phase 3)
- `claims` table (if exists)
- `financial_events` table (from Phase 3 migration)

**Implementation:**
1. Create `recoveryService.ts` - Aggregate recovery data
2. Create `recoveryRoutes.ts` - Dashboard endpoints
3. Build statistics calculations:
   - Total recoverable amount
   - By confidence level
   - By anomaly type
   - By status (pending, submitted, resolved)
   - Recovery rate trends

---

### 2. **Auto-Submission System** ❌

**Current Status:**
- `autoclaimRoutes.ts` exists but is **placeholder only** (returns empty arrays)
- No actual auto-submit logic
- No rule engine
- No Amazon SP-API integration for submission

**Required Endpoints:**
```
POST /api/claims/auto-submit              - Submit high-confidence claims
GET  /api/claims/auto-submit/rules        - Get auto-submit rules
POST /api/claims/auto-submit/rules        - Configure auto-submit rules
PUT  /api/claims/auto-submit/rules/:id    - Update rule
DELETE /api/claims/auto-submit/rules/:id  - Delete rule
GET  /api/claims/auto-submit/history      - Submission history
GET  /api/claims/auto-submit/queue        - Claims in auto-submit queue
POST /api/claims/auto-submit/cancel/:id   - Cancel pending submission
```

**Required Features:**
1. **Rule Engine**:
   - Minimum confidence threshold (default: 0.85)
   - Minimum amount threshold
   - Maximum amount limit
   - Anomaly type filters
   - User preferences

2. **Auto-Submit Logic**:
   - Query detection_results for high-confidence claims
   - Apply rules
   - Submit to Amazon SP-API
   - Track submission status
   - Handle errors gracefully

3. **Amazon SP-API Integration**:
   - Use existing `amazonService.ts`
   - Submit reimbursement requests
   - Track case IDs
   - Monitor submission status

**Implementation:**
1. Enhance `autoclaimRoutes.ts` with real logic
2. Create `autoSubmitService.ts` - Core auto-submit logic
3. Create `autoSubmitRulesService.ts` - Rule management
4. Integrate with Amazon SP-API
5. Add submission tracking to database

---

### 3. **Smart Prompts Enhancement** ⚠️

**Current Status:**
- Basic service exists
- Needs enhancement for full Phase 4 functionality

**Required Enhancements:**
```
GET  /api/prompts                        - List all prompts (with filters)
GET  /api/prompts/pending                - Get pending prompts count
GET  /api/prompts/:id                    - Get specific prompt
POST /api/prompts/:id/answer             - Answer prompt (exists)
DELETE /api/prompts/:id                  - Cancel prompt
GET  /api/prompts/claim/:claimId         - Get prompts for a claim
```

**Required Features:**
1. **Prompt Management**:
   - List prompts with filters (status, claim_id, etc.)
   - Prompt expiry handling
   - Prompt cancellation
   - Prompt history

2. **Real-time Updates**:
   - SSE events (already configured)
   - WebSocket support (if needed)
   - Frontend integration guide

**Implementation:**
1. Enhance `smartPromptService.ts`
2. Create `promptRoutes.ts` (or add to existing routes)
3. Add prompt management endpoints
4. Improve real-time event delivery

---

### 4. **Evidence Matching Integration** ⚠️

**Current Status:**
- Python API handles matching
- Node.js just triggers it
- Needs better integration

**Required Endpoints:**
```
POST /api/evidence/match                 - Trigger matching for specific claims
GET  /api/evidence/matches/:claimId       - Get evidence matches for claim
GET  /api/evidence/matches                - List all matches (with filters)
POST /api/evidence/matches/:id/confirm    - Confirm a match
DELETE /api/evidence/matches/:id          - Reject a match
```

**Required Features:**
1. **Match Management**:
   - Trigger matching for specific claims
   - View matches for a claim
   - Confirm/reject matches
   - Match confidence scoring

2. **Integration**:
   - Better wrapper around Python API
   - Error handling
   - Retry logic
   - Status tracking

**Implementation:**
1. Enhance `evidenceService.ts` (currently placeholder)
2. Create `evidenceMatchingService.ts`
3. Add evidence matching routes
4. Improve Python API integration

---

## 🎯 Implementation Priority

### **Priority 1: Profit Recovery Dashboard** (Week 1)
**Why**: Users need to see what money they can recover. This is the core value proposition.

**Tasks:**
1. Create `recoveryService.ts`
2. Create `recoveryRoutes.ts`
3. Build dashboard endpoints
4. Aggregate data from `detection_results`
5. Calculate statistics and trends

**Dependencies:**
- Phase 3 migration must be run (for `detection_results` table)
- Detection data from Phase 3

---

### **Priority 2: Auto-Submission System** (Week 2)
**Why**: This is the "zero effort" experience - high-confidence claims auto-submit.

**Tasks:**
1. Implement auto-submit logic in `autoclaimRoutes.ts`
2. Create `autoSubmitService.ts`
3. Create `autoSubmitRulesService.ts`
4. Integrate with Amazon SP-API
5. Add submission tracking

**Dependencies:**
- Amazon SP-API credentials
- Detection results from Phase 3
- Rule engine design

---

### **Priority 3: Smart Prompts Enhancement** (Week 3)
**Why**: For medium-confidence claims that need user input.

**Tasks:**
1. Enhance `smartPromptService.ts`
2. Create prompt management endpoints
3. Improve real-time updates
4. Add prompt expiry handling

**Dependencies:**
- Frontend integration (can work in parallel)
- SSE/WebSocket infrastructure (already exists)

---

### **Priority 4: Evidence Matching Integration** (Week 4)
**Why**: Better integration with Python API for evidence matching.

**Tasks:**
1. Enhance `evidenceService.ts`
2. Create `evidenceMatchingService.ts`
3. Add evidence matching routes
4. Improve error handling

**Dependencies:**
- Python API evidence matching endpoint
- Evidence documents from Phase 3

---

## 📊 Current Phase 4 Status

### ✅ **Complete (30%)**
- Orchestration logic
- Basic smart prompt service
- Basic proof packet service
- Workflow trigger endpoints
- Python API integration (evidence matching)

### ⚠️ **Partial (20%)**
- Smart prompts (needs enhancement)
- Evidence matching (needs better integration)
- Auto-claim routes (placeholder only)

### ❌ **Missing (50%)**
- Profit Recovery Dashboard
- Auto-submission logic
- Auto-submit rules engine
- Recovery statistics
- Evidence matching endpoints

---

## 🚀 Quick Start: Build Profit Recovery Dashboard

**This is the highest priority and most visible feature.**

### Step 1: Create Recovery Service
```typescript
// Integrations-backend/src/services/recoveryService.ts
- getRecoveryDashboard(userId)
- getRecoveryHistory(userId, filters)
- getRecoveryStatistics(userId)
- getPendingRecoveries(userId)
```

### Step 2: Create Recovery Routes
```typescript
// Integrations-backend/src/routes/recoveryRoutes.ts
- GET /api/recovery/dashboard
- GET /api/recovery/history
- GET /api/recovery/statistics
- GET /api/recovery/pending
```

### Step 3: Aggregate Data
- Query `detection_results` table
- Calculate totals, by type, by status
- Include confidence breakdown
- Add trends over time

---

## 💡 Next Steps

1. **Start with Profit Recovery Dashboard** (highest value)
2. **Then Auto-Submission** (core automation)
3. **Then Smart Prompts** (user experience)
4. **Finally Evidence Matching** (polish)

**Ready to start building?** Let's begin with the Profit Recovery Dashboard! 🚀

