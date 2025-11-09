# Phase 2: Claims & Recoveries System Verification Guide

## 🎯 Overview

Phase 2 ensures your platform's core financial logic — claims, recoveries, sync status, and observability — all work end-to-end before moving to the evidence pipeline (Phase 3).

## 🧩 Phase 2 Components

| Component | Description | Expected Output |
|-----------|-------------|-----------------|
| 1. Claims Endpoint | Fetches real/sandbox FBA claim data | JSON with `success:true`, `claims:[...]`, and `isSandbox:true` |
| 2. Recoveries Endpoint | Totals claims and expected payouts | JSON with `totalAmount`, `claimCount`, `currency` |
| 3. Sync Status | Monitors Amazon data-sync activity | JSON with `status:"ok"` or `hasActiveSync:false` |
| 4. Observability Logs | Measures response time, success rate | Logged per request |
| 5. User Context | Uses `X-User-Id` header for scoped data | Sandbox user ID: `test-user-phase2-YYYYMMDDHHmmss` |

## ⚙️ Endpoints to Test

| Endpoint | Method | Purpose | Full URL |
|----------|--------|---------|----------|
| Claims | GET | Fetch claim list | `https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/claims` |
| Recoveries | GET | Aggregate totals | `https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/recoveries` |
| Sync Status | GET | Monitor sync job | `https://opside-node-api-woco.onrender.com/api/sync/status` |
| Python API (optional) | GET | Confirm Python service reachable | `https://python-api-2-jlx5.onrender.com/api/v1/evidence/parse/test` |

## 🧪 Step-by-Step Tests (Sandbox Mode)

### 🧩 Test 1 — Claims Endpoint

**Command:**
```bash
curl -X GET "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/claims" \
  -H "X-User-Id: test-user-phase2-20251109014133"
```

**✅ Expected Response:**
```json
{
  "success": true,
  "claims": [],
  "isSandbox": true,
  "dataType": "SANDBOX_TEST_DATA",
  "message": "No claims found (SP-API error or empty response)",
  "source": "live_mode_error_fallback",
  "userId": "test-user-phase2-20251109014133",
  "timestamp": "2025-11-09T01:41:33.000Z",
  "responseTime": "0.11s",
  "claimCount": 0
}
```

**What to Verify:**
- ✅ `success: true` - Endpoint is working
- ✅ `isSandbox: true` - Sandbox mode detected
- ✅ `claims: []` - Empty array (expected in sandbox)
- ✅ `dataType: "SANDBOX_TEST_DATA"` - Sandbox data type
- ✅ `responseTime: "X.XXs"` - Response time logged

**If you see `"isSandbox":true`, your claims pipeline is healthy.**

### 💰 Test 2 — Recoveries Endpoint

**Command:**
```bash
curl -X GET "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/recoveries" \
  -H "X-User-Id: test-user-phase2-20251109014133"
```

**✅ Expected Response:**
```json
{
  "totalAmount": 0.0,
  "claimCount": 0,
  "currency": "USD",
  "dataSource": "spapi_sandbox_empty",
  "source": "none",
  "message": "No data found. Syncing your Amazon account... Please refresh in a few moments.",
  "needsSync": true,
  "syncTriggered": true,
  "isSandbox": true
}
```

**What to Verify:**
- ✅ `totalAmount: 0.0` - Zero value is fine in sandbox
- ✅ `claimCount: 0` - Zero count is expected
- ✅ `currency: "USD"` - Currency is set
- ✅ `dataSource: "spapi_sandbox_empty"` - Sandbox data source
- ✅ `isSandbox: true` - Sandbox mode detected

**A zero value is fine in sandbox; we only check structure & stability.**

### 🔁 Test 3 — Sync Status

**Command:**
```bash
curl -X GET "https://opside-node-api-woco.onrender.com/api/sync/status" \
  -H "X-User-Id: test-user-phase2-20251109014133"
```

**✅ Expected Response:**
```json
{
  "hasActiveSync": false,
  "lastSync": null
}
```

**OR:**
```json
{
  "status": "ok",
  "hasActiveSync": false,
  "lastSync": "2025-11-09T01:41:33.000Z"
}
```

**What to Verify:**
- ✅ `hasActiveSync: false` - No active sync (expected if no sync running)
- ✅ `lastSync: null` or timestamp - Last sync time (if available)
- ✅ Status code: 200 - Endpoint is working

**❌ If 404 → endpoint route missing or controller not exported; we'll patch it.**

