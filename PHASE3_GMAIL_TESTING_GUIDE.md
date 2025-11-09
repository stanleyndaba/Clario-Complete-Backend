# Phase 3: Gmail Integration Testing Guide

## 🎯 Overview

Phase 3 covers Gmail integration, evidence ingestion, and document parsing. This guide explains how to test Gmail OAuth flow and evidence ingestion **without requiring a full OAuth login** for initial verification.

## 🧩 Understanding Gmail OAuth Flow

### Why Gmail Requires Real Login (Unlike Amazon)

| Integration | Mode | OAuth Type | Expected Behavior |
|-------------|------|------------|-------------------|
| Amazon (SP-API) | Sandbox | Simulated OAuth | "Use Existing Connection" bypasses login |
| Gmail (Google API) | Live | Real OAuth 2.0 | Must sign in with a real Gmail account |

**Key Difference:**
- **Amazon SP-API** has a sandbox mode that allows testing without OAuth
- **Google Gmail API** does NOT have a sandbox mode - it requires real OAuth 2.0

### Gmail OAuth Flow

When you click "Connect Gmail", here's what happens:

1. **Frontend:** Opens OAuth URL
   ```
   https://accounts.google.com/o/oauth2/v2/auth
   ?client_id=YOUR_CLIENT_ID
   &redirect_uri=https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/callback
   &scope=https://www.googleapis.com/auth/gmail.readonly
   &response_type=code
   &access_type=offline
   &prompt=consent
   ```

2. **Google:** Shows login page → user chooses a Gmail account

3. **After Login:** Google redirects back to callback with a code

4. **Backend:** Exchanges code for `access_token` and `refresh_token`

5. **System:** Saves tokens in DB → Gmail connection established

## 🧪 Testing Gmail Integration Without Full Login

### What Can Be Tested Without Login?

✅ **Testable Without Login:**
- OAuth URL generation
- Connection status endpoint
- Integration status endpoint
- Evidence ingestion endpoint structure
- Error handling for unconnected Gmail

❌ **Requires Login:**
- Complete OAuth flow
- Token exchange
- Evidence ingestion (needs connected Gmail)
- Document parsing (needs ingested documents)

### Test 1: OAuth URL Generation ✅

**Endpoint:** `GET /api/v1/integrations/gmail/connect`

**Test:**
```bash
curl -X GET "https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/connect" \
  -H "X-User-Id: test-user-phase3"
```

**Expected Response:**
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&scope=...",
  "sandbox": false,
  "message": "Gmail OAuth flow initiated"
}
```

**What to Verify:**
- ✅ OAuth URL is generated
- ✅ URL contains `client_id`, `redirect_uri`, `scope`
- ✅ URL points to `accounts.google.com`
- ✅ `scope` includes `gmail.readonly`

**Conclusion:** OAuth URL generation can be tested without login.

---

### Test 2: Connection Status ✅

**Endpoint:** `GET /api/v1/integrations/gmail/status`

**Test:**
```bash
curl -X GET "https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/status" \
  -H "X-User-Id: test-user-phase3"
```

**Expected Response (Not Connected):**
```json
{
  "connected": false,
  "email": null,
  "lastSync": null,
  "scopes": []
}
```

**Expected Response (Connected):**
```json
{
  "connected": true,
  "email": "user@gmail.com",
  "lastSync": "2025-11-09T...",
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"]
}
```

**What to Verify:**
- ✅ Endpoint is accessible
- ✅ Returns connection status
- ✅ Returns `connected: false` if not connected (expected)
- ✅ Returns `connected: true` after OAuth completion

**Conclusion:** Connection status can be tested without login (will show `connected: false`).

---

### Test 3: Integration Status ✅

**Endpoint:** `GET /api/v1/integrations/status`

**Test:**
```bash
curl -X GET "https://opside-node-api-woco.onrender.com/api/v1/integrations/status" \
  -H "X-User-Id: test-user-phase3"
```

**Expected Response:**
```json
{
  "amazon_connected": true,
  "docs_connected": false,
  "providerIngest": {
    "gmail": {
      "connected": false,
      "lastIngest": null
    }
  }
}
```

**What to Verify:**
- ✅ Endpoint is accessible
- ✅ Gmail provider status is included
- ✅ Returns `connected: false` if not connected (expected)
- ✅ Returns `connected: true` after OAuth completion

**Conclusion:** Integration status can be tested without login.

---

### Test 4: Evidence Ingestion Endpoint ✅

**Endpoint:** `POST /api/evidence/ingest/gmail`

**Test:**
```bash
curl -X POST "https://opside-node-api-woco.onrender.com/api/evidence/ingest/gmail" \
  -H "X-User-Id: test-user-phase3" \
  -H "Content-Type: application/json" \
  -d '{"userId": "test-user-phase3", "limit": 10}'
