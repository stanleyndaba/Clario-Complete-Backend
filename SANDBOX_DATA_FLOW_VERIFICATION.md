# Sandbox Data Flow Verification Guide

## ✅ Fixed: Recoveries Endpoint Now Checks Database First

### The Problem:
- **Recoveries endpoint** was calling the API directly
- **Sync saves data to database**, but recoveries wasn't checking it
- **Dashboard showed zeros** even if sync had data in database

### The Solution:
**Updated recoveries endpoint to:**
1. ✅ **Check database FIRST** (where sync saves data)
2. ✅ **Fall back to API** if no database data
3. ✅ **Clear logging** showing data source (database vs API)
4. ✅ **Better error handling** and data source indicators

---

## 🔄 Complete Data Flow

### Flow Diagram:
```
1. User Connects Amazon
   ↓
2. Sync Triggers Automatically
   ↓
3. Sync Fetches from Sandbox API
   ↓
4. Sync Saves to Database
   ↓
5. Recoveries Endpoint Checks Database ✅ (NEW!)
   ↓
6. Dashboard Shows Data
```

---

## 🧪 How to Test & Verify

### Method 1: PowerShell Script (Easiest)
```powershell
# Run the verification script
.\verify-sandbox-data.ps1
```

**What it tests:**
- ✅ Connection (bypass)
- ✅ Recoveries endpoint
- ✅ Diagnostics
- ✅ Shows data source

### Method 2: Manual curl Tests
```bash
# 1. Test recoveries endpoint
curl http://localhost:3001/api/v1/integrations/amazon/recoveries

# 2. Check response - look for:
#    - "source": "database" or "api"
#    - "claimCount": number
#    - "totalAmount": number
#    - "dataSource": "synced_from_spapi_sandbox"
```

### Method 3: Check Server Logs
Look for these log messages:

#### ✅ Success Indicators:
```
✅ "Checking database for synced claims"
✅ "Found X claims in DATABASE, total approved: $X"
✅ "source: database"
```

#### ⚠️ Fallback Indicators:
```
⚠️ "No claims found in database"
⚠️ "No database claims found - attempting to fetch from SP-API"
⚠️ "Found X claims from API"
```

#### 📊 Sandbox Indicators:
```
📊 "Fetching claims from SP-API SANDBOX"
📊 "SANDBOX_TEST_DATA"
📊 "Sandbox returned empty data - this is normal for testing"
```

---

## 🔍 What to Look For

### In Recoveries Response:
```json
{
  "totalAmount": 123.45,
  "currency": "USD",
  "claimCount": 5,
  "source": "database",  // ← Shows where data came from
  "dataSource": "synced_from_spapi_sandbox",
  "message": "Found 5 claims from synced data"
}
```

### Data Source Values:
- **`"source": "database"`** → Data from synced database ✅
- **`"source": "api"`** → Data from direct API call
- **`"dataSource": "synced_from_spapi_sandbox"`** → Confirmed sandbox data

---

## 📊 Expected Behavior

### Scenario 1: Sync Has Run (Data in Database)
**Response:**
```json
{
  "totalAmount": 123.45,
  "claimCount": 5,
  "source": "database",
  "dataSource": "synced_from_spapi_sandbox"
}
```
**Logs:**
```
info: Checking database for synced claims
info: Found 5 claims in DATABASE, total approved: $123.45
```

### Scenario 2: No Database Data, API Has Data
**Response:**
```json
{
  "totalAmount": 67.89,
  "claimCount": 3,
  "source": "api",
  "dataSource": "spapi_sandbox"
}
```
**Logs:**
```
info: No claims found in database
info: No database claims found - attempting to fetch from SP-API
info: Found 3 claims from API, total approved: $67.89
```

### Scenario 3: No Data (Sandbox Empty)
**Response:**
```json
{
  "totalAmount": 0,
  "claimCount": 0,
  "message": "No data found. Syncing your Amazon account...",
  "needsSync": true,
  "syncTriggered": true
}
```
**Logs:**
```
info: No claims found in database
info: No claims found in API response
info: Sandbox returned empty data - this is normal for testing
```

---

## 🛠️ Troubleshooting

### Issue: Dashboard Shows Zeros

#### Check 1: Has Sync Run?
```bash
# Check sync status
curl http://localhost:3001/api/sync/status/{syncId}

# Or check sync history
curl http://localhost:3001/api/sync/history
```

#### Check 2: Database Has Data?
**Look in logs for:**
```
info: Amazon claims saved to database successfully
info: inserted: X
```

#### Check 3: Recoveries Querying Database?
**Look in logs for:**
```
info: Checking database for synced claims
info: Found X claims in DATABASE
```

### Issue: Data Not Appearing

#### Solution 1: Wait for Sync
- Sync runs in background
- Wait 1-2 minutes after connection
- Check sync status endpoint

#### Solution 2: Trigger Sync Manually
```bash
curl -X POST http://localhost:3001/api/sync/start
```

#### Solution 3: Check Database Directly
- If you have database access, query `claims` table
- Filter by `user_id` and `provider = 'amazon'`

---

## 📝 Log Messages to Monitor

### Database Query:
```
info: Checking database for synced claims { userId: '...' }
info: Found X claims in DATABASE, total approved: $X
```

### API Fallback:
```
info: No database claims found - attempting to fetch from SP-API
info: Fetching claims from SP-API SANDBOX
info: Found X claims from API
```

### Sync Process:
```
info: Fetching claims from SP-API SANDBOX (test data only)
info: Amazon claims saved to database successfully
info: inserted: X
```

### Sandbox Indicators:
```
info: Amazon SP-API initialized in SANDBOX mode
info: SANDBOX_TEST_DATA
info: Sandbox returned empty data - this is normal for testing
```

---

## ✅ Verification Checklist

### Before Testing:
- [x] Server is running
- [x] Sandbox credentials configured
- [x] Database connection working (or demo mode)

### During Testing:
- [ ] Connect Amazon (bypass)
- [ ] Check logs for sync trigger
- [ ] Wait for sync to complete
- [ ] Check recoveries endpoint
- [ ] Verify data source in response
- [ ] Check dashboard shows data

### After Testing:
- [ ] Verify logs show database query
- [ ] Confirm data source is "database"
- [ ] Check sync saved data to database
- [ ] Verify dashboard displays data

---

## 🎯 Key Points

1. **Database First**: Recoveries now checks database before API
2. **Clear Logging**: All logs show data source
3. **Sandbox Only**: All data comes from sandbox (test data)
4. **Graceful Fallback**: Falls back to API if no database data
5. **Empty Data Normal**: Sandbox may return empty (expected)

---

## 🚀 Next Steps

1. **Deploy Changes**: Push to production
2. **Test Connection**: Connect Amazon account
3. **Monitor Logs**: Watch for sync and database queries
4. **Verify Dashboard**: Check if data appears
5. **Check Database**: Verify data is stored (if accessible)

---

## 📊 Summary

**Fixed:**
- ✅ Recoveries endpoint now checks database first
- ✅ Clear logging shows data source
- ✅ Better error handling
- ✅ Test scripts created

**How to Verify:**
1. Run `verify-sandbox-data.ps1`
2. Check server logs
3. Verify recoveries response shows data source
4. Confirm dashboard displays data

**Expected Results:**
- Database has data → Shows in recoveries ✅
- API has data → Falls back to API ✅
- No data → Returns zeros (normal for sandbox) ✅

