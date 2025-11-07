# 🧪 Complete Testing Plan - Full Stack Verification

## 🎯 Testing Priority (Do in Order)

### ✅ Phase 1: Backend Health Checks (5 minutes)
**Goal:** Verify both backends are running and accessible

### ✅ Phase 2: API Endpoint Tests (10 minutes)
**Goal:** Test critical API endpoints

### ✅ Phase 3: Frontend-Backend Integration (10 minutes)
**Goal:** Verify frontend connects to backends correctly

### ✅ Phase 4: End-to-End User Flows (15 minutes)
**Goal:** Test complete user workflows

### ✅ Phase 5: Database & Services (10 minutes)
**Goal:** Verify database connections and external services

---

## 📋 Phase 1: Backend Health Checks

### Test 1.1: Python API Health
```bash
curl https://python-api-newest.onrender.com/health
```
**Expected:** `{"status":"ok","service":"Opside Python API","version":"2.0.0","timestamp":"..."}`

### Test 1.2: Node.js API Health
```bash
curl https://opside-node-api-woco.onrender.com/health
```
**Expected:** `{"status":"ok","timestamp":"..."}`

### Test 1.3: Node.js API Status
```bash
curl https://opside-node-api-woco.onrender.com/api/status
```
**Expected:** `{"status":"operational","version":"1.0.0","timestamp":"..."}`

---

## 📋 Phase 2: API Endpoint Tests

### Test 2.1: Python API - Recoveries Endpoint
```bash
# Note: This requires authentication, test from frontend
curl -X GET https://python-api-newest.onrender.com/api/v1/integrations/amazon/recoveries \
  -H "Authorization: Bearer YOUR_TOKEN"
```
**Expected:** Should return recoveries data or proper error

### Test 2.2: Node.js API - Amazon Recoveries
```bash
curl https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/recoveries
```
**Expected:** Returns recoveries data or zeros if no data

### Test 2.3: Node.js API - Amazon Auth Start
```bash
curl https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start
```
**Expected:** Redirects to Amazon OAuth or returns auth URL

---

## 📋 Phase 3: Frontend-Backend Integration

### Test 3.1: Frontend Loads
1. Open frontend in browser
2. Open DevTools (F12) → Console tab
3. **Check for errors**
4. **Expected:** No connection errors to backends

### Test 3.2: Frontend API Calls
1. Open DevTools (F12) → Network tab
2. Filter by: `opside-node-api-woco.onrender.com`
3. Trigger any action (e.g., load dashboard, connect Amazon)
4. **Check:**
   - ✅ Requests go to correct backend URL
   - ✅ No CORS errors
   - ✅ Responses are received (200 status)

### Test 3.3: Verify Environment Variables
1. Open browser console
2. Check what API URLs are being used:
   ```javascript
   // In browser console
   console.log('API URL:', import.meta.env.VITE_API_BASE_URL);
   // or
   console.log('API URL:', process.env.NEXT_PUBLIC_API_URL);
   ```
3. **Expected:** Should show `opside-node-api-woco.onrender.com`

---

## 📋 Phase 4: End-to-End User Flows

### Test 4.1: Amazon OAuth Flow
1. **Start:** Click "Connect Amazon" in frontend
2. **Expected:**
   - Redirects to Amazon OAuth page
   - User can authorize
   - Redirects back to frontend
   - Shows "Connected" status
   - No errors in console

### Test 4.2: Amazon Data Sync
1. **Prerequisites:** Amazon is connected
2. **Action:** Trigger data sync (if available)
3. **Expected:**
   - Sync starts successfully
   - Progress updates visible
   - Data appears after sync completes
   - No errors in console/logs

### Test 4.3: View Recoveries
1. **Action:** Navigate to recoveries/claims page
2. **Expected:**
   - Page loads without errors
   - Data is displayed (or shows "No data" message)
   - No console errors
   - API calls visible in Network tab

