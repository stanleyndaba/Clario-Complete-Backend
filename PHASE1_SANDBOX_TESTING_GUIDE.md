# Phase 1: Sandbox Testing Guide - Amazon SP-API Integration

## 🎯 Overview

This guide explains how Phase 1 (Zero-Friction Onboarding) works in **sandbox mode** and how to test it correctly.

## ✅ Current Status

**Good News**: The "Use Existing Connection (Skip OAuth)" button is working correctly! This is the **recommended approach for sandbox testing**.

## 🔍 Understanding the Two Flows

### Flow 1: "Connect Amazon Account" (OAuth Flow) ❌ Currently Failing

**What happens:**
1. User clicks "Connect Amazon Account"
2. Frontend calls: `GET /api/v1/integrations/amazon/auth/start`
3. Backend generates OAuth URL: `https://www.amazon.com/ap/oa?client_id=...&response_type=code&redirect_uri=...&state=...`
4. User is redirected to Amazon authorization page
5. **Error**: "An unknown scope was requested"

**Why it fails:**
- Amazon SP-API OAuth should NOT include a `scope` parameter
- The error suggests the Security Profile in Amazon Developer Console is misconfigured
- In sandbox mode, OAuth requires proper Security Profile setup

**Solution:**
- For sandbox testing, use the bypass flow instead (recommended)
- For production, configure Security Profile correctly in Amazon Developer Console

### Flow 2: "Use Existing Connection (Skip OAuth)" (Bypass Flow) ✅ Working

**What happens:**
1. User clicks "Use Existing Connection (Skip OAuth)"
2. Frontend calls: `GET /api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=...`
3. Backend checks for `AMAZON_SPAPI_REFRESH_TOKEN` in environment
4. If token exists, returns `bypassed: true` with redirect URL
5. User is redirected to: `https://opside-complete-frontend-koyy8oblm-mvelo-ndabas-projects.vercel.app/integrations-hub?amazon_connected=true`
6. ✅ **Success!** User lands on integrations hub with Amazon connected

**Why it works:**
- Uses existing refresh token from environment variables
- No OAuth flow needed
- No Security Profile configuration needed
- Perfect for sandbox testing

## 🚀 Recommended Testing Approach

### For Sandbox Mode (Current):

1. **Use "Use Existing Connection" button** - This is the correct flow for sandbox
2. **Verify redirect works** - Should redirect to `integrations-hub?amazon_connected=true`
3. **Verify connection status** - Check that Amazon shows as connected
4. **Test sync functionality** - Verify that sync works with the existing token

### For Production Mode (Future):

1. **Configure Security Profile** in Amazon Developer Console
2. **Remove OAuth scopes** from Security Profile
3. **Set correct Redirect URI** in Security Profile
4. **Test OAuth flow** with production credentials

## 🔧 Backend Implementation

### Bypass Flow Logic (Enhanced)

The backend now:
1. **Detects sandbox mode** automatically
2. **Suggests bypass flow** in sandbox mode if refresh token exists
3. **Handles redirect URLs** correctly (preserves frontend URL path)
4. **Logs sandbox mode** for debugging

### Key Code Changes

```typescript
// Detects sandbox mode
const isSandboxMode = process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox') || 
                      !process.env.AMAZON_SPAPI_BASE_URL || 
                      process.env.NODE_ENV === 'development';

// Auto-suggests bypass in sandbox mode
const bypassOAuth = req.query.bypass === 'true' || 
                   req.query.skip_oauth === 'true' ||
                   (isSandboxMode && req.query.force_oauth !== 'true');

// Handles redirect URL correctly
// Preserves frontend URL path (e.g., /integrations-hub)
const frontendUrlObj = new URL(frontendUrl);
if (frontendUrlObj.pathname && frontendUrlObj.pathname !== '/') {
  redirectUrl = `${frontendUrl}?amazon_connected=true&message=...`;
} else {
  redirectUrl = `${frontendUrl}/integrations-hub?amazon_connected=true&message=...`;
}
```

## 📋 Testing Checklist

### Phase 1: Zero-Friction Onboarding

- [x] **Bypass Flow (Skip OAuth)**
  - [x] Click "Use Existing Connection" button
  - [x] Verify redirect to integrations-hub
  - [x] Verify `amazon_connected=true` in URL
  - [x] Verify Amazon shows as connected on dashboard

- [ ] **OAuth Flow (Connect Amazon Account)**
  - [ ] Click "Connect Amazon Account" button
  - [ ] Verify OAuth URL is generated
  - [ ] Verify redirect to Amazon authorization page
  - [ ] **Note**: Will fail until Security Profile is configured correctly

- [ ] **Integration Status**
  - [ ] Call `GET /api/v1/integrations/status`
  - [ ] Verify `amazon_connected: true`
  - [ ] Verify response includes all expected fields

- [ ] **User Profile**
  - [ ] Verify user profile exists in database
  - [ ] Verify Amazon seller ID is stored
  - [ ] Verify profile is accessible via API

## 🐛 Troubleshooting

### Issue: "Unknown scope was requested"

**Cause**: Security Profile in Amazon Developer Console has scopes configured

**Solution for Sandbox**:
- Use bypass flow instead (recommended)
- No Security Profile configuration needed

**Solution for Production**:
1. Go to Amazon Developer Console
2. Select Security Profile
3. Remove any OAuth scopes
4. Configure for SP-API (not LWA with scopes)
5. Set correct Redirect URI

### Issue: Redirect URL incorrect

**Cause**: Frontend URL path not preserved

**Solution**: 
- Backend now preserves frontend URL path
- If frontend URL includes `/integrations-hub`, it's preserved
- If frontend URL is just domain, defaults to `/integrations-hub`

### Issue: Bypass flow not working

**Cause**: `AMAZON_SPAPI_REFRESH_TOKEN` not set in environment

**Solution**:
- Verify `AMAZON_SPAPI_REFRESH_TOKEN` is set in Render environment variables
- Verify token is valid
- Check backend logs for token validation errors

## ✅ Success Criteria

Phase 1 is considered successful if:
- ✅ Bypass flow works correctly (redirects to integrations-hub)
- ✅ Amazon shows as connected on dashboard
- ✅ Integration status endpoint returns `amazon_connected: true`
- ✅ User can proceed to Phase 2 (sync and claims)

**Note**: OAuth flow failure is expected in sandbox mode until Security Profile is configured. The bypass flow is the correct approach for sandbox testing.

## 🚀 Next Steps

1. **Verify bypass flow works** - Test the "Use Existing Connection" button
2. **Verify redirect URL** - Ensure it goes to correct frontend URL
3. **Verify connection status** - Check that Amazon shows as connected
4. **Proceed to Phase 2** - Test sync and claims discovery

## 📝 Frontend Recommendations

### For Sandbox Mode:

1. **Default to bypass flow** - Show "Use Existing Connection" as primary button
2. **Hide OAuth button** - Or show it as secondary/advanced option
3. **Better messaging** - Explain that bypass is recommended for sandbox

### For Production Mode:

1. **Show OAuth button** - Primary button for connecting Amazon
2. **Show bypass option** - Secondary option if refresh token exists
3. **Better error handling** - Show helpful error messages for OAuth failures

## 🎉 Conclusion

**The bypass flow is working correctly!** This is the intended behavior for sandbox mode. The OAuth flow failure is expected until Security Profile is configured correctly in Amazon Developer Console. For sandbox testing, the bypass flow is the recommended approach.

