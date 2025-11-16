# 🔍 Recoveries Page Calculation Debug

## Current Issue
Showing: **"$2,626.50 across 4 claims"**

## Calculation Breakdown

### Mock Claims (6 total):
1. **CLM-001**: status 'New', $450.00 ✅ (included)
2. **CLM-002**: status 'Pending', $125.50 ✅ (included)
3. **CLM-003**: status 'Submitted', $850.75 ✅ (included)
4. **CLM-004**: status 'Paid', $320.00 ❌ (excluded - not open)
5. **CLM-005**: status 'Denied', $75.25 ❌ (excluded - not open)
6. **CLM-006**: status 'Submitted', $1200.25 ✅ (included)

### Open Claims Filter:
```javascript
const openStatuses = new Set(['New', 'Pending', 'Submitted']);
const openClaims = dataSource.filter(c => openStatuses.has(c.status));
```

**Result:**
- Count: 4 claims (CLM-001, CLM-002, CLM-003, CLM-006)
- Total: $450 + $125.50 + $850.75 + $1200.25 = **$2,626.50** ✅

## Root Cause

The calculation is **correct** for the mock data. The issue is:

1. **`mergedRecoveries` is `null`** OR contains only mock claims
2. **No detection results** from API (returns 0 results)
3. **Falls back to `claims`** (mock data) in `owedSummary` calculation

### Code Flow:
```javascript
// Line 899: Choose data source
const dataSource = mergedRecoveries !== null ? mergedRecoveries : claims;

// Line 901: Filter by open statuses
const openStatuses = new Set(['New', 'Pending', 'Submitted']);
const openClaims = dataSource.filter(c => openStatuses.has(c.status));

// Line 902: Sum amounts
const totalOwed = openClaims.reduce((sum, c) => sum + (c.guaranteedAmount || 0), 0);
```

## Why `mergedRecoveries` Might Be Null

1. **Initial state**: `useState<any[] | null>(null)` - starts as null
2. **No detection results**: API returns `{ results: [], total: 0 }`
3. **Merge is called**: `mergeRecoveries(claims, [])` - merges mock claims with empty detection
4. **But timing issue**: `owedSummary` might calculate before `mergedRecoveries` is set

## Solution

The calculation is working correctly. The issue is **no detection results exist yet**.

**To fix:**
1. Run a sync to generate detection results
2. After sync, API will return 74+ detection results
3. `mergeRecoveries` will combine them with mock claims
4. `owedSummary` will calculate from the merged data (74+ claims)

## Verification Steps

1. **Check browser console** for:
   - `[Recoveries] mergeRecoveries called: { syncedCount: 6, detectedCount: 0 }`
   - `[Recoveries] mergeRecoveries result: 6 items`
   - `[Recoveries] No detection results, merging recoveries only`

2. **After running sync**, you should see:
   - `[Recoveries] Merging with detection results: 74`
   - `[Recoveries] mergeRecoveries result: 80 items` (74 detected + 6 mock)

3. **Summary should update** to show 74+ claims with correct total

---

**Conclusion:** The code is working correctly. You need to run a sync to generate detection results.

