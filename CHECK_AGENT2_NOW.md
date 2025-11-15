# ✅ Check Agent 2 Now - Quick Guide

**Status:** Deployment is LIVE  
**Action:** Verify Agent 2 is working

---

## 🔍 Step 1: Trigger a Sync

**Option A: Use Frontend Button**
1. Go to your sync page
2. Click "Start Sync" button
3. Wait for sync to start

**Option B: Use API**
```bash
curl -X POST "https://opside-node-api.onrender.com/api/sync/start" \
  -H "X-User-Id: demo-user" \
  -H "Content-Type: application/json"
```

---

## 🔍 Step 2: Check Render Logs

1. **Go to Render Dashboard:**
   - https://dashboard.render.com
   - Find service: `opside-node-api` (or your Integrations backend)

2. **Open Logs Tab:**
   - Click on your service
   - Click "Logs" tab
   - Filter/Search for: `AGENT 2` or `SYNC JOB MANAGER`

3. **Look for these messages** (should appear within seconds):

### ✅ SUCCESS - Agent 2 is Working:

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

### ❌ FAILURE - Agent 2 NOT Working:

If you see this instead:
```
Starting Amazon sync for user
```
(This is from old `AmazonSyncJob`, not Agent 2)

---

## ✅ Verification Checklist

After triggering a sync, check logs for:

- [ ] `🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync` ✅
- [ ] `🔄 [AGENT 2] Starting data sync` ✅
- [ ] Individual data type syncs (orders, shipments, returns, etc.) ✅
- [ ] `✅ [AGENT 2] Data sync completed` ✅
- [ ] `✅ [SYNC JOB MANAGER] Agent 2 sync completed` ✅
- [ ] `🔍 [AGENT 2→3] Triggering Agent 3 claim detection` ✅

**If you see all of these, Agent 2 is confirmed! ✅**

---

## 🎯 Quick Test

1. **Trigger sync** (button or API)
2. **Immediately go to Render logs**
3. **Search for "AGENT 2"**
4. **Verify messages appear**

**That's it!** If you see the Agent 2 messages, everything is working! 🎉

---

**Ready to check!** Go to Render → Logs → Search "AGENT 2" 🔍

