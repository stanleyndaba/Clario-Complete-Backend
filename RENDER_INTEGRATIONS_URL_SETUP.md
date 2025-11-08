# 🔧 Setting INTEGRATIONS_URL in Render

## 📍 Where to Add It

**You need to add `INTEGRATIONS_URL` to the Python API service in Render**, not the Node.js service.

---

## 🎯 Step-by-Step Instructions

### Step 1: Go to Render Dashboard

1. Visit: https://dashboard.render.com
2. Log in to your account

### Step 2: Find Your Python API Service

1. Look for your Python API service:
   - Service name: `opside-python-api` or `python-api-2-jlx5` (based on your URL)
   - Or find the service that matches: `https://python-api-2-jlx5.onrender.com`

### Step 3: Navigate to Environment Variables

1. Click on your **Python API** service
2. Click on **"Environment"** in the left sidebar
3. Or go to **Settings** → **Environment**

### Step 4: Add INTEGRATIONS_URL

1. Click **"Add Environment Variable"** button
2. Set the following:
   - **Key**: `INTEGRATIONS_URL`
   - **Value**: `https://opside-node-api-woco.onrender.com`
3. Click **"Save Changes"**

### Step 5: Redeploy (CRITICAL)

**Environment variables only take effect after redeployment!**

1. Go to **"Manual Deploy"** or **"Events"** tab
2. Click **"Clear build cache & deploy"** or **"Redeploy"**
3. Wait for deployment to complete (2-5 minutes)

---

## ✅ Verification

After deployment, test the endpoint:

```bash
curl https://python-api-2-jlx5.onrender.com/api/v1/integrations/amazon/claims/test
```

**Expected response:**
```json
{
  "success": true,
  "test": true,
  "nodejs_backend_url": "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/claims",
  "response_status": 200,
  "message": "Node.js backend connection successful"
}
```

---

## 📋 Current Configuration

- **Python API URL**: `https://python-api-2-jlx5.onrender.com`
- **Node.js Backend URL**: `https://opside-node-api-woco.onrender.com`
- **Environment Variable**: `INTEGRATIONS_URL=https://opside-node-api-woco.onrender.com`

---

## 🔍 Why This Is Needed

The Python API acts as a proxy/gateway that forwards Amazon integration requests to the Node.js backend. Without `INTEGRATIONS_URL`, the Python API doesn't know where to send these requests and will default to `http://localhost:3001` (which doesn't work in production).

---

## ⚠️ Important Notes

1. **No trailing slash**: Don't include a trailing slash in the URL
   - ✅ Correct: `https://opside-node-api-woco.onrender.com`
   - ❌ Wrong: `https://opside-node-api-woco.onrender.com/`

2. **Must redeploy**: Environment variables are baked into the build, so you must redeploy after adding/changing them

3. **Check both services**: Make sure you're adding it to the **Python API** service, not the Node.js service

---

## 🐛 Troubleshooting

### If it still doesn't work after setting:

1. **Check logs**: Go to your Python API service → **"Logs"** tab
   - Look for: `🔗 INTEGRATIONS_URL: ...`
   - Should show: `https://opside-node-api-woco.onrender.com`

2. **Verify Node.js backend is running**:
   ```bash
   curl https://opside-node-api-woco.onrender.com/health
   ```

3. **Check environment variable is set**:
   - Go to Python API service → Environment
   - Verify `INTEGRATIONS_URL` is listed and has the correct value

4. **Force redeploy**: Clear build cache and redeploy

