# Phase 2: Production Migration Guide

## ⚠️ Current Status: SANDBOX MODE (Default)

**The system is currently configured for SANDBOX mode by default.** This is the correct configuration until full SP-API production credentials are received from Amazon.

**Production mode is available but not enabled by default.** This guide explains how to switch to production mode when ready.

## 🎯 Goal (Future)
When production credentials are received from Amazon, switch from sandbox mode to production mode and ensure real-time claim detection is fully functional with live SP-API data.

---

## ✅ What's Been Updated

### 1. **Amazon Service - Production Mode Support (Ready for Future Use)**
- ✅ Updated `amazonService.ts` to properly detect production vs sandbox
- ✅ **Default mode: SANDBOX** (remains in sandbox until explicitly switched)
- ✅ Enhanced logging to distinguish between sandbox and production
- ✅ Updated `fetchClaims()` to work with both sandbox and production SP-API
- ✅ Improved error handling for production mode
- ✅ Production mode now returns `LIVE_PRODUCTION_DATA` instead of `SANDBOX_TEST_DATA`
- ✅ **System stays in sandbox mode by default** - production mode only activates when explicitly configured

### 2. **Environment Detection**
- ✅ `isSandbox()` method now correctly detects production mode
- ✅ Supports explicit `AMAZON_SPAPI_BASE_URL` configuration
- ✅ Falls back to production URL if `NODE_ENV=production` and no explicit URL
- ✅ Defaults to sandbox for development safety

### 3. **Claim Detection Service**
- ✅ Updated logging to show production mode when applicable
- ✅ Detection service works with both sandbox and production data

---

## 🔧 Configuration Changes

### Step 1: Current Configuration (Sandbox - Default)

**Current Setup (Sandbox Mode):**

```bash
# Sandbox SP-API URL (DEFAULT - currently active)
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com

# Sandbox credentials (currently in use)
AMAZON_CLIENT_ID=<sandbox-client-id>
AMAZON_CLIENT_SECRET=<sandbox-client-secret>
AMAZON_SPAPI_REFRESH_TOKEN=<sandbox-refresh-token>

# NODE_ENV can be development or production (doesn't affect sandbox mode)
NODE_ENV=development
```

**⚠️ IMPORTANT: System is currently in SANDBOX mode. Do not change to production until full SP-API credentials are received from Amazon.**

### Step 2: Future Configuration (Production - When Ready)

**For Production Mode (Future - When Credentials Received):**

```bash
# Production SP-API URL (remove 'sandbox' from URL)
AMAZON_SPAPI_BASE_URL=https://sellingpartnerapi-na.amazon.com

# OR for other regions:
# EU: https://sellingpartnerapi-eu.amazon.com
# FE: https://sellingpartnerapi-fe.amazon.com

# Production credentials (from Amazon Seller Central - when received)
AMAZON_CLIENT_ID=<production-client-id>
AMAZON_CLIENT_SECRET=<production-client-secret>
AMAZON_SPAPI_REFRESH_TOKEN=<production-refresh-token>

# Set NODE_ENV to production (optional - URL determines mode)
NODE_ENV=production
```

---

## 🔍 How to Verify Production Mode

### 1. Check Logs

**On Service Start:**
```
Amazon SP-API initialized in PRODUCTION mode - using live data
{
  baseUrl: 'https://sellingpartnerapi-na.amazon.com',
  environment: 'production',
  warning: 'This will fetch real production data from Amazon SP-API'
}
```

**On Claims Fetch:**
```
Fetching claims/reimbursements for account {accountId} from SP-API PRODUCTION
{
  environment: 'PRODUCTION',
  dataType: 'LIVE_PRODUCTION_DATA',
  note: 'Using Amazon SP-API production - fetching real live data from Amazon'
}
```

### 2. Check API Response

