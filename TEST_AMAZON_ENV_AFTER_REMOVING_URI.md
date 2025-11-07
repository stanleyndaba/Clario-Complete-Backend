# 🧪 Testing Amazon Environment After Removing Redirect URI

## ✅ What We Know

1. **You removed `AMAZON_REDIRECT_URI`** from Render
2. **No `@` symbol issue** - It wasn't there
3. **Local server shows mock URLs** - Because credentials are only in Render (production)

---

## 🎯 Testing Strategy

### Test 1: Check Production Backend (Render)

Since your local server doesn't have the credentials, test the **production backend** on Render:

```bash
# Test production OAuth endpoint
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?frontend_url=https://your-frontend-url.vercel.app"

# Test production bypass endpoint
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=https://your-frontend-url.vercel.app"

# Test production diagnostics
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/diagnose"
```

---

## 🔍 What to Check

### Expected Behavior (After Removing Redirect URI):

1. **Backend should use fallback:**
   - Uses: `${INTEGRATIONS_URL}/api/v1/integrations/amazon/auth/callback`
   - Or: `http://localhost:3001/api/v1/integrations/amazon/auth/callback` (if INTEGRATIONS_URL not set)

2. **OAuth URL should still work:**
   - Should generate real OAuth URL (not mock)
   - Redirect URI in URL should be the fallback value

3. **Bypass should work:**
   - If `AMAZON_SPAPI_REFRESH_TOKEN` exists → Should return `bypassed: true`
   - If no token → Should fall back to OAuth flow

---

## 📋 Checklist

### In Render Dashboard:

- [ ] `AMAZON_CLIENT_ID` is set
- [ ] `AMAZON_CLIENT_SECRET` is set
- [ ] `AMAZON_SPAPI_CLIENT_ID` is set
- [ ] `AMAZON_SPAPI_REFRESH_TOKEN` is set
- [ ] `AMAZON_SPAPI_BASE_URL` is set
- [ ] `AMAZON_MARKETPLACE_ID` is set
- [ ] `AMAZON_REDIRECT_URI` is **removed** (or not set)
- [ ] `INTEGRATIONS_URL` is set (for fallback)

---

## 🧪 Test Results to Share

When you test, please share:

1. **OAuth Start Endpoint Response:**
   ```bash
   curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?frontend_url=..."
   ```

2. **Bypass Endpoint Response:**
   ```bash
   curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=..."
   ```

3. **Diagnostics Response:**
   ```bash
   curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/diagnose"
   ```

4. **Backend Logs from Render:**
   - Check what redirect URI is being used
   - Check if there are any errors

---

## 🔍 What We're Looking For

### Good Signs:
- ✅ OAuth URL contains real Amazon URL (not mock)
- ✅ Redirect URI in OAuth URL is the fallback value
- ✅ Bypass returns `bypassed: true` if refresh token exists
- ✅ No errors in backend logs

### Issues to Watch For:
- ❌ Still returning mock URLs (credentials not loaded)
- ❌ Errors about missing redirect URI
- ❌ OAuth URL generation failing

---

## 📝 Summary

**Current Status:**
- ✅ Redirect URI removed from Render
- ✅ Backend should use fallback automatically
- ⏳ Need to test production backend to confirm

**Next Steps:**
1. Test production endpoints (not local)
2. Share the responses
3. Check Render backend logs
4. Verify redirect URI fallback is working

---

## 💡 Note About Local vs Production

**Important:** Your local server will always show mock URLs because:
- Local environment doesn't have Amazon credentials
- Credentials are only in Render (production)
- This is expected behavior!

**To test properly, use the production URLs on Render, not localhost.**

