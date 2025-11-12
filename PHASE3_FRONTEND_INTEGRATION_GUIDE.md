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

### 1. **Dashboard (Main Landing Page)** ⭐ PRIMARY LOCATION

**Location**: `src/pages/Dashboard.tsx` or `src/components/layout/Dashboard.tsx`

**What to Show**:
- **Total Claims Detected**: Large number card
- **Total Recovery Potential**: Dollar amount (e.g., "$3,240")
- **Confidence Breakdown**: 
  - High confidence (ready for auto-submit): Count + amount
  - Medium confidence (needs review): Count + amount
  - Low confidence (manual review): Count + amount
- **Quick Actions**:
  - "View All Claims" button
  - "Auto-Submit High Confidence" button (if any)

**Visual Design**:
```
┌─────────────────────────────────────────┐
│  💰 Claim Detection Results            │
├─────────────────────────────────────────┤
│  Total Claims: 18                      │
│  Recovery Potential: $3,240.50         │
│                                         │
│  ⚡ High Confidence: 12 claims ($2,100) │
│  ❓ Medium Confidence: 4 claims ($800)  │
│  📋 Low Confidence: 2 claims ($340)    │
│                                         │
│  [View All Claims] [Auto-Submit]       │
└─────────────────────────────────────────┘
```

### 2. **Claims/Recoveries Page** ⭐ DEDICATED PAGE

**Location**: `src/pages/Claims.tsx` or `src/pages/Recoveries.tsx`

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

### Step 2: Create Claims Component

**File**: `src/components/claims/ClaimsList.tsx`

```typescript
import React, { useEffect, useState } from 'react';
import { detectionApi } from '@/lib/api';

interface DetectionResult {
  id: string;
  anomaly_type: string;
  estimated_value: number;
  confidence_score: number;
  status: string;
  discovery_date: string;
  days_remaining?: number;
}

export const ClaimsList: React.FC = () => {
  const [claims, setClaims] = useState<DetectionResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadClaims();
  }, []);

  const loadClaims = async () => {
    try {
      const userId = getCurrentUserId(); // Your auth helper
      const response = await detectionApi.getDetectionResults(userId);
      if (response.success) {
        setClaims(response.results || []);
      }
    } catch (error) {
      console.error('Failed to load claims:', error);
    } finally {
      setLoading(false);
    }
  };

  const getConfidenceBadge = (score: number) => {
    if (score >= 0.85) return { label: 'High', color: 'green' };
    if (score >= 0.50) return { label: 'Medium', color: 'yellow' };
    return { label: 'Low', color: 'gray' };
  };

  if (loading) return <div>Loading claims...</div>;

  return (
    <div className="claims-list">
      <h2>Detected Claims</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Amount</th>
            <th>Confidence</th>
            <th>Status</th>
            <th>Days Remaining</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {claims.map(claim => {
            const badge = getConfidenceBadge(claim.confidence_score);
            return (
              <tr key={claim.id}>
                <td>{claim.anomaly_type}</td>
                <td>${claim.estimated_value.toFixed(2)}</td>
                <td>
                  <span className={`badge badge-${badge.color}`}>
                    {badge.label} ({(claim.confidence_score * 100).toFixed(0)}%)
                  </span>
                </td>
                <td>{claim.status}</td>
                <td>{claim.days_remaining || 'N/A'}</td>
                <td>
                  {claim.confidence_score >= 0.85 && (
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
};
```

### Step 3: Add to Dashboard

**File**: `src/pages/Dashboard.tsx`

```typescript
import { detectionApi } from '@/lib/api';
import { ClaimsSummary } from '@/components/claims/ClaimsSummary';

// In Dashboard component:
const [claimsStats, setClaimsStats] = useState(null);

useEffect(() => {
  loadClaimsStats();
}, []);

const loadClaimsStats = async () => {
  try {
    const userId = getCurrentUserId();
    const stats = await detectionApi.getDetectionStatistics(userId);
    if (stats.success) {
      setClaimsStats(stats.statistics);
    }
  } catch (error) {
    console.error('Failed to load claims stats:', error);
  }
};

// In render:
{claimsStats && (
  <ClaimsSummary stats={claimsStats} />
)}
```

### Step 4: Create Claims Summary Component

**File**: `src/components/claims/ClaimsSummary.tsx`

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

