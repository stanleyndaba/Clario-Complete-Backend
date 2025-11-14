# Agent 8: Recoveries Engine — Analysis

**Date:** 2025-01-27  
**Status:** Analysis Complete — Ready for Implementation

---

## 📋 Agent 8 Requirements

1. **Detect payouts from Amazon**
   - Monitor Amazon SP-API for reimbursement events
   - Track when approved cases receive payouts
   - Detect new financial events (reimbursements)

2. **Verify they match the expected claim**
   - Compare actual payout amount vs. expected claim amount
   - Match payout to specific claim/case
   - Detect discrepancies (underpaid, overpaid)

3. **Reconcile amounts and log full lifecycle**
   - Store reconciliation results
   - Log complete recovery lifecycle
   - Track status: Approved → Payout Detected → Reconciled/Discrepancy

---

## ✅ What Exists (Python Backend)

### 1. **Transparency Agent Service** (`claim_detector/src/transparency/transparency_agent_service.py`)
- ✅ `process_claim_status()` — Processes claim status and generates timeline
- ✅ `_reconcile_amounts()` — Reconciles expected vs actual amounts
- ✅ `_build_final_timeline()` — Builds final timeline with reconciliation
- ✅ Reimbursement simulation (for testing)
- ✅ Discrepancy detection (underpaid/overpaid)

**Key Methods:**
```python
def _reconcile_amounts(claim_status, reimbursement_event) -> Dict:
    expected_amount = claim_status.get('amount', 0)
    actual_amount = reimbursement_event.get('amount', 0) if reimbursement_event else 0
    discrepancy = abs(expected_amount - actual_amount)
    threshold = 0.01  # 1 cent threshold
    
    return {
        'expected_amount': expected_amount,
        'actual_amount': actual_amount,
        'discrepancy': discrepancy,
        'status': 'reconciled' if discrepancy <= threshold else 'discrepancy',
        'discrepancy_type': 'underpaid' if actual_amount < expected_amount else 'overpaid'
    }
```

### 2. **Reimbursement Simulator** (`claim_detector/src/transparency/reimbursement_simulator.py`)
- ✅ `simulate_reimbursement()` — Simulates reimbursement events
- ✅ Deterministic simulation for testing
- ✅ Reimbursement rate configuration (default 95%)

### 3. **Timeline Manager** (`claim_detector/src/transparency/timeline_manager.py`)
- ✅ Tracks complete claim lifecycle
- ✅ Manages timeline events
- ✅ Status history tracking

---

## ✅ What Exists (TypeScript Backend)

### 1. **Amazon Service - Payment Tracking** (`src/services/amazonService.ts`)
- ✅ `trackPaymentStatusChanges()` — Tracks payment status changes
- ✅ `fetchClaims()` — Fetches reimbursements from SP-API
- ✅ `fetchFinancialEvents()` — Fetches financial events
- ✅ Payment reconciliation logic
- ✅ SSE events for payment updates

**Key Features:**
```typescript
// Reconcile payment amount (Transparency Agent)
if (claim.status === 'approved' && previousClaim) {
  const expectedAmount = previousClaim.estimated_value;
  const actualAmount = claim.amount;
  const discrepancy = Math.abs(expectedAmount - actualAmount);
  
  if (discrepancy > 0.01) {
    // Send discrepancy event
    sseHub.sendEvent(accountId, 'payment_discrepancy', {...});
  } else {
    // Send reconciled event
    sseHub.sendEvent(accountId, 'payment_reconciled', {...});
  }
}
```

### 2. **Recoveries API** (`src/api/recoveries.py`)
- ✅ `GET /api/recoveries` — Get list of recoveries
- ✅ `GET /api/recoveries/{id}` — Get specific recovery
- ✅ `GET /api/recoveries/{id}/status` — Get recovery status and timeline
- ✅ Integrates with refund engine client

### 3. **Database Tables (Partial)**
- ✅ `payout_monitoring` — Tracks payouts (from workflow orchestrator migration)
- ✅ `dispute_submissions` — Tracks submissions (from Agent 7)
- ✅ `dispute_cases` — Tracks cases (from Agent 6)
- ✅ `financial_events` — Stores financial events from SP-API
- ✅ `detection_results` — Stores detected claims

---

## ❌ What's Missing (TypeScript Backend)

### 1. **No TypeScript Recoveries Worker**
- ❌ No automated background worker (like Agents 4, 5, 6, 7)
- ❌ No cron/queue scheduling for payout detection
- ❌ Payout detection only happens on-demand or during sync

### 2. **No Recoveries Service**
- ❌ No TypeScript service wrapping payout detection logic
- ❌ No automated matching of payouts to claims
- ❌ No reconciliation service at TypeScript level

### 3. **No Integration with Agent 7**
- ❌ Agent 7 doesn't trigger recovery detection when cases are approved
- ❌ No automatic recovery detection when `status = 'approved'`
- ❌ No connection between filing and recovery

### 4. **No Automated Payout Detection**
- ❌ No background worker polling Amazon for new payouts
- ❌ Payout detection only happens during sync or manual API calls
- ❌ No real-time payout detection

### 5. **No Recovery Lifecycle Logging**
- ❌ No dedicated `recoveries` or `recovery_lifecycle` table
- ❌ No structured logging of recovery lifecycle
- ❌ Reconciliation results not stored persistently

### 6. **No Database Migration**
- ❌ No migration for recovery worker tables
- ❌ No `recoveries` table
- ❌ No `recovery_lifecycle_logs` table

---

## 🔍 Current Payout Detection Flow

