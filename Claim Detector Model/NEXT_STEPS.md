# Next Steps - Model Improvement Roadmap

Based on the validation report and senior ML engineer analysis, here's the prioritized action plan:

---

## 🎯 Immediate Actions (Next 1-2 Days)

### 1. Feature Audit ✅ (Script Ready)
**File:** `scripts/feature_audit.py`

**Run:**
```bash
cd "Claim Detector Model/claim_detector"
python scripts/feature_audit.py
```

**What it does:**
- Calculates correlation matrix vs. target
- Computes mutual information scores
- Identifies features with correlation >0.9 (potential leakage)
- Provides recommendations for feature removal

**Expected output:**
- List of suspicious features
- Correlation and MI scores for all features
- Recommendations for feature pruning

---

### 2. Enhanced Regularization ✅ (Already Applied)

**Changes made:**
- `num_leaves`: 15 → 12
- `min_child_samples`: 10 → 15
- Added `lambda_l2=0.3` (L2 regularization)
- Stricter early stopping (15 rounds)

**Next:** Re-run training to see impact on CV variance

---

### 3. Re-run Training with Enhanced Regularization

```bash
python scripts/train_98_percent_model.py
```

**What to look for:**
- CV mean: Should be similar or slightly lower (more conservative)
- CV std: Should decrease (more stable)
- Permutation p: May improve slightly (less memorization)
- Test accuracy: May decrease slightly (less overfitting)

---

## 📊 Short-Term Actions (Next 2-4 Weeks)

### 4. Implement Time-Series Cross-Validation

**Current:** Stratified K-fold (may have temporal leakage)

**Recommended:** Blocked time-series CV

**Implementation:**
- Split by date (no future leakage)
- Ensure seller-level grouping (no same seller in train/test)
- Re-run validation

**Expected impact:**
- More realistic CV scores
- Better detection of temporal overfitting

---

### 5. Data Collection Plan

**Target:** +1,000 new samples in 2-4 weeks

**Priority data to collect:**
- ✅ **Non-claimable cases** (currently only 37, need 200+)
- ✅ **Diverse marketplaces** (different regions)
- ✅ **Various SKUs** (different product categories)
- ✅ **Different fee types** (FBA, referral, shipping, etc.)
- ✅ **Time periods** (seasonal variation)
- ✅ **Different seller patterns** (various account behaviors)

**Data logging:**
- Log all claims (especially non-claimable)
- Track prediction accuracy vs. ground truth
- Monitor feature distributions

---

### 6. Feature Simplification (After Audit)

**Based on feature audit results:**
- Remove features with correlation >0.9
- Drop redundant engineered features
- Keep only 10-15 highest-signal features

**Re-train and compare:**
- CV mean should improve (less overfitting)
- CV std should decrease (more stable)
- Permutation p should improve

---

## 🚀 Medium-Term Actions (Next 1-2 Months)

### 7. Production Deployment (With Monitoring)

**Deploy current model with:**
- ✅ Speed is production-ready (35ms P95)
- ⚠️ Set expectations: 88% CV mean, not 98%
- 📊 Monitor real-world performance

**Monitoring metrics:**
- Prediction accuracy vs. ground truth
- Feature drift detection
- Latency tracking
- Error analysis

---

### 8. Iterative Improvement

**After collecting 2,000+ samples:**
- Re-run full validation suite
- Expected improvements:
  - CV mean: 88% → 94-96%
  - Bootstrap lower: 93.7% → 95-96%
  - Permutation p: 1.0 → <0.05

**At that point:**
- 98% test accuracy will have statistical meaning
- Model can be confidently deployed
- Can push toward 97-98% with more data

---

## 📈 Success Metrics

### Current State
- Test Accuracy: 97.92% ✅ (very close to 98%)
- CV Mean: 88.12% ❌ (needs improvement)
- Bootstrap Lower: 93.70% ❌ (needs improvement)
- Permutation p: 1.0000 ❌ (needs improvement)
- Latency: 35ms ✅ (production-ready)

