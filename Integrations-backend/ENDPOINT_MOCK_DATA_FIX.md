# Endpoint Mock Data Fix - Frontend Empty Data Issue

## Problem
The frontend sync page was showing empty data because:
1. Backend endpoints were returning empty arrays: `{success: true, claims: Array(0), ...}`
2. The response format was missing `isMock` and `mockScenario` fields that the frontend expects
3. Mock data generator was working, but the response wasn't including the mock indicators

## Root Cause
The service methods (`fetchClaims`, `fetchInventory`) were correctly generating mock data and returning `isMock` and `mockScenario` in the result object, but:
- The route handlers weren't passing these fields to the frontend response
- The response format didn't match what the frontend expected

## Solution

### 1. Fixed Claims Endpoint (`/api/v1/integrations/amazon/claims`)
**File:** `Integrations-backend/src/routes/amazonRoutes.ts`

**Change:** Added `isMock` and `mockScenario` to the response:
```typescript
res.status(200).json({
  success: true,
  claims: claimsResult.data || [],
  message: claimsResult.message || `Fetched ${claimsResult.data?.length || 0} claims`,
  // ... other fields ...
  // Include mock data indicators for frontend
  ...(claimsResult.isMock !== undefined && { isMock: claimsResult.isMock }),
  ...(claimsResult.mockScenario && { mockScenario: claimsResult.mockScenario })
});
```

### 2. Fixed Inventory Endpoint (`/api/v1/integrations/amazon/inventory`)
**File:** `Integrations-backend/src/controllers/amazonController.ts`

**Change:** Added `isMock` and `mockScenario` to the response:
```typescript
res.json({
  success: true,
  inventory: result.data || [],
  message: result.message,
  // Include mock data indicators for frontend
  ...(result.isMock !== undefined && { isMock: result.isMock }),
  ...(result.mockScenario && { mockScenario: result.mockScenario })
});
```

### 3. Enhanced `fetchInventory` Service Method
**File:** `Integrations-backend/src/services/amazonService.ts`

**Change:** Fixed the success path to properly track and return mock data indicators when sandbox returns empty data and mock generator activates:
- Added `isUsingMockData` flag to track when mock generator is used
- Added `mockScenario` tracking
- Included `isMock` and `mockScenario` in both the inventory items and the return object

## Expected Response Format

### Claims Endpoint
```json
{
  "success": true,
  "claims": [...],
  "message": "Generated 75 mock claims using scenario: normal_week",
  "isMock": true,
  "mockScenario": "normal_week",
  "dataType": "MOCK_GENERATED",
  ...
}
```

### Inventory Endpoint
```json
{
  "success": true,
  "inventory": [...],
  "message": "Generated 75 mock inventory items using scenario: normal_week",
  "isMock": true,
  "mockScenario": "normal_week",
  "dataType": "MOCK_GENERATED",
  ...
}
```

## How Mock Data Generator Works

1. **When credentials are missing:**
   - `getAccessToken()` throws: `"Amazon SP-API credentials not configured. Please connect your Amazon account first."`
   - Error is caught in `fetchClaims`/`fetchInventory` catch block
   - Mock generator activates if `USE_MOCK_DATA_GENERATOR !== 'false'`
   - Returns mock data with `isMock: true` and `mockScenario`

2. **When sandbox returns empty data:**
   - API call succeeds but returns empty array
   - If `summaries.length === 0` and `USE_MOCK_DATA_GENERATOR !== 'false'`
   - Mock generator activates and populates data
   - Returns data with `isMock: true` and `mockScenario`

## Testing

Run the test script to verify endpoints return mock data:
```bash
npm run test:endpoints-mock
```

This will:
- Test both claims and inventory endpoints
- Verify they return data (not empty arrays)
- Check that `isMock` and `mockScenario` are present in the response
- Log the results for debugging

## Environment Variables

Ensure these are set (defaults are fine):
```bash
USE_MOCK_DATA_GENERATOR=true  # Default: true
MOCK_SCENARIO=normal_week      # Options: normal_week, high_volume, with_issues
MOCK_RECORD_COUNT=75           # Default: 75 (50-100 range)
```

## Status

✅ **FIXED** - Endpoints now return mock data with correct format including `isMock` and `mockScenario` fields.

The frontend should now display data when:
- Credentials are missing (sandbox mode)
- Sandbox returns empty data
- Mock data generator is enabled

## Next Steps

1. Test the endpoints with the frontend
2. Verify the sync page displays data correctly
3. Check that `isMock` and `mockScenario` are displayed in the UI (if needed)

