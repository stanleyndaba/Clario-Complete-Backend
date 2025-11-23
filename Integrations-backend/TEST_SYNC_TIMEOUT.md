# Sync Agent Timeout Test Guide

**Requirement:** Sync must complete within **30 seconds** or it's considered a failure.

---

## 🧪 Quick Test

### Windows (PowerShell)
```powershell
cd Integrations-backend
.\test-sync-timeout.ps1
```

### Linux/Mac (Bash)
```bash
cd Integrations-backend
bash test-sync-timeout.sh
```

### Manual Test
```bash
# 1. Start sync
curl -X POST -H "X-User-Id: demo-user" \
  http://localhost:3000/api/sync/start

# 2. Poll status (replace SYNC_ID from step 1)
curl -H "X-User-Id: demo-user" \
  http://localhost:3000/api/sync/status/SYNC_ID

# 3. Check if completed within 30 seconds
```

---

## ✅ Expected Results

### Success Case
- ✅ Sync starts immediately
- ✅ Sync completes within 30 seconds
- ✅ Status shows `completed`
- ✅ Test script reports: `✅ PASS: Sync completed within 30 seconds`

### Failure Cases

#### Timeout Failure
- ❌ Sync takes longer than 30 seconds
- ❌ Status shows `failed` with error: `Sync timeout after 30 seconds`
- ❌ Test script reports: `❌ FAIL: Sync exceeded 30 second timeout`

#### Other Failures
- ❌ Sync fails with other errors (not timeout)
- ❌ Status shows `failed` with different error message
- ❌ Test script reports: `❌ FAIL: Sync failed with error`

---

## 📊 Test Output

The test script will show:
1. **SSE Connection Status** - Checks if SSE connection exists
2. **Sync Start** - Starts sync and records start time
3. **Progress Polling** - Polls status every 1 second
4. **Duration Measurement** - Calculates total elapsed time
5. **Result Verification** - Verifies completion within 30 seconds

---

## 🔍 Debugging

If sync fails or times out:

1. **Check logs** for:
   - `⏱️ [SYNC JOB MANAGER] Sync timeout after 30 seconds`
   - `⚠️ [SSE HUB] No connections found for user`
   - `❌ [SYNC JOB MANAGER] Agent 2 sync failed`

2. **Check SSE connection**:
   ```bash
   curl -H "X-User-Id: demo-user" \
     http://localhost:3000/api/sse/connection-status
   ```

3. **Check sync status**:
   ```bash
   curl -H "X-User-Id: demo-user" \
     http://localhost:3000/api/sync/status
   ```

---

## ⚙️ Configuration

- **Timeout**: 30 seconds (hard limit)
- **Poll Interval**: 1 second
- **Max Polls**: 35 seconds (30s + 5s buffer)

To change timeout, edit:
- `Integrations-backend/src/services/syncJobManager.ts` line 184: `const SYNC_TIMEOUT_MS = 30 * 1000;`

---

## 🚀 Ready to Test!

Run the test script and verify sync completes within 30 seconds!






