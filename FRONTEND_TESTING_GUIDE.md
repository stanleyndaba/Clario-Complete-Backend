# 🧪 Frontend Testing Guide - After Backend Fixes

## ✅ What Was Fixed

1. **SSE Endpoint** - Added `/api/sse/status` endpoint
2. **SSE Authentication** - Now supports cookie-based auth (EventSource compatible)
3. **Missing API Endpoints** - Added `/api/v1/integrations/status` proxy
4. **Metrics Endpoints** - Fixed Python API URL in proxy routes

---

## 🧪 Testing Checklist

### 1. **Test SSE Connection** ✅

**What to check:**
- Open browser DevTools → Console
- Look for SSE connection errors
- Should NOT see: `EventSource's response has a MIME type ("text/html")`

**Expected:**
- ✅ No SSE errors in console
- ✅ SSE connection established
- ✅ Real-time updates work (if any events are sent)

**How to verify:**
```javascript
// In browser console, check if EventSource is working
// The frontend automatically connects to /api/sse/status
// Check Network tab → Filter by "sse" or "status"
```

---

### 2. **Test "Use Existing Connection" Button** 🔄

**What it does:**
- Skips OAuth flow if refresh token exists
- Uses existing `AMAZON_SPAPI_REFRESH_TOKEN` from environment
- Redirects directly to dashboard

**How to test:**
1. Click "Use Existing Connection (Skip OAuth)" button
2. **If token exists:**
   - ✅ Should redirect to dashboard immediately
   - ✅ Should show "Using existing Amazon connection" message
   - ✅ No OAuth redirect to Amazon
3. **If token doesn't exist:**
   - ⚠️ Falls back to normal OAuth flow
   - ⚠️ Redirects to Amazon login page

**Expected behavior:**
- If you have `AMAZON_SPAPI_REFRESH_TOKEN` set in backend env vars → Should work ✅
- If you don't have token → Will fall back to OAuth ⚠️

---

### 3. **Test API Endpoints** 📡

**Test these endpoints in browser console:**

```javascript
// Test integrations status (should work now)
fetch('https://opside-node-api-woco.onrender.com/api/v1/integrations/status', {
  credentials: 'include'
}).then(r => r.json()).then(console.log);

// Test metrics endpoints (requires auth)
fetch('https://opside-node-api-woco.onrender.com/api/metrics/recoveries', {
  credentials: 'include'
}).then(r => r.json()).then(console.log);

// Test Amazon recoveries (should work)
fetch('https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/recoveries', {
  credentials: 'include'
}).then(r => r.json()).then(console.log);
```

**Expected:**
- ✅ `/api/v1/integrations/status` - Returns 200 (with auth) or 401 (without auth)
- ✅ `/api/metrics/recoveries` - Returns 200 (with auth) or 401/404 (without auth)
- ✅ `/api/v1/integrations/amazon/recoveries` - Returns 200

---

### 4. **Test Authentication** 🔐

**Check if cookies are being sent:**
1. Open DevTools → Network tab
2. Make any API request
3. Click on the request → Headers tab
4. Check "Request Headers" → Look for `Cookie: session_token=...`

**Expected:**
- ✅ If logged in: Should see `session_token` cookie
- ⚠️ If not logged in: No cookie (401 errors expected)

---

### 5. **Test Real-Time Updates** 🔔

**What to check:**
- SSE connection should stay open
- Should receive heartbeat every 30 seconds
- Should receive events when actions happen (sync, detection, etc.)

**How to verify:**
```javascript
// In browser console
const es = new EventSource('/api/sse/status', { withCredentials: true });
es.onmessage = (e) => console.log('SSE Event:', e.data);
es.onerror = (e) => console.error('SSE Error:', e);
```

**Expected:**
- ✅ Connection opens successfully
- ✅ Receives `connected` event
- ✅ Receives heartbeat events every 30s
- ✅ No errors

---

## 🐛 Common Issues & Fixes

### Issue 1: SSE Still Getting HTML Error
**Possible causes:**
- User not logged in (no `session_token` cookie)
- CORS issue
- Backend not deployed yet

