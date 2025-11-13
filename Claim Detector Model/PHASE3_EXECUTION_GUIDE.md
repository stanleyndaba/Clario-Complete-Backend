# Phase 3 Execution Guide: Data Collection & Integration

**Status:** ⏳ **READY TO EXECUTE**  
**Priority:** HIGHEST

**Key Principle:** Framework and model are ready. Data collection is the critical path.

---

## 🎯 Quick Start

### Step 1: Collect New Data
- Target: +1,000 samples in 2-4 weeks
- Priority: Non-claimable cases (currently only 37)
- Sources: Production logs, historical events, seller records

### Step 2: Validate New Data
```bash
python scripts/validate_new_data.py --data-path new_claims.csv --output validation_report.json
```

**Check:**
- Quality score ≥0.9
- No missing required fields
- No duplicates
- Valid dates and labels

### Step 3: Integrate Data
```bash
python scripts/integrate_new_data.py --new-data new_claims.csv --backup --create-splits
```

**Result:**
- Integrated dataset saved
- Backup created
- Train/val/test splits created

### Step 4: Validate Integration
```bash
python scripts/feature_audit.py
python scripts/time_series_cv.py
```

**Check:**
- No new feature leakage
- CV metrics stable or improved

### Step 5: Retrain Model
```bash
python scripts/train_98_percent_model.py
```

**Target Metrics:**
- CV mean ≥0.94
- CV std ≤0.015
- Bootstrap lower ≥0.96
- Permutation p <0.05
- Test accuracy ~98%

### Step 6: Update Documentation
- Update `PHASE3_RESULTS.md`
- Update `ML_CERTIFICATION_DASHBOARD.md`
- Update `DATA_COLLECTION_TRACKER.md`

---

## 📋 Detailed Workflow

### Week 1: Initial Collection

**Day 1-2: Setup**
- [ ] Set up production logging hooks
- [ ] Identify data sources
- [ ] Create data collection pipeline

**Day 3-5: Collection**
- [ ] Collect +250 samples
- [ ] Focus on non-claimable cases
- [ ] Ensure diversity

**Day 6-7: Validation & Integration**
- [ ] Validate collected data
- [ ] Integrate into dataset
- [ ] Run validation checks

---

### Week 2-4: Continued Collection

**Repeat weekly:**
1. Collect +250 samples
2. Validate data quality
3. Integrate into dataset
4. Run validation checks
5. Update tracker

**After Week 4:**
- Should have ~1,240 total samples
- Retrain model
- Evaluate performance
- Decide if more data needed

---

## 🔍 Validation Gates

### Gate 1: Data Quality
- Quality score ≥0.9
- Missing values <5%
- No duplicates
- Valid dates and labels

**If FAIL:** Fix issues before integration

### Gate 2: Feature Audit
- No new feature leakage
- Correlation <0.9 for all features
- Entropy stable

**If FAIL:** Review new data for leakage

### Gate 3: Time-Series CV
- CV mean stable or improved
- CV std stable or improved
- No regressions

**If FAIL:** Review data integration

### Gate 4: Model Performance
- CV mean ≥0.94
- CV std ≤0.015
- All 5 metrics green

**If PASS:** Certification achieved!

---

## 📊 Success Criteria

### Minimum (2,000 samples)
- [ ] Total samples: 2,000+
- [ ] Non-claimable: 800+
- [ ] CV mean ≥0.94
- [ ] CV std ≤0.015
- [ ] All 5 metrics green

### Optimal (3,000 samples)
- [ ] Total samples: 3,000+
- [ ] Non-claimable: 1,200+
- [ ] CV mean ≥0.96
- [ ] CV std ≤0.012
- [ ] All 5 metrics green

---

## ⚠️ Alternative: Deploy with Monitoring

**If data collection is delayed:**

### Option: Beta Deployment
1. Deploy current model (88-90% CV mean)
2. Set strict monitoring
3. Capture production labels
4. Build feedback loop
5. Accumulate real data for retraining

**Pros:**
- Start collecting production data immediately
- Learn from real-world performance
- Build data collection pipeline

**Cons:**
- Model not certified
- May need frequent retraining
- Performance may vary

---

## 📝 Documentation Updates

After each integration:

1. **Update `DATA_COLLECTION_TRACKER.md`**
   - Add weekly progress
   - Update diversity metrics
   - Log issues

2. **Update `PHASE3_RESULTS.md`**
   - Document integration results
   - Track performance improvements
   - Note any issues

3. **Update `ML_CERTIFICATION_DASHBOARD.md`**
   - Add new iteration
   - Track certification progress
   - Monitor for 3 consecutive green runs

---

## 🎯 Key Takeaways

1. **Framework is ready** - All tools in place
2. **Model is ready** - Architecture validated
3. **Features are ready** - Clean and frozen (v1.0)
4. **Data is the bottleneck** - Only remaining limitation

**Strategic Focus:** Real data acquisition is the critical path to certification.

---

**Last Updated:** 2025-11-13  
**Next Action:** Begin data collection (Week 1)

