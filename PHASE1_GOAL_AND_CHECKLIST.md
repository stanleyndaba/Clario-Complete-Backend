# Phase 1: Zero-Friction Onboarding - GOAL & CHECKLIST

## 🎯 PHASE 1 GOAL

**When a user lands on the page and presses "Connect Amazon" (sandbox):**

1. ✅ **Connection**: User connects to Amazon SP-API sandbox
2. ✅ **Data Sync**: System syncs **18 months** of their data
3. ✅ **Analysis**: System analyzes all data to find discrepancies
4. ✅ **Discovery**: System spots and finds everything (potential claims/recoveries)

---

## 📋 PHASE 1 STEP-BY-STEP FLOW

### Step 1: User Clicks "Connect Amazon"
- **Action**: User presses button
- **Expected**: OAuth flow or bypass flow works
- **Result**: Amazon account connected

### Step 2: Automatic Data Sync (18 Months)
- **Action**: System automatically starts syncing
- **Expected**: Fetches last 18 months of data from SP-API sandbox
- **Data Types**:
  - Orders (last 18 months)
  - Inventory
  - Financial Events (fees, reimbursements, adjustments)
  - Shipments
- **Result**: All data saved to database

### Step 3: Data Analysis & Discrepancy Detection
- **Action**: System analyzes synced data
- **Expected**: Finds discrepancies and potential claims
- **What to Find**:
  - Lost inventory
  - Damaged goods
  - Fee overcharges
  - Missing reimbursements
  - Adjustment discrepancies
- **Result**: List of potential claims/recoveries identified

### Step 4: Display Results
- **Action**: Show user what was found
- **Expected**: Dashboard shows:
  - Total potential recovery amount
  - Number of claims found
  - Breakdown by type
- **Result**: User sees all discovered discrepancies

---

## ✅ PHASE 1 CHECKLIST

### Connection (Step 1)
- [ ] User can click "Connect Amazon" button
- [ ] OAuth flow works OR bypass flow works (sandbox)
- [ ] Connection is validated (refresh token works)
- [ ] User sees "Connected to Amazon!" message
- [ ] Connection status is saved to database

### Data Sync (Step 2)
- [ ] Sync job starts automatically after connection
- [ ] Sync fetches **18 months** of orders from SP-API sandbox
- [ ] Sync fetches inventory data
- [ ] Sync fetches financial events (fees, reimbursements)
- [ ] Sync fetches shipments data
- [ ] All data is saved to database
- [ ] User sees sync progress (real-time updates)
- [ ] User sees "Syncing your data... (X seconds)"
- [ ] User sees "Found X orders to analyze"

### Analysis & Detection (Step 3)
- [ ] Detection job runs automatically after sync completes
- [ ] System analyzes all synced data
- [ ] System finds discrepancies:
  - [ ] Lost inventory claims
  - [ ] Damaged goods claims
  - [ ] Fee overcharge claims
  - [ ] Missing reimbursement claims
  - [ ] Adjustment discrepancies
- [ ] Claims are saved to database
- [ ] Confidence scores are calculated
- [ ] User sees "Analyzing your orders..."
- [ ] User sees "Found $X in recoverable funds"

### Display Results (Step 4)
- [ ] Dashboard shows total potential recovery amount
- [ ] Dashboard shows number of claims found
- [ ] Dashboard shows breakdown by claim type
- [ ] User sees "Potential recovery: $X detected"
- [ ] All discovered discrepancies are visible

---

## 🔍 WHAT TO TEST

### Test 1: Connection
1. Go to page
2. Click "Connect Amazon" (or "Use Existing Connection")
3. **Verify**: Connection succeeds
4. **Verify**: User sees "Connected!" message

### Test 2: Data Sync (18 Months)
1. After connection, wait for sync to start
2. **Verify**: Sync job starts automatically
3. **Verify**: Backend logs show SP-API calls
4. **Verify**: Backend fetches 18 months of data
5. **Verify**: Data is saved to database
6. **Verify**: User sees sync progress
7. **Verify**: User sees "Found X orders to analyze"

### Test 3: Analysis & Detection
1. After sync completes, wait for detection
2. **Verify**: Detection job runs automatically
3. **Verify**: Backend logs show analysis
4. **Verify**: Claims are found and saved
5. **Verify**: User sees "Analyzing your orders..."
6. **Verify**: User sees "Found $X in recoverable funds"

### Test 4: Display Results
1. Check dashboard
2. **Verify**: Total recovery amount is shown
3. **Verify**: Number of claims is shown
4. **Verify**: Breakdown by type is shown
5. **Verify**: All discrepancies are visible

---

## 🐛 CURRENT ISSUES TO FIX

### Issue 1: Python Backend Connection (502 errors)
- **Problem**: `/api/recoveries` returns 502
- **Impact**: Can't display results
- **Fix**: Verify Python backend URL and connection

### Issue 2: SSE Connection (MIME type error)
- **Problem**: Real-time updates not working
- **Impact**: User doesn't see sync progress
- **Fix**: Verify SSE endpoint returns `text/event-stream`

### Issue 3: 18 Months Data Sync
- **Problem**: Need to verify sync fetches 18 months
- **Impact**: May not get all data
- **Fix**: Check sync job date range configuration

### Issue 4: Automatic Detection
- **Problem**: Need to verify detection runs after sync
- **Impact**: Claims may not be found
- **Fix**: Verify detection job triggers automatically

---

## 🎯 SUCCESS CRITERIA

Phase 1 is successful when:

1. ✅ User can connect to Amazon (sandbox) in < 60 seconds
2. ✅ System automatically syncs 18 months of data
3. ✅ System automatically analyzes data and finds discrepancies
4. ✅ User sees all discovered potential recoveries
5. ✅ Everything works end-to-end without errors

---

## 📝 NEXT STEPS

1. **Fix blocking issues** (502 errors, SSE errors)
2. **Test connection** (verify OAuth/bypass works)
3. **Test data sync** (verify 18 months fetched)
4. **Test detection** (verify claims found)
5. **Test display** (verify results shown)













