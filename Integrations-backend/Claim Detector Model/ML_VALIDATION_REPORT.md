# ML Model Validation Report - 98% Accuracy Target

**Date:** 2025-11-13  
**Model:** Claim Detector (LightGBM)  
**Dataset:** 240 samples (203 claimable, 37 not claimable)  
**Status:** ⚠️ **Generalization Limited by Data Scarcity**

---

## 📊 Executive Summary

| Metric | Value | Target | Status | Interpretation |
|--------|-------|--------|--------|----------------|
| **Test Accuracy** | 97.92% | ≥98% | ⚠️ Very Close | Model fits test split well |
| **CV Mean ± Std** | 88.12% ± 3.07% | ≥98% mean, <1% std | ❌ FAIL | High variance, poor generalization |
| **Bootstrap CI Lower** | 93.70% | ≥96% | ❌ FAIL | Too wide to trust |
| **Permutation p-value** | 1.0000 | <0.05 | ❌ FAIL | Classic memorization signal |
| **Class 0 Recall** | 85.71% | ≥95% | ⚠️ Close | Improved from 57% (SMOTE helped) |
| **Inference P95** | 35.46ms | ≤2000ms | ✅ PASS | Production-ready speed |

---

## 🔍 Root Cause Analysis

### 1. **Data Scarcity (Primary Issue)**
- **240 samples** → Only ~36 class-0 examples (even with SMOTE, effective variety is small)
- **High-dimensional features (29)** + tiny data → high variance estimates
- Model capacity (LightGBM) **exceeds dataset's information content**
- Learning curve has **plateaued due to data scarcity**

### 2. **Overfitting Pattern**
- **Test ≈98%** but **CV ≈88%** → Model fits specific split but doesn't generalize
- **Permutation p = 1.0** → Model performance identical on shuffled labels = memorization
- **Bootstrap CI [93.7%, 100%]** → Too wide, indicates high uncertainty

### 3. **What's Working**
- ✅ **Speed:** 35ms P95 latency (production-ready)
- ✅ **Pipeline integrity:** Feature engineering, SMOTE, validation all functional
- ✅ **Class balance improvement:** Class 0 recall improved from 57% → 86% with SMOTE
- ✅ **Test set performance:** 97.92% accuracy shows model can learn patterns

---

## 🎯 Technical Recommendations

### Priority 1: Data Expansion (Critical)
**Target: 2,000-3,000 labeled rows minimum**

- Include diverse:
  - Marketplaces (different regions)
  - SKUs (various product categories)
  - Fee types (FBA, referral, shipping, etc.)
  - Time periods (seasonal variation)
  - Seller patterns (different account behaviors)

**Expected Impact:**
- CV mean: 88% → 94-96%
- Bootstrap lower bound: 93.7% → 95-96%
- Permutation p: 1.0 → <0.05 (genuine learning signal)

### Priority 2: Feature Audit
**Action:** Run correlation + mutual-information analysis vs. label

- Drop features with correlation >0.9 with `claimable`
- Check for label leakage (e.g., amount thresholds that directly encode claimability)
- Remove redundant engineered features

**Implementation:** Add feature importance analysis and correlation matrix

### Priority 3: Enhanced Regularization
**Current:** `num_leaves=15`, `min_child_samples=10`

**Recommended:**
- Increase `min_child_samples` to 15-20
- Add `lambda_l2=0.1-0.5` (L2 regularization)
- Reduce `num_leaves` to 10-12
- Stricter early stopping (15 rounds instead of 20)

### Priority 4: Validation Methodology
**Current:** Stratified K-fold (may have temporal leakage)

**Recommended:**
- **Blocked time-series cross-validation** (no future leakage)
- Ensure train/test split respects temporal ordering
- Add seller-level grouping (no same seller in both train/test)

### Priority 5: Noise Robustness
**Add:** K-fold mixup (slight jittering of numeric features)

- Forces smoother decision boundaries
- Reduces overfitting on exact feature values
- Improves generalization

### Priority 6: Target Logic Review
**Re-derive `claimable` label with fuzzier thresholds**

- Example: `>=$8` instead of `>=$10`
- Adds realistic noise to learning boundary
- Prevents model from memorizing exact thresholds

---

## 📈 Expected Outcomes After Data Expansion

### With 2,000-3,000 samples:

| Metric | Current | Expected | Confidence |
|--------|---------|----------|------------|
| CV Mean | 88.12% | 94-96% | High |
| CV Std | 3.07% | <1.5% | High |
| Bootstrap Lower | 93.70% | 95-96% | High |
| Permutation p | 1.0000 | <0.05 | High |
| Test Accuracy | 97.92% | 97-98% | Medium |

