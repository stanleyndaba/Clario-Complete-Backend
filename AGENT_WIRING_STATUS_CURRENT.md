# Current Agent Wiring Status to Frontend

**Last Updated:** After Evidence Matching (Agent 6) integration

## ✅ FULLY WIRED AGENTS (1-7)

### Agent 1: OAuth/Amazon Connection
- **Status:** ✅ Fully Wired
- **Pages:** `IntegrationsHub.tsx`, `AmazonConnect.tsx`
- **API Methods:** `api.connectAmazon()`, `api.getIntegrationsStatus()`
- **Features:**
  - OAuth flow for Amazon SP-API
  - Connection status display
  - Reconnection handling

### Agent 2: Data Sync
- **Status:** ✅ Fully Wired
- **Pages:** `Sync.tsx`, `SmartInventorySync.tsx`
- **API Methods:** `api.getSyncStatus()`, `api.startAmazonSync()`
- **Features:**
  - Real-time sync progress via SSE
  - Orders, shipments, returns, settlements sync
  - Sync history and activity logs

### Agent 3: Claim Detection
- **Status:** ✅ Fully Wired
- **Pages:** `Sync.tsx`, `Recoveries.tsx`, `Detections.tsx`
- **API Methods:** `api.runClaimDetection()`, `api.getDetectionStatus()`
- **Features:**
  - Automatic detection after sync
  - Detection results display
  - Claims list in Recoveries page
  - Real-time updates via SSE

### Agent 4: Evidence Ingestion
- **Status:** ✅ Fully Wired
- **Pages:** `EvidenceLocker.tsx`, `IntegrationsHub.tsx`
- **API Methods:** `api.ingestAllEvidence()`, `api.ingestGmailEvidence()`, `api.ingestOutlookEvidence()`
- **Features:**
  - Unified ingestion from all sources (Gmail, Outlook, Drive, Dropbox)
  - Real-time ingestion status
  - Document upload (drag & drop)
  - SSE events for ingestion completion

### Agent 5: Document Parsing
- **Status:** ✅ Fully Wired
- **Pages:** `EvidenceLocker.tsx`
- **API Methods:** `api.triggerDocumentParse()`, `api.getDocumentWithParsedData()`
- **Features:**
  - Automatic parsing after ingestion
  - Manual parse trigger
  - Parsing status display
  - Confidence scores
  - Real-time parsing updates via SSE

### Agent 6: Evidence Matching
- **Status:** ✅ Fully Wired (Just Completed)
- **Pages:** `EvidenceLocker.tsx`, `Recoveries.tsx` (Evidence Matching tab)
- **API Methods:** `api.runEvidenceMatching()`, `api.getMatchingResults()`, `api.getDocumentMatchingResults()`
- **Features:**
  - Real-time matching results in Document Activity Log
  - Evidence Matching table in Recoveries page
  - Document Library shows matched claims
  - SSE events for matching completion
  - Match statistics (auto-submitted, smart prompts, held)

### Agent 7: Refund Filing (Dispute Cases)
- **Status:** ✅ Fully Wired
- **Pages:** `Recoveries.tsx` (Dispute Cases tab)
- **API Methods:** `api.getDisputeCases()`
- **Features:**
  - Dispute cases table
  - Status filtering
  - Case details with Amazon case IDs
  - Filing status tracking

---

## ⚠️ PARTIALLY WIRED AGENTS (8)

### Agent 8: Recoveries Engine
- **Status:** ⚠️ Partially Wired (Has API but uses mock data fallback)
- **Pages:** `Recoveries.tsx`, `CaseDetail.tsx`
- **API Methods:** `api.getRecoveryRecords()`, `api.getRecoveryStatus()`, `api.getRecoveryDetail()`
- **Current State:**
  - API methods exist and are called
  - Page has mock data fallback when API fails
  - Recovery records display works but may show mock data
  - Case detail page exists
- **What's Missing:**
  - Ensure real data is always used (remove/update mock fallback)
  - Full recovery lifecycle integration
  - Payout detection and reconciliation display

---

## ❌ NOT WIRED / USING MOCK DATA (9-11)

### Agent 9: Billing Engine
- **Status:** ❌ Using Mock Data
- **Pages:** `Billing.tsx`
- **API Methods:** `api.getBillingTransactions()` (exists but not used)
- **Current State:**
  - Page uses hardcoded `mockInvoices` array
  - No API calls to fetch real billing data
  - Invoice display works but shows fake data
- **What's Needed:**
  - Replace mock data with `api.getBillingTransactions()` calls
  - Display real invoices, commissions, payment status
  - Connect to billing worker data

### Agent 10: Notifications Engine
- **Status:** ❌ Using Mock Data
- **Pages:** `NotificationHub.tsx`
- **API Methods:** `api.getNotifications()` (exists but not used)
- **Current State:**
  - Page uses hardcoded `notifications` array
  - No API calls to fetch real notifications
  - Notification preferences UI exists but not connected
- **What's Needed:**
  - Replace mock data with `api.getNotifications()` calls
  - Display real notifications from database
  - Connect notification preferences to backend
  - Real-time notification updates via SSE

### Agent 11: Learning Agent
- **Status:** ❌ Not Wired (No UI)
- **Pages:** None (no dedicated page)
- **API Methods:** `api.getLearningMetrics()` (exists)
- **Current State:**
  - API method exists but no page uses it
  - Learning worker runs in background
  - No UI to display learning metrics/analytics
- **What's Needed:**
  - Create Learning/Analytics page or add to Dashboard
  - Display learning metrics (success rates, optimization stats)
  - Show agent performance improvements over time
  - A/B test results, confidence score trends

---

## Summary

### Fully Wired: 7/11 Agents (64%)
- ✅ Agent 1: OAuth/Amazon Connection
- ✅ Agent 2: Data Sync
- ✅ Agent 3: Claim Detection
- ✅ Agent 4: Evidence Ingestion
- ✅ Agent 5: Document Parsing
- ✅ Agent 6: Evidence Matching
- ✅ Agent 7: Refund Filing

### Partially Wired: 1/11 Agents (9%)
- ⚠️ Agent 8: Recoveries Engine (has API, uses mock fallback)

### Not Wired: 3/11 Agents (27%)
- ❌ Agent 9: Billing Engine (mock data)
- ❌ Agent 10: Notifications Engine (mock data)
- ❌ Agent 11: Learning Agent (no UI)

---

## Next Steps Priority

### High Priority (Complete Core Flow)
1. **Agent 8 (Recoveries)** - Remove mock fallback, ensure real data always used
2. **Agent 9 (Billing)** - Replace mock invoices with real API calls
3. **Agent 10 (Notifications)** - Replace mock notifications with real API calls

### Medium Priority (Analytics & Insights)
4. **Agent 11 (Learning)** - Create analytics page to show learning metrics

---

## Notes

- All backend agents (1-11) are fully implemented and working
- Frontend API methods exist for all agents
- Main gap is UI integration for Agents 9-11
- Agent 8 needs mock fallback removed/improved
- SSE events are set up for Agents 1-7, need to add for 8-10 if needed

