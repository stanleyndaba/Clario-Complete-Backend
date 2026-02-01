# 📋 Recoveries Page - What You Should See

## 🎯 Overview

The Recoveries page displays **all claimable opportunities** from two sources:
1. **Agent 3 Detections** (automatically detected from synced data)
2. **Synced Recoveries** (from other sources)

---

## 📊 Page Layout

### **1. Page Header**
```
┌─────────────────────────────────────────────────┐
│ Recoveries                                      │
│ Comprehensive view of all recovery claims...    │
│ [Auto-Submit Selected] Button                   │
└─────────────────────────────────────────────────┘
```

### **2. Urgent Claims Banner** (if any claims expiring soon)
```
┌─────────────────────────────────────────────────┐
│ ⚠️ 5 Claims Expiring Soon                       │
│ Some claims are expiring in less than 3 days... │
│ [3 days left • $150.00] [File Claim]            │
│ [5 days left • $200.00] [File Claim]           │
│ [View All 5 Claims]                             │
└─────────────────────────────────────────────────┘
```
- **Red banner** if ≤3 days remaining
- **Amber banner** if 4-7 days remaining
- Shows top 5 urgent claims
- "File Claim" button for each

---

### **3. Opportunity Radar Summary Card**
```
┌─────────────────────────────────────────────────┐
│ Detected Reimbursements                        │
│ $5,000 across 74 claims                        │
│                                                 │
│ [Lost Inventory: 20] [Damaged: 15]             │
│ [Overcharges: 25] [Uncredited Returns: 10]    │
│                                                 │
│ Last scan just now • [Detect Claims] Button    │
└─────────────────────────────────────────────────┘
```
- **Total value** of all open claims
- **Category breakdown** chips
- **"Detect Claims"** button to trigger new detection

---

### **4. Key Metrics Bar** (4 cards)
```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Total Claims │ │ Total Value  │ │ In Progress │ │ Success Rate │
│     74       │ │   $5,000     │ │     45      │ │     85%      │
│ (30 high)    │ │ (5 expiring) │ │ (3 expired) │ │ (20 med/low) │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

---

### **5. Filters & Search Bar**
```
┌─────────────────────────────────────────────────┐
│ [🔍 Search...]                                  │
│                                                 │
│ Source: [All ▼] [Detected] [Synced]            │
│ Confidence: [All ▼] [High] [Medium] [Low]       │
│ Type: [All ▼] [Lost Inventory] [Damaged]...    │
│ Status: [All ▼] [New] [Pending] [Submitted]   │
│ Date Range: [Last 30 days ▼]                    │
└─────────────────────────────────────────────────┘
```

---

### **6. Main Table** (Claims List)

**Table Columns:**

| Column | What It Shows | Example |
|--------|---------------|---------|
| **☑️** | Checkbox for bulk actions | ☑️ |
| **Source** | Badge: "Detected" (blue) or "Synced" (gray) | 🔵 Detected |
| **Claim ID** | Clickable link to claim details | `det_123...` |
| **Created** | Discovery date | Nov 16, 2025 |
| **Type** | Anomaly type | `missing_unit` |
| **Confidence** | Badge: High/Medium/Low + % | 🟢 High (87%) |
| **Evidence** | Status: "Ready" or "Collecting" | Ready |
| **Details** | Description + SKU/ASIN | "missing_unit detected with 87% confidence"<br>SKU: SKU-001 • ASIN: B08... |
| **Status** | Badge: New/Pending/Submitted/Paid/Denied | 🟦 New |
| **Days Remaining** | Countdown to deadline | 45 days |
| **Guaranteed Amount** | Estimated value | $150.00 |
| **Expected Payout** | Deadline date | Jan 15, 2026 |
| **Actions** | Menu: View, Submit, etc. | ⋮ |

---

## 🎨 Visual Indicators

### **Source Badges:**
- 🔵 **"Detected"** (blue) = Agent 3 detection results
- ⚪ **"Synced"** (gray) = Other recovery sources

### **Confidence Badges:**
- 🟢 **High** (green) = ≥85% confidence
- 🟡 **Medium** (yellow) = 50-85% confidence
- ⚪ **Low** (gray) = <50% confidence

### **Status Badges:**
- 🟦 **New** (blue) = Just detected, not filed yet
- 🟠 **Pending** (orange) = Filed, waiting for response
- 🟣 **Submitted** (purple) = Submitted to Amazon
- 🟢 **Paid** (green) = Approved and paid
- 🔴 **Denied** (red) = Rejected by Amazon

### **Days Remaining:**
- **Amber/Red** if ≤7 days (urgent)
- **Gray** if >7 days

---

## 📋 Example Row (Agent 3 Detection)

```
┌────────────────────────────────────────────────────────────────────┐
│ ☑️ │ 🔵 Detected │ det_123 │ Nov 16 │ missing_unit │ 🟢 High (87%) │
│    │             │         │        │              │               │
│ Ready │ "missing_unit detected with 87% confidence"              │
│       │ SKU: SKU-001 • ASIN: B08K2XR456                           │
│       │                                                           │
│ 🟦 New │ 45 days │ $150.00 │ Jan 15, 2026 │ [⋮ Actions]         │
└────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 What to Look For

