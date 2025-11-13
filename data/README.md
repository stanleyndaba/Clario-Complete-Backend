# Data Directory

This directory contains all data files for the Clario system.

## 📁 Structure

```
data/
├── mock-spapi/          ← ACTING SP-API (System Integration)
│   └── *.csv            (5 CSV files that simulate Amazon SP-API)
│
└── ml-training/         ← ML Training Data
    └── *.csv            (Processed data for model training)
```

## 🎯 Quick Start

### For System Integration (Mock SP-API):

1. **Files are ready** in `mock-spapi/` directory
2. **Set environment variable:**
   ```bash
   USE_MOCK_SPAPI=true
   ```
3. **Restart backend** - it will use CSV files instead of real SP-API

### For ML Training:

1. **Files are ready** in `ml-training/` directory
2. **Use train.csv, val.csv, test.csv** for model training
3. **See summary.json** for dataset statistics

## 📊 Current Data

- **Mock SP-API:** 254 financial events, 240 orders, 240 inventory items, 40 fees
- **ML Training:** 240 claims (203 claimable, 37 not claimable)
- **Date Range:** 2024-01-07 to 2025-10-20

See `DATA_STRUCTURE.md` for complete details.

