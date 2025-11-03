# ✅ Frontend Code Updated - Final Deployment Steps

## 🎉 Great Job!

You've already updated the frontend code to:
- ✅ Point to new Node.js backend: `https://opside-node-api.onrender.com`
- ✅ Use correct endpoint: `/api/v1/integrations/amazon/auth/start`
- ✅ Handle response normalization for `auth_url` and `authUrl`

---

## 🚀 Final Steps: Deploy the Frontend

### Step 1: Set Environment Variable in Vercel

1. **Go to Vercel Dashboard**
   - https://vercel.com/dashboard
   - Find your frontend project

2. **Add/Update Environment Variable**
   - Go to: **Settings** → **Environment Variables**
   - **Add/Update**:
     ```
     VITE_API_BASE_URL=https://opside-node-api.onrender.com
     ```
   - **Also keep** (if still used):
     ```
     NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api.onrender.com
     ```
   - **Select environments**: Production, Preview, Development
   - **Save**

---

### Step 2: Redeploy Frontend

**Option A: Automatic (Recommended)**
- Just push your code changes to GitHub
- Vercel will auto-deploy with new environment variables

**Option B: Manual Redeploy**
1. Go to: **Deployments** tab
2. Click **"..."** on latest deployment
3. Click **"Redeploy"**
4. Confirm

---

### Step 3: Verify Deployment

After redeploy, test:

1. **Open your frontend**: `https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app`

2. **Click "Connect Amazon" button**

3. **Expected behavior:**
   - ✅ Should redirect to Amazon OAuth (sandbox)
   - ✅ No CORS errors
   - ✅ No "Connection Failed" errors

4. **Check browser console** (F12):
   - Should see API calls to `opside-node-api.onrender.com`
   - No errors

---

## 🧪 Test the Endpoint Directly

Before testing in the app, verify the backend endpoint works:

```bash
curl https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/start

# Expected response:
# {"success":true,"authUrl":"https://sandbox.sellingpartnerapi-na.amazon.com/authorization?mock=true","message":"OAuth flow initiated"}
```

---

## 📋 Environment Variables Checklist

Make sure these are set in Vercel:

```bash
# Required (for Vite)
VITE_API_BASE_URL=https://opside-node-api.onrender.com

# Optional (if frontend still uses it)
NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api.onrender.com
```

---

## ✅ Post-Deployment Verification

After redeploying, verify:

1. **Frontend loads** ✅
2. **No console errors** ✅
3. **"Connect Amazon" button works** ✅
4. **Redirects to Amazon OAuth** ✅
5. **Network tab shows calls to new backend** ✅

---

## 🐛 If Still Having Issues

### Check Network Tab:
1. Open DevTools (F12) → Network tab
2. Click "Connect Amazon"
3. Look at the failed request:
   - What URL is it calling?
   - What's the status code?
   - What's the error message?

### Check Environment Variables:
1. In browser console, type:
   ```javascript
   console.log(import.meta.env.VITE_API_BASE_URL)
   // Should show: https://opside-node-api.onrender.com
   ```

### Check CORS:
- Make sure backend has frontend URL in `CORS_ALLOW_ORIGINS`
- Frontend: `https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app`

---

## 🎯 Summary

**What you need to do:**
1. ✅ Set `VITE_API_BASE_URL=https://opside-node-api.onrender.com` in Vercel
2. ✅ Redeploy frontend
3. ✅ Test "Connect Amazon" button
4. ✅ Verify it redirects to Amazon OAuth

**Everything else is already done!** 🎉

---

*Your frontend code is updated correctly. Just need to set the env var and redeploy!*

