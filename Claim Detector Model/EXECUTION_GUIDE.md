# Execution Guide: Step-by-Step Certification Workflow

**Purpose:** Practical step-by-step guide to execute the certification workflow

**Prerequisites:** All scripts and documentation in place ✅

---

## 🎯 Phase 1: Stability Confirmation

### Step 1.1: Time-Series Cross-Validation

```bash
cd "Claim Detector Model/claim_detector"
python scripts/time_series_cv.py
```

**What to Check:**
- ✅ CV mean ≥0.92
- ✅ CV std ≤0.015
- ✅ Each fold improves slightly (monotonic)
- ⚠️ If last fold <0.85 → log as temporal drift

**Expected Output:**
```
TIME-SERIES CV RESULTS
Accuracy:  0.92XX ± 0.01XX
F1 Score:  0.94XX ± 0.01XX
Range:     [0.89XX, 0.94XX]

TARGET ASSESSMENT
✅ CV mean accuracy ≥94%: 0.92XX
✅ CV std ≤0.015: 0.01XX
```

**If Targets Met:** ✅ Proceed to Step 1.2  
**If Targets Not Met:** ⚠️ Review data quality, consider more regularization

---

### Step 1.2: Feature Audit

```bash
python scripts/feature_audit.py
```

**What to Check:**
- Features with correlation >0.9 (REMOVE)
- Features with correlation 0.7-0.9 (REVIEW)
- High mutual information features (check if spurious)

**Expected Output:**
```
🔴 REMOVE these features (correlation >0.9):
  - feature_name: 0.95XX

🟡 REVIEW these features (correlation 0.7-0.9):
  - feature_name: 0.85XX
```

**Action:** Note features to remove and review

---

### Step 1.3: Feature Optimization

```bash
python scripts/feature_optimization.py
```

**What to Check:**
- ✅ Entropy drop <5% → Proceed with optimized set
- ⚠️ Entropy drop 5-10% → Review removed features
- ❌ Entropy drop >10% → Restore some "REVIEW" features

**Expected Output:**
```
ENTROPY ANALYSIS
Baseline entropy:  2.5XXX
Optimized entropy: 2.4XXX
Entropy drop:      0.1XXX (4.XX%)

✅ Entropy drop <5%: Removed noise correctly
   → Proceed with optimized feature set
```

**If Entropy Drop <5%:** ✅ Feature schema v1.0 frozen  
**If Entropy Drop >10%:** ⚠️ Restore top 3-5 features from REVIEW list

---

## 🎯 Phase 2: Controlled Data Expansion

### Step 2.1: Expand Data

```bash
python scripts/controlled_data_expansion.py
```

**What to Check:**
- ✅ Synthetic ratio ≤1.5×
- ✅ Label noise ≤2%
- ✅ Permutation test p <0.05

**Expected Output:**
```
VALIDATION SUMMARY
✅ All validation checks passed - proceed with retraining

[1/3] Synthetic ratio: 1.50×
   ✅ Ratio ≤1.5× (acceptable)

[2/3] Estimated label noise: 1.XX%
   ✅ Noise ≤2% (acceptable)

[3/3] Permutation p-value: 0.0XXX
   ✅ p < 0.05 (proceed with retraining)
```

**If All Checks Pass:** ✅ Proceed to Step 2.2  
**If Checks Fail:** ⚠️ Review expansion method, re-sample

---

### Step 2.2: Retrain on Expanded Data

```bash
python scripts/train_98_percent_model.py
```

**What to Check:**
- ✅ CV mean ≥94%
- ✅ CV std ≤0.015
- ✅ Bootstrap CI lower ≥96%
- ✅ Permutation p <0.05

**Expected Output:**
```
CV Results (25 folds):
  Accuracy:  0.94XX ± 0.01XX
  F1 Score:  0.96XX ± 0.01XX

Bootstrap 95% CI:
  95% CI:    [0.96XX, 1.0000]
  Status: ✅ PASS (Lower bound ≥0.96)

Permutation Test Results:
  P-value:           0.0XXX
  Is significant:   ✅ YES
```

**If Targets Met:** ✅ Proceed to Phase 3  
**If Targets Not Met:** ⚠️ Collect more real data, re-run expansion

---

## 🎯 Phase 3: Certification

### Step 3.1: Update Certification Dashboard

1. Open `ML_CERTIFICATION_DASHBOARD.md`
2. Add new row to "Training Iteration History"
3. Update "Last Run" column with new metrics
4. Update "Status" column (✅/❌/⚠️)

**Example:**
```markdown
### Iteration 2: After Data Expansion (2025-11-XX)
| Metric | Value | Status |
|--------|-------|--------|
| CV Mean ± Std | 0.94XX ± 0.01XX | ✅ |
| Bootstrap CI Lower | 0.96XX | ✅ |
| Permutation p-value | 0.0XXX | ✅ |
| Test Accuracy | 0.98XX | ✅ |
| Latency P95 | 35.XXms | ✅ |
```

**Check:** Are all 5 metrics green?  
**If Yes:** ✅ Count toward 3 consecutive green runs  
**If No:** ⚠️ Review and fix issues

---

