# Quick Guide: How to Verify Amazon Shows as Connected

## 🎯 Quick Answer

**To verify Amazon is connected, check the integration status endpoint:**

```bash
GET /api/v1/integrations/status
```

**Expected Response:**
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

## ✅ Methods to Verify

### Method 1: API Endpoint (Recommended)

**Python API:**
```bash
curl -X GET "https://your-python-api.onrender.com/api/v1/integrations/status" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-User-Id: YOUR_USER_ID"
```

**Node.js API:**
```bash
curl -X GET "https://opside-node-api-woco.onrender.com/api/v1/integrations/status" \
  -H "X-User-Id: YOUR_USER_ID"
```

**What to Look For:**
- ✅ `amazon_connected: true` - Amazon is connected
- ✅ `lastSync: "2024-01-01T00:00:00Z"` - Last sync time (if available)

### Method 2: Frontend Dashboard

**Visual Check:**
1. After using "Use Existing Connection" button
2. You should be redirected to: `integrations-hub?amazon_connected=true`
3. On the integrations hub page, Amazon should show as "Connected"
4. Connection status indicator should be green/active

### Method 3: Test Script (Automated)

**Run the test script:**
```powershell
.\test-phase1-amazon-connection.ps1 -PythonApiUrl "https://your-python-api.onrender.com" -TestUserId "your-user-id"
```

**What it tests:**
- ✅ Integration status endpoint
- ✅ Amazon claims endpoint
- ✅ Token manager check
- ✅ Connection status verification

## 🔍 How It Works

### Backend Check (Node.js)

The backend checks for Amazon connection in two ways:

1. **Database Token** (Production):
   - Checks `tokenManager.getToken(userId, 'amazon')`
   - Looks for token stored in database

2. **Environment Variables** (Sandbox):
   - Checks `AMAZON_SPAPI_REFRESH_TOKEN` in environment
   - Checks `AMAZON_CLIENT_ID` in environment
   - Checks `AMAZON_CLIENT_SECRET` in environment
   - If all exist, Amazon is considered "connected"

### Backend Check (Python)

The Python API checks:
1. User token for `amazon_seller_id`
2. Database for user's Amazon seller ID
3. Integrations service for connection status

## ✅ Success Criteria

Amazon is considered connected if:
- ✅ `GET /api/v1/integrations/status` returns `amazon_connected: true`
- ✅ Frontend shows Amazon as "Connected"
- ✅ `AMAZON_SPAPI_REFRESH_TOKEN` exists in environment (sandbox)
- ✅ OR token exists in database (production)

## 🚀 Quick Test

**Step 1: Use Bypass Flow**
- Click "Use Existing Connection" button
- Verify redirect to `integrations-hub?amazon_connected=true`

**Step 2: Check Status**
- Call `GET /api/v1/integrations/status`
- Verify `amazon_connected: true`

**Step 3: Verify Frontend**
- Check integrations hub page
- Verify Amazon shows as "Connected"

## 📝 Example Response

**If Connected:**
```json
{
  "amazon_connected": true,
  "docs_connected": false,
  "lastSync": "2024-01-01T00:00:00Z",
  "providerIngest": {
    "gmail": { "connected": false },
    "outlook": { "connected": false },
    "gdrive": { "connected": false },
    "dropbox": { "connected": false }
  }
}
```

**If Not Connected:**
```json
{
  "amazon_connected": false,
  "docs_connected": false,
  "lastSync": null,
  "providerIngest": {
    "gmail": { "connected": false },
    "outlook": { "connected": false },
    "gdrive": { "connected": false },
    "dropbox": { "connected": false }
  }
}
```

## 🎉 Conclusion

**To verify Amazon is connected:**
1. Call `GET /api/v1/integrations/status`
2. Check `amazon_connected: true`
3. Verify frontend shows Amazon as "Connected"

**If not connected:**
1. Use "Use Existing Connection" button
2. Verify `AMAZON_SPAPI_REFRESH_TOKEN` is set in environment
3. Check backend logs for errors