### **Existing Flow:**
```
Amazon Sync Job
  ↓
  fetchClaims() → Gets reimbursements from SP-API
  ↓
  saveClaimsToDatabase() → Saves to financial_events
  ↓
  trackPaymentStatusChanges() → Compares with previous claims
  ↓
  Sends SSE events (payment_approved, payment_discrepancy, payment_reconciled)
```

### **Gaps:**
1. Only runs during sync (not continuous)
2. No matching of payouts to specific filed cases
3. No persistent storage of reconciliation results
4. No automated detection when cases are approved

---

## 🏗️ What Needs to Be Built

### 1. **`recoveriesService.ts`** — Service Wrapper
- Wraps payout detection logic
- Matches payouts to claims
- Performs reconciliation
- Stores reconciliation results

### 2. **`recoveriesWorker.ts`** — Automated Background Worker
- Runs every 10 minutes
- Polls for approved cases (`status = 'approved'` from Agent 7)
- Fetches new payouts from Amazon SP-API
- Matches payouts to claims
- Performs reconciliation
- Logs full lifecycle

### 3. **Integration with Agent 7**
- Agent 7's status polling should trigger recovery detection
- When case status changes to `approved`, mark for recovery detection
- Agent 8 picks up and detects payouts

### 4. **Payout Matching Logic**
- Match payouts to claims by:
  - `amazon_case_id` (from Agent 7)
  - `order_id`
  - `asin` + `sku` + date range
  - Amount matching (fuzzy match within threshold)

### 5. **Reconciliation Logic**
- Compare expected amount (from claim) vs actual amount (from payout)
- Detect discrepancies (underpaid, overpaid)
- Store reconciliation results
- Log discrepancies for review

### 6. **Database Migration**
- Create `recoveries` table
- Create `recovery_lifecycle_logs` table
- Add `recovery_status` column to `dispute_cases`
- Add `reconciled_at`, `actual_amount`, `discrepancy` columns

---

## 📊 Database Schema Requirements

### **New Table: `recoveries`**
```sql
CREATE TABLE recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id),
  user_id TEXT NOT NULL,
  amazon_case_id TEXT,
  expected_amount DECIMAL(10,2) NOT NULL,
  actual_amount DECIMAL(10,2),
  discrepancy DECIMAL(10,2),
  discrepancy_type TEXT, -- 'underpaid', 'overpaid', 'none'
  reconciliation_status TEXT, -- 'pending', 'reconciled', 'discrepancy', 'failed'
  payout_date TIMESTAMPTZ,
  amazon_reimbursement_id TEXT,
  matched_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### **New Table: `recovery_lifecycle_logs`**
```sql
CREATE TABLE recovery_lifecycle_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_id UUID REFERENCES recoveries(id),
  dispute_id UUID REFERENCES dispute_cases(id),
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'payout_detected', 'matched', 'reconciled', 'discrepancy_detected'
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### **New Columns:**
- `dispute_cases.recovery_status` — `pending`, `detecting`, `matched`, `reconciled`, `discrepancy`
- `dispute_cases.reconciled_at` — Timestamp of reconciliation
- `dispute_cases.actual_payout_amount` — Actual amount received

---

## 🔄 Integration Flow

```
Agent 7 (Refund Filing Worker)
  ↓
  Case status = 'approved' (from Amazon)
  ↓
  Sets dispute_cases.recovery_status = 'pending'
  ↓
Agent 8 (Recoveries Worker)
  ↓
  Polls for cases with recovery_status = 'pending'
  ↓
  Fetches new payouts from Amazon SP-API
  ↓
  Matches payouts to claims (by amazon_case_id, order_id, amount)
  ↓
  Performs reconciliation (expected vs actual)
  ↓
  Updates recovery_status = 'reconciled' or 'discrepancy'
  ↓
  Logs full lifecycle in recovery_lifecycle_logs
  ↓
  If Reconciled: Ready for Agent 9 (Billing Engine)
  ↓
  If Discrepancy: Flags for manual review
```

---

## 🎯 Implementation Plan

### **Phase 1: Core Recovery Service**
1. Create `recoveriesService.ts` — Payout detection and matching
2. Create `recoveriesWorker.ts` — Automated background worker
3. Create database migration
4. Register worker in `index.ts`

### **Phase 2: Integration with Agent 7**
1. Update Agent 7 to set `recovery_status = 'pending'` when approved
2. Agent 8 picks up and detects payouts

### **Phase 3: Payout Matching**
1. Implement matching logic (amazon_case_id, order_id, amount)
2. Handle fuzzy matching for edge cases
3. Store matches in `recoveries` table

### **Phase 4: Reconciliation**
1. Implement reconciliation logic
2. Detect discrepancies
3. Store reconciliation results
4. Log lifecycle events

### **Phase 5: Testing**
1. Create test script
2. Test payout detection
3. Test matching logic
4. Test reconciliation

---

## 📝 Summary

**Python Backend:** ✅ Partial
- Transparency Agent exists with reconciliation logic
- Reimbursement simulator exists (for testing)
- Timeline management exists

**TypeScript Backend:** ❌ Missing
- No automated recovery worker
- No service wrapper
- No integration with Agent 7
- No payout matching logic
- No persistent reconciliation storage

**Current State:**
- Payout detection happens during sync (not continuous)
- Reconciliation happens in-memory (not persisted)
- No matching of payouts to specific filed cases
- No automated lifecycle logging

**Next Steps:**
1. Build TypeScript Recoveries Worker
2. Integrate with Agent 7
3. Implement payout matching
4. Implement reconciliation
5. Add lifecycle logging

---

**Ready to proceed with implementation?** 🚀

