# 🔄 Dynamic Frontend URL Solution

## Problem

The frontend URL keeps changing domains (especially with Vercel preview deployments), and the hardcoded `FRONTEND_URL` environment variable doesn't match the current frontend domain. This causes OAuth redirects to fail.

## Solution

The backend now **dynamically detects the frontend URL** from the request and stores it with the OAuth state, ensuring redirects always go to the correct frontend domain.

---

## ✅ How It Works

### 1. **Frontend URL Detection Priority**

When initiating OAuth (Gmail or Amazon), the backend detects the frontend URL in this order:

1. **Query Parameter**: `?frontend_url=https://your-frontend.com`
2. **Custom Header**: `X-Frontend-URL: https://your-frontend.com`
3. **Referer Header**: Extracts origin from `Referer` header
4. **Origin Header**: Uses `Origin` header from request
5. **Environment Variable**: Falls back to `FRONTEND_URL` env var
6. **Default**: `http://localhost:3000` (for local development)

### 2. **OAuth State Storage**

The detected frontend URL is stored with the OAuth state:
- When user initiates OAuth → Frontend URL is detected and stored
- When OAuth callback returns → Frontend URL is retrieved from state
- Redirect happens to the **correct frontend domain** automatically

### 3. **CORS Configuration**

CORS now automatically allows:
- ✅ All `*.vercel.app` domains (preview deployments)
- ✅ All `*.onrender.com` domains
- ✅ All `*.vercel.com` domains

This means **no CORS errors** even when the frontend domain changes.

---

## 📝 Code Changes

### Files Modified

1. **`src/controllers/gmailController.ts`**
   - Detects frontend URL from request (query, header, referer)
   - Stores frontend URL with OAuth state
   - Uses stored frontend URL for redirects

2. **`src/controllers/amazonController.ts`**
   - Same dynamic frontend URL detection
   - Stores frontend URL with OAuth state
   - Uses stored frontend URL for redirects

3. **`src/utils/oauthStateStore.ts`**
   - Added `getFrontendUrl()` method
   - Stores frontend URL with state data

4. **`src/index.ts`**
   - Updated CORS to allow all `vercel.app`, `onrender.com`, and `vercel.com` domains
   - Pattern matching instead of hardcoded list

---

## 🚀 Usage

### Option 1: Automatic Detection (Recommended)

**Frontend doesn't need to do anything!** The backend automatically detects the frontend URL from:
- The `Origin` header (sent automatically by browser)
- The `Referer` header (sent automatically by browser)

**Example:**
```javascript
// Frontend code - no changes needed!
const response = await fetch('https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/auth', {
  credentials: 'include'
});
```

### Option 2: Explicit Frontend URL (Optional)

If you want to be explicit, you can pass the frontend URL:

**Query Parameter:**
```javascript
const frontendUrl = window.location.origin;
const response = await fetch(
  `https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/auth?frontend_url=${encodeURIComponent(frontendUrl)}`,
  { credentials: 'include' }
);
```

**Custom Header:**
```javascript
const frontendUrl = window.location.origin;
const response = await fetch('https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/auth', {
  headers: {
    'X-Frontend-URL': frontendUrl
  },
  credentials: 'include'
});
```

---

## ✅ Benefits

1. **No More Hardcoded URLs**: Frontend URL is detected dynamically
2. **Works with Preview Deployments**: Automatically handles Vercel preview URLs
3. **No CORS Errors**: Pattern matching allows all Vercel/onrender domains
4. **Backward Compatible**: Still works with `FRONTEND_URL` env var as fallback
5. **Automatic**: Frontend doesn't need to change anything

---

## 🔧 Environment Variables

You can still set `FRONTEND_URL` in Render.com as a **fallback**, but it's no longer required:

```
FRONTEND_URL=https://your-production-frontend.com
```

This will be used if:
- No frontend URL is detected from the request
- OAuth state is expired or missing
- Error occurs during OAuth flow

---

## 🧪 Testing

### Test 1: Automatic Detection

1. Open your frontend (any Vercel preview URL)
2. Click "Connect Gmail" or "Connect Amazon"
3. Complete OAuth flow
4. ✅ Should redirect back to the **same frontend domain** you started from

### Test 2: Different Domains

1. Open frontend on `https://preview-123.vercel.app`
2. Start OAuth flow
3. ✅ Should redirect back to `https://preview-123.vercel.app` (not production URL)

### Test 3: CORS

1. Open frontend on any Vercel domain
2. Make API calls
3. ✅ No CORS errors (all `*.vercel.app` domains allowed)

---

## 📋 Summary

✅ **Problem Solved**: Frontend URL changes are handled automatically  
✅ **No Frontend Changes**: Works automatically with existing code  
✅ **CORS Fixed**: All Vercel/onrender domains allowed  
✅ **Backward Compatible**: Still works with `FRONTEND_URL` env var  

**The backend now adapts to any frontend domain automatically!** 🎉