### Test 4.4: Metrics Dashboard
1. **Action:** Navigate to dashboard/metrics page
2. **Expected:**
   - Metrics load successfully
   - Charts/graphs display correctly
   - No timeout errors
   - API calls complete within reasonable time

---

## 📋 Phase 5: Database & Services

### Test 5.1: Check Database Connection (Node.js)
**Check Render logs for:**
- ✅ No "demo Supabase client" warnings
- ✅ Database queries working
- ✅ Data persistence working

### Test 5.2: Check Database Connection (Python)
**Check Render logs for:**
- ✅ No database connection errors
- ✅ Health check shows database connected

### Test 5.3: Amazon SP-API Connection
1. **Action:** Trigger Amazon API call
2. **Check logs:**
   - ✅ No authentication errors
   - ✅ API calls successful
   - ✅ Data retrieved correctly

### Test 5.4: Cross-Service Communication
**Test Python API calling Node.js API:**
1. Call Python API endpoint that uses `INTEGRATIONS_URL`
2. **Check logs:**
   - ✅ Python API successfully calls Node.js API
   - ✅ No connection errors
   - ✅ Data flows correctly

---

## 🐛 Common Issues & Fixes

### Issue 1: CORS Errors
**Symptoms:** Browser console shows CORS errors
**Fix:** Check backend CORS configuration includes frontend URL

### Issue 2: 404 Errors
**Symptoms:** API calls return 404
**Fix:** Verify endpoint paths match between frontend and backend

### Issue 3: 401 Unauthorized
**Symptoms:** API calls return 401
**Fix:** Check authentication tokens are being sent correctly

### Issue 4: Timeout Errors
**Symptoms:** Requests timeout after 45 seconds
**Fix:** Check backend is responding, verify timeouts are set correctly

### Issue 5: Database Connection Errors
**Symptoms:** "demo Supabase client" warnings
**Fix:** Verify `DATABASE_URL` or `SUPABASE_URL` is set correctly in Render

---

## ✅ Testing Checklist

### Backend Health
- [ ] Python API health check works
- [ ] Node.js API health check works
- [ ] Both services respond quickly (< 2 seconds)

### Frontend Integration
- [ ] Frontend loads without errors
- [ ] API calls go to correct backend URLs
- [ ] No CORS errors
- [ ] Environment variables are correct

### API Endpoints
- [ ] Amazon recoveries endpoint works
- [ ] Amazon auth endpoint works
- [ ] Metrics endpoint works
- [ ] Sync endpoints work (if available)

### User Flows
- [ ] Amazon OAuth flow works
- [ ] Data sync works
- [ ] Recoveries display correctly
- [ ] Dashboard metrics display correctly

### Services
- [ ] Database connections working
- [ ] Amazon SP-API working
- [ ] Cross-service communication working
- [ ] No critical warnings in logs

---

## 🎯 Quick Smoke Test (5 minutes)

**If you're short on time, do these essential tests:**

1. ✅ Backend health checks (both services)
2. ✅ Frontend loads without errors
3. ✅ Frontend makes API calls to correct backend
4. ✅ One user flow works (e.g., view recoveries)

If all 4 pass, the basic stack is working! 🎉

---

## 📊 Test Results Template

```
## Test Results - [Date]

### Backend Health
- Python API: ✅ / ❌
- Node.js API: ✅ / ❌

### Frontend Integration
- Frontend loads: ✅ / ❌
- API calls correct: ✅ / ❌
- No CORS errors: ✅ / ❌

### API Endpoints
- Amazon recoveries: ✅ / ❌
- Amazon auth: ✅ / ❌
- Metrics: ✅ / ❌

### User Flows
- OAuth flow: ✅ / ❌
- Data sync: ✅ / ❌
- Recoveries display: ✅ / ❌

### Issues Found
- [List any issues]

### Next Steps
- [What to fix next]
```

---

**Start with Phase 1 and work through each phase. Let me know what you find!** 🚀

