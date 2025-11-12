# Phase 3: Claim Detection - Frontend Integration Guide

**Issue**: Phase 3 Claim Detection results are not showing on the frontend  
**Status**: ⚠️ **FRONTEND INTEGRATION MISSING**

---

## Problem Analysis

### ✅ Backend is Ready
- Detection service fully implemented
- API endpoints exist and working
- WebSocket notifications sent
- Database storage functional

### ❌ Frontend is Missing
- No components to display detection results
- No API client methods for detection endpoints
- No UI for confidence scores and claim categorization
- No dashboard integration

---

## Available Backend Endpoints

### 1. Get Detection Results
```
GET /api/v1/integrations/detections/results?status={status}&limit={limit}&offset={offset}
```
**Query Parameters**:
- `status` (optional): Filter by status (pending, reviewed, disputed, resolved)
- `limit` (optional): Number of results to return (default: 100)
- `offset` (optional): Pagination offset (default: 0)
**Response**:
```json
{
  "success": true,
  "results": [
    {
      "id": "uuid",
      "seller_id": "user-id",
      "sync_id": "sync-id",
      "anomaly_type": "overcharge",
      "severity": "high",
      "estimated_value": 15.50,
      "currency": "USD",
      "confidence_score": 0.92,
      "evidence": {...},
      "status": "pending",
      "discovery_date": "2025-11-12T...",
      "deadline_date": "2026-01-11T...",
      "days_remaining": 60
    }
  ],
  "total": 1
}
```

### 2. Get Detection Statistics
```
GET /api/v1/integrations/detections/statistics?userId={userId}
```
**Response**:
```json
{
  "success": true,
  "statistics": {
    "totalDetections": 10,
    "highConfidence": 5,
    "mediumConfidence": 3,
    "lowConfidence": 2,
    "estimatedRecovery": 3240.50,
    "averageConfidence": 0.79
  }
}
```

### 3. Get Claims Approaching Deadline
```
GET /api/v1/integrations/detections/deadlines?userId={userId}&days=7
```
**Response**:
```json
{
  "success": true,
  "claims": [...],
  "count": 3,
  "threshold_days": 7
}
```

### 4. Get Detection Status
```
GET /api/v1/integrations/detections/status/:syncId
```
**Response**:
```json
{
  "success": true,
  "results": {...}
}
```

---

## Where to Display Phase 3 on Frontend

### 1. **Recoveries Page** ⭐ PRIMARY LOCATION (Where Detections Are Made)

**Location**: `src/pages/Recoveries.tsx` (EXISTING PAGE)

**Current State**: The Recoveries page already exists and shows recovery/claim data.

**What to Add - Phase 3 Detection Results**:
- **Merge Detection Results with Existing Recoveries**:
  - Detection results should appear alongside existing recoveries
  - Add a "Source" column: "Detected" vs "Synced from Amazon"
  - Show confidence scores for detected claims
  - Highlight high-confidence claims (ready for auto-submit)

- **Enhanced Table Columns**:
  - **Source**: "Detected" (Phase 3) or "Amazon SP-API" (synced)
  - **Confidence Score**: Show badge (High/Medium/Low) for detected claims
  - **Status**: pending, reviewed, disputed, resolved
  - **Days Remaining**: Until deadline (for detected claims)
  - **Actions**: Review, Submit, Dismiss (based on confidence)

- **Filters**:
  - Filter by source (Detected vs Synced)
  - Filter by confidence level (High/Medium/Low)
  - Filter by status
  - Filter by anomaly type (overcharge, missing_unit, etc.)

