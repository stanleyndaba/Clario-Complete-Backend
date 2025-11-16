# 🔧 Render Environment Variables Setup

**Your Supabase URL:** `https://uuuqpujtnubusmigbkvw.supabase.co`

---

## ✅ Required Environment Variables for Render

Add these to your Render service (`opside-node-api`):

### **1. SUPABASE_URL** ⚠️ MISSING
```
SUPABASE_URL=https://uuuqpujtnubusmigbkvw.supabase.co
```

### **2. SUPABASE_ANON_KEY** ✅ (You have this)
```
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
- This is the **anon/public** key from Supabase
- Note: Your code uses `SUPABASE_KEY`, but our codebase uses `SUPABASE_ANON_KEY`
- Make sure the value matches the **anon** key (not service_role)

### **3. SUPABASE_SERVICE_ROLE_KEY** ✅ (You have this)
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
- This is the **service_role** key from Supabase
- ⚠️ Keep this secret! Never expose in frontend

---

## 📋 Steps to Add in Render

1. Go to https://dashboard.render.com
2. Click on your service (`opside-node-api`)
3. Go to **"Environment"** tab
4. Click **"Add Environment Variable"**
5. Add:
   - **Key:** `SUPABASE_URL`
   - **Value:** `https://uuuqpujtnubusmigbkvw.supabase.co`
6. Click **"Save Changes"**
7. Render will automatically redeploy

---

## 🔍 Verify Your Keys

In Supabase Dashboard:
1. Go to https://supabase.com/dashboard
2. Select project: `uuuqpujtnubusmigbkvw`
3. Go to **Settings** → **API**
4. You'll see:
   - **Project URL:** `https://uuuqpujtnubusmigbkvw.supabase.co` ✅ (use for SUPABASE_URL)
   - **anon public:** `eyJ...` → Use for `SUPABASE_ANON_KEY`
   - **service_role:** `eyJ...` → Use for `SUPABASE_SERVICE_ROLE_KEY`

---

## ⚠️ Important Note

Your code snippet shows:
```javascript
const supabaseKey = process.env.SUPABASE_KEY
```

But our codebase uses:
- `SUPABASE_ANON_KEY` (for anon/public key)
- `SUPABASE_SERVICE_ROLE_KEY` (for service role key)

Make sure in Render you're using:
- `SUPABASE_ANON_KEY` (not `SUPABASE_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY`

---

## ✅ After Adding SUPABASE_URL

The service should start successfully and you should see in logs:
- ✅ "Supabase connected successfully"
- ✅ "Supabase admin client created (for storage operations)"

---

**Once you add `SUPABASE_URL`, the deployment should succeed!** 🚀

