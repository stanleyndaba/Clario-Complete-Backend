# 📋 Frontend Amazon Connection - Expected Behavior Summary

## 🎯 Current Status

Based on testing, the backend endpoints are working correctly but returning **mock OAuth URLs** because Amazon credentials are not configured in the local environment.

---

## 🔘 Button 1: "Connect Amazon"

### Expected Behavior:
1. **Frontend Action:** User clicks "Connect Amazon" button
2. **API Call:** `GET /api/v1/integrations/amazon/auth/start?frontend_url=<FRONTEND_URL>`
3. **Backend Response (if credentials configured):**
   ```json
   {
     "success": true,
     "ok": true,
     "authUrl": "https://www.amazon.com/ap/oa?client_id=...&response_type=code&redirect_uri=...&state=...",
     "redirectTo": "https://www.amazon.com/ap/oa?...",
     "message": "OAuth flow initiated",
     "state": "..."
   }
   ```
4. **Frontend Action:** Redirect user to `authUrl` (Amazon login page)
5. **User Action:** Authorize app on Amazon
6. **Amazon Redirect:** `GET /api/v1/integrations/amazon/auth/callback?code=...&state=...`
7. **Backend Action:** Exchange code for tokens, store refresh token
8. **Final Redirect:** `/dashboard?amazon_connected=true&message=Connected successfully`

### Current Status (Local - No Credentials):
- ✅ Endpoint working
- ⚠️ Returns mock OAuth URL: `http://localhost:3000/auth/callback?code=mock_auth_code`
- ⚠️ Message: "Mock OAuth URL (credentials not configured)"

### What to Expect in Production (With Credentials):
- ✅ Returns real Amazon OAuth URL
- ✅ User redirected to Amazon login
- ✅ After authorization, tokens stored
- ✅ User redirected to dashboard

---

## 🔘 Button 2: "Use Existing Connection (Skip OAuth)"

### Expected Behavior:
1. **Frontend Action:** User clicks "Use Existing Connection (Skip OAuth)" button
2. **API Call:** `GET /api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=<FRONTEND_URL>`
   OR: `GET /api/v1/integrations/amazon/auth/start?skip_oauth=true&frontend_url=<FRONTEND_URL>`

3. **Backend Response (if `AMAZON_SPAPI_REFRESH_TOKEN` exists):**
   ```json
   {
     "success": true,
     "ok": true,
     "bypassed": true,
     "message": "Using existing Amazon connection",
     "redirectUrl": "http://localhost:3000/dashboard?amazon_connected=true&message=Using%20existing%20Amazon%20connection"
   }
   ```
4. **Frontend Action:** Redirect to `redirectUrl` (dashboard)
5. **Result:** User goes directly to dashboard, no Amazon login needed

### Current Status (Local - No Refresh Token):
- ✅ Endpoint working
- ⚠️ Falls back to OAuth flow (no `AMAZON_SPAPI_REFRESH_TOKEN` in environment)
- ⚠️ Returns mock OAuth URL instead of bypassing

### What to Expect (With Refresh Token):
- ✅ Returns `bypassed: true`
- ✅ Redirects directly to dashboard
- ✅ No Amazon login required
- ✅ Uses existing refresh token from environment

---

## 🔧 Configuration Required for Sandbox

To make the frontend work correctly with sandbox Amazon SP-API, set these environment variables in your backend:

### Required Environment Variables:

```bash
# Amazon OAuth Credentials (from Amazon Developer Console)
AMAZON_CLIENT_ID=your_lwa_client_id
AMAZON_CLIENT_SECRET=your_lwa_client_secret
AMAZON_REDIRECT_URI=https://your-backend-url.onrender.com/api/v1/integrations/amazon/auth/callback

# Amazon SP-API Configuration
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_SPAPI_REFRESH_TOKEN=your_refresh_token_from_oauth_flow

# Optional (for production)
AMAZON_MARKETPLACE_ID=your_marketplace_id
```

### How to Get Credentials:

1. **Go to Amazon Developer Console:**
   - https://developer.amazon.com/
   - Login with your Amazon Seller account

2. **Create/Select Security Profile:**
   - Go to "Login with Amazon" → "Security Profiles"
   - Create new or select existing profile
   - Note the Client ID and Client Secret

3. **Configure Redirect URI:**
   - In Security Profile → Web Settings
   - Add: `https://your-backend-url.onrender.com/api/v1/integrations/amazon/auth/callback`
   - Must match `AMAZON_REDIRECT_URI` exactly

4. **Get Refresh Token:**
   - Complete OAuth flow once (click "Connect Amazon")
   - Backend will receive refresh token in callback
   - Store it in `AMAZON_SPAPI_REFRESH_TOKEN`
   - Or use existing refresh token if you have one

---

## 🧪 How to Verify Frontend Works

### Step 1: Check Frontend Code

Verify frontend calls correct endpoints:

```typescript
// "Connect Amazon" button should call:
const response = await fetch(
  `${INTEGRATIONS_URL}/api/v1/integrations/amazon/auth/start?frontend_url=${FRONTEND_URL}`
);
const data = await response.json();
// Redirect to data.authUrl

// "Use Existing Connection" button should call:
const response = await fetch(
  `${INTEGRATIONS_URL}/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=${FRONTEND_URL}`
);
const data = await response.json();
if (data.bypassed) {
  // Redirect to data.redirectUrl
} else {
  // Fall back to OAuth flow
}
```

### Step 2: Test Locally

1. **Start Frontend:**
   ```bash
   cd opside-complete-frontend
   npm install
   npm run dev
   ```

2. **Open Browser:**
   - Go to: `http://localhost:3000`
   - Open DevTools → Network tab
   - Open DevTools → Console tab

3. **Test "Connect Amazon":**
   - Click button
   - Check Network tab for request to `/api/v1/integrations/amazon/auth/start`
   - Verify response contains `authUrl`
   - Should redirect to Amazon (or mock URL if credentials not configured)

4. **Test "Use Existing Connection":**
   - Click button
   - Check Network tab for request with `?bypass=true`
   - If token exists: Should get `bypassed: true` and redirect to dashboard
   - If no token: Should fall back to OAuth flow

### Step 3: Check Backend Logs

Watch backend logs for:
- OAuth initiation: `"Starting OAuth flow"`
- Bypass detection: `"Bypassing OAuth flow - using existing refresh token"`
- Token refresh: `"Refreshing Amazon SP-API access token"`
- Errors: Check for credential errors

---

## ✅ Success Criteria

Your frontend Amazon connection is working correctly if:

### For "Connect Amazon":
- [ ] Button calls correct endpoint
- [ ] Backend returns OAuth URL (real or mock)
- [ ] Frontend redirects to OAuth URL
- [ ] After authorization, user redirected to dashboard
- [ ] Dashboard shows "Amazon Connected" status

### For "Use Existing Connection":
- [ ] Button calls endpoint with `?bypass=true`
- [ ] If token exists: Returns `bypassed: true` and redirects to dashboard
- [ ] If no token: Falls back to OAuth flow
- [ ] No errors in console

---

## 🐛 Common Issues

### Issue 1: "Cannot connect to backend"
**Fix:**
- Check `NEXT_PUBLIC_INTEGRATIONS_URL` is set correctly
- Verify backend is running
- Check CORS configuration

### Issue 2: "Mock OAuth URL" returned
**Fix:**
- Set `AMAZON_CLIENT_ID` in backend environment
- Set `AMAZON_CLIENT_SECRET` in backend environment
- Set `AMAZON_REDIRECT_URI` in backend environment
- Restart backend server

### Issue 3: "Use Existing Connection" doesn't skip OAuth
**Fix:**
- Set `AMAZON_SPAPI_REFRESH_TOKEN` in backend environment
- Verify `?bypass=true` is in request URL
- Check backend logs for bypass detection

### Issue 4: OAuth callback fails
**Fix:**
- Verify `AMAZON_REDIRECT_URI` matches Developer Console exactly
- Check callback endpoint exists: `/api/v1/integrations/amazon/auth/callback`
- Verify frontend URL is passed in OAuth state
- Check backend logs for specific error

---

## 📝 Frontend Implementation Checklist

Your frontend should:

- [ ] Use `NEXT_PUBLIC_INTEGRATIONS_URL` from environment variables
- [ ] "Connect Amazon" calls `/api/v1/integrations/amazon/auth/start`
- [ ] "Use Existing Connection" calls `/api/v1/integrations/amazon/auth/start?bypass=true`
- [ ] Handles `authUrl` response and redirects user
- [ ] Handles `redirectUrl` response for bypass flow
- [ ] Passes `frontend_url` query parameter
- [ ] Handles errors gracefully
- [ ] Shows loading state during API calls
- [ ] Displays success/error messages to user

---

## 🚀 Next Steps

1. **Configure Backend Credentials:**
   - Set Amazon credentials in backend environment
   - Set refresh token if you have one (for "Use Existing Connection")

2. **Test Frontend Locally:**
   - Start frontend: `npm run dev`
   - Test both buttons
   - Verify correct API calls
   - Check for errors in console

3. **Test in Production:**
   - Deploy frontend with correct backend URL
   - Test OAuth flow end-to-end
   - Verify tokens are stored
   - Test "Use Existing Connection" with refresh token

---

## 📚 References

- **Backend Controller:** `Integrations-backend/src/controllers/amazonController.ts`
- **Backend Routes:** `Integrations-backend/src/routes/amazonRoutes.ts`
- **Backend Service:** `Integrations-backend/src/services/amazonService.ts`
- **Frontend Repo:** https://github.com/stanleyndaba/opside-complete-frontend
- **Test Script:** `test-amazon-connection-frontend.ps1`
- **Verification Guide:** `FRONTEND_AMAZON_CONNECTION_VERIFICATION.md`

