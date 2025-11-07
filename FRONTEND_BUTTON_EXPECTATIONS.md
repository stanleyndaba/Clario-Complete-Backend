# 🎯 Frontend Button Expectations - What Should Happen

## 🔘 Button 1: "Connect Amazon Account"

### Expected Flow:

1. **Frontend Action:**
   - User clicks "Connect Amazon Account" button
   - Frontend calls: `GET /api/v1/integrations/amazon/auth/start?frontend_url=<YOUR_FRONTEND_URL>`

2. **Backend Response (After Credentials Fixed):**
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

3. **Frontend Action:**
   - Frontend should redirect user to the `authUrl` (Amazon login page)

4. **User Action:**
   - User logs into Amazon
   - User authorizes the application

5. **Amazon Redirect:**
   - Amazon redirects to: `https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback?code=...&state=...`

6. **Backend Action:**
   - Backend exchanges authorization code for access token and refresh token
   - Stores refresh token (in database or environment)
   - Redirects to: `<YOUR_FRONTEND_URL>/dashboard?amazon_connected=true&message=Connected successfully`

7. **Final Result:**
   - ✅ User lands on dashboard
   - ✅ Dashboard shows "Amazon Connected" status
   - ✅ User can now sync data from Amazon

---

### ⚠️ If Credentials Not Fixed (Current State):

If you haven't fixed the `AMAZON_REDIRECT_URI` (removed `@` symbol) or set `AMAZON_CLIENT_ID` in Render:

**Backend Response:**
```json
{
  "success": true,
  "ok": true,
  "authUrl": "http://localhost:3000/auth/callback?code=mock_auth_code&state=mock_state",
  "message": "Mock OAuth URL (credentials not configured)"
}
```