### **After Running a Sync:**

1. **Check the Summary Card:**
   - Should show total value (e.g., "$5,000 across 74 claims")
   - Category breakdown should show counts

2. **Check the Table:**
   - Rows with 🔵 **"Detected"** badge = Agent 3 results
   - Confidence badges should be visible
   - Days remaining countdown should show
   - Status should be "New" for new detections

3. **Check Filters:**
   - Filter by **Source: "Detected"** → Should show only Agent 3 results
   - Filter by **Confidence: "High"** → Should show only high-confidence claims

4. **Check Urgent Claims Banner:**
   - If any claims have ≤7 days remaining, banner appears at top
   - Shows countdown and "File Claim" buttons

---

## 🎯 Expected Data (After Sync)

Based on your logs showing **74 claims detected**, you should see:

- **Total Claims:** 74
- **High Confidence:** ~30 (≥85%)
- **Medium Confidence:** ~30 (50-85%)
- **Low Confidence:** ~14 (<50%)
- **Total Value:** Sum of all `estimated_value` fields
- **Types:** Various (missing_unit, damaged_stock, incorrect_fee, etc.)

---

## ⚠️ If You Don't See Results

1. **Check if sync completed:**
   - Go to Sync page
   - Verify sync shows "74 claims detected"

2. **Check browser console:**
   - Open DevTools (F12)
   - Look for errors in Console tab
   - Check Network tab for `/api/detections/results` request

3. **Check filters:**
   - Make sure "Source" filter is set to "All" or "Detected"
   - Clear all filters to see everything

4. **Refresh the page:**
   - Sometimes data needs a refresh to load

---

## ✅ Success Indicators

You'll know it's working when you see:

- ✅ **"Detected"** badges in the Source column
- ✅ **Confidence badges** (High/Medium/Low) with percentages
- ✅ **Days remaining** countdown showing numbers
- ✅ **Type** column showing anomaly types (missing_unit, etc.)
- ✅ **Details** showing "detected with X% confidence"
- ✅ **Total Claims** metric matches sync count (74)

---

## 🎨 Visual Example

```
┌─────────────────────────────────────────────────────────────┐
│ Recoveries                                                   │
│                                                              │
│ ⚠️ 3 Claims Expiring Soon                                    │
│ [3 days left • $150] [File Claim]                           │
│                                                              │
│ Detected Reimbursements                                      │
│ $5,000 across 74 claims                                      │
│ [Lost Inventory: 20] [Damaged: 15] [Overcharges: 25]       │
│                                                              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│ │ Total    │ │ Value    │ │ Progress │ │ Success  │      │
│ │   74     │ │ $5,000   │ │    45    │ │   85%   │      │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                              │
│ [🔍 Search...] [Source: All ▼] [Confidence: All ▼]         │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ☑️ │ Source │ ID │ Created │ Type │ Confidence │ ... │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ ☑️ │🔵Detected│det_1│Nov 16│missing│🟢High(87%)│...│ │
│ │ ☑️ │🔵Detected│det_2│Nov 16│damaged│🟡Med(65%)│...│ │
│ │ ☑️ │🔵Detected│det_3│Nov 16│fee    │🟢High(92%)│...│ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

**That's what you should see on the Recoveries page!** 🎉


