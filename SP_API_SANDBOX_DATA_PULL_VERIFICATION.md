# SP-API Sandbox Data Pull Verification

## Current Status

✅ **The code IS making real SP-API calls to sandbox endpoints**

### What's Currently Working

1. **fetchClaims()** - Makes real SP-API call to `/finances/v0/financialEvents`
   - Location: `Integrations-backend/src/services/amazonService.ts:587-598`
   - Uses: `x-amz-access-token` header with LWA access token
   - Base URL: `https://sandbox.sellingpartnerapi-na.amazon.com` (when in sandbox mode)

2. **fetchFees()** - Makes real SP-API call to `/finances/v0/financialEvents`
   - Location: `Integrations-backend/src/services/amazonService.ts:1044-1055`
   - Uses: Same authentication as fetchClaims

3. **fetchInventory()** - Makes real SP-API call to `/fba/inventory/v1/summaries`
   - Location: `Integrations-backend/src/services/amazonService.ts:790-801`
   - Uses: Same authentication

4. **fetchOrders()** - Makes real SP-API call to `/orders/v0/orders`
   - Location: `Integrations-backend/src/services/ordersService.ts:84-92`
   - Uses: Same authentication

### Authentication Method

The code uses **LWA (Login with Amazon) access token** authentication:
- Header: `x-amz-access-token: <access_token>`
- Header: `Authorization: Bearer <access_token>`

**Note**: SP-API typically requires AWS Signature V4 for production, but for sandbox testing, LWA token alone may work for some endpoints. If you get 403/401 errors, AWS Signature V4 may be needed.

---

## How to Verify Data is Being Pulled

### 1. Check Backend Logs

When sync runs, look for these log messages:

```
✅ "Making SP-API request to fetch financial events"
✅ "SP-API financial events response received"
✅ "Successfully fetched X claims/reimbursements from SP-API SANDBOX"
```

### 2. Check Database

After sync completes, check the database:

```sql
-- Check if claims were saved
SELECT COUNT(*) FROM claims WHERE provider = 'amazon';

-- Check if inventory was saved
SELECT COUNT(*) FROM inventory WHERE provider = 'amazon';

-- Check if fees were saved
SELECT COUNT(*) FROM fees WHERE provider = 'amazon';

-- Check if orders were saved
SELECT COUNT(*) FROM orders WHERE provider = 'amazon';
```

### 3. Check API Response

Call the recoveries endpoint:
```bash
GET /api/v1/integrations/amazon/recoveries
```

Response should show:
- `source: "database"` - Data was synced from SP-API
- `source: "api"` - Real-time API call worked
- `dataSource: "synced_from_spapi_sandbox"` - Confirms sandbox data

---

## Potential Issues

### Issue 1: Empty Data from Sandbox

**Normal Behavior**: Amazon SP-API sandbox often returns empty data. This is expected for testing.

**Solution**: This is normal - sandbox is designed to test the API flow, not return real data.

### Issue 2: 401/403 Errors

**Possible Causes**:
- Access token expired (should auto-refresh)
- Invalid refresh token
- Missing AWS Signature V4 (may be required for some endpoints)

**Solution**: 
- Check if token refresh is working
- Verify refresh token is valid
- May need to add AWS Signature V4 authentication

### Issue 3: 404 Errors

**Possible Causes**:
- Endpoint not available in sandbox
- Wrong base URL

**Solution**: 
- Verify `AMAZON_SPAPI_BASE_URL` is set to sandbox URL
- Check if endpoint is available in sandbox

---

## Next Steps to Ensure Data Pulling

1. **Add Enhanced Logging** - Add detailed logs for each SP-API request/response
2. **Add Error Handling** - Better error messages when API calls fail
3. **Add Verification Endpoint** - Create endpoint to test SP-API connection
4. **Monitor Sync Jobs** - Check sync job logs to see if data is being pulled

---

## Testing the Connection

### Manual Test

1. Trigger a sync: `POST /api/sync/start`
2. Check sync status: `GET /api/sync/status`
3. Check backend logs for SP-API requests
4. Check database for synced data
5. Check recoveries endpoint: `GET /api/v1/integrations/amazon/recoveries`

### Expected Behavior

- ✅ Sync starts successfully
- ✅ Backend logs show SP-API requests being made
- ✅ Backend logs show responses received (even if empty)
- ✅ Database has records (or empty if sandbox has no data)
- ✅ Recoveries endpoint returns data with `source: "database"` or `source: "api"`

---

## Summary

**The code IS pulling data from SP-API sandbox** - it makes real API calls. The question is:

1. **Are the API calls succeeding?** (Check logs for 200 responses)
2. **Is the sandbox returning data?** (May be empty - this is normal)
3. **Is the data being saved to database?** (Check database after sync)

If API calls are failing, we need to:
- Check authentication (token refresh)
- Add AWS Signature V4 if needed
- Verify endpoint availability in sandbox



