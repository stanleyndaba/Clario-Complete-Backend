# Data Structure & Organization

## 📁 Complete File Structure

```
Clario-Complete-Backend/
├── data/
│   ├── mock-spapi/                    ← ACTING SP-API (System Integration)
│   │   ├── financial_events.csv       ✅ 254 records (Claims/Reimbursements)
│   │   ├── orders.csv                 ✅ 240 records (Orders)
│   │   ├── inventory.csv              ✅ 240 records (Inventory)
│   │   ├── fees.csv                   ✅ 40 records (Fees)
│   │   ├── shipments_returns.csv     ✅ Empty (can add later)
│   │   └── README.md                  (Format documentation)
│   │
│   └── ml-training/                    ← ML Training Data
│       ├── processed_claims.csv      ✅ 240 records (Features + Labels)
│       ├── train.csv                  ✅ 70% oldest (168 records)
│       ├── val.csv                    ✅ 15% middle (36 records)
│       ├── test.csv                   ✅ 15% newest (36 records)
│       └── summary.json               ✅ Metadata
│
└── raw_spapi_data.json                ← Original source (keep for reference)
```

---

## 🎯 Purpose of Each Directory

### **`data/mock-spapi/` - ACTING SP-API**
**Purpose:** Simulates Amazon SP-API responses for system integration

**Files:**
- **`financial_events.csv`** → Powers claims/reimbursements sync
- **`orders.csv`** → Powers orders sync
- **`inventory.csv`** → Powers inventory sync
- **`fees.csv`** → Powers fees sync
- **`shipments_returns.csv`** → Powers shipments/returns sync (empty for now)

**Flow:**
```
CSV Files → Mock SP-API Service → AmazonService → Normalization → Database → Detection
```

**Usage:**
- Set `USE_MOCK_SPAPI=true`
- System reads CSV files as if they're real SP-API responses
- No real Amazon API calls needed

---

### **`data/ml-training/` - ML Training Data**
**Purpose:** Preprocessed data for machine learning model training

**Files:**
- **`processed_claims.csv`** → Full dataset with engineered features + labels
- **`train.csv`** → Training set (70% oldest, chronological)
- **`val.csv`** → Validation set (15% middle)
- **`test.csv`** → Test set (15% newest)
- **`summary.json`** → Dataset metadata

**Flow:**
```
Processed CSV → Feature Engineering → Model Training → Model Evaluation → Model Deployment
```

**Usage:**
- Feed directly into ML training pipeline
- Already has features engineered and labels assigned
- Chronologically split for time-series validation

---

## 📊 Data Statistics

### Mock SP-API Data (System Integration)
- **Financial Events:** 254 records
- **Orders:** 240 records
- **Inventory:** 240 records
- **Fees:** 40 records
- **Shipments/Returns:** 0 records (empty)

### ML Training Data
- **Total Claims:** 240 records
- **Claimable (1):** 203 records (84.6%)
- **Not Claimable (0):** 37 records (15.4%)
- **Date Range:** 2024-01-07 to 2025-10-20
- **Train/Val/Test Split:** 70% / 15% / 15% (chronological)

---

## 🔄 Data Flow Architecture

### **Phase 1: Data Ingestion (Mock SP-API)**
```
raw_spapi_data.json
    ↓ [Conversion Script]
data/mock-spapi/*.csv
    ↓ [Mock SP-API Service]
AmazonService (normalization)
    ↓
Database (claims, orders, inventory_items, financial_events)
```

### **Phase 2: ML Training**
```
data/ml-training/processed_claims.csv
    ↓ [Feature Engineering - Already Done]
train.csv, val.csv, test.csv
    ↓ [ML Training Pipeline]
Trained Models
    ↓
Model Deployment
```

---

## ✅ Ready to Go Checklist

- [x] **Mock SP-API CSV files created** (5 files in `data/mock-spapi/`)
- [x] **ML training data organized** (4 files in `data/ml-training/`)
- [x] **Conversion script working** (converts JSON → CSV)
- [x] **File structure documented**
- [ ] **Environment variable set** (`USE_MOCK_SPAPI=true`)
- [ ] **Backend restarted**
- [ ] **Sync triggered** (to test data ingestion)

---

## 🚀 Next Steps

1. **Set Environment Variable:**
   ```bash
   # In Integrations-backend/.env or environment
   USE_MOCK_SPAPI=true
   ```

2. **Restart Backend:**
   ```bash
   cd Integrations-backend
   npm run dev
   ```

3. **Trigger Sync:**
   - System will read from `data/mock-spapi/*.csv`
   - Data flows: CSV → Normalization → Database → Detection

4. **Train ML Models:**
   - Use `data/ml-training/train.csv`, `val.csv`, `test.csv`
   - Models train on your synthetic data
   - Deploy trained models

---

## 📝 Notes

- **Mock SP-API files** are for system integration (sync, detection, database)
- **ML training files** are for model training (separate pipeline)
- Both use the same source data (`raw_spapi_data.json`) but serve different purposes
- Mock SP-API files are in SP-API format (for system compatibility)
- ML training files have engineered features (for model training)

