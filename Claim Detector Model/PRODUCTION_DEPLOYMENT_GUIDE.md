# Production Deployment Guide

**Model:** Claim Detector 98% (Certified)  
**Version:** 1.0  
**Certification Date:** 2025-11-13  
**Status:** ✅ **PRODUCTION READY**

---

## 🚀 Quick Start

### Model Artifacts
```
models/
├── claim_detector_98percent.pkl    # Trained model
├── scaler_98percent.pkl             # Feature scaler
└── feature_schema_v1.0.json         # Feature schema (if exists)
```

### Load Model
```python
import pickle
import pandas as pd
from pathlib import Path

# Load model and scaler
model_path = Path("models/claim_detector_98percent.pkl")
scaler_path = Path("models/scaler_98percent.pkl")

with open(model_path, 'rb') as f:
    model = pickle.load(f)

with open(scaler_path, 'rb') as f:
    scaler = pickle.load(f)

# Prepare features (use SmartFeatureEngineer from train_98_percent_model.py)
# Then predict
predictions = model.predict(features)
probabilities = model.predict_proba(features)
```

---

## 📊 Model Performance

### Certification Metrics
- **CV Accuracy:** 99.24% ± 0.40%
- **Test Accuracy:** 99.27%
- **Precision:** 98.20%
- **Recall:** 100.00%
- **F1 Score:** 99.09%
- **AUC:** 99.88%
- **Inference P95:** 675ms

### Dataset
- **Total Samples:** 2,740
- **Class Balance:** 1.52:1 (1,652 non-claimable : 1,088 claimable)
- **Train/Val/Test:** 1,917 / 412 / 411

---

## 🔧 Integration Steps

### 1. Environment Setup
```bash
# Required packages
pip install lightgbm pandas numpy scikit-learn
```

### 2. Feature Engineering
Use the `SmartFeatureEngineer` class from `train_98_percent_model.py`:
- Ensures consistent feature engineering
- Handles datetime conversion
- Creates all required features

### 3. Inference Pipeline
```python
from scripts.train_98_percent_model import SmartFeatureEngineer, Ensemble98Model

# Load model
model = Ensemble98Model.load("models/claim_detector_98percent.pkl")

# Prepare input data (DataFrame with required columns)
df = pd.DataFrame([...])  # Your claim data

# Engineer features
engineer = SmartFeatureEngineer()
features = engineer.engineer_features(df)

# Predict
predictions = model.predict(features)
probabilities = model.predict_proba(features)
```

---

## 📈 Monitoring Checklist

### Daily Monitoring
- [ ] Track prediction volume
- [ ] Monitor accuracy (if labels available)
- [ ] Check inference latency (P95 should stay <2000ms)
- [ ] Review error logs

### Weekly Monitoring
- [ ] Calculate accuracy metrics (if labels available)
- [ ] Review prediction distribution
- [ ] Check for data drift (feature distributions)
- [ ] Review edge cases

### Monthly Monitoring
- [ ] Full model performance review
- [ ] Feature importance analysis
- [ ] Concept drift detection
- [ ] Retraining decision (if needed)

---

## ⚠️ Alerts & Thresholds

### Critical Alerts
- **Accuracy Drop:** If test accuracy drops below 95%
- **Latency Spike:** If P95 latency exceeds 2000ms
- **Error Rate:** If prediction errors exceed 1%
- **Data Drift:** If feature distributions shift >10%

### Warning Alerts
- **Accuracy Drop:** If test accuracy drops below 97%
- **Latency Increase:** If P95 latency increases >50%
- **Prediction Shift:** If prediction distribution changes >20%

---

## 🔄 Retraining Schedule

### Recommended Schedule
- **Quarterly:** Every 3 months (if data available)
- **After Major Changes:** Marketplace policy changes, new claim types
- **Performance Degradation:** If accuracy drops below 95%

### Retraining Process
1. Collect new data (maintain chronological order)
2. Validate data quality (`validate_new_data.py`)
3. Integrate data (`integrate_new_data.py`)
4. Run feature audit (`feature_audit.py`)
5. Run time-series CV (`time_series_cv.py`)
6. Retrain model (`train_98_percent_model.py`)
7. Verify certification metrics
8. Update documentation

---

## 📝 Feature Requirements

### Required Input Columns
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
- `claimable` - Label (0 or 1) - **Only for training, not inference**

### Optional Columns
- `claim_type`, `description`, `reason_code`, `asin`, `sku`, `shipping_cost`, `subcategory`

---

## 🐛 Troubleshooting

### Common Issues

**Issue:** Model predictions inconsistent
- **Solution:** Ensure feature engineering matches training pipeline
- **Check:** Feature schema and column order

**Issue:** High latency
- **Solution:** Batch predictions instead of single predictions
- **Check:** Feature engineering efficiency

**Issue:** Accuracy degradation
- **Solution:** Check for data drift, retrain if needed
- **Check:** Feature distributions and label quality

---

## 📚 Documentation

### Key Documents
- `PHASE3_CERTIFICATION_COMPLETE.md` - Certification summary
- `ML_CERTIFICATION_DASHBOARD.md` - Metrics tracking
- `PHASE3_RESULTS.md` - Detailed results
- `train_98_percent_model.py` - Training script (reference)

### Model Details
- **Algorithm:** LightGBM (Gradient Boosting)
- **Regularization:** Enhanced (num_leaves=12, lambda_l2=0.3, etc.)
- **Class Balancing:** SMOTE + scale_pos_weight
- **Validation:** 5x5 Repeated Stratified K-Fold CV

---

## ✅ Pre-Deployment Checklist

- [x] Model certified (all 5 metrics passed)
- [x] Model artifacts saved
- [x] Feature schema documented
- [x] Inference pipeline tested
- [x] Monitoring setup ready
- [x] Documentation complete
- [ ] Production environment configured
- [ ] Monitoring dashboards set up
- [ ] Alert thresholds configured
- [ ] Team trained on model usage

---

## 🎯 Success Criteria

### Production Success Metrics
- **Accuracy:** Maintain ≥98% accuracy
- **Latency:** P95 <2000ms
- **Uptime:** >99.9% availability
- **Error Rate:** <1% prediction errors

---

**Last Updated:** 2025-11-13  
**Model Version:** 1.0  
**Status:** ✅ **READY FOR PRODUCTION**

