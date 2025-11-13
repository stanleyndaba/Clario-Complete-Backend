# Mock Data Generator Test Script

Quick test script to verify the mock data generator is working correctly for all 3 endpoints and scenarios.

## Usage

### Test Default Scenario (normal_week)
```bash
npm run test:mock-generator
```

### Test Specific Scenario
```bash
npm run test:mock-generator normal_week
npm run test:mock-generator high_volume
npm run test:mock-generator with_issues
```

### Test All Scenarios
```bash
npm run test:mock-generator --all
```

## What It Tests

### 1. Financial Events (GET_LEDGER_DETAIL_VIEW_DATA)
- Generates Adjustment Events (reimbursements, reversals)
- Generates FBA Liquidation Events
- Generates Service Fee Events
- Generates Order Events
- Validates SP-API structure and format

### 2. Inventory (GET_FBA_MYI_UNSUPPRESSED_INVENTORY)
- Generates inventory summaries with SKUs, ASINs, FNSKUs
- Calculates available, reserved, damaged, unfulfillable quantities
- Validates inventory structure

### 3. Orders (GET_ORDERS_DATA)
- Generates orders with order items
- Validates order status, fulfillment channel, total amounts
- Checks Prime orders, FBA vs MFN distribution

## Scenarios

### `normal_week` (Default)
- Typical business activity
- Balanced distribution of events
- Standard inventory levels
- Normal order patterns

### `high_volume`
- Stress test scenario
- More records (100+ per endpoint)
- Higher inventory quantities
- More orders and events

### `with_issues`
- Edge case scenario
- More adjustments (potential claims)
- Higher damaged inventory
- More canceled orders
- Negative adjustments (reversals)

## Expected Output

The script will show:
- ✅ Success/failure for each endpoint
- 📊 Record counts generated
- 📋 Sample data structures
- 📊 Scenario-specific statistics
- ✅ Overall test summary

## Integration with Service Layer

The mock generator automatically activates when:
- `USE_MOCK_DATA_GENERATOR=true` (default)
- Sandbox mode is enabled
- Sandbox returns empty data
- Scenario set via `MOCK_SCENARIO` environment variable

## Example Output

```
================================================================================
🧪 Testing Mock Data Generator - Scenario: NORMAL_WEEK
================================================================================

📊 Testing Financial Events...
   ✅ Generated 75 financial events
      - Adjustments: 22
      - Liquidations: 15
      - Fees: 23
      - Order Events: 15
   ✅ Sample Adjustment Event:
      - ID: ADJ-1234567890-0
      - Type: REVERSAL_REIMBURSEMENT
      - Amount: $45.50 USD
      - Date: 2024-11-06T10:00:00.000Z
      - Order ID: 112-12345678-1234567

📦 Testing Inventory...
   ✅ Generated 60 inventory summaries
   ✅ Inventory Totals:
      - Available: 1,234 units
      - Reserved: 123 units
      - Damaged: 45 units
      - Unfulfillable: 23 units

🛒 Testing Orders...
   ✅ Generated 75 orders
   ✅ Order Statistics:
      - Total Order Value: $12,345.67
      - Status: 60 Shipped, 8 Pending, 5 Unshipped, 2 Canceled
      - FBA Orders: 60 (80.0%)
      - Prime Orders: 45 (60.0%)

================================================================================
📋 Test Summary
================================================================================

Scenario: NORMAL_WEEK
✅ Passed: 3/3 tests
❌ Failed: 0/3 tests
📊 Total Records Generated: 210
```

## Troubleshooting

### If tests fail:
1. Check that TypeScript is compiling correctly
2. Verify all dependencies are installed (`npm install`)
3. Check that `ts-node` is available (`npm install -D ts-node`)
4. Ensure the mock generator file exists at `src/services/mockDataGenerator.ts`

### If no data is generated:
1. Check the scenario parameter (should be one of: normal_week, high_volume, with_issues)
2. Verify the generator is creating data (check console logs)
3. Check the date range (defaults to last 7 days)

## Next Steps

Once tests pass:
1. ✅ Mock generator is working correctly
2. ✅ Ready for Phase 1 testing
3. ✅ Set `MOCK_SCENARIO` environment variable to test different scenarios
4. ✅ Test integration with `amazonService.ts` in sandbox mode