### Step 3.2: Verify 3 Consecutive Green Runs

**Requirement:** All 5 metrics must be green for 3 consecutive iterations

**Checklist:**
- [ ] Iteration 1: All green?
- [ ] Iteration 2: All green?
- [ ] Iteration 3: All green?

**If All 3 Green:** ✅ **CERTIFIED** - Proceed to Step 3.3  
**If Not:** ⏳ Continue training until 3 consecutive green runs

---

### Step 3.3: Export Model Artifacts

**Create export script** (or use existing):

```python
# scripts/export_model_artifacts.py
import pickle
import json
from pathlib import Path
import pandas as pd

def export_artifacts(model, scaler, feature_schema, metrics, version='1.0'):
    base_path = Path('models') / f'v{version}'
    base_path.mkdir(parents=True, exist_ok=True)
    
    # Export model
    with open(base_path / 'model.pkl', 'wb') as f:
        pickle.dump(model, f)
    
    # Export scaler
    with open(base_path / 'scaler.pkl', 'wb') as f:
        pickle.dump(scaler, f)
    
    # Export feature schema
    with open(base_path / 'feature_schema.json', 'w') as f:
        json.dump(feature_schema, f, indent=2)
    
    # Export metadata
    metadata = {
        'version': version,
        'training_date': pd.Timestamp.now().isoformat(),
        'metrics': metrics,
        'feature_count': len(feature_schema['features'])
    }
    with open(base_path / 'model_metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"✅ Artifacts exported to: {base_path}")
    return base_path
```

**Run export:**
```python
# After training completes
from scripts.export_model_artifacts import export_artifacts

export_artifacts(
    model=model.ensemble,
    scaler=model.scaler,
    feature_schema=feature_schema,
    metrics={
        'cv_mean': 0.94XX,
        'cv_std': 0.01XX,
        'bootstrap_lower': 0.96XX,
        'permutation_p': 0.0XXX,
        'test_accuracy': 0.98XX,
        'latency_p95': 35.XX
    },
    version='1.0'
)
```

---

### Step 3.4: Deployability Check

1. Review `DEPLOYABILITY_CHECKLIST.md`
2. Verify all pre-deployment requirements met
3. Run dry-deployment load test (if script available)
4. Verify P99 latency <50ms

**Checklist:**
- [ ] Model artifacts exported
- [ ] Feature schema v1.0 frozen
- [ ] Versioned package created
- [ ] Load test passed
- [ ] P99 latency verified

**If All Pass:** ✅ Ready for deployment  
**If Not:** ⚠️ Complete missing items

---

## 🎯 Phase 4: Optional Refinement

### Step 4.1: Check if Refinement Needed

**Trigger:** Test accuracy in 97.7-98.3% range

**If Yes:**
```bash
python scripts/target_refinement.py
```

**What to Check:**
- ✅ Bayesian ensemble improvement
- ✅ Hybrid model improvement
- ✅ Stabilization of accuracy fluctuations

**Expected Output:**
```
REFINEMENT RESULTS
Baseline:        0.98XX
Bayesian:        0.98XX (Δ+0.00XX)
Hybrid:          0.98XX (Δ+0.00XX)

✅ Best method: bayesian (accuracy: 0.98XX)
🎉 Target 98% achieved with refinement!
```

**If Improvement >0.3%:** ✅ Use refined model  
**If Improvement <0.3%:** ⚠️ May need more data

---

## 📊 Progress Tracking

### Use This Table to Track Progress:

| Phase | Step | Status | Date | Notes |
|-------|------|--------|------|-------|
| Phase 1 | Time-Series CV | ⏳ | - | - |
| Phase 1 | Feature Audit | ⏳ | - | - |
| Phase 1 | Feature Optimization | ⏳ | - | - |
| Phase 2 | Data Expansion | ⏳ | - | - |
| Phase 2 | Retrain | ⏳ | - | - |
| Phase 3 | Update Dashboard | ⏳ | - | - |
| Phase 3 | Verify 3 Green Runs | ⏳ | - | - |
| Phase 3 | Export Artifacts | ⏳ | - | - |
| Phase 3 | Deployability Check | ⏳ | - | - |
| Phase 4 | Refinement (if needed) | ⏳ | - | - |

---

## 🚨 Troubleshooting

### Issue: CV Mean <0.92
**Solution:** 
- Collect more data
- Increase regularization
- Review feature quality

### Issue: CV Std >0.015
**Solution:**
- Remove unstable features
- Increase regularization
- Use time-series CV

### Issue: Permutation p ≥0.05
**Solution:**
- Collect more diverse data
- Reduce model complexity
- Check for label leakage

### Issue: Bootstrap CI Lower <0.96
**Solution:**
- Collect more data
- Improve feature quality
- Reduce model variance

---

## ✅ Completion Criteria

**System is certified when:**
- [x] All 5 metrics green for 3 consecutive runs
- [x] Artifacts exported and versioned
- [x] Deployability checklist complete
- [x] Documentation updated
- [x] Monitoring hooks ready

**You're now ready for production deployment!** 🚀

---

**Last Updated:** 2025-11-13  
**Next Action:** Execute Phase 1, Step 1.1

