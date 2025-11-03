# 🐛 Debug: Frontend Still Calling Old Backend URL

## ❌ Problem

Frontend is still calling:
```
https://clario-complete-backend-y5cd.onrender.com/api/v1/integrations/amazon
```

But should call:
```
https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/start
```

---

## 🔍 Debug Steps

### Step 1: Check Environment Variable in Vercel

1. **Go to Vercel Dashboard**
   - https://vercel.com/dashboard
   - Find your project

2. **Check Environment Variables**
   - Settings → Environment Variables
   - **Look for**:
     - `VITE_API_BASE_URL`
     - `NEXT_PUBLIC_API_URL`
     - `NEXT_PUBLIC_INTEGRATIONS_URL`
     - `REACT_APP_API_URL` (if using React)
   
3. **Verify values:**
   - Should be: `https://opside-node-api.onrender.com`
   - NOT: `https://clario-complete-backend-y5cd.onrender.com`

---

### Step 2: Check if Frontend Was Redeployed

**In Vercel:**
1. Go to **Deployments** tab
2. Check **latest deployment**:
   - When was it deployed?
   - Does it include your code changes?
   - If not, redeploy!

---

### Step 3: Check Browser Cache

1. **Hard refresh** the frontend:
   - Press `Ctrl + Shift + R` (Windows)
   - Or `Cmd + Shift + R` (Mac)
   - This clears cached JavaScript

2. **Clear browser cache:**
   - F12 → Application tab → Clear storage
   - Or use Incognito/Private mode

---

### Step 4: Check Frontend Code

**In your frontend code, search for:**
- `clario-complete-backend-y5cd.onrender.com`
- Any hardcoded URLs
- Environment variable usage

**Make sure you're using:**
```javascript
// Vite (if using Vite)
const apiUrl = import.meta.env.VITE_API_BASE_URL || 'https://opside-node-api.onrender.com';

// Next.js (if using Next.js)
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://opside-node-api.onrender.com';
```

---

## 🎯 Most Likely Issues

### Issue 1: Environment Variable Not Set ❌
**Fix:** Set it in Vercel and redeploy

### Issue 2: Wrong Environment Variable Name ❌
**Check:** 
- If Vite → `VITE_API_BASE_URL`
- If Next.js → `NEXT_PUBLIC_API_URL` or `NEXT_PUBLIC_INTEGRATIONS_URL`
- If React (Create React App) → `REACT_APP_API_URL`

### Issue 3: Frontend Not Redeployed ❌
**Fix:** Redeploy after setting env vars

### Issue 4: Hardcoded URL in Code ❌
**Fix:** Search codebase for old URL and replace

---

## ✅ Quick Fix Checklist

- [ ] Checked Vercel environment variables
- [ ] Set correct env var (`VITE_API_BASE_URL` or `NEXT_PUBLIC_API_URL`)
- [ ] Verified value is `https://opside-node-api.onrender.com`
- [ ] Redeployed frontend after setting env var
- [ ] Cleared browser cache
- [ ] Checked frontend code for hardcoded URLs
- [ ] Tested in incognito mode

---

## 🔧 Immediate Fix

1. **Set environment variable in Vercel:**
   ```
   VITE_API_BASE_URL=https://opside-node-api.onrender.com
   ```
   (or `NEXT_PUBLIC_API_URL` if Next.js)

2. **Redeploy:**
   - Deployments → Latest → "..." → Redeploy

3. **Clear browser cache:**
   - Hard refresh (Ctrl+Shift+R)

4. **Test again**

---

Let me know what you find! 🔍

