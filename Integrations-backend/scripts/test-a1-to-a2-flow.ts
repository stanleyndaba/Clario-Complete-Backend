/**
 * Test A1 to A2 Flow (End-to-End)
 * 
 * Tests the complete flow:
 * 1. Agent 1: Check Amazon connection status
 * 2. Agent 1: Use existing connection (bypass OAuth)
 * 3. Agent 2: Start sync
 * 4. Agent 2: Monitor sync progress
 * 5. Agent 2: Verify sync completion with all counts
 * 
 * Run with: npm run test:a1-a2
 */

import 'dotenv/config';
import axios from 'axios';

const NODE_API_URL =
  process.env.INTEGRATIONS_URL ||
  process.env.LOCAL_NODE_API_URL ||
  'http://localhost:3001';
const TEST_USER_ID = 'test-user-a1-a2-' + Date.now();

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  data?: any;
  duration?: number;
}

const results: TestResult[] = [];

async function testEndpoint(name: string, method: 'GET' | 'POST', path: string, data?: any, timeout = 60000): Promise<TestResult> {
  const startTime = Date.now();
  try {
    const url = `${NODE_API_URL}${path}`;
    console.log(`\n🧪 Testing: ${name}`);
    console.log(`   ${method} ${path}`);
    console.log(`   Timeout: ${timeout}ms (Render may take 30-60s to wake up)`);
    
    const config: any = {
      method,
      url,
      headers: {
        'X-User-Id': TEST_USER_ID,
        'Content-Type': 'application/json'
      },
      timeout
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    const duration = Date.now() - startTime;
    
    console.log(`   ✅ Status: ${response.status} (${duration}ms)`);
    if (response.data) {
      const preview = JSON.stringify(response.data, null, 2).substring(0, 300);
      console.log(`   Response:`, preview + (JSON.stringify(response.data).length > 300 ? '...' : ''));
    }
    
    return {
      name,
      passed: true,
      data: response.data,
      duration
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    let errorMsg = error.message;
    if (error.response) {
      errorMsg = error.response.data?.error || error.response.data?.message || error.response.statusText || error.message;
      console.log(`   Status: ${error.response.status} (${duration}ms)`);
      if (error.response.data) {
        const preview = JSON.stringify(error.response.data, null, 2).substring(0, 300);
        console.log(`   Response:`, preview);
      }
    } else if (error.code === 'ECONNREFUSED') {
      errorMsg = 'Connection refused - is the backend running?';
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      errorMsg = `Request timed out after ${duration}ms - Render may be waking up (can take 30-60s)`;
    }
    console.log(`   ❌ Failed: ${errorMsg}`);
    return {
      name,
      passed: false,
      error: errorMsg,
      duration
    };
  }
}

async function waitForSync(syncId: string, maxWaitTime = 120000): Promise<TestResult> {
  const startTime = Date.now();
  const pollInterval = 3000; // Poll every 3 seconds
  
  console.log(`\n⏳ Waiting for sync to complete: ${syncId}`);
  console.log(`   Max wait time: ${maxWaitTime / 1000}s`);
  
  while (Date.now() - startTime < maxWaitTime) {
    const statusResult = await testEndpoint(
      'Get Sync Status (Polling)',
      'GET',
      `/api/sync/status/${syncId}`,
      undefined,
      20000
    );
    
    if (!statusResult.passed) {
      return statusResult;
    }
    
    const status = statusResult.data?.status;
    const progress = statusResult.data?.progress || 0;
    const message = statusResult.data?.message || 'Unknown';
    
    console.log(`   Status: ${status}, Progress: ${progress}%, Message: ${message}`);
    
    if (status === 'completed') {
      console.log(`   ✅ Sync completed!`);
      return {
        name: 'Sync Completion',
        passed: true,
        data: statusResult.data,
        duration: Date.now() - startTime
      };
    }
    
    if (status === 'failed' || status === 'cancelled') {
      return {
        name: 'Sync Completion',
        passed: false,
        error: `Sync ${status}: ${message}`,
        data: statusResult.data,
        duration: Date.now() - startTime
      };
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return {
    name: 'Sync Completion',
    passed: false,
    error: `Sync did not complete within ${maxWaitTime / 1000}s`,
    duration: Date.now() - startTime
  };
}

async function runTests() {
  console.log('🚀 Testing A1 to A2 Flow (End-to-End)\n');
  console.log(`Node API URL: ${NODE_API_URL}`);
  console.log(`Test User ID: ${TEST_USER_ID}`);
  console.log(`\n⚠️  Note: Render free tier can take 30-60 seconds to wake up on first request\n`);

  // Test 1: Agent 1 - Check Amazon Connection Status
  console.log('='.repeat(60));
  console.log('AGENT 1: OAuth / Zero Agent Layer');
  console.log('='.repeat(60));
  
  const statusResult = await testEndpoint(
    'Agent 1: Get Amazon Connection Status',
    'GET',
    '/api/v1/integrations/amazon/status',
    undefined,
    60000 // 60s timeout for first request (Render wake-up)
  );
  results.push(statusResult);

  // Test 2: Agent 1 - Use Existing Connection (Bypass OAuth)
  const bypassResult = await testEndpoint(
    'Agent 1: Use Existing Connection (Bypass OAuth)',
    'GET',
    `/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=http://localhost:5173`,
    undefined,
    60000
  );
  results.push(bypassResult);

  if (!bypassResult.passed) {
    console.log('\n⚠️  Bypass failed - sync may not work without connection');
  }

  // Test 3: Agent 2 - Start Sync
  console.log('\n' + '='.repeat(60));
  console.log('AGENT 2: Data Sync / Classification Agent');
  console.log('='.repeat(60));
  
  const startResult = await testEndpoint(
    'Agent 2: Start Sync',
    'POST',
    '/api/sync/start',
    undefined,
    60000
  );
  results.push(startResult);
  
  const syncId = startResult.data?.syncId;
  if (!syncId) {
    console.log('\n⚠️  No syncId returned, cannot test sync monitoring');
    printSummary();
    return;
  }

  console.log(`\n📌 Sync ID: ${syncId}`);

  // Test 4: Agent 2 - Get Active Sync Status
  const activeStatusResult = await testEndpoint(
    'Agent 2: Get Active Sync Status',
    'GET',
    '/api/sync/status',
    undefined,
    30000
  );
  results.push(activeStatusResult);

  // Test 5: Agent 2 - Monitor Sync Progress
  console.log('\n⏳ Monitoring sync progress...');
  const syncCompletionResult = await waitForSync(syncId, 120000); // 2 minutes max
  results.push(syncCompletionResult);

  // Test 6: Agent 2 - Verify Sync Status with All Counts
  if (syncCompletionResult.passed) {
    const finalStatusResult = await testEndpoint(
      'Agent 2: Verify Final Sync Status (All Counts)',
      'GET',
      `/api/sync/status/${syncId}`,
      undefined,
      20000
    );
    results.push(finalStatusResult);

    // Verify all count fields are present
    if (finalStatusResult.passed) {
      const data = finalStatusResult.data;
      const countFields = ['ordersProcessed', 'totalOrders', 'inventoryCount', 'shipmentsCount',
                          'returnsCount', 'settlementsCount', 'feesCount', 'claimsDetected'];
      const missingCounts = countFields.filter(field => !data.hasOwnProperty(field));
      
      if (missingCounts.length > 0) {
        finalStatusResult.passed = false;
        finalStatusResult.error = `Missing count fields: ${missingCounts.join(', ')}`;
      } else {
        console.log(`\n✅ All count fields present:`);
        console.log(`   Orders: ${data.ordersProcessed || 0}/${data.totalOrders || 0}`);
        console.log(`   Inventory: ${data.inventoryCount || 0}`);
        console.log(`   Shipments: ${data.shipmentsCount || 0}`);
        console.log(`   Returns: ${data.returnsCount || 0}`);
        console.log(`   Settlements: ${data.settlementsCount || 0}`);
        console.log(`   Fees: ${data.feesCount || 0}`);
        console.log(`   Claims Detected: ${data.claimsDetected || 0}`);
      }
    }
  }

  // Test 7: Agent 2 - Get Sync History
  const historyResult = await testEndpoint(
    'Agent 2: Get Sync History',
    'GET',
    '/api/sync/history?limit=5&offset=0',
    undefined,
    30000
  );
  results.push(historyResult);

  // Verify history includes all counts
  if (historyResult.passed && historyResult.data?.syncs?.length > 0) {
    const firstSync = historyResult.data.syncs[0];
    const countFields = ['ordersProcessed', 'totalOrders', 'inventoryCount', 'shipmentsCount',
                        'returnsCount', 'settlementsCount', 'feesCount', 'claimsDetected'];
    const missingCounts = countFields.filter(field => !firstSync.hasOwnProperty(field));
    
    if (missingCounts.length > 0) {
      console.log(`   ⚠️  Missing count fields in history: ${missingCounts.join(', ')}`);
    } else {
      console.log(`   ✅ History includes all count fields`);
    }
  }

  printSummary();
}

function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
  
  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    const duration = result.duration ? ` (${result.duration}ms)` : '';
    console.log(`${icon} ${result.name}${duration}`);
    if (!result.passed && result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));
  
  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. This may be due to:');
    console.log('   - Render cold start (first request takes 30-60s)');
    console.log('   - Network timeouts');
    console.log('   - Backend errors');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed! A1 to A2 flow is working correctly.');
  }
}

// Run tests
runTests().catch(error => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
});




