# Amazon SP-API Sandbox Credentials

## 🔑 Sandbox Configuration

These are the **sandbox credentials** provided by Amazon for testing the SP-API integration.

### Environment Variables

Add these to your `.env` file in the `Integrations-backend` directory:

```bash
# Amazon SP-API Sandbox Configuration
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_SPAPI_REDIRECT_URI=http://localhost:3000/api/v1/integrations/amazon/callback
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER
```

## ✅ Current Implementation Status

The system is **now configured to pull real data** from the Amazon SP-API Sandbox. Here's what's happening:

### 1. **Access Token Management** 
   - Automatically refreshes tokens using the `AMAZON_SPAPI_REFRESH_TOKEN`
   - Uses `AMAZON_CLIENT_ID` and `AMAZON_CLIENT_SECRET` for authentication

### 2. **Inventory Fetching**
   - Calls real SP-API endpoint: `${AMAZON_SPAPI_BASE_URL}/fba/inventory/v1/summaries`
   - Transforms SP-API responses to internal data format
   - Returns mock data as fallback if authentication fails

### 3. **Sandbox vs Production**
   - Currently configured for **sandbox** (using `sandbox.sellingpartnerapi-na.amazon.com`)
   - When ready for production, change to `sellingpartnerapi-na.amazon.com`

## 🧪 Testing the Integration

### Step 1: Set Environment Variables

Copy the credentials above to your `.env` file:

```bash
cd Integrations-backend
# Edit .env and add the credentials
```

### Step 2: Test Token Refresh

The system will automatically:
1. Use the refresh token to get a new access token
2. Call the SP-API endpoint for inventory data
3. Return transformed data to the dashboard

### Step 3: Verify Data Flow

1. **Check Logs**: Look for "Fetching inventory for account..." messages
2. **View Dashboard**: Real inventory data should appear
3. **Monitor Sync**: Background workers will periodically update data

## 🔍 How It Works

```typescript
// 1. Get access token (auto-refreshes when needed)
const accessToken = await this.getAccessToken();

// 2. Call SP-API with sandbox URL
const response = await axios.get(
  'https://sandbox.sellingpartnerapi-na.amazon.com/fba/inventory/v1/summaries',
  {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  }
);

// 3. Transform and return real data
return { success: true, data: inventory };
```

## 🚨 Important Notes

1. **Sandbox Only**: These credentials are for sandbox testing only
2. **Token Expiry**: Access tokens expire after 1 hour, system auto-refreshes
3. **Mock Fallback**: If SP-API fails, system returns mock data instead of crashing
4. **Marketplace**: Currently configured for US marketplace (ATVPDKIKX0DER)

## 📊 Expected Data Format

When the integration works, you should see:

```json
{
  "success": true,
  "data": [
    {
      "sku": "SKU-12345",
      "asin": "B08N5WRWNW",
      "fnSku": "X00012345",
      "quantity": 150,
      "condition": "New",
      "location": "FBA",
      "status": "active",
      "reserved": 10,
      "damaged": 0
    }
  ],
  "message": "Fetched 25 inventory items from SP-API"
}
```

## 🔄 Next Steps

1. **Add credentials to `.env`** in `Integrations-backend` directory
2. **Restart the service** to load new environment variables
3. **Test the integration** by triggering a sync
4. **Verify data** appears on the dashboard
5. **Monitor logs** for any authentication or API errors

## 📝 Support

If you encounter issues:
- Check that all environment variables are set correctly
- Verify the refresh token is valid and not expired
- Check logs for "SP-API authentication failed" messages
- Ensure the sandbox URL is accessible
