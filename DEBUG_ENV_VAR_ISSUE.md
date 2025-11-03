# 🔍 Debug: Env Vars Correct But Still Using Old URL

## ❌ The Problem

**Error shows:**
```
https://clario-complete-backend-y5cd.onrender.com/api/v1/integrations/amazon
```

But your env vars are correct. This means:

---

## 🔍 Possible Causes

### Cause 1: Frontend Code Has Hardcoded URL ❌

**Check your frontend code for:**
- Hardcoded `clario-complete-backend-y5cd.onrender.com`
- Default/fallback URL in API client
- Old URL in constants/config files

**Search for:**
```javascript
// Look for these in your frontend code
"clario-complete-backend-y5cd"
"https://clario-complete-backend"
```

---

### Cause 2: Wrong Environment Variable Name ❌

**Check what your frontend code actually uses:**

**Vite:**
```javascript
// Code uses: import.meta.env.VITE_API_BASE_URL
// But you set: VITE_API_BASE_URL ✅ (correct)
```

**Next.js:**
```javascript
// Code uses: process.env.NEXT_PUBLIC_INTEGRATIONS_URL
// But you set: NEXT_PUBLIC_INTEGRATIONS_URL ✅ (correct)
```

**React (CRA):**
```javascript
// Code uses: process.env.REACT_APP_API_URL
// But you set: REACT_APP_API_URL ✅ (correct)
```

**Check if your code uses a different variable name!**

---

### Cause 3: Frontend Not Redeployed ❌

**Even if env vars are set, they're baked into the build!**

**Check:**
1. Go to Vercel → Deployments
2. Look at latest deployment timestamp
3. Was it deployed AFTER you set the env vars?
4. If not → **Redeploy now!**

---

### Cause 4: Browser Cache ❌

**The browser might be serving cached JavaScript:**

1. **Hard refresh**: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)
2. **Or use Incognito mode** to test
3. **Or clear all browser cache**

---

### Cause 5: Wrong Environment Selected ❌

**In Vercel, check:**
- Did you set the env var for **Production**?
- Did you set it for **Preview**?
- Did you set it for **Development**?

**The frontend might be using Preview environment which doesn't have the variable!**

---

## 🔧 Quick Debug Steps

### Step 1: Check Browser Console

1. Open frontend
2. Open DevTools (F12) → Console
3. Type:
   ```javascript
   // If Vite
   console.log(import.meta.env)
   
   // If Next.js
   console.log(process.env)
   ```
4. **Check what it shows** - is the env var there?

---

### Step 2: Check Network Tab

1. Open DevTools (F12) → Network tab
2. Click "Connect Amazon"
3. **Look at the failed request:**
   - What's the exact URL?
   - What's the status code?
   - What's the error?

---

### Step 3: Check Frontend Code

**Search your frontend codebase for:**
```bash
grep -r "clario-complete-backend-y5cd" .
# or
grep -r "VITE_API_BASE_URL\|NEXT_PUBLIC_INTEGRATIONS_URL" .
```

**Check if there's a default/fallback:**
```javascript
const apiUrl = process.env.VITE_API_BASE_URL || 'https://clario-complete-backend-y5cd.onrender.com';
//                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                                        This is the problem!
```

---

## ✅ What I Fixed on Backend

I added a root handler for `/api/v1/integrations/amazon` that:
- Returns endpoint info
- Can redirect to `/auth/start` if needed

**But the main issue is still the frontend calling the wrong backend URL.**

---

## 🎯 Most Likely Fix

**90% chance it's one of these:**

1. **Frontend code has hardcoded URL** → Remove it
2. **Frontend not redeployed** → Redeploy after setting env vars
3. **Wrong env var name** → Check what code actually uses
4. **Browser cache** → Hard refresh or incognito

---

## 📝 Action Items

1. ✅ Check frontend code for hardcoded URLs
2. ✅ Verify env var name matches what code expects
3. ✅ Redeploy frontend (even if env vars are set)
4. ✅ Test in incognito mode
5. ✅ Check browser console for env var values

---

**Can you check the browser console and tell me:**
1. What does `console.log(import.meta.env.VITE_API_BASE_URL)` show?
2. What URL does the Network tab show when you click "Connect Amazon"?

This will help us pinpoint the exact issue! 🔍