**Visual Design**:
```
┌─────────────────────────────────────────────────────────┐
│  Recoveries & Detected Claims                           │
├─────────────────────────────────────────────────────────┤
│  Filters: [All] [Detected] [Synced] [High] [Medium]    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Source │ Type │ Amount │ Confidence │ Status │  │  │
│  ├──────────────────────────────────────────────────┤  │
│  │Detected│Overch│ $15.50 │ 92% (High)│Pending │  │  │
│  │Detected│Missin│ $25.00 │ 65% (Med) │Pending │  │  │
│  │Synced  │Claim │ $50.00 │    -      │Approved│  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2. **Dashboard (Summary Card)** ⭐ SECONDARY LOCATION

**Location**: `src/pages/Dashboard.tsx` or `src/components/layout/Dashboard.tsx`

**What to Show** (Summary that links to Recoveries page):
- **Total Claims Detected**: Count from Phase 3
- **Total Recovery Potential**: Dollar amount from detected claims
- **Confidence Breakdown**: 
  - High confidence (ready for auto-submit): Count + amount
  - Medium confidence (needs review): Count + amount
  - Low confidence (manual review): Count + amount
- **Quick Action**: "View All in Recoveries" button → Links to Recoveries page

**Visual Design**:
```
┌─────────────────────────────────────────┐
│  💰 Detected Claims                     │
├─────────────────────────────────────────┤
│  Total Detected: 18                     │
│  Recovery Potential: $3,240.50         │
│                                         │
│  ⚡ High: 12 claims ($2,100)           │
│  ❓ Medium: 4 claims ($800)             │
│  📋 Low: 2 claims ($340)                │
│                                         │
│  [View in Recoveries →]                │
└─────────────────────────────────────────┘
```

**What to Show**:
- **Full Claims Table** with columns:
  - Claim ID
  - Type (overcharge, missing_unit, etc.)
  - Amount
  - Confidence Score (with color coding)
  - Status (pending, reviewed, disputed, resolved)
  - Discovery Date
  - Days Remaining (until deadline)
  - Actions (Review, Submit, Dismiss)

- **Filters**:
  - By confidence level (High/Medium/Low)
  - By anomaly type
  - By status
  - By date range

- **Sorting**:
  - By amount (highest first)
  - By confidence (highest first)
  - By deadline (soonest first)

**Visual Design**:
```
┌─────────────────────────────────────────────────────────┐
│  Claims & Recoveries                                    │
├─────────────────────────────────────────────────────────┤
│  Filters: [High] [Medium] [Low] [All Types] [All]      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Type      │ Amount │ Confidence │ Status │ Action│  │
│  ├──────────────────────────────────────────────────┤  │
│  │ Overcharge│ $15.50 │ 92% (High) │Pending│[Submit]│  │
│  │ Missing   │ $25.00 │ 65% (Med)  │Pending│[Review]│  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 3. **Real-Time Notifications** ⭐ ALREADY WORKING

**Location**: WebSocket notifications (already implemented)

**What's Already Working**:
- High confidence: "⚡ X claims ready for auto submission"
- Medium confidence: "❓ X claims need your input"
- Low confidence: "📋 X claims need manual review"

**Enhancement Needed**:
- Click notification → Navigate to Claims page
- Show claim details in notification toast

### 4. **Sidebar/Navigation** ⭐ QUICK ACCESS

**Location**: `src/components/layout/Sidebar.tsx` or navigation component

**What to Add**:
- "Claims" or "Recoveries" menu item
- Badge showing count of pending high-confidence claims
- Link to Claims page

---

## Implementation Steps

### Step 1: Add API Client Methods

**File**: `src/lib/api.ts` or `src/services/api.ts`

```typescript
// Detection/Claims API methods
export const detectionApi = {
  // Get all detection results
  getDetectionResults: async (status?: string, limit: number = 100, offset: number = 0) => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());
    
    const response = await fetch(
      `${API_BASE_URL}/api/v1/integrations/detections/results?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.json();
  },

  // Get detection statistics
  getDetectionStatistics: async (userId: string) => {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/integrations/detections/statistics?userId=${userId}`,
      {
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.json();
  },

  // Get claims approaching deadline
  getClaimsApproachingDeadline: async (userId: string, days: number = 7) => {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/integrations/detections/deadlines?userId=${userId}&days=${days}`,
      {
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.json();
  }
};
```

### Step 2: Enhance Recoveries Page with Detection Results

**File**: `src/pages/Recoveries.tsx` (EXISTING PAGE)

**What to Do**:
1. Fetch detection results alongside existing recoveries
2. Merge them into a unified list
3. Add confidence score column for detected claims
4. Add filters for source (Detected vs Synced) and confidence level

```typescript
// In src/pages/Recoveries.tsx - Enhance existing component

import { detectionApi } from '@/lib/api';

// Add to existing Recoveries component
const [detectionResults, setDetectionResults] = useState([]);
const [mergedRecoveries, setMergedRecoveries] = useState([]);
const [filterSource, setFilterSource] = useState<'all' | 'detected' | 'synced'>('all');
const [filterConfidence, setFilterConfidence] = useState<'all' | 'high' | 'medium' | 'low'>('all');

