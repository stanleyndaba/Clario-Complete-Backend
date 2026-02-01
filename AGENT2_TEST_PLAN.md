# Agent 2 Integration Test Plan

**Date:** November 15, 2024  
**Status:** Ready for Testing  
**Purpose:** Verify Agent 2 integration works correctly after fix

---

## 🧪 Test Scenarios

### Test 1: Manual Sync via API ✅
**Purpose:** Verify `POST /api/sync/start` triggers Agent 2

**Steps:**
1. Ensure Amazon account is connected
2. Call `POST /api/sync/start` with authenticated user
3. Verify response contains `syncId`
4. Check logs for "🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync"
5. Verify sync status shows progress updates

**Expected Results:**
- ✅ Returns `{ syncId: "...", status: "in_progress" }`
- ✅ Logs show Agent 2 sync starting
- ✅ Progress updates reflect Agent 2 stages:
  - 10%: "Starting data sync..."
  - 20%: "Fetching orders from Amazon SP-API..."
  - 40%: "Syncing data (orders, shipments, returns, settlements, inventory, claims)..."
  - 70%: "Data normalization complete. Processing results..."
  - 80%: "Waiting for claim detection (Agent 3)..."
  - 100%: "Sync completed successfully - X items synced"

**Test Command:**
```bash
curl -X POST "https://opside-node-api.onrender.com/api/sync/start" \
  -H "X-User-Id: test-user-123" \
  -H "Cookie: session_token=..."
```

---

### Test 2: Sync Status Polling ✅
**Purpose:** Verify sync status endpoint returns Agent 2 data

**Steps:**
1. Start sync (Test 1)
2. Poll `GET /api/sync/status` every 3 seconds
3. Verify status updates show Agent 2 progress
4. Verify completion shows total items synced

**Expected Results:**
- ✅ Status shows `hasActiveSync: true` during sync
- ✅ Progress updates from 0-100%
- ✅ Message reflects Agent 2 stages
- ✅ Completion shows: "Sync completed successfully - X items synced"
- ✅ `ordersProcessed` and `totalOrders` populated from Agent 2

**Test Command:**
```bash
# Get active sync status
curl -X GET "https://opside-node-api.onrender.com/api/sync/status" \
  -H "X-User-Id: test-user-123" \
  -H "Cookie: session_token=..."

# Get specific sync status
curl -X GET "https://opside-node-api.onrender.com/api/sync/status/sync_abc123" \
  -H "X-User-Id: test-user-123" \
  -H "Cookie: session_token=..."
```

---

### Test 3: Agent 2 Data Normalization ✅
**Purpose:** Verify Agent 2 syncs all data types

**Steps:**
1. Start sync
2. Wait for completion
3. Check database for synced data:
   - Orders
   - Shipments
   - Returns
   - Settlements
   - Inventory
   - Claims

**Expected Results:**
- ✅ All data types synced (or attempted)
- ✅ Data normalized and stored in database
- ✅ Agent 2 logs show summary counts
- ✅ Sync result shows comprehensive summary

**Database Queries:**
```sql
-- Check orders
SELECT COUNT(*) FROM orders WHERE user_id = 'test-user-123';

-- Check claims
SELECT COUNT(*) FROM claims WHERE user_id = 'test-user-123';

-- Check sync progress
SELECT * FROM sync_progress WHERE user_id = 'test-user-123' ORDER BY created_at DESC LIMIT 1;
```

---

### Test 4: Agent 3 Auto-Trigger ✅
**Purpose:** Verify Agent 2 automatically triggers Agent 3

**Steps:**
1. Start sync
2. Wait for Agent 2 to complete
3. Check logs for "🔍 [AGENT 2→3] Triggering Agent 3 claim detection"
4. Verify detection queue has job for this sync

**Expected Results:**
- ✅ Agent 3 triggered automatically after Agent 2
- ✅ Detection job created in `detection_queue`
- ✅ Logs show Agent 2→3 integration

**Database Query:**
```sql
SELECT * FROM detection_queue 
WHERE seller_id = 'test-user-123' 
ORDER BY created_at DESC LIMIT 1;
```

---

### Test 5: Error Handling ✅
**Purpose:** Verify error handling works correctly

**Steps:**
1. Disconnect Amazon account (or use invalid token)
2. Attempt to start sync
3. Verify error message is clear
4. Verify sync status shows failed state

**Expected Results:**
- ✅ Error: "Amazon connection not found. Please connect your Amazon account first."
- ✅ Sync status shows `status: "failed"`
- ✅ Error message in sync status response

---

### Test 6: Duplicate Sync Prevention ✅
**Purpose:** Verify only one sync can run at a time

**Steps:**
1. Start sync
2. Immediately try to start another sync
3. Verify second request is rejected

