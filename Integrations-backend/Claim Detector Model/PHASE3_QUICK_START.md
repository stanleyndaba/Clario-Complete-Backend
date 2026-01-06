# Phase 3 Quick Start Guide

**Status:** ⏳ **READY TO BEGIN DATA COLLECTION**

---

## 🚀 Immediate Actions

### 1. Collect New Data (Week 1)

**Priority:** Non-claimable cases (currently only 37, need 800+)

**Sources:**
- Production API logs
- Historical financial events
- Seller account records
- Partner seller data

**Target:** +250 samples this week

---

### 2. Validate Collected Data

```bash
cd "Claim Detector Model/claim_detector"
python scripts/validate_new_data.py --data-path ../../data/new_claims.csv --output validation_report.json
```

**Check:**
- Quality score ≥0.9
- No missing required fields
- No duplicates
- Valid dates and labels

---

### 3. Integrate Data

```bash
python scripts/integrate_new_data.py --new-data ../../data/new_claims.csv --backup --create-splits
```

**Result:**
- Data integrated into `processed_claims.csv`
- Backup created
- Train/val/test splits created

---

### 4. Validate Integration

```bash
python scripts/feature_audit.py
python scripts/time_series_cv.py
```

**Check:**
- No new feature leakage
- CV metrics stable or improved

---

### 5. Retrain Model

```bash
python scripts/train_98_percent_model.py
```

**Target:**
- CV mean ≥0.94
- CV std ≤0.015
- All 5 metrics green

---

### 6. Update Documentation

- Update `DATA_COLLECTION_TRACKER.md` with progress
- Update `PHASE3_RESULTS.md` with results
- Update `ML_CERTIFICATION_DASHBOARD.md` with metrics

---

## 📊 Weekly Checklist

### Every Week:
- [ ] Collect +250 samples
- [ ] Validate data quality
- [ ] Integrate into dataset
- [ ] Run validation checks
- [ ] Update tracker
- [ ] Document progress

### After 4 Weeks:
- [ ] Should have ~1,240 total samples
- [ ] Retrain model
- [ ] Evaluate performance
- [ ] Decide if more data needed

---

## 🎯 Success Criteria

**Minimum (2,000 samples):**
- Total: 2,000+
- Non-claimable: 800+
- CV mean ≥0.94
- CV std ≤0.015

**Optimal (3,000 samples):**
- Total: 3,000+
- Non-claimable: 1,200+
- CV mean ≥0.96
- CV std ≤0.012

---

## ⚠️ Alternative: Beta Deployment

**If data collection is delayed:**

1. Deploy current model (88-90% CV mean)
2. Set strict monitoring
3. Capture production labels
4. Build feedback loop
5. Accumulate real data for retraining

**This starts data collection immediately while model is in use.**

---

## 📝 Key Documents

- **`PHASE3_DATA_COLLECTION_PLAN.md`** - Complete collection strategy
- **`PHASE3_EXECUTION_GUIDE.md`** - Detailed step-by-step workflow
- **`DATA_COLLECTION_TRACKER.md`** - Progress tracking
- **`PHASE3_RESULTS.md`** - Results documentation

---

**Ready to begin data collection!** 🚀

