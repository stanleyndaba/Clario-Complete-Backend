# 🧪 Frontend Amazon Connection Verification Guide

## 📋 Overview

This guide explains what should happen when users click the Amazon connection buttons in the frontend, and how to verify everything is working correctly with the sandbox Amazon SP-API.

---

## 🎯 Expected Behavior

### 1. **"Connect Amazon" Button**

**What it does:**
- Initiates the OAuth flow with Amazon SP-API
- Redirects user to Amazon authorization page
- After authorization, redirects back to frontend dashboard

**Expected Flow:**
1. Frontend calls: `GET /api/v1/integrations/amazon/auth/start?frontend_url=<FRONTEND_URL>`
2. Backend responds with:
   ```json
   {
     "success": true,
     "ok": true,
     "authUrl": "https://sandbox.sellingpartnerapi-na.amazon.com/authorization?...",
     "redirectTo": "https://sandbox.sellingpartnerapi-na.amazon.com/authorization?...",
     "message": "OAuth flow initiated",
     "state": "..."
   }
   ```
3. Frontend redirects user to `authUrl` (Amazon login page)
4. User authorizes the app on Amazon
5. Amazon redirects to: `/api/v1/integrations/amazon/auth/callback?code=...&state=...`
6. Backend exchanges code for tokens and redirects to: `/dashboard?amazon_connected=true`

**For Sandbox:**
- If credentials are not configured, backend returns mock OAuth URL
- If credentials ARE configured, backend returns real Amazon sandbox OAuth URL

---

### 2. **"Use Existing Connection (Skip OAuth)" Button**

**What it does:**
- Skips OAuth flow if refresh token exists in backend environment
- Uses existing `AMAZON_SPAPI_REFRESH_TOKEN` from environment variables
- Redirects directly to dashboard

**Expected Flow:**
1. Frontend calls: `GET /api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=<FRONTEND_URL>`
   OR: `GET /api/v1/integrations/amazon/auth/start?skip_oauth=true&frontend_url=<FRONTEND_URL>`

2. **If `AMAZON_SPAPI_REFRESH_TOKEN` exists in backend:**
   ```json
   {
     "success": true,
     "ok": true,
     "bypassed": true,
     "message": "Using existing Amazon connection",
     "redirectUrl": "http://localhost:3000/dashboard?amazon_connected=true&message=Using%20existing%20Amazon%20connection"
   }
   ```
   - Frontend should redirect to `redirectUrl`
   - User goes directly to dashboard (no Amazon login)

3. **If `AMAZON_SPAPI_REFRESH_TOKEN` does NOT exist:**
   - Backend falls through to normal OAuth flow
   - Returns OAuth URL (same as "Connect Amazon" button)
   - User goes through normal OAuth flow

---

## 🔍 Verification Steps

### Step 1: Check Backend Environment Variables

Verify that your backend has the required Amazon credentials:

```bash
# Check if backend has refresh token (for "Use Existing Connection")
# This should be set if you want to skip OAuth
echo $AMAZON_SPAPI_REFRESH_TOKEN

# Check other required variables
echo $AMAZON_CLIENT_ID
echo $AMAZON_CLIENT_SECRET
echo $AMAZON_REDIRECT_URI
```

**For Sandbox:**
- `AMAZON_SPAPI_REFRESH_TOKEN` - Refresh token from Amazon Developer Console
- `AMAZON_CLIENT_ID` - Your LWA client ID
- `AMAZON_CLIENT_SECRET` - Your LWA client secret
- `AMAZON_REDIRECT_URI` - Must match Developer Console settings
- `AMAZON_SPAPI_BASE_URL` - Should be `https://sandbox.sellingpartnerapi-na.amazon.com` (or not set for auto-detection)

---

### Step 2: Test Backend Endpoints Locally

Test the backend endpoints to verify they work:

```bash
# Test "Connect Amazon" endpoint
curl "http://localhost:3001/api/v1/integrations/amazon/auth/start?frontend_url=http://localhost:3000"

# Expected response (if credentials configured):
# {
#   "success": true,
#   "authUrl": "https://sandbox.sellingpartnerapi-na.amazon.com/authorization?...",
#   "message": "OAuth flow initiated"
# }

# Test "Use Existing Connection" endpoint
curl "http://localhost:3001/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=http://localhost:3000"

# Expected response (if AMAZON_SPAPI_REFRESH_TOKEN exists):
# {
#   "success": true,
#   "bypassed": true,
#   "redirectUrl": "http://localhost:3000/dashboard?amazon_connected=true&message=..."
# }
```

---

### Step 3: Verify Frontend Configuration

Check that frontend is calling the correct endpoints:

1. **Check Frontend Environment Variables:**
   - `NEXT_PUBLIC_INTEGRATIONS_URL` should point to your backend
   - For local: `http://localhost:3001`
   - For production: `https://opside-node-api.onrender.com`

