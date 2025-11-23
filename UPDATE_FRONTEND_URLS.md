# 🔧 How to Update Frontend URLs in Vercel

## 📍 Your Frontend Details

**Frontend URL**: `https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app`  
**Platform**: Vercel  
**Backend URLs** (to update):
- **Python API**: `https://opside-python-api.onrender.com`
- **Node.js API**: `https://opside-node-api.onrender.com`

---

## 🎯 Step-by-Step Guide

### Step 1: Go to Vercel Dashboard

1. **Open Vercel Dashboard**
   - Go to: https://vercel.com/dashboard
   - Log in if needed

2. **Find Your Project**
   - Look for: `opside-complete-frontend` or similar
   - Click on the project

---

### Step 2: Open Environment Variables

1. **Click "Settings"** (in the top navigation)
2. **Click "Environment Variables"** (in the left sidebar)
3. You'll see all your current environment variables

---

### Step 3: Update or Add Environment Variables

You need to update/add these variables:

#### **Update These Variables:**

1. **`NEXT_PUBLIC_API_URL`**
   - **Current**: Probably `https://opside-node-api-woco.onrender.com` (old)
   - **New**: `https://opside-python-api.onrender.com`
   - **Action**: 
     - If it exists: Click the **"..."** menu → **"Edit"** → Update value → **"Save"**
     - If it doesn't exist: Click **"Add New"** → Add variable

2. **`NEXT_PUBLIC_INTEGRATIONS_URL`**
   - **Current**: Probably old integrations URL or missing
   - **New**: `https://opside-node-api.onrender.com`
   - **Action**: 
     - If it exists: Click **"..."** → **"Edit"** → Update value → **"Save"**
     - If it doesn't exist: Click **"Add New"** → Add variable

---

### Step 4: Add Variables (Copy-Paste Ready)

Click **"Add New"** and add these one by one:

```bash
# Main Python API
NEXT_PUBLIC_API_URL=https://opside-python-api.onrender.com

# Node.js Integrations API
NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api.onrender.com
```

**Important Notes:**
- ✅ Variable names must match exactly (case-sensitive)
- ✅ Make sure to select **"Production"**, **"Preview"**, and **"Development"** environments (or just Production if you only use that)
- ✅ Click **"Save"** after each variable

---

### Step 5: Redeploy Frontend

After updating environment variables:

1. **Go to "Deployments" tab** (top navigation)
2. **Find the latest deployment**
3. **Click the "..." menu** (three dots) on the latest deployment
4. **Click "Redeploy"**
5. **Confirm** by clicking "Redeploy" again

**OR** (Easier method):
- Just push a new commit to your GitHub repo
- Vercel will auto-deploy with new environment variables

---

## 📸 Visual Guide

### Finding Environment Variables:
```
Vercel Dashboard
  └── Your Project
      └── Settings
          └── Environment Variables ← Click here
```

### Adding/Editing:
```
Environment Variables Page
  └── [List of existing variables]
  └── "Add New" button ← Click to add new
  └── "..." menu on each variable ← Click to edit
```

---

## 🔍 Verify It Worked

### Method 1: Check in Browser Console
1. Open your frontend: `https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app`
2. Open browser DevTools (F12)
3. Go to Console tab
4. Type: `console.log(process.env.NEXT_PUBLIC_API_URL)`
5. Should show: `https://opside-python-api.onrender.com`

### Method 2: Test API Calls
1. Open your frontend
2. Try to use any feature that calls the backend
3. Check browser Network tab (F12 → Network)
4. API calls should go to the new URLs

### Method 3: Check Deployment Logs
1. Go to Vercel → Deployments
2. Click on latest deployment
3. Check "Build Logs"
4. Look for any errors related to API URLs

---

## ⚠️ Common Issues

### Issue: Variable not updating
**Solution:**
- Make sure you selected the right environment (Production/Preview/Development)
- Redeploy after adding/editing variables
- Clear browser cache

### Issue: Frontend still using old URLs
**Solution:**
- Environment variables are baked into the build
- **Must redeploy** after changing variables
- Just saving variables isn't enough - need to redeploy

### Issue: CORS errors
**Solution:**
- Make sure backend CORS is configured for your frontend URL
- Check `FRONTEND_URL` and `CORS_ALLOW_ORIGINS` in backend env vars

---

## ✅ Quick Checklist

- [ ] Logged into Vercel dashboard
- [ ] Found your frontend project
- [ ] Went to Settings → Environment Variables
- [ ] Updated `NEXT_PUBLIC_API_URL` to `https://opside-python-api.onrender.com`
- [ ] Updated/Added `NEXT_PUBLIC_INTEGRATIONS_URL` to `https://opside-node-api.onrender.com`
- [ ] Selected correct environments (Production/Preview/Development)
- [ ] Saved all changes
- [ ] Redeployed frontend
- [ ] Tested frontend → backend connection
- [ ] Verified API calls work

---

## 🚀 Alternative: Update via Vercel CLI

If you prefer command line:

```bash
# Install Vercel CLI (if not installed)
npm i -g vercel

# Login
vercel login

# Set environment variables
vercel env add NEXT_PUBLIC_API_URL production
# Enter: https://opside-python-api.onrender.com

vercel env add NEXT_PUBLIC_INTEGRATIONS_URL production
# Enter: https://opside-node-api.onrender.com

# Redeploy
vercel --prod
```

---

## 📝 Summary

**What to update:**
1. `NEXT_PUBLIC_API_URL` → `https://opside-python-api.onrender.com`
2. `NEXT_PUBLIC_INTEGRATIONS_URL` → `https://opside-node-api.onrender.com`

**Where:**
- Vercel Dashboard → Your Project → Settings → Environment Variables

**After updating:**
- **Redeploy** your frontend (important!)

**That's it!** Your frontend will now connect to your new consolidated backend services. 🎉

---

*Need help? Check Vercel docs: https://vercel.com/docs/environment-variables*

