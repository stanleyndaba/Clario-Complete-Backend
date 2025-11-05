# 🔄 Amazon Sandbox SP-API Data Sync Guide

## ⚠️ Important: Connection ≠ Data

**Just because your sandbox is "connected" doesn't mean you'll see data automatically!**

### What "Connected" Means
- ✅ OAuth authentication is working
- ✅ Tokens are stored and valid
- ✅ Your app can make authenticated requests to SP-API sandbox

### What "Connected" Does NOT Mean
- ❌ Data is automatically fetched
- ❌ Data appears in your dashboard
- ❌ Data is stored in your database

## 🔍 Why You Don't See Data

The SP-API sandbox is a **black-box API**. It returns mock JSON responses when you call it, but:

1. **You must explicitly call the API** - No automatic data fetching
2. **You must parse the JSON** - Data doesn't magically appear in your UI
3. **You must store it** - Sandbox data is ephemeral unless you save it

## ✅ How to See Sandbox Data in Your App

### Step 1: Trigger a Sync

After connecting to the sandbox, you **must** trigger a sync to fetch data:

```bash
# Option 1: Using curl
curl -X POST https://your-node-backend.com/api/v1/integrations/amazon/sync \
  -H "Content-Type: application/json" \
  -H "Cookie: your-auth-cookie"

# Option 2: From your frontend
fetch('/api/v1/integrations/amazon/sync', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json'
  }
})
```

### Step 2: What the Sync Does

The sync endpoint (`POST /api/v1/integrations/amazon/sync`) will:

1. **Fetch Claims/Reimbursements** from SP-API sandbox
   - Calls: `GET /finances/v0/financialEvents`
   - Returns: Mock reimbursement events

2. **Fetch Inventory** from SP-API sandbox
   - Calls: `GET /fba/inventory/v1/summaries`
   - Returns: Mock inventory summaries

3. **Fetch Fees** from SP-API sandbox
   - Calls: `GET /finances/v0/financialEvents`
   - Returns: Mock fee events

4. **Store the Data** (if database storage is implemented)
   - Saves claims to database
   - Saves inventory to database
   - Saves fees to database

### Step 3: Check the Response

After triggering sync, you'll get a response like:

```json
{
  "success": true,
  "message": "Data sync completed successfully",
  "data": {
    "status": "completed",
    "message": "Sandbox data sync successful",
    "recoveredAmount": 1234.56,
    "potentialRecovery": 567.89,
    "totalFees": 234.56,
    "claimsFound": 5,
    "inventoryItems": 12,
    "summary": {
      "approved_claims": 3,
      "pending_claims": 2,
      "under_review_claims": 0,
      "active_inventory": 10,
      "total_inventory_value": 2500
    }
  },
  "userId": "user-123",
  "source": "spapi_sandbox"
}
```

### Step 4: Display the Data

Now your app can display the data:

```javascript
// After sync, fetch the data
const claims = await fetch('/api/v1/integrations/amazon/claims');
const inventory = await fetch('/api/v1/integrations/amazon/inventory');

// Display in UI
claims.forEach(claim => {
  console.log(`Claim: ${claim.id}, Amount: $${claim.amount}, Status: ${claim.status}`);
});
```

## 🧪 Quick Test

### Test 1: Check if Sync Works

```bash
# Trigger sync
curl -X POST https://your-backend.com/api/v1/integrations/amazon/sync \
  -H "Cookie: your-auth-cookie"

# Expected response:
{
  "success": true,
  "data": {
    "claimsFound": 5,
    "inventoryItems": 12,
    ...
  }
}
```

### Test 2: Check if Data is Available

```bash
# Get claims
curl https://your-backend.com/api/v1/integrations/amazon/claims \
  -H "Cookie: your-auth-cookie"

# Expected response (sandbox mock data):
{
  "success": true,
  "claims": [
    {
      "id": "RMB-123",
      "amount": 123.45,
      "status": "approved",
      "type": "liquidation_reimbursement",
      "currency": "USD",
      "fromApi": true
    },
    ...
  ]
}
```

### Test 3: Check Recoveries Summary