```

**Expected Response (Not Connected):**
```json
{
  "success": false,
  "error": "Gmail not connected",
  "message": "Please connect Gmail first"
}
```

**Expected Response (Connected):**
```json
{
  "success": true,
  "message": "Evidence ingestion started",
  "jobId": "ingest-gmail-..."
}
```

**What to Verify:**
- ✅ Endpoint is accessible
- ✅ Returns error if Gmail not connected (expected)
- ✅ Returns success after Gmail is connected
- ✅ Error handling is working correctly

**Conclusion:** Evidence ingestion endpoint can be tested without login (will return error if not connected).

---

## 🔐 Testing Gmail OAuth with Real Login

### Option 1: Use Your Own Gmail Account (Recommended for Dev)

**Steps:**
1. Click "Connect Gmail" button
2. Log in with your personal Gmail account
3. Grant permission to the app
4. You'll be redirected back → backend stores tokens
5. Check integration status to verify connection

**Safety:**
- ✅ This is **read-only** access (`gmail.readonly` scope)
- ✅ No emails are sent or altered
- ✅ Only allows reading emails and attachments
- ✅ You can revoke access at any time in Google Account settings

**Testing:**
- ✅ Verify Gmail connection status
- ✅ Test evidence ingestion
- ✅ Test document parsing
- ✅ Verify evidence appears in dashboard

---

### Option 2: Use Test Gmail Account

**Steps:**
1. Create a test Gmail account
2. Use it for OAuth testing
3. Test evidence ingestion with test account
4. Verify all functionality works

**Benefits:**
- ✅ Isolated testing environment
- ✅ No impact on personal Gmail
- ✅ Can test with known test data

---

## 🧪 Automated Testing Script

### Run Phase 3 Test Script

```powershell
.\test-phase3-gmail-integration.ps1 -NodeApiUrl "https://opside-node-api-woco.onrender.com" -TestUserId "test-user-phase3"
```

**What It Tests:**
1. ✅ Gmail OAuth URL generation
2. ✅ Gmail connection status
3. ✅ Integration status (Gmail provider)
4. ✅ Evidence ingestion endpoint
5. ✅ Evidence status endpoint
6. ✅ Gmail disconnect endpoint

**Expected Results (Without Login):**
- ✅ OAuth URL generation: **PASS**
- ✅ Connection status: **PASS** (shows `connected: false`)
- ✅ Integration status: **PASS** (shows `gmail.connected: false`)
- ✅ Evidence ingestion: **WARN** (returns error if not connected)
- ✅ Evidence status: **PASS** (endpoint accessible)

---

## 📋 Test Scenarios

### Scenario 1: Test OAuth URL Generation

**Goal:** Verify OAuth URL is generated correctly

**Steps:**
1. Call `GET /api/v1/integrations/gmail/connect`
2. Verify OAuth URL is returned
3. Check URL contains required parameters
4. Verify URL points to Google OAuth

**Expected:** OAuth URL generated successfully

---

### Scenario 2: Test Connection Status (Not Connected)

**Goal:** Verify connection status endpoint works when Gmail is not connected

**Steps:**
1. Call `GET /api/v1/integrations/gmail/status`
2. Verify endpoint returns `connected: false`
3. Verify error handling is correct

**Expected:** Returns `connected: false` with appropriate message

---

### Scenario 3: Test OAuth Flow (With Login)

**Goal:** Complete OAuth flow and verify connection

**Steps:**
1. Get OAuth URL from endpoint
2. Open URL in browser
3. Log in with Gmail account
4. Grant permission
5. Verify redirect to callback
6. Check connection status
7. Verify `connected: true`

**Expected:** Gmail connection established successfully

---

### Scenario 4: Test Evidence Ingestion (After Connection)

**Goal:** Test evidence ingestion after Gmail is connected

**Steps:**
1. Ensure Gmail is connected
2. Call `POST /api/evidence/ingest/gmail`
3. Verify ingestion starts successfully
4. Check evidence status
5. Verify documents are ingested

**Expected:** Evidence ingestion works correctly

---

## ✅ Success Criteria

### Without Login (Endpoint Testing)

| Test | Goal | Status |
|------|------|--------|
| OAuth URL Generation | ✅ | Generate OAuth URL |
| Connection Status | ✅ | Return connection status |
| Integration Status | ✅ | Include Gmail provider status |
| Evidence Ingestion | ✅ | Return error if not connected |
| Error Handling | ✅ | Handle unconnected state gracefully |

### With Login (Full OAuth Flow)

| Test | Goal | Status |
|------|------|--------|
| OAuth Flow | ✅ | Complete OAuth flow |
| Token Storage | ✅ | Store tokens in database |
| Connection Status | ✅ | Return `connected: true` |
| Evidence Ingestion | ✅ | Ingest emails and attachments |
| Document Parsing | ✅ | Parse ingested documents |
| Dashboard Integration | ✅ | Show evidence in dashboard |

---

## 🎯 Key Insights

### 1. OAuth URL Generation ✅

**Finding:** OAuth URL generation works without login.

**Evidence:**
- Endpoint returns OAuth URL
- URL contains all required parameters
- URL points to Google OAuth

**Conclusion:** OAuth URL generation can be tested independently.

---

### 2. Connection Status ✅

**Finding:** Connection status endpoint works without login.

**Evidence:**
- Endpoint returns `connected: false` when not connected
- Endpoint returns `connected: true` after OAuth completion
- Error handling is correct

**Conclusion:** Connection status can be tested without login.

---

### 3. Evidence Ingestion ⚠️

**Finding:** Evidence ingestion requires Gmail to be connected.

**Evidence:**
- Endpoint returns error if Gmail not connected
- Endpoint returns success after Gmail is connected
- Error handling is correct

**Conclusion:** Evidence ingestion endpoint can be tested, but requires Gmail connection for full functionality.

---

## 🚀 Next Steps

1. ✅ **Test OAuth URL Generation** - Verify URL is generated correctly
2. ✅ **Test Connection Status** - Verify status endpoint works
3. 🔐 **Complete OAuth Flow** - Log in with Gmail account (optional)
4. ✅ **Test Evidence Ingestion** - Verify ingestion after connection
5. ✅ **Test Document Parsing** - Verify parsing works correctly

---

## 📝 Testing Gmail OAuth Safely

### Safety Considerations

1. **Read-Only Access:**
   - Gmail OAuth uses `gmail.readonly` scope
   - No emails are sent or altered
   - Only allows reading emails and attachments

2. **Revocable Access:**
   - You can revoke access at any time
   - Go to Google Account → Security → Third-party apps
   - Revoke access to your app

3. **Test Account:**
   - Use a test Gmail account for testing
   - Isolated testing environment
   - No impact on personal Gmail

### Recommended Testing Approach

1. **Phase 1: Endpoint Testing (No Login Required)**
   - Test OAuth URL generation
   - Test connection status
   - Test integration status
   - Test error handling

2. **Phase 2: OAuth Flow Testing (Login Required)**
   - Complete OAuth flow with test account
   - Verify connection status
   - Test evidence ingestion
   - Test document parsing

3. **Phase 3: Full Integration Testing (Login Required)**
   - Test end-to-end flow
   - Verify evidence appears in dashboard
   - Test parsing and matching
   - Verify all functionality works

---

## 🎉 Conclusion

### What Can Be Tested Without Login ✅

- ✅ OAuth URL generation
- ✅ Connection status endpoint
- ✅ Integration status endpoint
- ✅ Evidence ingestion endpoint structure
- ✅ Error handling for unconnected Gmail

### What Requires Login 🔐

- 🔐 Complete OAuth flow
- 🔐 Token exchange
- 🔐 Evidence ingestion (needs connected Gmail)
- 🔐 Document parsing (needs ingested documents)

### Testing Strategy

1. **Start with endpoint testing** (no login required)
2. **Verify OAuth URL generation** (no login required)
3. **Test connection status** (no login required)
4. **Complete OAuth flow** (login required for full testing)
5. **Test evidence ingestion** (login required)

**The system can be partially tested without login, but full functionality requires completing the OAuth flow with a real Gmail account.**

---

**Test Guide Created:** 2025-11-09  
**Status:** ✅ **READY FOR PHASE 3 TESTING**  
**Gmail OAuth:** ✅ **CAN BE TESTED WITHOUT FULL LOGIN**

