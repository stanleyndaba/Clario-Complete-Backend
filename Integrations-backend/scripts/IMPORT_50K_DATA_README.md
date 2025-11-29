# 📦 50K Dataset Import Guide

## Quick Start

### Option 1: Import from ZIP file
```bash
npm run import:csv -- --zip path/to/your-data.zip --userId your-user-id
```

### Option 2: Import from CSV directory
```bash
npm run import:csv -- --dir path/to/csv/files --userId your-user-id
```

## Required Files

The script expects these 6 CSV files:

1. **orders.csv** (20K rows)
2. **shipments.csv** (15K rows)
3. **returns.csv** (10K rows)
4. **settlements.csv** (5K rows)
5. **inventory_adjustments.csv** (5K rows)
6. **fee_events.csv** (15K rows)

## CSV Column Requirements

### orders.csv
```
order_id,order_date,total_amount,total_fees,shipping_cost,marketplace_id,fulfillment_center,currency
```

### shipments.csv
```
shipment_id,order_id,shipped_date,status,missing_quantity,expected_quantity,received_quantity,fulfillment_center,shipping_cost,items_json
```
**Note:** `items_json` should be JSON array: `[{"sku":"SKU001","quantity":2,"price":25.99}]`

### returns.csv
```
return_id,order_id,returned_date,refund_amount,fulfillment_center,currency,items_json
```

### settlements.csv
```
settlement_id,order_id,settlement_date,amount,fees,currency
```

### inventory_adjustments.csv
```
sku,asin,quantity,fulfillment_center,last_updated,adjustment_type,adjustment_amount
```

### fee_events.csv
```
event_id,order_id,event_date,event_type,fee_type,fee_amount,currency,description
```

## Example

```bash
# Import from ZIP
npm run import:csv -- --zip ./data/50k-dataset.zip --userId demo-user

# Import from directory
npm run import:csv -- --dir ./data/csv-files --userId demo-user
```

## What Happens

1. ✅ Extracts ZIP (if provided) to temp directory
2. ✅ Parses all 6 CSV files
3. ✅ Imports data in batches of 1000 records
4. ✅ Shows progress for each file
5. ✅ Displays summary at the end

## Output

You'll see:
```
📦 Importing 20000 orders in 20 batches...
✅ Imported orders batch 1/20 (1000/20000)
✅ Imported orders batch 2/20 (2000/20000)
...
✅ Import Complete!
📊 Summary:
   Orders: 20,000
   Shipments: 15,000
   Returns: 10,000
   Settlements: 5,000
   Inventory: 5,000
   Fee Events: 15,000
   Total: 70,000 records
   Duration: 45.23s
```

## Next Steps

After import:
1. Go to `/sync` page in frontend
2. Click "Start Sync" 
3. Watch real-time sync logs as system processes your 50K dataset
4. Monitor all 11 agents working through the data

## Troubleshooting

**Error: "CSV directory not found"**
- Check the path is correct
- Ensure ZIP file exists (if using --zip)

**Error: "Table does not exist"**
- Run migrations: `npm run db:migrate`

**Error: "Permission denied"**
- Check database connection
- Verify SUPABASE_SERVICE_ROLE_KEY is set

