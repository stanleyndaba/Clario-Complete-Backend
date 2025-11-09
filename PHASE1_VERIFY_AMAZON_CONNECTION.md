# Phase 1: How to Verify Amazon Shows as Connected

## 🎯 Overview

This guide explains how to verify that Amazon is connected after using the bypass flow or OAuth flow.

## ✅ Methods to Verify Amazon Connection

### Method 1: Integration Status Endpoint (Recommended)

**Endpoint**: `GET /api/v1/integrations/status`

**Python API** (Recommended):
```bash
curl -X GET "https://your-python-api.onrender.com/api/v1/integrations/status" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-User-Id: YOUR_USER_ID"
```

**Node.js API**:
```bash
curl -X GET "https://opside-node-api-woco.onrender.com/api/v1/integrations/status" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-User-Id: YOUR_USER_ID"
```

**Expected Response**:
```json
{
  "amazon_connected": true,
  "docs_connected": false,
  "lastSync": "2024-01-01T00:00:00Z",
  "lastIngest": null,
  "providerIngest": {
    "gmail": { "connected": false },
    "outlook": { "connected": false },
    "gdrive": { "connected": false },
    "dropbox": { "connected": false }
  }
}
```

**What to Look For**:
- ✅ `amazon_connected: true` - Amazon is connected
- ✅ `lastSync: "2024-01-01T00:00:00Z"` - Last sync time (if available)

### Method 2: Frontend Dashboard

**Visual Check**:
1. After using "Use Existing Connection" button
2. You should be redirected to: `integrations-hub?amazon_connected=true`
3. On the integrations hub page, Amazon should show as "Connected"
4. Connection status indicator should be green/active

**Frontend Integration Status**:
- The frontend should call `GET /api/v1/integrations/status`
- Display `amazon_connected` status in the UI
- Show connection indicator (green/red)
- Display last sync time if available

### Method 3: Amazon Claims Endpoint

**Endpoint**: `GET /api/v1/integrations/amazon/claims`

**Test**:
```bash
curl -X GET "https://your-python-api.onrender.com/api/v1/integrations/amazon/claims" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-User-Id: YOUR_USER_ID"
```

**Expected Response**:
```json
{
  "success": true,
  "claims": [],
  "source": "amazon_spapi",
  "isSandbox": true,
  "message": "No claims found (sandbox test data)"
}
```

**What to Look For**:
- ✅ `success: true` - Amazon API is accessible
- ✅ `source: "amazon_spapi"` - Data is from Amazon SP-API
- ✅ `isSandbox: true` - Using sandbox mode (expected)

### Method 4: Amazon Recoveries Endpoint

**Endpoint**: `GET /api/v1/integrations/amazon/recoveries`

**Test**:
```bash
curl -X GET "https://your-python-api.onrender.com/api/v1/integrations/amazon/recoveries" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-User-Id: YOUR_USER_ID"
```

**Expected Response**:
```json
{
  "success": true,
  "recoveries": [],
  "total": 0,
  "source": "amazon_spapi"
}
```

**What to Look For**:
- ✅ `success: true` - Amazon API is accessible
- ✅ Response contains recovery data (may be empty in sandbox)

### Method 5: Backend Logs

**Check Render Logs**:
1. Go to Render dashboard
2. Select your Node.js backend service
3. View logs
4. Look for:
   - `Amazon SP-API initialized in SANDBOX mode`
   - `Refresh token already exists in environment`
   - `Bypassing OAuth flow - using existing refresh token`
   - `Amazon is connected`

## 🧪 Automated Testing

### Using Test Script

Run the test script to automatically verify Amazon connection:

```powershell
.\test-phase1-amazon-connection.ps1 -NodeApiUrl "https://opside-node-api-woco.onrender.com" -PythonApiUrl "https://your-python-api.onrender.com" -TestUserId "your-user-id" -AuthToken "your-jwt-token"
```

**What the Script Tests**:
1. ✅ Integration status endpoint (Python API)
2. ✅ Integration status endpoint (Node.js API)
3. ✅ Amazon claims endpoint
4. ✅ Token manager (refresh token check)

## 📋 Step-by-Step Verification

