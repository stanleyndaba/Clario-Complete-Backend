# Agent 8: Recoveries Engine — Complete ✅

**Date:** 2025-01-27  
**Status:** ✅ **COMPLETE** — Ready for Testing

---

## 📋 Summary

Agent 8 (Recoveries Engine) has been fully implemented with:
- ✅ Automated background worker for payout detection
- ✅ Service wrapper for payout matching and reconciliation
- ✅ Integration with Agent 7 (approved cases trigger recovery)
- ✅ Full lifecycle logging
- ✅ Database migrations
- ✅ Comprehensive test suite

---

## 🏗️ Implementation Details

### **1. Recoveries Service** (`src/services/recoveriesService.ts`)

**Features:**
- Detects payouts from Amazon SP-API (via `financial_events` table and Amazon Service)
- Matches payouts to claims using multiple strategies:
  - By `amazon_case_id` (most reliable)
  - By `order_id` + amount (fuzzy match)
  - By SKU + date range (last resort)
- Performs reconciliation (expected vs actual amount)
- Detects discrepancies (underpaid, overpaid)
- Stores reconciliation results

**Key Methods:**
- `detectPayouts()` — Detects payouts from Amazon for a user
- `matchPayoutToClaim()` — Matches payout to specific claim
- `reconcilePayout()` — Reconciles payout with expected amount
- `processRecoveryForCase()` — Processes recovery for a single case

### **2. Recoveries Worker** (`src/workers/recoveriesWorker.ts`)

**Features:**
- Runs every 10 minutes
- Processes cases with `recovery_status = 'pending'` and `status = 'approved'`
- Detects payouts from Amazon
- Matches payouts to claims
- Performs reconciliation
- Logs full lifecycle

**Key Methods:**
- `start()` — Start the worker
- `stop()` — Stop the worker
- `runRecoveriesForAllTenants()` — Process all cases needing recovery
- `processRecoveryForCase()` — Process recovery for specific case (called by Agent 7)

### **3. Database Migration** (`migrations/015_recoveries_worker.sql`)

**New Tables:**
- `recoveries` — Tracks payout detection and reconciliation
- `recovery_lifecycle_logs` — Logs full lifecycle of recovery processing

**New Columns:**
- `dispute_cases.recovery_status` — Status of recovery process (`pending`, `detecting`, `matched`, `reconciled`, `discrepancy`, `failed`)
- `dispute_cases.reconciled_at` — Timestamp when payout was reconciled
- `dispute_cases.actual_payout_amount` — Actual amount received from Amazon

**Indexes:**
- Indexes on `dispute_id`, `user_id`, `amazon_case_id`, `reconciliation_status`, `matched_at`
- Indexes on lifecycle logs for efficient querying

**RLS Policies:**
- Row-level security for `recoveries` and `recovery_lifecycle_logs`

### **4. Agent 7 Integration** (`src/workers/refundFilingWorker.ts`)

**Changes:**
- `updateCaseStatus()` now sets `recovery_status = 'pending'` when case is approved
- Triggers immediate recovery detection (non-blocking)
- Agent 8 picks up cases automatically in next run

### **5. Worker Registration** (`src/index.ts`)

**Changes:**
- Imported `recoveriesWorker`
- Registered worker with `ENABLE_RECOVERIES_WORKER` environment variable
- Worker starts automatically on server startup

---

## 🔄 Integration Flow

