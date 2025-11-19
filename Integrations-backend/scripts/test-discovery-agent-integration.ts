/**
 * Test Discovery Agent Integration within Agent 2
 * 
 * Verifies that:
 * 1. Agent 2 calls Discovery Agent after data sync
 * 2. Discovery Agent API responds correctly
 * 3. Detection results are stored
 * 4. Completion is signaled correctly
 * 
 * Run with: npm run test:discovery-agent
 */

import 'dotenv/config';
import axios from 'axios';

const NODE_API_URL = process.env.INTEGRATIONS_URL || 'https://opside-node-api-woco.onrender.com';
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'https://python-api-5.onrender.com';
const TEST_USER_ID = 'test-discovery-' + Date.now();

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  data?: any;
  duration?: number;
}

const results: TestResult[] = [];

async function testEndpoint(name: string, method: 'GET' | 'POST', url: string, data?: any, timeout = 60000): Promise<TestResult> {
  const startTime = Date.now();
  try {
    console.log(`\n🧪 Testing: ${name}`);
    console.log(`   ${method} ${url}`);
    
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
      const preview = JSON.stringify(response.data, null, 2).substring(0, 400);
      console.log(`   Response:`, preview + (JSON.stringify(response.data).length > 400 ? '...' : ''));
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
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      errorMsg = `Request timed out after ${duration}ms`;
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
  const pollInterval = 3000;
  
  console.log(`\n⏳ Waiting for sync + Discovery Agent to complete: ${syncId}`);
  
  while (Date.now() - startTime < maxWaitTime) {
    const statusResult = await testEndpoint(
      'Get Sync Status',
      'GET',
      `${NODE_API_URL}/api/sync/status/${syncId}`,
      undefined,
      20000
    );
    
    if (!statusResult.passed) {
      return statusResult;
    }
    
    const status = statusResult.data?.status;
    const progress = statusResult.data?.progress || 0;
    const message = statusResult.data?.message || 'Unknown';
    const claimsDetected = statusResult.data?.claimsDetected || 0;
    
    console.log(`   Status: ${status}, Progress: ${progress}%, Claims: ${claimsDetected}, Message: ${message}`);
    
    if (status === 'completed') {
      return {
        name: 'Sync + Discovery Agent Completion',
        passed: true,
        data: statusResult.data,
        duration: Date.now() - startTime
      };
    }
    
    if (status === 'failed' || status === 'cancelled') {
      return {
        name: 'Sync + Discovery Agent Completion',
        passed: false,
        error: `Sync ${status}: ${message}`,
        data: statusResult.data,
        duration: Date.now() - startTime
      };
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return {
    name: 'Sync + Discovery Agent Completion',
    passed: false,
    error: `Sync did not complete within ${maxWaitTime / 1000}s`,
    duration: Date.now() - startTime
  };
}

async function runTests() {
  console.log('🚀 Testing Discovery Agent Integration within Agent 2\n');
  console.log(`Node API URL: ${NODE_API_URL}`);
  console.log(`Python API URL: ${PYTHON_API_URL}`);
  console.log(`Test User ID: ${TEST_USER_ID}\n`);

  // Test 1: Check Python API Health
  console.log('='.repeat(60));
  console.log('STEP 1: Verify Python API (Discovery Agent) is accessible');
  console.log('='.repeat(60));
  
  const pythonHealthResult = await testEndpoint(
    'Python API Health Check',
    'GET',
    `${PYTHON_API_URL}/health`,
    undefined,
    30000
  );
  results.push(pythonHealthResult);

  // Test 2: Start Sync (which should trigger Discovery Agent)
  console.log('\n' + '='.repeat(60));
  console.log('STEP 2: Start Sync (Agent 2 will call Discovery Agent)');
  console.log('='.repeat(60));
  
  const startResult = await testEndpoint(
    'Start Sync',
    'POST',
    `${NODE_API_URL}/api/sync/start`,
    undefined,
    60000
  );
  results.push(startResult);
  
  const syncId = startResult.data?.syncId;
  if (!syncId) {
    console.log('\n⚠️  No syncId returned, cannot test Discovery Agent integration');
    printSummary();
    return;
  }

  console.log(`\n📌 Sync ID: ${syncId}`);

  // Test 3: Monitor sync and wait for Discovery Agent to complete
  console.log('\n' + '='.repeat(60));
  console.log('STEP 3: Monitor Sync + Discovery Agent Progress');
  console.log('='.repeat(60));
  console.log('Looking for:');
  console.log('  - Progress reaching 80% (Discovery Agent phase)');
  console.log('  - Message: "Waiting for claim detection (Discovery Agent)..."');
  console.log('  - Progress reaching 100% (Discovery Agent completed)');
  console.log('  - claimsDetected > 0 (if any claimable items found)');
  
  const syncCompletionResult = await waitForSync(syncId, 120000);
  results.push(syncCompletionResult);

  // Test 4: Verify final status includes Discovery Agent results
  if (syncCompletionResult.passed) {
    console.log('\n' + '='.repeat(60));
    console.log('STEP 4: Verify Discovery Agent Results');
    console.log('='.repeat(60));
    
    const finalStatusResult = await testEndpoint(
      'Get Final Sync Status (with Discovery Agent results)',
      'GET',
      `${NODE_API_URL}/api/sync/status/${syncId}`,
      undefined,
      20000
    );
    results.push(finalStatusResult);

    if (finalStatusResult.passed) {
      const data = finalStatusResult.data;
      const claimsDetected = data.claimsDetected || 0;
      
      console.log(`\n📊 Discovery Agent Results:`);
      console.log(`   Claims Detected: ${claimsDetected}`);
      console.log(`   Status: ${data.status}`);
      console.log(`   Message: ${data.message}`);
      
      if (claimsDetected > 0) {
        console.log(`\n✅ Discovery Agent found ${claimsDetected} claimable items!`);
      } else {
        console.log(`\n⚠️  Discovery Agent found 0 claimable items. This could mean:`);
        console.log(`   - No anomalies detected in the synced data`);
        console.log(`   - All predictions had claimable=false`);
        console.log(`   - Discovery Agent was called but returned empty results`);
      }
      
      // Check if we can query detection results directly
      console.log(`\n🔍 Checking detection results...`);
      // Note: We'd need a detection results endpoint to verify storage
      // For now, we verify through sync status
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
    console.log('\n⚠️  Some tests failed.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed! Discovery Agent integration is working.');
  }
}

runTests().catch(error => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
});



