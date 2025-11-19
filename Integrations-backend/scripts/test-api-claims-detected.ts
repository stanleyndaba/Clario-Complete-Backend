/**
 * Test the live API endpoint to verify claimsDetected fix
 */

import 'dotenv/config';
import axios from 'axios';

const NODE_API_URL = process.env.NODE_API_URL || 'https://opside-node-api.onrender.com';
const TEST_SYNC_ID = 'sync_test-discovery-1763504060197_1763504064920';

async function testAPIClaimsDetected() {
  console.log('🧪 Testing Live API Endpoint\n');
  console.log(`API URL: ${NODE_API_URL}`);
  console.log(`Sync ID: ${TEST_SYNC_ID}\n`);

  try {
    console.log('📡 Calling GET /api/sync/status/:syncId...\n');
    
    const response = await axios.get(`${NODE_API_URL}/api/sync/status/${TEST_SYNC_ID}`, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ API Response:');
    console.log(`   Status Code: ${response.status}`);
    console.log(`   Sync ID: ${response.data?.syncId}`);
    console.log(`   Status: ${response.data?.status}`);
    console.log(`   Progress: ${response.data?.progress}%`);
    console.log(`   claimsDetected: ${response.data?.claimsDetected}`);
    console.log(`   ordersProcessed: ${response.data?.ordersProcessed}`);
    console.log(`   totalOrders: ${response.data?.totalOrders}`);
    console.log(`   inventoryCount: ${response.data?.inventoryCount}\n`);

    // Check if claimsDetected is correct
    if (response.data?.claimsDetected === 79) {
      console.log('✅ SUCCESS! API returns correct claimsDetected count (79)');
    } else if (response.data?.claimsDetected === 0) {
      console.log('❌ FAILED! API still returns 0 - fix may not be deployed yet');
    } else {
      console.log(`⚠️  API returns ${response.data?.claimsDetected} - may be a different sync`);
    }
  } catch (error: any) {
    console.error('❌ Error calling API:', error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
    }
    if (error.code === 'ECONNABORTED') {
      console.error('   Request timed out - Render may be deploying');
    }
  }
}

testAPIClaimsDetected().catch(console.error);











