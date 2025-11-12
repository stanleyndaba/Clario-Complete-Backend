# Phase 3 Frontend Integration Guide - Executive Summary

## 🎯 Overview

Phase 3 (Anomaly Detection & Discovery Agent) backend is **100% complete** and ready for frontend integration. This document outlines all available endpoints, SSE events, and required UI components to maximize backend utilization.

---

## 📡 Available Backend Endpoints

### 1. Sync Management Endpoints

#### `POST /api/sync/start`
**Purpose**: Start a new Amazon data sync  
**Request Body**: None (uses authenticated user)  
**Response**:
```json
{
  "syncId": "sync_user123_1234567890",
  "status": "in_progress",
  "message": "Sync started successfully"
}
```
**Frontend Action**: 
- Show "Sync Started" notification
- Open SSE connection for real-time updates
- Display progress bar

#### `GET /api/sync/status`
**Purpose**: Get active sync status (no syncId needed)  
**Response**:
```json
{
  "hasActiveSync": true,
  "lastSync": {
    "syncId": "sync_user123_1234567890",
    "status": "running",
    "progress": 65,
    "message": "Processing sync data...",
    "startedAt": "2024-01-15T10:30:00Z",
    "ordersProcessed": 150,
    "totalOrders": 230,
    "claimsDetected": 12
  }
}
```
**Frontend Action**: 
- Check on page load to show current sync status
- Display sync progress if active
- Show last sync summary if no active sync

#### `GET /api/sync/status/:syncId`
**Purpose**: Get detailed sync status by syncId  
**Response**:
```json
{
  "syncId": "sync_user123_1234567890",
  "status": "running",
  "progress": 65,
  "message": "Processing sync data...",
  "startedAt": "2024-01-15T10:30:00Z",
  "completedAt": null,
  "ordersProcessed": 150,
  "totalOrders": 230,
  "claimsDetected": 12,
  "error": null
}
```
**Frontend Action**: 
- Poll every 3-5 seconds during sync
- Update progress bar
- Show detailed metrics

#### `GET /api/sync/history`
**Purpose**: Get sync history with pagination  
**Query Params**: `?limit=20&offset=0`  
**Response**:
```json
{
  "syncs": [
    {
      "syncId": "sync_user123_1234567890",
      "status": "completed",
      "startedAt": "2024-01-15T10:30:00Z",
      "completedAt": "2024-01-15T10:35:00Z",
      "ordersProcessed": 230,
      "claimsDetected": 12,
      "duration": 300,
      "error": null
    }
  ],
  "total": 45
}
```
**Frontend Action**: 
- Display sync history table
- Show pagination controls
- Link to detection results for each sync

#### `POST /api/sync/cancel/:syncId`
**Purpose**: Cancel an active sync  
**Response**:
```json
{
  "ok": true,
  "message": "Sync cancelled successfully"
}
```
**Frontend Action**: 
- Add "Cancel Sync" button during active sync
- Show confirmation dialog
- Update UI after cancellation

#### `POST /api/sync/force`
**Purpose**: Force start a new sync (even if one exists)  
**Response**: Same as `/api/sync/start`

---

### 2. Detection & Anomaly Endpoints

#### `GET /api/detections/results`
**Purpose**: Get all detection results (anomalies)  
**Query Params**: 
- `status=pending|reviewed|disputed|resolved` (optional)
- `limit=100&offset=0` (pagination)

**Response**:
```json
{
  "success": true,
  "results": [
    {
      "id": "uuid-123",
      "seller_id": "user123",
      "sync_id": "sync_user123_1234567890",
      "anomaly_type": "overcharge",
      "severity": "high",
      "estimated_value": 45.50,
      "currency": "USD",
      "confidence_score": 0.87,
      "evidence": {...},
      "status": "pending",
      "related_event_ids": ["event-1", "event-2"],
      "discovery_date": "2024-01-15T10:30:00Z",
      "deadline_date": "2024-03-15T10:30:00Z",
      "days_remaining": 45,
      "expired": false,
      "created_at": "2024-01-15T10:35:00Z"
    }
  ],
  "total": 25
}
```
**Frontend Action**: 
- **CRITICAL**: Display detection results table/list
- Show filters by status, anomaly_type, severity
- Show confidence badges (High/Medium/Low)
- Display days_remaining countdown
- Highlight expired claims
- Link to evidence/details