**Expected Results:**
- ✅ Error: "Sync already in progress (sync_abc123). Please wait for it to complete or cancel it first."
- ✅ Status code: 400 Bad Request

---

### Test 7: Sync Cancellation ✅
**Purpose:** Verify sync can be cancelled

**Steps:**
1. Start sync
2. Call `POST /api/sync/cancel/:syncId`
3. Verify sync stops
4. Verify status shows cancelled

**Expected Results:**
- ✅ Sync stops executing
- ✅ Status shows `status: "cancelled"`
- ✅ Message: "Sync cancelled by user"

**Test Command:**
```bash
curl -X POST "https://opside-node-api.onrender.com/api/sync/cancel/sync_abc123" \
  -H "X-User-Id: test-user-123" \
  -H "Cookie: session_token=..."
```

---

### Test 8: OAuth → Agent 2 Flow ✅
**Purpose:** Verify OAuth callback triggers Agent 2

**Steps:**
1. Complete Amazon OAuth flow
2. Check logs for "🔄 [AGENT 1→2] Triggering Agent 2 data sync"
3. Verify sync starts automatically
4. Verify sync completes

**Expected Results:**
- ✅ OAuth callback triggers Agent 2
- ✅ Sync runs in background
- ✅ Logs show Agent 1→2 integration
- ✅ Sync completes successfully

---

## 📊 Test Results Template

```
Test 1: Manual Sync via API
  [ ] Pass
  [ ] Fail
  Notes: ________________

Test 2: Sync Status Polling
  [ ] Pass
  [ ] Fail
  Notes: ________________

Test 3: Agent 2 Data Normalization
  [ ] Pass
  [ ] Fail
  Notes: ________________

Test 4: Agent 3 Auto-Trigger
  [ ] Pass
  [ ] Fail
  Notes: ________________

Test 5: Error Handling
  [ ] Pass
  [ ] Fail
  Notes: ________________

Test 6: Duplicate Sync Prevention
  [ ] Pass
  [ ] Fail
  Notes: ________________

Test 7: Sync Cancellation
  [ ] Pass
  [ ] Fail
  Notes: ________________

Test 8: OAuth → Agent 2 Flow
  [ ] Pass
  [ ] Fail
  Notes: ________________
```

---

## 🔍 Logs to Monitor

**Success Indicators:**
- `🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync`
- `🔄 [AGENT 2] Starting data sync`
- `✅ [AGENT 2] Data sync completed`
- `✅ [SYNC JOB MANAGER] Agent 2 sync completed`
- `🔍 [AGENT 2→3] Triggering Agent 3 claim detection`

**Error Indicators:**
- `❌ [AGENT 2] Fatal sync error`
- `❌ [SYNC JOB MANAGER] Agent 2 sync failed`
- `Agent 2 sync failed: ...`

---

## ✅ Success Criteria

All tests must pass for Agent 2 integration to be considered complete:
- ✅ Manual sync triggers Agent 2
- ✅ Status polling works correctly
- ✅ All data types synced
- ✅ Agent 3 auto-triggers
- ✅ Error handling works
- ✅ Duplicate sync prevention works
- ✅ Sync cancellation works
- ✅ OAuth flow triggers Agent 2

---

## 🚀 Quick Test Script

```bash
#!/bin/bash
# Quick Agent 2 Integration Test

USER_ID="test-user-123"
BASE_URL="https://opside-node-api.onrender.com"

echo "🧪 Testing Agent 2 Integration..."

# Test 1: Start Sync
echo "1. Starting sync..."
SYNC_RESPONSE=$(curl -s -X POST "$BASE_URL/api/sync/start" \
  -H "X-User-Id: $USER_ID" \
  -H "Cookie: session_token=...")

SYNC_ID=$(echo $SYNC_RESPONSE | jq -r '.syncId')
echo "   Sync ID: $SYNC_ID"

# Test 2: Poll Status
echo "2. Polling sync status..."
for i in {1..20}; do
  STATUS=$(curl -s -X GET "$BASE_URL/api/sync/status/$SYNC_ID" \
    -H "X-User-Id: $USER_ID" \
    -H "Cookie: session_token=...")
  
  PROGRESS=$(echo $STATUS | jq -r '.progress')
  STATUS_VAL=$(echo $STATUS | jq -r '.status')
  MESSAGE=$(echo $STATUS | jq -r '.message')
  
  echo "   Progress: $PROGRESS% | Status: $STATUS_VAL | $MESSAGE"
  
  if [ "$STATUS_VAL" = "completed" ] || [ "$STATUS_VAL" = "failed" ]; then
    echo "   ✅ Sync $STATUS_VAL"
    break
  fi
  
  sleep 3
done

echo "✅ Test complete!"
```

---

**Ready for Testing!** 🚀