### 📊 Test 4 — Observability Logging

**Check Render Logs:**

Each endpoint should log:

```
[LOG] 🔍 [CLAIMS] Processing claims request | user:test-user-phase2-20251109014133 | sandbox:true
[LOG] ✅ [CLAIMS] Successfully fetched claims from SP-API | responseTime:0.11s | claimCount:0
[LOG] 📊 [RECOVERIES] Getting Amazon recoveries summary | user:test-user-phase2-20251109014133 | sandbox:true
[LOG] 🔄 [SYNC] Getting active sync status | user:test-user-phase2-20251109014133
```

**What to Verify:**
- ✅ Response times are logged
- ✅ User ID is included in logs
- ✅ Sandbox mode is logged
- ✅ Success/error status is logged

### 🧠 Test 5 — User Context Validation

**Test without X-User-Id header:**
```bash
curl -X GET "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/claims"
```

**✅ Expected Response:**
- Should return error or use default user
- May return `demo-user` as fallback
- Should still return valid JSON response

**What to Verify:**
- ✅ Endpoint handles missing user ID gracefully
- ✅ Returns valid response (may use `demo-user` as fallback)
- ✅ Logs indicate user source (`default-demo-user`)

## 🚀 Automated Testing

### Using Test Script

Run the comprehensive test script:

```powershell
.\test-phase2-claims-recoveries.ps1 -NodeApiUrl "https://opside-node-api-woco.onrender.com" -TestUserId "test-user-phase2-20251109014133"
```

**What the Script Tests:**
1. ✅ Claims Endpoint - Structure and response
2. ✅ Recoveries Endpoint - Structure and response
3. ✅ Sync Status Endpoint - Structure and response
4. ✅ Observability Logging - Response times
5. ✅ User Context Validation - X-User-Id header handling
6. ✅ Python API Reachability - Optional check

## 📋 Success Criteria for Phase 2

| Check | Goal | Status |
|-------|------|--------|
| Node API reachable | ✅ | Should return 200 |
| Claims Endpoint | ✅ | `success:true`, `isSandbox:true` |
| Recoveries Endpoint | ✅ | `totalAmount`, `claimCount`, `currency` |
| Sync Status | ✅ | `hasActiveSync` or `status:"ok"` |
| Observability Logs | ✅ | Response times logged |
| User ID Context | ✅ | User ID extracted correctly |

## 🔍 Troubleshooting

### Issue: Claims Endpoint Returns Error

**Possible Causes:**
1. Amazon SP-API credentials not configured
2. Refresh token invalid/expired
3. Sandbox mode not detected

**Solutions:**
1. Verify `AMAZON_SPAPI_REFRESH_TOKEN` is set in environment
2. Check backend logs for SP-API errors
3. Verify `AMAZON_SPAPI_BASE_URL` includes "sandbox"

### Issue: Recoveries Endpoint Returns Zero

**Expected Behavior:**
- Zero values are normal in sandbox mode
- Sandbox may return empty data
- This is expected and not an error

**Solutions:**
1. Verify endpoint structure is correct
2. Check `dataSource: "spapi_sandbox_empty"` in response
3. Verify `isSandbox: true` in response

### Issue: Sync Status Returns 404

**Possible Causes:**
1. Route not registered
2. Controller not exported
3. Route order issue

**Solutions:**
1. Verify `/api/sync/status` route is registered before `/api/sync/status/:syncId`
2. Check `syncRoutes.ts` for route order
3. Verify `getActiveSyncStatus` controller is exported

### Issue: Observability Logs Not Appearing

**Possible Causes:**
1. Logs not being written
2. Log level too high
3. Render logs not showing

**Solutions:**
1. Check Render → Logs for detailed logs
2. Verify logger is configured correctly
3. Check log level settings

## ✅ Next Steps

1. **Run Test Script** - Execute `test-phase2-claims-recoveries.ps1`
2. **Verify Results** - Check all tests pass
3. **Review Logs** - Check Render logs for observability metrics
4. **Proceed to Phase 3** - Move to evidence pipeline testing

## 🎉 Conclusion

**Phase 2 is successful if:**
- ✅ All endpoints return valid JSON responses
- ✅ Sandbox mode is detected correctly
- ✅ Response times are reasonable (< 5s)
- ✅ User context is handled correctly
- ✅ Observability logs are present

**Ready for Phase 3 (Evidence Pipeline) testing!**