**Claims Endpoint Response:**
```json
{
  "success": true,
  "claims": [...],
  "isSandbox": false,
  "environment": "PRODUCTION",
  "dataType": "LIVE_PRODUCTION_DATA",
  "message": "Fetched X claims/reimbursements from SP-API PRODUCTION (live data)"
}
```

### 3. Test Endpoints

```bash
# Test claims endpoint
curl -H "X-User-Id: test-user" \
     https://your-node-api.onrender.com/api/v1/integrations/amazon/claims

# Expected response should show:
# - "isSandbox": false
# - "environment": "PRODUCTION"
# - "dataType": "LIVE_PRODUCTION_DATA"
```

---

## 🚀 Current Status: Sandbox Mode (Active)

### ✅ System is Currently Configured for Sandbox
- ✅ Sandbox URL is the default
- ✅ Sandbox credentials are in use
- ✅ All endpoints return `SANDBOX_TEST_DATA`
- ✅ Real-time claim detection works with sandbox data
- ✅ System will remain in sandbox until explicitly switched to production

### 🔄 No Action Required
The system is correctly configured for sandbox mode. No changes needed until production credentials are received from Amazon.

---

## 🚀 Future Deployment Steps (When Production Credentials Received)

### Step 1: Get Production Credentials (Future)

1. **Go to Amazon Seller Central**
   - Navigate to Apps & Services → Develop Apps
   - Create a new app or use existing production app
   - Get production Client ID and Client Secret

2. **Complete OAuth Flow with Production Credentials**
   - Use production Client ID
   - Complete OAuth flow to get production Refresh Token
   - Store production Refresh Token securely

### Step 2: Update Render Environment Variables

1. **Go to Render Dashboard**
   - Open your Node.js service (e.g., `opside-node-api`)
   - Go to Environment tab
   - Update the following variables:

```bash
# Remove sandbox from URL
AMAZON_SPAPI_BASE_URL=https://sellingpartnerapi-na.amazon.com

# Update to production credentials
AMAZON_CLIENT_ID=<production-client-id>
AMAZON_CLIENT_SECRET=<production-client-secret>
AMAZON_SPAPI_REFRESH_TOKEN=<production-refresh-token>

# Ensure NODE_ENV is set
NODE_ENV=production
```

### Step 3: Redeploy Service

1. **Trigger Deployment**
   - Render will automatically redeploy when environment variables change
   - OR manually trigger deployment from Render dashboard

2. **Monitor Deployment Logs**
   - Check for: "Amazon SP-API initialized in PRODUCTION mode"
   - Verify no sandbox-related warnings

### Step 4: Verify Production Mode

1. **Test Claims Endpoint**
   ```bash
   curl -H "X-User-Id: test-user" \
        https://your-node-api.onrender.com/api/v1/integrations/amazon/claims
   ```

2. **Check Response**
   - Should show `"isSandbox": false`
   - Should show `"environment": "PRODUCTION"`
   - Should show `"dataType": "LIVE_PRODUCTION_DATA"`

3. **Verify Real Data**
   - Claims should be real production data from Amazon
   - Data should match what you see in Seller Central

---

## 🔄 Real-Time Claim Detection

### How It Works

1. **Background Sync**
   - Sync job runs periodically (configurable)
   - Fetches latest financial events from SP-API
   - Stores in database for claim detection

2. **Claim Detection**
   - Detection service analyzes financial events
   - Uses ML models to identify claimable items
   - Calculates confidence scores
   - Stores detected claims in database

3. **Real-Time Updates**
   - SSE (Server-Sent Events) sends real-time updates
   - Frontend receives notifications when new claims are detected
   - Dashboard updates automatically

### Verify Real-Time Detection

1. **Trigger Sync**
   ```bash
   POST /api/sync/start
   ```

2. **Monitor Sync Status**
   ```bash
   GET /api/sync/status
   ```

3. **Check Detection Results**
   ```bash
   GET /api/v1/claims/detect
   ```

4. **Verify SSE Updates**
   - Frontend should receive real-time updates
   - New claims should appear in dashboard
   - Notifications should be sent

