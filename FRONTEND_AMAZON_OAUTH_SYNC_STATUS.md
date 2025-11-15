# Amazon OAuth & Sync Status - Frontend Implementation Guide

**ONE-LINE SUMMARY:** Implement the frontend flow for connecting an Amazon account via OAuth and displaying the sync status using mock data.

## 🎯 Current Scope (ONLY THIS)

*   **Connect:** A screen/button to initiate the Amazon OAuth connection.
*   **Callback:** A page to handle the OAuth callback redirect.
*   **Status:** A screen to display the synchronization status (e.g., "Syncing," "Last synced X minutes ago").
*   **Show Mock Data:** All data displayed on the status screen will be static/mocked for now.

## ❌ Out of Scope (IGNORE FOR NOW)

*   Agents
*   Business Logic
*   Machine Learning (ML)
*   Backend-for-agents

## 🔄 Flow Overview

**Connect → Callback → Status → Show mock data**

```
User clicks "Connect Amazon" 
  → Redirects to Amazon OAuth
  → Amazon redirects back to /auth/callback
  → Frontend shows sync status screen
  → Display mock sync data
```

---

## 📡 Backend Endpoints

### Base URLs

- **Python API (Primary):** `https://your-python-api.onrender.com`
- **Node.js Integrations API:** `https://opside-node-api.onrender.com`

**Note:** For OAuth, use the **Node.js Integrations API**. For sync status, you can use either API.

---

## 1️⃣ Connect: Initiate Amazon OAuth

### Endpoint

```
GET /api/v1/integrations/amazon/auth/start
```

**Base URL:** Node.js Integrations API (`https://opside-node-api.onrender.com`)

### Request

```typescript
// No body required
// Headers (optional but recommended):
{
  "X-User-Id": "user-123",           // User ID (if available)
  "X-Frontend-URL": "https://your-frontend.com",  // For redirect URL
  "Origin": "https://your-frontend.com"
}
```

**Query Parameters (Optional):**
- `frontend_url` - Frontend URL for callback redirect
- `bypass=true` - Skip OAuth (sandbox/dev only, uses existing token)

### Response (200 OK)

```json
{
  "authUrl": "https://www.amazon.com/ap/oa?client_id=...&response_type=code&redirect_uri=...&state=...",
  "state": "random-state-string-for-csrf"
}
```

**Mock Response (if credentials not configured):**
```json
{
  "authUrl": "https://your-frontend.com/auth/callback?code=mock_auth_code&state=mock_state",
  "state": "mock_state"
}
```

### Frontend Implementation

```typescript
// Example: Connect Amazon button handler
async function connectAmazon() {
  try {
    const response = await fetch(
      'https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/start',
      {
        method: 'GET',
        headers: {
          'X-User-Id': getUserId(), // Get from auth context
          'X-Frontend-URL': window.location.origin,
          'Origin': window.location.origin
        },
        credentials: 'include' // Include cookies if using session auth
      }
    );
    
    const data = await response.json();
    
    // Redirect user to Amazon OAuth page
    window.location.href = data.authUrl;
    
    // Store state in localStorage for callback validation (optional)
    localStorage.setItem('oauth_state', data.state);
  } catch (error) {
    console.error('Failed to start OAuth:', error);
    // Show error message to user
  }
}
```

### Alternative Endpoints (Same Functionality)

- `GET /api/v1/integrations/amazon/auth` (same as `/auth/start`)
- `GET /api/v1/integrations/amazon` (root endpoint, same functionality)

---

## 2️⃣ Callback: Handle OAuth Redirect

### How It Works

**Important:** Amazon redirects to the **backend callback endpoint**, not directly to your frontend. The backend processes the OAuth code and then redirects to your frontend.

**Flow:**
1. User authorizes on Amazon
2. Amazon redirects to: `https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/callback?code=...&state=...`
3. Backend processes OAuth and exchanges code for tokens
4. Backend redirects to your frontend: `/integrations-hub?amazon_connected=true`

### Frontend Route (Where Backend Redirects To)

```
GET /integrations-hub?amazon_connected=true
```

**OR** (if you want a dedicated callback page):

```
GET /auth/callback?amazon_connected=true
```

**Query Parameters (from backend redirect):**
- `amazon_connected=true` - Connection successful
- `message=Connected successfully` - Success message
- `error=...` - Error message (if connection failed)
- `amazon_error=true` - Flag indicating Amazon-specific error

