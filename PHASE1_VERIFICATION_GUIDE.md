# Phase 1 Verification Guide
## Step-by-Step Instructions

### Prerequisites
1. **Start the Node.js server**:
   ```bash
   cd Integrations-backend
   npm start
   ```

2. **Ensure Redis is running** (for Bull queues):
   ```bash
   # Check Redis
   redis-cli ping
   # Should return: PONG
   ```

3. **Ensure Supabase/PostgreSQL is accessible** (for audit logs)

---

## Verification Steps

### Step 1: Trigger Phase 1

**Using PowerShell**:
```powershell
.\verify-phase1.ps1
```

**Using curl**:
```bash
curl -X POST http://localhost:3001/api/v1/workflow/phase/1 \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user-sandbox-001",
    "seller_id": "test-seller-sandbox-001",
    "sync_id": "sandbox-test-001"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "phase": 1,
  "message": "Phase 1 orchestration triggered"
}
```

---

### Step 2: Check Orchestrator Logs

Look for these log entries in the server console:

1. **Initialization**:
   ```
   [INFO] Orchestration job manager initialized
   [INFO] WebSocket service initialized
   ```

2. **Phase 1 Start**:
   ```
   [INFO] 🎬 Phase 1: Zero-Friction Onboarding { userId: 'test-user-sandbox-001', syncId: 'sandbox-test-001' }
   ```

3. **Sync Triggered**:
   ```
   [INFO] Starting Amazon sync for user { userId: 'test-user-sandbox-001', syncId: 'sync_...' }
   ```

4. **Sync Complete**:
   ```
   [INFO] Inventory sync completed { userId: 'test-user-sandbox-001', itemCount: X }
   ```

5. **Phase 2 Triggered**:
   ```
   [INFO] Phase 2 orchestration triggered after sync { userId: 'test-user-sandbox-001', syncId: 'sandbox-test-001' }
   [INFO] 🔍 Phase 2: Autonomous Money Discovery { userId: 'test-user-sandbox-001', syncId: 'sandbox-test-001' }
   ```

---

### Step 3: Verify WebSocket Event

**Using Node.js** (create `test-websocket.js`):
```javascript
const { io } = require('socket.io-client');

const socket = io('http://localhost:3001', {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('✓ Connected');
  socket.emit('authenticate', {
    userId: 'test-user-sandbox-001',
    token: 'test-token'
  });
});

socket.on('authenticated', (data) => {
  console.log('✓ Authenticated:', data);
});

socket.on('workflow.phase.1.completed', (data) => {
  console.log('✅ Phase 1 completed event received!');
  console.log('Data:', JSON.stringify(data, null, 2));
  socket.disconnect();
});

socket.on('notification', (notification) => {
  console.log('Notification:', notification);
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
```

**Run**:
```bash
node test-websocket.js
```

**Expected Output**:
```
✓ Connected
✓ Authenticated: { success: true }
✅ Phase 1 completed event received!
Data: {
  "phase": 1,
  "event": "completed",
  "timestamp": "...",
  "syncId": "sandbox-test-001",
  ...
}
```

---

### Step 4: Check Phase 2 Queue Job

**Using Redis CLI**:
```bash
redis-cli
> KEYS bull:orchestration:*
> LLEN bull:orchestration:waiting
> LLEN bull:orchestration:active
```

**Using API** (if endpoint exists):
```bash
curl http://localhost:3001/api/v1/workflow/queue/stats
```

**Expected**: At least one job in waiting/active queue with step=2

---

### Step 5: Verify Sandbox Sync

**Check Logs For**:
- "Starting Amazon sync for user"
- "Inventory sync completed"
- "Orders fetched: [count]"
- "Inventory items: [count]"

**Check Database** (if accessible):
```sql
SELECT * FROM workflow_phase_logs 
WHERE workflow_id = 'sandbox-test-001' 
ORDER BY timestamp DESC;
```

---

### Step 6: Test Idempotency

**Trigger Phase 1 Twice**:
```bash
# First trigger
curl -X POST http://localhost:3001/api/v1/workflow/phase/1 \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test-user-sandbox-001", "seller_id": "test-seller-sandbox-001", "sync_id": "sandbox-test-001"}'

# Wait 3 seconds, then trigger again
sleep 3

curl -X POST http://localhost:3001/api/v1/workflow/phase/1 \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test-user-sandbox-001", "seller_id": "test-seller-sandbox-001", "sync_id": "sandbox-test-001"}'
```

**Expected**: Second trigger should be skipped (check logs for "idempotency" message)

---

## Automated Verification

Run the PowerShell script:
```powershell
.\verify-phase1.ps1
```

This will:
1. Check server health
2. Trigger Phase 1
3. Wait for processing
4. Check queue status
5. Test idempotency
6. Generate a report

---

## Troubleshooting

### Server Not Running
```bash
cd Integrations-backend
npm start
```

### Redis Not Running
```bash
# Windows
redis-server

# Linux/Mac
sudo systemctl start redis
```

### WebSocket Connection Failed
- Check CORS settings in `websocketService.ts`
- Ensure WebSocket is initialized in `index.ts`
- Check firewall/port 3001 is open

### Phase 1 Not Triggering
- Check orchestrator is initialized: Look for "Orchestration job manager initialized"
- Check route exists: `GET /api/v1/workflow/phase/1` should return 404 (POST only)
- Check logs for errors

### Phase 2 Not Queued
- Check Phase 1 completed successfully
- Check sync job completed
- Check logs for "Phase 2 orchestration triggered after sync"

---

## Expected Timeline

1. **0s**: Phase 1 triggered
2. **1-2s**: Phase 1 starts, sync begins
3. **3-5s**: Sync completes, Phase 2 queued
4. **5-8s**: WebSocket event emitted
5. **8-10s**: Phase 2 job processed

---

## Success Criteria

✅ All tests should show:
- Phase 1 trigger returns 200 OK
- Orchestrator logs show Phase 1 execution
- WebSocket event `workflow.phase.1.completed` is received
- Phase 2 job exists in queue
- Sandbox sync logs appear
- Idempotency prevents duplicate jobs

---

**Ready to verify!** Start the server and run the verification script.

