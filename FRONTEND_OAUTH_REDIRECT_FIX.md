# Frontend OAuth Redirect Fix - Gmail Integration

## 🎯 Issue

After completing Gmail OAuth, users are redirected to:
```
/auth/callback/integrations-hub?gmail_connected=true&email=...
```

This route doesn't exist in the frontend Next.js app, causing a **404 error**.

## ✅ Solution Options

### Option 1: Fix Backend Redirect (Recommended - Already Done)
**Status:** ✅ **BACKEND FIX ALREADY APPLIED**

The backend has been updated to redirect directly to `/integrations-hub` instead of `/auth/callback/integrations-hub`.

**However:** If you're still seeing the 404, it means:
1. The backend changes haven't been deployed yet, OR
2. There's a frontend middleware/redirect adding the `/auth/callback` prefix

### Option 2: Fix Frontend Route (Quick Fix - Do This Now)

Create a frontend route to handle the OAuth callback redirect. This is the **fastest fix** and will work immediately.

---

## 🚀 Quick Fix: Create Frontend Callback Route

### Step 1: Create Callback Redirect Page

**File:** `pages/auth/callback/integrations-hub.tsx` (or `app/auth/callback/integrations-hub/page.tsx` for App Router)

**Content:**

```tsx
import { useEffect } from 'react';
import { useRouter } from 'next/router';

/**
 * OAuth Callback Redirect Handler
 * Redirects from /auth/callback/integrations-hub to /integrations-hub
 * Preserves all query parameters (gmail_connected, email, etc.)
 */
export default function OAuthCallbackRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Extract query parameters
    const { gmail_connected, email, outlook_connected, gdrive_connected, dropbox_connected, ...rest } = router.query;

    // Build redirect URL to integrations-hub
    const redirectPath = '/integrations-hub';
    const queryParams = new URLSearchParams();

    // Preserve all provider connection statuses
    if (gmail_connected) queryParams.set('gmail_connected', gmail_connected as string);
    if (outlook_connected) queryParams.set('outlook_connected', outlook_connected as string);
    if (gdrive_connected) queryParams.set('gdrive_connected', gdrive_connected as string);
    if (dropbox_connected) queryParams.set('dropbox_connected', dropbox_connected as string);
    if (email) queryParams.set('email', email as string);

    // Preserve any other query parameters
    Object.keys(rest).forEach(key => {
      if (rest[key]) {
        queryParams.set(key, rest[key] as string);
      }
    });

    // Redirect to integrations-hub with all query parameters
    const redirectUrl = queryParams.toString() 
      ? `${redirectPath}?${queryParams.toString()}`
      : redirectPath;

    router.replace(redirectUrl);
  }, [router]);

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h2>Connecting your account...</h2>
        <p>Please wait while we redirect you.</p>
      </div>
    </div>
  );
}
```

### Step 2: Alternative - Generic Callback Handler (Better)

**File:** `pages/auth/callback/[provider].tsx` (or `app/auth/callback/[provider]/page.tsx` for App Router)

This handles all OAuth callbacks dynamically:

```tsx
import { useEffect } from 'react';
import { useRouter } from 'next/router';

/**
 * Generic OAuth Callback Handler
 * Handles callbacks for all providers (gmail, outlook, gdrive, dropbox)
 * Redirects to /integrations-hub with connection status
 */
export default function OAuthCallback() {
  const router = useRouter();
  const { provider } = router.query;

  useEffect(() => {
    if (!provider) return;

    // Extract query parameters
    const query = router.query;
    
    // Build redirect URL to integrations-hub
    const redirectPath = '/integrations-hub';
    const queryParams = new URLSearchParams();

    // Set provider connection status
    queryParams.set(`${provider}_connected`, 'true');
    
    // Preserve email if provided
    if (query.email) {
      queryParams.set('email', query.email as string);
    }

    // Preserve any error messages
    if (query.error) {
      queryParams.set('error', query.error as string);
    }

    // Preserve success status
    if (query.success) {
      queryParams.set('success', query.success as string);
    }

    // Redirect to integrations-hub
    const redirectUrl = `${redirectPath}?${queryParams.toString()}`;
    router.replace(redirectUrl);
  }, [router, provider]);

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h2>Connecting your account...</h2>
        <p>Please wait while we redirect you.</p>
      </div>
    </div>
  );
}
```

### Step 3: Update Integrations Hub to Handle Query Parameters

**File:** `pages/integrations-hub.tsx` (or `app/integrations-hub/page.tsx`)

Add logic to handle OAuth callback query parameters:

