/**
 * Test Python API Health and Connectivity
 */

import axios from 'axios';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'https://python-api-5.onrender.com';

async function testHealth() {
  console.log('\n🔍 Testing Python API Health...\n');
  console.log(`Python API URL: ${PYTHON_API_URL}\n`);

  try {
    console.log('1. Testing /health endpoint...');
    const healthResponse = await axios.get(`${PYTHON_API_URL}/health`, {
      timeout: 10000
    });
    console.log('✅ Health check passed:', healthResponse.data);
  } catch (error: any) {
    console.error('❌ Health check failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    if (error.code) {
      console.error('   Code:', error.code);
    }
  }

  try {
    console.log('\n2. Testing /api/v1/claim-detector/predict/batch endpoint...');
    const testPayload = {
      claims: [
        {
          claim_id: 'test-claim-1',
          order_id: 'TEST-ORDER-1',
          claim_type: 'reimbursement',
          amount: 10.50,
          currency: 'USD',
          claim_date: new Date().toISOString(),
          seller_id: 'test-seller'
        }
      ]
    };

    const predictResponse = await axios.post(
      `${PYTHON_API_URL}/api/v1/claim-detector/predict/batch`,
      testPayload,
      {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    console.log('✅ Prediction endpoint works!');
    console.log('   Status:', predictResponse.status);
    console.log('   Predictions:', predictResponse.data?.predictions?.length || 0);
  } catch (error: any) {
    console.error('❌ Prediction endpoint failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Status Text:', error.response.statusText);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.code) {
      console.error('   Code:', error.code);
    }
    if (error.config) {
      console.error('   URL:', error.config.url);
    }
  }

  console.log('\n');
}

testHealth().catch(console.error);

