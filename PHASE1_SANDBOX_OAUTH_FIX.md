# Phase 1: Sandbox OAuth Fix - Amazon SP-API Integration

## 🐛 Problem Identified

**Error**: "An unknown scope was requested" when clicking "Connect Amazon Account"

**Root Cause**: 
- Amazon SP-API OAuth should NOT include a `scope` parameter
- The error suggests either:
  1. The Security Profile in Amazon Developer Console is misconfigured
  2. The OAuth URL is being constructed incorrectly (though code looks correct)
  3. Amazon's sandbox environment has specific requirements

**Current Status**:
- ✅ "Use Existing Connection (Skip OAuth)" works correctly
- ❌ "Connect Amazon Account" OAuth flow fails with scope error

## ✅ Solution: Enhanced Sandbox OAuth Flow

### Option 1: Use Existing Connection (Recommended for Sandbox)

Since you have `AMAZON_SPAPI_REFRESH_TOKEN` in your environment, the **bypass flow is the correct approach for sandbox testing**. This is actually the intended behavior for sandbox mode.

**How it works**:
1. Frontend calls: `GET /api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=<URL>`
2. Backend checks for `AMAZON_SPAPI_REFRESH_TOKEN` in environment
3. If token exists, returns `bypassed: true` and redirects to dashboard
4. No OAuth flow needed - uses existing token

**This is the correct flow for sandbox mode!**

### Option 2: Fix OAuth Flow for Future Production Use

Even though bypass works, we should fix the OAuth flow for when you get real production credentials. The issue is likely:

1. **Security Profile Configuration**: Amazon SP-API Security Profiles should NOT have scopes configured
2. **Redirect URI Mismatch**: Must match exactly what's in Amazon Developer Console
3. **Client ID Configuration**: Must be configured for SP-API (not LWA with scopes)

## 🔧 Implementation Fixes

### Fix 1: Ensure No Scope Parameter (Already Implemented)

The code already excludes scope parameter. However, we need to verify:

```typescript
// Current implementation (CORRECT)
const authUrl = `${oauthBase}?` +
  `client_id=${encodeURIComponent(clientId)}&` +
  `response_type=code&` +
  `redirect_uri=${encodeURIComponent(redirectUri)}&` +
  `state=${state}`;
// NO scope parameter - this is correct for SP-API
```

### Fix 2: Enhanced Error Handling

Add better error messages and fallback to bypass if OAuth fails in sandbox mode.

### Fix 3: Sandbox-Specific OAuth Handling

For sandbox mode, automatically suggest using bypass flow if OAuth fails.

## 📋 Amazon Developer Console Configuration

To fix OAuth for production (when you get real credentials):

1. **Go to Amazon Developer Console**
   - https://developer.amazon.com/
   - Login with Amazon Seller account

2. **Security Profile Settings**
   - Go to: Apps & Services → Security Profiles
   - Select your Security Profile
   - **IMPORTANT**: Do NOT configure any OAuth scopes
   - SP-API uses permissions from Seller Central, not OAuth scopes

3. **Web Settings**
   - Go to: Web Settings tab
   - Add Redirect URI: `https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/callback`
   - **Must match exactly** (no trailing slash, exact protocol)

4. **Client ID & Secret**
   - Copy Client ID (LWA Client Identifier)
   - Copy Client Secret (LWA Client Secret)
   - Set in environment: `AMAZON_CLIENT_ID`, `AMAZON_CLIENT_SECRET`

## 🚀 Recommended Approach for Sandbox Testing

**Use the bypass flow** - it's working correctly and is the intended way to test sandbox:

1. Frontend should default to bypass flow for sandbox mode
2. Only show "Connect Amazon Account" OAuth button for production
3. In sandbox, automatically use existing refresh token

## 🔍 Verification Steps

### Test 1: Bypass Flow (Should Work)
```bash
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=https://opside-complete-frontend-koyy8oblm-mvelo-ndabas-projects.vercel.app"
```

Expected Response:
```json
{
  "success": true,
  "ok": true,
  "bypassed": true,
  "message": "Using existing Amazon connection",
  "redirectUrl": "https://opside-complete-frontend-koyy8oblm-mvelo-ndabas-projects.vercel.app/integrations-hub?amazon_connected=true"
}
```

### Test 2: OAuth Flow (Will Fail Until Configured)
```bash
curl "https://opside-node-api-woco.onrender.com/api/v1/integrations/amazon/auth/start?frontend_url=https://opside-complete-frontend-koyy8oblm-mvelo-ndabas-projects.vercel.app"
```

Current Response: OAuth URL with scope error (needs Amazon Developer Console configuration)

## ✅ Next Steps

1. **For Sandbox Testing (Immediate)**:
   - ✅ Use "Use Existing Connection" button (bypass flow)
   - ✅ This works correctly and is the intended sandbox approach
   - ✅ No OAuth configuration needed

2. **For Production (Future)**:
   - Configure Amazon Developer Console Security Profile
   - Remove any OAuth scopes from Security Profile
   - Set correct Redirect URI
   - Test OAuth flow with production credentials

3. **Frontend Updates**:
   - Default to bypass flow in sandbox mode
   - Show OAuth button only when needed (production)
   - Better error messages for OAuth failures

## 📝 Code Changes Needed

### 1. Enhance OAuth Error Handling
Add better error messages and automatic fallback to bypass in sandbox mode.

### 2. Frontend: Default to Bypass in Sandbox
Frontend should detect sandbox mode and default to bypass flow.

### 3. Better Logging
Add more detailed logging for OAuth flow debugging.

