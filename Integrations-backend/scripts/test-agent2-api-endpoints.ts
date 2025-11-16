/**
 * Test script for Agent 2 API Endpoints
 * 
 * Tests the sync endpoints that the frontend will call:
 * 1. POST /api/sync/start - Start sync
 * 2. GET /api/sync/status - Get active sync status
 * 3. GET /api/sync/status/:syncId - Get sync status by ID
 * 4. GET /api/sync/history - Get sync history
 * 5. POST /api/sync/cancel/:syncId - Cancel sync
 * 
 * Run with: npm run test:agent2-api
 */

import 'dotenv/config';
import axios from 'axios';

const API_URL = process.env.INTEGRATIONS_URL || 'http://localhost:3001';
const TEST_USER_ID = 'test-user-agent2-' + Date.now();

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  data?: any;
}

const results: TestResult[] = [];

async function testEndpoint(name: string, method: 'GET' | 'POST', path: string, data?: any): Promise<TestResult> {
  try {
    const url = `${API_URL}${path}`;
    console.log(`\n🧪 Testing: ${name}`);
    console.log(`   ${method} ${path}`);
    
    const config: any = {
      method,
      url,
      headers: {
        'X-User-Id': TEST_USER_ID,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    
    console.log(`   ✅ Status: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2).substring(0, 200));
    
    return {
      name,
      passed: true,
      data: response.data
    };
  } catch (error: any) {
    let errorMsg = error.message;
    if (error.response) {
      errorMsg = error.response.data?.error || error.response.data?.message || error.response.statusText || error.message;
      console.log(`   Status: ${error.response.status}`);
      if (error.response.data) {
        console.log(`   Response:`, JSON.stringify(error.response.data, null, 2).substring(0, 300));
      }
    } else if (error.code === 'ECONNREFUSED') {
      errorMsg = 'Connection refused - is the backend running on ' + API_URL + '?';
    }
    console.log(`   ❌ Failed: ${errorMsg}`);
    return {
      name,
      passed: false,
      error: errorMsg
    };
  }
}

async function runTests() {
  console.log('🚀 Testing Agent 2 API Endpoints\n');
  console.log(`API URL: ${API_URL}`);
  console.log(`Test User ID: ${TEST_USER_ID}\n`);

  // Test 1: Start Sync
  const startResult = await testEndpoint(
    'Start Sync',
    'POST',
    '/api/sync/start'
  );
  results.push(startResult);
  
  const syncId = startResult.data?.syncId;
  if (!syncId) {
    console.log('\n⚠️  No syncId returned, cannot test other endpoints');
    printSummary();
    return;
  }

  console.log(`\n📌 Sync ID: ${syncId}`);

  // Wait a bit for sync to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 2: Get Active Sync Status
  const activeStatusResult = await testEndpoint(
    'Get Active Sync Status',
    'GET',
    '/api/sync/status'
  );
  results.push(activeStatusResult);

  // Verify response format
  if (activeStatusResult.passed) {
    const data = activeStatusResult.data;
    if (!data.hasOwnProperty('hasActiveSync')) {
      activeStatusResult.passed = false;
      activeStatusResult.error = 'Missing hasActiveSync field';
    }
    if (data.hasActiveSync && !data.lastSync) {
      activeStatusResult.passed = false;
      activeStatusResult.error = 'hasActiveSync is true but lastSync is null';
    }
    if (data.lastSync) {
      const requiredFields = ['syncId', 'status'];
      const missingFields = requiredFields.filter(field => !data.lastSync.hasOwnProperty(field));
      if (missingFields.length > 0) {
        activeStatusResult.passed = false;
        activeStatusResult.error = `Missing fields in lastSync: ${missingFields.join(', ')}`;
      }
    }
  }

  // Test 3: Get Sync Status by ID
  const statusResult = await testEndpoint(
    'Get Sync Status by ID',
    'GET',
    `/api/sync/status/${syncId}`
  );
  results.push(statusResult);

  // Verify response format
  if (statusResult.passed) {
    const data = statusResult.data;
    const requiredFields = ['syncId', 'status', 'progress', 'message', 'startedAt'];
    const missingFields = requiredFields.filter(field => !data.hasOwnProperty(field));
    if (missingFields.length > 0) {
      statusResult.passed = false;
      statusResult.error = `Missing required fields: ${missingFields.join(', ')}`;
    }
    
    // Check for all count fields
    const countFields = ['ordersProcessed', 'totalOrders', 'inventoryCount', 'shipmentsCount', 
                         'returnsCount', 'settlementsCount', 'feesCount', 'claimsDetected'];
    const missingCounts = countFields.filter(field => !data.hasOwnProperty(field));
    if (missingCounts.length > 0) {
      console.log(`   ⚠️  Missing count fields (may be 0): ${missingCounts.join(', ')}`);
    }
  }

  // Test 4: Get Sync History
  const historyResult = await testEndpoint(
    'Get Sync History',
    'GET',
    '/api/sync/history?limit=10&offset=0'
  );
  results.push(historyResult);

  // Verify response format
  if (historyResult.passed) {
    const data = historyResult.data;
    if (!data.hasOwnProperty('syncs') || !Array.isArray(data.syncs)) {
      historyResult.passed = false;
      historyResult.error = 'Missing or invalid syncs array';
    } else if (data.syncs.length > 0) {
      const firstSync = data.syncs[0];
      const requiredFields = ['syncId', 'status', 'startedAt'];
      const missingFields = requiredFields.filter(field => !firstSync.hasOwnProperty(field));
      if (missingFields.length > 0) {
        historyResult.passed = false;
        historyResult.error = `Missing required fields in sync history: ${missingFields.join(', ')}`;
      }
      
      // Check for all count fields in history
      const countFields = ['ordersProcessed', 'totalOrders', 'inventoryCount', 'shipmentsCount',
                           'returnsCount', 'settlementsCount', 'feesCount', 'claimsDetected'];
      const missingCounts = countFields.filter(field => !firstSync.hasOwnProperty(field));
      if (missingCounts.length > 0) {
        console.log(`   ⚠️  Missing count fields in history (may be 0): ${missingCounts.join(', ')}`);
      }
    }
    if (!data.hasOwnProperty('total')) {
      historyResult.passed = false;
      historyResult.error = 'Missing total field';
    }
  }

  // Test 5: Cancel Sync (only if sync is still running)
  if (statusResult.passed && statusResult.data?.status === 'running') {
    const cancelResult = await testEndpoint(
      'Cancel Sync',
      'POST',
      `/api/sync/cancel/${syncId}`
    );
    results.push(cancelResult);

    // Verify response format
    if (cancelResult.passed) {
      const data = cancelResult.data;
      if (!data.hasOwnProperty('success') || !data.hasOwnProperty('message')) {
        cancelResult.passed = false;
        cancelResult.error = 'Missing success or message field';
      }
    }
  } else {
    console.log('\n⏭️  Skipping cancel test (sync not running)');
  }

  printSummary();
}

function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    if (!result.passed && result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('='.repeat(60));
  
  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
});