**What Happens:**
- ❌ Frontend redirects to mock URL (won't work)
- ❌ OAuth flow doesn't complete
- ❌ Amazon connection fails

**Fix:** Make sure you've:
1. Removed `@` from `AMAZON_REDIRECT_URI` in Render
2. Set `AMAZON_CLIENT_ID` in Render
3. Set `AMAZON_CLIENT_SECRET` in Render
4. Restarted Node.js API on Render

---

## 🔘 Button 2: "Use Existing Connection (Skip OAuth)"

### Expected Flow (If Refresh Token Exists):

1. **Frontend Action:**
   - User clicks "Use Existing Connection (Skip OAuth)" button
   - Frontend calls: `GET /api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=<YOUR_FRONTEND_URL>`
   OR: `GET /api/v1/integrations/amazon/auth/start?skip_oauth=true&frontend_url=<YOUR_FRONTEND_URL>`

2. **Backend Response (If `AMAZON_SPAPI_REFRESH_TOKEN` exists):**
   ```json
   {
     "success": true,
     "ok": true,
     "bypassed": true,
     "message": "Using existing Amazon connection",
     "redirectUrl": "<YOUR_FRONTEND_URL>/dashboard?amazon_connected=true&message=Using%20existing%20Amazon%20connection"
   }
   ```

3. **Frontend Action:**
   - Frontend should redirect user to `redirectUrl` (dashboard)

4. **Final Result:**
   - ✅ User goes directly to dashboard (no Amazon login)
   - ✅ Dashboard shows "Amazon Connected" status
   - ✅ Uses existing refresh token from backend environment
   - ✅ User can immediately sync data

---

### ⚠️ If Refresh Token Doesn't Exist:

**Backend Response:**
```json
{
  "success": true,
  "ok": true,
  "authUrl": "https://www.amazon.com/ap/oa?...",
  "message": "OAuth flow initiated"
}
```

**What Happens:**
- ⚠️ Falls back to normal OAuth flow
- ⚠️ User redirected to Amazon login page
- ⚠️ User goes through normal OAuth process

**This is expected behavior** - if no refresh token exists, the system can't skip OAuth, so it starts the OAuth flow instead.

---

## 🔍 How to Verify What's Happening

### Check 1: Browser DevTools → Network Tab

1. Open your frontend
2. Open DevTools (F12) → Network tab
3. Click "Connect Amazon Account" or "Use Existing Connection"
4. Look for request to: `/api/v1/integrations/amazon/auth/start`

**Check the response:**
- ✅ Should see `authUrl` with `amazon.com` domain (if credentials fixed)
- ✅ Should see `bypassed: true` if using existing connection with token
- ❌ Should NOT see `mock_auth_code` (means credentials not configured)

---

### Check 2: Browser Console

1. Open DevTools (F12) → Console tab
2. Click the button
3. Look for:
   - ✅ API response logged
   - ✅ Redirect happening
   - ❌ Error messages

---

### Check 3: Backend Logs (Render)

1. Go to Render Dashboard → Your Node.js API → Logs
2. Click the button in frontend
3. Look for logs:
   - ✅ "Starting OAuth flow" - Normal OAuth
   - ✅ "Bypassing OAuth flow - using existing refresh token" - Skip OAuth working
   - ❌ "Amazon client ID not configured" - Credentials missing
   - ❌ "Mock OAuth URL" - Credentials not set

---

## ✅ Success Criteria

### For "Connect Amazon":
- [ ] Frontend calls correct endpoint
- [ ] Backend returns real Amazon OAuth URL (not mock)
- [ ] User redirected to Amazon login
- [ ] After authorization, user redirected to dashboard
- [ ] Dashboard shows "Amazon Connected"

### For "Use Existing Connection":
- [ ] Frontend calls endpoint with `?bypass=true`
- [ ] If token exists: Returns `bypassed: true` and redirects to dashboard
- [ ] If no token: Falls back to OAuth flow (expected)
- [ ] No errors in console
- [ ] Dashboard shows "Amazon Connected"

---

## 🐛 Troubleshooting

### Issue: "Connect Amazon" Returns Mock URL

**Symptoms:**
- Response contains: `"authUrl": "http://localhost:3000/auth/callback?code=mock_auth_code"`
- Message: "Mock OAuth URL (credentials not configured)"

**Fix:**
1. Check Render Dashboard → Node.js API → Environment Variables
2. Verify `AMAZON_CLIENT_ID` is set (no `@` symbol)
3. Verify `AMAZON_CLIENT_SECRET` is set
4. Verify `AMAZON_REDIRECT_URI` is set correctly (no `@` at start)
5. Restart Node.js API on Render

---

### Issue: "Use Existing Connection" Doesn't Skip OAuth

**Symptoms:**
- Button redirects to Amazon login instead of dashboard
- Response doesn't contain `bypassed: true`

**Fix:**
1. Check Render Dashboard → Node.js API → Environment Variables
2. Verify `AMAZON_SPAPI_REFRESH_TOKEN` is set
3. Make sure frontend calls endpoint with `?bypass=true` parameter
4. Check backend logs for "Bypassing OAuth flow" message

---

### Issue: OAuth Callback Fails

**Symptoms:**
- User authorizes on Amazon
- Redirect fails or shows error

**Fix:**
1. Verify `AMAZON_REDIRECT_URI` matches Developer Console exactly
2. Check callback endpoint exists: `/api/v1/integrations/amazon/auth/callback`
3. Verify frontend URL is passed in OAuth state
4. Check backend logs for specific error

---

## 📋 Quick Checklist

Before testing, make sure:

- [ ] `AMAZON_REDIRECT_URI` is set correctly (no `@` symbol) in Render
- [ ] `AMAZON_CLIENT_ID` is set in Render
- [ ] `AMAZON_CLIENT_SECRET` is set in Render
- [ ] `AMAZON_SPAPI_REFRESH_TOKEN` is set (for "Use Existing Connection")
- [ ] Node.js API is running on Render
- [ ] Frontend environment variables are set in Vercel
- [ ] Frontend has been redeployed after setting env vars
- [ ] Browser cache cleared

---

## 🎯 Expected Behavior Summary

| Button | If Token Exists | If No Token | If Credentials Not Set |
|--------|----------------|-------------|------------------------|
| **Connect Amazon** | Starts OAuth flow | Starts OAuth flow | Returns mock URL ❌ |
| **Use Existing Connection** | Skips OAuth ✅ | Falls back to OAuth | Returns mock URL ❌ |

---

## 📚 References

- Backend Controller: `Integrations-backend/src/controllers/amazonController.ts`
- Backend Service: `Integrations-backend/src/services/amazonService.ts`
- Credentials Guide: `AMAZON_CREDENTIALS_VERIFICATION.md`
- Frontend Guide: `FRONTEND_AMAZON_CONNECTION_VERIFICATION.md`


