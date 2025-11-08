# Dashboard Claims Integration Guide

## ✅ Yes, Claims Should Reflect on the Dashboard!

The frontend dashboard uses the `/api/v1/integrations/amazon/recoveries` endpoint to display:
- **Total Amount Recovered**: Sum of approved/completed claims
- **Claim Count**: Number of claims
- **Currency**: USD (or other)

---

## 🔄 Data Flow

```
Frontend Dashboard
  ↓ (authenticated request)
Python API (/api/v1/integrations/amazon/recoveries)
  ↓ (X-User-Id header + cookies)
Node.js Backend (/api/v1/integrations/amazon/recoveries)
  ↓ (userIdMiddleware extracts user ID)
  ├─ STEP 1: Check database for synced claims
  │  └─ If found → Calculate totals from database
  │
  └─ STEP 2: If no database claims → Fetch from SP-API
     └─ Calls amazonService.fetchClaims(userId)
        └─ Returns claims from Amazon SP-API
           └─ Calculate totals from API claims
              └─ Return summary: {totalAmount, claimCount, currency}
```

---

## 📊 Response Format

The `/recoveries` endpoint returns:
```json
{
  "totalAmount": 1250.50,
  "currency": "USD",
  "claimCount": 15,
  "source": "api",  // or "database"
  "dataSource": "spapi_sandbox",  // or "spapi_production"
  "message": "Found 15 claims from API"
}
```

---

## ✅ What's Working Now (After Phase 2)

### 1. User ID Flow ✅
- **Python API** forwards `X-User-Id` header to Node.js backend
- **Node.js middleware** extracts user ID from headers
- **Both endpoints** (`/claims` and `/recoveries`) use the same user ID extraction

### 2. Real Claims Fetching ✅
- **`/recoveries` endpoint** calls `amazonService.fetchClaims(userId)`
- **Fetches real data** from Amazon SP-API (same as `/claims` endpoint)
- **Calculates totals** from the fetched claims

### 3. Data Sources (Priority Order)
1. **Database** (synced claims) - If user has synced data
2. **SP-API** (real-time) - If no database claims, fetch directly from Amazon
3. **Auto-sync trigger** - If no data found, triggers sync in background

---

## 🔍 How It Works

### Step 1: Database Check
```typescript
// Check database for synced claims
const { data: dbClaims } = await supabase
  .from('claims')
  .select('*')
  .eq('user_id', userId)
  .eq('provider', 'amazon');

if (dbClaims && dbClaims.length > 0) {
  // Calculate totals from database
  const totalAmount = dbClaims
    .filter(claim => claim.status === 'approved' || claim.status === 'completed')
    .reduce((sum, claim) => sum + parseFloat(claim.amount), 0);
  
  return { totalAmount, claimCount: dbClaims.length, source: 'database' };
}
```

### Step 2: SP-API Fetch (Real-Time)
```typescript
// If no database claims, fetch from SP-API
const claimsResult = await amazonService.fetchClaims(userId);
const claims = claimsResult.data || [];

if (claims.length > 0) {
  // Calculate totals from API claims
  const totalAmount = claims
    .filter(claim => claim.status === 'approved')
    .reduce((sum, claim) => sum + parseFloat(claim.amount), 0);
  
  return { totalAmount, claimCount: claims.length, source: 'api' };
}
```

### Step 3: Auto-Sync Trigger
```typescript
// If no claims found, trigger sync in background
syncJobManager.startSync(userId).then(() => {
  logger.info('Sync triggered from recoveries endpoint');
});

// Return zeros with message
return {
  totalAmount: 0.0,
  claimCount: 0,
  message: 'No data found. Syncing your Amazon account... Please refresh in a few moments.',
  needsSync: true,
  syncTriggered: true
};
```

---

## 🎯 What the Dashboard Will Show

### Scenario 1: User Has Synced Data
```json
{
  "totalAmount": 1250.50,
  "currency": "USD",
  "claimCount": 15,
  "source": "database",
  "message": "Found 15 claims from synced data"
}
```
**Dashboard shows**: $1,250.50 recovered from 15 claims ✅

### Scenario 2: User Has Not Synced, But SP-API Has Data
```json
{
  "totalAmount": 850.00,
  "currency": "USD",
  "claimCount": 8,
  "source": "api",
  "dataSource": "spapi_sandbox",
  "message": "Found 8 claims from API"
}
```
**Dashboard shows**: $850.00 recovered from 8 claims ✅

### Scenario 3: No Data Found (First Time User)
```json
{
  "totalAmount": 0.0,
  "currency": "USD",
  "claimCount": 0,
  "source": "none",
  "message": "No data found. Syncing your Amazon account... Please refresh in a few moments.",
  "needsSync": true,
  "syncTriggered": true
}
```
**Dashboard shows**: $0.00 recovered from 0 claims
**Message**: "Syncing your Amazon account... Please refresh in a few moments." ⏳

---

## 🔧 Recent Updates (Phase 2)

### Updated `/recoveries` Endpoint
- ✅ Now uses `userIdMiddleware` for user ID extraction
- ✅ Uses same user ID flow as `/claims` endpoint
- ✅ Python API forwards `X-User-Id` header

### Updated Python API
- ✅ Forwards `X-User-Id` header to Node.js backend
- ✅ Forwards `Authorization` header if present
- ✅ Maintains backward compatibility

---

## 🧪 Testing

### Test 1: Check Recoveries Endpoint
```bash
# With user ID header
curl -H "X-User-Id: test-user-123" \
     https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/recoveries
```

**Expected Response**:
```json
{
  "totalAmount": 0.0,
  "currency": "USD",
  "claimCount": 0,
  "source": "api",
  "dataSource": "spapi_sandbox",
  "message": "Found 0 claims from API"
}
```

### Test 2: Check Python API Recoveries
```bash
# With authenticated user (requires session token)
curl -H "Cookie: session_token=VALID_TOKEN" \
     https://python-api-2-jlx5.onrender.com/api/v1/integrations/amazon/recoveries
```

**Expected Response**:
```json
{
  "totalAmount": 0.0,
  "currency": "USD",
  "claimCount": 0,
  "source": "api",
  "dataSource": "spapi_sandbox",
  "message": "Found 0 claims from API",
  "responseTime": 0.63
}
```

---

## ✅ Summary

**Yes, claims will reflect on the dashboard!**

1. ✅ **Frontend calls** `/api/v1/integrations/amazon/recoveries`
2. ✅ **Python API forwards** user ID to Node.js backend
3. ✅ **Node.js fetches** real claims from SP-API
4. ✅ **Calculates totals** and returns summary
5. ✅ **Dashboard displays** totalAmount and claimCount

**The dashboard will show:**
- Real claim data from Amazon SP-API
- Total amount recovered (sum of approved claims)
- Claim count
- Auto-sync trigger if no data found

---

## 🚀 Next Steps

1. **Test with authenticated user** - Verify dashboard shows real claims
2. **Trigger sync** - If no data, sync will be triggered automatically
3. **Refresh dashboard** - After sync, refresh to see updated data
4. **Monitor logs** - Check observability logs for user ID and response times

---

## 📝 Notes

- **Sandbox mode**: Currently using sandbox SP-API (returns test data)
- **Database priority**: Database claims take priority over API (if synced)
- **Auto-sync**: If no data found, sync is triggered automatically in background
- **User-specific**: Each user sees their own claims (via user ID)

