# 🔍 Backend Error Logging Improvements

## Summary

Enhanced error logging in the `/api/v1/integrations/amazon/recoveries` endpoint to provide detailed diagnostics for SP-API integration issues.

## What Was Added

### 1. **Detailed Request Logging**
- Logs the exact URL being called
- Logs the `INTEGRATIONS_URL` configuration
- Logs user ID for debugging

### 2. **Response Time Tracking**
- Measures and logs response time for Node.js backend calls
- Helps identify timeout issues
- Includes response time in successful responses

### 3. **Status Code-Specific Error Handling**
- **401 Unauthorized**: Logs auth errors with response body
- **404 Not Found**: Logs endpoint not found errors
- **500+ Server Errors**: Logs server-side errors
- **200 Success**: Logs response data structure and claim count

### 4. **Exception-Specific Error Messages**
- **TimeoutException**: Clear timeout errors with elapsed time
- **RequestError**: Network connectivity errors with URL details
- **Unexpected Errors**: Full stack traces for debugging

### 5. **Enhanced Fallback Logging**
- Logs when falling back to refund engine
- Logs refund engine results (success or failure)
- Logs possible reasons when no data is found

### 6. **Structured Error Responses**
- Includes `source` field to identify data source (nodejs_backend, refund_engine, fallback, error)
- Includes `diagnostics` field with URLs and user ID for debugging
- Includes `responseTime` in successful responses

## Error Log Examples

### Backend Timeout
```
⏱️ BACKEND TIMEOUT: Node.js backend took longer than 30 seconds (elapsed: 32.45s)
🔗 URL: http://localhost:3001/api/v1/integrations/amazon/claims
❌ Timeout error: ...
```

### Network Error
```
🌐 NETWORK ERROR: Cannot reach Node.js backend
🔗 URL: http://localhost:3001/api/v1/integrations/amazon/claims
⏱️ Elapsed time: 5.23s
❌ Request error: ...
📋 Error type: ConnectError
```

### Auth Error
```
🔒 AUTH ERROR: Node.js backend returned 401 Unauthorized
📄 Response body: {"error": "Unauthorized", ...}
```

### Not Found
```
📍 NOT FOUND: Node.js backend endpoint http://localhost:3001/api/v1/integrations/amazon/claims returned 404
📄 Response body: {"error": "Not found", ...}
```

### Success
```
✅ Got 5 claims from Node.js backend, total approved amount: $1234.56
⏱️ Node.js backend response time: 2.34s
📊 Response status: 200
```

## What to Check in Logs

When diagnosing SP-API issues, check the backend logs for:

1. **URL being called**: Should match your `INTEGRATIONS_URL` environment variable
2. **Response time**: If > 3 seconds, frontend timeout may occur
3. **Status code**: 
   - 401 = Authentication issue
   - 404 = Endpoint not found
   - 500+ = Server error
   - 200 = Success (but may have empty data)
4. **Error type**: Helps identify if it's network, timeout, or server error
5. **Response body**: First 500 chars of error response for details

## Next Steps

1. **Deploy the backend** with these logging improvements
2. **Trigger the recovery modal** in the frontend
3. **Check backend logs** (Render/Heroku logs) for the detailed error messages
4. **Share the logs** to identify the exact issue

## Common Issues and Solutions

### Issue: Backend Timeout
**Log shows**: `⏱️ BACKEND TIMEOUT`
**Solution**: 
- Node.js backend is taking > 30 seconds
- Check if Node.js backend is running
- Check if SP-API is slow or rate-limited
- Consider increasing timeout or optimizing SP-API calls

### Issue: Network Error
**Log shows**: `🌐 NETWORK ERROR`
**Solution**:
- Python backend cannot reach Node.js backend
- Check `INTEGRATIONS_URL` environment variable
- Check if Node.js backend is running and accessible
- Check network/firewall configuration

### Issue: Auth Error
**Log shows**: `🔒 AUTH ERROR: 401`
**Solution**:
- Node.js backend requires authentication
- Check if cookies are being forwarded correctly
- May need to pass user ID in headers or query params

### Issue: Not Found
**Log shows**: `📍 NOT FOUND: 404`
**Solution**:
- Node.js backend endpoint doesn't exist
- Check if route is registered: `/api/v1/integrations/amazon/claims`
- Check Node.js backend routing configuration

### Issue: Empty Data
**Log shows**: `⚠️ No claims returned from Node.js backend`
**Solution**:
- Node.js backend returned 200 but no claims
- User may need to sync data first
- Check if SP-API has data for the user
- Check date range in SP-API query

## Response Format

The endpoint now returns structured responses with diagnostic information:

```json
{
  "totalAmount": 0.0,
  "currency": "USD",
  "claimCount": 0,
  "source": "nodejs_backend|refund_engine|fallback|error",
  "responseTime": 2.34,
  "message": "No data found. Please sync your Amazon account first.",
  "diagnostics": {
    "integrationsUrl": "http://localhost:3001",
    "claimsUrl": "http://localhost:3001/api/v1/integrations/amazon/claims",
    "userId": "user-123"
  }
}
```

The `source` field helps identify where the data came from (or why it failed), and `diagnostics` provides URLs and user ID for debugging.

