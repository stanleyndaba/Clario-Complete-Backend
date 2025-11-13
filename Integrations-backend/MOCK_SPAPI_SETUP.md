# Mock SP-API Setup Guide

## Quick Start

1. **Set Environment Variable:**
   ```bash
   export USE_MOCK_SPAPI=true
   # Or add to your .env file:
   USE_MOCK_SPAPI=true
   ```

2. **Upload CSV Files:**
   Place your 5 CSV files in: `Integrations-backend/data/mock-spapi/`
   - `financial_events.csv`
   - `orders.csv`
   - `inventory.csv`
   - `fees.csv`
   - `shipments_returns.csv`

3. **Restart Backend:**
   ```bash
   npm run dev
   ```

4. **Test:**
   Trigger a sync - the system will read from CSV files instead of real SP-API.

## How It Works

The Mock SP-API Service (`mockSPAPIService.ts`) acts as a drop-in replacement for Amazon SP-API:

1. **Reads CSV files** from `data/mock-spapi/`
2. **Converts to SP-API format** (same structure as real API)
3. **Handles filtering** (date ranges, pagination)
4. **Returns data** in exact SP-API response format

The rest of the system doesn't know the difference - normalization, database storage, and detection all work the same way.

## CSV File Formats

See `data/mock-spapi/README.md` for detailed column requirements.

## Switching Back to Real SP-API

Set `USE_MOCK_SPAPI=false` or remove the environment variable.

## Architecture

```
CSV Files (data/mock-spapi/)
    ↓
Mock SP-API Service (mockSPAPIService.ts)
    ↓
AmazonService (checks USE_MOCK_SPAPI env var)
    ↓
Normalization Layer (same as real SP-API)
    ↓
Database (claims, orders, inventory_items)
    ↓
Detection Service (processes data)
```

## Benefits

- ✅ Test with your own data
- ✅ No need for real Amazon credentials
- ✅ Fast iteration (no API rate limits)
- ✅ Train models on your data
- ✅ Same code path as production

