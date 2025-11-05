# 🔧 Amazon SP-API Sandbox OAuth Setup Guide

## ✅ **Understanding Amazon SP-API Sandbox**

According to Amazon's documentation:
- **Sandbox OAuth Flow**: Uses real OAuth flow, just like production
- **Sandbox Authorization**: Returns real tokens for sandbox API endpoints
- **Mock Data**: All API calls return pre-set simulated responses
- **No Real Data**: Everything is test data, no real seller accounts

---

## 🔑 **Step 1: Configure Redirect URI in Amazon Developer Console**

**IMPORTANT**: Redirect URIs are configured in **Amazon Developer Console** (Login with Amazon), NOT in Seller Central!

### **Where to Configure:**

1. **Go to Amazon Developer Console**
   - URL: https://developer.amazon.com/
   - Sign in with your Amazon developer account

2. **Navigate to Login with Amazon**
   - Click on **"Login with Amazon"** in the top navigation
   - Or go directly to: https://developer.amazon.com/lwa/sp/overview.html

3. **Find Your Security Profile**
   - Look for the Security Profile matching your Client ID: `amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432`
   - Click on it to edit

4. **Configure Web Settings**
   - Scroll to **"Web Settings"** section
   - Under **"Allowed Return URLs"**, add:
     ```
     https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/callback
     ```
   - Also add for local development:
     ```
     http://localhost:3001/api/v1/integrations/amazon/auth/callback
     ```
   - Click **"Save"**

---

## 🔧 **Step 2: Set Environment Variables in Render**

Add these to your **Node.js backend** (`opside-node-api`) environment variables:

```bash
# Amazon SP-API Sandbox Credentials
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER

# OAuth Redirect URI (must match Developer Console!)
AMAZON_REDIRECT_URI=https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/callback

# Frontend URL (for redirect after OAuth)
FRONTEND_URL=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app
```

---

## 🎯 **Step 3: How It Works Now**

### **OAuth Flow:**
1. User clicks "Connect Amazon Account"
2. Frontend calls: `GET /api/v1/integrations/amazon/auth/start`
3. Backend generates OAuth URL: `https://www.amazon.com/ap/oa?...`
4. User redirected to Amazon Login with Amazon page
5. User authorizes (sandbox mode)
6. Amazon redirects to: `https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/callback?code=...`
7. Backend exchanges `code` for `access_token` and `refresh_token`
8. Backend redirects to frontend: `/dashboard?amazon_connected=true`

### **What Happens After Connection:**
- ✅ "Connected!" state shown in your app
- ✅ Data syncs use Amazon's sandbox mock datasets
- ✅ All API calls go to sandbox endpoints
- ✅ No real seller data is accessed
- ✅ Perfect for testing and demos

---

## ✅ **What's Fixed**

1. ✅ **Full OAuth Flow**: Now exchanges authorization code for tokens
2. ✅ **Token Storage**: Refresh token is obtained and can be stored
3. ✅ **Proper Redirect**: Redirects to frontend after successful OAuth
4. ✅ **Error Handling**: Falls back to mock mode if token exchange fails
5. ✅ **Sandbox Support**: Works with sandbox credentials

---

## 🚀 **Next Steps**

1. **Configure Redirect URI** in Amazon Developer Console (see Step 1)
2. **Set Environment Variables** in Render (see Step 2)
3. **Redeploy** the Node.js backend
4. **Test** the OAuth flow end-to-end

---

## 📝 **Important Notes**

- **Redirect URI must match exactly** what's configured in Developer Console
- **Sandbox OAuth is real OAuth** - it's not mock, just uses sandbox endpoints
- **Tokens are real** - they just give access to sandbox API endpoints
- **Data is mock** - but the integration flow is real

---

## 🐛 **Troubleshooting**

### **"Unknown scope was requested" error**
- **Cause**: Security Profile in Amazon Developer Console may have scopes configured
- **Solution**: 
  1. Go to https://developer.amazon.com/
  2. Login with Amazon → Find your Security Profile (matches your Client ID)
  3. Click on Security Profile → Web Settings
  4. **Remove any scopes** if configured
  5. For SP-API, scopes are NOT needed - permissions are granted in Seller Central
  6. Save changes and try OAuth flow again
- **Note**: The OAuth URL does NOT include a scope parameter (this is correct for SP-API)

### **"Redirect URI mismatch" error**
- Make sure redirect URI is configured in Developer Console
- Make sure `AMAZON_REDIRECT_URI` environment variable matches exactly

### **"Invalid client" error**
- Verify `AMAZON_CLIENT_ID` matches your Developer Console Security Profile
- Check that `AMAZON_CLIENT_SECRET` is correct

### **Token exchange fails**
- Check that redirect URI matches exactly
- Verify client ID and secret are correct
- Check Render logs for detailed error messages