**Note:** The backend automatically handles the OAuth code exchange. Your frontend just needs to handle the final redirect.

### Frontend Implementation

```typescript
// Example 1: Handle redirect on integrations-hub page
function IntegrationsHub() {
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const amazonConnected = params.get('amazon_connected');
    const error = params.get('error');
    const message = params.get('message');
    
    if (amazonConnected === 'true') {
      setConnectionStatus('success');
      // Show success message
      // Optionally redirect to sync status after a few seconds
      setTimeout(() => {
        window.location.href = '/sync-status';
      }, 3000);
    } else if (error) {
      setConnectionStatus('error');
      // Show error message
    }
    
    // Clean up URL params after reading them
    if (amazonConnected || error) {
      window.history.replaceState({}, '', '/integrations-hub');
    }
  }, []);
  
  return (
    <div>
      {connectionStatus === 'success' && (
        <div className="success-message">
          ✅ Amazon account connected successfully!
        </div>
      )}
      {connectionStatus === 'error' && (
        <div className="error-message">
          ❌ Failed to connect Amazon account
        </div>
      )}
      {/* Rest of integrations hub UI */}
    </div>
  );
}

// Example 2: Dedicated callback page (if you prefer)
function AuthCallback() {
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const amazonConnected = params.get('amazon_connected');
    const errorParam = params.get('error');
    const message = params.get('message');
    
    // Backend already processed OAuth, we just need to handle the redirect
    if (amazonConnected === 'true') {
      setStatus('success');
      // Redirect to sync status page
      setTimeout(() => {
        window.location.href = '/sync-status';
      }, 2000);
    } else if (errorParam) {
      setStatus('error');
      setError(message || errorParam || 'OAuth authorization failed');
    } else {
      // No params - might be direct navigation, show processing
      setStatus('processing');
    }
  }, []);
  
  if (status === 'processing') {
    return <div>Processing connection...</div>;
  }
  
  if (status === 'error') {
    return (
      <div>
        <h2>Connection Failed</h2>
        <p>{error}</p>
        <button onClick={() => window.location.href = '/connect'}>
          Try Again
        </button>
      </div>
    );
  }
  
  return (
    <div>
      <h2>Successfully Connected!</h2>
      <p>Redirecting to sync status...</p>
    </div>
  );
}
```

### Backend Callback Endpoint (Automatic - You Don't Call This)

The backend automatically handles the OAuth callback at:
```
GET /api/v1/integrations/amazon/auth/callback
```

**Flow:**
1. Amazon redirects to backend: `/api/v1/integrations/amazon/auth/callback?code=...&state=...`
2. Backend exchanges code for tokens
3. Backend stores tokens and connection info
4. Backend redirects to your frontend: `/integrations-hub?amazon_connected=true`

**You don't need to call this endpoint directly** - it's handled automatically by the OAuth flow.

---

## 3️⃣ Status: Display Sync Status

### Endpoint 1: Get Active Sync Status (Recommended)

```
GET /api/sync/status
```

**Base URL:** Python API or Node.js API (both work)

### Request

```typescript
// No query params = get active sync status
GET /api/sync/status

// With sync ID = get specific sync status
GET /api/sync/status?id=sync_abc123
```

**Headers:**
```typescript
{
  "Authorization": "Bearer JWT_TOKEN",  // If using JWT
  "Cookie": "session_token=...",        // If using cookie auth
  "X-User-Id": "user-123"               // User ID
}
```

### Response (Without ID - Active Sync Status)

```json
{
  "hasActiveSync": false,
  "lastSync": {
    "id": "sync_abc123",
    "status": "completed",
    "started_at": "2024-01-15T12:00:00Z",
    "completed_at": "2024-01-15T12:05:00Z",
    "progress": 100,
    "message": "Sync completed successfully",
    "ordersProcessed": 1247,
    "totalOrders": 2500,
    "claimsDetected": 5
  }
}
```

**If No Sync:**
```json
{
  "hasActiveSync": false,
  "lastSync": null
}
```

### Response (With ID - Specific Sync Status)

```json
{
  "id": "sync_abc123",
  "type": "amazon",
  "status": "completed",
  "started_at": "2024-01-15T12:00:00Z",
  "completed_at": "2024-01-15T12:05:00Z",
  "progress": 100,
  "total_items": 2500,
  "processed_items": 2500,
  "estimated_completion": null,
  "errors": [],
  "warnings": []
}
```

