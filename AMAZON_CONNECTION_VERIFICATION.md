# Amazon SP-API Connection Verification Guide

## Overview
This document explains what happens when "Use Existing Connection (Skip OAuth)" is clicked and how to verify if the backend is actually connected to SP-API sandbox and pulling data.

---

## ⚠️ CRITICAL: What Actually Happens vs What Should Happen

### What Actually Happens When You Click "Use Existing Connection (Skip OAuth)"

**The short answer: NO, the Amazon SP_API sandbox is NOT really connected when you click the button.**

Here's what actually happens:

1. **Backend checks for refresh token** (lines 44-46 in `amazonController.ts`):
   - Checks if `AMAZON_SPAPI_REFRESH_TOKEN` exists in environment variables
   - **Does NOT validate the token**
   - **Does NOT test the SP-API connection**
   - **Does NOT refresh the access token**

2. **Backend returns "bypassed: true"** (lines 113-121):
   - If token exists in environment, returns `{ bypassed: true, redirectUrl: "..." }`
   - Frontend redirects to integrations hub
   - **Connection is marked as "connected" without any verification**

3. **Actual connection happens later**:
   - When `/api/v1/integrations/amazon/recoveries` is called, it tries to fetch data
   - When a sync job runs, it tries to fetch data from SP-API
   - **This is when the token is actually validated and SP-API is actually called**

### What Should Happen (According to Your Documentation)