```bash
# Get recoveries summary (what frontend shows)
curl https://your-python-backend.com/api/v1/integrations/amazon/recoveries \
  -H "Cookie: your-auth-cookie"

# Expected response:
{
  "totalAmount": 1234.56,
  "currency": "USD",
  "claimCount": 5,
  "source": "nodejs_backend"
}
```

## 🎯 Expected Sandbox Mock Data

The SP-API sandbox returns **predictable mock data**:

### Inventory Mock Data
```json
{
  "summaries": [
    {
      "asin": "B08N5WRWNW",
      "fnSku": "X000123456",
      "conditionType": "NewItem",
      "totalSupplyQuantity": 100
    }
  ]
}
```

### Financial Events Mock Data
```json
{
  "FinancialEvents": {
    "FBALiquidationEventList": [
      {
        "OriginalRemovalOrderId": "REM123",
        "LiquidationProceedsAmount": {
          "CurrencyAmount": "123.45",
          "CurrencyCode": "USD"
        },
        "PostedDate": "2024-01-15T10:00:00Z"
      }
    ]
  }
}
```

## ⚠️ Common Issues

### Issue 1: Sync Returns Empty Data

**Symptom**: Sync completes but `claimsFound: 0`, `inventoryItems: 0`

**Possible Causes**:
- Sandbox endpoint not returning data
- Date range too narrow (no events in range)
- SP-API sandbox has limited endpoint support

**Solution**:
- Check backend logs for SP-API response
- Try different date ranges
- Verify sandbox endpoint is working

### Issue 2: Sync Fails with 401

**Symptom**: `401 Unauthorized` error during sync

**Possible Causes**:
- Token expired
- Token not valid for sandbox
- User not authenticated

**Solution**:
- Reconnect to sandbox
- Check token refresh logic
- Verify user is authenticated

### Issue 3: Data Not Appearing in UI

**Symptom**: Sync succeeds, but UI shows no data

**Possible Causes**:
- Frontend not calling the right endpoints
- Data not being stored in database
- Frontend not parsing response correctly

**Solution**:
- Check frontend console for API calls
- Verify data is stored after sync
- Check frontend code for data parsing

## 🔄 Sync Flow Diagram

```
1. User connects to sandbox (OAuth)
   ↓
2. User triggers sync: POST /api/v1/integrations/amazon/sync
   ↓
3. Backend calls SP-API sandbox:
   - GET /finances/v0/financialEvents (claims)
   - GET /fba/inventory/v1/summaries (inventory)
   - GET /finances/v0/financialEvents (fees)
   ↓
4. Backend receives mock JSON responses
   ↓
5. Backend parses and stores data (optional)
   ↓
6. Frontend fetches data:
   - GET /api/v1/integrations/amazon/claims
   - GET /api/v1/integrations/amazon/inventory
   - GET /api/v1/integrations/amazon/recoveries
   ↓
7. Frontend displays data in UI
```

## 📝 Summary

| Question | Answer |
|----------|--------|
| Should sandbox data auto-appear after connection? | **No** - You must trigger sync |
| Do I need to code the sync logic? | **Yes** - Backend must call SP-API |
| Do I need to code the display logic? | **Yes** - Frontend must fetch and render |
| Is the sandbox working if I get JSON back? | **Yes** - Mock JSON means it's working |
| How do I see data in my app? | **1. Connect** → **2. Sync** → **3. Fetch** → **4. Display** |

## 🚀 Next Steps

1. ✅ **Connect to sandbox** (OAuth flow) - You've done this!
2. ⏳ **Trigger sync** - Call `POST /api/v1/integrations/amazon/sync`
3. ⏳ **Check sync response** - Verify data was fetched
4. ⏳ **Fetch data in frontend** - Call claims/inventory endpoints
5. ⏳ **Display data** - Render in your UI with "SANDBOX MOCK" badge

## 💡 Pro Tip: Label Sandbox Data

Always tag sandbox data in your UI to avoid confusion:

```html
<span class="badge badge-warning">SANDBOX MOCK</span>
<span class="badge badge-info">SP-API Sandbox</span>
```

This prevents users from thinking it's real production data.

