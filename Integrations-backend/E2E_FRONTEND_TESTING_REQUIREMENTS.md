# 🧪 E2E Frontend Testing Requirements - Complete Checklist

## 🎯 Goal
**Test the frontend with mock data (water through veins) to ensure all UI components, API calls, and data flows work correctly before real SP-API keys arrive.**

---

## 📋 **What the Frontend Needs (By Page/Component)**

### **1. Dashboard (`/app` or `/dashboard`)**

#### **API Calls Made:**
- `GET /api/v1/integrations/amazon/recoveries` - **Recovered Value Card**
- `GET /api/metrics/recoveries` - **Metrics (Pending, Approved, Success Rate)**
- `GET /api/v1/integrations/amazon/upcoming-payments` - **Upcoming Payments**
- `GET /api/recoveries` (fallback) - **Recoveries List**
- `GET /api/evidence/status` - **Evidence Status**
- `GET /api/v1/integrations/gmail/status` - **Gmail Connection Status**
- `GET /api/detections/statistics` - **Detection Statistics**
- `GET /api/notifications` - **Recent Logs/Notifications**
- `POST /api/sync/start` - **Run Sync Button**
- `GET /api/sync/status` - **Sync Status Polling**
- `GET /api/sse/status` - **SSE for Real-time Updates**

#### **Expected Data Structures:**

**`/api/v1/integrations/amazon/recoveries` Response:**
```json
{
  "totalAmount": 1250.50,
  "currency": "USD",
  "claimCount": 15,
  "source": "database",  // or "api"
  "dataSource": "spapi_sandbox",  // or "spapi_production"
  "message": "Found 15 claims from database",
  "needsSync": false,
  "syncTriggered": false
}
```

**`/api/metrics/recoveries` Response:**
```json
{
  "valueInProgress": 500.00,  // or "pendingAmount"
  "successRate": 0.92,  // or "successRate30d"
  "approvedValue": 750.50,  // or "valueApproved", "paidValue", "valuePaid"
  "nextPaymentAmount": 250.00,  // or "nextPayoutAmount", "expectedPayoutAmount"
  "approvedClaimsThisMonth": 12  // or "claimsApprovedThisMonth"
}
```

**`/api/v1/integrations/amazon/upcoming-payments` Response:**
```json
{
  "recoveries": [
    {
      "id": "rec-123",
      "guaranteedAmount": 50.00,  // or "amount", "claim_amount", "expectedAmount"
      "expectedPayoutDate": "2025-02-15",  // or "expected_payout_date", "payoutDate"
      "status": "pending"
    }
  ]
}
```

**`/api/detections/statistics` Response:**
```json
{
  "statistics": {
    "totalDetections": 25,
    "highConfidence": 15,
    "mediumConfidence": 7,
    "lowConfidence": 3,
    "estimatedRecovery": 1250.00,
    "averageConfidence": 0.85
  }
}
```