### Target State (After Data Expansion)
- Test Accuracy: 97-98% ✅
- CV Mean: 94-96% ✅
- Bootstrap Lower: 95-96% ✅
- Permutation p: <0.05 ✅
- Latency: <100ms ✅

---

## 🛠️ Tools & Scripts

### Available Scripts
1. **`train_98_percent_model.py`** - Main training script with robust validation
2. **`feature_audit.py`** - Feature correlation and leakage detection ✅ Enhanced
3. **`time_series_cv.py`** - Blocked time-series cross-validation ✅ Created

### To Create
1. **`data_collection_monitor.py`** - Track data collection progress
2. **`production_monitor.py`** - Monitor deployed model performance
3. **`explainability_export.py`** - Generate SHAP/LIME artifacts (post-stability)

### Enhanced Regularization (Applied)
- ✅ `feature_fraction`: 0.8 → 0.75 (stochasticity)
- ✅ `min_gain_to_split`: 0.01 (prevent shallow overfits)
- ✅ Early stopping: 20 → 15 rounds (stricter)

---

## 📝 Notes

- **Speed is not the bottleneck** - Focus on data quality/quantity
- **Test accuracy can be misleading** - Always check CV and permutation tests
- **Small datasets cannot reliably achieve 98%** - Need 2k+ samples
- **SMOTE helps but doesn't solve data scarcity** - Need real diverse data

---

## 🎯 Certification Workflow

### Phase 1: Stability Confirmation
1. ✅ Run time-series CV → Check mean ≥0.92, std ≤0.015
2. ✅ Run feature optimization → Check entropy drop <5%
3. ✅ Freeze feature schema v1.0

### Phase 2: Controlled Expansion
1. ✅ Expand data (synthetic ratio ≤1.5×)
2. ✅ Validate (noise ≤2%, permutation p <0.05)
3. ✅ Retrain → Target CV mean ≥94%

### Phase 3: Certification
1. ✅ Update ML Certification Dashboard
2. ✅ Verify all 5 metrics green for 3 consecutive runs
3. ✅ Export model artifacts
4. ✅ Run deployability checklist

### Phase 4: Optional Refinement
1. ✅ If accuracy 97.7-98.3% → Run target refinement
2. ✅ Bayesian ensembling or LightGBM+TabNet hybrid
3. ✅ Stabilize final 0.3-0.5%

---

## 📊 New Tools Available

1. **`time_series_cv.py`** - Forward chaining validation ✅
2. **`feature_optimization.py`** - Entropy-based feature pruning ✅
3. **`controlled_data_expansion.py`** - Validated data expansion ✅
4. **`target_refinement.py`** - Advanced ensembling (optional) ✅
5. **`ML_CERTIFICATION_DASHBOARD.md`** - Track certification metrics ✅
6. **`DEPLOYABILITY_CHECKLIST.md`** - Pre-deployment validation ✅

---

**Last Updated:** 2025-11-13  
**Next Review:** After feature audit and data collection progress

---

## 🚀 Quick Reference

### Start Here:
1. Read `STRATEGIC_OVERVIEW.md` - High-level strategy
2. Follow `EXECUTION_GUIDE.md` - Step-by-step workflow
3. Track progress in `ML_CERTIFICATION_DASHBOARD.md`

### Key Documents:
- **STRATEGIC_OVERVIEW.md** - Complete framework overview
- **EXECUTION_GUIDE.md** - Detailed step-by-step instructions
- **ML_CERTIFICATION_DASHBOARD.md** - Track certification metrics
- **DEPLOYABILITY_CHECKLIST.md** - Pre-deployment validation

### Key Scripts:
- `time_series_cv.py` - Forward chaining validation
- `feature_optimization.py` - Entropy-based pruning
- `controlled_data_expansion.py` - Validated expansion
- `target_refinement.py` - Advanced ensembling (optional)

