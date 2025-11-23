# Sync Issue Diagnosis

## Problem Summary

During E2E testing of Agents 1-3, we encountered an issue where **Agent 2 (Data Sync) starts successfully but does not complete or send SSE events**.

## Symptoms

1. ✅ **Sync starts successfully**: `POST /api/sync/start` returns `syncId` immediately
2. ❌ **Sync never completes**: After 3 minutes, sync status shows `lastSync: null`
3. ❌ **No SSE events received**: Despite SSE connection being open, no `sync.started` or `sync.completed` events are received
4. ❌ **Sync status endpoint returns null**: `GET /api/sync/status` shows `hasActiveSync: false, lastSync: null`

## Test Results

```
✅ Backend Health: PASSED
✅ Agent 1 - OAuth: PASSED  
❌ Agent 2 - Sync: FAILED - Timeout (no completion, no SSE events)
❌ Agent 3 - Detection: SKIPPED (depends on sync)
```

## Potential Root Causes

### 1. **Render Cold Start / Timeout**
- Render free tier can take 30-60 seconds to wake up
- Sync might be timing out before completion
- Long-running sync jobs may exceed Render's timeout limits

### 2. **User ID Mismatch**
- SSE connection uses `demo-user` (from unauthenticated connection)
- Sync might be using a different user ID internally
- SSE events sent to wrong user ID won't reach the test client

### 3. **SSE Event Format Issue**
- Events are sent via `sseHub.sendEvent(userId, 'message', data)`
- EventSource might not be receiving events with event type `'message'`
- Frontend expects `onmessage` handler, but events might be sent with named event types

### 4. **Sync Job Failure (Silent)**
- Sync might be failing internally but not surfacing errors
- Database connection issues on Render
- Amazon SP-API rate limits or authentication failures
- Background worker not processing sync jobs

### 5. **SSE Connection Not Registered**
- SSE connection might not be properly registered in `sseHub`
- Connection might be closing before events are sent
- User ID might not match between sync service and SSE hub

## Code Flow Analysis

### Sync Start Flow
1. `POST /api/sync/start` → `syncRoutes.ts`
2. Calls `syncJobManager.startSync(userId)`
3. Creates sync job and saves to database
4. Triggers `agent2DataSyncService.syncUserData(userId)`
5. Should send SSE event `sync.started` via `sseHub.sendEvent(userId, 'message', {...})`

### SSE Event Sending
- **Location**: `Integrations-backend/src/services/syncJobManager.ts`
- **Method**: `sseHub.sendEvent(userId, 'message', {type: 'sync', status: 'started', ...})`
- **User ID**: Uses `userId` from sync job

### SSE Connection
- **Endpoint**: `GET /api/sse/status`
- **Auth**: Uses `authenticateSSE` middleware
- **User ID**: Defaults to `'demo-user'` if no auth token
- **Registration**: `sseHub.addConnection(userId, res)`

## Debugging Steps

### 1. Verify User ID Consistency
```bash
# Check what user ID sync is using
curl -H "X-User-Id: demo-user" \
  "https://opside-node-api-woco.onrender.com/api/sync/start" \
  -X POST

# Check SSE connection user ID
# Should be 'demo-user' for unauthenticated connections
```

### 2. Check Sync Job Status
```bash
# Query database directly for sync_progress table
# Check if sync job exists and what status it has
```

### 3. Check Backend Logs
- Look for sync job errors
- Check for SSE event sending errors
- Verify user ID in logs matches between sync and SSE

### 4. Test SSE Events Manually
```bash
# Connect to SSE endpoint
curl -N "https://opside-node-api-woco.onrender.com/api/sse/status"

# In another terminal, trigger sync
# Watch for events in first terminal
```

### 5. Check Sync Service Implementation
- Verify `agent2DataSyncService.syncUserData()` completes
- Check if it throws errors silently
- Verify it calls `syncJobManager` to update status

## Files to Check

1. **Sync Job Manager**: `Integrations-backend/src/services/syncJobManager.ts`
   - `startSync()` method
   - `runSync()` method
   - SSE event sending locations

2. **Agent 2 Service**: `Integrations-backend/src/services/agent2DataSyncService.ts`
   - `syncUserData()` method
   - Error handling
   - Completion callbacks

3. **SSE Hub**: `Integrations-backend/src/utils/sseHub.ts`
   - `sendEvent()` method
   - Connection management

4. **SSE Routes**: `Integrations-backend/src/routes/sseRoutes.ts`
   - Connection registration
   - User ID extraction

5. **SSE Auth Middleware**: `Integrations-backend/src/middleware/sseAuthMiddleware.ts`
   - User ID defaulting to 'demo-user'

## Recommended Fixes

### Fix 1: Ensure User ID Consistency
- Make sure sync uses same user ID as SSE connection
- Log user IDs in both sync and SSE code paths

### Fix 2: Add Timeout Handling
- Add explicit timeout for sync operations
- Return error if sync doesn't complete within reasonable time
- Send `sync.failed` SSE event on timeout

### Fix 3: Improve Error Logging
- Add detailed logging in sync job manager
- Log when SSE events are sent and to which user ID
- Log sync job status changes

### Fix 4: Test Locally First
- Test sync flow on localhost before testing on Render
- Verify SSE events work in local environment
- Then test on Render with same user ID

### Fix 5: Add Sync Status Polling
- Add endpoint to check sync job status
- Poll this endpoint in test script
- Verify sync actually completes even if SSE events don't arrive

## Next Steps

1. **Debug sync completion**: Check why sync doesn't complete
2. **Verify SSE event delivery**: Test if events are sent but not received
3. **Check user ID matching**: Ensure sync and SSE use same user ID
4. **Add better error handling**: Surface sync failures clearly
5. **Test locally**: Verify flow works on localhost first

## Test Command

```bash
# Run E2E test
cd Integrations-backend
npm run test:e2e-agents-1-3

# Or test manually
curl -H "X-User-Id: demo-user" \
  "https://opside-node-api-woco.onrender.com/api/sync/start" \
  -X POST

# Then check status
curl -H "X-User-Id: demo-user" \
  "https://opside-node-api-woco.onrender.com/api/sync/status"
```