2. **Check Frontend Code:**
   - "Connect Amazon" should call: `/api/v1/integrations/amazon/auth/start`
   - "Use Existing Connection" should call: `/api/v1/integrations/amazon/auth/start?bypass=true`

---

### Step 4: Test Frontend Locally

1. **Start Frontend:**
   ```bash
   cd opside-complete-frontend
   npm install
   npm run dev
   ```

2. **Open Browser:**
   - Navigate to: `http://localhost:3000`
   - Open DevTools → Network tab
   - Open DevTools → Console tab

3. **Click "Connect Amazon" Button:**
   - Watch Network tab for request to `/api/v1/integrations/amazon/auth/start`
   - Check response contains `authUrl`
   - Should redirect to Amazon authorization page

4. **Click "Use Existing Connection" Button:**
   - Watch Network tab for request to `/api/v1/integrations/amazon/auth/start?bypass=true`
   - If token exists: Should get `bypassed: true` and redirect to dashboard
   - If token doesn't exist: Should fall back to OAuth flow

---

## 🐛 Troubleshooting

### Issue: "Cannot connect to backend"

**Symptoms:**
- Frontend shows error: "Cannot connect to backend"
- Network tab shows failed request

**Solutions:**
1. Check `NEXT_PUBLIC_INTEGRATIONS_URL` is set correctly
2. Verify backend is running on the correct port
3. Check CORS configuration in backend
4. Verify backend endpoint exists: `/api/v1/integrations/amazon/auth/start`

---

### Issue: "Mock OAuth URL" returned

**Symptoms:**
- Backend returns: `"authUrl": "http://localhost:3000/auth/callback?code=mock_auth_code"`
- Message: "Mock OAuth URL (credentials not configured)"

**Solutions:**
1. Set `AMAZON_CLIENT_ID` in backend environment
2. Set `AMAZON_CLIENT_SECRET` in backend environment
3. Set `AMAZON_REDIRECT_URI` in backend environment
4. Restart backend server

---

### Issue: "Use Existing Connection" doesn't skip OAuth

**Symptoms:**
- Clicking "Use Existing Connection" still redirects to Amazon login

**Solutions:**
1. Verify `AMAZON_SPAPI_REFRESH_TOKEN` is set in backend environment
2. Check that `?bypass=true` or `?skip_oauth=true` is in the request URL
3. Verify backend controller checks for bypass parameter (see `amazonController.ts`)

---

### Issue: OAuth callback fails

**Symptoms:**
- After authorizing on Amazon, redirect fails
- Error: "OAuth callback failed"

**Solutions:**
1. Verify `AMAZON_REDIRECT_URI` matches Developer Console exactly
2. Check that callback endpoint exists: `/api/v1/integrations/amazon/auth/callback`
3. Verify frontend URL is passed correctly in OAuth state
4. Check backend logs for specific error message

---

## 📝 Frontend Code Checklist

Verify your frontend code has:

- [ ] Correct backend URL from environment variable
- [ ] "Connect Amazon" button calls `/api/v1/integrations/amazon/auth/start`
- [ ] "Use Existing Connection" button calls `/api/v1/integrations/amazon/auth/start?bypass=true`
- [ ] Handles `authUrl` response and redirects user
- [ ] Handles `redirectUrl` response for bypass flow
- [ ] Handles errors gracefully
- [ ] Passes `frontend_url` query parameter

---

## 🧪 Test Script

Use this test script to verify backend endpoints:

```bash
#!/bin/bash

BACKEND_URL="http://localhost:3001"
FRONTEND_URL="http://localhost:3000"

echo "🧪 Testing Amazon Connection Endpoints"
echo "======================================"
echo ""

echo "1. Testing 'Connect Amazon' endpoint..."
curl -s "${BACKEND_URL}/api/v1/integrations/amazon/auth/start?frontend_url=${FRONTEND_URL}" | jq '.'
echo ""
echo ""

echo "2. Testing 'Use Existing Connection' endpoint..."
curl -s "${BACKEND_URL}/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=${FRONTEND_URL}" | jq '.'
echo ""
echo ""

echo "3. Testing diagnostics endpoint..."
curl -s "${BACKEND_URL}/api/v1/integrations/amazon/diagnose" | jq '.'
echo ""
echo ""

echo "✅ Tests complete!"
```

---

## ✅ Success Criteria

Your frontend Amazon connection is working correctly if:

1. ✅ "Connect Amazon" button redirects to Amazon authorization page
2. ✅ After authorization, user is redirected back to dashboard
3. ✅ "Use Existing Connection" button skips OAuth (if token exists)
4. ✅ Dashboard shows "Amazon Connected" status
5. ✅ No errors in browser console
6. ✅ No errors in backend logs

---

## 📚 References

- Backend Controller: `Integrations-backend/src/controllers/amazonController.ts`
- Backend Routes: `Integrations-backend/src/routes/amazonRoutes.ts`
- Backend Service: `Integrations-backend/src/services/amazonService.ts`
- Frontend Repo: https://github.com/stanleyndaba/opside-complete-frontend