### Step 1: Use Bypass Flow

1. Click "Use Existing Connection (Skip OAuth)" button
2. Verify redirect to `integrations-hub?amazon_connected=true`
3. Check URL parameter: `amazon_connected=true`

### Step 2: Check Integration Status

1. Call `GET /api/v1/integrations/status`
2. Verify `amazon_connected: true`
3. Check `lastSync` timestamp (if available)

### Step 3: Verify Frontend Display

1. Check integrations hub page
2. Verify Amazon shows as "Connected"
3. Verify connection indicator is green/active
4. Verify last sync time is displayed (if available)

### Step 4: Test Amazon API Access

1. Call `GET /api/v1/integrations/amazon/claims`
2. Verify `success: true`
3. Verify `source: "amazon_spapi"`
4. Verify `isSandbox: true` (for sandbox mode)

## 🔍 Troubleshooting

### Issue: `amazon_connected: false`

**Possible Causes**:
1. Refresh token not set in environment
2. Refresh token is invalid/expired
3. Token manager not finding token
4. Database not updated

**Solutions**:
1. Verify `AMAZON_SPAPI_REFRESH_TOKEN` is set in Render environment
2. Check backend logs for token validation errors
3. Try using bypass flow again
4. Verify token is valid

### Issue: Integration Status Endpoint Returns Error

**Possible Causes**:
1. Authentication token invalid
2. User ID not provided
3. Endpoint not accessible
4. Service not running

**Solutions**:
1. Verify JWT token is valid
2. Provide `X-User-Id` header
3. Check service is running
4. Verify endpoint URL is correct

### Issue: Frontend Doesn't Show Connected Status

**Possible Causes**:
1. Frontend not calling status endpoint
2. Frontend not parsing response correctly
3. Frontend cache issue
4. Status endpoint returning wrong data

**Solutions**:
1. Check frontend network tab for API calls
2. Verify frontend is calling correct endpoint
3. Clear browser cache
4. Check frontend console for errors

## ✅ Success Criteria

Amazon is considered connected if:
- ✅ `GET /api/v1/integrations/status` returns `amazon_connected: true`
- ✅ `GET /api/v1/integrations/amazon/claims` returns `success: true`
- ✅ Frontend shows Amazon as "Connected"
- ✅ Backend logs show "Amazon is connected"
- ✅ Refresh token exists in environment

## 📝 Example: Complete Verification Flow

### 1. Use Bypass Flow
```bash
# Frontend calls:
GET /api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=https://your-frontend.vercel.app

# Response:
{
  "success": true,
  "bypassed": true,
  "redirectUrl": "https://your-frontend.vercel.app/integrations-hub?amazon_connected=true"
}
```

### 2. Check Integration Status
```bash
# Call status endpoint:
GET /api/v1/integrations/status

# Response:
{
  "amazon_connected": true,
  "docs_connected": false,
  "lastSync": "2024-01-01T00:00:00Z",
  "providerIngest": { ... }
}
```

### 3. Verify Frontend Display
- ✅ URL contains `amazon_connected=true`
- ✅ Amazon shows as "Connected" on dashboard
- ✅ Connection indicator is green/active

### 4. Test Amazon API
```bash
# Call claims endpoint:
GET /api/v1/integrations/amazon/claims

# Response:
{
  "success": true,
  "claims": [],
  "source": "amazon_spapi",
  "isSandbox": true
}
```

## 🎉 Conclusion

**Amazon is connected if**:
- Integration status endpoint returns `amazon_connected: true`
- Amazon API endpoints are accessible
- Frontend shows Amazon as connected
- Backend logs confirm connection

**If Amazon is not connected**:
- Use "Use Existing Connection" button (bypass flow)
- Verify `AMAZON_SPAPI_REFRESH_TOKEN` is set in environment
- Check backend logs for errors
- Verify token is valid

## 🚀 Quick Test

Run this command to quickly verify Amazon connection:

```powershell
.\test-phase1-amazon-connection.ps1 -PythonApiUrl "https://your-python-api.onrender.com" -TestUserId "your-user-id"
```

This will test all endpoints and provide a comprehensive status report.

