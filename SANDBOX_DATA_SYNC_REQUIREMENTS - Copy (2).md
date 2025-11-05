# Amazon SP-API Data Sync Requirements - Complete Analysis

## Executive Summary

The frontend expects **5 core sync endpoints** for Amazon SP-API data synchronization. The sync process fetches orders, inventory, and transaction data from Amazon, which then feeds into the **Phase 2: Autonomous Money Discovery** system for real-time claim detection.

---

## Required Sync Endpoints for Amazon SP-API

### 1. **POST `/api/sync/start`** ⚠️ CRITICAL

**Purpose**: Initiates a new Amazon data sync job. This triggers the backend to fetch orders, inventory, and transaction data from Amazon SP-API.

**Request**:
```http
POST https://opside-node-api.onrender.com/api/sync/start
Content-Type: application/json
Cookie: session_token=<JWT_TOKEN>

Body: (empty or optional)
{}
```

**Frontend Expectation**:
- Frontend sends: `POST` request (no body required, but accepts optional body)
- Headers: `Content-Type: application/json`
- Credentials: `include` (cookies sent automatically)
- Requires authentication (JWT cookie)

**Backend MUST**:
1. ✅ Validate JWT cookie authentication
2. ✅ Validate Amazon connection exists for the user
3. ✅ Create a new sync job (async/background task)
4. ✅ Return sync ID immediately (don't wait for sync to complete)
5. ✅ Trigger Amazon SP-API calls to fetch:
   - Orders (last 12 months on first sync, incremental afterwards)
   - Inventory data
   - Transaction data
   - Fee data
   - Reimbursement data

**Expected Response (200 OK)**:
```json
{
  "syncId": "sync_abc123xyz",
  "status": "in_progress",
  "message": "Sync started successfully"
}
```

**Status Codes**:
- `200` - Success (sync job created)
- `401` - Unauthenticated (missing/invalid cookie)
- `400` - Bad request (Amazon not connected, sync already in progress)
- `500` - Server error

**When Called**:
- User clicks "Start Sync" button on Sync page
- Automatic sync triggers (scheduled syncs)
- After successful Amazon connection

**Frontend Implementation** (`src/lib/inventoryApi.ts`):
```typescript
export const startSync = async (): Promise<{ syncId: string }> => {
  const response = await api.post('/api/sync/start');
  if (!response.ok) {
    throw new Error(response.error || 'Failed to start sync');
  }
  return response.data;
};
```

---

### 2. **GET `/api/sync/status/{syncId}`** ⚠️ REQUIRED

**Purpose**: Get the current status and progress of a sync job. Frontend polls this endpoint to show progress to users.

**Request**:
```http
GET https://opside-node-api.onrender.com/api/sync/status/sync_abc123xyz
Cookie: session_token=<JWT_TOKEN>
```

**Frontend Expectation**:
- Frontend sends: `GET` request with syncId in URL path
- Credentials: `include` (cookies sent automatically)
- Requires authentication
- Polled every 3 seconds while sync is in progress

**Backend MUST**:
1. ✅ Validate JWT cookie authentication
2. ✅ Validate syncId belongs to the authenticated user
3. ✅ Return current sync status and progress percentage
4. ✅ Include any error messages if sync failed

**Expected Response (200 OK)**:
```json
{
  "syncId": "sync_abc123xyz",
  "status": "in_progress",
  "progress": 45,
  "message": "Processing orders... 1,247 of 2,500 orders processed",
  "startedAt": "2024-01-15T12:00:00Z",
  "estimatedCompletion": "2024-01-15T12:05:00Z",
  "ordersProcessed": 1247,
  "totalOrders": 2500
}
```

**Status Values**:
- `idle` - Sync not started
- `in_progress` - Sync actively running
- `complete` - Sync finished successfully
- `failed` - Sync encountered an error
- `cancelled` - Sync was cancelled

**Status Codes**:
- `200` - Success (returns sync status)
- `401` - Unauthenticated
- `404` - Sync ID not found or doesn't belong to user
- `500` - Server error

**When Called**:
- Polled every 3 seconds while sync is active (`src/pages/Sync.tsx`)
- User manually checks sync status
- After sync completes (to show final status)

**Frontend Implementation** (`src/lib/inventoryApi.ts`):
```typescript
export const getSyncStatus = async (syncId: string): Promise<{ status: string; progress?: number }> => {
  const response = await api.get(`/api/sync/status/${syncId}`);
  if (!response.ok) {
    throw new Error(response.error || 'Failed to get sync status');
  }
  return response.data;
};
```

---

### 3. **GET `/api/sse/sync-progress/{syncId}`** ⚠️ RECOMMENDED (SSE)

**Purpose**: Server-Sent Events (SSE) endpoint for real-time sync progress updates. Preferred over polling for better UX.

**Request**:
```http
GET https://opside-node-api.onrender.com/api/sse/sync-progress/sync_abc123xyz
Cookie: session_token=<JWT_TOKEN>
```

**Frontend Expectation**:
- Frontend opens EventSource connection
- Credentials: `include` (cookies sent automatically)
- Requires authentication
- Receives real-time updates as sync progresses

**Backend MUST**:
1. ✅ Validate JWT cookie authentication
2. ✅ Validate syncId belongs to the authenticated user
3. ✅ Send SSE events with sync progress updates
4. ✅ Close connection when sync completes or fails

**Expected SSE Events**:
```javascript
// Progress update
data: {"syncId":"sync_abc123xyz","status":"in_progress","progress":45,"message":"Processing orders..."}

// Completion
data: {"syncId":"sync_abc123xyz","status":"complete","progress":100,"message":"Sync Complete"}

// Error
data: {"syncId":"sync_abc123xyz","status":"failed","progress":0,"message":"Failed to fetch orders: API rate limit exceeded"}
```

**When Called**:
- Automatically opened when sync starts (`src/pages/Sync.tsx`)
- Provides real-time updates without polling
- Falls back to polling if SSE fails

**Frontend Implementation** (`src/lib/inventoryApi.ts`):
```typescript
export const subscribeSyncProgress = (syncId: string, onUpdate: (data: any) => void) => {
  const url = api.buildApiUrl(`/api/sse/sync-progress/${syncId}`);
  const eventSource = new EventSource(url, { withCredentials: true } as any);
  eventSource.onmessage = (e) => {
    try { onUpdate(JSON.parse(e.data)); } catch { /* noop */ }
  };
  return () => eventSource.close();
};
```

---

### 4. **POST `/api/sync/cancel/{syncId}`** ⚠️ REQUIRED

**Purpose**: Cancel an in-progress sync job.

**Request**:
```http
POST https://opside-node-api.onrender.com/api/sync/cancel/sync_abc123xyz
Content-Type: application/json
Cookie: session_token=<JWT_TOKEN>

Body: (empty or optional)
{}
```

**Frontend Expectation**:
- Frontend sends: `POST` request with syncId in URL path
- Credentials: `include` (cookies sent automatically)
- Requires authentication

**Backend MUST**:
1. ✅ Validate JWT cookie authentication
2. ✅ Validate syncId belongs to the authenticated user
3. ✅ Cancel the sync job gracefully
4. ✅ Stop fetching from Amazon SP-API
5. ✅ Update sync status to `cancelled`

**Expected Response (200 OK)**:
```json
{
  "ok": true,
  "message": "Sync cancelled successfully"
}
```

**Status Codes**:
- `200` - Success (sync cancelled)
- `401` - Unauthenticated
- `404` - Sync ID not found or doesn't belong to user
- `400` - Sync already completed or cancelled
- `500` - Server error

**When Called**:
- User clicks "Cancel Sync" button
- User navigates away from sync page (optional)

**Frontend Implementation** (`src/lib/inventoryApi.ts`):
```typescript
export const cancelSync = async (syncId: string): Promise<void> => {
  const response = await api.post(`/api/sync/cancel/${syncId}`);
  if (!response.ok) {
    throw new Error(response.error || 'Failed to cancel sync');
  }
};
```

---

### 5. **GET `/api/sync/history`** ⚠️ REQUIRED

**Purpose**: Get historical sync jobs for the authenticated user.

**Request**:
```http
GET https://opside-node-api.onrender.com/api/sync/history
Cookie: session_token=<JWT_TOKEN>
```

**Frontend Expectation**:
- Frontend sends: `GET` request
- Credentials: `include` (cookies sent automatically)
- Requires authentication
- Optionally accepts query parameters for pagination/filtering

**Backend MUST**:
1. ✅ Validate JWT cookie authentication
2. ✅ Return list of sync jobs for the authenticated user
3. ✅ Include sync status, timestamps, and summary statistics

**Expected Response (200 OK)**:
```json
{
  "syncs": [
    {
      "syncId": "sync_abc123xyz",
      "status": "complete",
      "startedAt": "2024-01-15T12:00:00Z",
      "completedAt": "2024-01-15T12:05:00Z",
      "ordersProcessed": 2500,
      "claimsDetected": 58,
      "duration": 300
    },
    {
      "syncId": "sync_def456uvw",
      "status": "failed",
      "startedAt": "2024-01-14T10:00:00Z",
      "error": "API rate limit exceeded",
      "ordersProcessed": 500,
      "duration": 120
    }
  ],
  "total": 2
}
```

**Status Codes**:
- `200` - Success (returns sync history)
- `401` - Unauthenticated
- `500` - Server error

**When Called**:
- User views sync history page
- Dashboard displays recent syncs

**Frontend Implementation** (`src/lib/inventoryApi.ts`):
```typescript
export const getSyncHistory = async () => {
  const response = await api.get('/api/sync/history');
  if (!response.ok) {
    throw new Error(response.error || 'Failed to fetch sync history');
  }
  return response.data;
};
```

---

### 6. **GET `/api/sync/status`** ⚠️ OPTIONAL (General Status)

**Purpose**: Get current sync status (latest sync or general status) without needing a specific syncId.

**Request**:
```http
GET https://opside-node-api.onrender.com/api/sync/status
Cookie: session_token=<JWT_TOKEN>
```

**Expected Response (200 OK)**:
```json
{
  "hasActiveSync": false,
  "lastSync": {
    "syncId": "sync_abc123xyz",
    "status": "complete",
    "completedAt": "2024-01-15T12:05:00Z"
  },
  "nextScheduledSync": "2024-01-16T02:00:00Z"
}
```

**When Called**:
- Dashboard displays sync status
- Check if sync is already running before starting new one

**Frontend Implementation** (`src/lib/api.ts`):
```typescript
getSyncStatus: () => requestJson<any>('/api/sync/status'),
```

---

### 7. **GET `/api/sync/activity`** ⚠️ OPTIONAL (Activity Feed)

**Purpose**: Get sync activity feed (recent sync events, claims detected, etc.).

**Request**:
```http
GET https://opside-node-api.onrender.com/api/sync/activity
Cookie: session_token=<JWT_TOKEN>
```

**Expected Response (200 OK)**:
```json
{
  "activities": [
    {
      "type": "sync_completed",
      "timestamp": "2024-01-15T12:05:00Z",
      "message": "Sync completed: 2,500 orders processed, 58 claims detected"
    },
    {
      "type": "claim_detected",
      "timestamp": "2024-01-15T12:03:00Z",
      "message": "High-confidence claim detected: Lost inventory, Order #123-4567890-1234567"
    }
  ]
}
```

**When Called**:
- Dashboard activity feed
- Sync history page

**Frontend Implementation** (`src/lib/api.ts`):
```typescript
getSyncActivity: () => requestJson<any>('/api/sync/activity'),
```

---

## Complete Sync Flow: Frontend to Backend

### Phase 1: User Initiates Sync

```
1. User clicks "Start Sync" button (or sync auto-triggers)
   ↓
2. Frontend calls: POST /api/sync/start
   Cookie: session_token=<JWT>
   ↓
3. BACKEND MUST:
   - Validate JWT cookie
   - Check Amazon connection exists
   - Create sync job (async)
   - Return syncId immediately
   ↓
4. Frontend receives: {"syncId": "sync_abc123xyz"}
   ↓
5. Frontend navigates to: /sync?id=sync_abc123xyz
```

### Phase 2: Real-Time Progress Updates

```
6. Frontend opens SSE connection: GET /api/sse/sync-progress/sync_abc123xyz
   Cookie: session_token=<JWT>
   ↓
7. BACKEND MUST:
   - Validate JWT cookie
   - Validate syncId belongs to user
   - Start fetching from Amazon SP-API:
     * GET /orders/v0/orders (last 12 months on first sync)
     * GET /finances/v0/financialEvents
     * GET /fba/inventory/v1/summaries
     * GET /fees/v0/feesEstimate
   - Send SSE progress updates:
     {"status": "in_progress", "progress": 45, "message": "Processing orders..."}
   ↓
8. Frontend receives real-time updates via SSE
   - Updates progress bar
   - Shows current status message
   ↓
9. (Fallback) Frontend also polls: GET /api/sync/status/sync_abc123xyz
   - Polled every 3 seconds
   - Used if SSE fails or unavailable
```

### Phase 3: Sync Completion & Phase 2 Activation

```
10. Backend completes sync:
    - All orders fetched and stored
    - All inventory data processed
    - All transaction data loaded
    ↓
11. BACKEND TRIGGERS Phase 2: Autonomous Money Discovery
    - Claim Detector Model scans all orders
    - ML Confidence Scoring:
      * High confidence (85%+): AUTO-SUBMIT claims
      * Medium confidence (50-85%): SMART PROMPTS (user review)
      * Low confidence (<50%): MANUAL REVIEW queue
    - Evidence Validator checks each claim:
      * Required documents: Available?
      * Amazon compliance: Verified?
      * Success probability: Calculated
    ↓
12. Backend sends SSE completion event:
    {"status": "complete", "progress": 100, "message": "Sync Complete"}
    ↓
13. Frontend receives completion:
    - Shows "Sync Complete" message
    - Redirects to dashboard after 1.5 seconds
    - Dashboard displays:
      * New claims detected
      * Recovery amounts
      * Auto-submitted claims (high confidence)
      * Claims requiring review (medium/low confidence)
```

---

## Phase 2: Autonomous Money Discovery - Backend Requirements

### What Happens After Sync Completes

The backend MUST automatically trigger claim detection after sync completes:

**1. Claim Detector Model Scans Orders**:
```javascript
// Backend pseudo-code
async function processSyncCompletion(syncId) {
  const orders = await getOrdersFromSync(syncId);
  const claims = await claimDetector.scan(orders);
  
  // claims = [
  //   { type: "lost_inventory", orderId: "...", confidence: 0.92, ... },
  //   { type: "damaged_goods", orderId: "...", confidence: 0.78, ... },
  //   { type: "fee_overcharge", orderId: "...", confidence: 0.65, ... },
  //   { type: "missing_reimbursement", orderId: "...", confidence: 0.45, ... }
  // ]
}
```

**2. ML Confidence Scoring**:
```javascript
// High confidence (85%+): AUTO-SUBMIT
const highConfidenceClaims = claims.filter(c => c.confidence >= 0.85);
await Promise.all(highConfidenceClaims.map(claim => 
  autoSubmitClaim(claim)
));

// Medium confidence (50-85%): SMART PROMPTS (user review)
const mediumConfidenceClaims = claims.filter(c => 
  c.confidence >= 0.50 && c.confidence < 0.85
);
await Promise.all(mediumConfidenceClaims.map(claim => 
  createReviewPrompt(claim)
));

// Low confidence (<50%): MANUAL REVIEW queue
const lowConfidenceClaims = claims.filter(c => c.confidence < 0.50);
await Promise.all(lowConfidenceClaims.map(claim => 
  addToManualReviewQueue(claim)
));
```

**3. Evidence Validator**:
```javascript
for (const claim of claims) {
  const validation = await evidenceValidator.validate(claim);
  // validation = {
  //   requiredDocuments: "Available",
  //   amazonCompliance: "Verified",
  //   successProbability: 0.87
  // }
}
```

### Frontend Expectations for Phase 2

**Dashboard Displays** (`src/components/layout/Dashboard.tsx`):
- Total recovery amount: `GET /api/v1/integrations/amazon/recoveries`
- Metrics: `GET /api/metrics/recoveries`
- Real-time updates via SSE: `GET /api/sse/status`

**Expected Endpoints Called After Sync**:
1. `GET /api/v1/integrations/amazon/recoveries` - Show total recovery amount
2. `GET /api/metrics/recoveries` - Show metrics (pending, approved, success rate)
3. `GET /api/sse/status` - Listen for real-time claim detection events
4. `GET /api/recoveries` - List all detected claims (for review)

---

## Amazon SP-API Endpoints Backend Should Call

For sandbox, the backend should use Amazon SP-API sandbox endpoints:

### Orders API
- **GET `/orders/v0/orders`** - Fetch orders (last 12 months on first sync)
  - Query params: `CreatedAfter`, `CreatedBefore`, `MarketplaceIds`
  - Sandbox: Returns mock order data

### Finances API
- **GET `/finances/v0/financialEvents`** - Fetch financial transactions
  - Query params: `PostedAfter`, `PostedBefore`
  - Sandbox: Returns mock financial events

### Inventory API
- **GET `/fba/inventory/v1/summaries`** - Fetch FBA inventory summaries
  - Query params: `marketplaceIds`, `sellerSkus`
  - Sandbox: Returns mock inventory data

### Fees API
- **GET `/fees/v0/feesEstimate`** - Estimate fees for orders
  - Body: `FeeEstimateRequest`
  - Sandbox: Returns mock fee estimates

### Reimbursements API (if available)
- **GET `/finances/v0/reimbursements`** - Fetch reimbursement data
  - Sandbox: Returns mock reimbursement data

---

## Data Sync Summary

### What Data is Synced?

1. **Orders** (last 12 months on first sync, incremental afterwards)
   - Order IDs
   - Order dates
   - Order status
   - Order items
   - Shipping information
   - Customer information

2. **Inventory** (FBA inventory summaries)
   - SKU information
   - Quantity available
   - Quantity reserved
   - Quantity unsellable
   - Inbound shipments

3. **Financial Transactions**
   - Fees charged
   - Refunds issued
   - Reimbursements received
   - Chargebacks
   - Payments

4. **Fee Data**
   - FBA fees
   - Referral fees
   - Shipping fees
   - Storage fees
   - Other fees

### Sync Schedule

- **First Sync**: Last 12 months of data
- **Subsequent Syncs**: 
  - Incremental updates (new orders since last sync)
  - Scheduled: Daily at 02:00 UTC (configurable)
  - Manual: User can trigger at any time

---

## Frontend Sync Implementation Details

### Sync Page (`src/pages/Sync.tsx`)

```typescript
// Auto-starts sync if no syncId provided
useEffect(() => {
  if (!syncId) {
    startSync().then(res => setSyncId(res.syncId));
  }
  
  // Prefer SSE, fallback to polling
  if (syncId) {
    subscribeSyncProgress(syncId, (s) => {
      setProgress(s.progress);
      setMessage(s.message);
      if (s.status === 'complete') {
        setTimeout(() => navigate('/app'), 1500);
      }
    });
  }
  
  // Fallback polling every 3 seconds
  const interval = setInterval(() => {
    getSyncStatus(syncId).then(s => {
      setProgress(s.progress);
      setMessage(s.message);
      if (s.status === 'complete') {
        clearInterval(interval);
        setTimeout(() => navigate('/app'), 1500);
      }
    });
  }, 3000);
}, [syncId]);
```

### Dashboard Real-Time Updates (`src/components/layout/Dashboard.tsx`)

```typescript
// Listen for sync/detection events
useEffect(() => {
  const es = new EventSource('/api/sse/status');
  es.onmessage = async (e) => {
    const evt = JSON.parse(e.data);
    if (evt?.type === 'sync' || evt?.type === 'detection') {
      // Refresh recovery metrics
      await fetchRecoveriesOnce();
      await fetchMetrics();
    }
  };
}, []);
```

---

## Testing Checklist

### Backend Implementation Checklist:

- [ ] `POST /api/sync/start` accepts POST with JWT cookie
- [ ] `POST /api/sync/start` validates Amazon connection exists
- [ ] `POST /api/sync/start` creates async sync job
- [ ] `POST /api/sync/start` returns syncId immediately
- [ ] `GET /api/sync/status/{syncId}` validates JWT cookie
- [ ] `GET /api/sync/status/{syncId}` returns sync status and progress
- [ ] `GET /api/sse/sync-progress/{syncId}` validates JWT cookie
- [ ] `GET /api/sse/sync-progress/{syncId}` sends SSE events
- [ ] `POST /api/sync/cancel/{syncId}` cancels sync gracefully
- [ ] `GET /api/sync/history` returns sync history for user
- [ ] Sync job fetches orders from Amazon SP-API
- [ ] Sync job fetches inventory from Amazon SP-API
- [ ] Sync job fetches financial transactions from Amazon SP-API
- [ ] Sync job triggers Phase 2 claim detection after completion
- [ ] Phase 2 auto-submits high-confidence claims (85%+)
- [ ] Phase 2 creates review prompts for medium-confidence claims (50-85%)
- [ ] Phase 2 adds low-confidence claims (<50%) to manual review queue
- [ ] Evidence validator checks each claim
- [ ] SSE events are sent for sync progress and completion
- [ ] All endpoints return 401 when unauthenticated

---

## Summary

**For Amazon SP-API Data Sync to work, backend MUST**:

1. ✅ **POST `/api/sync/start`**:
   - Accept POST with JWT cookie
   - Create async sync job
   - Return syncId immediately
   - Fetch orders, inventory, financial data from Amazon SP-API

2. ✅ **GET `/api/sync/status/{syncId}`**:
   - Validate JWT cookie
   - Return sync status and progress (0-100%)
   - Include progress message

3. ✅ **GET `/api/sse/sync-progress/{syncId}`** (Recommended):
   - Validate JWT cookie
   - Send real-time SSE events with progress updates
   - Close connection on completion

4. ✅ **POST `/api/sync/cancel/{syncId}`**:
   - Cancel sync gracefully
   - Update status to `cancelled`

5. ✅ **GET `/api/sync/history`**:
   - Return sync history for authenticated user

6. ✅ **Phase 2: Autonomous Money Discovery**:
   - Trigger automatically after sync completes
   - Scan orders with Claim Detector Model
   - Score claims with ML confidence (0-100%)
   - Auto-submit high-confidence claims (85%+)
   - Create review prompts for medium-confidence (50-85%)
   - Add low-confidence (<50%) to manual review queue
   - Validate evidence for each claim

**If these are implemented correctly, the sync flow will work end-to-end and Phase 2 will automatically detect and process claims.**

