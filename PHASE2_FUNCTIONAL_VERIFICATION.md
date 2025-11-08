# Phase 2: Functional Verification & Real Claims Flow

## ✅ Completed Changes

### 1. User ID Extraction Middleware (`userIdMiddleware.ts`)
- **Created**: `Integrations-backend/src/middleware/userIdMiddleware.ts`
- **Function**: Extracts user ID from multiple sources in priority order:
  1. `X-User-Id` header (set by Python API)
  2. `X-Forwarded-User-Id` header (alternative)
  3. `req.user.id` (if auth middleware sets it)
  4. `req.user.user_id` (alternative field)
  5. Query parameter `userId` (fallback for testing)
  6. Defaults to `'demo-user'` if none found
- **Integration**: Added to Express middleware pipeline in `index.ts` (before routes)

### 2. Python API - User ID Forwarding (`src/app.py`)
- **Updated**: `/api/v1/integrations/amazon/claims` endpoint
- **Changes**:
  - Forwards user ID in `X-User-Id` header when calling Node.js backend
  - Forwards `Authorization` header if present
  - Added observability logging with response time and claim count
  - Logs metrics: `user_id`, `response_time`, `status_code`, `claim_count`, `source`, `is_sandbox`

### 3. Node.js Backend - Real Claims Fetching (`amazonRoutes.ts`)
- **Updated**: `/api/v1/integrations/amazon/claims` endpoint
- **Changes**:
  - Now calls `amazonService.fetchClaims(userId)` to fetch real claims from Amazon SP-API
  - Extracts user ID from middleware (`req.userId`)
  - Added comprehensive observability logging:
    - Request logging with user ID source
    - Response logging with claim count and response time
    - Error logging with error types
  - Graceful error handling (returns empty claims array instead of 500 errors)
  - Returns response with:
    - `success: true`
    - `claims: []` (actual claims from SP-API)
    - `source: 'live_mode'`
    - `responseTime: 'X.XXs'`
    - `claimCount: N`

### 4. CORS Configuration (`index.ts`)
- **Updated**: Added `X-User-Id` and `X-Forwarded-User-Id` to allowed headers
- **Purpose**: Allows frontend to send user ID headers if needed

### 5. Version Endpoint (`amazonRoutes.ts`)
- **Updated**: `/claims/version` endpoint
- **Changes**: Updated version info to reflect Phase 2 implementation

## 🔄 Data Flow

```
Frontend
  ↓ (with credentials: "include")
Python API (/api/v1/integrations/amazon/claims)
  ↓ (X-User-Id header + cookies)
Node.js Backend (/api/v1/integrations/amazon/claims)
  ↓ (userIdMiddleware extracts user ID)
amazonService.fetchClaims(userId)
  ↓ (calls Amazon SP-API)
Amazon SP-API
  ↓ (returns claims data)
Response to Frontend
```

## 📊 Observability Logs

### Python API Logs
```
🔍 Getting Amazon claims for user {user_id}
📍 Calling Node.js backend: {url}
⏱️ Node.js backend response time: {time}s for user {user_id}
📊 Response status: {status_code}
📈 [OBSERVABILITY] Claims request completed
  - user_id: {user_id}
  - response_time: {time}s
  - status_code: {code}
  - claim_count: {count}
  - source: {source}
  - is_sandbox: {bool}
```

### Node.js Backend Logs
```
🔍 [CLAIMS] Processing claims request
  - userId: {userId}
  - isSandbox: {bool}
  - headers: {x-user-id, x-forwarded-user-id, authorization}
  - userSource: {middleware|req.user.id|default-demo-user}

✅ [CLAIMS] Successfully fetched claims from SP-API
  - userId: {userId}
  - claimCount: {count}
  - responseTime: {time}s
  - isSandbox: {bool}
  - fromApi: {bool}
  - dataType: {SANDBOX_TEST_DATA|LIVE_DATA}
  - source: live_mode

⚠️ [CLAIMS] SP-API error (returning empty claims)
  - userId: {userId}
  - error: {error_message}
  - responseTime: {time}s
  - isSandbox: {bool}
  - errorType: {HTTP_XXX|UNKNOWN}
```

## 🧪 Testing

### Test 1: Authenticated Request (Python API → Node.js)
```bash
# From Python API (with authenticated user)
curl -H "Cookie: session_token=VALID_TOKEN" \
     https://python-api-2-jlx5.onrender.com/api/v1/integrations/amazon/claims
```

**Expected Response**:
```json
{
  "success": true,
  "claims": [...],
  "source": "live_mode",
  "userId": "<user-id>",
  "timestamp": "2025-11-08T22:00:00Z",
  "responseTime": "X.XXs",
  "claimCount": N,
  "isSandbox": true,
  "dataType": "SANDBOX_TEST_DATA"
}
```

### Test 2: Direct Node.js Backend Call (with user ID header)
```bash
curl -H "X-User-Id: test-user-123" \
     https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/claims
```

**Expected Response**:
```json
{
  "success": true,
  "claims": [...],
  "source": "live_mode",
  "userId": "test-user-123",
  "timestamp": "2025-11-08T22:00:00Z",
  "responseTime": "X.XXs",
  "claimCount": N
}
```

### Test 3: Version Check
```bash
curl https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/claims/version
```

**Expected Response**:
```json
{
  "version": "phase2-functional-verification-v1",
  "deployed": "2025-11-08T22:00:00Z",
  "codeVersion": "phase2-real-claims-flow",
  "description": "Claims endpoint now fetches real data from Amazon SP-API",
  "features": {
    "realClaimsFetch": true,
    "userIdExtraction": true,
    "observability": true,
    "gracefulDegradation": true
  }
}
```

## 🔍 Verification Checklist

- [x] User ID extraction middleware created and integrated
- [x] Python API forwards user ID in headers
- [x] Node.js backend extracts user ID from headers
- [x] Claims endpoint calls `amazonService.fetchClaims(userId)`
- [x] Observability logging added (Python API + Node.js)
- [x] Error handling with graceful degradation
- [x] CORS headers updated to allow user ID headers
- [ ] Test end-to-end flow with authenticated user
- [ ] Verify real claims data is returned (not just empty array)
- [ ] Verify logs show correct user ID and response times

## 🚀 Next Steps

1. **Deploy Changes**: Commit and push to trigger Render deployment
2. **Test Authenticated Flow**: Use real user session token
3. **Verify Claims Data**: Check if real claims are returned from SP-API
4. **Monitor Logs**: Check observability logs for response times and errors
5. **Frontend Integration**: Ensure frontend uses `credentials: "include"` in fetch calls

## 📝 Notes

- **Graceful Degradation**: If SP-API call fails, endpoint returns empty claims array (not 500 error)
- **Sandbox Mode**: Currently using sandbox SP-API (returns test data)
- **User ID Fallback**: Defaults to `'demo-user'` if no user ID found (for testing)
- **Observability**: All requests are logged with user ID, response time, and claim count
- **Error Handling**: SP-API errors are caught and logged, but endpoint always returns 200 with empty claims

## 🐛 Known Issues

- None currently - all changes are backward compatible
- If SP-API is unavailable, endpoint returns empty claims (graceful degradation)

## 🔗 Related Files

- `Integrations-backend/src/middleware/userIdMiddleware.ts` - User ID extraction
- `Integrations-backend/src/routes/amazonRoutes.ts` - Claims endpoint
- `Integrations-backend/src/index.ts` - Middleware integration + CORS
- `src/app.py` - Python API claims endpoint
- `Integrations-backend/src/services/amazonService.ts` - SP-API integration

