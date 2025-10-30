# 🔧 FIX AMAZON SP-API CREDENTIALS ON RENDER

## 🎯 CRITICAL ISSUE
Your Integrations Backend service is missing Amazon SP-API credentials, causing inventory sync to fail.

## 🚀 IMMEDIATE FIX STEPS

### Step 1: Go to Render Dashboard
1. Open https://render.com
2. Go to your **Integrations Backend** service
3. Click on **Environment** tab

### Step 2: Add These Environment Variables

**COPY AND PASTE THESE EXACTLY:**

```
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER
NODE_ENV=production
```

### Step 3: Save and Deploy
1. Click **Save Changes**
2. Service will auto-redeploy (takes 2-3 minutes)
3. Wait for deployment to complete

### Step 4: Test Fix
After deployment completes, test:
```bash
curl "https://clario-complete-backend-mvak.onrender.com/api/v1/integrations/amazon/inventory"
```

**Expected Result:** Should return inventory data instead of error

## ⏰ ETA: 5 minutes to fix