# 🚨 URGENT: Frontend Still Calling Old Backend URL

## ❌ The Problem

Your frontend is **still calling the OLD backend URL**:
```
https://clario-complete-backend-y5cd.onrender.com/api/v1/integrations/amazon
```

**This backend is DEPRECATED** and may be down or not responding.

---

## ✅ The Solution

Your frontend **MUST** call the new backend:
```
https://opside-node-api.onrender.com/api/v1/integrations/amazon
```

---

## 🔍 Why This Is Happening

Even though you said "all FE ENV VARS are correct", the frontend is still calling the old URL. This means:

1. **Frontend code has hardcoded URL** - Most likely!
2. **Frontend not redeployed** - Env vars only work after redeploy
3. **Browser cache** - Old code cached in browser
4. **Wrong env var name** - Frontend code reads different var name

---

## 🔧 Step-by-Step Fix

### Step 1: Check Your Frontend Code

**Search your frontend codebase for:**
```bash
grep -r "clario-complete-backend-y5cd" .
grep -r "connectamazon" .
```

**Look for hardcoded URLs like:**
```javascript
// ❌ WRONG - Remove this!
const API_URL = 'https://clario-complete-backend-y5cd.onrender.com';
const apiUrl = 'https://clario-complete-backend-y5cd.onrender.com';
```

**Should be:**
```javascript
// ✅ CORRECT
const API_URL = process.env.NEXT_PUBLIC_INTEGRATIONS_URL || process.env.VITE_API_BASE_URL;
const apiUrl = import.meta.env.VITE_API_BASE_URL || 'https://opside-node-api.onrender.com';
```

---

### Step 2: Update Vercel Environment Variables

**Go to Vercel Dashboard:**
1. https://vercel.com/dashboard
2. Find your project: `opside-complete-frontend`
3. **Settings** → **Environment Variables**

**Set these variables (check ALL environments):**
```
VITE_API_BASE_URL=https://opside-node-api.onrender.com
NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api.onrender.com
```

**Make sure to:**
- ✅ Select **Production**
- ✅ Select **Preview**  
- ✅ Select **Development**
- ✅ Click **Save**

---

### Step 3: Redeploy Frontend (CRITICAL!)

**After setting env vars, you MUST redeploy:**

**Option A: Push to GitHub (Auto-deploy)**
```bash
git add .
git commit -m "Update API URL to new backend"
git push
```

**Option B: Manual Redeploy in Vercel**
1. Go to **Deployments** tab
2. Click **"..."** on latest deployment
3. Click **"Redeploy"**
4. Wait for deployment to complete

---

### Step 4: Clear Browser Cache

**After redeploy:**
1. **Hard refresh**: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
2. **Or use Incognito/Private mode**
3. **Or clear browser cache** completely

---

## 🧪 Test After Fix

### Test 1: Check Browser Console

1. Open your frontend
2. Press **F12** (DevTools)
3. Go to **Console** tab
4. Type:
```javascript
console.log(import.meta.env.VITE_API_BASE_URL)
// or
console.log(process.env.NEXT_PUBLIC_INTEGRATIONS_URL)
```

**Should show:**
```
https://opside-node-api.onrender.com
```

**If it shows the old URL or `undefined`, the env var isn't set correctly!**

---

### Test 2: Check Network Tab

1. Open **Network** tab in DevTools
2. Click **"Connect Amazon"** button
3. Look at the failed request:
   - **URL should be**: `https://opside-node-api.onrender.com/api/v1/integrations/amazon`
   - **NOT**: `https://clario-complete-backend-y5cd.onrender.com/...`

---

## ✅ Backend Is Ready!

I've updated the backend to:
- ✅ Handle `/api/v1/integrations/amazon` (starts OAuth)
- ✅ Handle `/api/v1/integrations/amazon/auth/start` (starts OAuth)
- ✅ Handle `/api/v1/integrations/connectamazon` (redirects to auth/start)
- ✅ CORS configured for your frontend URL

**The backend is working!** The issue is **100% on the frontend side.**

---

## 📋 Checklist

- [ ] Search frontend code for hardcoded URLs
- [ ] Remove any hardcoded `clario-complete-backend-y5cd` URLs
- [ ] Update Vercel env vars (`VITE_API_BASE_URL` and `NEXT_PUBLIC_INTEGRATIONS_URL`)
- [ ] Redeploy frontend (push to GitHub or manual redeploy)
- [ ] Clear browser cache
- [ ] Test in browser console (check env vars)
- [ ] Test Network tab (check actual API calls)
- [ ] Click "Connect Amazon" and verify it works

---

## 🆘 Still Not Working?

If it's still not working after all this:

1. **Share the frontend code** that calls the Amazon endpoint
2. **Share a screenshot** of the Network tab showing the failed request
3. **Share the exact error message** from browser console

Then I can help debug further!

