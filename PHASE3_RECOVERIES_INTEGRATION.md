# Phase 3: Integrating Detection Results into Recoveries Page

**Goal**: Show Phase 3 detection results on the existing Recoveries page, then display a summary on the Dashboard.

---

## Current State

### ✅ What Exists
- **Recoveries Page**: `src/pages/Recoveries.tsx` (already exists)
- **Recoveries Endpoint**: `/api/v1/integrations/amazon/recoveries` (returns synced claims)
- **Dashboard**: Shows recovery metrics

### ❌ What's Missing
- Detection results not shown on Recoveries page
- Detection results not merged with synced recoveries
- Dashboard doesn't show detection summary

---

## Integration Plan

### Step 1: Enhance Recoveries Page

**File**: `src/pages/Recoveries.tsx`

**Changes Needed**:

1. **Fetch Detection Results** alongside existing recoveries
2. **Merge Data**: Combine detection results with synced recoveries
3. **Add Columns**: Source, Confidence Score, Days Remaining
4. **Add Filters**: By source (Detected/Synced), by confidence level
5. **Visual Indicators**: Badge for "Detected" vs "Synced"

**Code Example**:

```typescript
// Add to Recoveries.tsx
import { detectionApi } from '@/lib/api';

const [detectionResults, setDetectionResults] = useState([]);
const [allRecoveries, setAllRecoveries] = useState([]);
const [filterSource, setFilterSource] = useState<'all' | 'detected' | 'synced'>('all');
const [filterConfidence, setFilterConfidence] = useState<'all' | 'high' | 'medium' | 'low'>('all');

// Load both detection results and existing recoveries
useEffect(() => {
  loadAllData();
}, []);

const loadAllData = async () => {
  // Load existing recoveries (your current code)
  const recoveriesRes = await api.getRecoveries();
  
  // Load detection results (NEW)
  const detectionRes = await detectionApi.getDetectionResults();
  
  if (detectionRes.success) {
    setDetectionResults(detectionRes.results || []);
  }
  
  // Merge them
  mergeRecoveries(recoveriesRes.data, detectionRes.results || []);
};

const mergeRecoveries = (syncedRecoveries: any[], detectedClaims: any[]) => {
  // Transform detection results to match recovery format
  const detected = detectedClaims.map(det => ({
    id: det.id,
    source: 'detected', // NEW: Mark as detected
    type: det.anomaly_type,
    amount: det.estimated_value,
    currency: det.currency,
    confidence_score: det.confidence_score, // NEW: Add confidence
    status: det.status,
    days_remaining: det.days_remaining, // NEW: Days until deadline
    discovery_date: det.discovery_date,
    deadline_date: det.deadline_date,
    // Map other fields as needed
  }));
  
  // Mark synced recoveries
  const synced = (syncedRecoveries || []).map(rec => ({
    ...rec,
    source: 'synced',
    confidence_score: null, // Synced claims don't have confidence
  }));
  
  // Combine and sort
  const merged = [...detected, ...synced].sort((a, b) => 
    new Date(b.discovery_date || b.created_at).getTime() - 
    new Date(a.discovery_date || a.created_at).getTime()
  );
  
  // Apply filters
  let filtered = merged;
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
  
  setAllRecoveries(filtered);
};

// Enhanced table with new columns
return (
  <div className="recoveries-page">
    <h2>Recoveries & Detected Claims</h2>
    
    {/* Filters */}
    <div className="filters">
      <select value={filterSource} onChange={(e) => {
        setFilterSource(e.target.value);
        mergeRecoveries(existingRecoveries, detectionResults);
      }}>
        <option value="all">All Sources</option>
        <option value="detected">Detected (Phase 3)</option>
        <option value="synced">Synced from Amazon</option>
      </select>
      
      {filterSource === 'detected' && (
        <select value={filterConfidence} onChange={(e) => {
          setFilterConfidence(e.target.value);
          mergeRecoveries(existingRecoveries, detectionResults);
        }}>
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
        {allRecoveries.map(recovery => {
          const confidenceBadge = getConfidenceBadge(recovery.confidence_score);
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
              <td>${recovery.amount.toFixed(2)} {recovery.currency}</td>
              <td>
                {confidenceBadge ? (
                  <span className={`badge badge-${confidenceBadge.color}`}>
                    {confidenceBadge.label} ({(recovery.confidence_score * 100).toFixed(0)}%)
                  </span>
                ) : (
                  <span>-</span>
                )}
              </td>
              <td>{recovery.status}</td>
              <td>
                {recovery.days_remaining !== null && recovery.days_remaining !== undefined ? (
                  <span className={recovery.days_remaining <= 7 ? 'text-warning' : ''}>
                    {recovery.days_remaining} days
                  </span>
                ) : (
                  <span>-</span>
                )}
              </td>
              <td>
                {recovery.confidence_score >= 0.85 && (
                  <button className="btn-primary">Auto-Submit</button>
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

---

### Step 2: Add Summary Card to Dashboard

**File**: `src/pages/Dashboard.tsx`

**Changes Needed**:

1. **Fetch Detection Statistics** on mount
2. **Display Summary Card** with totals and breakdown
3. **Link to Recoveries Page** for full details

**Code Example**:

```typescript
// Add to Dashboard.tsx
import { detectionApi } from '@/lib/api';
import { Link } from 'react-router-dom';

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

