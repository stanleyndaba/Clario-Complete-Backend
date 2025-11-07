# 🔧 Update Frontend Environment Variables

## 📋 Current Service URLs

| Service | URL | Status |
|---------|-----|--------|
| **Python API** | `https://python-api-newest.onrender.com` | ✅ Live |
| **Node.js API** | `https://opside-node-api-woco.onrender.com` | ✅ Live |
| **Frontend** | `https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app` | ✅ Live |

---

## 🎯 Step-by-Step: Update Vercel Environment Variables

### Step 1: Go to Vercel Dashboard

1. Visit: https://vercel.com/dashboard
2. Find your project: `opside-complete-frontend` (or your frontend project name)
3. Click **Settings** → **Environment Variables**

---

### Step 2: Add/Update These Variables

**For Vite-based frontend (most likely):**

| Variable Name | Value | Environments |
|---------------|-------|--------------|
| `VITE_API_BASE_URL` | `https://opside-node-api-woco.onrender.com` | ✅ Production, ✅ Preview, ✅ Development |
| `VITE_PYTHON_API_URL` | `https://python-api-newest.onrender.com` | ✅ Production, ✅ Preview, ✅ Development |

**For Next.js frontend:**

| Variable Name | Value | Environments |
|---------------|-------|--------------|
| `NEXT_PUBLIC_INTEGRATIONS_URL` | `https://opside-node-api-woco.onrender.com` | ✅ Production, ✅ Preview, ✅ Development |
| `NEXT_PUBLIC_API_URL` | `https://python-api-newest.onrender.com` | ✅ Production, ✅ Preview, ✅ Development |

**For React (Create React App):**

| Variable Name | Value | Environments |
|---------------|-------|--------------|
| `REACT_APP_API_URL` | `https://opside-node-api-woco.onrender.com` | ✅ Production, ✅ Preview, ✅ Development |
| `REACT_APP_PYTHON_API_URL` | `https://python-api-newest.onrender.com` | ✅ Production, ✅ Preview, ✅ Development |

---

### Step 3: Add Each Variable

For each variable above:

1. Click **"Add New"** (or **"Edit"** if it already exists)
2. **Name**: Copy the exact variable name from the table
3. **Value**: Copy the exact URL from the table
4. **Select environments**: Check all three (Production, Preview, Development)
5. Click **"Save"**

---

### Step 4: Verify Variables Are Set

After adding all variables, verify:

- ✅ All variables are listed
- ✅ Values match the URLs above
- ✅ All three environments are selected for each variable

---

### Step 5: REDEPLOY Frontend (CRITICAL!)

**Environment variables are baked into the build. You MUST redeploy!**

1. Go to **Deployments** tab in Vercel
2. Click **"..."** on the latest deployment
3. Click **"Redeploy"**
4. Wait for deployment to complete (2-5 minutes)

---

### Step 6: Clear Browser Cache

After redeploy:

1. **Hard refresh**: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)
2. **Or use Incognito/Private mode** to test
3. **Or clear browser cache** completely

---

## 🧪 Test After Update

1. **Open frontend** (hard refresh first)
2. **Open DevTools** (F12) → **Console** tab
3. **Check for API calls**:
   - Should see requests to: `opside-node-api-woco.onrender.com`
   - Should NOT see: `clario-complete-backend-y5cd.onrender.com` (old URL)
4. **Test a feature** (e.g., connect Amazon, view recoveries)
5. **Check Network tab** to verify correct API endpoints

---

## 🔍 How to Verify It's Working

### Check 1: Browser Console
Open DevTools (F12) → Console, look for:
```
✅ [API] Requesting: https://opside-node-api-woco.onrender.com/api/...
❌ [API] Requesting: https://clario-complete-backend-y5cd.onrender.com/... (old URL)
```

### Check 2: Network Tab
Open DevTools (F12) → Network tab:
- Filter by: `opside-node-api-woco.onrender.com`
- Should see successful requests (200 status)

### Check 3: API Health Check
Test the backend directly:
```bash
curl https://opside-node-api-woco.onrender.com/health
```
Expected response:
```json
{"status":"ok","timestamp":"..."}
```

---

## ⚠️ Common Issues

### Issue 1: Still Seeing Old URL
**Fix:** 
- Make sure you redeployed after setting env vars
- Clear browser cache
- Check that env var name matches what frontend code uses

### Issue 2: CORS Errors
**Fix:**
- The Node.js API already has CORS configured for your frontend
- If you still see CORS errors, check backend logs

### Issue 3: 404 Errors
**Fix:**
- Verify the API URL is correct
- Check that the service is actually running (use health check)
- Verify the endpoint path matches what the API expects

---

## 📝 Summary

1. ✅ Go to Vercel → Settings → Environment Variables
2. ✅ Add/Update: `VITE_API_BASE_URL` = `https://opside-node-api-woco.onrender.com`
3. ✅ Add/Update: `VITE_PYTHON_API_URL` = `https://python-api-newest.onrender.com`
4. ✅ Select all environments (Production, Preview, Development)
5. ✅ Save
6. ✅ Redeploy frontend
7. ✅ Clear browser cache
8. ✅ Test!

---

**Once done, your frontend will connect to the new consolidated backends!** 🎉

