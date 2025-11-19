# E2E Testing Guide for Agents 1-3

## Prerequisites

1. **Backend must be running:**
   ```bash
   cd Integrations-backend
   npm run dev
   ```
   Backend should start on `http://localhost:3001`

2. **Frontend should be running** (optional, for full E2E):
   ```bash
   cd opside-complete-frontend
   npm run dev
   ```
   Frontend should start on `http://localhost:5173` (or similar)

## Automated Test

Run the automated E2E test:
```bash
cd Integrations-backend
npm run test:e2e-agents-1-3
```

This test will:
1. ✅ Check backend health
2. ✅ Test Agent 1 OAuth bypass flow
3. ✅ Test Agent 2 sync with SSE event monitoring
4. ✅ Test Agent 3 detection with SSE event monitoring

## Manual Testing Steps

### Step 1: Test Backend Health
```bash
curl http://localhost:3001/api/status
```
Expected: `{"status":"operational",...}`

### Step 2: Test Agent 1 - OAuth Bypass
```bash
curl -H "X-User-Id: demo-user" \
  "http://localhost:3001/api/v1/integrations/amazon/auth/start?bypass=true"
```
Expected: `{"success":true,"ok":true,...}`

### Step 3: Test Agent 2 - Start Sync
```bash
curl -X POST \
  -H "X-User-Id: demo-user" \
  -H "Content-Type: application/json" \
  http://localhost:3001/api/sync/start
```
Expected: `{"syncId":"sync_...","status":"in_progress"}`

### Step 4: Monitor SSE Events

Open a new terminal and connect to SSE:
```bash
curl -N -H "X-User-Id: demo-user" \
  http://localhost:3001/api/sse/status
```

You should see events like:
```
event: message
data: {"type":"sync","status":"started","data":{...},"timestamp":"..."}

event: message
data: {"type":"sync","status":"completed","data":{...},"timestamp":"..."}
```

### Step 5: Test Agent 3 - Trigger Detection

After sync completes, trigger detection:
```bash
curl -X POST \
  -H "X-User-Id: demo-user" \
  -H "Content-Type: application/json" \
  -d '{"syncId":"YOUR_SYNC_ID","triggerType":"inventory"}' \
  http://localhost:3001/api/detections/run
```

Expected: `{"success":true,"job":{...}}`

Monitor SSE for detection events:
```
event: message
data: {"type":"detection","status":"started","data":{...},"timestamp":"..."}

event: message
data: {"type":"detection","status":"completed","data":{...},"timestamp":"..."}
```

## Frontend Testing

1. Open frontend in browser: `http://localhost:5173`
2. Open browser DevTools → Network tab → Filter by "EventStream"
3. Navigate to sync page or trigger OAuth flow
4. Watch for SSE events in the Network tab
5. Check console for toast notifications (should appear without emojis)

## Expected SSE Events

### Agent 1 (OAuth Completion)
```json
{
  "type": "sync",
  "status": "started",
  "data": {
    "message": "Amazon connection successful. Starting data sync...",
    "sellerId": "...",
    "companyName": "..."
  },
  "timestamp": "..."
}
```

### Agent 2 (Sync)
```json
{
  "type": "sync",
  "status": "started",
  "data": {
    "syncId": "...",
    "message": "Data sync started",
    "timestamp": "..."
  },
  "timestamp": "..."
}
```

```json
{
  "type": "sync",
  "status": "completed",
  "data": {
    "syncId": "...",
    "ordersProcessed": 0,
    "totalOrders": 0,
    "inventoryCount": 0,
    "shipmentsCount": 0,
    "returnsCount": 0,
    "settlementsCount": 0,
    "feesCount": 0,
    "claimsDetected": 0,
    "message": "...",
    "timestamp": "..."
  },
  "timestamp": "..."
}
```

### Agent 3 (Detection)
```json
{
  "type": "detection",
  "status": "started",
  "data": {
    "syncId": "...",
    "message": "Claim detection started",
    "timestamp": "..."
  },
  "timestamp": "..."
}
```

```json
{
  "type": "detection",
  "status": "completed",
  "data": {
    "syncId": "...",
    "totalDetected": 0,
    "count": 0,
    "highConfidence": 0,
    "mediumConfidence": 0,
    "lowConfidence": 0,
    "totalValue": 0,
    "message": "...",
    "timestamp": "..."
  },
  "timestamp": "..."
}
```

## Troubleshooting

### Backend not starting
- Check if port 3001 is already in use
- Check `.env` file has required variables
- Check logs for errors

### SSE events not appearing
- Verify SSE endpoint is accessible: `curl http://localhost:3001/api/sse/status`
- Check backend logs for SSE event emission
- Verify user ID matches between requests

### Frontend not receiving events
- Check browser console for CORS errors
- Verify `VITE_INTEGRATIONS_URL` is set correctly
- Check Network tab for SSE connection status

## Success Criteria

✅ Backend health check passes  
✅ OAuth bypass flow works  
✅ Sync starts and completes  
✅ SSE events are emitted for sync  
✅ Detection triggers and completes  
✅ SSE events are emitted for detection  
✅ Frontend receives SSE events  
✅ Toast notifications appear (without emojis)  



