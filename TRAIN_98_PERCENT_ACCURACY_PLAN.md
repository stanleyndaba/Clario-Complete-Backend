# Training Plan: 98% Accuracy in ≤2 Seconds

## Current Status ✅

**Data Available:**
- ✅ 98 claims synced to database
- ✅ 240 inventory items
- ✅ 30 fees
- ✅ 100 orders
- ✅ ML training data ready: `data/ml-training/`
  - `train.csv`: 168 samples
  - `val.csv`: 36 samples  
  - `test.csv`: 36 samples
  - `processed_claims.csv`: 240 full samples

**Current Performance:**
- Accuracy: **87%+** (from EXECUTIVE_SUMMARY.md)
- Target: **98% accuracy in ≤2 seconds**

## Training Strategy

### Phase 1: Train on Real Data (Immediate)

1. **Load synced data from database** OR use `processed_claims.csv`
2. **Train unified model** using `Claim Detector Model/claim_detector/scripts/train_unified_model.py`
3. **Evaluate accuracy** on test set
4. **Measure inference time** per claim

### Phase 2: Optimize for Speed (≤2s)

**Speed Optimization Techniques:**

1. **Model Selection:**
   - Use **LightGBM** or **XGBoost** (faster than deep learning)
   - Consider **ONNX** conversion for faster inference
   - Use **model quantization** to reduce size/speed

2. **Feature Engineering:**
   - Pre-compute features where possible
   - Cache feature transformations
   - Reduce feature dimensionality

3. **Inference Optimization:**
   - Batch processing (already implemented)
   - Model caching in memory
   - Parallel prediction for multiple claims
   - Use faster libraries (e.g., `lightgbm` vs `sklearn`)

4. **Infrastructure:**
   - Ensure Python API has sufficient resources
   - Use GPU if available (for deep learning models)
   - Optimize database queries

### Phase 3: Improve Accuracy to 98%

**Accuracy Improvement Techniques:**

1. **More Data:**
   - Use all 240 samples from `processed_claims.csv`
   - Augment with synthetic data if needed
   - Use cross-validation for better generalization

2. **Better Features:**
   - Feature engineering from synced data
   - Use all available data: orders, inventory, fees, financial events
   - Create interaction features

3. **Ensemble Methods:**
   - Combine multiple models (voting/stacking)
   - Use different algorithms and average predictions

4. **Hyperparameter Tuning:**
   - Grid search or Bayesian optimization
   - Focus on precision/recall balance
   - Optimize for 98% accuracy threshold

5. **Model Selection:**
   - Try XGBoost, LightGBM, CatBoost
   - Consider neural networks if data allows
   - Use early stopping to prevent overfitting

## Implementation Steps

### Step 1: Train on Synced Data

```python
# Use processed_claims.csv from data/ml-training/
import pandas as pd
from claim_detector.scripts.train_unified_model import train_model

# Load training data
df = pd.read_csv('data/ml-training/processed_claims.csv')

# Train model
model = train_model(df, 'models/claim_detector_v2.pkl', 'models/preprocessor_v2.pkl')

# Evaluate
accuracy = evaluate_model(model, X_test, y_test)
print(f"Accuracy: {accuracy:.4f}")
```

### Step 2: Optimize Inference Speed

```python
# Measure current speed
import time

start = time.time()
predictions = model.predict_batch(claims)
elapsed = time.time() - start

print(f"Inference time: {elapsed:.3f}s for {len(claims)} claims")
print(f"Per claim: {elapsed/len(claims)*1000:.2f}ms")
```

### Step 3: Iterate Until 98% + ≤2s

- If accuracy < 98%: Improve features, add data, tune hyperparameters
- If speed > 2s: Optimize model, use faster algorithms, batch processing

## Success Criteria

✅ **Accuracy ≥ 98%** on test set  
✅ **Inference time ≤ 2 seconds** per claim (or batch)  
✅ **Model deployed** and integrated with detection service  
✅ **Performance verified** in production

## Next Actions

1. **Train model** on `data/ml-training/processed_claims.csv`
2. **Measure baseline** accuracy and speed
3. **Optimize** iteratively until both targets met
4. **Deploy** optimized model to Python API
5. **Monitor** performance in production

