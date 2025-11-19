# 🔧 Python API Supabase Configuration Fix

## ❌ Current Issue

From the Python API logs:
```
PostgreSQL initialization failed: connection to server at "aws-0-us-east-1.pooler.supabase.com" (44.216.29.125), port 6543 failed: FATAL:  Tenant or user not found
Database initialization failed: connection to server at "aws-0-us-east-1.pooler.supabase.com" (44.216.29.125), port 6543 failed: FATAL:  Tenant or user not found
```

**Root Cause:** Python API can't connect to Supabase database - credentials are incorrect or missing.

---

## ✅ Required Environment Variables for Python API

Add these to your **Python API service** on Render (`python-api-4-aukq`):

### **1. SUPABASE_URL** (Required)
```
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
```
- **NOT** a PostgreSQL connection string
- Must be the HTTPS URL format
- Example: `https://fmzfjhrwbkebqaxjlvzt.supabase.co`
- Get from: Supabase Dashboard → Settings → API → Project URL

### **2. SUPABASE_ANON_KEY** (Required)
```
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
- This is the **anon/public** key
- Get from: Supabase Dashboard → Settings → API → anon public key
- Used for client-side operations

### **3. SUPABASE_SERVICE_ROLE_KEY** (Required for backend operations)
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
- This is the **service_role** key
- Get from: Supabase Dashboard → Settings → API → service_role key
- ⚠️ **Keep this secret!** Never expose in frontend
- Bypasses RLS (Row Level Security) for backend operations

### **4. DATABASE_URL** (Optional - if Python API uses direct PostgreSQL)
```
DATABASE_URL=postgresql://postgres:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
```
- Only needed if Python API connects directly to PostgreSQL
- Format: `postgresql://user:password@host:port/database?sslmode=require`
- Get from: Supabase Dashboard → Settings → Database → Connection string

---

## 📋 Steps to Fix on Render

### Step 1: Go to Python API Service
1. Go to https://dashboard.render.com
2. Find your service: `python-api-4-aukq` (or similar)
3. Click on it to open the service dashboard

### Step 2: Add Environment Variables
1. Click on **"Environment"** tab
2. Click **"Add Environment Variable"** for each variable:

   **Variable 1:**
   - **Key:** `SUPABASE_URL`
   - **Value:** `https://YOUR_PROJECT_ID.supabase.co` (replace with your actual project URL)

   **Variable 2:**
   - **Key:** `SUPABASE_ANON_KEY`
   - **Value:** `eyJ...` (your anon key from Supabase)

   **Variable 3:**
   - **Key:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** `eyJ...` (your service_role key from Supabase)

   **Variable 4 (if needed):**
   - **Key:** `DATABASE_URL`
   - **Value:** `postgresql://...` (your PostgreSQL connection string)

3. Click **"Save Changes"** after adding each variable

### Step 3: Verify Supabase Credentials

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Settings** → **API**
4. You'll see:
   - **Project URL** → Copy this as `SUPABASE_URL`
     - Format: `https://xxxxx.supabase.co`
   - **anon public** key → Copy this as `SUPABASE_ANON_KEY`
   - **service_role** key → Copy this as `SUPABASE_SERVICE_ROLE_KEY`
     - ⚠️ Click "Reveal" to see it

5. Go to **Settings** → **Database** → **Connection string**
   - Copy the **Connection pooling** string (port 6543) or **Direct connection** (port 5432)
   - Use this as `DATABASE_URL` if needed

### Step 4: Redeploy
- Render will automatically redeploy after saving environment variables
- Wait for deployment to complete (usually 2-5 minutes)

### Step 5: Check Logs
After redeployment, check logs for:
- ✅ `Supabase connected successfully`
- ✅ `Database initialization successful`
- ❌ If you still see errors, verify:
  - URLs are correct (https:// format, not postgresql://)
  - Keys are complete (not truncated)
  - Project exists and is active

---

## 🔍 Common Issues

### Issue 1: "Tenant or user not found"
**Cause:** Wrong SUPABASE_URL format or invalid credentials
**Fix:** 
- Use `https://xxxxx.supabase.co` format (not PostgreSQL connection string)
- Verify project exists in Supabase dashboard
- Check that keys are complete (not cut off)

### Issue 2: "Connection refused"
**Cause:** Wrong host/port in DATABASE_URL
**Fix:**
- Use connection pooling port: `6543` (recommended)
- Or direct connection port: `5432`
- Verify host matches your Supabase project

### Issue 3: "Invalid API key"
**Cause:** Wrong key type or expired key
**Fix:**
- Use `SUPABASE_ANON_KEY` for anon key (not service_role)
- Use `SUPABASE_SERVICE_ROLE_KEY` for service_role key
- Regenerate keys in Supabase if needed

---

## ✅ Verification Checklist

After fixing, verify:
- [ ] Python API logs show "Supabase connected successfully"
- [ ] No "Tenant or user not found" errors
- [ ] Health endpoint returns 200 OK: `https://python-api-4-aukq.onrender.com/health`
- [ ] Discovery Agent endpoint responds: `/api/v1/claim-detector/predict/batch`
- [ ] Agent 2 can successfully call Discovery Agent

---

## 📝 Quick Reference

**Your Supabase Project:**
- Check your Supabase dashboard for the actual project ID
- URL format: `https://[PROJECT_ID].supabase.co`

**Node.js API (for reference):**
- Uses same Supabase credentials
- Already working (based on tests)
- Can copy same values to Python API

**Python API Specific:**
- May need `DATABASE_URL` in addition to Supabase client vars
- Check Python API code to see which format it expects

---

## 🚀 After Fix

Once fixed, test again:
```bash
npm run test:discovery-agent
```

This should show:
- ✅ Python API Health Check: 200 OK
- ✅ Discovery Agent endpoint responding
- ✅ Claims detected > 0 (if anomalies found)




