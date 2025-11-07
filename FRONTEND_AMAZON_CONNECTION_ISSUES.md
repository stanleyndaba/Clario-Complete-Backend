# Frontend Amazon Connection Issues Analysis

## ✅ What's Working

1. **Bypass Endpoint** - Working correctly
   - Redirects to dashboard with `amazon_connected=true`
   - Uses refresh token from environment variables
   - OAuth is successfully bypassed

2. **Backend API Calls** - Working
   - Frontend is calling the correct backend URL
   - Recoveries endpoint is responding (status 200)
   - Integration status endpoint is working

---

## ⚠️ Issues Found

### Issue 1: Recoveries Endpoint Returns Zeros

**Symptom:**
```json
{
  "totalAmount": 0,
  "currency": "USD",
  "claimCount": 0,
  "message": "No data found. Please sync your Amazon account first."
}
```

**Root Cause:**
- The recoveries endpoint (`/api/v1/integrations/amazon/recoveries`) checks for existing claims in the database
- **No sync has been triggered yet** - Data must be synced from Amazon SP-API first
- The sandbox Financial Events API might return empty data if no test data exists

**Solution:**
1. **Trigger a sync** - The user needs to sync their Amazon account first
2. The recoveries endpoint only returns data if:
   - A sync has been completed (Phase 1 or manual sync)
   - Claims have been stored in the database
   - OR the Financial Events API returns data directly (which it might not in sandbox)

**Fix:**
- The recoveries endpoint should trigger a sync if no data exists, OR
- Show a clear message to the user: "Please sync your Amazon account to view recoveries"
- The frontend is already handling this by showing mock data, which is acceptable

---

### Issue 2: SSE (Server-Sent Events) Authentication Error

**Symptom:**
```
EventSource's response has a MIME type ("text/html") that is not "text/event-stream". Aborting the connection.
```

**Root Cause:**
- The SSE endpoint (`/api/sse/status`) requires JWT authentication
- EventSource can't send custom headers, so it relies on **cookies** (`session_token`)
- The frontend is not sending authentication cookies, OR
- The user is not logged in (no session)

**How SSE Authentication Works:**
1. Frontend creates EventSource: `new EventSource('/api/sse/status')`
2. Browser automatically sends cookies with the request
3. Backend checks for `session_token` cookie
4. If missing/invalid, backend sends error event and closes connection
5. Browser receives HTML error page instead of event-stream (causing MIME type error)