#### `GET /api/detections/statistics`
**Purpose**: Get comprehensive detection statistics  
**Response**:
```json
{
  "success": true,
  "statistics": {
    "total_anomalies": 150,
    "total_value": 12500.50,
    "by_severity": {
      "high": { "count": 45, "value": 8500.00 },
      "medium": { "count": 60, "value": 3500.50 },
      "low": { "count": 45, "value": 500.00 }
    },
    "by_type": {
      "missing_unit": { "count": 30, "value": 3000.00 },
      "overcharge": { "count": 40, "value": 4500.00 },
      "damaged_stock": { "count": 25, "value": 2000.00 },
      "incorrect_fee": { "count": 35, "value": 2500.50 },
      "duplicate_charge": { "count": 20, "value": 500.00 }
    },
    "by_confidence": {
      "high": 45,
      "medium": 60,
      "low": 45
    },
    "expiring_soon": 12,
    "expired_count": 3
  }
}
```
**Frontend Action**: 
- **CRITICAL**: Display dashboard statistics cards
- Show total anomalies count
- Show total recovery value
- Display breakdown by severity/type
- Show expiring/expired counts
- Create charts/graphs for visualization

#### `GET /api/detections/confidence-distribution`
**Purpose**: Get confidence score distribution for monitoring  
**Response**:
```json
{
  "success": true,
  "distribution": {
    "total_detections": 150,
    "by_confidence": {
      "high": 45,
      "medium": 60,
      "low": 45
    },
    "by_anomaly_type": {
      "missing_unit": {
        "high": 10,
        "medium": 15,
        "low": 5,
        "total": 30
      },
      "overcharge": {
        "high": 15,
        "medium": 20,
        "low": 5,
        "total": 40
      }
    },
    "confidence_ranges": {
      "0.0-0.2": 10,
      "0.2-0.4": 35,
      "0.4-0.6": 50,
      "0.6-0.8": 40,
      "0.8-1.0": 15
    },
    "recovery_rates": {
      "high": 0.85,
      "medium": 0.60,
      "low": 0.30
    },
    "average_confidence": 0.65
  }
}
```
**Frontend Action**: 
- **NEW**: Create confidence monitoring dashboard
- Display confidence distribution chart
- Show recovery rates by confidence level
- Display average confidence score
- Create histogram of confidence ranges

#### `GET /api/detections/deadlines`
**Purpose**: Get claims approaching deadline (60-day Amazon deadline)  
**Query Params**: `?days=7` (default: 7 days threshold)  
**Response**:
```json
{
  "success": true,
  "claims": [
    {
      "id": "uuid-123",
      "anomaly_type": "overcharge",
      "estimated_value": 45.50,
      "days_remaining": 3,
      "deadline_date": "2024-01-18T10:30:00Z",
      "severity": "high",
      "confidence_score": 0.87
    }
  ],
  "count": 12,
  "threshold_days": 7
}
```
**Frontend Action**: 
- **CRITICAL**: Display urgent claims banner/alert
- Show countdown timer for each claim
- Highlight claims expiring in < 3 days (red)
- Show claims expiring in 3-7 days (yellow)
- Add "File Claim" button for each

#### `GET /api/detections/status/:syncId`
**Purpose**: Get detection results for a specific sync  
**Response**: Same format as `/api/detections/results` but filtered by syncId

#### `PUT /api/detections/:id/resolve`
**Purpose**: Mark a detection as resolved  
**Request Body**:
```json
{
  "notes": "Resolved via Amazon reimbursement",
  "resolution_amount": 45.50
}
```
**Response**:
```json
{
  "success": true,
  "message": "Detection result resolved successfully",
  "detection": { /* updated detection object */ }
}
```
**Frontend Action**: 
- Add "Mark as Resolved" button on each detection
- Show resolution modal with notes/amount fields
- Update detection status in UI

#### `PUT /api/detections/:id/status`
**Purpose**: Update detection status (pending → reviewed → disputed → resolved)  
**Request Body**:
```json
{
  "status": "reviewed",
  "notes": "Reviewed and verified"
}
```
**Response**:
```json
{
  "success": true,
  "message": "Detection result status updated successfully",
  "detection": { /* updated detection object */ }
}
```
**Frontend Action**: 
- Add status dropdown/buttons on each detection
- Show status workflow: Pending → Reviewed → Disputed → Resolved
- Allow notes for each status change

