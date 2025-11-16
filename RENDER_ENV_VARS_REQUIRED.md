# 🔧 Required Render Environment Variables

**Issue:** Service failing to start with "Invalid supabaseUrl" error

---

## ✅ Required Environment Variables

Add these to your Render service **Environment** tab:

### **1. SUPABASE_URL** (Required)
```
https://YOUR_PROJECT_ID.supabase.co
```
- Get this from your Supabase project settings
- Must be a valid HTTPS URL
- Example: `https://fmzfjhrwbkebqaxjlvzt.supabase.co`

### **2. SUPABASE_ANON_KEY** (Required)
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
- Get this from Supabase project settings → API → anon/public key
- This is the public/anonymous key

### **3. SUPABASE_SERVICE_ROLE_KEY** (Required for Agent 3)
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
- Get this from Supabase project settings → API → service_role key
- ⚠️ **Keep this secret!** Never expose in frontend code
- This bypasses RLS (Row Level Security) for backend operations

---

## 📋 How to Add in Render

1. Go to https://dashboard.render.com
2. Click on your service (`opside-node-api` or similar)
3. Go to **"Environment"** tab
4. Click **"Add Environment Variable"**
5. Add each variable:
   - **Key:** `SUPABASE_URL`
   - **Value:** `https://YOUR_PROJECT_ID.supabase.co`
6. Repeat for `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`
7. Click **"Save Changes"**
8. Render will automatically redeploy

---

## 🔍 Where to Find Supabase Keys

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Settings** → **API**
4. You'll see:
   - **Project URL** → Use as `SUPABASE_URL`
   - **anon public** key → Use as `SUPABASE_ANON_KEY`
   - **service_role** key → Use as `SUPABASE_SERVICE_ROLE_KEY`

---

## ✅ Verification

After adding variables and redeploying, check logs for:
- ✅ "Supabase connected successfully"
- ✅ "Supabase admin client created (for storage operations)"
- ❌ If you see errors, check that URLs/keys are correct

---

## 🚨 Common Mistakes

1. **Missing `https://`** - URL must start with `https://`
2. **Extra spaces** - Copy keys exactly, no leading/trailing spaces
3. **Wrong key** - Make sure you're using the right key (anon vs service_role)
4. **Project ID mismatch** - URL must match your actual Supabase project

---

**After adding these, Render will redeploy and the service should start successfully!** 🚀