**Fix:**
- Ensure user is logged in
- Check browser cookies (DevTools → Application → Cookies)
- Wait for backend deployment to complete

### Issue 2: "Use Existing Connection" Doesn't Work
**Possible causes:**
- No `AMAZON_SPAPI_REFRESH_TOKEN` in backend environment
- Token expired or invalid

**Fix:**
- Check backend environment variables in Render
- Verify `AMAZON_SPAPI_REFRESH_TOKEN` is set
- If not set, use normal OAuth flow instead

### Issue 3: Metrics Endpoints Return 404
**Possible causes:**
- Not authenticated (no cookie/token)
- Python API not responding

**Fix:**
- Ensure user is logged in
- Check if Python API is running: `https://python-api-newest.onrender.com/health`

### Issue 4: CORS Errors
**Possible causes:**
- Frontend URL not in backend CORS whitelist
- Cookies not being sent cross-origin

**Fix:**
- Check backend CORS configuration
- Ensure `credentials: 'include'` in fetch requests
- Check if frontend URL is allowed

---

## 📊 Expected Console Output

### ✅ **Good (No Errors):**
```
[API] Using environment variable VITE_API_BASE_URL: https://opside-node-api-woco.onrender.com
[API] Requesting: https://opside-node-api-woco.onrender.com/api/v1/integrations/status
[API] Fetch completed in 954ms - Status: 200
[API] Success for https://opside-node-api-woco.onrender.com/api/v1/integrations/status
```

### ⚠️ **Expected (Auth Required):**
```
[API] Fetch completed in 1074ms - Status: 404 for /api/metrics/recoveries
[API] HTTP 404 error: Not found - /api/metrics/recoveries
```
*(This is expected if not authenticated - metrics endpoints require auth)*

### ❌ **Bad (Should Not See):**
```
EventSource's response has a MIME type ("text/html") that is not "text/event-stream"
GET /api/sse/status 404 (Not Found)
CORS error: ...
```

---

## 🎯 Quick Test Script

Run this in browser console after opening frontend:

```javascript
// Test all endpoints
async function testEndpoints() {
  const base = 'https://opside-node-api-woco.onrender.com';
  
  console.log('🧪 Testing endpoints...\n');
  
  // Test 1: Health check
  const health = await fetch(`${base}/health`).then(r => r.json());
  console.log('✅ Health:', health);
  
  // Test 2: Integrations status
  const status = await fetch(`${base}/api/v1/integrations/status`, {
    credentials: 'include'
  }).then(r => ({ status: r.status, ok: r.ok }));
  console.log('📊 Integrations Status:', status);
  
  // Test 3: Amazon recoveries
  const recoveries = await fetch(`${base}/api/v1/integrations/amazon/recoveries`, {
    credentials: 'include'
  }).then(r => r.json());
  console.log('💰 Amazon Recoveries:', recoveries);
  
  // Test 4: SSE (check if endpoint exists)
  try {
    const sse = await fetch(`${base}/api/sse/status`, {
      credentials: 'include'
    });
    console.log('🔔 SSE Status:', sse.status, sse.headers.get('content-type'));
  } catch (e) {
    console.log('⚠️ SSE:', e.message);
  }
  
  console.log('\n✅ Testing complete!');
}

testEndpoints();
```

---

## 📝 Test Results Template

```
## Frontend Test Results - [Date]

### SSE Connection
- [ ] No MIME type errors
- [ ] Connection established
- [ ] Receives events

### API Endpoints
- [ ] /api/v1/integrations/status works
- [ ] /api/metrics/recoveries works (with auth)
- [ ] /api/v1/integrations/amazon/recoveries works

### Use Existing Connection
- [ ] Button works
- [ ] Skips OAuth (if token exists)
- [ ] Redirects correctly

### Authentication
- [ ] Cookies are sent
- [ ] User is logged in
- [ ] Auth errors handled gracefully

### Issues Found
- [List any issues]

### Next Steps
- [What to fix next]
```

---

**Ready to test! Open the frontend and check the console.** 🚀

