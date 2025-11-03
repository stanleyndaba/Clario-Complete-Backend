# 🔧 Fix Amazon Connection Error

## 🐛 Problem

Frontend error:
```
Clario Connection Failed
Cannot connect to backend at https://clario-complete-backend-y5cd.onrender.com/api/v1/integrations/connectamazon
```

## ✅ Solution: Two Issues to Fix

### Issue 1: Frontend Using Old Backend URL ❌

**Current (wrong)**: `https://clario-complete-backend-y5cd.onrender.com`  
**Should be**: `https://opside-node-api.onrender.com`

### Issue 2: Wrong Endpoint Path ❌

**Current (wrong)**: `/api/v1/integrations/connectamazon`  
**Should be**: `/api/v1/integrations/amazon/auth/start`

---

## 🔧 Fix Steps

### Step 1: Update Frontend Environment Variables in Vercel

1. **Go to Vercel Dashboard**
   - https://vercel.com/dashboard
   - Find your frontend project

2. **Update Environment Variables**
   - Go to: Settings → Environment Variables
   - **Update** `NEXT_PUBLIC_INTEGRATIONS_URL`:
     ```
     https://opside-node-api.onrender.com
     ```
   - **Save**

3. **Redeploy Frontend**
   - Go to: Deployments tab
   - Click "..." on latest deployment → "Redeploy"

---

### Step 2: Update Frontend Code (if needed)

The frontend code might be calling the wrong endpoint. Check your frontend code:

**Wrong:**
```javascript
/api/v1/integrations/connectamazon
```

**Correct:**
```javascript
/api/v1/integrations/amazon/auth/start
```

**Or check these alternatives:**
- `/api/v1/integrations/amazon/auth/start` (OAuth start)
- `/api/integrations/amazon/auth/start` (without v1)
- `/api/v1/integrations/connect?integration_type=amazon` (if using connect endpoint)

---

## 🧪 Test the Correct Endpoint

### Test Node.js API Amazon Endpoint:

```bash
# Test OAuth start
curl https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/start

# Should return:
# {"success":true,"authUrl":"...","message":"OAuth flow initiated"}
```

---

## 📋 Available Amazon Endpoints

Based on your Node.js API, these endpoints are available:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/integrations/amazon/auth/start` | GET | Start Amazon OAuth |
| `/api/v1/integrations/amazon/auth/callback` | GET | OAuth callback |
| `/api/v1/integrations/amazon/sync` | POST | Sync Amazon data |
| `/api/v1/integrations/amazon/disconnect` | POST | Disconnect Amazon |

---

## ✅ Quick Fix Checklist

- [ ] Updated `NEXT_PUBLIC_INTEGRATIONS_URL` in Vercel to `https://opside-node-api.onrender.com`
- [ ] Redeployed frontend
- [ ] Verified frontend code uses correct endpoint path
- [ ] Tested Amazon connection again

---

## 🔍 Debug Steps

### 1. Check Frontend Network Tab
- Open browser DevTools (F12)
- Go to Network tab
- Click "Connect Amazon"
- See what URL it's actually calling
- Check if it's calling the old URL

### 2. Check CORS
Make sure backend CORS allows your frontend:
- Frontend URL: `https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app`
- Should be in `CORS_ALLOW_ORIGINS` in backend env vars

### 3. Test Backend Directly
```bash
# Test if endpoint exists
curl https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/start

# Should return JSON with authUrl
```

---

## 🎯 Most Likely Fix

**90% chance this is the issue:**

1. Frontend still has old URL in environment variables
2. Update `NEXT_PUBLIC_INTEGRATIONS_URL` in Vercel
3. Redeploy frontend

**That should fix it!** 🚀

