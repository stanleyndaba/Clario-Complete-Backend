# PHASE 1 — Data Intake & Sync Agent

## 🎯 PHASE 1 GOAL

**Agent:** Sync Bot  
**Inputs:** SP-API endpoints, historical reports  
**Outputs:** Raw operational datasets  
**AI/Automation:** No ML model here - Pure API automation, rate-limited parallel sync  
**Purpose:** Build the "truth pipe". Everything downstream relies on this.

---

## 📋 WHAT PHASE 1 DOES

### Pure Data Sync - NO Detection, NO Analysis

1. **Connect to Amazon SP-API** (sandbox)
2. **Fetch 18 months of raw data** from SP-API endpoints:
   - Orders (18 months)
   - Inventory
   - Financial Events (fees, reimbursements, adjustments)
   - Shipments
3. **Save raw data to database** (no processing, no analysis)
4. **Rate-limited parallel sync** (respects SP-API limits)
5. **Output:** Raw operational datasets ready for Phase 2

---

## ✅ PHASE 1 SUCCESS CRITERIA

Phase 1 is successful when:

1. ✅ User connects to Amazon (sandbox)
2. ✅ Sync automatically starts
3. ✅ Sync fetches 18 months of data from SP-API
4. ✅ Data is saved to database (raw, unprocessed)
5. ✅ Sync respects rate limits (parallel, but throttled)
6. ✅ User sees sync progress
7. ✅ Sync completes successfully

**NO detection, NO analysis, NO claims - JUST DATA SYNC**

---

## 🔍 WHAT TO TEST

### Test 1: Connection
- [ ] User clicks "Connect Amazon"
- [ ] Connection succeeds
- [ ] User sees "Connected to Amazon!"

### Test 2: Automatic Sync Trigger
- [ ] Sync starts automatically after connection
- [ ] Backend logs show "Starting Amazon sync"
- [ ] Sync job ID is created

### Test 3: Data Fetching (18 Months)
- [ ] Backend logs show "Fetching orders from SP-API SANDBOX (18 months of data)"
- [ ] Backend logs show "Fetching claims from SP-API SANDBOX (18 months of data)"
- [ ] Backend logs show "Fetching fees from SP-API SANDBOX (18 months of data)"
- [ ] Backend logs show "Fetching inventory from SP-API SANDBOX"
- [ ] SP-API calls are made with correct date ranges (18 months)

### Test 4: Rate Limiting
- [ ] Sync respects rate limits (delays between calls)
- [ ] Parallel requests are throttled appropriately
- [ ] No rate limit errors in logs

### Test 5: Data Storage
- [ ] Orders saved to database
- [ ] Claims/reimbursements saved to database
- [ ] Fees saved to database
- [ ] Inventory saved to database
- [ ] All data is RAW (no processing/analysis)

### Test 6: Progress Updates
- [ ] User sees sync progress (real-time)
- [ ] User sees "Syncing your data..."
- [ ] User sees "Found X orders"
- [ ] User sees sync completion

---

## 🐛 CURRENT ISSUES

1. **Sync not starting automatically?**
2. **Sync not fetching 18 months?**
3. **Data not being saved?**
4. **Rate limiting not working?**
5. **Progress updates not showing?**

---

## 📝 NEXT STEPS

1. Verify sync triggers automatically
2. Verify 18 months date range
3. Verify data is saved to database
4. Verify rate limiting works
5. Verify progress updates work


