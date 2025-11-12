# Phase 2 Sandbox Verification - Quick Start Guide

## 🎯 Objective

Verify that the current sync implementation works correctly in sandbox environment before implementing missing components (Orders, Shipments, Returns, Settlements).

---

## 🚀 Quick Start

### Option 1: PowerShell Script (Windows)

```powershell
# Set environment variables
$env:AMAZON_SPAPI_BASE_URL = "https://sandbox.sellingpartnerapi-na.amazon.com"
$env:NODE_ENV = "development"
$env:AMAZON_SPAPI_REFRESH_TOKEN = "your-sandbox-refresh-token"
$env:AMAZON_CLIENT_ID = "your-client-id"
$env:AMAZON_CLIENT_SECRET = "your-client-secret"

# Run verification
powershell -ExecutionPolicy Bypass -File scripts/phase2-sandbox-verification.ps1 `
    -UserId "sandbox-user" `
    -ApiUrl "http://localhost:8000" `
    -Verbose
```

### Option 2: Node.js Script (Cross-platform)

```bash
# Set environment variables
export AMAZON_SPAPI_BASE_URL="https://sandbox.sellingpartnerapi-na.amazon.com"
export NODE_ENV="development"
export AMAZON_SPAPI_REFRESH_TOKEN="your-sandbox-refresh-token"
export AMAZON_CLIENT_ID="your-client-id"
export AMAZON_CLIENT_SECRET="your-client-secret"
export API_URL="http://localhost:8000"
export INTEGRATIONS_API_URL="http://localhost:3000"

# Run verification
node scripts/phase2-sandbox-verification-node.js
```

---

## 📋 What Gets Verified

### 1. Sandbox Mode Detection
- ✅ Confirms sandbox environment is active
- ✅ Verifies environment variables

### 2. Sync Job Execution
- ✅ Triggers sync job via API
- ✅ Monitors sync progress
- ✅ Logs start/end times

### 3. Data Pull Verification
- ✅ **Inventory**: Verifies FBA inventory summaries are pulled
- ✅ **Claims**: Verifies reimbursements are pulled
- ✅ **Fees**: Verifies fee data is pulled
- ✅ **Financial Events**: Verifies financial events ingestion

### 4. Error Handling
- ✅ Tests empty response handling
- ✅ Tests missing fields handling
- ✅ Tests API error handling
- ✅ Ensures no crashes occur

### 5. Data Normalization
- ✅ Verifies inventory data structure (sku, asin, quantity, location)
- ✅ Verifies claims data structure (id, amount, status, type)
- ✅ Checks for missing required fields

### 6. Data Storage
- ✅ Confirms data is stored in database
- ✅ Verifies partial data support
- ✅ Checks database integrity

### 7. Report Generation
- ✅ Generates comprehensive verification report
- ✅ Includes all statistics and findings
- ✅ Provides recommendations

---

## 📊 Expected Results

### In Sandbox:
- **Inventory**: May be empty (normal for sandbox)
- **Claims**: May be empty (normal for sandbox)
- **Fees**: May be empty (normal for sandbox)
- **Errors**: Should be handled gracefully
- **Crashes**: Should not occur

### Success Criteria:
- ✅ Sync job completes without errors
- ✅ Empty responses are handled gracefully
- ✅ Data structure is verified (even if empty)
- ✅ No unhandled exceptions
- ✅ Report is generated successfully

---

## 📁 Output Files

### 1. Verification Report
**Location**: `PHASE2_SANDBOX_SYNC_VERIFICATION.md`

**Contains**:
- Executive summary
- Sync job execution details
- Data pull verification results
- Error handling verification
- Data normalization verification
- Summary statistics
- Recommendations

### 2. Log Files
**Location**: `logs/phase2-sandbox-verification-YYYYMMDD-HHMMSS.log`

**Contains**:
- Timestamped log entries
- API calls made
- Data retrieved
- Errors encountered
- Warnings

---

## 🔍 Verification Checklist

After running the verification, check:

- [ ] Sandbox mode is confirmed
- [ ] Sync job triggered successfully
- [ ] No crashes or unhandled exceptions
- [ ] Empty responses handled gracefully
- [ ] Data structure verified (even if empty)
- [ ] Report generated successfully
- [ ] System is stable
- [ ] Ready for missing components implementation

---

## ⚠️ Important Notes

1. **Sandbox Limitations**:
   - Sandbox may return empty or limited data
   - This is **normal** and expected
   - System should handle empty responses gracefully

2. **No Production Data**:
   - Verification runs entirely in sandbox
   - No production data is accessed or modified
   - Safe to run multiple times

3. **Repeatable**:
   - Script can be run multiple times
   - Each run generates a new report
   - Logs are timestamped

---

## 🐛 Troubleshooting

### Issue: Sync job fails
**Solution**: Check that:
- API server is running
- Environment variables are set correctly
- Sandbox credentials are valid

### Issue: No data retrieved
**Solution**: This is normal for sandbox. Verify:
- Empty responses are handled gracefully
- No errors are thrown
- System continues to work

### Issue: Script crashes
**Solution**: Check:
- Node.js/PowerShell version compatibility
- All dependencies are installed
- Log files for error details

---

## 📈 Next Steps After Verification

Once verification passes:

1. ✅ **Current sync works** - Inventory, Claims, Fees
2. ⏭️ **Implement missing components**:
   - Orders API integration
   - Shipments data sync
   - Returns data sync
   - Settlements data sync
   - FBA Reports integration
3. ⏭️ **Add continuous background sync**
4. ⏭️ **Enhance normalization layer**

---

## 📞 Support

If you encounter issues:
1. Check log files for detailed error messages
2. Verify environment variables are set correctly
3. Ensure API servers are running
4. Review verification report for specific issues

---

**Last Updated**: November 12, 2025  
**Status**: ✅ Ready for Use