**Status Values:**
- `idle` - No sync running
- `running` / `in_progress` - Sync in progress
- `completed` - Sync finished successfully
- `failed` - Sync encountered an error
- `cancelled` - Sync was cancelled

### Frontend Implementation (Polling)

```typescript
// Example: Sync status component with polling
function SyncStatus() {
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    // Poll sync status every 3 seconds if sync is in progress
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/sync/status', {
          credentials: 'include', // Include cookies
          headers: {
            'X-User-Id': getUserId()
          }
        });
        
        const data = await response.json();
        setSyncStatus(data);
        setIsLoading(false);
        
        // Stop polling if sync is complete or failed
        if (data.lastSync?.status === 'completed' || 
            data.lastSync?.status === 'failed' ||
            !data.hasActiveSync) {
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error('Failed to get sync status:', error);
        setIsLoading(false);
      }
    }, 3000); // Poll every 3 seconds
    
    // Initial fetch
    fetch('/api/sync/status', {
      credentials: 'include',
      headers: { 'X-User-Id': getUserId() }
    })
      .then(res => res.json())
      .then(data => {
        setSyncStatus(data);
        setIsLoading(false);
      });
    
    return () => clearInterval(pollInterval);
  }, []);
  
  if (isLoading) {
    return <div>Loading sync status...</div>;
  }
  
  // MOCK DATA FOR NOW - Replace with real data later
  const mockStatus = {
    hasActiveSync: false,
    lastSync: {
      id: 'sync_mock_123',
      status: 'completed',
      started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
      completed_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(), // 4 minutes ago
      progress: 100,
      message: 'Sync completed successfully',
      ordersProcessed: 1247,
      totalOrders: 2500,
      claimsDetected: 5
    }
  };
  
  const displayStatus = syncStatus || mockStatus;
  const lastSync = displayStatus.lastSync;
  
  if (!lastSync) {
    return (
      <div>
        <h2>Sync Status</h2>
        <p>No sync history yet. Start a sync to see status.</p>
      </div>
    );
  }
  
  const minutesAgo = Math.floor(
    (Date.now() - new Date(lastSync.completed_at).getTime()) / 60000
  );
  
  return (
    <div>
      <h2>Sync Status</h2>
      <div>
        <p>Status: <strong>{lastSync.status}</strong></p>
        <p>Last synced: <strong>{minutesAgo} minutes ago</strong></p>
        <p>Orders processed: {lastSync.ordersProcessed || 0} / {lastSync.totalOrders || 0}</p>
        {lastSync.claimsDetected && (
          <p>Claims detected: {lastSync.claimsDetected}</p>
        )}
        {lastSync.status === 'running' && (
          <div>
            <p>Progress: {lastSync.progress}%</p>
            <p>{lastSync.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 4️⃣ Integration Status: Check Amazon Connection

### Endpoint

```
GET /api/v1/integrations/status
```

**Base URL:** Node.js Integrations API or Python API (both work)

### Request

```typescript
GET /api/v1/integrations/status

Headers: {
  "X-User-Id": "user-123",
  "Authorization": "Bearer JWT_TOKEN"  // Optional
}
```

### Response

```json
{
  "amazon_connected": true,
  "docs_connected": false,
  "lastSync": "2024-01-15T12:05:00Z",
  "lastIngest": null,
  "providerIngest": {
    "gmail": { "connected": false },
    "outlook": { "connected": false },
    "gdrive": { "connected": false },
    "dropbox": { "connected": false }
  }
}
```

**If Not Connected:**
```json
{
  "amazon_connected": false,
  "docs_connected": false,
  "lastSync": null,
  "lastIngest": null,
  "providerIngest": {
    "gmail": { "connected": false },
    "outlook": { "connected": false },
    "gdrive": { "connected": false },
    "dropbox": { "connected": false }
  }
}
```

### Frontend Implementation

```typescript
// Example: Check if Amazon is connected
async function checkAmazonConnection() {
  try {
    const response = await fetch(
      'https://opside-node-api.onrender.com/api/v1/integrations/status',
      {
        headers: {
          'X-User-Id': getUserId()
        },
        credentials: 'include'
      }
    );
    
    const data = await response.json();
    return data.amazon_connected;
  } catch (error) {
    console.error('Failed to check connection:', error);
    return false;
  }
}
```

---

## 5️⃣ Start Sync (Optional - For Testing)

### Endpoint

```
POST /api/sync/start
```

**Base URL:** Python API or Node.js API

### Request

```typescript
POST /api/sync/start
Content-Type: application/json

