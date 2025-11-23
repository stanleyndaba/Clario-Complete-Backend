# 🚨 URGENT: Fix Frontend Still Calling Old Backend

## ❌ Current Problem

Error shows frontend is calling:
```
https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon
```

This means the frontend **environment variable is NOT set or NOT being used**.

---

## 🔧 Step-by-Step Fix (DO THIS NOW)

### Step 1: Check Vercel Environment Variables ⚠️

1. **Go to Vercel**: https://vercel.com/dashboard
2. **Find your project**: `opside-complete-frontend`
3. **Click**: Settings → Environment Variables
4. **Check if these exist:**

   **If using Vite:**
   ```
   VITE_API_BASE_URL=https://opside-node-api.onrender.com
   ```

   **If using Next.js:**
   ```
   NEXT_PUBLIC_API_URL=https://opside-python-api.onrender.com
   NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api.onrender.com
   ```

   **If using React (Create React App):**
   ```
   REACT_APP_API_URL=https://opside-node-api.onrender.com
   ```

---

### Step 2: ADD/UPDATE the Variable

**If it doesn't exist:**
1. Click **"Add New"**
2. **Name**: `VITE_API_BASE_URL` (or `NEXT_PUBLIC_INTEGRATIONS_URL` if Next.js)
3. **Value**: `https://opside-node-api.onrender.com`
4. **Select**: Production, Preview, Development
5. **Save**

**If it exists but has wrong value:**
1. Click **"..."** → **"Edit"**
2. **Change value** to: `https://opside-node-api.onrender.com`
3. **Save**

---

### Step 3: FORCE REDEPLOY (CRITICAL)

**Environment variables are baked into the build. You MUST redeploy!**

1. **Go to Deployments tab**
2. **Click "..." on latest deployment**
3. **Click "Redeploy"**
4. **Wait for deployment to complete** (2-5 minutes)

---

### Step 4: Clear Browser Cache

**After redeploy:**
1. **Hard refresh**: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)
2. **Or use Incognito mode** to test
3. **Or clear browser cache** completely

---

## 🔍 How to Verify It's Fixed

### Check 1: Browser Console
1. Open frontend
2. Open DevTools (F12) → Console
3. Type:
   ```javascript
   // If Vite
   console.log(import.meta.env.VITE_API_BASE_URL)
   
   // If Next.js
   console.log(process.env.NEXT_PUBLIC_INTEGRATIONS_URL)
   ```
4. Should show: `https://opside-node-api.onrender.com`

### Check 2: Network Tab
1. Open DevTools (F12) → Network tab
2. Click "Connect Amazon"
3. Look at the request URL
4. Should be: `opside-node-api.onrender.com` (NOT `clario-complete-backend-y5cd.onrender.com`)

---

## ⚠️ Common Mistakes

### Mistake 1: Set Variable But Didn't Redeploy ❌
**Fix**: You MUST redeploy after setting env vars!

### Mistake 2: Wrong Variable Name ❌
**Check**: 
- Vite uses `VITE_*`
- Next.js uses `NEXT_PUBLIC_*`
- React CRA uses `REACT_APP_*`

### Mistake 3: Only Set for One Environment ❌
**Fix**: Set for Production, Preview, AND Development

### Mistake 4: Browser Cache ❌
**Fix**: Hard refresh or use incognito mode

---

## ✅ Quick Checklist

- [ ] Went to Vercel → Settings → Environment Variables
- [ ] Added/Updated `VITE_API_BASE_URL` (or `NEXT_PUBLIC_INTEGRATIONS_URL`)
- [ ] Set value to `https://opside-node-api.onrender.com`
- [ ] Selected all environments (Production, Preview, Development)
- [ ] Saved the variable
- [ ] **REDEPLOYED frontend** (Deployments → Redeploy)
- [ ] Waited for deployment to complete
- [ ] Cleared browser cache / hard refresh
- [ ] Tested "Connect Amazon" again

---

## 🎯 Most Likely Fix

**90% of the time it's this:**

1. Environment variable not set → **Set it in Vercel**
2. Frontend not redeployed → **Redeploy after setting variable**
3. Browser cache → **Hard refresh**

---

## 🚀 After Fixing

Once you've:
1. Set the env var
2. Redeployed
3. Cleared cache

**Test again:**
- Click "Connect Amazon"
- Should redirect to Amazon OAuth
- No more "Connection Failed" error

---

**Do these 3 steps and it should work!** ✅

