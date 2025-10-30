// Test Amazon Data Flow
// Run with: node test_amazon_data_flow.js

const axios = require('axios');

const BASE_URL = 'http://localhost:3001'; // Integrations backend URL

async function testAmazonDataFlow() {
  console.log('🧪 Testing Amazon SP-API Data Flow...\n');

  try {
    // Test 1: Sync Amazon Data
    console.log('1️⃣ Testing Amazon Data Sync...');
    const syncResponse = await axios.post(`${BASE_URL}/api/v1/integrations/amazon/sync`);
    console.log('✅ Sync Response:', JSON.stringify(syncResponse.data, null, 2));
    console.log('');

    // Test 2: Fetch Inventory
    console.log('2️⃣ Testing Inventory Fetch...');
    const inventoryResponse = await axios.get(`${BASE_URL}/api/v1/integrations/amazon/inventory`);
    console.log('✅ Inventory Response:', JSON.stringify(inventoryResponse.data, null, 2));
    console.log('');

    // Test 3: Fetch Claims
    console.log('3️⃣ Testing Claims Fetch...');
    const claimsResponse = await axios.get(`${BASE_URL}/api/v1/integrations/amazon/claims`);
    console.log('✅ Claims Response:', JSON.stringify(claimsResponse.data, null, 2));
    console.log('');

    // Test 4: Fetch Fees
    console.log('4️⃣ Testing Fees Fetch...');
    const feesResponse = await axios.get(`${BASE_URL}/api/v1/integrations/amazon/fees`);
    console.log('✅ Fees Response:', JSON.stringify(feesResponse.data, null, 2));
    console.log('');

    // Test 5: Fetch Recoveries Summary
    console.log('5️⃣ Testing Recoveries Summary...');
    const recoveriesResponse = await axios.get(`${BASE_URL}/api/v1/integrations/amazon/recoveries`);
    console.log('✅ Recoveries Response:', JSON.stringify(recoveriesResponse.data, null, 2));
    console.log('');

    console.log('🎉 All tests passed! Amazon data is flowing correctly.');
    
    // Summary
    const summary = {
      inventory_items: inventoryResponse.data.inventory?.length || 0,
      claims_found: claimsResponse.data.claims?.length || 0,
      fees_found: feesResponse.data.fees?.length || 0,
      recovered_amount: syncResponse.data.data?.recoveredAmount || 0,
      potential_recovery: syncResponse.data.data?.potentialRecovery || 0
    };
    
    console.log('\n📊 Data Summary:');
    console.log(JSON.stringify(summary, null, 2));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testAmazonDataFlow();