# Data Collection Tracker

**Purpose:** Track progress toward 2,000-3,000 sample target

**Current Status:** 240 samples (12% of 2,000 target, 8% of 3,000 target)

---

## 📊 Collection Progress

### Overall Progress

| Metric | Current | Target | Progress |
|--------|---------|--------|----------|
| **Total Samples** | 240 | 2,000-3,000 | 12% / 8% |
| **Claimable** | 203 | 1,200-1,800 | 17% / 11% |
| **Not Claimable** | 37 | 800-1,200 | 5% / 3% |
| **Class Balance** | 5.5:1 | 1.5:1 | ⚠️ Imbalanced |

### Weekly Progress

| Week | Target | Collected | Cumulative | Status | Notes |
|------|--------|-----------|------------|--------|-------|
| **Week 1** | +250 | - | - | ⏳ Pending | Start date: [Fill in] |
| **Week 2** | +250 | - | - | ⏳ Pending | - |
| **Week 3** | +250 | - | - | ⏳ Pending | - |
| **Week 4** | +250 | - | - | ⏳ Pending | - |
| **Total** | **+1,000** | **0** | **240** | ⏳ **0%** | - |

---

## 🎯 Collection Targets

### Priority 1: Non-Claimable Cases (CRITICAL)

**Current:** 37 samples  
**Target:** 800-1,200 samples  
**Gap:** 763-1,163 samples needed

**Why Critical:**
- Severe class imbalance (5.5:1 ratio)
- Model biased toward predicting "claimable"
- Need balanced dataset for stable performance

**Collection Strategy:**
- Focus on identifying non-claimable cases
- Review historical financial events
- Check seller records for non-claimable patterns
- Log production predictions (especially false positives)

---

### Priority 2: Diverse Marketplaces

**Current:** [Check existing data]  
**Target:** ≥3 different marketplaces

**Collection Strategy:**
- NA marketplace (current)
- EU marketplace
- JP marketplace
- Other regions if available

---

### Priority 3: Various SKUs

**Current:** [Check existing data]  
**Target:** ≥10 different product categories

**Collection Strategy:**
- Electronics
- Clothing
- Home & Kitchen
- Books
- Sports & Outdoors
- etc.

---

### Priority 4: Different Fee Types

**Current:** [Check existing data]  
**Target:** All major fee types represented

**Collection Strategy:**
- FBA fees
- Referral fees
- Shipping fees
- Storage fees
- Other adjustments

---

### Priority 5: Time Periods

**Current:** 2024-01-07 to 2025-10-20  
**Target:** ≥12 months of data

**Collection Strategy:**
- Historical data (if available)
- Recent data (last 3-6 months)
- Seasonal variation (Q4, Q1, etc.)

---

## 📝 Data Sources

### Source 1: Production API Logs
- **Status:** ⏳ Pending setup
- **Expected Rate:** +50-100 samples/week
- **Notes:** Set up logging hooks

### Source 2: Historical Financial Events
- **Status:** ⏳ Pending access
- **Expected Rate:** +100-200 samples/week
- **Notes:** Review past FBA events

### Source 3: Seller Account Records
- **Status:** ⏳ Pending access
- **Expected Rate:** +50-100 samples/week
- **Notes:** Anonymized seller data

### Source 4: Partner Sellers
- **Status:** ⏳ Pending partnership
- **Expected Rate:** +25-50 samples/week
- **Notes:** Anonymized data sharing

---

## 🔍 Data Quality Metrics

### Weekly Quality Checks

| Week | Samples | Quality Score | Issues | Status |
|------|---------|---------------|--------|--------|
| Week 1 | - | - | - | ⏳ Pending |
| Week 2 | - | - | - | ⏳ Pending |
| Week 3 | - | - | - | ⏳ Pending |
| Week 4 | - | - | - | ⏳ Pending |

**Quality Score Criteria:**
- Missing values <5%
- No duplicates
- Valid dates
- Correct labels
- Diversity maintained

---

## 📈 Expected Timeline

### Minimum Target (2,000 samples)
- **Current:** 240
- **Needed:** +1,760
- **Weekly Target:** +250
- **Timeline:** 7-8 weeks

### Optimal Target (3,000 samples)
- **Current:** 240
- **Needed:** +2,760
- **Weekly Target:** +250
- **Timeline:** 11-12 weeks

### Accelerated (if multiple sources)
- **Weekly Target:** +500
- **Timeline:** 4-6 weeks (2,000 samples)

---

## ✅ Integration Checklist

After each collection batch:

- [ ] Validate data quality (`validate_new_data.py`)
- [ ] Check for duplicates
- [ ] Verify chronological order
- [ ] Integrate into dataset (`integrate_new_data.py`)
- [ ] Run feature audit (`feature_audit.py`)
- [ ] Run time-series CV (`time_series_cv.py`)
- [ ] Update this tracker
- [ ] Document any issues

---

## 📊 Diversity Tracking

### Marketplace Distribution
- NA: [Count]
- EU: [Count]
- JP: [Count]
- Other: [Count]

### Category Distribution
- [Category 1]: [Count]
- [Category 2]: [Count]
- [Category 3]: [Count]
- etc.

### Time Period Distribution
- 2024 Q1: [Count]
- 2024 Q2: [Count]
- 2024 Q3: [Count]
- 2024 Q4: [Count]
- 2025 Q1: [Count]
- etc.

---

## 🚨 Issues & Blockers

### Current Blockers
- [ ] [Fill in any blockers]

### Resolved Issues
- [ ] [Fill in resolved issues]

---

**Last Updated:** 2025-11-13  
**Next Review:** After Week 1 collection