#### `POST /api/detections/run`
**Purpose**: Manually trigger detection for a sync  
**Request Body**:
```json
{
  "syncId": "sync_user123_1234567890",
  "triggerType": "inventory",
  "metadata": {}
}
```
**Response**:
```json
{
  "success": true,
  "job": {
    "sync_id": "sync_user123_1234567890",
    "trigger_type": "inventory"
  }
}
```
**Frontend Action**: 
- Add "Run Detection" button (if detection didn't auto-trigger)
- Show "Detection Running" status

---

## 🔔 Server-Sent Events (SSE) - Real-Time Updates

### SSE Connection Endpoints

#### `GET /api/sse/sync-progress/:syncId`
**Purpose**: Stream real-time sync progress updates  
**Events Sent**:
- `sync_progress` - Progress updates during sync
- `heartbeat` - Keep-alive every 30 seconds

**Event Data**:
```json
{
  "syncId": "sync_user123_1234567890",
  "status": "running",
  "progress": 65,
  "message": "Processing sync data...",
  "ordersProcessed": 150,
  "totalOrders": 230,
  "claimsDetected": 12,
  "timestamp": "2024-01-15T10:32:00Z"
}
```

**Frontend Action**: 
- **CRITICAL**: Connect to SSE on sync start
- Update progress bar in real-time
- Show current status message
- Display metrics (ordersProcessed, claimsDetected)
- Handle connection errors with polling fallback

#### `GET /api/sse/detection-updates/:syncId`
**Purpose**: Stream real-time detection updates  
**Events Sent**:
- `detection_updates` - New detections found
- `detection_complete` - Detection job completed
- `heartbeat` - Keep-alive every 30 seconds

**Frontend Action**: 
- Connect after sync completes
- Show "Detection Running" indicator
- Display new detections as they're found
- Show completion notification

#### `GET /api/sse/notifications`
**Purpose**: Stream all user notifications  
**Events Sent**:
- `claim_expiring` - Claim approaching deadline
- `detection_resolved` - Detection marked as resolved
- `detection_status_changed` - Status updated
- `sync_complete` - Sync completed
- `sync_failed` - Sync failed

**Event Examples**:

**claim_expiring**:
```json
{
  "claim_id": "uuid-123",
  "anomaly_type": "overcharge",
  "estimated_value": 45.50,
  "days_remaining": 3,
  "deadline_date": "2024-01-18T10:30:00Z",
  "urgency": "critical",
  "message": "Claim expires in 3 days. File soon to avoid missing the deadline."
}
```

**detection_resolved**:
```json
{
  "detection_id": "uuid-123",
  "previous_status": "pending",
  "new_status": "resolved",
  "estimated_value": 45.50,
  "resolution_amount": 45.50,
  "message": "Detection result uuid-123 has been resolved.",
  "timestamp": "2024-01-15T10:40:00Z"
}
```

**Frontend Action**: 
- **CRITICAL**: Connect to notifications SSE on app load
- Show toast notifications for all events
- Display urgent alerts for expiring claims
- Update UI when detections are resolved
- Show notification badge count

---

## 🎨 Required Frontend UI Components

### 1. Sync Management UI

#### **Sync Dashboard Page**
**Location**: `/dashboard/sync` or main dashboard  
**Components Needed**:
- [ ] **"Start Sync" Button** → Calls `POST /api/sync/start`
- [ ] **"Force Sync" Button** → Calls `POST /api/sync/force`
- [ ] **Active Sync Progress Bar** → Connected to SSE `/api/sse/sync-progress/:syncId`
- [ ] **Sync Status Card** → Polls `GET /api/sync/status` every 5 seconds
- [ ] **Sync History Table** → Calls `GET /api/sync/history`
- [ ] **"Cancel Sync" Button** → Calls `POST /api/sync/cancel/:syncId` (shown during active sync)

**Data Display**:
- Current sync progress (0-100%)
- Status message ("Fetching inventory...", "Processing data...")
- Orders processed / Total orders
- Claims detected count
- Sync duration timer

#### **Sync History Component**
**Location**: `/dashboard/sync/history`  
**Components Needed**:
- [ ] **Sync History Table** with columns:
  - Sync ID
  - Status (badge: running/completed/failed/cancelled)
  - Started At
  - Completed At
  - Duration
  - Orders Processed
  - Claims Detected
  - Actions (View Details, View Detections)
- [ ] **Pagination Controls** → `?limit=20&offset=0`
- [ ] **Filter by Status** → Filter table by status
- [ ] **Link to Detection Results** → Navigate to `/dashboard/detections?syncId=xxx`

---

### 2. Detection & Anomaly UI

#### **Detection Dashboard Page** ⭐ CRITICAL
**Location**: `/dashboard/detections`  
**Components Needed**:

**Statistics Cards** (Top of page):
- [ ] **Total Anomalies Card** → `statistics.total_anomalies`
- [ ] **Total Recovery Value Card** → `statistics.total_value` (formatted as currency)
- [ ] **High Confidence Claims Card** → `statistics.by_confidence.high`
- [ ] **Expiring Soon Card** → `statistics.expiring_soon` (with alert badge)
- [ ] **Expired Claims Card** → `statistics.expired_count` (red badge)

**Charts/Graphs**:
- [ ] **Anomaly Type Distribution Chart** → `statistics.by_type` (pie/bar chart)
- [ ] **Severity Distribution Chart** → `statistics.by_severity` (pie chart)
- [ ] **Confidence Distribution Chart** → `distribution.by_confidence` (bar chart)
- [ ] **Recovery Rates Chart** → `distribution.recovery_rates` (line chart over time)

**Detection Results Table** ⭐ CRITICAL:
- [ ] **Main Table** → Calls `GET /api/detections/results`
- [ ] **Columns**:
  - Anomaly Type (badge with icon)
  - Severity (badge: low/medium/high/critical)
  - Estimated Value (currency formatted)
  - Confidence Score (progress bar + badge: High/Medium/Low)
  - Status (badge: pending/reviewed/disputed/resolved)
  - Days Remaining (countdown, red if < 3 days)
  - Discovery Date
  - Actions (View Details, Update Status, Mark Resolved)

**Filters**:
- [ ] **Status Filter** → `?status=pending|reviewed|disputed|resolved`
- [ ] **Anomaly Type Filter** → Filter by type (missing_unit, overcharge, etc.)
- [ ] **Severity Filter** → Filter by severity
- [ ] **Confidence Filter** → Filter by High/Medium/Low
- [ ] **Date Range Filter** → Filter by discovery_date

**Actions**:
- [ ] **"View Details" Button** → Opens modal with full detection details
- [ ] **"Update Status" Dropdown** → Calls `PUT /api/detections/:id/status`
- [ ] **"Mark as Resolved" Button** → Opens modal → Calls `PUT /api/detections/:id/resolve`
- [ ] **"File Claim" Button** → For expiring claims → Navigate to claim filing

#### **Urgent Claims Banner** ⭐ CRITICAL
**Location**: Top of dashboard (sticky banner)  
**Components Needed**:
- [ ] **Banner Component** → Calls `GET /api/detections/deadlines?days=7`
- [ ] **Display Count** → "12 claims expiring in 7 days"
- [ ] **"View Urgent Claims" Button** → Navigate to filtered detections view
- [ ] **Individual Claim Cards** → Show top 3-5 most urgent
- [ ] **Countdown Timer** → Show days_remaining for each
- [ ] **"File Now" Button** → Quick action to file claim

**Styling**:
- Red background if any claims expiring in < 3 days
- Yellow background if claims expiring in 3-7 days
- Dismissible (but reappears if new urgent claims)

#### **Detection Details Modal**
**Components Needed**:
- [ ] **Full Detection Data Display**:
  - Anomaly Type & Description
  - Severity & Confidence Score
  - Estimated Value
  - Evidence (JSON viewer)
  - Related Event IDs
  - Discovery Date
  - Deadline Date & Days Remaining
  - Status History
- [ ] **Evidence Viewer** → Display evidence JSON in readable format
- [ ] **Related Events** → Link to financial events
- [ ] **Status Update Form** → Update status with notes
- [ ] **Resolution Form** → Mark resolved with notes & amount

#### **Confidence Monitoring Dashboard** ⭐ NEW
**Location**: `/dashboard/analytics/confidence`  
**Components Needed**:
- [ ] **Confidence Distribution Chart** → `distribution.by_confidence`
- [ ] **Confidence Range Histogram** → `distribution.confidence_ranges`
- [ ] **Recovery Rates by Confidence** → `distribution.recovery_rates` (line chart)
- [ ] **Average Confidence Score** → `distribution.average_confidence`
- [ ] **By Anomaly Type Breakdown** → `distribution.by_anomaly_type`
- [ ] **Calibration Recommendations** → Based on recovery rates

**Purpose**: Help users understand detection quality and adjust thresholds

---

### 3. Real-Time Updates UI

#### **SSE Connection Manager**
**Components Needed**:
- [ ] **SSE Connection Handler** → Manages all SSE connections
- [ ] **Auto-Reconnect Logic** → Reconnect on disconnect
- [ ] **Fallback to Polling** → If SSE fails, poll endpoints
- [ ] **Connection Status Indicator** → Show "Connected" / "Disconnected"

**SSE Connections to Maintain**:
1. `/api/sse/sync-progress/:syncId` (during active sync)
2. `/api/sse/detection-updates/:syncId` (after sync completes)
3. `/api/sse/notifications` (always connected)

#### **Notification Toast System**
**Components Needed**:
- [ ] **Toast Notification Component** → Display SSE events as toasts
- [ ] **Notification Types**:
  - `claim_expiring` → Red/urgent toast
  - `detection_resolved` → Green/success toast
  - `detection_status_changed` → Blue/info toast
  - `sync_complete` → Green/success toast
  - `sync_failed` → Red/error toast
- [ ] **Notification Badge** → Show unread count
- [ ] **Notification Center** → View all notifications

#### **Progress Bar Component**
**Components Needed**:
- [ ] **Reusable Progress Bar** → Used for sync progress
- [ ] **Real-Time Updates** → Updates from SSE events
- [ ] **Status Message Display** → Shows current step
- [ ] **Metrics Display** → Orders processed, claims detected
- [ ] **Cancel Button** → Shown during active sync

---

## 🔄 Complete User Flow

### Flow 1: Sync → Detection → Review

1. **User clicks "Start Sync"**
   - Frontend: `POST /api/sync/start`
   - Frontend: Open SSE connection `/api/sse/sync-progress/:syncId`
   - Frontend: Show progress bar, status message

2. **Sync Progress Updates** (via SSE)
   - Frontend: Update progress bar (0-100%)
   - Frontend: Show status message
   - Frontend: Display ordersProcessed/totalOrders

3. **Sync Completes**
   - Backend: Auto-triggers detection job
   - Backend: Sends `sync_complete` SSE event
   - Frontend: Show "Sync Complete" notification
   - Frontend: Open SSE connection `/api/sse/detection-updates/:syncId`
   - Frontend: Show "Detection Running" indicator

4. **Detection Results Available**
   - Backend: Sends `detection_updates` SSE events
   - Frontend: Show "X anomalies detected" notification
   - Frontend: Navigate to `/dashboard/detections`
   - Frontend: Display detection results table

5. **User Reviews Detections**
   - Frontend: Filter by confidence (High/Medium/Low)
   - Frontend: High confidence → Auto-submit (if configured)
   - Frontend: Medium confidence → Show "Review" button
   - Frontend: Low confidence → Show "Manual Review" badge

6. **User Takes Action**
   - Frontend: Click "Mark as Resolved" → `PUT /api/detections/:id/resolve`
   - Frontend: Click "Update Status" → `PUT /api/detections/:id/status`
   - Frontend: Click "File Claim" → Navigate to claim filing

### Flow 2: Urgent Claims Alert

1. **User Opens Dashboard**
   - Frontend: `GET /api/detections/deadlines?days=7`
   - Frontend: Display urgent claims banner if any found

2. **User Sees Urgent Claim**
   - Frontend: Show countdown timer (days_remaining)
   - Frontend: Highlight in red if < 3 days
   - Frontend: Show "File Claim" button

3. **User Files Claim**
   - Frontend: Navigate to claim filing page
   - Frontend: Pre-fill with detection data

### Flow 3: Statistics & Monitoring

1. **User Views Dashboard**
   - Frontend: `GET /api/detections/statistics`
   - Frontend: Display statistics cards
   - Frontend: Display charts/graphs

2. **User Views Confidence Analytics**
   - Frontend: `GET /api/detections/confidence-distribution`
   - Frontend: Display confidence distribution charts
   - Frontend: Show recovery rates
   - Frontend: Display calibration recommendations

---

## 🚨 Critical Missing Frontend Components

### ⚠️ HIGH PRIORITY (Must Implement)

1. **Detection Results Table** ⭐⭐⭐
   - **Status**: MISSING
   - **Impact**: Users cannot see detected anomalies
   - **Endpoint**: `GET /api/detections/results`
   - **Action**: Create table with filters, sorting, pagination

2. **Statistics Dashboard** ⭐⭐⭐
   - **Status**: MISSING
   - **Impact**: Users cannot see overview of detections
   - **Endpoint**: `GET /api/detections/statistics`
   - **Action**: Create dashboard with cards and charts

3. **Urgent Claims Banner** ⭐⭐⭐
   - **Status**: MISSING
   - **Impact**: Users miss deadline-critical claims
   - **Endpoint**: `GET /api/detections/deadlines`
   - **Action**: Create sticky banner with countdown timers

4. **SSE Connection for Sync Progress** ⭐⭐
   - **Status**: MISSING
   - **Impact**: No real-time sync updates
   - **Endpoint**: `GET /api/sse/sync-progress/:syncId`
   - **Action**: Implement SSE client with auto-reconnect

5. **SSE Connection for Notifications** ⭐⭐
   - **Status**: MISSING
   - **Impact**: Users miss real-time alerts
   - **Endpoint**: `GET /api/sse/notifications`
   - **Action**: Implement notification toast system

6. **Detection Status Update UI** ⭐⭐
   - **Status**: MISSING
   - **Impact**: Users cannot manage detection lifecycle
   - **Endpoints**: `PUT /api/detections/:id/status`, `PUT /api/detections/:id/resolve`
   - **Action**: Add status dropdown and resolve button

### ⚠️ MEDIUM PRIORITY (Should Implement)

7. **Confidence Monitoring Dashboard** ⭐
   - **Status**: MISSING
   - **Impact**: Cannot monitor detection quality
   - **Endpoint**: `GET /api/detections/confidence-distribution`
   - **Action**: Create analytics page with charts

8. **Sync History Table** ⭐
   - **Status**: MISSING
   - **Impact**: Cannot view past syncs
   - **Endpoint**: `GET /api/sync/history`
   - **Action**: Create history table with pagination

9. **Detection Details Modal** ⭐
   - **Status**: MISSING
   - **Impact**: Cannot view full detection details
   - **Action**: Create modal with evidence viewer

---

## 📊 Data Models for Frontend

### Detection Result Type
```typescript
interface DetectionResult {
  id: string;
  seller_id: string;
  sync_id: string;
  anomaly_type: 'missing_unit' | 'overcharge' | 'damaged_stock' | 'incorrect_fee' | 'duplicate_charge';
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimated_value: number;
  currency: string;
  confidence_score: number; // 0-1
  evidence: any; // JSON object
  status: 'pending' | 'reviewed' | 'disputed' | 'resolved';
  related_event_ids: string[];
  discovery_date?: string;
  deadline_date?: string;
  days_remaining?: number;
  expiration_alert_sent?: boolean;
  expired?: boolean;
  created_at: string;
  updated_at: string;
}
```

### Sync Status Type
```typescript
interface SyncStatus {
  syncId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  message: string;
  startedAt: string;
  completedAt?: string;
  ordersProcessed?: number;
  totalOrders?: number;
  claimsDetected?: number;
  error?: string;
}
```

### Statistics Type
```typescript
interface DetectionStatistics {
  total_anomalies: number;
  total_value: number;
  by_severity: Record<string, { count: number; value: number }>;
  by_type: Record<string, { count: number; value: number }>;
  by_confidence: {
    high: number;
    medium: number;
    low: number;
  };
  expiring_soon: number;
  expired_count: number;
}
```

---

## 🎯 Frontend Implementation Checklist

### Phase 3.1: Core Detection UI (Week 1)
- [ ] Detection Results Table component
- [ ] Statistics Dashboard cards
- [ ] Urgent Claims Banner
- [ ] Basic filters (status, type, severity)

### Phase 3.2: Real-Time Updates (Week 2)
- [ ] SSE connection manager
- [ ] Sync progress bar with SSE
- [ ] Notification toast system
- [ ] Auto-reconnect logic

### Phase 3.3: Detection Management (Week 3)
- [ ] Status update UI
- [ ] Resolve detection modal
- [ ] Detection details modal
- [ ] Evidence viewer

### Phase 3.4: Analytics & Monitoring (Week 4)
- [ ] Confidence distribution charts
- [ ] Recovery rates visualization
- [ ] Sync history table
- [ ] Advanced filters

---

## 🔗 API Endpoint Summary

### Sync Endpoints
- `POST /api/sync/start` - Start sync
- `GET /api/sync/status` - Get active sync
- `GET /api/sync/status/:syncId` - Get sync by ID
- `GET /api/sync/history` - Get sync history
- `POST /api/sync/cancel/:syncId` - Cancel sync
- `POST /api/sync/force` - Force sync

### Detection Endpoints
- `GET /api/detections/results` - Get all detections
- `GET /api/detections/statistics` - Get statistics
- `GET /api/detections/confidence-distribution` - Get confidence data
- `GET /api/detections/deadlines` - Get urgent claims
- `GET /api/detections/status/:syncId` - Get detections by sync
- `PUT /api/detections/:id/resolve` - Resolve detection
- `PUT /api/detections/:id/status` - Update status
- `POST /api/detections/run` - Trigger detection

### SSE Endpoints
- `GET /api/sse/sync-progress/:syncId` - Sync progress stream
- `GET /api/sse/detection-updates/:syncId` - Detection updates stream
- `GET /api/sse/notifications` - All notifications stream

---

## 💡 Maximizing Backend Utilization

### Best Practices

1. **Always Use SSE for Real-Time Updates**
   - Don't poll endpoints unnecessarily
   - Use SSE for sync progress, detection updates, notifications
   - Fallback to polling only if SSE fails

2. **Cache Statistics**
   - Statistics don't change frequently
   - Cache for 30-60 seconds
   - Refresh on user action (sync complete, status update)

3. **Lazy Load Detection Results**
   - Load first page on mount
   - Load more on scroll (infinite scroll)
   - Use pagination for large datasets

4. **Show Urgent Claims Prominently**
   - Always visible banner
   - Countdown timers
   - Quick action buttons

5. **Use Confidence Scores for UI**
   - High confidence (≥0.75): Green badge, auto-highlight
   - Medium confidence (0.50-0.75): Yellow badge, review prompt
   - Low confidence (<0.50): Gray badge, manual review

6. **Status Workflow Visualization**
   - Show status progression: Pending → Reviewed → Disputed → Resolved
   - Allow status updates with notes
   - Show status history

---

## 🎨 UI/UX Recommendations

### Color Coding
- **High Confidence**: Green (#10B981)
- **Medium Confidence**: Yellow (#F59E0B)
- **Low Confidence**: Gray (#6B7280)
- **Urgent (< 3 days)**: Red (#EF4444)
- **Warning (3-7 days)**: Orange (#F97316)
- **Expired**: Dark Red (#DC2626)

### Icons
- **Missing Unit**: 📦
- **Overcharge**: 💰
- **Damaged Stock**: 📦❌
- **Incorrect Fee**: 💳
- **Duplicate Charge**: 🔄

### Badges
- **Severity**: Low (Gray), Medium (Yellow), High (Orange), Critical (Red)
- **Status**: Pending (Blue), Reviewed (Purple), Disputed (Orange), Resolved (Green)
- **Confidence**: High (Green), Medium (Yellow), Low (Gray)

---

## ✅ Backend Status: 100% Complete

All Phase 3 backend functionality is **fully implemented and tested**:
- ✅ All endpoints working
- ✅ SSE events configured
- ✅ Database schema ready
- ✅ Detection algorithms running
- ✅ Confidence scoring implemented
- ✅ Deadline tracking active
- ✅ Statistics & analytics ready

**Frontend can start integration immediately.**

---

## 📞 Integration Support

For questions or issues during frontend integration:
1. Check endpoint responses match documented format
2. Verify SSE events are received correctly
3. Test with real user credentials
4. Monitor backend logs for errors

**All backend endpoints are production-ready and waiting for frontend integration.**

