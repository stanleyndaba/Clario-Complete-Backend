# Data Upload Guide

## Quick Setup

You have generated synthetic SP-API data. Here's how to use it:

## Files You Have

1. **`raw_spapi_data.json`** - Raw SP-API format data ✅ **USE THIS**
2. **`processed_claims.csv`** - ML-ready with features/labels ✅ **For ML training**
3. **`train.csv`, `val.csv`, `test.csv`** - ML splits ✅ **For ML training**
4. **`summary.json`** - Metadata ✅ **Reference**

## What the System Needs

The Mock SP-API Service needs **5 CSV files** in SP-API format (not ML format):

1. `financial_events.csv` - Claims/reimbursements
2. `orders.csv` - Orders
3. `inventory.csv` - Inventory
4. `fees.csv` - Fees
5. `shipments_returns.csv` - Shipments & returns

## Conversion Steps

### Option 1: Use Conversion Script (Recommended)

1. **Place your `raw_spapi_data.json` file** somewhere accessible
2. **Run the conversion script:**
   ```bash
   cd Integrations-backend
   node scripts/convert_raw_to_csv.js /path/to/raw_spapi_data.json
   ```
   
   This will automatically:
   - Extract data from `raw_spapi_data.json`
   - Create 5 CSV files in `data/mock-spapi/`
   - Format them correctly for the Mock SP-API Service

### Option 2: Manual Conversion

If your `raw_spapi_data.json` has a different structure, manually extract:

1. **Financial Events** → `financial_events.csv`
   - Extract `FBALiquidationEventList` and `AdjustmentEventList`
   - Columns: `OriginalRemovalOrderId`, `amount`, `currency`, `PostedDate`, `EventType`

2. **Orders** → `orders.csv`
   - Extract `Orders` array
   - Columns: `AmazonOrderId`, `PurchaseDate`, `OrderStatus`, `FulfillmentChannel`, `OrderTotal`, `CurrencyCode`

3. **Inventory** → `inventory.csv`
   - Extract `inventorySummaries` or `InventorySummaries`
   - Columns: `sellerSku`, `asin`, `availableQuantity`, `reservedQuantity`, `condition`, `lastUpdatedTime`

4. **Fees** → `fees.csv`
   - Extract `ServiceFeeEventList` and `OrderEventList`
   - Columns: `AmazonOrderId`, `FeeType`, `FeeAmount`, `CurrencyCode`, `PostedDate`, `EventType`

5. **Shipments/Returns** → `shipments_returns.csv`
   - Extract shipments and returns (if available)
   - Columns: `ShipmentId`, `AmazonOrderId`, `ShipmentDate`, `type`, `status`

## ML Training Data (Separate)

Your **`processed_claims.csv`** and **`train.csv`, `val.csv`, `test.csv`** are for ML training, NOT for the Mock SP-API Service.

**For ML Training:**
- Use `processed_claims.csv` or the train/val/test splits
- These go to your ML training pipeline
- They have engineered features and labels

**For Mock SP-API (System Integration):**
- Use the 5 CSV files extracted from `raw_spapi_data.json`
- These simulate real SP-API responses
- They feed into the sync → detection → ML pipeline

## After Upload

1. **Set environment variable:**
   ```bash
   export USE_MOCK_SPAPI=true
   # Or add to .env file
   ```

2. **Restart backend:**
   ```bash
   npm run dev
   ```

3. **Trigger sync:**
   - The system will read from your CSV files
   - Data will flow: CSV → Normalization → Database → Detection → ML

## File Locations

```
Integrations-backend/
├── data/
│   └── mock-spapi/          ← Place 5 CSV files here
│       ├── financial_events.csv
│       ├── orders.csv
│       ├── inventory.csv
│       ├── fees.csv
│       └── shipments_returns.csv
├── scripts/
│   └── convert_raw_to_csv.js ← Conversion script
└── (ML training data goes elsewhere)
```

## Quick Check

After conversion, verify your CSV files:
- ✅ Have headers
- ✅ Have data rows
- ✅ Date columns are ISO format (2024-01-15T10:00:00Z)
- ✅ Amount columns are numbers
- ✅ Required columns are present (see `data/mock-spapi/README.md`)

## Need Help?

If your `raw_spapi_data.json` structure is different, check:
1. Does it have `FinancialEvents`, `Orders`, `InventorySummaries`?
2. Are the field names camelCase or snake_case?
3. The conversion script handles both, but you may need to adjust