---

## ⚠️ Important Notes

### 1. **Production Credentials**
- ⚠️ **Never commit production credentials to Git**
- ⚠️ **Use environment variables only**
- ⚠️ **Rotate credentials regularly**

### 2. **Rate Limiting**
- Production SP-API has stricter rate limits
- Default delay is 2 seconds (vs 1 second for sandbox)
- Monitor rate limit errors in logs

### 3. **Data Accuracy**
- Production data is real and affects real accounts
- Double-check all claim detection before auto-submission
- Monitor for false positives

### 4. **Testing**
- Test in sandbox first before switching to production
- Verify all endpoints work correctly
- Test with real production data (small date ranges)

---

## 🐛 Troubleshooting

### Issue: Still Showing Sandbox Mode

**Solution:**
1. Check `AMAZON_SPAPI_BASE_URL` - should NOT contain 'sandbox'
2. Verify environment variable is set in Render
3. Restart service after updating environment variables
4. Check logs for initialization message

### Issue: Production API Returns 401 Unauthorized

**Solution:**
1. Verify production credentials are correct
2. Check refresh token is valid
3. Complete OAuth flow again if needed
4. Verify credentials match production app

### Issue: No Claims Returned

**Solution:**
1. Check date range - production may have no claims in range
2. Verify user has actual claims in Seller Central
3. Check API response for errors
4. Verify SP-API permissions are correct

### Issue: Rate Limit Errors

**Solution:**
1. Increase delay between API calls
2. Reduce date range for initial sync
3. Implement exponential backoff
4. Monitor rate limit headers

---

## ✅ Checklist

- [ ] Production credentials obtained from Amazon Seller Central
- [ ] OAuth flow completed with production credentials
- [ ] Environment variables updated in Render
- [ ] Service redeployed with production configuration
- [ ] Logs show "PRODUCTION mode" on startup
- [ ] Claims endpoint returns `"isSandbox": false`
- [ ] Real production data is being fetched
- [ ] Real-time claim detection is working
- [ ] SSE updates are being sent
- [ ] Dashboard shows real production claims

---

## 📊 Expected Results

### Before (Sandbox)
```json
{
  "success": true,
  "claims": [...],
  "isSandbox": true,
  "environment": "SANDBOX",
  "dataType": "SANDBOX_TEST_DATA",
  "message": "Fetched X claims/reimbursements from SP-API SANDBOX (test data)"
}
```

### After (Production)
```json
{
  "success": true,
  "claims": [...],
  "isSandbox": false,
  "environment": "PRODUCTION",
  "dataType": "LIVE_PRODUCTION_DATA",
  "message": "Fetched X claims/reimbursements from SP-API PRODUCTION (live data)"
}
```

---

## 🎯 Next Steps

1. **Update Environment Variables** - Set production credentials
2. **Redeploy Service** - Trigger deployment with new configuration
3. **Verify Production Mode** - Check logs and API responses
4. **Test Real-Time Detection** - Trigger sync and verify claims are detected
5. **Monitor Performance** - Watch for rate limits and errors
6. **Enable Auto-Submission** - Once verified, enable auto-submission (optional)

---

## 📝 Summary

✅ **Code Updated:** Amazon service now supports production mode (ready for future use)
✅ **Default Mode:** SANDBOX (currently active - correct configuration)
✅ **Environment Detection:** Properly detects sandbox vs production
✅ **Logging Enhanced:** Clear distinction between sandbox and production
✅ **Error Handling:** Improved error handling for production mode
✅ **Real-Time Detection:** Claim detection works with sandbox data (will work with production when switched)

**Current Status:** ✅ **SANDBOX MODE (Active)** - System is correctly configured
**Future:** 🔄 **Production mode ready** - Will activate when production credentials are received from Amazon

**No action required** - System remains in sandbox mode until production credentials are received and environment variables are updated.