```tsx
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function IntegrationsHub() {
  const router = useRouter();
  const { gmail_connected, email, outlook_connected, gdrive_connected, dropbox_connected, error } = router.query;

  useEffect(() => {
    // Show success notification if provider was just connected
    if (gmail_connected === 'true' || outlook_connected === 'true' || gdrive_connected === 'true' || dropbox_connected === 'true') {
      // Show success toast/notification
      console.log('Provider connected successfully!', { email });
      
      // Optionally: Refresh integration status
      // You can call your API here to refresh the integration status
    }

    // Show error notification if OAuth failed
    if (error) {
      console.error('OAuth error:', error);
      // Show error toast/notification
    }

    // Clean up URL by removing query parameters after processing
    // (Optional - keeps URL clean)
    if (gmail_connected || outlook_connected || gdrive_connected || dropbox_connected || error) {
      const cleanUrl = router.pathname;
      router.replace(cleanUrl, undefined, { shallow: true });
    }
  }, [router, gmail_connected, email, outlook_connected, gdrive_connected, dropbox_connected, error]);

  // Your existing integrations hub component
  return (
    <div>
      {/* Your integrations hub UI */}
      {gmail_connected === 'true' && (
        <div className="success-message">
          Gmail connected successfully! {email && `(${email})`}
        </div>
      )}
      {/* Rest of your component */}
    </div>
  );
}
```

---

## 🎯 Recommended Approach

### Immediate Fix (Do This Now):

1. **Create the callback redirect page** (Option 2 - Generic Callback Handler)
   - File: `pages/auth/callback/[provider].tsx`
   - This handles all OAuth callbacks dynamically
   - Redirects to `/integrations-hub` with connection status

2. **Update integrations hub** to handle query parameters
   - Show success/error notifications
   - Refresh integration status if needed

### Long-term Fix (After Backend Deployment):

Once the backend is deployed with the fix:
- Backend will redirect directly to `/integrations-hub`
- Frontend callback route will still work as a fallback
- No changes needed to frontend

---

## 📋 Implementation Checklist

### Frontend Fix:

- [ ] Create `pages/auth/callback/[provider].tsx` (or App Router equivalent)
- [ ] Add redirect logic to `/integrations-hub`
- [ ] Preserve query parameters (gmail_connected, email, etc.)
- [ ] Update `integrations-hub` page to handle query parameters
- [ ] Add success/error notifications
- [ ] Test OAuth flow end-to-end

### Backend Fix (Already Done):

- [x] Updated Gmail controller redirect to `/integrations-hub`
- [x] Updated Evidence Sources controller redirect to `/integrations-hub`
- [x] Committed and pushed changes
- [ ] Wait for Render deployment

---

## 🧪 Testing

### Test OAuth Flow:

1. **Click "Connect Gmail"**
2. **Complete OAuth flow** (login, grant permission)
3. **Verify redirect:**
   - Should redirect to `/integrations-hub?gmail_connected=true&email=...`
   - OR `/auth/callback/integrations-hub?gmail_connected=true&email=...` (if backend not deployed)
   - Should NOT show 404 error
4. **Verify integration status:**
   - Gmail should show as "Connected ✅"
   - Email address should be displayed
5. **Test other providers:**
   - Outlook, Google Drive, Dropbox should work the same way

---

## 🚀 Quick Implementation

### For Pages Router (Next.js 12 and earlier):

1. Create file: `pages/auth/callback/[provider].tsx`
2. Copy the generic callback handler code above
3. Deploy to Vercel
4. Test OAuth flow

### For App Router (Next.js 13+):

1. Create file: `app/auth/callback/[provider]/page.tsx`
2. Copy the generic callback handler code (adjusted for App Router)
3. Deploy to Vercel
4. Test OAuth flow

---

## 📝 Notes

### Why This Fix Works:

1. **Handles Current Backend Redirect:**
   - Works with current backend redirect to `/auth/callback/integrations-hub`
   - Also works with future backend redirect to `/integrations-hub`

2. **Preserves Query Parameters:**
   - Keeps `gmail_connected`, `email`, etc.
   - Allows integrations hub to show success status

3. **Generic Solution:**
   - Works for all providers (Gmail, Outlook, Google Drive, Dropbox)
   - Single route handles all OAuth callbacks

4. **User Experience:**
   - Shows loading message during redirect
   - Smooth transition to integrations hub
   - No 404 errors

---

## ✅ Expected Behavior After Fix

### Before Fix:
1. User completes OAuth
2. Backend redirects to `/auth/callback/integrations-hub?gmail_connected=true&email=...`
3. Frontend shows 404 error ❌

### After Fix:
1. User completes OAuth
2. Backend redirects to `/auth/callback/integrations-hub?gmail_connected=true&email=...`
3. Frontend callback route catches the request
4. Frontend redirects to `/integrations-hub?gmail_connected=true&email=...`
5. Integrations hub shows "Gmail Connected ✅" ✅

---

## 🎉 Summary

**Issue:** Frontend route `/auth/callback/integrations-hub` doesn't exist → 404 error

**Solution:** Create frontend callback route that redirects to `/integrations-hub`

**Implementation:**
1. Create `pages/auth/callback/[provider].tsx`
2. Add redirect logic to `/integrations-hub`
3. Update integrations hub to handle query parameters
4. Deploy and test

**Status:** ✅ **READY FOR IMPLEMENTATION**

---

**Fix Guide Created:** 2025-11-09  
**Priority:** 🔴 **HIGH - FIX ASAP**  
**Estimated Time:** 5-10 minutes  
**Difficulty:** Easy

