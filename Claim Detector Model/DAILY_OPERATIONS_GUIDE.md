# Daily Operations Guide

**Purpose:** Quick reference for daily model operations and monitoring

---

## 🚀 Quick Start

### Load Model (Daily Use)
```python
from scripts.daily_operations import load_production_model, predict_claims

# Load model
model, scaler = load_production_model()

# Predict on your data
predictions, probabilities, latency = predict_claims(df, model, scaler)
```

---

## 📋 Daily Checklist

### Morning (9 AM)
- [ ] Check overnight prediction volume
- [ ] Review error logs
- [ ] Check latency metrics (P95 should be <2000ms)
- [ ] Review any alerts from previous night

### Afternoon (2 PM)
- [ ] Review prediction distribution
- [ ] Check for data drift indicators
- [ ] Monitor accuracy (if labels available)

### End of Day (5 PM)
- [ ] Log daily metrics
- [ ] Review any warnings or alerts
- [ ] Document any issues or anomalies

---

## 📊 Key Metrics to Monitor

### Critical Metrics (Check Daily)
1. **Prediction Volume**
   - Expected: Varies by business
   - Alert if: Sudden drop >50% or spike >200%

2. **Inference Latency (P95)**
   - Target: <2000ms
   - Alert if: >2000ms (critical) or >1500ms (warning)

3. **Error Rate**
   - Target: <1%
   - Alert if: >1% (critical) or >0.5% (warning)

### Weekly Metrics (Check Weekly)
1. **Accuracy** (if labels available)
   - Target: ≥98%
   - Alert if: <95% (critical) or <97% (warning)

2. **Prediction Distribution**
   - Monitor: Claimable vs. Non-claimable ratio
   - Alert if: Significant shift >20%

3. **Data Drift**
   - Target: <10%
   - Alert if: >10% (warning)

---

## 🔍 Monitoring Commands

### Check Current Metrics
```python
import json
from pathlib import Path

metrics_path = Path("monitoring/metrics.json")
with open(metrics_path, 'r') as f:
    metrics = json.load(f)

# View latest daily metrics
latest = metrics['daily_metrics'][-1]
print(f"Date: {latest['date']}")
print(f"Volume: {latest['volume']}")
print(f"Latency P95: {latest['latency_p95_ms']}ms")
```

### Check Alerts
```python
from scripts.daily_operations import check_alerts

# Load latest metrics and check alerts
metrics = {...}  # Your latest metrics
alerts = check_alerts(metrics)

for alert in alerts:
    print(f"[{alert['severity']}] {alert['message']}")
```

---

## ⚠️ Alert Response

### Critical Alerts
**Action:** Immediate investigation required

1. **Accuracy Drop <95%**
   - Check data quality
   - Review recent predictions
   - Consider model retraining

2. **Latency Spike >2000ms**
   - Check system resources
   - Review feature engineering
   - Consider optimization

3. **High Error Rate >1%**
   - Check input data format
   - Review feature engineering
   - Check model loading

### Warning Alerts
**Action:** Monitor and investigate if persists

1. **Accuracy Drop <97%**
   - Monitor trend
   - Review predictions
   - Plan retraining if persists

2. **Data Drift >10%**
   - Review feature distributions
   - Check for data source changes
   - Plan retraining if significant

---

## 📝 Daily Operations Script

### Run Daily Operations
```bash
python scripts/daily_operations.py
```

This will:
1. Load production model
2. Run example prediction
3. Log metrics
4. Check alerts

### Integrate with Your System
```python
from scripts.daily_operations import (
    load_production_model,
    predict_claims,
    log_prediction_metrics,
    check_alerts
)

# Load model once (at startup)
model, scaler = load_production_model()

# For each batch of predictions
predictions, probabilities, latency = predict_claims(df, model, scaler)

# Log metrics
metrics = log_prediction_metrics(predictions, probabilities, latency)

# Check alerts
alerts = check_alerts(metrics)
```

---

## 🔄 Weekly Review

### Every Monday
1. Review last week's metrics
2. Check for trends or patterns
3. Review any alerts or warnings
4. Plan actions if needed

### Metrics to Review
- Average accuracy (if available)
- Prediction volume trends
- Latency trends
- Error rate trends
- Data drift score

---

## 📈 Monthly Review

### First of Each Month
1. Full performance review
2. Feature importance analysis
3. Concept drift detection
4. Retraining decision

### Review Documents
- `ML_CERTIFICATION_DASHBOARD.md` - Certification metrics
- `monitoring/metrics.json` - Historical metrics
- Previous month's reports

---

## 🛠️ Troubleshooting

### Model Not Loading
```bash
# Check deployment
ls deployment/

# Verify model exists
python -c "import pickle; pickle.load(open('deployment/claim_detector.pkl', 'rb'))"
```

### Predictions Failing
1. Check input data format
2. Verify required columns present
3. Check feature engineering
4. Review error logs

### High Latency
1. Check batch size
2. Review feature engineering efficiency
3. Check system resources
4. Consider optimization

---

## 📞 Quick Reference

**Model Location:** `deployment/claim_detector.pkl`  
**Scaler Location:** `deployment/scaler.pkl`  
**Metrics Location:** `monitoring/metrics.json`  
**Config Location:** `monitoring/monitoring_config.json`

**Key Commands:**
- Load model: `load_production_model()`
- Predict: `predict_claims(df, model, scaler)`
- Log metrics: `log_prediction_metrics(...)`
- Check alerts: `check_alerts(metrics)`

---

**Last Updated:** 2025-11-13  
**Status:** ✅ **READY FOR DAILY USE**

