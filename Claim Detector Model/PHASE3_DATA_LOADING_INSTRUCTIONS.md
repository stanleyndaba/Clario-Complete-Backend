# Phase 3 Data Loading Instructions

**Status:** ⏳ **READY FOR DATA LOADING**

---

## 📍 Where to Place Your File

Place `expanded_claims.csv` in one of these locations:

### Option 1: Recommended Location
```
data/ml-training/expanded_claims.csv
```

### Option 2: Anywhere (specify path)
You can place it anywhere and specify the path when running the script.

---

## 🚀 Quick Start

### Step 1: Place the File
```bash
# Copy your expanded_claims.csv to:
data/ml-training/expanded_claims.csv
```

### Step 2: Run Complete Workflow
```bash
cd "Claim Detector Model/claim_detector"
python scripts/phase3_complete_workflow.py --backup
```

This will:
1. ✅ Validate data quality
2. ✅ Integrate with existing data
3. ✅ Create backup
4. ✅ Generate train/val/test splits
5. ✅ Save summary

---

## 📋 Manual Steps (Alternative)

If you prefer to run steps individually:

### Step 1: Validate
```bash
python scripts/validate_new_data.py --data-path ../../data/ml-training/expanded_claims.csv --output validation_report.json
```

### Step 2: Integrate
```bash
python scripts/integrate_new_data.py --new-data ../../data/ml-training/expanded_claims.csv --backup --create-splits
```

### Step 3: Validate Integration
```bash
python scripts/feature_audit.py
python scripts/time_series_cv.py
```

### Step 4: Retrain
```bash
python scripts/train_98_percent_model.py
```

---

## ✅ Expected Results

After integration:
- **Total samples:** ~2,500 (240 existing + 2,500 new, minus duplicates)
- **Class balance:** ~1.8:1 (1,615 non-claimable : 885 claimable)
- **Train/Val/Test:** 70% / 15% / 15% (chronological)

After retraining:
- **CV Mean:** ≥0.94 (target)
- **CV Std:** ≤0.015 (target)
- **Bootstrap Lower:** ≥0.96 (target)
- **Permutation p:** <0.05 (target)
- **Test Accuracy:** ~98% (target)

---

## 🔍 Data Requirements

Your `expanded_claims.csv` should have these columns:
- `claim_id` - Unique identifier
- `seller_id` - Seller identifier
- `order_id` - Order identifier
- `claim_date` - Date of claim
- `order_date` - Date of order
- `amount` - Claim amount
- `order_value` - Order value
- `quantity` - Quantity
- `category` - Product category
- `marketplace` - Marketplace
- `fulfillment_center` - Fulfillment center
- `claimable` - Label (0 or 1)

**Optional but recommended:**
- `claim_type`, `description`, `reason_code`, `asin`, `sku`, etc.

---

## 📊 Current vs. Expected

| Metric | Current | Expected After Integration |
|--------|---------|----------------------------|
| **Total Samples** | 240 | ~2,500 |
| **Non-Claimable** | 37 | ~1,615 |
| **Claimable** | 203 | ~885 |
| **Class Balance** | 5.5:1 | 1.8:1 |

---

## ⚠️ Important Notes

1. **Backup Created:** The script will create a backup of existing `processed_claims.csv` if you use `--backup` flag
2. **Duplicates Removed:** Duplicate `claim_id`s will be automatically removed
3. **Chronological Order:** Data will be sorted by `claim_date` before splitting
4. **Validation Gates:** The script will check data quality before integration

---

## 🎯 Next Steps After Integration

1. ✅ Data integrated
2. ⏳ Run feature audit
3. ⏳ Run time-series CV
4. ⏳ Retrain model
5. ⏳ Check certification metrics

---

**Ready to load your data!** 🚀

Place `expanded_claims.csv` in `data/ml-training/` and run the workflow.

