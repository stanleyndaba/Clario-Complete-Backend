# Complete Sync System Documentation

## 🎯 Overview

The Clario sync system is a comprehensive data synchronization pipeline that fetches data from Amazon SP-API (Seller Partner API), normalizes it, stores it in the database, and triggers automated claim detection. The system supports both **sandbox mode** (for testing with mock data) and **production mode** (with real Amazon data).

---

## 📡 API Endpoints for Frontend

### Core Sync Endpoints

#### 1. **POST `/api/sync/start`** - Start Sync
**Purpose**: Initiates a new Amazon data sync job.

**Request**:
```http
POST /api/sync/start
Content-Type: application/json
Cookie: session_token=<JWT_TOKEN>
```

**Response** (200 OK):
```json
{
  "syncId": "sync_user123_1702345678901",
  "status": "running",
  "message": "Sync started successfully"
}
```

**Status Codes**:
- `200` - Success (sync job created)
- `401` - Unauthenticated (missing/invalid JWT)
- `400` - Bad request (Amazon not connected, sync already in progress)
- `500` - Server error

**What It Does**:
1. Validates user authentication (JWT token)
2. Checks if Amazon account is connected (database token or environment variables)
3. Creates a new sync job (async background task)
4. Returns `syncId` immediately (doesn't wait for sync to complete)
5. Triggers Amazon SP-API calls to fetch:
   - Claims (reimbursement requests)
   - Inventory data (FBA inventory levels)
   - Fee data (FBA fees, referral fees, storage fees)
   - Financial events (transactions, payments, refunds)
   - Order data (orders, shipments, returns)

---

#### 2. **GET `/api/sync/status`** - Get Active Sync Status
**Purpose**: Get the current active sync status for the authenticated user.

**Request**:
```http
GET /api/sync/status
Cookie: session_token=<JWT_TOKEN>
```

**Response** (200 OK):
```json
{
  "hasActiveSync": true,
  "lastSync": {
    "syncId": "sync_user123_1702345678901",
    "status": "running",
    "progress": 65,
    "message": "Processing sync data...",
    "startedAt": "2025-11-11T12:00:00Z",
    "ordersProcessed": 150,
    "totalOrders": 250,
    "claimsDetected": 5
  }
}
```

**Response** (200 OK - No Active Sync):
```json
{
  "hasActiveSync": false,
  "lastSync": null
}
```

---

#### 3. **GET `/api/sync/status/:syncId`** - Get Sync Status by ID
**Purpose**: Get detailed status of a specific sync job.

**Request**:
```http
GET /api/sync/status/sync_user123_1702345678901
Cookie: session_token=<JWT_TOKEN>
```

**Response** (200 OK):
```json
{
  "success": true,
  "syncId": "sync_user123_1702345678901",
  "status": "running",
  "progress": 65,
  "message": "Processing sync data...",
  "startedAt": "2025-11-11T12:00:00Z",
  "completedAt": null,
  "ordersProcessed": 150,
  "totalOrders": 250,
  "claimsDetected": 5,
  "error": null
}
```

**Status Values**:
- `idle` - No sync running
- `running` - Sync in progress
- `completed` - Sync completed successfully
- `failed` - Sync failed
- `cancelled` - Sync was cancelled

---

#### 4. **GET `/api/sync/history`** - Get Sync History
**Purpose**: Get sync history for the authenticated user.

**Request**:
```http
GET /api/sync/history?limit=20&offset=0
Cookie: session_token=<JWT_TOKEN>
```

**Query Parameters**:
- `limit` (optional): Number of syncs to return (default: 20)
- `offset` (optional): Pagination offset (default: 0)

**Response** (200 OK):
```json
{
  "success": true,
  "history": [
    {
      "syncId": "sync_user123_1702345678901",
      "status": "completed",
      "startedAt": "2025-11-11T12:00:00Z",
      "completedAt": "2025-11-11T12:05:00Z",
      "ordersProcessed": 250,
      "claimsDetected": 5,
      "duration": 300,
      "error": null
    }
  ],
  "total": 1
}
```

---

#### 5. **POST `/api/sync/cancel/:syncId`** - Cancel Sync
**Purpose**: Cancel a running sync job.

**Request**:
```http
POST /api/sync/cancel/sync_user123_1702345678901
Cookie: session_token=<JWT_TOKEN>
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Sync cancelled successfully"
}
```

---

#### 6. **GET `/api/v1/integrations/sync/statistics`** - Get Sync Statistics
**Purpose**: Get aggregated sync statistics.

**Request**:
```http
GET /api/v1/integrations/sync/statistics
Cookie: session_token=<JWT_TOKEN>
```

**Response** (200 OK):
```json
{
  "success": true,
  "statistics": {
    "totalSyncs": 10,
    "successfulSyncs": 8,
    "failedSyncs": 1,
    "cancelledSyncs": 1,
    "runningSyncs": 0,
    "totalOrdersProcessed": 2500,
    "totalClaimsDetected": 50
  }
}
```

---

### Enhanced Sync Endpoints (Aliases)

#### 7. **POST `/api/v1/integrations/sync/start`** - Start Enhanced Sync
**Alias**: Same as `POST /api/sync/start`

#### 8. **GET `/api/v1/integrations/sync/status/:syncId`** - Get Enhanced Sync Status
**Alias**: Same as `GET /api/sync/status/:syncId`

#### 9. **GET `/api/v1/integrations/sync/history`** - Get Enhanced Sync History
**Alias**: Same as `GET /api/sync/history`

---

### Server-Sent Events (SSE) - Real-Time Updates

#### 10. **GET `/api/sse/sync-progress/:syncId`** - Sync Progress Stream
**Purpose**: Real-time sync progress updates via Server-Sent Events.

**Request**:
```http
GET /api/sse/sync-progress/sync_user123_1702345678901
Cookie: session_token=<JWT_TOKEN>
```

**Response** (Event Stream):
```
data: {"type":"sync_progress","syncId":"sync_user123_1702345678901","progress":65,"status":"running","message":"Processing sync data..."}

data: {"type":"sync_progress","syncId":"sync_user123_1702345678901","progress":90,"status":"running","message":"Waiting for discrepancy detection..."}

data: {"type":"sync_complete","syncId":"sync_user123_1702345678901","progress":100,"status":"completed","claimsDetected":5}
```

**Frontend Usage**:
```typescript
const eventSource = new EventSource(`/api/sse/sync-progress/${syncId}`, {
  withCredentials: true // Important: sends cookies
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Sync progress:', data.progress, data.message);
  
  if (data.status === 'completed') {
    eventSource.close();
    // Refresh data
  }
};
```

---

## 🔄 How Sync Works

### Sync Flow Diagram

```
User clicks "Start Sync"
    ↓
POST /api/sync/start
    ↓
Backend validates authentication & Amazon connection
    ↓
Creates sync job (syncId generated)
    ↓
Returns syncId immediately (async processing)
    ↓
┌─────────────────────────────────────┐
│  Background Sync Process            │
├─────────────────────────────────────┤
│  1. Fetch Claims from SP-API        │
│  2. Fetch Inventory from SP-API     │
│  3. Fetch Fees from SP-API          │
│  4. Fetch Financial Events          │
│  5. Store data in Supabase          │
│  6. Trigger Detection Job           │
│  7. Wait for Detection Completion   │
│  8. Update Sync Status: Completed   │
└─────────────────────────────────────┘
    ↓
Frontend polls GET /api/sync/status/:syncId
    OR
Frontend listens to SSE stream
    ↓
Sync completes → Frontend refreshes data
```

### Step-by-Step Sync Process

#### Step 1: Sync Initialization (0-10%)
- User triggers sync via `POST /api/sync/start`
- Backend creates sync job with unique `syncId`
- Sync status stored in database (`sync_progress` table)
- Progress: 10% - "Sync starting..."

#### Step 2: Fetch Inventory Data (10-30%)
- Calls Amazon SP-API to fetch inventory data
- Retrieves FBA inventory levels, SKUs, ASINs
- Stores in `financial_events` table
- Progress: 30% - "Fetching inventory from SP-API..."

#### Step 3: Fetch Claims Data (30-50%)
- Calls Amazon SP-API to fetch reimbursement claims
- Retrieves claim status, amounts, order IDs
- Stores in database
- Progress: 50% - "Fetching claims data..."

#### Step 4: Fetch Fees Data (50-60%)
- Calls Amazon SP-API to fetch fee data
- Retrieves FBA fees, referral fees, storage fees
- Stores in `financial_events` table
- Progress: 60% - "Processing sync data..."

#### Step 5: Process Financial Events (60-90%)
- Ingests financial events from SP-API
- Normalizes data into unified schema
- Stores in `financial_events` table
- Progress: 90% - "Waiting for discrepancy detection..."

#### Step 6: Trigger Detection Job (90-95%)
- Enqueues detection job in `detection_queue` table
- Detection service processes financial events
- Runs claim detection algorithms
- Polls for detection completion (up to 60 seconds)
- Progress: 95% - "Finalizing sync..."

#### Step 7: Sync Completion (95-100%)
- Retrieves detection results from `detection_results` table
- Updates sync status with `claimsDetected` count
- Marks sync as `completed`
- Sends completion notification via SSE
- Progress: 100% - "Sync completed successfully - X discrepancies detected"

---

## 🌐 Amazon SP-API Sandbox Mode

### What is Sandbox Mode?

**Sandbox mode** uses Amazon's test environment (`https://sandbox.sellingpartnerapi-na.amazon.com`) which returns **mock/test data** instead of real production data. This is used for development and testing.

### How Sandbox Mode Works

1. **Environment Detection**:
   - Backend checks `AMAZON_SPAPI_BASE_URL` environment variable
   - If URL contains `sandbox`, sandbox mode is enabled
   - Default: Sandbox mode (if no URL specified)

2. **Sandbox Data**:
   - Returns test/mock data from Amazon's sandbox environment
   - May return empty arrays or limited test data
   - **This is normal for testing** - sandbox doesn't have real seller data

3. **Sandbox Limitations**:
   - No real seller data
   - Limited test data available
   - Some endpoints may return empty responses
   - Rate limits are more lenient

### Switching Between Sandbox and Production

**Sandbox Mode** (Default):
```bash
# Environment variable (optional - defaults to sandbox)
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
```

**Production Mode**:
```bash
# Set production URL
AMAZON_SPAPI_BASE_URL=https://sellingpartnerapi-na.amazon.com
```

### Authentication in Sandbox Mode

The system supports two authentication methods:

1. **Database Token** (Production):
   - User completes Amazon OAuth
   - Access token stored in `tokens` table
   - Used for real seller accounts

2. **Environment Variables** (Sandbox/Testing):
   - `AMAZON_SPAPI_REFRESH_TOKEN` - Refresh token from Amazon
   - `AMAZON_SPAPI_CLIENT_ID` - Client ID from Amazon
   - `AMAZON_SPAPI_CLIENT_SECRET` - Client secret from Amazon
   - Used for sandbox/testing when no database token exists

---

## ⏰ When Does Sync Happen?

### Manual Sync (User-Triggered)

1. **User clicks "Start Sync" button** on the Sync page
2. **After Amazon OAuth connection** - Automatic sync triggered
3. **User clicks "Sync Now"** on dashboard

### Automatic Sync (Scheduled)

**Currently**: Manual sync only (scheduled syncs can be implemented)

**Planned**: 
- Daily sync at 02:00 UTC (configurable)
- Incremental syncs (only new data since last sync)
- Full historical sync on first connection (18 months of data)

### Sync Triggers

1. **User Action**:
   - Click "Start Sync" button
   - Click "Sync Now" on dashboard
   - Navigate to Sync page (auto-start if no sync running)

2. **System Events**:
   - After Amazon OAuth completion
   - After successful Amazon connection
   - Scheduled cron job (future implementation)

3. **API Calls**:
   - `POST /api/sync/start` - Manual trigger
   - `POST /api/sync/force` - Force sync (same as start)

---

## 🔄 Continuous Data Sync (Background Workers)

### Overview

The system is designed to support **continuous data sync** where background workers periodically pull FBA reports (inventory, fees, reimbursements, shipments, returns) and keep the data up-to-date.

### Current Implementation

**Status**: Manual sync only (continuous sync is planned but not yet implemented)

### Planned Continuous Sync Architecture

```
┌─────────────────────────────────────────────────┐
│  Background Worker (Cron Job)                   │
│  Runs every 5 minutes (configurable)            │
├─────────────────────────────────────────────────┤
│  1. Check for new data since last sync          │
│  2. Fetch incremental updates from SP-API       │
│  3. Normalize data into unified schema          │
│  4. Store in database                           │
│  5. Trigger detection if new discrepancies      │
│  6. Update "Last Pulled" timestamps             │
└─────────────────────────────────────────────────┘
```

### Data Source Health Status

The frontend displays **Data Source Health** for each data source:

1. **Shipment Data**:
   - Status: "Connected & Syncing"
   - Last Pulled: "2 minutes ago"
   - Source: Amazon SP-API Shipments API

2. **Fulfillment Center Data**:
   - Status: "Connected & Syncing"
   - Last Pulled: "5 minutes ago"
   - Source: Amazon SP-API Inventory API

3. **Sales & Order Data**:
   - Status: "Connected & Syncing"
   - Last Pulled: "1 minute ago"
   - Source: Amazon SP-API Orders API

4. **Returns Data**:
   - Status: "Connected & Syncing"
   - Last Pulled: "3 minutes ago"
   - Source: Amazon SP-API Returns API

### Frontend Data Source Health Endpoint

**Note**: This endpoint doesn't exist yet - it needs to be implemented.

**Proposed Endpoint**: `GET /api/sync/data-sources/health`

**Response**:
```json
{
  "success": true,
  "dataSources": [
    {
      "name": "Shipment Data",
      "status": "connected",
      "lastPulled": "2025-11-11T12:42:00Z",
      "lastPulledAgo": "2 minutes ago",
      "source": "amazon_spapi_shipments",
      "syncEnabled": true
    },
    {
      "name": "Fulfillment Center Data",
      "status": "connected",
      "lastPulled": "2025-11-11T12:40:00Z",
      "lastPulledAgo": "5 minutes ago",
      "source": "amazon_spapi_inventory",
      "syncEnabled": true
    },
    {
      "name": "Sales & Order Data",
      "status": "connected",
      "lastPulled": "2025-11-11T12:43:00Z",
      "lastPulledAgo": "1 minute ago",
      "source": "amazon_spapi_orders",
      "syncEnabled": true
    },
    {
      "name": "Returns Data",
      "status": "connected",
      "lastPulled": "2025-11-11T12:41:00Z",
      "lastPulledAgo": "3 minutes ago",
      "source": "amazon_spapi_returns",
      "syncEnabled": true
    }
  ]
}
```

**Implementation**: 
- Query `sync_progress` table for last sync timestamps
- Calculate "last pulled ago" (e.g., "2 minutes ago")
- Return status based on last sync time (connected/disconnected)

---

## 📊 Data Flow: SP-API → Database → Detection

### Step 1: Data Fetching (SP-API)

```
Amazon SP-API (Sandbox/Production)
    ↓
Backend calls SP-API endpoints:
    - GET /fba/inventory/v1/summaries (Inventory)
    - GET /finances/v0/financialEvents (Financial Events)
    - GET /orders/v0/orders (Orders)
    - GET /fba/inbound/v0/shipments (Shipments)
    - GET /fba/inbound/v0/returns (Returns)
    ↓
SP-API returns JSON data
```

### Step 2: Data Normalization

```
Raw SP-API JSON Data
    ↓
Normalization Layer (amazonService.ts)
    - Converts SP-API format to Clario schema
    - Maps fields (e.g., SKU → sku, ASIN → asin)
    - Handles different data types
    - Validates data integrity
    ↓
Unified Data Schema
```

### Step 3: Database Storage

```
Unified Data Schema
    ↓
Stored in Supabase:
    - financial_events table (orders, fees, transactions)
    - inventory table (inventory levels, SKUs)
    - claims table (reimbursement claims)
    - sync_progress table (sync status, progress)
    ↓
Data Persisted in Database
```

### Step 4: Detection Trigger

```
Data in Database
    ↓
Detection Job Enqueued (detection_queue table)
    ↓
Detection Service Processes:
    - Analyzes financial events
    - Identifies discrepancies
    - Calculates claim amounts
    - Generates confidence scores
    ↓
Detection Results Stored (detection_results table)
```

### Step 5: Frontend Display

```
Detection Results
    ↓
Frontend fetches via API:
    - GET /api/detections/results
    - GET /api/recoveries
    ↓
Frontend displays:
    - Claims detected count
    - Total recoverable amount
    - Discrepancy details
```

---

## 🗄️ Database Schema

### `sync_progress` Table

```sql
CREATE TABLE sync_progress (
  id UUID PRIMARY KEY,
  sync_id VARCHAR(255) UNIQUE NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'idle', 'running', 'completed', 'failed', 'cancelled'
  progress INTEGER DEFAULT 0, -- 0-100
  message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  orders_processed INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  claims_detected INTEGER DEFAULT 0,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### `detection_queue` Table

```sql
CREATE TABLE detection_queue (
  id UUID PRIMARY KEY,
  seller_id VARCHAR(255) NOT NULL,
  sync_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
  priority INTEGER DEFAULT 1,
  payload JSONB,
  is_sandbox BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);
```

### `detection_results` Table

```sql
CREATE TABLE detection_results (
  id UUID PRIMARY KEY,
  seller_id VARCHAR(255) NOT NULL,
  sync_id VARCHAR(255) NOT NULL,
  anomaly_type VARCHAR(50) NOT NULL, -- 'missing_unit', 'overcharge', 'damaged_stock', etc.
  severity VARCHAR(50) NOT NULL, -- 'low', 'medium', 'high', 'critical'
  estimated_value DECIMAL(10, 2),
  currency VARCHAR(10) DEFAULT 'USD',
  confidence_score DECIMAL(5, 2), -- 0.00-1.00
  evidence JSONB,
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'reviewed', 'disputed', 'resolved'
  discovery_date TIMESTAMP,
  deadline_date TIMESTAMP, -- 60 days from discovery
  days_remaining INTEGER,
  expired BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### `financial_events` Table

```sql
CREATE TABLE financial_events (
  id UUID PRIMARY KEY,
  seller_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- 'Order', 'Fee', 'Refund', 'Shipment', etc.
  event_id VARCHAR(255) UNIQUE NOT NULL,
  order_id VARCHAR(255),
  sku VARCHAR(255),
  asin VARCHAR(255),
  amount DECIMAL(10, 2),
  currency VARCHAR(10) DEFAULT 'USD',
  quantity INTEGER,
  event_date TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔍 Detection Process

### How Detection Works

1. **Sync Completes** → Detection job enqueued
2. **Detection Service** processes financial events
3. **Algorithms** identify discrepancies:
   - Missing units (inventory discrepancies)
   - Overcharges (fee discrepancies)
   - Damaged stock (inventory condition issues)
   - Incorrect fees (fee calculation errors)
   - Duplicate charges (duplicate transactions)
4. **Claim Detector API** (Python) scores each discrepancy
5. **Results** stored in `detection_results` table
6. **Frontend** displays claims detected count

### Detection Algorithms

1. **Inventory Reconciliation**:
   - Compares shipped inventory vs. received inventory
   - Identifies missing units
   - Calculates claim amounts

2. **Fee Analysis**:
   - Analyzes FBA fees for overcharges
   - Compares expected fees vs. actual fees
   - Identifies duplicate charges

3. **Financial Event Analysis**:
   - Analyzes transactions for discrepancies
   - Identifies missing reimbursements
   - Calculates recoverable amounts

### Claim Detector API

**Endpoint**: `POST /api/v1/claim-detector/predict/batch`

**Purpose**: Scores discrepancies and calculates claim probabilities

**Request**:
```json
{
  "claims": [
    {
      "claim_id": "claim_123",
      "seller_id": "user123",
      "order_id": "ORDER123",
      "category": "inventory_loss",
      "reason_code": "LOST_INVENTORY",
      "amount": 100.00,
      "days_since_order": 30,
      "description": "Missing inventory unit"
    }
  ]
}
```

**Response**:
```json
{
  "predictions": [
    {
      "claim_id": "claim_123",
      "claimable": true,
      "probability": 0.85,
      "confidence": 0.90,
      "feature_contributions": [...],
      "model_components": {...}
    }
  ],
  "batch_metrics": {
    "total_claims": 1,
    "claimable_count": 1,
    "high_confidence_count": 1,
    "avg_probability": 0.85
  }
}
```

---

## 🎨 Frontend Integration

### Sync Page (`/sync`)

**Features**:
1. **Start Sync Button**: Triggers `POST /api/sync/start`
2. **Progress Bar**: Shows sync progress (0-100%)
3. **Status Message**: Displays current sync message
4. **Sync History**: Shows previous syncs
5. **Real-Time Updates**: Uses SSE or polling

**Implementation**:
```typescript
// Start sync
const startSync = async () => {
  const response = await fetch('/api/sync/start', {
    method: 'POST',
    credentials: 'include' // Important: sends cookies
  });
  const data = await response.json();
  setSyncId(data.syncId);
};

// Poll for status
const pollSyncStatus = async (syncId: string) => {
  const response = await fetch(`/api/sync/status/${syncId}`, {
    credentials: 'include'
  });
  const data = await response.json();
  setProgress(data.progress);
  setMessage(data.message);
  
  if (data.status === 'completed') {
    // Refresh data
    fetchRecoveries();
    fetchMetrics();
  }
};

// Or use SSE
const eventSource = new EventSource(`/api/sse/sync-progress/${syncId}`, {
  withCredentials: true
});
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  setProgress(data.progress);
  setMessage(data.message);
};
```

### Dashboard Sync Status

**Features**:
1. **Active Sync Indicator**: Shows if sync is running
2. **Last Sync Time**: Displays last sync timestamp
3. **Sync Now Button**: Triggers manual sync
4. **Claims Detected**: Shows claims detected count

**Implementation**:
```typescript
// Check for active sync
const checkSyncStatus = async () => {
  const response = await fetch('/api/sync/status', {
    credentials: 'include'
  });
  const data = await response.json();
  
  if (data.hasActiveSync) {
    setActiveSyncId(data.lastSync.syncId);
    // Start polling or SSE
  }
};
```

### Data Source Health Display

**Frontend Display**:
```
All Systems Synced & Reconciled
Your inventory data is being continuously monitored and reconciled

Data Source Health
┌─────────────────────────────────────┐
│ Shipment Data                       │
│ Connected & Syncing                 │
│ Last Pulled: 2 minutes ago          │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Fulfillment Center Data             │
│ Connected & Syncing                 │
│ Last Pulled: 5 minutes ago          │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Sales & Order Data                  │
│ Connected & Syncing                 │
│ Last Pulled: 1 minute ago           │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Returns Data                        │
│ Connected & Syncing                 │
│ Last Pulled: 3 minutes ago          │
└─────────────────────────────────────┘
```

**Backend Endpoint** (To be implemented):
```typescript
GET /api/sync/data-sources/health
```

**Implementation**:
```typescript
// Query last sync timestamps from sync_progress table
// Calculate "last pulled ago" (e.g., "2 minutes ago")
// Return status for each data source
```

---

## 🚀 Quick Start Guide

### For Frontend Developers

1. **Start a Sync**:
   ```typescript
   const response = await fetch('/api/sync/start', {
     method: 'POST',
     credentials: 'include'
   });
   const { syncId } = await response.json();
   ```

2. **Poll for Status**:
   ```typescript
   const interval = setInterval(async () => {
     const response = await fetch(`/api/sync/status/${syncId}`, {
       credentials: 'include'
     });
     const status = await response.json();
     
     if (status.status === 'completed') {
       clearInterval(interval);
       // Refresh data
     }
   }, 3000);
   ```

3. **Use SSE for Real-Time Updates**:
   ```typescript
   const eventSource = new EventSource(`/api/sse/sync-progress/${syncId}`, {
     withCredentials: true
   });
   eventSource.onmessage = (event) => {
     const data = JSON.parse(event.data);
     // Update UI
   };
   ```

### For Backend Developers

1. **Check Sync Status**:
   ```typescript
   const syncStatus = await syncJobManager.getSyncStatus(syncId, userId);
   ```

2. **Start Sync**:
   ```typescript
   const { syncId, status } = await syncJobManager.startSync(userId);
   ```

3. **Get Sync History**:
   ```typescript
   const history = await syncJobManager.getSyncHistory(userId, 20, 0);
   ```

---

## 📝 Summary

### Key Points

1. **Sync Endpoints**: 
   - `POST /api/sync/start` - Start sync
   - `GET /api/sync/status` - Get active sync status
   - `GET /api/sync/status/:syncId` - Get sync status by ID
   - `GET /api/sync/history` - Get sync history
   - `POST /api/sync/cancel/:syncId` - Cancel sync

2. **Sandbox Mode**: 
   - Uses test/mock data from Amazon SP-API sandbox
   - Default mode for development/testing
   - Returns empty or limited test data (this is normal)

3. **Sync Flow**:
   - User triggers sync → Backend fetches data from SP-API → Data stored in database → Detection triggered → Results displayed

4. **Continuous Sync**: 
   - Planned but not yet implemented
   - Will run background workers to periodically sync data
   - Will update "Last Pulled" timestamps for data source health

5. **Data Source Health**: 
   - Frontend displays status for each data source
   - Shows "Last Pulled" timestamps
   - Backend endpoint needs to be implemented

6. **Detection**: 
   - Automatically triggered after sync completes
   - Analyzes financial events for discrepancies
   - Stores results in `detection_results` table
   - Frontend displays claims detected count

---

## 🔧 Troubleshooting

### Common Issues

1. **Sync Returns 0 Claims Detected**:
   - Check if detection job completed
   - Verify `detection_results` table has data
   - Check sync status for errors

2. **Sync Stuck at 90%**:
   - Detection job may be taking longer than 60 seconds
   - Check `detection_queue` table for job status
   - Verify Redis is available (or detection fallback is working)

3. **Sandbox Returns Empty Data**:
   - This is normal for sandbox mode
   - Sandbox doesn't have real seller data
   - Use production mode for real data

4. **SSE Not Working**:
   - Verify cookies are being sent (`withCredentials: true`)
   - Check JWT token is valid
   - Verify SSE endpoint is accessible

---

## 📚 Additional Resources

- [Amazon SP-API Documentation](https://developer-docs.amazon.com/sp-api/)
- [Supabase Documentation](https://supabase.com/docs)
- [Server-Sent Events (SSE) Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)

---

**Last Updated**: November 11, 2025
**Version**: 1.0.0

