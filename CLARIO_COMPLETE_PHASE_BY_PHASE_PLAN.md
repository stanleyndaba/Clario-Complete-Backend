# Clario Complete System - Phase-by-Phase Fix Plan

## 🎯 Overview

This document outlines the complete Clario system from a seller's perspective and identifies what needs to be fixed in each phase.

---

## 📋 PHASE 1: ZERO-FRICTION ONBOARDING (60 seconds)

### ✅ What Should Happen:
1. Seller clicks "Connect Amazon Account"
2. OAuth flow → Amazon SP-API authorization
3. Seller approves (1 click)
4. Callback → User profile created → Database
5. Background sync job triggered automatically
6. WebSocket connection established
7. Seller sees: "Connected!", "Syncing...", "Found X orders", "Potential recovery: $X"

### 🔍 Current Status:
- ✅ OAuth flow exists but has issues
- ✅ "Use Existing Connection" bypass works (now validates connection)
- ✅ Sync job can be triggered
- ❌ **ISSUE**: 502 errors when accessing `/api/recoveries` (Python backend connection)
- ❌ **ISSUE**: WebSocket/SSE connection errors
- ❌ **ISSUE**: Real-time updates not working

### 🛠️ What Needs to be Fixed:
1. **Fix Python backend proxy connection** (502 errors)
   - Verify Python backend URL is correct
   - Test connection with health check endpoint
   - Fix proxy error handling

2. **Fix WebSocket/SSE connection**
   - EventSource MIME type error: `text/html` instead of `text/event-stream`
   - Need to verify SSE endpoint is working

3. **Ensure automatic sync triggers**
   - Verify sync job starts after OAuth callback
   - Check sync status endpoint works
   - Verify data is being pulled from SP-API sandbox

4. **Real-time progress updates**
   - WebSocket connection for live updates
   - Progress indicators during sync
   - Success/failure notifications

---

## 📋 PHASE 2: AUTONOMOUS MONEY DISCOVERY (Real-time)

### ✅ What Should Happen:
1. Claim Detector Model scans orders
2. ML Confidence Scoring (High/Medium/Low)
3. Evidence Validator checks each claim
4. Real-time WebSocket updates to seller

### 🔍 Current Status:
- ✅ Claim Detector Model exists
- ✅ ML models for 13 claim types
- ✅ Confidence scoring implemented
- ❓ **UNKNOWN**: Is detection running automatically after sync?
- ❓ **UNKNOWN**: Are claims being detected from SP-API data?
- ❓ **UNKNOWN**: Are WebSocket updates working?

### 🛠️ What Needs to be Fixed:
1. **Verify detection runs after sync**
   - Check if detection job triggers automatically
   - Verify claims are being detected from synced data
   - Test detection endpoint

2. **Verify confidence scoring**
   - Check if confidence scores are calculated
   - Verify high/medium/low thresholds work
   - Test auto-submit logic

3. **Real-time updates**
   - Fix WebSocket/SSE for detection progress
   - Show "Analyzing orders..." updates
   - Display detection results in real-time

---

## 📋 PHASE 3: INTELLIGENT EVIDENCE ECOSYSTEM (Automatic)

### ✅ What Should Happen:
1. Gmail integration scans for Amazon emails
2. Google Drive integration scans for invoices/receipts
3. OCR extracts data from documents
4. Smart Matching Engine matches evidence to claims

### 🔍 Current Status:
- ❓ **UNKNOWN**: Gmail integration status
- ❓ **UNKNOWN**: Google Drive integration status
- ❓ **UNKNOWN**: OCR processing status
- ❓ **UNKNOWN**: Matching engine status

### 🛠️ What Needs to be Fixed:
1. **Gmail Integration**
   - Verify OAuth flow works
   - Test email scanning
   - Verify OCR extraction

2. **Google Drive Integration**
   - Verify OAuth flow works
   - Test file scanning
   - Verify OCR extraction

3. **Smart Matching Engine**
   - Test invoice → order matching
   - Verify confidence scoring
   - Test auto-submit logic

---

## 📋 PHASE 4: PREDICTIVE REFUND ORCHESTRATION (Smart Decisions)

### ✅ What Should Happen:
1. Claim Analysis with ML prediction
2. Auto-submit for high confidence (85%+)
3. Smart prompts for medium confidence (50-85%)
4. Manual review for low confidence (<50%)

### 🔍 Current Status:
- ✅ ML prediction exists
- ✅ Confidence scoring exists
- ❓ **UNKNOWN**: Auto-submit logic working?
- ❓ **UNKNOWN**: Smart prompts working?
- ❓ **UNKNOWN**: Manual review queue working?

### 🛠️ What Needs to be Fixed:
1. **Auto-submit logic**
   - Verify high confidence claims auto-submit
   - Test submission to Amazon SP-API
   - Verify status tracking

2. **Smart prompts**
   - Verify medium confidence claims show prompts
   - Test prompt UI/UX
   - Verify seller can upload missing documents

3. **Manual review**
   - Verify low confidence claims go to review
   - Test review interface
   - Verify manual submission works

---

## 📋 PHASE 5: AUTONOMOUS RECOVERY PIPELINE (The Money Conveyor)