```
Agent 7 (Refund Filing Worker)
  ↓
  Case status = 'approved' (from Amazon)
  ↓
  Sets dispute_cases.recovery_status = 'pending'
  ↓
  Triggers immediate recovery detection (non-blocking)
  ↓
Agent 8 (Recoveries Worker)
  ↓
  Polls for cases with recovery_status = 'pending' and status = 'approved'
  ↓
  Detects payouts from Amazon SP-API (last 30 days)
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

## 📊 Database Schema

### **`recoveries` Table**
```sql
- id (UUID)
- dispute_id (UUID) → References dispute_cases
- user_id (TEXT)
- amazon_case_id (TEXT)
- expected_amount (DECIMAL)
- actual_amount (DECIMAL)
- discrepancy (DECIMAL)
- discrepancy_type (TEXT) — 'underpaid', 'overpaid'
- reconciliation_status (TEXT) — 'pending', 'reconciled', 'discrepancy', 'failed'
- payout_date (TIMESTAMPTZ)
- amazon_reimbursement_id (TEXT)
- matched_at (TIMESTAMPTZ)
- reconciled_at (TIMESTAMPTZ)
- created_at (TIMESTAMPTZ)
- updated_at (TIMESTAMPTZ)
```

### **`recovery_lifecycle_logs` Table**
```sql
- id (UUID)
- recovery_id (UUID) → References recoveries
- dispute_id (UUID) → References dispute_cases
- user_id (TEXT)
- event_type (TEXT) — 'payout_detected', 'matched', 'reconciled', 'discrepancy_detected', 'error'
- event_data (JSONB)
- created_at (TIMESTAMPTZ)
```

### **`dispute_cases` New Columns**
```sql
- recovery_status (TEXT) — 'pending', 'detecting', 'matched', 'reconciled', 'discrepancy', 'failed'
- reconciled_at (TIMESTAMPTZ) — Timestamp when reconciled
- actual_payout_amount (DECIMAL) — Actual amount received
```

---

## ⚙️ Configuration

### **Environment Variables**
```bash
# Python API URL (optional)
PYTHON_API_URL=https://python-api-4-aukq.onrender.com

# Recoveries Worker
ENABLE_RECOVERIES_WORKER=true  # Enable/disable worker

# Reconciliation Configuration
RECONCILIATION_THRESHOLD=0.01  # 1 cent threshold (default)
```

### **Worker Schedule**
- **Recovery Job:** Every 10 minutes (`*/10 * * * *`)

---

## 🧪 Testing

### **Test Script**
```bash
npm run test:agent8
```

**Test Coverage:**
- ✅ Migration verification
- ✅ Service initialization
- ✅ Worker initialization
- ✅ Database operations
- ✅ Integration with Agent 7
- ✅ Payout detection (simulated)
- ✅ Reconciliation logic
- ✅ Lifecycle logging

---

## 🎯 Payout Matching Strategies

### **1. By Amazon Case ID (Most Reliable)**
- Matches `payout.amazonCaseId` to `dispute_cases.provider_case_id` or `amazon_case_id`
- Highest confidence match

### **2. By Order ID + Amount (Fuzzy Match)**
- Matches `payout.orderId` to `dispute_cases.order_id`
- Amount must be within 5% or $1.00 threshold
- Medium confidence match

### **3. By SKU + Date Range (Last Resort)**
- Matches by SKU and date range (last 90 days)
- Amount must be within 10% or $2.00 threshold
- Lower confidence match (logs warning)

---

## 💰 Reconciliation Logic

### **Reconciliation Status:**
- **`reconciled`** — Discrepancy <= threshold (default: $0.01)
- **`discrepancy`** — Discrepancy > threshold
  - `discrepancy_type`: `underpaid` or `overpaid`
  - `discrepancy_percentage`: Percentage difference

### **Discrepancy Detection:**
```typescript
const discrepancy = Math.abs(expectedAmount - actualAmount);
const threshold = 0.01; // 1 cent

if (discrepancy <= threshold) {
  status = 'reconciled';
} else {
  status = 'discrepancy';
  discrepancyType = actualAmount < expectedAmount ? 'underpaid' : 'overpaid';
}
```

---

## 📝 Lifecycle Events

### **Event Types:**
1. **`payout_detected`** — Payout detected from Amazon
2. **`matched`** — Payout matched to claim
3. **`reconciled`** — Payout reconciled successfully
4. **`discrepancy_detected`** — Discrepancy found
5. **`error`** — Error during processing

### **Event Data:**
- Expected amount
- Actual amount
- Discrepancy
- Discrepancy type
- Status
- Timestamps

---

## ✅ Completion Checklist

- [x] Recoveries Service created
- [x] Recoveries Worker created
- [x] Database migration created
- [x] Agent 7 integration complete
- [x] Payout matching implemented
- [x] Reconciliation logic implemented
- [x] Lifecycle logging implemented
- [x] Worker registered in `index.ts`
- [x] Test script created
- [x] Documentation complete

---

**Agent 8 is complete and ready for testing!** 🚀

**Next Agent:** Agent 9 (Billing Engine)

