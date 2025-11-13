# Data Expansion Strategy

**Goal:** Collect 8-10× more samples (2,000-3,000 total) to reliably achieve 98% accuracy with p < 0.05

---

## 📊 Current State

- **Samples:** 240 (203 claimable, 37 not claimable)
- **Target:** 2,000-3,000 samples minimum
- **Gap:** Need 1,760-2,760 more samples

---

## 🎯 Data Collection Approaches

### 1. **Synthetic Augmentation** (Short-term)

#### SMOTE (Already Implemented)
- ✅ **Status:** Currently used in training
- ⚠️ **Limitation:** Only helps with class balance, doesn't add new patterns
- **Next Step:** Apply to expand dataset before training

#### CTGAN (Controlled Synthetic Data)
- **Tool:** `ctgan` library
- **Approach:** Train generative model on existing data, generate realistic samples
- **Pros:** Can create diverse patterns while maintaining statistical properties
- **Cons:** May not capture edge cases, requires careful validation
- **Implementation:**
  ```python
  from ctgan import CTGAN
  ctgan = CTGAN(epochs=300)
  ctgan.fit(df_train)
  synthetic_data = ctgan.sample(1000)
  ```

#### Temporal Bootstrapping
- **Approach:** Perturb key features (price, volume, timing) to simulate near-future data
- **Features to perturb:**
  - `amount`: ±5-10% variation
  - `order_value`: ±5-10% variation
  - `days_since_order`: ±1-7 days
  - `claim_date`: Shift by ±1-30 days
- **Validation:** Ensure synthetic samples maintain realistic relationships

---

### 2. **Real Data Collection** (Primary Strategy)

#### A. Production Logging
**Priority:** HIGHEST

- **Log all claims** (especially non-claimable cases)
- **Track prediction accuracy** vs. ground truth
- **Monitor feature distributions** for drift

**Implementation:**
- Add logging hooks in production API
- Store predictions + ground truth labels
- Weekly review of new data

**Target:** +200-500 samples/month

#### B. Data Partnerships
- **Amazon SP-API Sandbox:** Generate more test data
- **Partner sellers:** Share anonymized claim data
- **Historical data:** Backfill from existing systems

#### C. Simulated API Data
- **If Amazon FBA-type:** Generate realistic SP-API-like records
- **Use domain knowledge** to create valid claim patterns
- **Ensure diversity:** Marketplaces, SKUs, fee types, time periods

---

### 3. **Data Diversity Requirements**

To ensure robust generalization, collect data across:

#### Marketplaces
- ✅ Different regions (NA, EU, JP, etc.)
- ✅ Different fulfillment centers
- ✅ Different seller accounts

#### Product Categories
- ✅ Various SKUs
- ✅ Different product types
- ✅ Different price ranges

#### Fee Types
- ✅ FBA fees
- ✅ Referral fees
- ✅ Shipping fees
- ✅ Storage fees
- ✅ Other adjustments

#### Time Periods
- ✅ Seasonal variation (Q4, Q1, etc.)
- ✅ Different months
- ✅ Different years (if available)

#### Claim Patterns
- ✅ High-value claims (>$100)
- ✅ Low-value claims (<$10)
- ✅ Edge cases (boundary conditions)
- ✅ Rare claim types

---

## 📈 Expected Impact

### With 2,000-3,000 Samples:

| Metric | Current | Expected | Confidence |
|--------|---------|----------|------------|
| **CV Mean** | 88.12% | 94-96% | High |
| **CV Std** | 3.07% | <1.5% | High |
| **Bootstrap Lower** | 93.70% | 95-96% | High |
| **Permutation p** | 1.0000 | <0.05 | High |
| **Test Accuracy** | 97.92% | 97-98% | Medium |

**At that point, 98% test accuracy will have statistical meaning.**

---

## 🛠️ Implementation Plan

### Phase 1: Immediate (Next 1-2 Weeks)
1. ✅ **SMOTE Expansion:** Apply SMOTE to generate 500-800 synthetic samples
2. ✅ **Temporal Bootstrapping:** Create 200-300 perturbed samples
3. ✅ **Production Logging:** Set up hooks to collect real data

### Phase 2: Short-term (Next 1-2 Months)
1. **CTGAN Implementation:** Generate 500-1,000 synthetic samples
2. **Real Data Collection:** Target +500-1,000 samples from production
3. **Data Validation:** Ensure quality and diversity

### Phase 3: Medium-term (Next 2-4 Months)
1. **Continuous Collection:** Maintain +200-500 samples/month
2. **Data Quality Monitoring:** Track feature drift, label quality
3. **Iterative Improvement:** Retrain monthly with new data

---

## 📊 Data Quality Checklist

Before adding new data, verify:

- [ ] **Temporal ordering:** No future leakage
- [ ] **Label quality:** Manually validate random subset
- [ ] **Feature completeness:** No excessive missing values
- [ ] **Distribution balance:** Maintain class balance (60/40 or better)
- [ ] **Diversity:** Covers different marketplaces, SKUs, time periods
- [ ] **Realism:** Synthetic data maintains realistic relationships

---

## 🎯 Success Metrics

### Data Collection Targets

| Metric | Target | Current | Gap |
|--------|--------|---------|-----|
| **Total Samples** | 2,000-3,000 | 240 | 1,760-2,760 |
| **Class 0 Samples** | 800-1,200 | 37 | 763-1,163 |
| **Class 1 Samples** | 1,200-1,800 | 203 | 997-1,597 |
| **Marketplaces** | ≥3 | ? | - |
| **Time Periods** | ≥12 months | ~21 months | - |

### Model Performance Targets (After Expansion)

| Metric | Target | Purpose |
|--------|--------|---------|
| **CV Mean Accuracy** | ≥94% | Consistent learning |
| **CV Std** | ≤0.015 | Low volatility |
| **Permutation p-value** | <0.05 | Real signal, not noise |
| **Bootstrap CI Lower** | ≥96% | Stability |
| **Latency P95** | ≤2000ms | Real-time compliance |

---

## 📝 Notes

- **Synthetic data is a bridge, not a solution:** Real production data is always preferred
- **Quality over quantity:** 1,000 high-quality samples > 3,000 noisy samples
- **Monitor continuously:** Track data quality and model performance as data grows
- **Iterate quickly:** Retrain monthly with new data to maintain performance

---

**Last Updated:** 2025-11-13  
**Next Review:** After Phase 1 completion