**Solution:**
1. **Ensure user is logged in** - Frontend must authenticate first
2. **Set session cookie** - Backend must set `session_token` cookie after login
3. **Make SSE endpoint optional** - If no auth, gracefully handle (don't crash)
4. **OR make SSE work without auth** - For public/demo mode

**Fix Options:**

#### Option A: Make SSE Work Without Auth (Quick Fix)
Modify `sseRoutes.ts` to allow unauthenticated connections:
```typescript
// Allow unauthenticated connections for demo/sandbox mode
router.get('/status', (req: AuthenticatedSSERequest, res) => {
  const userId = req.user?.id || 'demo-user';
  // ... rest of the code
});
```

#### Option B: Fix Frontend Authentication (Proper Fix)
1. Ensure frontend sets session cookie after login
2. Ensure EventSource requests include cookies (they do by default)
3. Verify JWT token is being sent correctly

#### Option C: Disable SSE Temporarily (Workaround)
Frontend can disable SSE and use polling instead:
```typescript
// Instead of EventSource
const pollInterval = setInterval(() => {
  fetch('/api/v1/integrations/amazon/recoveries')
    .then(res => res.json())
    .then(data => updateUI(data));
}, 5000);
```

---

## 🔍 Debugging Steps

### Check Recoveries Issue:
```bash
# 1. Check if sync is needed
curl https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/recoveries

# 2. Trigger a sync (if endpoint exists)
curl -X POST https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/sync

# 3. Check sync status
curl https://opside-node-api-woco.onrender.com/api/v1/integrations/status
```

### Check SSE Issue:
```bash
# 1. Test SSE endpoint with authentication
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Accept: text/event-stream" \
     https://opside-node-api-woco.onrender.com/api/sse/status

# 2. Check if route exists
curl -I https://opside-node-api-woco.onrender.com/api/sse/status

# 3. Check browser Network tab:
# - What URL is EventSource trying to connect to?
# - Are cookies being sent?
# - What's the response status code?
```

---

## 📋 Recommended Fixes

### Priority 1: Make SSE Endpoint Optional (Quick Fix)
**File:** `Integrations-backend/src/middleware/sseAuthMiddleware.ts`

```typescript
// Allow unauthenticated connections for demo/sandbox mode
if (!token) {
  logger.info('SSE connection without authentication - using demo mode', {
    url: (req as any).url
  });
  
  // Set demo user
  req.user = {
    id: 'demo-user',
    email: 'demo@example.com'
  };
  
  // Continue to next middleware (don't close connection)
  next();
  return;
}
```

### Priority 2: Add Sync Trigger to Recoveries Endpoint
**File:** `Integrations-backend/src/routes/amazonRoutes.ts`

```typescript
router.get('/recoveries', wrap(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'demo-user';
    
    // Try to get claims
    let claimsResult = await amazonService.fetchClaims(userId);
    let claims = claimsResult.data || claimsResult.claims || [];
    
    // If no claims, trigger a sync (async, don't wait)
    if (!claims || claims.length === 0) {
      logger.info('No claims found, triggering sync...');
      // Trigger sync in background (don't block response)
      amazonService.syncAmazonData(userId).catch(err => {
        logger.error('Background sync failed', { error: err.message });
      });
      
      return res.json({
        totalAmount: 0.0,
        currency: 'USD',
        claimCount: 0,
        message: 'No data found. Syncing your Amazon account... Please refresh in a few moments.'
      });
    }
    
    // ... rest of the code
  } catch (error: any) {
    // ... error handling
  }
}));
```

### Priority 3: Improve Frontend Error Handling
**Frontend:** Add better error handling for SSE:
```typescript
const eventSource = new EventSource('/api/sse/status');

eventSource.onerror = (error) => {
  console.warn('SSE connection error (this is OK if not logged in):', error);
  // Don't show error to user - just use polling instead
  eventSource.close();
  // Fall back to polling
  startPolling();
};

eventSource.onmessage = (event) => {
  // Handle events
};
```

---

## ✅ Expected Behavior After Fixes

1. **Recoveries Endpoint:**
   - First call: Returns zeros with message "Syncing your Amazon account..."
   - After sync: Returns actual claim data from Amazon SP-API
   - If sandbox has no data: Returns zeros (expected behavior)

2. **SSE Endpoint:**
   - Works without authentication (demo mode)
   - OR requires authentication but handles gracefully
   - Sends real-time updates for sync progress

---

## 🧪 Testing

### Test Recoveries:
1. Press "Use Existing Connection (Skip OAuth)"
2. Wait for recoveries to load
3. Check console logs for sync trigger
4. Refresh page after 10-30 seconds
5. Recoveries should show data (if sandbox has data)

### Test SSE:
1. Open browser DevTools > Network tab
2. Filter by "EventSource" or "sse"
3. Check if connection is established
4. Check if events are being received
5. If error, check response headers and status code

---

## 📝 Summary

**Current Status:**
- ✅ Bypass endpoint works
- ✅ Recoveries endpoint responds (but returns zeros - expected if no sync)
- ⚠️ SSE endpoint requires authentication (frontend not sending auth)
- ⚠️ No sync has been triggered yet (recoveries will be zero until sync)

**Next Steps:**
1. Make SSE endpoint optional (quick fix)
2. Add sync trigger to recoveries endpoint (better UX)
3. Test with actual sandbox data
4. Verify frontend authentication flow