**`/api/notifications` Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "notif-123",
      "title": "Funds Deposited",
      "message": "$50.00 has been deposited for Case CASE-123-456",
      "status": "unread",  // or "read"
      "created_at": "2025-01-15T10:30:00Z",
      "type": "FUNDS_DEPOSITED"
    }
  ]
}
```

#### **What Needs to Exist in Database (Mock Data):**
- ✅ `dispute_cases` table with records (status: "Submitted", "approved", "Paid Out")
- ✅ `recoveries` table with records linked to `dispute_cases`
- ✅ `financial_events` table with reimbursement records
- ✅ `notifications` table with notification records
- ✅ `detection_results` table with detection records
- ⚠️ **MISSING**: Mock data generator that populates all these tables with realistic test data

---

### **2. Recoveries Page (`/recoveries`)**

#### **API Calls Made:**
- `GET /api/v1/integrations/amazon/upcoming-payments` - **Primary endpoint**
- `GET /api/recoveries` - **Fallback endpoint**
- `GET /api/recoveries/:id` - **Recovery Details**
- `GET /api/recoveries/:id/status` - **Recovery Status**
- `POST /api/recoveries/:id/submit` - **Submit Claim**
- `POST /api/recoveries/:id/resubmit` - **Resubmit Claim**
- `GET /api/recoveries/:id/document` - **Recovery Document URL**

#### **Expected Data Structures:**

**`/api/v1/integrations/amazon/upcoming-payments` Response:**
```json
{
  "recoveries": [
    {
      "id": "rec-123",
      "dispute_id": "case-456",
      "user_id": "user-789",
      "expected_amount": 50.00,
      "actual_amount": null,
      "guaranteedAmount": 50.00,
      "amount": 50.00,
      "claim_amount": 50.00,
      "expectedPayoutDate": "2025-02-15",
      "expected_payout_date": "2025-02-15",
      "status": "pending",
      "reconciliation_status": "pending",
      "created_at": "2025-01-15T10:00:00Z",
      "updated_at": "2025-01-15T10:00:00Z"
    }
  ]
}
```

#### **What Needs to Exist in Database:**
- ✅ `dispute_cases` table with various statuses
- ✅ `recoveries` table linked to `dispute_cases`
- ⚠️ **MISSING**: Mock data that creates a full flow (detected → submitted → approved → paid)

---

### **3. Sync/Inventory Page (`/sync` or `/smart-inventory-sync`)**

#### **API Calls Made:**
- `POST /api/v1/integrations/amazon/sync` - **Start Sync**
- `GET /api/v1/integrations/amazon/sync/status` - **Sync Status**
- `GET /api/sync/status` - **Legacy Sync Status**
- `GET /api/sync/activity` - **Sync Activity History**
- `GET /api/sse/status` - **SSE for Real-time Updates**

#### **Expected Data Structures:**

**`/api/v1/integrations/amazon/sync/status` Response:**
```json
{
  "hasActiveSync": true,
  "lastSync": {
    "syncId": "sync-123",
    "status": "in_progress",  // or "completed", "failed", "cancelled"
    "message": "Syncing orders...",
    "progress": 0.65,
    "startedAt": "2025-01-15T10:00:00Z",
    "completedAt": null
  }
}
```

#### **What Needs to Exist:**
- ✅ Mock sync service that simulates sync progress
- ⚠️ **MISSING**: Mock data that simulates sync creating orders, shipments, returns, settlements

---

### **4. Admin Page (`/admin`)**

#### **API Calls Made:**
- `GET /api/learning/metrics` - **Model Performance**
- `GET /api/learning/threshold-history` - **Threshold History**
- `GET /api/learning/insights` - **Learning Insights**

#### **Expected Data Structures:**

**`/api/learning/metrics` Response:**
```json
{
  "modelPerformance": {
    "accuracy": 0.92,
    "precision": 0.88,
    "recall": 0.95,
    "f1Score": 0.91,
    "totalPredictions": 1000,
    "correctPredictions": 920
  }
}
```

**`/api/learning/threshold-history` Response:**
```json
{
  "thresholds": [
    {
      "id": "thresh-123",
      "threshold_type": "confidence",
      "old_value": 0.80,
      "new_value": 0.85,
      "reason": "Optimized based on success rate",
      "created_at": "2025-01-15T10:00:00Z"
    }
  ]
}
```

#### **What Needs to Exist:**
- ⚠️ **MISSING**: Mock learning metrics data
- ⚠️ **MISSING**: Mock threshold history data

---

## 🔍 **What's Missing vs What Exists**

### ✅ **What EXISTS:**
1. **Backend API Endpoints** - Most endpoints are implemented
2. **Mock Amazon Service** - `mockAmazonService.ts` generates mock orders, shipments
3. **Golden Flow Script** - `golden_flow.ts` creates test data in database
4. **Database Schema** - All tables exist (dispute_cases, recoveries, etc.)

### ⚠️ **What's MISSING:**

#### **1. Comprehensive Mock Data Generator**
**Problem:** `golden_flow.ts` only creates ONE test case. Frontend needs multiple records to test:
- Pagination
- Filtering
- Sorting
- Large datasets

**Solution Needed:**
```typescript
// scripts/generate-mock-data-for-frontend.ts
- Generate 100+ dispute_cases with various statuses
- Generate 100+ recoveries linked to cases
- Generate 100+ notifications
- Generate 100+ detection_results
- Generate financial_events for reimbursements
- Generate sync_jobs for sync history
```

#### **2. Mock Data for All Endpoints**
**Missing Mock Data:**
- ❌ `/api/metrics/recoveries` - Needs aggregated metrics
- ❌ `/api/metrics/dashboard` - Needs dashboard aggregates
- ❌ `/api/detections/statistics` - Needs detection stats
- ❌ `/api/learning/metrics` - Needs learning metrics
- ❌ `/api/learning/threshold-history` - Needs threshold history
- ❌ `/api/notifications` - Needs notification records (partially exists)
- ❌ `/api/sync/activity` - Needs sync activity history

#### **3. Mock Sync Service**
**Problem:** Frontend expects sync to create real data (orders, shipments, etc.)

**Solution Needed:**
- Mock sync that populates `amazon_orders`, `amazon_shipments`, `amazon_returns`, `amazon_settlements` tables
- Mock sync progress updates via SSE

#### **4. Mock Evidence/Documents**
**Problem:** Frontend calls evidence/document endpoints but no mock data exists

**Solution Needed:**
- Mock documents in `documents` table
- Mock evidence links in `dispute_evidence_links` table

---

## 🛠️ **Implementation Checklist**

### **Phase 1: Mock Data Generator (CRITICAL)**

- [ ] **Create `scripts/generate-mock-data-for-frontend.ts`**
  - [ ] Generate 100+ `dispute_cases` with statuses: "pending", "Submitted", "approved", "Paid Out"
  - [ ] Generate 100+ `recoveries` linked to `dispute_cases`
  - [ ] Generate 50+ `financial_events` (reimbursements)
  - [ ] Generate 100+ `notifications` (various types)
  - [ ] Generate 100+ `detection_results` (various confidence levels)
  - [ ] Generate 20+ `sync_jobs` (history)
  - [ ] Generate 50+ `documents` (invoices, receipts)
  - [ ] Generate 50+ `dispute_evidence_links`

- [ ] **Create `scripts/clear-mock-data.ts`**
  - [ ] Clear all test data before generating new data
  - [ ] Preserve real user data

### **Phase 2: Mock API Responses**

- [ ] **`/api/metrics/recoveries`**
  - [ ] Calculate `valueInProgress` from pending recoveries
  - [ ] Calculate `successRate` from approved/total ratio
  - [ ] Calculate `approvedValue` from approved recoveries
  - [ ] Calculate `nextPaymentAmount` from upcoming payments
  - [ ] Calculate `approvedClaimsThisMonth` from monthly approved

- [ ] **`/api/metrics/dashboard`**
  - [ ] Aggregate dashboard metrics from database
  - [ ] Return `DashboardMetrics` structure

- [ ] **`/api/detections/statistics`**
  - [ ] Calculate stats from `detection_results` table
  - [ ] Group by confidence level (high/medium/low)
  - [ ] Calculate `estimatedRecovery` sum

- [ ] **`/api/learning/metrics`**
  - [ ] Return mock model performance metrics
  - [ ] Calculate from historical detection results

- [ ] **`/api/learning/threshold-history`**
  - [ ] Return mock threshold optimization history
  - [ ] Generate historical threshold changes

- [ ] **`/api/sync/activity`**
  - [ ] Return sync job history from `sync_jobs` table
  - [ ] Include status, duration, records synced

### **Phase 3: Mock Sync Service**

- [ ] **Enhance `mockAmazonService.ts`**
  - [ ] Add method to generate bulk orders (1000+)
  - [ ] Add method to generate bulk shipments (500+)
  - [ ] Add method to generate bulk returns (200+)
  - [ ] Add method to generate bulk settlements (500+)

- [ ] **Create `scripts/mock-sync-run.ts`**
  - [ ] Simulate sync that populates `amazon_orders` table
  - [ ] Simulate sync that populates `amazon_shipments` table
  - [ ] Simulate sync that populates `amazon_returns` table
  - [ ] Simulate sync that populates `amazon_settlements` table
  - [ ] Create `sync_jobs` record with progress updates

### **Phase 4: SSE (Server-Sent Events)**

- [ ] **Verify `/api/sse/status` endpoint**
  - [ ] Emit `sync_started`, `sync_progress`, `sync_completed` events
  - [ ] Emit `detection_started`, `detection_completed` events
  - [ ] Emit `recovery_detected`, `recovery_reconciled` events
  - [ ] Emit `notification_created` events

### **Phase 5: Testing Scripts**

- [ ] **Create `scripts/test-frontend-e2e.ts`**
  - [ ] Run `generate-mock-data-for-frontend.ts`
  - [ ] Verify all API endpoints return data
  - [ ] Check response formats match frontend expectations
  - [ ] Test pagination, filtering, sorting

- [ ] **Create `scripts/test-frontend-api-endpoints.ts`**
  - [ ] Test all endpoints called by frontend
  - [ ] Verify response schemas
  - [ ] Check error handling

---

## 🧪 **Testing Workflow**

### **Step 1: Generate Mock Data**
```bash
cd Integrations-backend
npm run generate-mock-data-for-frontend
```

### **Step 2: Verify Database**
```bash
# Check that tables are populated
# Use Supabase dashboard or SQL queries
```

### **Step 3: Start Backend**
```bash
npm run dev
```

### **Step 4: Test Frontend**
1. Open frontend in browser
2. Navigate to `/app` (Dashboard)
3. Verify all cards display data
4. Navigate to `/recoveries`
5. Verify recoveries list displays
6. Test pagination, filtering, sorting
7. Navigate to `/sync`
8. Start a sync and verify progress
9. Navigate to `/admin`
10. Verify learning metrics display

### **Step 5: Test API Endpoints Directly**
```bash
# Test recoveries endpoint
curl http://localhost:3000/api/v1/integrations/amazon/recoveries \
  -H "Authorization: Bearer <token>"