**At that point, 98% test accuracy will have statistical meaning.**

---

## 🎯 Statistical Robustness Targets

### Production-Level Certification Criteria

| Metric | Target | Purpose | Current Status |
|--------|--------|---------|----------------|
| **CV mean accuracy** | ≥94% | Indicates consistent learning | ❌ 88.12% |
| **CV std** | ≤0.015 | Indicates low volatility | ❌ 3.07% |
| **Permutation p-value** | <0.05 | Confirms real signal, not noise | ❌ 1.0000 |
| **Bootstrap CI lower bound** | ≥96% | Confirms stability | ❌ 93.70% |
| **Latency P95** | ≤2000ms | Real-time compliance | ✅ 35.46ms |

**Only once all five are stable do we lock the model as "production-level certified."**

---

## ✅ Current Production Readiness

| Dimension | Status | Notes |
|-----------|--------|-------|
| **Speed** | ✅ Ready | 35ms P95 latency, well under 2s target |
| **Pipeline** | ✅ Ready | Feature engineering, SMOTE, validation all working |
| **Generalization** | ⚠️ Limited | CV shows 88% mean, needs more data |
| **Class Balance** | ⚠️ Improved | 86% recall for minority class (was 57%) |
| **Statistical Rigor** | ⚠️ Needs Work | Permutation test fails, bootstrap CI too wide |

**Recommendation:** 
- ✅ **Deploy for monitoring** (speed is production-ready)
- ⚠️ **Set expectations** (88% CV mean, not 98%)
- 🎯 **Collect production data** (aim for 2k+ samples)
- 📊 **Monitor real-world performance** vs. test metrics

---

## 🛠️ Immediate Next Steps

1. **Feature Audit Script** (Next 1-2 days)
   - Correlation matrix vs. label
   - Mutual information analysis
   - Remove high-correlation features

2. **Enhanced Regularization** (Next 1-2 days)
   - Increase `min_child_samples`
   - Add `lambda_l2`
   - Test impact on CV variance

3. **Time-Series CV** (Next 2-3 days)
   - Implement blocked time-series split
   - Re-run validation
   - Compare with current CV results

4. **Data Collection Plan** (Ongoing)
   - Log all claims (especially non-claimable)
   - Target: +1,000 new samples in 2-4 weeks
   - Ensure diversity (marketplaces, SKUs, time periods)

5. **Production Monitoring** (After deployment)
   - Track prediction accuracy vs. ground truth
   - Monitor feature drift
   - Collect feedback for retraining

---

## 📝 Technical Notes

### Model Configuration (Current)
```python
LightGBM:
  - num_leaves: 15 (reduced from 31)
  - n_estimators: 100 (reduced from 200)
  - min_child_samples: 10
  - learning_rate: 0.05
  - feature_fraction: 0.8
  - scale_pos_weight: 0.186 (class imbalance)
  - SMOTE: Applied to training data
```

### Feature Count
- **Before simplification:** 41 features
- **After simplification:** 29 features
- **Removed:** Complex interactions, binning, z-scores, percentiles, leaky text features

### Validation Methodology
- **CV:** 5x5 Repeated Stratified K-Fold (25 folds total)
- **Bootstrap:** 1,000 samples, 95% CI
- **Permutation:** 100 permutations
- **Test Split:** 20% holdout, stratified

---

## 🎓 Key Learnings

1. **Small datasets (240 samples) cannot reliably achieve 98% accuracy**
   - Model capacity exceeds information content
   - High variance in CV estimates
   - Permutation test reveals memorization

2. **SMOTE helps class balance but doesn't solve data scarcity**
   - Improved Class 0 recall from 57% → 86%
   - But CV mean still low (88%)
   - Need real diverse data, not synthetic

3. **Test accuracy can be misleading on small datasets**
   - 97.92% test accuracy looks good
   - But CV 88% ± 3% tells the real story
   - Permutation test confirms memorization

4. **Speed is not the bottleneck**
   - 35ms P95 latency is excellent
   - Architecture is production-ready
   - Focus should be on data quality/quantity

---

## 📚 References

- [Scikit-learn Cross-Validation](https://scikit-learn.org/stable/modules/cross_validation.html)
- [Permutation Tests for Model Validation](https://scikit-learn.org/stable/modules/permutation_testing.html)
- [SMOTE for Imbalanced Learning](https://imbalanced-learn.org/stable/over_sampling.html)
- [LightGBM Regularization](https://lightgbm.readthedocs.io/en/latest/Parameters.html)

---

**Report Generated:** 2025-11-13  
**Next Review:** After data expansion (target: 2,000+ samples)

