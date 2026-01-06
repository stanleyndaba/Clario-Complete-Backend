# Phase 3: Data Collection & Real-World Expansion

**Status:** ⏳ **READY TO EXECUTE**  
**Priority:** HIGHEST

**Key Insight:** Framework and model are certification-ready. Data scarcity (240 samples) is the only limiting factor.

---

## 🎯 Phase 3 Objectives

### Primary Goal
Collect 2,000-3,000 real samples to achieve stable 98% accuracy with statistical significance.

### Success Criteria
- [ ] 2,000-3,000 total samples collected
- [ ] Class balance improved (non-claimable cases: 37 → 800+)
- [ ] Data validated and integrated
- [ ] CV mean ≥0.94, std ≤0.015
- [ ] All 5 certification metrics green

---

## 📋 Phase 3 Steps

### Step 3.1: Collect Additional Real Claims ⏳

**Target:** 2,000-3,000 samples total

**Priority Focus:**
1. **Non-claimable cases** (currently only 37, need 800+)
2. **Diverse marketplaces** (different regions)
3. **Various SKUs** (different product categories)
4. **Different fee types** (FBA, referral, shipping, etc.)
5. **Time periods** (seasonal variation)

**Data Sources:**
- Past FBA financial events
- Seller account records
- Historical claims database
- Production API logs (if available)
- Partner seller data (anonymized)

**Timeline:** 2-4 weeks for +1,000 samples minimum

---

### Step 3.2: Validate Collected Data ⏳

**Validation Checklist:**
- [ ] Clean missing values and inconsistencies
- [ ] Preserve chronological order
- [ ] Ensure correct labeling (claimable 0/1)
- [ ] Track marketplace diversity
- [ ] Track SKU diversity
- [ ] Track fulfillment center diversity
- [ ] Verify date ranges
- [ ] Check for duplicates

**Validation Script:**
```bash
python scripts/validate_new_data.py
```

**Expected Output:**
- Data quality report
- Diversity metrics
- Label distribution
- Recommendations for cleaning

---

### Step 3.3: Integrate into Framework ⏳

**Integration Steps:**
1. Append new records to `processed_claims.csv`
2. Maintain chronological order
3. Split chronologically: train/val/test
4. Run feature audit to verify no leakage
5. Run time-series CV to verify no regressions

**Integration Script:**
```bash
python scripts/integrate_new_data.py --new-data new_claims.csv
```

**Validation:**
```bash
python scripts/feature_audit.py
python scripts/time_series_cv.py
```

---

### Step 3.4: Retrain and Validate ⏳

**Retraining:**
```bash
python scripts/train_98_percent_model.py
```

**Track Metrics:**
- CV mean ≥0.94 ✅
- CV std ≤0.015 ✅
- Bootstrap lower CI ≥0.96 ✅
- Permutation p <0.05 ✅
- Test accuracy ~98% ✅

**Document Results:**
- Update `PHASE3_RESULTS.md`
- Update `ML_CERTIFICATION_DASHBOARD.md`
- Track progress toward certification

---

## 📊 Data Collection Tracking

### Current State
- **Total Samples:** 240
- **Claimable:** 203 (84.6%)
- **Not Claimable:** 37 (15.4%)
- **Class Imbalance:** Severe (5.5:1 ratio)

### Target State
- **Total Samples:** 2,000-3,000
- **Claimable:** 1,200-1,800 (60%)
- **Not Claimable:** 800-1,200 (40%)
- **Class Balance:** Improved (1.5:1 ratio)

### Collection Progress

| Week | Target | Collected | Cumulative | Status |
|------|--------|-----------|------------|--------|
| Week 1 | +250 | - | - | ⏳ Pending |
| Week 2 | +250 | - | - | ⏳ Pending |
| Week 3 | +250 | - | - | ⏳ Pending |
| Week 4 | +250 | - | - | ⏳ Pending |
| **Total** | **+1,000** | **0** | **240** | ⏳ **0%** |

---

## 🔍 Data Quality Requirements

### Required Fields
- [ ] `claim_id` - Unique identifier
- [ ] `seller_id` - Seller identifier
- [ ] `order_id` - Order identifier
- [ ] `claim_date` - Date of claim
- [ ] `order_date` - Date of order
- [ ] `amount` - Claim amount
- [ ] `order_value` - Order value
- [ ] `quantity` - Quantity
- [ ] `category` - Product category
- [ ] `marketplace` - Marketplace
- [ ] `fulfillment_center` - Fulfillment center
- [ ] `claimable` - Label (0 or 1)

### Quality Checks
- [ ] No missing values in required fields
- [ ] Date ranges valid (no future dates)
- [ ] Amounts positive and reasonable
- [ ] No duplicate claim_ids
- [ ] Labels consistent (0 or 1 only)

---

## 🛠️ Tools to Create

### 1. Data Validation Script
**File:** `scripts/validate_new_data.py`
- Check data quality
- Verify required fields
- Check for duplicates
- Validate date ranges
- Report diversity metrics

### 2. Data Integration Script
**File:** `scripts/integrate_new_data.py`
- Append to existing dataset
- Maintain chronological order
- Preserve train/val/test splits
- Generate integration report

### 3. Data Collection Tracker
**File:** `DATA_COLLECTION_TRACKER.md`
- Track collection progress
- Log data sources
- Monitor diversity metrics
- Update weekly

---

## ⚠️ Alternative Options (If Data Collection Delayed)

### Option A: Deploy Current Model with Monitoring
**Action:**
- Deploy as "beta" release
- Set strict monitoring
- Capture production labels
- Build feedback loop
- Accumulate real data for retraining

**Pros:**
- Start collecting production data immediately
- Learn from real-world performance
- Build data collection pipeline

**Cons:**
- Model not certified (88-90% CV mean)
- May need frequent retraining
- Performance may vary

---

### Option B: Domain-Specific Data Augmentation
**Action:**
- Temporal bootstrapping
- SMOTE + real noise constraints
- Domain knowledge-based generation

**Pros:**
- Short-term gains possible
- Can test framework

**Cons:**
- High risk of instability
- Won't reach stable 98%
- May create false confidence

**Recommendation:** ⚠️ Use only as last resort

---

## 📈 Expected Impact

### With 2,000-3,000 Samples:

| Metric | Current | Expected | Confidence |
|--------|---------|----------|------------|
| **CV Mean** | 0.8604 | 0.94-0.96 | High |
| **CV Std** | 0.0419 | <0.015 | High |
| **Bootstrap Lower** | 0.8958 | 0.96-0.97 | High |
| **Permutation p** | 0.7500 | <0.05 | High |
| **Test Accuracy** | 0.9583 | 0.97-0.98 | Medium |

**At that point, 98% test accuracy will have statistical meaning.**

---

## ✅ Key Takeaways

1. **Framework is ready** - All tools and processes in place
2. **Model is ready** - Architecture validated and optimized
3. **Features are ready** - Clean, validated, frozen (v1.0)
4. **Data is the bottleneck** - Only remaining limitation

**Strategic Focus:** Shift fully to real data acquisition.

---

**Last Updated:** 2025-11-13  
**Next Action:** Begin data collection (Step 3.1)