// In render - add summary card (alongside existing recovery cards)
{detectionStats && detectionStats.totalDetections > 0 && (
  <div className="card detection-summary-card">
    <div className="card-header">
      <h3>💰 Detected Claims</h3>
    </div>
    <div className="card-body">
      <div className="stats-row">
        <div className="stat-item">
          <div className="stat-label">Total Detected</div>
          <div className="stat-value">{detectionStats.totalDetections}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">Recovery Potential</div>
          <div className="stat-value">${detectionStats.estimatedRecovery.toFixed(2)}</div>
        </div>
      </div>
      
      <div className="confidence-breakdown">
        <div className="confidence-item high">
          <span className="icon">⚡</span>
          <span>High: {detectionStats.highConfidence} claims</span>
        </div>
        <div className="confidence-item medium">
          <span className="icon">❓</span>
          <span>Medium: {detectionStats.mediumConfidence} claims</span>
        </div>
        <div className="confidence-item low">
          <span className="icon">📋</span>
          <span>Low: {detectionStats.lowConfidence} claims</span>
        </div>
      </div>
      
      <Link to="/recoveries" className="btn btn-primary">
        View All in Recoveries →
      </Link>
    </div>
  </div>
)}
```

---

## API Integration

### Add to API Client

**File**: `src/lib/api.ts` or `src/services/api.ts`

```typescript
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
  getDetectionStatistics: async () => {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/integrations/detections/statistics`,
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
  getClaimsApproachingDeadline: async (days: number = 7) => {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/integrations/detections/deadlines?days=${days}`,
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

---

## Testing with Sandbox SP-API

### Test Script

```powershell
# Test Phase 3 with sandbox SP-API
powershell -ExecutionPolicy Bypass -File scripts/test-phase3-spapi.ps1 -UserId "sandbox-user" -ApiUrl "http://localhost:3001" -Verbose
```

### Manual Testing Steps

1. **Start Backend**:
   ```bash
   cd Integrations-backend
   npm start
   ```

2. **Trigger Sync** (this automatically triggers detection):
   ```bash
   curl -X POST http://localhost:3001/api/amazon/sync \
     -H "Content-Type: application/json" \
     -d '{"userId": "sandbox-user"}'
   ```

3. **Check Detection Results**:
   ```bash
   curl http://localhost:3001/api/v1/integrations/detections/results \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

4. **Check Statistics**:
   ```bash
   curl http://localhost:3001/api/v1/integrations/detections/statistics \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

5. **Verify on Frontend**:
   - Open Recoveries page
   - Should see both synced recoveries and detected claims
   - Filter by "Detected" to see only Phase 3 results
   - Check Dashboard for summary card

---

## Summary

### ✅ Integration Points

1. **Recoveries Page** (`src/pages/Recoveries.tsx`):
   - Fetch detection results
   - Merge with existing recoveries
   - Add Source and Confidence columns
   - Add filters

2. **Dashboard** (`src/pages/Dashboard.tsx`):
   - Fetch detection statistics
   - Display summary card
   - Link to Recoveries page

3. **API Client** (`src/lib/api.ts`):
   - Add `detectionApi` methods
   - Get detection results
   - Get statistics

### 🎯 User Flow

1. User logs in → Dashboard shows detection summary
2. User clicks "View All in Recoveries" → Goes to Recoveries page
3. Recoveries page shows:
   - All recoveries (synced + detected)
   - Filters to view only detected claims
   - Confidence scores for detected claims
   - Actions based on confidence level

---

*Integration guide for Phase 3 detection results into existing Recoveries page*

