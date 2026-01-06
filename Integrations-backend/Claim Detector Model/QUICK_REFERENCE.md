# Quick Reference Card

**Model:** Claim Detector 98% (Certified)  
**Version:** 1.0 | **Date:** 2025-11-13

---

## 📊 Key Metrics

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| **Test Accuracy** | 99.27% | ≥98% | ✅ |
| **CV Mean** | 99.24% | ≥94% | ✅ |
| **CV Std** | 0.40% | ≤1.5% | ✅ |
| **Inference P95** | 675ms | ≤2000ms | ✅ |

---

## 🚀 Quick Load

```python
import pickle

# Load model
with open('models/claim_detector_98percent.pkl', 'rb') as f:
    model = pickle.load(f)

# Load scaler
with open('models/scaler_98percent.pkl', 'rb') as f:
    scaler = pickle.load(f)
```

---

## 📋 Required Features

**Minimum Required:**
- `claim_id`, `seller_id`, `order_id`
- `claim_date`, `order_date`
- `amount`, `order_value`, `quantity`
- `category`, `marketplace`, `fulfillment_center`

**Use `SmartFeatureEngineer` from `train_98_percent_model.py`**

---

## ⚡ Quick Predict

```python
from scripts.train_98_percent_model import SmartFeatureEngineer, Ensemble98Model

# Load
model = Ensemble98Model.load("models/claim_detector_98percent.pkl")

# Engineer features
engineer = SmartFeatureEngineer()
features = engineer.engineer_features(df)

# Predict
predictions = model.predict(features)
probabilities = model.predict_proba(features)
```

---

## 📈 Monitoring

**Daily:** Volume, latency, errors  
**Weekly:** Accuracy, distribution  
**Monthly:** Full review, retrain decision

**Alert if:**
- Accuracy <95% (critical)
- Latency >2000ms (critical)
- Data drift >10% (warning)

---

## 🔄 Retrain When

- Every 3 months (quarterly)
- After major marketplace changes
- If accuracy drops below 95%

---

## 📞 Support

**Documentation:**
- `PRODUCTION_DEPLOYMENT_GUIDE.md` - Full guide
- `ML_CERTIFICATION_DASHBOARD.md` - Metrics
- `PHASE3_CERTIFICATION_COMPLETE.md` - Summary

**Model Files:**
- `models/claim_detector_98percent.pkl`
- `models/scaler_98percent.pkl`

---

**Status:** ✅ **PRODUCTION READY**

