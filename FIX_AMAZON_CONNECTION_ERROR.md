# 🔧 Fix: "Cannot connect to backend" Error

## 🐛 The Problem

**Error Message:**
```
Clario Connection Failed
Cannot connect to backend at https://clario-complete-backend-y5cd.onrender.com/api/v1/integrations/connectamazon
The backend may be down, sleeping, or blocked by CORS.
```

## ✅ The Issues

### Issue 1: Wrong Backend URL ❌
- **Frontend is calling**: `https://clario-complete-backend-y5cd.onrender.com` (old Python API)
- **Should call**: `https://opside-node-api.onrender.com` (new Node.js API)

### Issue 2: Wrong Endpoint Path ❌
- **Frontend is calling**: `/api/v1/integrations/connectamazon` (doesn't exist)
- **Should call**: `/api/v1/integrations/amazon/auth/start` (correct endpoint)

---

## 🔧 Solution: Fix Both Issues

### Step 1: Update Frontend Environment Variables (CRITICAL)

**In Vercel Dashboard:**

1. Go to: https://vercel.com/dashboard
2. Find your project: `opside-complete-frontend`
3. Click: **Settings** → **Environment Variables**
4. **Update this variable:**
   ```
   NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api.onrender.com
   ```
5. **Select environments**: Production, Preview, Development
6. **Save**
7. **Redeploy** frontend (Deployments → "..." → Redeploy)

---

### Step 2: Update Frontend Code (if needed)

Your frontend code might be calling the wrong endpoint. You need to update it:

**Find where it calls:**
```javascript
/api/v1/integrations/connectamazon
```

**Change to:**
```javascript
/api/v1/integrations/amazon/auth/start
```

**Or check if there's a connect endpoint:**
```javascript
/api/v1/integrations/connect?integration_type=amazon
```

---

## 🧪 Test the Correct Endpoint

I tested the correct endpoint - it works! ✅

```bash
curl https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/start

# Response:
# {"success":true,"authUrl":"https://sandbox.sellingpartnerapi-na.amazon.com/authorization?mock=true","message":"OAuth flow initiated"}
```

---

## 📋 Available Amazon Endpoints

Your Node.js API has these Amazon endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/integrations/amazon/auth/start` | GET | ✅ Start OAuth (use this) |
| `/api/v1/integrations/amazon/auth/callback` | GET | OAuth callback |
| `/api/v1/integrations/amazon/sync` | POST | Sync data |
| `/api/v1/integrations/amazon/disconnect` | POST | Disconnect |
| `/api/integrations/amazon/auth/start` | GET | ✅ Same (without v1) |

---

## 🎯 Quick Fix (Most Likely Solution)

**90% chance this fixes it:**

1. **Update Vercel Environment Variable:**
   - `NEXT_PUBLIC_INTEGRATIONS_URL` → `https://opside-node-api.onrender.com`
   - Redeploy frontend

2. **Update frontend code** (where it calls the endpoint):
   - Change `/api/v1/integrations/connectamazon` 
   - To: `/api/v1/integrations/amazon/auth/start`

3. **Test again**

---

## 🔍 Debug Steps

### Check What Frontend is Actually Calling:

1. **Open browser DevTools** (F12)
2. **Go to Network tab**
3. **Click "Connect Amazon" button**
4. **Look at the failed request:**
   - What URL is it calling?
   - What's the error code?
   - Is it hitting the old backend?

### Check CORS (if still failing):

Make sure backend has your frontend URL in CORS:
- Frontend: `https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app`
- Should be in `CORS_ALLOW_ORIGINS` in backend env vars

---

## ✅ Summary

**What to do:**
1. ✅ Update `NEXT_PUBLIC_INTEGRATIONS_URL` in Vercel → `https://opside-node-api.onrender.com`
2. ✅ Redeploy frontend
3. ✅ Update frontend code to use `/api/v1/integrations/amazon/auth/start`
4. ✅ Test again

**The correct endpoint exists and works!** The issue is the frontend is calling the wrong URL and wrong path.

---

Need help finding where in your frontend code to update? Let me know! 🚀