Body: {}  // Empty body is fine
```

### Response

```json
{
  "id": "sync_abc123",
  "type": "amazon",
  "status": "processing",
  "started_at": "2024-01-15T12:00:00Z",
  "completed_at": null,
  "progress": 0,
  "total_items": 0,
  "processed_items": 0,
  "estimated_completion": "2024-01-15T12:05:00Z",
  "errors": [],
  "warnings": []
}
```

---

## 📋 Mock Data Examples

### Mock Sync Status (For Frontend Development)

```typescript
// Use this mock data when backend is not available
const MOCK_SYNC_STATUS = {
  hasActiveSync: false,
  lastSync: {
    id: 'sync_mock_123',
    status: 'completed',
    started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
    completed_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(), // 8 min ago
    progress: 100,
    message: 'Sync completed successfully',
    ordersProcessed: 1247,
    totalOrders: 2500,
    claimsDetected: 5
  }
};

// Active sync mock
const MOCK_ACTIVE_SYNC = {
  hasActiveSync: true,
  lastSync: {
    id: 'sync_mock_456',
    status: 'running',
    started_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 min ago
    completed_at: null,
    progress: 45,
    message: 'Processing orders... 1,247 of 2,500 orders processed',
    ordersProcessed: 1247,
    totalOrders: 2500,
    claimsDetected: 0
  }
};

