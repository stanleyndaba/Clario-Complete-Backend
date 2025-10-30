# Deployment Checklist for Amazon SP-API Integration

## 🚀 Deployment Status

### ✅ Local Development
- [x] `.env` file created in `Integrations-backend/` with Amazon credentials
- [x] Real SP-API integration implemented
- [x] Controllers updated to return real data
- [x] Sync jobs configured for real data processing

### 🔄 Pending: Production Deployment

---

## 📦 Backend Deployment (Render)

### Environment Variables to Set in Render

Navigate to your Render dashboard → Integrations-backend → Environment

Add/Update these variables:

```bash
# Amazon SP-API Sandbox Configuration
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER

# Backend Configuration
FRONTEND_URL=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app,https://opside-complete-frontend-kqvxrzg4s*.vercel.app
```

### Steps to Deploy Backend:

1. **Log into Render Dashboard**
   - Go to https://dashboard.render.com
   - Find your Integrations-backend service

2. **Update Environment Variables**
   - Click "Environment" tab
   - Add the variables above
   - Click "Save Changes"

3. **Trigger Manual Deploy**
   - Go to "Manual Deploy" tab
   - Select "Clear build cache & deploy"
   - Click "Deploy latest commit"

4. **Monitor Deployment**
   - Watch build logs for errors
   - Check deployment health status

---

## 🎨 Frontend Deployment (Vercel)

### Environment Variables to Set in Vercel

Navigate to your Vercel dashboard → Your Project → Settings → Environment Variables

Add/Update these variables:

```bash
# Backend API URL
NEXT_PUBLIC_API_URL=https://clario-complete-backend-y5cd.onrender.com

# Backend Integrations URL  
NEXT_PUBLIC_INTEGRATIONS_URL=https://your-integrations-backend-url.onrender.com

# Optional: Debug mode
NEXT_PUBLIC_DEBUG_MODE=true
```

### Steps to Deploy Frontend:

1. **Log into Vercel Dashboard**
   - Go to https://vercel.com
   - Find your frontend project

2. **Update Environment Variables**
   - Click "Settings" → "Environment Variables"
   - Add the variables above
   - Click "Save"

3. **Trigger Redeployment**
   - Go to "Deployments" tab
   - Click "..." on latest deployment
   - Select "Redeploy"

4. **Monitor Deployment**
   - Watch build logs
   - Verify deployment success

---

## 🔍 Post-Deployment Verification

### 1. Backend Health Check

Test the backend endpoint:
```bash
curl https://clario-complete-backend-y5cd.onrender.com/api/v1/integrations/amazon/sandbox/callback
```

Expected response:
```json
{
  "user": {...},
  "access_token": "mock_jwt_token_sandbox",
  "message": "Sandbox login successful"
}
```

### 2. Test Amazon Authentication

1. Open your frontend: `https://opside-complete-frontend-kqvxrzg4s-mvelo-ndabas-projects.vercel.app`
2. Navigate to Amazon integration
3. Click "Connect Amazon"
4. Verify sandbox callback works

### 3. Test Data Sync

1. After authentication, trigger a sync
2. Check backend logs for:
   - "Fetching inventory for account..."
   - "Successfully fetched X inventory items from SP-API"
3. Verify data appears on dashboard

---

## 📝 Deployment Notes

### What Changed:

1. **Backend Changes:**
   - Real SP-API integration implemented
   - Access token management with auto-refresh
   - Real inventory fetching from sandbox
   - Controllers return actual data
   - Sync jobs process real data

2. **Frontend Changes:**
   - No changes needed (already configured)
   - Will automatically use new backend endpoints

### Important Notes:

- ✅ Backend already has CORS configured for Vercel frontend
- ✅ Sandbox credentials are ready to use
- ⚠️ Make sure to update environment variables in production
- ⚠️ Frontend may need redeployment to pick up backend changes

---

## 🐛 Troubleshooting

### If Backend Deployment Fails:

1. Check build logs for TypeScript errors
2. Verify all environment variables are set
3. Check that `.env` variables match Render configuration

### If Frontend Can't Connect:

1. Verify `NEXT_PUBLIC_API_URL` points to correct backend URL
2. Check CORS configuration in backend
3. Test backend endpoints directly

### If No Data Appears:

1. Check backend logs for SP-API authentication errors
2. Verify Amazon credentials are correctly set
3. Test inventory endpoint manually

---

## ✅ Final Checklist

- [ ] Environment variables added to Render backend
- [ ] Backend deployment successful
- [ ] Environment variables added to Vercel frontend
- [ ] Frontend redeployment successful
- [ ] Backend health check passes
- [ ] Amazon authentication works
- [ ] Data sync returns real data
- [ ] Dashboard displays inventory data

---

## 🎯 Next Steps After Deployment

1. Monitor backend logs for 24 hours
2. Verify continuous sync jobs are running
3. Test with multiple user accounts
4. Prepare for production switch from sandbox to live
