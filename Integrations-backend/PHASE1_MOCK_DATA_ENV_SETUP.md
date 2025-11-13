# Phase 1 Mock Data Generator - Environment Variables Setup

## Where to Add Environment Variables

**Add these to the Node.js API (Integrations-backend)**, NOT the Python API.

The mock data generator runs in the TypeScript/Node.js service layer (`amazonService.ts`), so these environment variables need to be set in the **Integrations-backend** environment.

---

## Environment Variables

### Required (or use defaults)

```bash
# Enable/disable mock data generator (default: true)
USE_MOCK_DATA_GENERATOR=true

# Scenario for mock data generation (default: normal_week)
# Options: normal_week | high_volume | with_issues
MOCK_SCENARIO=normal_week

# Number of records to generate per endpoint (default: 75, range: 50-100)
MOCK_RECORD_COUNT=75
```

---

## How to Add Environment Variables

### Option 1: Local Development (.env file)

1. Create or edit `.env` file in `Integrations-backend/` directory:

```bash
cd Integrations-backend
```

2. Add these lines to your `.env` file:

```env
# Mock Data Generator Configuration (Phase 1)
USE_MOCK_DATA_GENERATOR=true
MOCK_SCENARIO=normal_week
MOCK_RECORD_COUNT=75
```

3. Ensure `.env` is loaded (if using `dotenv`):

The code already reads from `process.env`, so if you're using `dotenv.config()` at the start of your app, the `.env` file will be loaded automatically.

### Option 2: System Environment Variables

Set them in your shell/environment:

**Windows (PowerShell):**
```powershell
$env:USE_MOCK_DATA_GENERATOR="true"
$env:MOCK_SCENARIO="normal_week"
$env:MOCK_RECORD_COUNT="75"
```

**Windows (CMD):**
```cmd
set USE_MOCK_DATA_GENERATOR=true
set MOCK_SCENARIO=normal_week
set MOCK_RECORD_COUNT=75
```

**Linux/Mac (Bash):**
```bash
export USE_MOCK_DATA_GENERATOR=true
export MOCK_SCENARIO=normal_week
export MOCK_RECORD_COUNT=75
```

### Option 3: Deployment Platform (Render, Railway, etc.)

Add them in your deployment platform's environment variables section:

**Render:**
1. Go to your service dashboard
2. Navigate to "Environment" tab
3. Add the variables:
   - `USE_MOCK_DATA_GENERATOR` = `true`
   - `MOCK_SCENARIO` = `normal_week`
   - `MOCK_RECORD_COUNT` = `75`

**Railway:**
1. Go to your project
2. Click on "Variables" tab
3. Add the variables with the same names and values

**Other Platforms:**
- Add via platform's environment variable configuration UI
- Or add to `render.yaml` / platform config files

---

## Scenario Options

### `normal_week` (Default)
- Typical business activity
- Balanced distribution of events
- Standard inventory levels (50-100 per SKU)
- Normal order patterns
- **Use for:** Standard testing, day-to-day development

### `high_volume`
- Stress test scenario
- More records (100 per endpoint)
- Higher inventory quantities (up to 500 per SKU)
- More orders and events
- **Use for:** Performance testing, load testing

### `with_issues`
- Edge case scenario
- More adjustments (potential claims - 40% of events)
- Higher damaged inventory (up to 20 units per SKU)
- More canceled orders (13-20% of orders)
- Negative adjustments (reversals)
- **Use for:** Edge case testing, claim detection testing

---

## Default Values

If you don't set these variables, the defaults are:
- `USE_MOCK_DATA_GENERATOR` = `true` (enabled by default)
- `MOCK_SCENARIO` = `normal_week`
- `MOCK_RECORD_COUNT` = `75`

So you don't need to set anything if you want the defaults!

---

## Verification

To verify the environment variables are working:

1. **Check logs on startup:**
   - Look for: `"Amazon SP-API initialized in SANDBOX mode"`
   - When sync runs and sandbox returns empty data, you should see: `"Sandbox returned empty data - using mock data generator"`

2. **Test with the test script:**
   ```bash
   cd Integrations-backend
   npm run test:mock-generator
   ```

3. **Check the response:**
   - When you sync data, check the response - it should include `"isMock": true` and `"mockScenario": "normal_week"` (or whatever scenario you set)

---

## Example: Testing Different Scenarios

### Test Normal Week
```bash
export MOCK_SCENARIO=normal_week
npm run dev
```

### Test High Volume
```bash
export MOCK_SCENARIO=high_volume
export MOCK_RECORD_COUNT=100
npm run dev
```

### Test With Issues
```bash
export MOCK_SCENARIO=with_issues
npm run dev
```

---

## Disabling Mock Data Generator

To disable the mock generator (use real sandbox data only):

```bash
USE_MOCK_DATA_GENERATOR=false
```

Or in `.env`:
```env
USE_MOCK_DATA_GENERATOR=false
```

---

## Important Notes

1. **These variables only affect sandbox mode** - In production mode, the mock generator will NOT activate even if these are set.

2. **The mock generator only activates when sandbox returns empty data** - If sandbox returns actual test data, the mock generator won't run.

3. **The Python API doesn't need these variables** - The mock data generator is purely in the Node.js/TypeScript backend.

4. **The mock data is generated on-the-fly** - No CSV files needed, data is generated programmatically when needed.

---

## Troubleshooting

### Mock generator not activating?
1. Check `USE_MOCK_DATA_GENERATOR` is not set to `false`
2. Verify you're in sandbox mode (check logs for "SANDBOX mode")
3. Ensure sandbox is returning empty data (mock generator only activates on empty responses)

### Wrong scenario being used?
1. Check `MOCK_SCENARIO` is set correctly (case-sensitive: `normal_week`, `high_volume`, `with_issues`)
2. Restart your Node.js server after changing env vars
3. Check logs for "using mock data generator" with scenario info

### No data being generated?
1. Verify `MOCK_RECORD_COUNT` is between 50-100 (default is 75)
2. Check that the mock generator file exists: `src/services/mockDataGenerator.ts`
3. Check for TypeScript compilation errors: `npm run build`

---

**Last Updated:** 2025-11-13  
**Status:** ✅ Ready for Phase 1 Testing