// Load detection results alongside existing recoveries
useEffect(() => {
  loadDetectionResults();
}, []);

const loadDetectionResults = async () => {
  try {
    const response = await detectionApi.getDetectionResults();
    if (response.success) {
      setDetectionResults(response.results || []);
      mergeWithRecoveries(response.results || []);
    }
  } catch (error) {
    console.error('Failed to load detection results:', error);
  }
};

// Merge detection results with existing recoveries
const mergeWithRecoveries = (detections: any[]) => {
  // Transform detection results to match recovery format
  const detectedClaims = detections.map(det => ({
    id: det.id,
    source: 'detected',
    type: det.anomaly_type,
    amount: det.estimated_value,
    currency: det.currency,
    confidence_score: det.confidence_score,
    status: det.status,
    days_remaining: det.days_remaining,
    discovery_date: det.discovery_date,
    deadline_date: det.deadline_date,
    // ... other fields
  }));

  // Merge with existing recoveries (from existing recoveries state)
  const allRecoveries = [
    ...detectedClaims,
    ...(existingRecoveries || []).map(rec => ({
      ...rec,
      source: 'synced',
      confidence_score: null // Synced claims don't have confidence scores
    }))
  ];

  // Apply filters
  let filtered = allRecoveries;
  
  if (filterSource !== 'all') {
    filtered = filtered.filter(r => r.source === filterSource);
  }
  
  if (filterConfidence !== 'all' && filterSource === 'detected') {
    filtered = filtered.filter(r => {
      if (!r.confidence_score) return false;
      if (filterConfidence === 'high') return r.confidence_score >= 0.85;
      if (filterConfidence === 'medium') return r.confidence_score >= 0.50 && r.confidence_score < 0.85;
      return r.confidence_score < 0.50;
    });
  }

  setMergedRecoveries(filtered);
};

const getConfidenceBadge = (score: number | null) => {
  if (!score) return null;
  if (score >= 0.85) return { label: 'High', color: 'green' };
  if (score >= 0.50) return { label: 'Medium', color: 'yellow' };
  return { label: 'Low', color: 'gray' };
};

