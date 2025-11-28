# 🔌 Agent-to-Frontend Wiring Status

**Date:** 2025-01-27  
**Strategy:** Complete all agent wiring BEFORE expanding mock data generation

---

## ✅ **FULLY WIRED** (Agents 1-5)

### **Agent 1: OAuth** ✅
- **Page:** `/integrations-hub`, `/auth/amazon-sandbox`
- **Status:** Complete
- **Features:**
  - OAuth flow wired
  - Connection status display
  - Reconnect functionality

### **Agent 2: Data Sync** ✅
- **Page:** `/sync`
- **Status:** Complete
- **Features:**
  - Real-time sync progress (SSE)
  - Orders, shipments, returns, settlements display
  - Sync history
  - Manual sync trigger

### **Agent 3: Claim Detection** ✅
- **Page:** `/sync`, `/recoveries`
- **Status:** Complete
- **Features:**
  - Detection results display
  - Confidence scores
  - Detection metrics
  - Filter by confidence level
  - Merged with synced recoveries

### **Agent 4: Evidence Ingestion** ✅
- **Page:** `/evidence-locker`
- **Status:** Complete
- **Features:**
  - Gmail/Outlook/Drive/Dropbox connection status
  - Unified ingestion button (`POST /api/evidence/ingest/all`)
  - Real-time ingestion progress (SSE)
  - Document list with status
  - Source breakdown display

