# ✅ Complete Fix Checklist - Amazon Connection Error

## 🐛 The Problem

Frontend error:
```
Cannot connect to backend at https://clario-complete-backend-y5cd.onrender.com/api/v1/integrations/amazon
```

**This means the frontend is still using the old backend URL.**

---

## ✅ Fix Checklist (Do All Steps)

### Step 1: Update Vercel Environment Variable ⚠️ CRITICAL

1. **Go to**: https://vercel.com/dashboard
2. **Your Project** → **Settings** → **Environment Variables**
3. **Check what framework you're using:**

   **If Vite:**
   - Add/Update: `VITE_API_BASE_URL`
   - Value: `https://opside-node-api.onrender.com`

   **If Next.js:**
   - Add/Update: `NEXT_PUBLIC_INTEGRATIONS_URL`
   - Value: `https://opside-node-api.onrender.com`
   - Also: `NEXT_PUBLIC_API_URL` = `https://opside-python-api.onrender.com`

   **If React (CRA):**
   - Add/Update: `REACT_APP_API_URL`
   - Value: `https://opside-node-api.onrender.com`

4. **Select environments**: ✅ Production, ✅ Preview, ✅ Development
5. **Save**

---

### Step 2: REDEPLOY Frontend ⚠️ CRITICAL

**You MUST redeploy after setting env vars!**

1. **Deployments** tab
2. **Latest deployment** → "..." → **"Redeploy"**
3. **Wait for completion** (2-5 minutes)

---

### Step 3: Clear Browser Cache

After redeploy:
- **Hard refresh**: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)
- **Or use Incognito mode** to test

---

### Step 4: Verify Backend CORS (I Just Updated This)

I updated the Node.js backend CORS to include your frontend URL. The backend will automatically pick up the change on the next deployment.

**To verify:**
- Check backend logs after next request
- Should allow your frontend origin

---

## 🧪 Test After Fix

1. **Open frontend** (hard refresh first)
2. **Open DevTools** (F12) → **Network** tab
3. **Click "Connect Amazon"**
4. **Check the request**:
   - ✅ URL should be: `opside-node-api.onrender.com`
   - ❌ NOT: `clario-complete-backend-y5cd.onrender.com`
5. **Should redirect to Amazon OAuth**

---

## 🔍 Verify Environment Variable

**In browser console (after redeploy):**

```javascript
// If Vite
console.log(import.meta.env.VITE_API_BASE_URL)

// If Next.js  
console.log(process.env.NEXT_PUBLIC_INTEGRATIONS_URL)

// Should show: https://opside-node-api.onrender.com
```

---

## ⚠️ Common Mistakes

1. ❌ **Set env var but didn't redeploy** → Must redeploy!
2. ❌ **Wrong variable name** → Check your framework (Vite vs Next.js)
3. ❌ **Only set for Production** → Set for all environments
4. ❌ **Browser cache** → Hard refresh or incognito

---

## ✅ Summary

**Do these 3 things:**
1. ✅ Set environment variable in Vercel (`VITE_API_BASE_URL` or `NEXT_PUBLIC_INTEGRATIONS_URL`)
2. ✅ **Redeploy frontend** (critical!)
3. ✅ Clear browser cache / hard refresh

**Then test again!** 🚀

---

**The backend endpoint works perfectly** - the issue is 100% the frontend environment variable not being set or the frontend not being redeployed.

