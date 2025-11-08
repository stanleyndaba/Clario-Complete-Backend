# Sandbox Data Flow Verification Checklist

## ✅ Step-by-Step Verification

### 1. Connect Amazon (Sandbox)
```bash
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?bypass=true"
```
**Expected:**
- `{"success": true, "bypassed": true}`
- Sync should trigger automatically

### 2. Check Recoveries Endpoint
```bash
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/recoveries"
```
**Expected Response:**
```json
{
  "totalAmount": 0 or > 0,
  "currency": "USD",
  "claimCount": 0 or > 0,
  "source": "database" or "api" or "none",
  "dataSource": "synced_from_spapi_sandbox" or "spapi_sandbox" or "spapi_sandbox_empty",
  "message": "...",
  "isSandbox": true,
  "needsSync": true/false,
  "syncTriggered": true/false
}
```

### 3. Check Render Logs

#### ✅ Sync Phase Logs (Look for):
- `"Amazon SP-API initialized in SANDBOX mode - using test data only"`
- `"Fetching claims from SP-API SANDBOX (test data only)"`
- `"Claims sync completed (SANDBOX TEST DATA)"`
- `"Amazon claims saved to database successfully"`
- `"Found X claims in DATABASE, total approved: $X"`

#### ✅ Phase 2 Detection Logs (Look for):
- `"🔍 Phase 2: Autonomous Money Discovery (SANDBOX MODE)"`
- `"Enqueueing detection job (SANDBOX MODE)"`
- `"Running detection algorithms (Phase 2: Autonomous Money Discovery - SANDBOX MODE)"`
- `"Detection algorithms completed (SANDBOX MODE)"`
- `"Detection job triggered after sync (SANDBOX MODE)"`

#### ✅ No Errors (Should NOT see):
- ❌ 500 Internal Server Error
- ❌ 401 Unauthorized
- ❌ 404 Not Found
- ❌ "Failed to fetch claims"
- ❌ "Token refresh failed"

### 4. Check Database (If you have access)

Query `claims` table:
```sql
SELECT COUNT(*), SUM(amount) 
FROM claims 
WHERE user_id = 'demo-user' 
  AND provider = 'amazon';
```

**Expected:**
- If sandbox returns data: Count > 0, Sum > 0
- If sandbox returns empty: Count = 0 (system will use mock data)

### 5. Check Dashboard

**Frontend should show:**
- ✅ Sandbox claim totals (or mock totals if empty)
- ✅ Real-time toasts:
  - "🔍 Analyzing your orders… (Sandbox Mode)"
  - "💰 Found $X in recoverable funds"
  - "⚡ X claims ready for auto submission"
  - "📊 Success probability: XX%"
- ✅ All numbers reflect sandbox test data

### 6. Verify Phase 2 Triggered

Check for detection results:
```bash
curl "https://opside-node-api-woco.onrender.com/api/detections/statistics"
```

**Expected:**
- Detection statistics available
- Claims categorized by confidence
- Sandbox mode indicators present

## 🎯 Success Criteria

✅ **Sync Working:**
- Claims synced to database (or empty if sandbox has no data)
- Logs show "SANDBOX MODE" indicators
- No 500/401/404 errors

✅ **Phase 2 Working:**
- Detection job triggered after sync
- Detection algorithms run (even with empty data)
- Real-time toasts appear in dashboard
- Detection results stored in database

✅ **Dashboard Working:**
- Shows sandbox claim totals
- Real-time updates via WebSocket/SSE
- All numbers reflect sandbox test data
- No errors in frontend console

## ⚠️ Common Issues

### Issue: No data in database
**Solution:** 
- Sandbox may return empty data (this is normal)
- System will use mock data from claims table for detection
- Check logs for "Sandbox returned empty data - this is normal"

### Issue: Claims endpoint returns 500
**Solution:**
- Fixed in latest commit
- Should return empty array instead of error
- Check Render logs for specific error

### Issue: Sync doesn't trigger
**Solution:**
- Check environment variables are set correctly
- Verify `AMAZON_SPAPI_REFRESH_TOKEN` is valid
- Check logs for "Using environment variables for sync"

### Issue: Phase 2 doesn't trigger
**Solution:**
- Check if detection job processor is running
- Verify sync completed successfully
- Check logs for "Detection job triggered after sync"

## 📊 Expected Log Flow

```
1. "Amazon SP-API initialized in SANDBOX mode"
2. "Fetching claims from SP-API SANDBOX"
3. "Claims sync completed (SANDBOX TEST DATA)"
4. "Amazon claims saved to database successfully"
5. "Phase 2 orchestration triggered after sync"
6. "🔍 Phase 2: Autonomous Money Discovery (SANDBOX MODE)"
7. "Enqueueing detection job (SANDBOX MODE)"
8. "Running detection algorithms (SANDBOX MODE)"
9. "Detection algorithms completed (SANDBOX MODE)"
10. "💰 Found $X in recoverable funds"
```

