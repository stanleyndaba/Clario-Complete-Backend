# 🔍 Amazon "Unauthorized" Error Analysis

## ✅ **This IS Progress!**

The error `{"errors": [{"code": "Unauthorized", "message": "Access to requested resource is denied."}]}` means:

1. ✅ Frontend is connecting to backend successfully
2. ✅ Backend is receiving the request
3. ✅ Backend is trying to call Amazon SP-API
4. ❌ **Amazon is rejecting the request** - refresh token is invalid/expired

---

## 🔍 **Root Cause**

The Amazon refresh token in your environment variables is either:
- **Invalid** (wrong token)
- **Expired** (sandbox tokens expire)
- **Not authorized** for the SP-API endpoints you're trying to access

---

## 🎯 **What's Happening**

When you click "Connect Amazon Account":
1. Frontend calls `/api/v1/integrations/amazon/auth/start`
2. Backend's `startOAuth()` should just return an OAuth URL
3. **BUT** - something is trying to fetch data from Amazon SP-API before OAuth is complete
4. It's using the refresh token from environment variables
5. Amazon rejects it → "Unauthorized"

---

## ✅ **Solution**

### **Option 1: Fix `startOAuth` to NOT call Amazon API**

The `startOAuth` function should just return an OAuth URL, not fetch data. If it's calling `fetchInventory` or `getAccessToken`, that's the problem.

### **Option 2: Get a Valid Refresh Token**

For sandbox mode, you need to:
1. Go through the OAuth flow once to get a valid refresh token
2. Use that refresh token in your environment variables

---

## 🔧 **Quick Fix: Make `startOAuth` Return URL Only**

The `startOAuth` function should be:

```typescript
async startOAuth() {
  // Just return OAuth URL - don't call any Amazon APIs
  const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
  
  if (!clientId) {
    return {
      authUrl: "https://sandbox.sellingpartnerapi-na.amazon.com/authorization?mock=true"
    };
  }
  
  // Generate real OAuth URL
  const state = crypto.randomBytes(32).toString('hex');
  const redirectUri = process.env.AMAZON_REDIRECT_URI || 'http://localhost:3000/api/v1/integrations/amazon/auth/callback';
  
  const authUrl = `https://www.amazon.com/ap/oa?client_id=${clientId}&scope=sellingpartnerapi::migration&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  
  return { authUrl };
}
```

---

## 🧪 **To Test**

1. **Check Render logs** - see what endpoint is being called
2. **Verify the error** - is it coming from `startOAuth` or somewhere else?
3. **Check if `fetchInventory` is being called** - that shouldn't happen during OAuth start

---

## 📋 **Next Steps**

1. ✅ **Improved error logging** - now shows better error messages
2. 🔄 **Need to verify** - where exactly is the Amazon API being called?
3. 🔄 **Fix `startOAuth`** - ensure it doesn't call Amazon APIs

The fact you're getting an Amazon error means the connection is working - we just need to fix the OAuth flow!

