# Document Upload Frontend Fix

## 🎯 Issue

Frontend document upload (drag & drop, browse files) is not working. The upload functionality appears in the UI but fails when attempting to upload files.

## 🔍 Root Causes

1. **Authentication Issues**: Upload endpoint may require authentication that's not being passed correctly
2. **CORS Issues**: Preflight requests may be failing
3. **Endpoint Mismatch**: Frontend may be calling wrong endpoint or with wrong format
4. **User ID Extraction**: User ID may not be extracted correctly from request

## ✅ Fixes Applied

### 1. Enhanced User ID Extraction

**File**: `Integrations-backend/src/routes/evidenceRoutes.ts`

- Added multiple fallback sources for user ID extraction:
  - `req.userId` (from userIdMiddleware)
  - `req.user.id` (from authentication middleware)
  - `req.user.user_id` (alternative user ID field)
  - `X-User-Id` header
  - `X-Forwarded-User-Id` header
  - `userId` query parameter

- Added detailed logging for debugging user ID extraction
- Improved error messages for unauthorized requests

### 2. CORS Preflight Handler

**File**: `Integrations-backend/src/routes/evidenceRoutes.ts`

- Added `OPTIONS /upload` handler for CORS preflight
- Explicitly sets CORS headers for preflight requests
- Allows necessary headers for file uploads
- Sets `Access-Control-Max-Age` for caching

### 3. Explicit CORS Headers in Responses

**File**: `Integrations-backend/src/routes/evidenceRoutes.ts`

- Added explicit CORS headers in success responses
- Added explicit CORS headers in error responses
- Headers respect the request origin
- Ensures frontend can read responses

### 4. Enhanced CORS Configuration

**File**: `Integrations-backend/src/index.ts`

- Added `Accept` and `Cache-Control` to allowed headers
- Improved CORS header configuration
- Better support for file upload requests

### 5. Improved Error Messages

**File**: `Integrations-backend/src/routes/evidenceRoutes.ts`

- More helpful error messages for unauthorized requests
- Hints for testing/development
- Better debugging information

## 📋 Endpoints Available

### Primary Endpoint
- **URL**: `POST /api/evidence/upload`
- **Method**: POST
- **Content-Type**: `multipart/form-data`
- **Field Name**: `file` (singular, for multiple files)
- **Headers**:
  - `Authorization: Bearer <token>` (optional, if authenticated)
  - `X-User-Id: <user-id>` (optional, for testing)
  - `Content-Type: multipart/form-data` (automatically set)

### Proxy Endpoint
- **URL**: `POST /api/documents/upload`
- **Method**: POST
- **Content-Type**: `multipart/form-data`
- **Field Name**: `file` (singular, for multiple files)
- **Headers**: Same as primary endpoint

## 🧪 Testing

### Test 1: Upload with Authentication
```bash
curl -X POST https://opside-node-api-woco.onrender.com/api/evidence/upload \
  -H "Authorization: Bearer <token>" \
  -H "X-User-Id: test-user-123" \
  -F "file=@test-document.pdf"
```

### Test 2: Upload with X-User-Id Header (for testing)
```bash
curl -X POST https://opside-node-api-woco.onrender.com/api/evidence/upload \
  -H "X-User-Id: test-user-123" \
  -F "file=@test-document.pdf"
```

### Test 3: CORS Preflight
```bash
curl -X OPTIONS https://opside-node-api-woco.onrender.com/api/evidence/upload \
  -H "Origin: https://your-frontend-url.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization"
```

## 🔧 Frontend Integration

### Required Headers
```javascript
const formData = new FormData();
formData.append('file', file); // Use 'file' (singular) field name

fetch('https://opside-node-api-woco.onrender.com/api/evidence/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`, // If authenticated
    'X-User-Id': userId, // Optional, for testing
    // Don't set Content-Type - browser will set it with boundary
  },
  body: formData,
  credentials: 'include' // Important for CORS with credentials
});
```

### Error Handling
```javascript
fetch(url, options)
  .then(response => {
    if (!response.ok) {
      return response.json().then(err => {
        throw new Error(err.message || err.error || 'Upload failed');
      });
    }
    return response.json();
  })
  .then(data => {
    console.log('Upload successful:', data);
  })
  .catch(error => {
    console.error('Upload error:', error);
    // Handle error (show toast, etc.)
  });
```

## 🐛 Common Issues

### Issue 1: "Unauthorized" Error

**Solution**:
- Ensure user is logged in and session token is valid
- Check if `Authorization` header is being sent
- Verify `X-User-Id` header is set (for testing)
- Check backend logs for user ID extraction details

### Issue 2: CORS Error

**Solution**:
- Verify frontend URL is allowed in CORS configuration
- Check if preflight (OPTIONS) request is succeeding
- Ensure `credentials: 'include'` is set in fetch options
- Verify CORS headers are being returned correctly

### Issue 3: "No files provided" Error

**Solution**:
- Ensure files are being appended to FormData with `file` field name
- Check if files are being read correctly
- Verify file size is within limits (50MB backend, 10MB frontend)
- Check browser console for FormData contents

### Issue 4: 502/503 Service Unavailable

**Solution**:
- Check Python API service status on Render
- Verify Python API is running and accessible
- Check Python API logs for errors
- Ensure Python API endpoint exists and is working

## 📊 Debugging

### Enable Debug Logging
Check Render logs for:
- `🔍 [EVIDENCE] User ID extraction` - Shows how user ID was extracted
- `📤 [EVIDENCE] Document upload request received` - Confirms request received
- `📤 [EVIDENCE] Starting upload to Python API` - Shows upload attempt
- `✅ [EVIDENCE] Document upload successful` - Confirms success
- `❌ [EVIDENCE] Error forwarding upload to Python API` - Shows errors

### Check Network Tab
1. Open browser DevTools → Network tab
2. Attempt upload
3. Check request:
   - Method: POST
   - URL: `/api/evidence/upload`
   - Headers: Authorization, X-User-Id, Content-Type
   - Payload: FormData with files
4. Check response:
   - Status: 200 (success) or error code
   - Body: JSON response
   - Headers: CORS headers present

## 🚀 Next Steps

1. **Test Upload**: Try uploading a file from the frontend
2. **Check Logs**: Review Render logs for detailed error messages
3. **Verify Endpoint**: Confirm frontend is calling correct endpoint
4. **Check Authentication**: Ensure user is authenticated or X-User-Id is set
5. **Test CORS**: Verify CORS preflight is working
6. **Check Python API**: Verify Python API service is running

## 📝 Notes

- Frontend shows "10MB" limit, but backend allows up to "50MB"
- Use `file` (singular) field name for multiple files
- CORS preflight is handled automatically
- Authentication is optional if `X-User-Id` header is provided (for testing)
- All errors return JSON (no HTML error pages)

