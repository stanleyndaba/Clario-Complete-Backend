# Train 98% Accuracy Model

## Quick Start

```bash
cd "Claim Detector Model/claim_detector"
python scripts/train_98_percent_model.py
```

## What This Script Does

1. **Smart Feature Engineering**: Creates 30+ features from your 240 samples
   - Temporal features (time patterns)
   - Financial ratios and interactions
   - Categorical interactions
   - Text features
   - Statistical features
   - Polynomial interactions

2. **Ensemble Model**: Combines 3 models for maximum accuracy
   - LightGBM (fast, accurate)
   - XGBoost (complementary)
   - Random Forest (diversity)
   - Weighted voting ensemble

3. **Optimized for Speed**: 
   - Uses fast tree-based models
   - Batch processing
   - Efficient feature engineering

4. **Targets**:
   - ✅ **98% accuracy** on test set
   - ✅ **≤2 seconds** inference time

## Requirements

```bash
pip install lightgbm xgboost scikit-learn pandas numpy
```

## Output

- Model: `models/claim_detector_98percent.pkl`
- Scaler: `models/scaler_98percent.pkl`
- Performance metrics logged to console

## Expected Results

```
Test Set Performance:
  Accuracy:  0.9800+ ✅
  Precision: 0.95+
  Recall:    0.95+
  F1 Score:  0.95+
  
Inference Speed:
  Average time: <2000ms ✅
  Per claim:    <10ms
```

## Integration

After training, update the Python API to use this model:

```python
from scripts.train_98_percent_model import Ensemble98Model

model = Ensemble98Model()
model.load('models/claim_detector_98percent.pkl', 'models/scaler_98percent.pkl')

# Predict
predictions, probabilities = model.predict(X_test)
```

