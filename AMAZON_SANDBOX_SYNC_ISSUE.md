# Amazon Sandbox Sync Issue - Root Cause Analysis

## 🔴 Problem Statement

The continuous data sync system is not pulling real data from Amazon SP-API Sandbox. The dashboard shows no data because:

1. **Mock Data Returned**: The `amazonService.fetchInventory()` returns empty arrays
2. **No Actual SP-API Calls**: The sync jobs don't make real API calls to Amazon SP-API
3. **Missing Credentials**: Sandbox SP-API credentials may not be properly configured

## 🎯 Expected Behavior

After user authentication in sandbox mode:
1. System should fetch inventory data from Amazon SP-API Sandbox
2. Data should be normalized and stored in the database
3. Dashboard should display live inventory numbers
4. Continuous sync workers should periodically update the data

## 🔍 Root Cause Analysis

### Issue 1: Service Returns Empty Arrays

**File**: `Integrations-backend/src/services/amazonService.ts`

```typescript
async fetchInventory(accountId: string): Promise<any> {
  try {
    await this.getCredentials(accountId);
    console.log(`[AmazonService] Fetching inventory for account ${accountId}`);
    return { success: true, data: [], message: "Inventory fetch method called" };
    // ❌ Returns empty array instead of actual SP-API data
  } catch (error: any) {
    console.error("Error fetching Amazon inventory:", error);
    throw new Error(`Failed to fetch inventory: ${error.message}`);
  }
}
```

### Issue 2: Mock Controllers

**File**: `Integrations-backend/src/controllers/amazonController.ts`

```typescript
export const getAmazonInventory = async (_req: Request, res: Response) => {
  res.json({
    success: true,
    inventory: [
      { sku: 'PROD-001', quantity: 45, status: 'active' },  // ❌ Hardcoded mock data
      { sku: 'PROD-002', quantity: 12, status: 'inactive' }
    ]
  });
};
```

### Issue 3: Real SP-API Service Exists But Not Used

There IS a proper Amazon SP-API service implementation:
- **File**: `Integrations-backend/opsided-backend/smart-inventory-sync/src/services/amazonSPAPIService.ts`
- This service has proper SP-API integration with real endpoints

But it's not being used by the main sync system!

## ✅ Solution Steps

### Step 1: Update Amazon Service to Use Real SP-API

Create a new implementation that uses the existing `AmazonSPAPIService`:

```typescript
// File: Integrations-backend/src/services/amazonService.ts

import { AmazonSPAPIService, AmazonSPAPIConfig } from '../../opsided-backend/smart-inventory-sync/src/services/amazonSPAPIService';

export class AmazonService {
  private spApiService: AmazonSPAPIService | null = null;

  private async initializeSPAPI(accountId: string): Promise<void> {
    // Get credentials from database
    const credentials = await this.getCredentials(accountId);
    
    const config: AmazonSPAPIConfig = {
      clientId: process.env.AMAZON_CLIENT_ID || '',
      clientSecret: process.env.AMAZON_CLIENT_SECRET || '',
      refreshToken: credentials.refresh_token,
      marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER', // US marketplace
      sellerId: credentials.seller_id,
      region: process.env.AMAZON_REGION || 'us-east-1',
    };

    this.spApiService = new AmazonSPAPIService(config);
  }

  async fetchInventory(accountId: string): Promise<any> {
    try {
      if (!this.spApiService) {
        await this.initializeSPAPI(accountId);
      }

      const marketplaceIds = [process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER'];
      const inventoryItems = await this.spApiService!.fetchInventoryItems(marketplaceIds);
      
      return {
        success: true,
        data: inventoryItems,
        message: `Fetched ${inventoryItems.length} inventory items`
      };
    } catch (error: any) {
      console.error("Error fetching Amazon inventory:", error);
      throw new Error(`Failed to fetch inventory: ${error.message}`);
    }
  }
}
```

### Step 2: Update Controllers to Use Real Service

```typescript
// File: Integrations-backend/src/controllers/amazonController.ts

export const getAmazonInventory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id; // Get from authenticated user
    const inventory = await amazonService.fetchInventory(userId);
    
    res.json({
      success: true,
      inventory: inventory.data || []
    });
  } catch (error) {
    logger.error('Get inventory error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory'
    });
  }
};
```

### Step 3: Configure Sandbox SP-API Credentials

Add to `.env`:

```bash
# Amazon SP-API Sandbox Configuration
AMAZON_CLIENT_ID=your_sandbox_client_id
AMAZON_CLIENT_SECRET=your_sandbox_client_secret
AMAZON_SPAPI_REFRESH_TOKEN=your_sandbox_refresh_token
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER  # US Sandbox
AMAZON_REGION=us-east-1
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com  # ⚠️ Use sandbox URL
```

### Step 4: Update Sync Jobs to Use Real Service

```typescript
// File: Integrations-backend/src/jobs/amazonSyncJob.ts

async syncUserData(userId: string): Promise<string> {
  const syncId = `sync_${userId}_${Date.now()}`;
  
  try {
    logger.info('Starting Amazon sync for user', { userId, syncId });

    // Sync inventory - NOW WITH REAL DATA
    const inventory = await amazonService.fetchInventory(userId);
    await this.saveInventoryToDatabase(userId, inventory.data);  // ✅ Save real data

    logger.info('Amazon sync completed successfully', { userId, syncId });
    return syncId;
  } catch (error: any) {
    logger.error('Error during Amazon sync:', error);
    throw error;
  }
}
```

## 🚀 Implementation Priority

1. **High Priority**: Update `amazonService.ts` to use real SP-API
2. **High Priority**: Configure sandbox credentials
3. **Medium Priority**: Update controllers to return real data
4. **Low Priority**: Add error handling and retry logic

## 📝 Testing Steps

1. **Verify Credentials**: Check that sandbox credentials are set
2. **Test Direct API Call**: Use `test_lwa.py` to verify token generation
3. **Test Inventory Fetch**: Make direct SP-API call to fetch inventory
4. **Test Dashboard**: Verify data appears on dashboard after sync
5. **Test Continuous Sync**: Verify background workers update data

## 🔗 Key Files to Modify

1. `Integrations-backend/src/services/amazonService.ts` - Add real SP-API calls
2. `Integrations-backend/src/controllers/amazonController.ts` - Return real data
3. `Integrations-backend/src/jobs/amazonSyncJob.ts` - Save real data to DB
4. `.env` - Configure sandbox credentials

## 📚 Documentation

- Amazon SP-API Sandbox Docs: https://github.com/amzn/selling-partner-api-docs
- Test LWA Script: `test_lwa.py`
- Sandbox Base URL: `https://sandbox.sellingpartnerapi-na.amazon.com`