According to your `AMAZON_CONNECTION_VERIFICATION.md`, the backend should:
1. ✅ Check for refresh token (database or environment)
2. ❌ **Validate the refresh token** ← NOT DONE
3. ❌ **Refresh the access token** (call Amazon's token endpoint) ← NOT DONE
4. ❌ **Store the new access token** ← NOT DONE
5. ✅ Return `{ bypassed: true, redirectUrl: "..." }`

### The Problem

**The bypass flow assumes the token is valid without testing it.** This means:
- If the refresh token is expired or invalid, you won't know until you try to fetch data
- If SP-API credentials are wrong, you won't know until sync runs
- The frontend shows "Amazon Connected" even though no real connection was verified

### When Does Real Connection Happen?

The actual SP-API connection is tested when:

1. **Recoveries endpoint is called** (`/api/v1/integrations/amazon/recoveries`):
   - Calls `amazonService.fetchClaims(userId)`
   - This calls `getAccessToken()` which calls `refreshAccessToken()`
   - **This is when the token is actually validated** (line 208 in `amazonService.ts`)

2. **Sync job runs** (`amazonSyncJob.ts`):
   - Calls `amazonService.fetchClaims(userId)`
   - **This is when SP-API endpoints are actually called**

### How to Verify Real Connection

To verify if the connection is real, check:

1. **Backend logs** when recoveries endpoint is called:
   - Look for "Refreshing Amazon SP-API access token"
   - Look for "Successfully refreshed Amazon SP-API access token"
   - Look for SP-API API calls

2. **Frontend response** from `/api/v1/integrations/amazon/recoveries`:
   - If `source: "database"` → Data was synced (real connection worked)
   - If `source: "api"` → Real-time API call worked (real connection)
   - If `source: "none"` → No data found (connection may have failed or no data available)

3. **Sync status** (`/api/sync/status`):
   - Check if sync completed successfully
   - Check if sync failed (connection issue)

---

## Frontend Flow: "Use Existing Connection (Skip OAuth)"

### Step 1: Check Connection Status
When the button is clicked, the frontend:
1. **Checks if Amazon is already connected** via `GET /api/v1/integrations/status`
   - If `amazon_connected: true` → Just redirects to integrations hub (no backend call needed)
   - If `amazon_connected: false` → Proceeds to Step 2

### Step 2: Attempt Bypass Connection
If not connected, the frontend calls:
```
GET /api/v1/integrations/amazon/auth/start?bypass=true&redirect_uri=...&frontend_url=...
```

**What the backend should do:**
1. Check for refresh token:
   - **Database**: Look for existing refresh token in `tokens` table for the user
   - **Environment Variables**: Use `AMAZON_SPAPI_REFRESH_TOKEN` if no database token exists
2. If refresh token exists:
   - Validate the refresh token
   - Refresh the access token (call Amazon's token endpoint)
   - Store the new access token
   - Return `{ bypassed: true, redirectUrl: "/auth/callback?provider=amazon" }`
3. If no refresh token exists:
   - Return OAuth URL as fallback (user needs to complete OAuth)

### Step 3: Redirect After Connection
- Frontend redirects to `redirectUrl` (usually `/auth/callback?provider=amazon`)
- This triggers `OAuthCallback.tsx` which:
  1. Polls `GET /api/v1/integrations/status` to verify connection
  2. Checks if sync is active via `GET /api/sync/status`
  3. If no sync is active, triggers sync via `POST /api/sync/start`
  4. Calls `GET /api/v1/integrations/amazon/recoveries` to get recovery data

---

## Backend Requirements for Real Connection

### 1. Refresh Token Storage
The backend must have a refresh token available:
- **Option A**: In database (`tokens` table) from previous OAuth flow
- **Option B**: In environment variables (`AMAZON_SPAPI_REFRESH_TOKEN`) for sandbox/testing

### 2. Token Validation & Refresh
When `bypass=true` is used, the backend must:
- Validate the refresh token is still valid
- Call Amazon's token refresh endpoint: `POST https://api.amazon.com/auth/o2/token`
- Get a new access token
- Store the new access token (database or memory)

### 3. SP-API Sandbox Connection
After token refresh, the backend should:
- Use the access token to authenticate SP-API requests
- Call SP-API sandbox endpoints:
  - `GET /fba/inventory/v1/summaries` - Inventory data
  - `GET /orders/v0/orders` - Orders data
  - `GET /finances/v0/financialEvents` - Financial events
- Use proper AWS signature v4 authentication
- Include LWA (Login With Amazon) access token in headers

### 4. Data Syncing
After successful connection, the backend should:
- Trigger an automatic sync job
- Fetch data from SP-API sandbox endpoints
- Process the data to detect claims/recoveries
- Store claims in database
- Update sync status

### 5. Data Retrieval
The frontend calls `GET /api/v1/integrations/amazon/recoveries` which should:
- Read from database (not generate mock data)
- Return real aggregated data:
  ```json
  {
    "totalAmount": 1234.56,
    "currency": "USD",
    "claimCount": 42,
    "source": "SP-API Sandbox",
    "dataSource": "database"
  }
  ```

---

## Verification Checklist

### ✅ Frontend Verification (What We Can Check)

1. **Connection Status**
   - [ ] Call `GET /api/v1/integrations/status`
   - [ ] Verify `amazon_connected: true` after "Use Existing Connection"
   - [ ] Check browser console for API responses

2. **Recovery Data**
   - [ ] Call `GET /api/v1/integrations/amazon/recoveries`
   - [ ] Check if data has `source: "backend"` or `source: "mock"`
   - [ ] If `source: "mock"`, backend is not returning real data
   - [ ] If `source: "backend"` but zeros, backend is connected but no data synced yet

3. **Sync Status**
   - [ ] Call `GET /api/sync/status`
   - [ ] Check if `hasActiveSync: true` (sync in progress)
   - [ ] Check if `lastSync.status: "complete"` (sync finished)
   - [ ] Check if `lastSync.status: "failed"` (sync failed)

### ⚠️ Backend Verification (What Needs to Be Checked on Backend)

1. **Refresh Token Exists**
   - [ ] Check database `tokens` table for refresh token
   - [ ] OR check environment variable `AMAZON_SPAPI_REFRESH_TOKEN`
   - [ ] Verify token is valid (not expired)

2. **Token Refresh Works**
   - [ ] Backend logs show token refresh attempt
   - [ ] Backend receives new access token from Amazon
   - [ ] Access token is stored/used for API calls

3. **SP-API Sandbox Connection**
   - [ ] Backend logs show SP-API API calls
   - [ ] Backend receives responses from SP-API sandbox
   - [ ] Backend uses correct sandbox URL: `https://sandbox.sellingpartnerapi-na.amazon.com`
   - [ ] Backend uses proper AWS signature v4 authentication

4. **Data Sync**
   - [ ] Backend triggers sync job after connection
   - [ ] Backend calls SP-API endpoints to fetch data
   - [ ] Backend processes and stores data in database
   - [ ] Database has claims/recoveries records

5. **Data Retrieval**
   - [ ] `GET /api/v1/integrations/amazon/recoveries` reads from database
   - [ ] Returns real data (not zeros, not mock data)
   - [ ] Data matches what's in database

---

## Common Issues & Solutions

### Issue 1: "Use Existing Connection" Always Redirects to OAuth
**Cause**: No refresh token found in database or environment variables.
**Solution**: 
- Complete OAuth flow once to store refresh token in database
- OR set `AMAZON_SPAPI_REFRESH_TOKEN` environment variable for sandbox

### Issue 2: Connection Succeeds But No Data
**Cause**: Backend is connected but not syncing data from SP-API.
**Solution**:
- Check backend logs for sync job triggers
- Verify sync job calls SP-API endpoints
- Check if sync job processes and stores data

### Issue 3: Frontend Shows Mock Data
**Cause**: Backend is slow/timing out or returning errors.
**Solution**:
- Check backend logs for errors
- Verify backend is responding within 3 seconds (sandbox timeout)
- Check if backend returns proper response format

### Issue 4: Backend Returns Zeros
**Cause**: Backend is connected but SP-API sandbox has no data OR sync hasn't run yet.
**Solution**:
- Check if sync job has run: `GET /api/sync/status`
- Trigger manual sync: `POST /api/sync/start`
- Verify SP-API sandbox has test data (sandbox may have limited/empty data)

---

## Testing Steps

### Test 1: Verify Connection Status
1. Click "Use Existing Connection (Skip OAuth)"
2. Open browser DevTools → Network tab
3. Check request to `GET /api/v1/integrations/status`
4. Verify response has `amazon_connected: true`

### Test 2: Verify Data Retrieval
1. After connection, check browser console
2. Look for `GET /api/v1/integrations/amazon/recoveries` request
3. Check response:
   - If `source: "backend"` → Backend is returning data (good!)
   - If `source: "mock"` → Backend failed, using mock data (bad!)
   - If `totalAmount: 0` → Backend connected but no data synced yet (check sync status)

### Test 3: Verify Sync Status
1. After connection, check browser console
2. Look for `GET /api/sync/status` request
3. Check response:
   - `hasActiveSync: true` → Sync in progress (wait for completion)
   - `lastSync.status: "complete"` → Sync finished (data should be available)
   - `lastSync.status: "failed"` → Sync failed (check backend logs)

### Test 4: Manual Backend Verification
1. Check backend logs for:
   - Token refresh attempts
   - SP-API API calls
   - Sync job triggers
   - Data processing
2. Check database for:
   - Refresh token in `tokens` table
   - Claims/recoveries in database
   - Sync status records

---

## Expected Behavior

### ✅ Working Correctly
1. "Use Existing Connection" → Backend finds refresh token
2. Backend refreshes access token → Gets new token from Amazon
3. Backend connects to SP-API sandbox → Makes API calls
4. Backend syncs data → Stores claims in database
5. Frontend gets real data → `GET /api/v1/integrations/amazon/recoveries` returns database data

### ❌ Not Working
1. "Use Existing Connection" → Always redirects to OAuth (no refresh token)
2. Connection succeeds → But frontend shows mock data (backend not returning data)
3. Connection succeeds → But `totalAmount: 0` (backend not syncing data)
4. Sync status shows failed → Backend logs show errors

---

## Next Steps

1. **Verify Backend Has Refresh Token**
   - Check database or environment variables
   - If missing, complete OAuth flow once

2. **Verify Backend Token Refresh Works**
   - Check backend logs for token refresh
   - Verify new access token is received

3. **Verify Backend SP-API Connection**
   - Check backend logs for SP-API API calls
   - Verify responses are received

4. **Verify Backend Data Sync**
   - Check if sync job runs after connection
   - Verify data is stored in database

5. **Verify Frontend Gets Real Data**
   - Check browser console for API responses
   - Verify `source: "backend"` (not "mock")
   - Verify data matches database

---

## Summary

**"Use Existing Connection" works if:**
- ✅ Backend has refresh token (database or environment)
- ✅ Backend refreshes access token successfully
- ✅ Backend connects to SP-API sandbox
- ✅ Backend syncs data from SP-API
- ✅ Backend returns real data (not mock, not zeros)

**To verify:**
1. Check frontend browser console for API responses
2. Check backend logs for token refresh and SP-API calls
3. Check database for stored data
4. Check sync status endpoint for sync progress

**If not working:**
- Check backend logs for errors
- Verify refresh token exists
- Verify SP-API credentials are correct
- Verify sync job is running
- Check database for stored data

---

## 🔧 How to Fix: Make Bypass Actually Validate Connection

If you want the "Use Existing Connection" button to actually validate the connection, you need to modify the bypass flow in `amazonController.ts`:

### Current Implementation (Doesn't Validate)

```typescript
// Lines 59-122 in amazonController.ts
if (bypassOAuth) {
  logger.info('Bypassing OAuth flow - using existing refresh token');
  // Just returns bypassed: true without validation
  return res.json({
    bypassed: true,
    redirectUrl: redirectUrl
  });
}
```

### Recommended Fix (Validates Connection)

```typescript
if (bypassOAuth) {
  logger.info('Bypassing OAuth flow - validating existing refresh token');
  
  try {
    // Actually validate the token by trying to refresh it
    const userId = (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
    const accessToken = await amazonService.getAccessToken(userId);
    
    // If we get here, token refresh succeeded
    logger.info('Token validation successful - connection verified', { userId });
    
    // Optionally test SP-API connection with a simple API call
    // This ensures the connection actually works, not just that the token exists
    try {
      await amazonService.fetchInventory(userId, { limit: 1 });
      logger.info('SP-API connection test successful');
    } catch (apiError: any) {
      logger.warn('SP-API connection test failed', { error: apiError.message });
      // Decide: fail the bypass or continue anyway?
      // For now, we'll continue - the token is valid even if API call fails
    }
    
    return res.json({
      bypassed: true,
      redirectUrl: redirectUrl,
      connectionVerified: true
    });
  } catch (tokenError: any) {
    logger.error('Token validation failed during bypass', { error: tokenError.message });
    
    // Token is invalid - fall back to OAuth
    return res.json({
      success: false,
      bypassed: false,
      error: 'Refresh token is invalid or expired',
      message: 'Please complete OAuth flow to reconnect',
      authUrl: (await amazonService.startOAuth()).authUrl
    });
  }
}
```

### Trade-offs

**Current approach (no validation):**
- ✅ Fast response (no API calls)
- ✅ Works even if SP-API is temporarily down
- ❌ Doesn't catch invalid tokens until later
- ❌ User sees "connected" even if connection will fail

**Validation approach:**
- ✅ Catches invalid tokens immediately
- ✅ User knows connection is real
- ❌ Slower response (requires API call)
- ❌ Fails if SP-API is temporarily down

**Recommendation:** Keep current approach but add better error handling when data is actually fetched. The current approach is fine for sandbox testing where you know the token is valid.