# Test metrics endpoint
curl http://localhost:3000/api/metrics/recoveries \
  -H "Authorization: Bearer <token>"
```

---

## 📊 **Success Criteria**

### **Must Pass (Before Real SP-API):**
- ✅ Dashboard displays "Recovered Value" with mock data
- ✅ Dashboard displays "Pending Recovery" with mock data
- ✅ Dashboard displays "Next Payment" with mock data
- ✅ Dashboard displays "Approved" amount with mock data
- ✅ Recoveries page displays list of recoveries
- ✅ Recoveries page supports pagination (100+ items)
- ✅ Recoveries page supports filtering by status
- ✅ Recoveries page supports sorting
- ✅ Sync page shows sync progress
- ✅ Sync creates mock orders/shipments/returns
- ✅ Admin page displays learning metrics
- ✅ Notifications display in "Recent Logs"
- ✅ All API endpoints return expected data structures

### **Nice to Have:**
- ✅ Real-time updates via SSE work
- ✅ Large dataset performance (1000+ records)
- ✅ Error handling displays correctly
- ✅ Loading states work correctly

---

## 🚨 **Known Issues to Fix**

1. **Missing Aggregated Metrics**
   - `/api/metrics/recoveries` needs to calculate from database
   - `/api/metrics/dashboard` needs to aggregate data

2. **Missing Mock Data Volume**
   - Only 1 test case exists, need 100+ for realistic testing

3. **Missing Sync Data Population**
   - Sync doesn't populate `amazon_orders`, `amazon_shipments` tables

4. **Missing Learning Metrics**
   - `/api/learning/metrics` returns empty or mock data only

---

## 📝 **Next Steps**

1. **IMMEDIATE:** Create `generate-mock-data-for-frontend.ts` script
2. **IMMEDIATE:** Implement missing API endpoint responses
3. **HIGH:** Enhance mock sync to populate database tables
4. **MEDIUM:** Add learning metrics mock data
5. **LOW:** Performance testing with large datasets

---

## 🔗 **Related Files**

- `Integrations-backend/scripts/golden_flow.ts` - Current test data generator
- `Integrations-backend/src/services/mockAmazonService.ts` - Mock Amazon data service
- `Integrations-backend/E2E_FRONTEND_TESTING_PLAN.md` - Original testing plan
- `opside-complete-frontend/src/lib/api.ts` - Frontend API client
- `opside-complete-frontend/src/components/layout/Dashboard.tsx` - Dashboard component

---

**Last Updated:** 2025-01-15
**Status:** 🟡 In Progress - Mock Data Generation Needed

