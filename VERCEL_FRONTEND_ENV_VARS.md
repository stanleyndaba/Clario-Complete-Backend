# 📋 Vercel Frontend Environment Variables - Complete Guide

## 🎯 Required Environment Variables

Based on your current setup, here are the environment variables you need to set in Vercel:

---

## ✅ For Next.js Frontend (Most Likely)

If your frontend uses Next.js, set these variables:

### Variable 1: Node.js Integrations API
```
Name: NEXT_PUBLIC_INTEGRATIONS_URL
Value: https://opside-node-api-woco.onrender.com
Environments: ✅ Production, ✅ Preview, ✅ Development
```

### Variable 2: Python API
```
Name: NEXT_PUBLIC_API_URL
Value: https://opside-python-api.onrender.com
Environments: ✅ Production, ✅ Preview, ✅ Development
```

---

## ✅ For Vite Frontend

If your frontend uses Vite, set these variables:

### Variable 1: Node.js Integrations API
```
Name: VITE_API_BASE_URL
Value: https://opside-node-api-woco.onrender.com
Environments: ✅ Production, ✅ Preview, ✅ Development
```

### Variable 2: Python API (if needed)
```
Name: VITE_PYTHON_API_URL
Value: https://opside-python-api.onrender.com
Environments: ✅ Production, ✅ Preview, ✅ Development
```

---

## ✅ For React (Create React App)

If your frontend uses Create React App, set these variables:

### Variable 1: Node.js Integrations API
```
Name: REACT_APP_API_URL
Value: https://opside-node-api-woco.onrender.com
Environments: ✅ Production, ✅ Preview, ✅ Development
```

### Variable 2: Python API (if needed)
```
Name: REACT_APP_PYTHON_API_URL
Value: https://opside-python-api.onrender.com
Environments: ✅ Production, ✅ Preview, ✅ Development
```

---

## 🔧 Step-by-Step: Set in Vercel

### Step 1: Go to Vercel Dashboard

1. Visit: https://vercel.com/dashboard
2. Find your project: `opside-complete-frontend` (or your frontend project name)
3. Click **Settings** → **Environment Variables**

---

### Step 2: Add/Update Variables

For each variable above:

1. Click **"Add New"** (or **"Edit"** if it already exists)
2. **Name**: Copy the exact variable name (e.g., `NEXT_PUBLIC_INTEGRATIONS_URL`)
3. **Value**: Copy the exact URL (e.g., `https://opside-node-api-woco.onrender.com`)
4. **Environments**: Select all three:
   - ✅ Production
   - ✅ Preview
   - ✅ Development
5. Click **"Save"**

---

### Step 3: Redeploy (CRITICAL!)

**⚠️ IMPORTANT: Environment variables are baked into the build. You MUST redeploy!**

1. Go to **Deployments** tab
2. Click **"..."** on the latest deployment
3. Click **"Redeploy"**
4. Wait for deployment to complete (2-5 minutes)

---

## 🔍 How to Determine Your Frontend Framework

Check your frontend repository:

- **If you have `next.config.js`** → Next.js → Use `NEXT_PUBLIC_*` variables
- **If you have `vite.config.ts` or `vite.config.js`** → Vite → Use `VITE_*` variables
- **If you have `package.json` with `react-scripts`** → Create React App → Use `REACT_APP_*` variables

---

## 📋 Quick Reference: Current Backend URLs

| Service | URL | Status |
|---------|-----|--------|
| **Node.js API** | `https://opside-node-api-woco.onrender.com` | ✅ Live |
| **Python API** | `https://opside-python-api.onrender.com` | ✅ Live |

---

## 🧪 Verify After Setting

### Test 1: Check Browser Console

1. Open your frontend
2. Open DevTools (F12) → Console
3. Type: `console.log(process.env.NEXT_PUBLIC_INTEGRATIONS_URL)` (or equivalent for your framework)
4. Should show: `https://opside-node-api-woco.onrender.com`

### Test 2: Check Network Requests

1. Open DevTools → Network tab
2. Click "Connect Amazon" button
3. Look for requests to: `opside-node-api-woco.onrender.com`
4. Should NOT see: `clario-complete-backend-y5cd.onrender.com` (old URL)

---

## ⚠️ Common Issues

### Issue 1: Variables Not Working

**Solution:**
- Make sure variable names start with `NEXT_PUBLIC_`, `VITE_`, or `REACT_APP_`
- Redeploy after adding variables
- Clear browser cache

### Issue 2: Still Calling Old Backend

**Solution:**
- Check if frontend code has hardcoded URLs
- Search codebase for old backend URL
- Make sure you're using environment variables in code

### Issue 3: Variables Not Showing in Browser

**Solution:**
- Variables must start with `NEXT_PUBLIC_` (Next.js) or `VITE_` (Vite) to be exposed to browser
- Make sure you redeployed after setting variables
- Clear browser cache and hard refresh

---

## 📝 Complete Example: Next.js Frontend

If using Next.js, your Vercel environment variables should look like this:

```
NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api-woco.onrender.com
NEXT_PUBLIC_API_URL=https://opside-python-api.onrender.com
```

Both set for:
- ✅ Production
- ✅ Preview
- ✅ Development

---

## ✅ Summary

1. **Set environment variables** in Vercel (match your framework)
2. **Select all environments** (Production, Preview, Development)
3. **Redeploy** the frontend
4. **Clear browser cache** and test
5. **Verify** network requests go to correct backend

---

## 🔗 Related Documentation

- `AMAZON_CREDENTIALS_VERIFICATION.md` - Amazon credentials setup
- `FRONTEND_AMAZON_CONNECTION_VERIFICATION.md` - Frontend connection guide
- `UPDATE_FRONTEND_ENV_VARS.md` - Additional frontend setup

