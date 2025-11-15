# Agent 2 Log Verification Guide

**Date:** November 15, 2024  
**Purpose:** Verify Agent 2 is being used in sync operations

---

## 🔍 How to Verify Agent 2 Usage

### Method 1: Check Backend Logs (Recommended)

After running a sync, check your backend logs for these messages:

#### ✅ Success Indicators (Agent 2 is working):

```
🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync
🔄 [AGENT 2] Starting data sync
📦 [AGENT 2] Fetching orders...
✅ [AGENT 2] Orders synced
🚚 [AGENT 2] Fetching shipments...
✅ [AGENT 2] Shipments synced
↩️ [AGENT 2] Fetching returns...
✅ [AGENT 2] Returns synced
💰 [AGENT 2] Fetching settlements...
✅ [AGENT 2] Settlements synced
📊 [AGENT 2] Fetching inventory...
✅ [AGENT 2] Inventory synced
🎯 [AGENT 2] Fetching claims...
✅ [AGENT 2] Claims synced
✅ [AGENT 2] Data sync completed
✅ [SYNC JOB MANAGER] Agent 2 sync completed
🔍 [AGENT 2→3] Triggering Agent 3 claim detection
```

#### ❌ Failure Indicators (Agent 2 NOT being used):

If you see these instead, Agent 2 is NOT being used:
```
Starting Amazon sync for user  (from AmazonSyncJob)
```

---

### Method 2: Check Sync Result Data

Agent 2 returns a comprehensive summary. Check the sync result:

**Agent 2 Response Structure:**
```typescript
{
  success: boolean;
  syncId: string;
  userId: string;
  summary: {
    ordersCount: number;
    shipmentsCount: number;
    returnsCount: number;
    settlementsCount: number;
    inventoryCount: number;
    claimsCount: number;
    feesCount: number;
  };
  normalized: {
    orders: any[];
    shipments: any[];
    returns: any[];
    settlements: any[];
    inventory: any[];
    claims: any[];
  };
  isMock: boolean;
  duration: number;
}
```

**If you see this structure in logs, Agent 2 is working! ✅**

---

### Method 3: Check Database

Query the `agent_events` table for Agent 2 events:

```sql
SELECT * FROM agent_events 
WHERE agent = 'data_sync' 
  AND user_id = 'your-user-id'
ORDER BY created_at DESC 
LIMIT 10;
```

**Expected Events:**
- `sync_started`
- `sync_completed`
- `sync_failed` (if error occurred)

---

### Method 4: Check Sync Progress Messages

Agent 2 sync shows these progress messages:

1. **10%**: "Starting data sync..."
2. **20%**: "Fetching orders from Amazon SP-API..."
3. **40%**: "Syncing data (orders, shipments, returns, settlements, inventory, claims)..."
4. **70%**: "Data normalization complete. Processing results..."
5. **80%**: "Waiting for claim detection (Agent 3)..."
6. **100%**: "Sync completed successfully - X items synced"

**If you see these messages, Agent 2 is working! ✅**

---

## 🧪 Quick Verification Test

Run this test and check logs:

```bash
# Start a sync
curl -X POST "https://opside-node-api.onrender.com/api/sync/start" \
  -H "X-User-Id: demo-user" \
  -H "Content-Type: application/json"

# Then check your backend logs for the messages above
```

---

## ✅ Verification Checklist

- [ ] Logs show "🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync"
- [ ] Logs show "🔄 [AGENT 2] Starting data sync"
- [ ] Logs show individual data type syncs (orders, shipments, etc.)
- [ ] Logs show "✅ [AGENT 2] Data sync completed"
- [ ] Logs show "✅ [SYNC JOB MANAGER] Agent 2 sync completed"
- [ ] Logs show "🔍 [AGENT 2→3] Triggering Agent 3 claim detection"
- [ ] Sync progress messages match Agent 2 stages
- [ ] Database has `agent_events` entries for `data_sync`
- [ ] Sync result shows comprehensive summary (all data types)

---

## 🎯 Conclusion

**If you see all the success indicators above, Agent 2 integration is confirmed! ✅**

**If you see failure indicators, Agent 2 is NOT being used and needs investigation.**

---

**Next:** Check your backend logs and verify Agent 2 messages appear! 🔍