### ✅ What Should Happen:
1. Claim preparation (Amazon-compliant XML)
2. SP-API submission
3. Real-time tracking (Submitted → Under Review → Approved)
4. Payout monitoring
5. Stripe fee processing

### 🔍 Current Status:
- ❓ **UNKNOWN**: SP-API submission working?
- ❓ **UNKNOWN**: Status tracking working?
- ❓ **UNKNOWN**: Payout monitoring working?
- ❓ **UNKNOWN**: Stripe integration working?

### 🛠️ What Needs to be Fixed:
1. **SP-API Submission**
   - Verify claim submission to Amazon
   - Test XML formatting
   - Verify evidence attachment

2. **Status Tracking**
   - Verify status updates from Amazon
   - Test WebSocket updates
   - Verify database updates

3. **Payout Monitoring**
   - Verify payment detection
   - Test Stripe fee calculation
   - Verify seller payout

---

## 📋 PHASE 6: CONTINUOUS LEARNING BRAIN (Self-Improving)

### ✅ What Should Happen:
1. Rejection Logger tags rejections
2. Knowledge Base updates requirements
3. Rules Engine updates rules
4. ML Model retrains with rejection data
5. System improves success rate over time

### 🔍 Current Status:
- ❓ **UNKNOWN**: Rejection logging working?
- ❓ **UNKNOWN**: Knowledge base updates?
- ❓ **UNKNOWN**: Rules engine updates?
- ❓ **UNKNOWN**: ML model retraining?

### 🛠️ What Needs to be Fixed:
1. **Rejection Logging**
   - Verify rejections are logged
   - Test tagging system
   - Verify data collection

2. **Learning System**
   - Verify knowledge base updates
   - Test rules engine updates
   - Verify ML model retraining

---

## 📋 PHASE 7: HYPER-TRANSPARENCY LAYER (Trust Engine)

### ✅ What Should Happen:
1. Real-time dashboard with metrics
2. Drill-down capability for each claim
3. Proof packets (PDF reports)
4. Audit trail
5. Accountant export

### 🔍 Current Status:
- ✅ Dashboard exists
- ❌ **ISSUE**: `/api/metrics/recoveries` returns 502/404
- ❓ **UNKNOWN**: Drill-down working?
- ❓ **UNKNOWN**: Proof packets working?
- ❓ **UNKNOWN**: Audit trail working?

### 🛠️ What Needs to be Fixed:
1. **Metrics Endpoint**
   - Fix `/api/metrics/recoveries` 502 error
   - Verify metrics calculation
   - Test dashboard display

2. **Drill-down**
   - Verify claim details page works
   - Test reasoning display
   - Verify evidence display

3. **Proof Packets**
   - Verify PDF generation
   - Test email delivery
   - Verify document archive

---

## 🚀 PRIORITY FIX ORDER

### **IMMEDIATE (Phase 1 - Blocking Issues):**
1. ✅ Fix Python backend proxy connection (502 errors) - IN PROGRESS
2. ⏳ Fix WebSocket/SSE connection (MIME type error)
3. ⏳ Verify automatic sync triggers after OAuth
4. ⏳ Verify SP-API data is being pulled

### **HIGH PRIORITY (Phase 1 - Core Functionality):**
5. ⏳ Verify detection runs after sync
6. ⏳ Fix metrics endpoint (502/404 errors)
7. ⏳ Test real-time updates

### **MEDIUM PRIORITY (Phase 2-3):**
8. ⏳ Verify claim detection working
9. ⏳ Test confidence scoring
10. ⏳ Verify evidence integration (Gmail/Drive)

### **LOW PRIORITY (Phase 4-7):**
11. ⏳ Test auto-submit logic
12. ⏳ Test smart prompts
13. ⏳ Verify SP-API submission
14. ⏳ Test learning system

---

## 📝 NEXT STEPS

1. **Start with Phase 1 fixes** (blocking issues)
2. **Test each phase systematically**
3. **Document what works and what doesn't**
4. **Fix issues phase-by-phase**
5. **Verify end-to-end flow works**

---

## 🔍 TESTING CHECKLIST

### Phase 1 Testing:
- [ ] OAuth flow completes successfully
- [ ] Sync job triggers automatically
- [ ] SP-API data is pulled from sandbox
- [ ] `/api/recoveries` endpoint works (no 502)
- [ ] `/api/metrics/recoveries` endpoint works (no 502/404)
- [ ] WebSocket/SSE connection works
- [ ] Real-time updates display

### Phase 2 Testing:
- [ ] Detection runs after sync
- [ ] Claims are detected from orders
- [ ] Confidence scores are calculated
- [ ] High/medium/low classification works

### Phase 3 Testing:
- [ ] Gmail integration works
- [ ] Google Drive integration works
- [ ] OCR extraction works
- [ ] Matching engine works

### Phase 4 Testing:
- [ ] Auto-submit works for high confidence
- [ ] Smart prompts work for medium confidence
- [ ] Manual review works for low confidence

### Phase 5 Testing:
- [ ] SP-API submission works
- [ ] Status tracking works
- [ ] Payout monitoring works

### Phase 6 Testing:
- [ ] Rejection logging works
- [ ] Learning system updates

### Phase 7 Testing:
- [ ] Dashboard displays correctly
- [ ] Drill-down works
- [ ] Proof packets generate


