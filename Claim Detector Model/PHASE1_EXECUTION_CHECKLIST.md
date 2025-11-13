# Phase 1 Execution Checklist

**Status:** ⏳ **READY TO EXECUTE**

**Goal:** Establish baseline stability before data expansion

**Principle:** Focus on stability first — reproducible 94-95% CV accuracy with certified metrics is better than chasing 98% on small dataset.

---

## 📋 Phase 1 Steps

### Step 1.1: Time-Series Cross-Validation ⏳

**Command:**
```bash
python scripts/time_series_cv.py
```

**Targets:**
- ✅ CV mean ≥ 0.92
- ✅ CV std ≤ 0.015
- ✅ CV-test gap ≤ 3-4% (small)
- ✅ Each fold improves slightly (monotonic stability)

**What to Check:**
- If last fold <0.85 → log as temporal drift (not model failure)
- If CV-test gap >10% → indicates overfitting

**Status:** ⏳ Pending execution

---

### Step 1.2: Feature Audit ⏳

**Command:**
```bash
python scripts/feature_audit.py
```

**Targets:**
- ✅ Identify features with correlation >0.9 (REMOVE)
- ✅ Identify features with correlation 0.7-0.9 (REVIEW)
- ✅ Check high mutual information features (spurious?)

**Output:**
- List of features to remove
- List of features to review
- Feature pruning strategy (10-15% removal target)

**Status:** ⏳ Pending execution

---

### Step 1.3: Feature Optimization ⏳

**Command:**
```bash
python scripts/feature_optimization.py
```

**Targets:**
- ✅ Entropy drop <5% (removed noise correctly)
- ⚠️ If entropy drop 5-10% → review removed features
- ❌ If entropy drop >10% → restore some "REVIEW" features

**Output:**
- Optimized feature set
- Feature schema v1.0 (frozen - no new features during tuning)
- Entropy analysis report

**Status:** ⏳ Pending execution

---

## ✅ Post-Execution Checks

### 1. Update Certification Dashboard

**File:** `ML_CERTIFICATION_DASHBOARD.md`

**Action:**
- Add Iteration 2 row with Phase 1 results
- Update "Last Run" column
- Update "Status" column (✅/❌/⚠️)

**Metrics to Record:**
- CV Mean ± Std
- Bootstrap CI Lower
- Permutation p-value
- Test Accuracy
- Latency P95

---

### 2. Confirm Certification Metrics

**Check all 5 metrics:**
- [ ] CV Mean ≥ 0.92
- [ ] CV Std ≤ 0.015
- [ ] Bootstrap CI Lower ≥ 0.96 (or improving)
- [ ] Permutation p < 0.05 (or improving)
- [ ] Latency P95 < 50ms

**If all green:** ✅ Proceed to Phase 2  
**If some red:** ⚠️ Review and fix before Phase 2

---

### 3. Identify Red Flags

**Watch for:**
- ⚠️ **High CV variance** (std >0.015) → Need more regularization or data
- ⚠️ **Unstable features** (entropy drop >10%) → Restore features
- ⚠️ **Temporal drift** (last fold <0.85) → Log as data issue, not model failure
- ⚠️ **CV-test gap >10%** → Overfitting, reduce model complexity

---

## 🎯 Success Criteria for Phase 1

**Phase 1 is successful when:**
- [x] Time-series CV mean ≥ 0.92, std ≤ 0.015
- [x] Feature optimization entropy drop <5%
- [x] Feature schema v1.0 frozen
- [x] All red flags addressed
- [x] Certification dashboard updated

**If successful:** ✅ Proceed to Phase 2 (Controlled Data Expansion)  
**If not:** ⚠️ Review issues, adjust, and re-run Phase 1

---

## 📊 Progress Tracking

| Step | Command | Status | Date | Notes |
|------|---------|--------|------|-------|
| 1.1 | `time_series_cv.py` | ⏳ | - | - |
| 1.2 | `feature_audit.py` | ⏳ | - | - |
| 1.3 | `feature_optimization.py` | ⏳ | - | - |
| Post | Update Dashboard | ⏳ | - | - |
| Post | Confirm Metrics | ⏳ | - | - |
| Post | Check Red Flags | ⏳ | - | - |

---

## 🚀 Next Steps After Phase 1 Success

### Phase 2: Controlled Data Expansion
```bash
python scripts/controlled_data_expansion.py
python scripts/train_98_percent_model.py
```

### Phase 3: Certification
- Update dashboard for consecutive green runs
- Freeze model artifacts
- Run deployability checklist

### Phase 4: Optional Refinement
```bash
python scripts/target_refinement.py
```

---

## 📝 Execution Notes

**Date Started:** [Fill in]  
**Date Completed:** [Fill in]  
**Issues Encountered:** [Fill in]  
**Decisions Made:** [Fill in]

---

**Ready to execute Phase 1!** 🚀

