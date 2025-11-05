# 🔍 Amazon Sandbox Connection Diagnostics

## 🚨 **Problem: Sandbox Connection Failing**

The sandbox connection is failing, but now we have a diagnostic tool to identify exactly why.

---

## 🛠️ **How to Diagnose**

### **Step 1: Run Diagnostics**

After the Node.js backend redeploys, call the diagnostic endpoint:

```bash
# Get diagnostics report
curl https://opside-node-api.onrender.com/api/v1/integrations/amazon/diagnose
```

Or open in browser:
```
https://opside-node-api.onrender.com/api/v1/integrations/amazon/diagnose
```

### **Step 2: Review Results**

The diagnostic will test:
1. ✅ **Environment Variables** - Checks if all required env vars are set
2. ✅ **OAuth URL Generation** - Verifies OAuth URL can be generated
3. ✅ **Token Refresh** - Tests if refresh token works
4. ✅ **SP-API Endpoint** - Tests actual API endpoint access

Each test returns:
- `success: true/false`
- `error: "specific error message"`
- `details: { ... }` - Detailed information about what was checked

---

## 📊 **What the Diagnostic Checks**

### **1. Environment Variables Check**
- ✅ `AMAZON_CLIENT_ID` or `AMAZON_SPAPI_CLIENT_ID`
- ✅ `AMAZON_CLIENT_SECRET` or `AMAZON_SPAPI_CLIENT_SECRET`
- ✅ `AMAZON_REDIRECT_URI` or `AMAZON_SPAPI_REDIRECT_URI`
- ✅ `AMAZON_SPAPI_BASE_URL`
- ✅ `AMAZON_SPAPI_REFRESH_TOKEN` (needed after OAuth)

**Common Issues:**
- Missing environment variables → Set them in Render dashboard
- Wrong variable names → Check if using `AMAZON_SPAPI_*` vs `AMAZON_*`

### **2. OAuth URL Generation**
- ✅ Validates OAuth URL can be generated
- ✅ Checks redirect URI format
- ✅ Verifies client ID is present

**Common Issues:**
- Client ID not set → Set `AMAZON_CLIENT_ID` in Render
- Invalid redirect URI → Check URL encoding

### **3. Token Refresh Test**
- ✅ Attempts to refresh access token using refresh token
- ✅ Tests credentials against Amazon's token endpoint

**Common Issues:**
- `invalid_grant` → Refresh token expired/invalid - **Complete OAuth flow again**
- `invalid_client` → Client ID/Secret wrong - **Check Developer Console**
- `redirect_uri_mismatch` → Redirect URI doesn't match - **Update Developer Console**

### **4. SP-API Endpoint Test**
- ✅ Gets access token
- ✅ Tests calling `/sellers/v1/marketplaceParticipations` endpoint

**Common Issues:**
- `401 Unauthorized` → Invalid access token
- `403 Forbidden` → Token lacks permissions
- `400 Bad Request` → Sandbox endpoint limitation

---

## 🔧 **Common Fixes Based on Diagnostic Results**

### **If "Environment Variables" Fails:**
1. Go to Render dashboard → Your Node.js service
2. Settings → Environment Variables
3. Add missing variables (see `AMAZON_SPAPI_SANDBOX_OAUTH_SETUP.md`)

### **If "Token Refresh Test" Fails with `invalid_grant`:**
1. **Your refresh token is expired/invalid**
2. You need to complete OAuth flow again:
   - Call `/api/v1/integrations/amazon/auth/start`
   - Authorize on Amazon
   - Get new refresh token
   - Update `AMAZON_SPAPI_REFRESH_TOKEN` in Render

### **If "Token Refresh Test" Fails with `invalid_client`:**
1. Check `AMAZON_CLIENT_ID` matches Developer Console
2. Check `AMAZON_CLIENT_SECRET` matches Developer Console
3. Verify credentials are for sandbox (not production)

### **If "Token Refresh Test" Fails with `redirect_uri_mismatch`:**
1. Go to Amazon Developer Console
2. Login with Amazon → Your Security Profile
3. Web Settings → Allowed Return URLs
4. Add: `https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/callback`
5. **Must match exactly** (including https, no trailing slash)

### **If "SP-API Endpoint Test" Fails with `401`:**
1. Token refresh is failing → Fix token refresh first
2. Access token expired → Token refresh should fix this

### **If "SP-API Endpoint Test" Fails with `400`:**
1. Sandbox has limited endpoint support
2. Some endpoints may not work in sandbox
3. Check Amazon SP-API documentation for sandbox limitations

---

## 📝 **Example Diagnostic Response**

```json
{
  "success": false,
  "summary": {
    "total": 4,
    "passed": 2,
    "failed": 2
  },
  "results": [
    {
      "step": "Environment Variables",
      "success": true,
      "details": {
        "present": ["AMAZON_CLIENT_ID", "AMAZON_CLIENT_SECRET", ...],
        "isSandbox": "✓ Sandbox mode"
      }
    },
    {
      "step": "OAuth URL Generation",
      "success": true
    },
    {
      "step": "Token Refresh Test",
      "success": false,
      "error": "invalid_grant",
      "details": {
        "errorCode": "invalid_grant",
        "errorDescription": "The provided authorization grant is invalid, expired, revoked, or was issued to another client."
      }
    },
    {
      "step": "SP-API Endpoint Test",
      "success": false,
      "error": "Token refresh failed - cannot test SP-API endpoint"
    }
  ],
  "failures": [
    {
      "step": "Token Refresh Test",
      "error": "invalid_grant",
      ...
    }
  ],
  "recommendations": [
    "Refresh token is invalid or expired - complete OAuth flow again"
  ]
}
```

---

## 🎯 **Next Steps**

1. **Run diagnostics**: `GET /api/v1/integrations/amazon/diagnose`
2. **Check the failures** section
3. **Follow the recommendations**
4. **Fix the issues** (usually environment variables or OAuth flow)
5. **Run diagnostics again** to verify

---

## 🔍 **Enhanced Logging**

The diagnostic also improves error logging. Check Render logs for:
- Detailed OAuth callback errors
- Token exchange failures with specific error codes
- SP-API endpoint failures with status codes

This will help identify the exact failure point.