### **Agent 5: Document Parsing** ✅
- **Page:** `/evidence-locker`, `/documents/:id`
- **Status:** Complete
- **Features:**
  - Parsing status badges (Pending/Processing/Completed/Failed)
  - Manual parse trigger button
  - Parsed metadata display (supplier, invoice #, amount, line items)
  - Confidence scores
  - Real-time parsing updates (SSE)

---

## ⚠️ **PARTIALLY WIRED** (Agents 6-11)

### **Agent 6: Evidence Matching** ⚠️
- **API Endpoint:** `POST /api/evidence/matching/run` ✅
- **Frontend Integration:** ❌ **NOT WIRED**
- **Missing:**
  - No UI component to display matching results
  - No page showing matched evidence → claims
  - No display of match confidence scores
  - No UI for smart prompts (0.5-0.85 confidence)
  - No UI for auto-submitted cases (>=0.85 confidence)
  - No UI for held cases (<0.5 confidence)

**Where it should be wired:**
- **Option 1:** New page `/evidence-matching` or `/matches`
- **Option 2:** Add section to `/recoveries` page
- **Option 3:** Add section to `/evidence-locker` page

**Data to display:**
- Matched evidence documents → claims
- Match confidence scores
- Match status (auto-submitted, smart-prompt, held)
- Evidence quality metrics

---

### **Agent 7: Refund Filing** ⚠️
- **API Endpoint:** `GET /api/disputes/cases` ✅
- **Frontend Integration:** ❌ **NOT WIRED**
- **Missing:**
  - No UI to display filed cases
  - No case status tracking (pending → filing → filed → approved/denied)
  - No display of filing history
  - No retry status for denied cases
  - No Amazon case ID display

**Where it should be wired:**
- **Option 1:** Add to `/recoveries` page (cases section)
- **Option 2:** New page `/cases` or `/disputes`
- **Option 3:** Add to `/recoveries/:caseId` detail page

**Data to display:**
- Case filing status
- Amazon case IDs
- Filing timestamps
- Status transitions (Open → In Progress → Approved/Denied)
- Retry attempts for denied cases

---

### **Agent 8: Recoveries Engine** ⚠️
- **API Endpoint:** `GET /api/recoveries` ✅
- **Frontend Integration:** ⚠️ **PARTIALLY WIRED**
- **Current State:**
  - `/recoveries` page exists
  - Shows detection results (Agent 3)
  - Shows some recovery data
- **Missing:**
  - Full recovery lifecycle display
  - Payout detection status
  - Reconciliation status
  - Recovery amount tracking
  - Lifecycle logs display

**Where it needs enhancement:**
- `/recoveries` page - add recovery lifecycle section
- `/recoveries/:caseId` - add payout/reconciliation details

**Data to display:**
- Recovery status (detected → reconciled → paid)
- Payout amounts
- Reconciliation matches
- Lifecycle event logs

---

### **Agent 9: Billing Engine** ⚠️
- **API Endpoint:** `GET /api/billing/transactions` ✅
- **Frontend Integration:** ⚠️ **WIRED BUT USING MOCK DATA**
- **Current State:**
  - `/billing` page exists
  - UI components complete
  - **Using mock data** (`mockInvoices` array)
- **Missing:**
  - Replace mock data with real API call
  - Connect to `api.getBillingTransactions()`
  - Display real billing transactions
  - Show real commission calculations
  - Display Stripe payment status

**Fix needed:**
```typescript
// Currently: Using mockInvoices
// Should be: api.getBillingTransactions()
```

---

### **Agent 10: Notifications Engine** ⚠️
- **API Endpoint:** `GET /api/notifications` ✅
- **Frontend Integration:** ⚠️ **WIRED BUT USING MOCK DATA**
- **Current State:**
  - `/notifications` page exists
  - UI components complete
  - **Using mock data** (hardcoded notifications array)
- **Missing:**
  - Replace mock data with real API call
  - Connect to `api.getNotifications()`
  - Real-time notification updates (SSE)
  - Mark as read functionality
  - Notification preferences sync

**Fix needed:**
```typescript
// Currently: Using hardcoded notifications array
// Should be: api.getNotifications()
```

---

### **Agent 11: Learning Agent** ⚠️
- **API Endpoint:** `GET /api/learning/metrics` ✅
- **Frontend Integration:** ❌ **NOT WIRED**
- **Missing:**
  - No UI to display learning metrics
  - No model performance charts
  - No threshold optimization history
  - No retraining history
  - No insights display

**Where it should be wired:**
- **Option 1:** New page `/analytics` or `/insights`
- **Option 2:** Add section to `/reports` page
- **Option 3:** Add section to Dashboard

**Data to display:**
- Model performance metrics (accuracy, precision, recall)
- Threshold optimization history
- Retraining events
- Learning insights
- Agent performance trends

---

## 📊 **Summary**

| Agent | Backend API | Frontend Page | Status | Priority |
|-------|-------------|---------------|--------|----------|
| **1** | ✅ | `/integrations-hub` | ✅ Complete | - |
| **2** | ✅ | `/sync` | ✅ Complete | - |
| **3** | ✅ | `/sync`, `/recoveries` | ✅ Complete | - |
| **4** | ✅ | `/evidence-locker` | ✅ Complete | - |
| **5** | ✅ | `/evidence-locker`, `/documents/:id` | ✅ Complete | - |
| **6** | ✅ | ❌ Missing | ❌ **NOT WIRED** | 🔴 **HIGH** |
| **7** | ✅ | ❌ Missing | ❌ **NOT WIRED** | 🔴 **HIGH** |
| **8** | ✅ | `/recoveries` | ⚠️ Partial | 🟡 **MEDIUM** |
| **9** | ✅ | `/billing` | ⚠️ Mock Data | 🟡 **MEDIUM** |
| **10** | ✅ | `/notifications` | ⚠️ Mock Data | 🟡 **MEDIUM** |
| **11** | ✅ | ❌ Missing | ❌ **NOT WIRED** | 🟢 **LOW** |

---

## 🎯 **Recommended Implementation Order**

### **Phase 1: Critical Missing UI (Agents 6 & 7)** 🔴
**Goal:** Wire the core claim-to-filing pipeline

1. **Agent 6: Evidence Matching UI**
   - Create `/evidence-matching` page OR add section to `/recoveries`
   - Display matched evidence → claims
   - Show confidence scores and routing decisions
   - Display smart prompts for user confirmation

2. **Agent 7: Refund Filing UI**
   - Add "Cases" section to `/recoveries` page
   - Display case filing status
   - Show Amazon case IDs and status transitions
   - Display retry history for denied cases

### **Phase 2: Replace Mock Data (Agents 9 & 10)** 🟡
**Goal:** Connect real data to existing UI

3. **Agent 9: Billing - Replace Mock Data**
   - Replace `mockInvoices` with `api.getBillingTransactions()`
   - Connect real commission calculations
   - Display Stripe payment status

4. **Agent 10: Notifications - Replace Mock Data**
   - Replace hardcoded notifications with `api.getNotifications()`
   - Add real-time SSE updates
   - Implement mark-as-read functionality

### **Phase 3: Enhance Existing Pages (Agent 8)** 🟡
**Goal:** Complete recovery lifecycle display

5. **Agent 8: Recoveries Enhancement**
   - Add recovery lifecycle section to `/recoveries`
   - Display payout detection status
   - Show reconciliation matches
   - Add lifecycle event logs

### **Phase 4: Analytics & Insights (Agent 11)** 🟢
**Goal:** Add learning metrics display

6. **Agent 11: Learning Metrics UI**
   - Create `/analytics` page OR add to `/reports`
   - Display model performance charts
   - Show threshold optimization history
   - Display learning insights

---

## ✅ **Validation Checklist**

After completing wiring, validate:

- [ ] All 11 agents have UI representation
- [ ] All API endpoints are called (no mock data)
- [ ] Real-time updates work (SSE where applicable)
- [ ] Error handling is in place
- [ ] Loading states are shown
- [ ] Data flows end-to-end: Agent 1 → Agent 11
- [ ] Mock data generator produces data visible in UI
- [ ] All pages load without errors
- [ ] All agent values are displayed correctly

---

## 🚀 **Next Steps**

1. **Complete Phase 1** (Agents 6 & 7) - Critical for core pipeline
2. **Complete Phase 2** (Agents 9 & 10) - Replace mock data
3. **Complete Phase 3** (Agent 8) - Enhance recoveries
4. **Complete Phase 4** (Agent 11) - Add analytics
5. **Validate end-to-end** - Test full pipeline with mock data
6. **THEN expand mock data** - Once all agents are wired and validated

---

**Last Updated:** 2025-01-27

