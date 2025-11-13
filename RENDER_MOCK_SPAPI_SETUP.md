# Render Mock SP-API Setup Guide

## Current Status from Logs

Based on your Render logs, the service is running but **Mock SP-API is not enabled**. The logs show:
- Service is running on port 8000
- Environment: production
- **No Mock SP-API initialization logs** (which means `USE_MOCK_SPAPI` is not set or not `'true'`)

## Steps to Enable Mock SP-API on Render

### 1. Set Environment Variable in Render Dashboard

1. Go to your Render dashboard: https://dashboard.render.com
2. Navigate to your service: `opside-node-api-woco`
3. Go to **Environment** tab
4. Add or update the environment variable:
   - **Key**: `USE_MOCK_SPAPI`
   - **Value**: `true`
5. Click **Save Changes**
6. **Redeploy** the service (Render will automatically redeploy when you save environment variables)

### 2. Upload CSV Files to Render

The CSV files need to be accessible to the service. You have two options:

#### Option A: Include in Git Repository (Recommended for Testing)

1. Ensure your CSV files are in `data/mock-spapi/` directory:
   - `financial_events.csv`
   - `orders.csv`
   - `inventory.csv`
   - `fees.csv`
   - `shipments_returns.csv`

2. Commit and push to your repository:
   ```bash
   git add data/mock-spapi/*.csv
   git commit -m "Add mock SP-API CSV data files"
   git push
   ```

3. Render will automatically deploy the files with your code

#### Option B: Use Render Disk Storage (For Production)

1. In Render dashboard, go to your service
2. Navigate to **Disk** tab
3. Create a persistent disk if you don't have one
4. Mount it to `/opt/render/project/src/data`
5. Upload CSV files via SSH or Render Shell

### 3. Verify Setup

After redeploying, check the logs for these messages:

**Expected Log Messages:**
```
info: Mock SP-API Service initialized {
  dataDir: "/opt/render/project/src/data/mock-spapi",
  useMock: true,
  envVar: "true",
  filesExist: true,
  csvFileCount: 5,
  csvFiles: ["financial_events.csv", "orders.csv", "inventory.csv", "fees.csv", "shipments_returns.csv"],
  cwd: "/opt/render/project/src/Integrations-backend"
}

info: Amazon SP-API initialized in MOCK mode - using CSV files {
  baseUrl: "https://sandbox.sellingpartnerapi-na.amazon.com",
  environment: "MOCK",
  useMockSPAPI: true,
  note: "Reading data from CSV files in data/mock-spapi/ directory"
}
```

**If CSV files are missing, you'll see:**
```
warn: USE_MOCK_SPAPI is enabled but no CSV files found in data directory {
  dataDir: "/opt/render/project/src/data/mock-spapi",
  hint: "Ensure CSV files are uploaded to Render or the data directory is accessible"
}
```

### 4. Test Data Ingestion

Once enabled, trigger a sync:

1. **Via API:**
   ```bash
   POST https://opside-node-api-woco.onrender.com/api/v1/sync/start
   Authorization: Bearer <your-token>
   Body: { "type": "full", "sourceSystems": ["amazon"] }
   ```

2. **Check logs for:**
   ```
   info: Using Mock SP-API for financial events { accountId: "..." }
   info: Using Mock SP-API for orders { userId: "..." }
   info: Using Mock SP-API for inventory { accountId: "..." }
   info: Using Mock SP-API for fees { accountId: "..." }
   ```

## Troubleshooting

### Issue: Mock SP-API not initializing

**Check:**
- Is `USE_MOCK_SPAPI=true` set in Render environment variables?
- Did you redeploy after setting the variable?
- Check logs for the initialization message

### Issue: CSV files not found

**Check:**
- Are CSV files in the `data/mock-spapi/` directory in your repository?
- Did you commit and push the files?
- Check the `dataDir` path in logs - it should match where files are located

### Issue: Path resolution problems

The service now handles multiple path scenarios:
- Local: `C:\Users\...\Clario-Complete-Backend\data\mock-spapi`
- Render: `/opt/render/project/src/data/mock-spapi`
- Render (alt): `/opt/render/project/src/Clario-Complete-Backend/data/mock-spapi`

The service will automatically detect the correct path based on where the `data` folder exists.

## Next Steps

1. ✅ Set `USE_MOCK_SPAPI=true` in Render
2. ✅ Ensure CSV files are in repository or uploaded to Render
3. ✅ Redeploy service
4. ✅ Check logs for initialization messages
5. ✅ Trigger a sync to test data ingestion

## Switching Back to Real SP-API

To switch back to real SP-API:
1. Set `USE_MOCK_SPAPI=false` or remove the variable
2. Redeploy service
3. The service will use real Amazon SP-API endpoints
