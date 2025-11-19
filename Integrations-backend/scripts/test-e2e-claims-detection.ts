/**
 * End-to-End Test: Verify Claims Detection Pipeline
 * 
 * Tests:
 * 1. Start sync
 * 2. Wait for sync to complete
 * 3. Verify detection completed
 * 4. Check detection_results in database
 * 5. Verify claimsDetected count in API response matches database
 */

import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const NODE_API_URL = process.env.INTEGRATIONS_URL || 'https://opside-node-api-woco.onrender.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uuuqpujtnubusmigbkvw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dXFwdWp0bnVidXNtaWdia3Z3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzM5NjgzOSwiZXhwIjoyMDY4OTcyODM5fQ.Z_1TUlk3WgtCggP80UYPGj8gK-JKdgjPf3rNkHxIrBE';

const TEST_USER_ID = `e2e-test-user-${Date.now()}`;
const MAX_WAIT_TIME = 120000; // 2 minutes
const POLL_INTERVAL = 2000; // 2 seconds

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function log(message: string, data?: any) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
  console.log('='.repeat(80));
}

function addResult(name: string, passed: boolean, error?: string, details?: any) {
  results.push({ name, passed, error, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${error ? `: ${error}` : ''}`);
}

async function waitForSync(syncId: string): Promise<any> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < MAX_WAIT_TIME) {
    try {
      const response = await axios.get(`${NODE_API_URL}/api/sync/status/${syncId}`, {
        timeout: 20000,
        headers: {
          'X-User-Id': TEST_USER_ID
        }
      });
      
      const status = response.data;
      
      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }
      
      // Log progress
      console.log(`⏳ Sync in progress: ${status.progress}% - ${status.message}`);
      console.log(`   Orders: ${status.ordersProcessed || 0}/${status.totalOrders || 0}`);
      console.log(`   Claims Detected: ${status.claimsDetected || 0}`);
      
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    } catch (error: any) {
      console.error('Error polling sync status:', error.message);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }
  
  throw new Error('Sync timeout - did not complete within 2 minutes');
}

async function test1_StartSync(): Promise<string> {
  log('Test 1: Starting Sync');
  
  try {
    const response = await axios.post(
      `${NODE_API_URL}/api/sync/start`,
      {},
      {
        timeout: 30000,
        headers: {
          'X-User-Id': TEST_USER_ID,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const syncId = response.data.syncId;
    addResult('Start Sync', true, undefined, { syncId, status: response.data.status });
    return syncId;
  } catch (error: any) {
    addResult('Start Sync', false, error.message);
    throw error;
  }
}

async function test2_WaitForCompletion(syncId: string): Promise<any> {
  log('Test 2: Waiting for Sync Completion');
  
  try {
    const finalStatus = await waitForSync(syncId);
    addResult('Sync Completion', finalStatus.status === 'completed', 
      finalStatus.status !== 'completed' ? `Status: ${finalStatus.status}` : undefined,
      finalStatus
    );
    return finalStatus;
  } catch (error: any) {
    addResult('Sync Completion', false, error.message);
    throw error;
  }
}

async function test3_CheckDetectionQueue(syncId: string): Promise<any> {
  log('Test 3: Checking Detection Queue');
  
  try {
    const { data, error } = await supabase
      .from('detection_queue')
      .select('*')
      .eq('sync_id', syncId)
      .eq('seller_id', TEST_USER_ID)
      .maybeSingle();
    
    if (error) {
      addResult('Check Detection Queue', false, error.message);
      return null;
    }
    
    if (!data) {
      addResult('Check Detection Queue', false, 'No detection_queue record found');
      return null;
    }
    
    const passed = data.status === 'completed';
    addResult('Check Detection Queue', passed, 
      passed ? undefined : `Status: ${data.status}`,
      data
    );
    return data;
  } catch (error: any) {
    addResult('Check Detection Queue', false, error.message);
    return null;
  }
}

async function test4_CheckDetectionResults(syncId: string): Promise<number> {
  log('Test 4: Checking Detection Results in Database');
  
  try {
    const { data, error, count } = await supabase
      .from('detection_results')
      .select('*', { count: 'exact' })
      .eq('sync_id', syncId)
      .eq('seller_id', TEST_USER_ID);
    
    if (error) {
      addResult('Check Detection Results', false, error.message);
      return 0;
    }
    
    const resultCount = count || 0;
    const passed = resultCount > 0;
    
    addResult('Check Detection Results', passed,
      passed ? undefined : 'No detection results found',
      { count: resultCount, sample: data?.[0] || null }
    );
    
    if (data && data.length > 0) {
      console.log(`\n📊 Sample Detection Results (showing first 3):`);
      data.slice(0, 3).forEach((result: any, idx: number) => {
        console.log(`   ${idx + 1}. ${result.anomaly_type} - $${result.estimated_value} (confidence: ${result.confidence_score})`);
      });
    }
    
    return resultCount;
  } catch (error: any) {
    addResult('Check Detection Results', false, error.message);
    return 0;
  }
}

async function test5_CheckSyncProgress(syncId: string): Promise<any> {
  log('Test 5: Checking Sync Progress in Database');
  
  try {
    const { data, error } = await supabase
      .from('sync_progress')
      .select('*')
      .eq('sync_id', syncId)
      .eq('user_id', TEST_USER_ID)
      .maybeSingle();
    
    if (error) {
      addResult('Check Sync Progress', false, error.message);
      return null;
    }
    
    if (!data) {
      addResult('Check Sync Progress', false, 'No sync_progress record found');
      return null;
    }
    
    const metadata = data.metadata || {};
    const claimsDetected = metadata.claimsDetected || 0;
    
    addResult('Check Sync Progress', true, undefined, {
      status: data.status,
      progress: data.progress,
      claimsDetected,
      metadata
    });
    
    return data;
  } catch (error: any) {
    addResult('Check Sync Progress', false, error.message);
    return null;
  }
}

async function test6_VerifyClaimsDetectedCount(syncId: string, dbCount: number): Promise<boolean> {
  log('Test 6: Verifying claimsDetected Count Matches Database');
  
  try {
    const response = await axios.get(`${NODE_API_URL}/api/sync/status/${syncId}`, {
      timeout: 20000,
      headers: {
        'X-User-Id': TEST_USER_ID
      }
    });
    
    const apiClaimsDetected = response.data.claimsDetected || 0;
    const passed = apiClaimsDetected === dbCount && dbCount > 0;
    
    addResult('Verify claimsDetected Count', passed,
      passed ? undefined : `Mismatch: API=${apiClaimsDetected}, DB=${dbCount}`,
      {
        apiClaimsDetected,
        dbCount,
        match: apiClaimsDetected === dbCount
      }
    );
    
    return passed;
  } catch (error: any) {
    addResult('Verify claimsDetected Count', false, error.message);
    return false;
  }
}

async function test7_CheckPythonAPILogs(syncId: string): Promise<void> {
  log('Test 7: Summary - What to Check in Render Logs');
  
  console.log(`
📝 To verify Python API calls, check Render logs for:
   1. [AGENT 2] Calling Discovery Agent API
   2. [AGENT 2] Python API health check: {...}
   3. [AGENT 2] Discovery Agent API call attempt 1/3
   4. [AGENT 2] Discovery Agent API response received (if successful)
   5. [AGENT 2] Discovery Agent API failed (if failed, will retry)
   
   Search for: "[AGENT 2]" or "Discovery Agent"
   Sync ID: ${syncId}
   User ID: ${TEST_USER_ID}
  `);
}

async function runE2ETest() {
  console.log('\n🚀 Starting End-to-End Claims Detection Test\n');
  console.log(`Test User ID: ${TEST_USER_ID}`);
  console.log(`Node API: ${NODE_API_URL}`);
  console.log(`Supabase: ${SUPABASE_URL}\n`);
  
  let syncId: string | null = null;
  
  try {
    // Test 1: Start sync
    syncId = await test1_StartSync();
    
    // Test 2: Wait for completion
    const finalStatus = await test2_WaitForCompletion(syncId);
    
    // Test 3: Check detection queue
    await test3_CheckDetectionQueue(syncId);
    
    // Test 4: Check detection results
    const dbCount = await test4_CheckDetectionResults(syncId);
    
    // Test 5: Check sync progress
    await test5_CheckSyncProgress(syncId);
    
    // Test 6: Verify counts match
    await test6_VerifyClaimsDetectedCount(syncId, dbCount);
    
    // Test 7: Log checking instructions
    await test7_CheckPythonAPILogs(syncId);
    
  } catch (error: any) {
    console.error('\n❌ Test suite failed:', error.message);
    if (syncId) {
      console.log(`\nSync ID: ${syncId} - Check logs for details`);
    }
  }
  
  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    if (result.details && !result.passed) {
      console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
    }
  });
  
  console.log('\n' + '='.repeat(80));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('='.repeat(80) + '\n');
  
  if (failed === 0) {
    console.log('✅ All tests passed! Claims detection pipeline is working correctly.\n');
  } else {
    console.log('❌ Some tests failed. Review the errors above.\n');
    process.exit(1);
  }
}

// Run the test
runE2ETest().catch(console.error);


