// No sync mock
const MOCK_NO_SYNC = {
  hasActiveSync: false,
  lastSync: null
};
```

### Mock Integration Status

```typescript
const MOCK_INTEGRATION_STATUS = {
  amazon_connected: true,
  docs_connected: false,
  lastSync: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
  lastIngest: null,
  providerIngest: {
    gmail: { connected: false },
    outlook: { connected: false },
    gdrive: { connected: false },
    dropbox: { connected: false }
  }
};
```

---

## 🔐 Authentication

### Methods Supported

1. **JWT Token (Header)**
   ```typescript
   headers: {
     "Authorization": "Bearer YOUR_JWT_TOKEN"
   }
   ```

2. **Session Cookie**
   ```typescript
   fetch(url, {
     credentials: 'include'  // Sends cookies automatically
   })
   ```

3. **User ID Header**
   ```typescript
   headers: {
     "X-User-Id": "user-123"
   }
   ```

**Recommendation:** Use `credentials: 'include'` for cookie-based auth, or include `X-User-Id` header if available.

---

## 🚨 Error Handling

### Common Error Responses

**401 Unauthorized:**
```json
{
  "ok": false,
  "error": "Authentication required"
}
```

**400 Bad Request:**
```json
{
  "detail": "Missing OAuth parameters"
}
```

**500 Internal Server Error:**
```json
{
  "ok": false,
  "error": "Failed to start sync"
}
```

### Frontend Error Handling

```typescript
async function handleApiCall(url: string, options: RequestInit) {
  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'X-User-Id': getUserId(),
        ...options.headers
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.detail || `HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    // Show user-friendly error message
    throw error;
  }
}
```

---

## 📝 Implementation Checklist

### Connect Screen
- [ ] Create "Connect Amazon" button
- [ ] Call `GET /api/v1/integrations/amazon/auth/start`
- [ ] Redirect user to `authUrl` from response
- [ ] Store `state` in localStorage (optional, for CSRF protection)

### Callback Page
- [ ] Create `/integrations-hub` or `/auth/callback` route/page (where backend redirects)
- [ ] Extract `amazon_connected` and `error` from URL query params
- [ ] Handle `amazon_connected=true` - show success message
- [ ] Handle `error` parameter - show error message
- [ ] Show success message: "Amazon account connected successfully!"
- [ ] Auto-redirect to sync status page after 2-3 seconds on success
- [ ] Show error message and retry button on failure
- [ ] Clean up URL params after reading them (optional, for cleaner URLs)

### Status Screen
- [ ] Create sync status page/component
- [ ] Call `GET /api/sync/status` to get active sync status
- [ ] Display sync status (idle/running/completed/failed)
- [ ] Show "Last synced X minutes ago" message
- [ ] Show progress percentage if sync is running
- [ ] Poll status every 3 seconds if sync is active
- [ ] Use mock data if backend is unavailable
- [ ] Handle "no sync" state (show message)

### Integration Status (Optional)
- [ ] Call `GET /api/v1/integrations/status` to check connection
- [ ] Display Amazon connection status
- [ ] Show last sync time if available

---

## 🧪 Testing

### Test OAuth Flow

1. **Start OAuth:**
   ```bash
   curl -X GET "https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/start" \
     -H "X-User-Id: test-user-123" \
     -H "X-Frontend-URL: http://localhost:3000"
   ```

2. **Check Response:**
   - Should return `authUrl` and `state`
   - Open `authUrl` in browser to test redirect

### Test Sync Status

1. **Get Active Status:**
   ```bash
   curl -X GET "https://your-python-api.onrender.com/api/sync/status" \
     -H "X-User-Id: test-user-123" \
     -H "Cookie: session_token=..."
   ```

2. **Expected Response:**
   - `hasActiveSync: boolean`
   - `lastSync: object | null`

### Test Integration Status

```bash
curl -X GET "https://opside-node-api.onrender.com/api/v1/integrations/status" \
  -H "X-User-Id: test-user-123"
```

---

## 🎨 UI/UX Recommendations

### Connect Screen
- Large, prominent "Connect Amazon" button
- Brief explanation: "Connect your Amazon Seller account to start syncing data"
- Loading state while fetching OAuth URL
- Error message if OAuth initiation fails

### Callback Page
- Loading spinner: "Connecting your Amazon account..."
- Success message: "Successfully connected! Redirecting..."
- Error message with retry button
- Auto-redirect after 2-3 seconds on success

### Status Screen
- **Header:** "Sync Status" or "Amazon Sync"
- **Status Badge:** 
  - 🟢 "Connected" (if `amazon_connected: true`)
  - 🔴 "Not Connected" (if `amazon_connected: false`)
  - 🟡 "Syncing..." (if `hasActiveSync: true`)
- **Last Sync Info:**
  - "Last synced: 5 minutes ago" (if `lastSync` exists)
  - "Never synced" (if `lastSync: null`)
- **Progress Bar:** (if sync is running)
  - Show progress percentage
  - Show current step message
- **Mock Data Indicator:** (for development)
  - Show "🔧 Using mock data" badge
  - Remove in production

---

## 🔗 Related Endpoints (For Reference)

### Amazon-Specific
- `GET /api/v1/integrations/amazon/claims` - Get claims (out of scope for now)
- `GET /api/v1/integrations/amazon/inventory` - Get inventory (out of scope for now)
- `POST /api/v1/integrations/amazon/sync` - Start Amazon sync (alternative to `/api/sync/start`)
- `POST /api/v1/integrations/amazon/disconnect` - Disconnect Amazon (out of scope for now)

### Sync Endpoints
- `POST /api/sync/start` - Start sync (already documented above)
- `GET /api/sync/status?id=<syncId>` - Get specific sync status
- `POST /api/sync/cancel` - Cancel running sync (out of scope for now)
- `GET /api/sync/activity` - Get sync history (out of scope for now)

---

## ✅ Summary

**Endpoints You Need:**

1. **Connect:** `GET /api/v1/integrations/amazon/auth/start` (Node.js API)
2. **Callback:** Frontend route `/auth/callback` (handles Amazon redirect)
3. **Status:** `GET /api/sync/status` (Python or Node.js API)
4. **Connection Check:** `GET /api/v1/integrations/status` (optional, for checking if connected)

**Flow:**
1. User clicks "Connect Amazon" → Call endpoint 1 → Redirect to Amazon
2. Amazon redirects to `/auth/callback?code=...` → Show success → Redirect to status page
3. Status page → Call endpoint 3 → Display sync status (use mock data for now)

**Mock Data:**
- Use the mock data examples above when backend is unavailable
- Remove mock data indicators before production

---

## 📞 Support

If you encounter issues:
1. Check browser console for API errors
2. Verify base URLs are correct
3. Ensure authentication headers/cookies are included
4. Test endpoints directly with curl/Postman
5. Check backend logs for errors

**Ready to implement!** 🚀

