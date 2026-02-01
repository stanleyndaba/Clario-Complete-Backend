# Verify Agent 2 on Render - Quick Guide

**Date:** November 15, 2024  
**Purpose:** Check Render logs to confirm Agent 2 is being used

---

## 🔍 How to Check Render Logs

### Method 1: Render Dashboard (Easiest)

1. **Go to Render Dashboard:**
   - Navigate to: https://dashboard.render.com
   - Find your service: `opside-node-api` (or your Integrations backend service)

2. **Open Logs:**
   - Click on your service
   - Click "Logs" tab
   - Filter/search for: `AGENT 2` or `SYNC JOB MANAGER`

3. **Look for these messages:**
   ```
   🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync
   🔄 [AGENT 2] Starting data sync
   ✅ [AGENT 2] Data sync completed
   ✅ [SYNC JOB MANAGER] Agent 2 sync completed
   ```

### Method 2: Render CLI (If Installed)

```bash
# Install Render CLI (if not installed)
npm install -g render-cli

# Login
render login

# View logs
render logs --service opside-node-api --tail
```

### Method 3: API Logs Endpoint (If Available)

Some Render services expose logs via API. Check if your service has:
```
GET /api/logs
GET /api/debug/logs
```

---

## 🧪 Quick Test to Generate Logs

Run this to trigger a sync and generate logs:

```bash
# Start a sync (this will generate logs)
curl -X POST "https://opside-node-api.onrender.com/api/sync/start" \
  -H "X-User-Id: demo-user" \
  -H "Content-Type: application/json"

# Then immediately check Render logs
```

---

## ✅ What to Look For

### Success Indicators ✅

**When sync starts, you should see:**
```
info: 🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync { userId: 'demo-user', syncId: 'sync_...' }
info: 🔄 [AGENT 2] Starting data sync { userId: 'demo-user', syncId: 'agent2_sync_...' }
info: 📦 [AGENT 2] Fetching orders... { userId: 'demo-user', syncId: 'agent2_sync_...' }
info: ✅ [AGENT 2] Orders synced { userId: 'demo-user', syncId: 'agent2_sync_...', count: X }
info: 🚚 [AGENT 2] Fetching shipments... { userId: 'demo-user', syncId: 'agent2_sync_...' }
info: ✅ [AGENT 2] Shipments synced { userId: 'demo-user', syncId: 'agent2_sync_...', count: X }
info: ↩️ [AGENT 2] Fetching returns... { userId: 'demo-user', syncId: 'agent2_sync_...' }
info: ✅ [AGENT 2] Returns synced { userId: 'demo-user', syncId: 'agent2_sync_...', count: X }
info: 💰 [AGENT 2] Fetching settlements... { userId: 'demo-user', syncId: 'agent2_sync_...' }
info: ✅ [AGENT 2] Settlements synced { userId: 'demo-user', syncId: 'agent2_sync_...', count: X }
info: 📊 [AGENT 2] Fetching inventory... { userId: 'demo-user', syncId: 'agent2_sync_...' }
info: ✅ [AGENT 2] Inventory synced { userId: 'demo-user', syncId: 'agent2_sync_...', count: X }
info: 🎯 [AGENT 2] Fetching claims... { userId: 'demo-user', syncId: 'agent2_sync_...' }
info: ✅ [AGENT 2] Claims synced { userId: 'demo-user', syncId: 'agent2_sync_...', count: X }
info: ✅ [AGENT 2] Data sync completed { userId: 'demo-user', syncId: 'agent2_sync_...', success: true }
info: ✅ [SYNC JOB MANAGER] Agent 2 sync completed { userId: 'demo-user', syncId: 'sync_...', success: true }
info: 🔍 [AGENT 2→3] Triggering Agent 3 claim detection { userId: 'demo-user', syncId: 'agent2_sync_...' }
```

### Failure Indicators ❌

**If you see these instead, Agent 2 is NOT being used:**
```
info: Starting Amazon sync for user { userId: 'demo-user', syncId: 'sync_...' }
```
(This is from `AmazonSyncJob`, not `Agent2DataSyncService`)

---

## 🔍 Log Search Tips

### In Render Dashboard:

1. **Use Search/Filter:**
   - Search for: `AGENT 2`
   - Search for: `SYNC JOB MANAGER`
   - Search for: `agent2DataSyncService`

2. **Filter by Time:**
   - Set time range to "Last 15 minutes" or "Last hour"
   - This shows recent sync activity

3. **Filter by Log Level:**
   - Look for `info` level logs (Agent 2 uses info level)
   - Ignore `debug` or `warn` unless looking for errors

---

## 📊 Expected Log Flow

**Complete Agent 2 sync log sequence:**

```
1. 🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync
2. 🔄 [AGENT 2] Starting data sync
3. 📦 [AGENT 2] Fetching orders...
4. ✅ [AGENT 2] Orders synced (count: X)
5. 🚚 [AGENT 2] Fetching shipments...
6. ✅ [AGENT 2] Shipments synced (count: X)
7. ↩️ [AGENT 2] Fetching returns...
8. ✅ [AGENT 2] Returns synced (count: X)
9. 💰 [AGENT 2] Fetching settlements...
10. ✅ [AGENT 2] Settlements synced (count: X)
11. 📊 [AGENT 2] Fetching inventory...
12. ✅ [AGENT 2] Inventory synced (count: X)
13. 🎯 [AGENT 2] Fetching claims...
14. ✅ [AGENT 2] Claims synced (count: X)
15. ✅ [AGENT 2] Data sync completed
16. ✅ [SYNC JOB MANAGER] Agent 2 sync completed
17. 🔍 [AGENT 2→3] Triggering Agent 3 claim detection
```

**If you see this sequence, Agent 2 is confirmed! ✅**

---

## 🚨 Troubleshooting

### If you DON'T see Agent 2 messages:

1. **Check deployment:**
   - Verify latest code is deployed
   - Check if Render auto-deployed after git push
   - May need to manually redeploy

2. **Check service:**
   - Verify you're looking at the correct service
   - Check if service is running
   - Verify logs are from the right time

3. **Check code:**
   - Verify `syncJobManager.ts` has the fix
   - Check import statement uses `agent2DataSyncService`
   - Verify no build errors

---

## ✅ Verification Checklist

- [ ] Opened Render dashboard
- [ ] Found correct service (Integrations backend)
- [ ] Opened Logs tab
- [ ] Triggered a sync (via API or frontend button)
- [ ] Searched for "AGENT 2" in logs
- [ ] Found "🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync"
- [ ] Found "🔄 [AGENT 2] Starting data sync"
- [ ] Found individual data type syncs (orders, shipments, etc.)
- [ ] Found "✅ [AGENT 2] Data sync completed"
- [ ] Found "✅ [SYNC JOB MANAGER] Agent 2 sync completed"
- [ ] Found "🔍 [AGENT 2→3] Triggering Agent 3 claim detection"

**If all checked, Agent 2 is confirmed! ✅**

---

## 🎯 Quick Verification Command

Run this to trigger a sync and then check Render logs:

```bash
# Trigger sync
curl -X POST "https://opside-node-api.onrender.com/api/sync/start" \
  -H "X-User-Id: demo-user" \
  -H "Content-Type: application/json"

# Then go to Render dashboard → Logs → Search for "AGENT 2"
```

---

**Ready to check Render logs!** 🔍