// In render - enhance existing table
return (
  <div className="recoveries-page">
    <h2>Recoveries & Detected Claims</h2>
    
    {/* Filters */}
    <div className="filters">
      <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
        <option value="all">All Sources</option>
        <option value="detected">Detected (Phase 3)</option>
        <option value="synced">Synced from Amazon</option>
      </select>
      
      {filterSource === 'detected' && (
        <select value={filterConfidence} onChange={(e) => setFilterConfidence(e.target.value)}>
          <option value="all">All Confidence Levels</option>
          <option value="high">High (≥85%)</option>
          <option value="medium">Medium (50-85%)</option>
          <option value="low">Low (<50%)</option>
        </select>
      )}
    </div>

    {/* Enhanced Table */}
    <table>
      <thead>
        <tr>
          <th>Source</th>
          <th>Type</th>
          <th>Amount</th>
          <th>Confidence</th>
          <th>Status</th>
          <th>Days Remaining</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {mergedRecoveries.map(recovery => {
          const badge = getConfidenceBadge(recovery.confidence_score);
          return (
            <tr key={recovery.id}>
              <td>
                {recovery.source === 'detected' ? (
                  <span className="badge badge-blue">Detected</span>
                ) : (
                  <span className="badge badge-gray">Synced</span>
                )}
              </td>
              <td>{recovery.type || recovery.anomaly_type}</td>
              <td>${recovery.amount.toFixed(2)}</td>
              <td>
                {badge ? (
                  <span className={`badge badge-${badge.color}`}>
                    {badge.label} ({(recovery.confidence_score * 100).toFixed(0)}%)
                  </span>
                ) : (
                  <span>-</span>
                )}
              </td>
              <td>{recovery.status}</td>
              <td>{recovery.days_remaining || '-'}</td>
              <td>
                {recovery.confidence_score >= 0.85 && (
                  <button>Auto-Submit</button>
                )}
                <button>Review</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
```

### Step 3: Add Summary Card to Dashboard

**File**: `src/pages/Dashboard.tsx` (EXISTING PAGE)

**What to Do**: Add a summary card that shows detection statistics and links to Recoveries page.

```typescript
import { detectionApi } from '@/lib/api';
import { Link } from 'react-router-dom'; // or your routing library

// In Dashboard component:
const [detectionStats, setDetectionStats] = useState(null);

useEffect(() => {
  loadDetectionStats();
}, []);

const loadDetectionStats = async () => {
  try {
    const stats = await detectionApi.getDetectionStatistics();
    if (stats.success) {
      setDetectionStats(stats.statistics);
    }
  } catch (error) {
    console.error('Failed to load detection stats:', error);
  }
};

// In render - add summary card:
{detectionStats && (
  <div className="detection-summary-card">
    <h3>💰 Detected Claims</h3>
    <div className="stats">
      <div className="stat">
        <div className="stat-label">Total Detected</div>
        <div className="stat-value">{detectionStats.totalDetections}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Recovery Potential</div>
        <div className="stat-value">${detectionStats.estimatedRecovery.toFixed(2)}</div>
      </div>
    </div>
    <div className="confidence-breakdown">
      <div className="confidence-item high">
        ⚡ High: {detectionStats.highConfidence} claims
      </div>
      <div className="confidence-item medium">
        ❓ Medium: {detectionStats.mediumConfidence} claims
      </div>
      <div className="confidence-item low">
        📋 Low: {detectionStats.lowConfidence} claims
      </div>
    </div>
    <Link to="/recoveries" className="btn-primary">
      View in Recoveries →
    </Link>
  </div>
)}
```

### Step 4: Create Detection Summary Component (Optional - for reuse)

**File**: `src/components/detection/DetectionSummary.tsx`

```typescript
interface ClaimsStats {
  totalDetections: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  estimatedRecovery: number;
  averageConfidence: number;
}

export const ClaimsSummary: React.FC<{ stats: ClaimsStats }> = ({ stats }) => {
  return (
    <div className="claims-summary-card">
      <h3>💰 Claim Detection Results</h3>
      <div className="stats-grid">
        <div className="stat">
          <div className="stat-label">Total Claims</div>
          <div className="stat-value">{stats.totalDetections}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Recovery Potential</div>
          <div className="stat-value">${stats.estimatedRecovery.toFixed(2)}</div>
        </div>
      </div>
      <div className="confidence-breakdown">
        <div className="confidence-item high">
          ⚡ High Confidence: {stats.highConfidence} claims
        </div>
        <div className="confidence-item medium">
          ❓ Medium Confidence: {stats.mediumConfidence} claims
        </div>
        <div className="confidence-item low">
          📋 Low Confidence: {stats.lowConfidence} claims
        </div>
      </div>
      <div className="actions">
        <button>View All Claims</button>
        {stats.highConfidence > 0 && (
          <button>Auto-Submit High Confidence</button>
        )}
      </div>
    </div>
  );
};
```

---

## Testing with Real SP-API

### Step 1: Run SP-API Test Script

```powershell
# Test with real SP-API data
powershell -ExecutionPolicy Bypass -File scripts/test-phase3-spapi.ps1 -UserId "your-user-id" -ApiUrl "http://localhost:3001" -Verbose
```

### Step 2: Verify Backend Endpoints

```bash
# Get detection results
curl http://localhost:3001/api/v1/integrations/detections/results?userId=sandbox-user

# Get statistics
curl http://localhost:3001/api/v1/integrations/detections/statistics?userId=sandbox-user
```

### Step 3: Check WebSocket Notifications

- Open browser console
- Look for WebSocket messages
- Should see notifications like:
  - "⚡ X claims ready for auto submission"
  - "❓ X claims need your input"

---

## Summary

### ✅ What's Working
- Backend detection service
- API endpoints
- WebSocket notifications
- Database storage

### ❌ What's Missing
- Frontend API client methods
- Claims display components
- Dashboard integration
- Claims page/route

### 🎯 Where to Show
1. **Dashboard** - Summary card with totals and breakdown
2. **Claims Page** - Full table with filters and actions
3. **Notifications** - Already working, enhance with navigation
4. **Navigation** - Add "Claims" menu item

### 📝 Next Steps
1. Add API client methods (`src/lib/api.ts`)
2. Create Claims components (`src/components/claims/`)
3. Add to Dashboard (`src/pages/Dashboard.tsx`)
4. Create Claims page (`src/pages/Claims.tsx`)
5. Add navigation link
6. Test with real SP-API data

---

*Frontend integration guide for Phase 3: Claim Detection*

