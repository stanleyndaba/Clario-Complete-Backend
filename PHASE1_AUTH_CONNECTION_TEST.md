# Phase 1-2: Amazon SP-API Auth Connection Test

## 🎯 Objective

**Test that Clario can connect with Amazon SP-API (sandbox) seamlessly in less than 15 seconds.**

This test focuses **strictly on Auth** (Phase 1-2, Auth only). We are testing:
- ✅ Can Clario successfully connect to Amazon SP-API sandbox?
- ✅ Does the connection complete in under 15 seconds?
- ✅ Is the connection seamless (no manual intervention required)?

## 📋 What We're Testing

### Test Components

1. **Environment Check**
   - Verify all required credentials are present
   - Check for `AMAZON_CLIENT_ID` or `AMAZON_SPAPI_CLIENT_ID`
   - Check for `AMAZON_CLIENT_SECRET` or `AMAZON_SPAPI_CLIENT_SECRET`
   - Check for `AMAZON_SPAPI_REFRESH_TOKEN`
   - Verify sandbox mode is configured

2. **OAuth Start (Bypass Flow)**
   - Test `GET /api/v1/integrations/amazon/auth/start?bypass=true`
   - Verify bypass flow works (uses existing refresh token)
   - Measure response time

3. **Token Refresh + SP-API Access (Core Auth Test)**
   - Test `GET /api/v1/integrations/amazon/diagnose`
   - This endpoint tests:
     - Token refresh (getting access token from refresh token)
     - SP-API endpoint access (calling Sellers API)
   - **This is the critical test** - proves auth is working
   - Measure total time (must be < 15 seconds)

4. **Direct SP-API Call (Verification)**
   - Test `GET /api/v1/integrations/amazon/recoveries`
   - Verify we can actually call SP-API endpoints
   - Measure response time

## 🚀 Running the Test

### Prerequisites

1. **Environment Variables Set:**
   ```bash
   AMAZON_CLIENT_ID=amzn1.application-oa2-client.xxx
   AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.xxx
   AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGxxx
   AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
   ```

2. **Integrations Backend Running:**
   - Default: `http://localhost:3001`
   - Or set `$IntegrationsApiUrl` parameter

### Run the Test

```powershell
# Local testing
.\test-amazon-auth-connection-speed.ps1

# With custom URL
.\test-amazon-auth-connection-speed.ps1 -IntegrationsApiUrl "https://your-integrations-api.onrender.com"

# Verbose output
.\test-amazon-auth-connection-speed.ps1 -Verbose
```

## ✅ Success Criteria

The test **PASSES** if:

1. ✅ **All credentials present** - Environment variables are set
2. ✅ **OAuth start works** - Bypass flow returns success
3. ✅ **Token refresh works** - Can get access token from refresh token
4. ✅ **SP-API access works** - Can call Amazon SP-API endpoints
5. ✅ **Total time < 15 seconds** - Connection completes quickly

## 📊 Expected Output

### Successful Test Output

```
========================================
PHASE 1-2: AMAZON AUTH CONNECTION TEST
========================================

[PASS] ✅ All required credentials present
[PASS] ✅ OAuth start endpoint accessible
[PASS] ✅ Token refresh + API access working!
[PASS] ✅ Recoveries endpoint accessible

========================================
TEST SUMMARY
========================================

⏱️  TIMING RESULTS:
  Total Test Time: 8.45 seconds
  Target: < 15 seconds
  Status: ✅ PASSED

🔐 AUTH TEST RESULTS:
  ✅ Token Refresh: WORKING
  ✅ SP-API Access: WORKING
  ✅ Connection: ESTABLISHED

🎯 PHASE 1-2 AUTH TEST RESULT:
  ✅ SUCCESS!
  ✅ Clario can connect with Amazon SP-API (sandbox) seamlessly
  ✅ Connection time: 8.45s (< 15s target)
  ✅ Ready to stabilize and lock in
```

### Failed Test Output

```
❌ FAILED
  ❌ Connection took 18.23s (exceeds 15s target)
  OR
  ❌ Auth connection not working
```

## 🔍 What the Test Measures

### Timing Breakdown

1. **OAuth Start**: ~0.5-1s (just returns bypass response)
2. **Token Refresh**: ~2-5s (calls Amazon OAuth endpoint)
3. **SP-API Call**: ~2-5s (calls Amazon SP-API Sellers endpoint)
4. **Total**: Should be < 15 seconds

### Key Metrics

- **Total Connection Time**: From start to successful SP-API call
- **Token Refresh Time**: Time to get access token
- **SP-API Response Time**: Time for SP-API to respond
- **Overall Success**: All steps complete + under 15s

## 🐛 Troubleshooting

### Issue: Test takes > 15 seconds

**Possible Causes:**
- Network latency
- Amazon API slow response
- Token refresh taking too long

**Solutions:**
- Check network connectivity
- Verify Amazon SP-API status
- Check backend logs for slow queries

### Issue: Token refresh fails

**Possible Causes:**
- Invalid refresh token
- Expired refresh token
- Wrong client ID/secret

**Solutions:**
- Verify `AMAZON_SPAPI_REFRESH_TOKEN` is valid
- Check token hasn't expired
- Verify client credentials match

### Issue: SP-API endpoint fails

**Possible Causes:**
- Invalid access token
- Wrong base URL
- Network issues

**Solutions:**
- Verify `AMAZON_SPAPI_BASE_URL` is correct
- Check access token is valid
- Verify network connectivity

## 📝 Current State

### What's Working

- ✅ Bypass flow (using existing refresh token)
- ✅ Token refresh mechanism
- ✅ SP-API endpoint access
- ✅ Diagnostic endpoint

### What Needs Stabilization

- ⚠️ Connection time optimization (ensure < 15s consistently)
- ⚠️ Error handling and retry logic
- ⚠️ Edge case handling
- ⚠️ Production readiness

## 🎯 Next Steps After Test Passes

Once the test passes (< 15 seconds), we will:

1. **Stabilize the Connection**
   - Add retry logic for transient failures
   - Implement connection pooling
   - Add timeout handling
   - Optimize token caching

2. **Lock In the Flow**
   - Document the exact flow
   - Add monitoring and alerting
   - Create runbooks
   - Add automated health checks

3. **Production Readiness**
   - Test with production credentials
   - Load testing
   - Error recovery testing
   - Performance optimization

## 📚 Related Files

- `test-amazon-auth-connection-speed.ps1` - Test script
- `Integrations-backend/src/services/amazonService.ts` - Amazon service
- `Integrations-backend/src/controllers/amazonController.ts` - Auth controllers
- `Integrations-backend/src/utils/sandboxDiagnostics.ts` - Diagnostics

## 🔗 API Endpoints Used

1. `GET /api/v1/integrations/amazon/auth/start?bypass=true` - OAuth start (bypass)
2. `GET /api/v1/integrations/amazon/diagnose` - Full auth diagnostics
3. `GET /api/v1/integrations/amazon/claims` - Test SP-API access
4. `GET /api/v1/integrations/amazon/recoveries` - Test SP-API data fetch

## 📊 Test Results Format

The test outputs:
- ✅/❌ status for each test component
- Timing breakdown for each step
- Overall pass/fail with timing
- Next steps based on results

---

**Remember**: This is **Auth only** testing. We're not testing sync, claims, or any other functionality. Just: **Can we connect to Amazon SP-API sandbox in < 15 seconds?**

