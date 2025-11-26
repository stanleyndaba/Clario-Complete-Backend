/**
 * Comprehensive Test Suite: Agents 1-3
 * 
 * This script tests the complete Agent 1-3 pipeline:
 * - Agent 1: Zero Agent Layer (OAuth Connection)
 * - Agent 2: Data Sync Agent (Fetch & Normalize Data)
 * - Agent 3: Claim Detection Agent (Discovery/ML Detection)
 * 
 * Run with: npm run test:agents-1-3
 * Or: npx ts-node scripts/test-agents-1-3-comprehensive.ts
 */

import 'dotenv/config';
import axios, { AxiosError } from 'axios';

// Configuration
const NODE_API_URL = process.env.INTEGRATIONS_URL || 
                     process.env.LOCAL_NODE_API_URL || 
                     'http://localhost:3001';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const TIMEOUT_FIRST_REQUEST = 90000; // 90s for first request (Render wake-up)
const TIMEOUT_NORMAL = 30000; // 30s for normal requests
const TIMEOUT_SYNC = 120000; // 2 minutes for sync to complete

interface TestResult {
  name: string;
  agent: number;
  passed: boolean;
  error?: string;
  data?: any;
  duration?: number;
}

const results: TestResult[] = [];
// Use 'demo-user' which is allowed in sandbox/dev mode, or a valid UUID for production
let testUserId = process.env.TEST_USER_ID || 'demo-user';
let testSyncId = '';

// Utility function for colored console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message: string, color?: keyof typeof colors) {
  const prefix = color ? colors[color] : '';
  const suffix = color ? colors.reset : '';
  console.log(`${prefix}${message}${suffix}`);
}

function logSection(title: string) {
  console.log('\n' + '═'.repeat(60));
  log(`  ${title}`, 'cyan');
  console.log('═'.repeat(60));
}

function logStep(step: string) {
  log(`\n📋 ${step}`, 'blue');
}

// HTTP request helper with detailed error logging
async function request(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: {
    data?: any;
    timeout?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  const url = `${NODE_API_URL}${path}`;
  const timeout = options.timeout || TIMEOUT_NORMAL;
  
  try {
    const response = await axios({
      method,
      url,
      data: options.data,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': testUserId,
        ...options.headers,
      },
      timeout,
      validateStatus: () => true, // Don't throw on HTTP errors
    });
    
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: response.data,
      error: response.status >= 400 ? (response.data?.error || response.data?.message || `HTTP ${response.status}`) : undefined,
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    let errorMessage = 'Unknown error';
    
    if (axiosError.code === 'ECONNREFUSED') {
      errorMessage = `Connection refused - Backend not running at ${NODE_API_URL}`;
    } else if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {
      errorMessage = `Request timed out after ${timeout}ms`;
    } else if (axiosError.message) {
      errorMessage = axiosError.message;
    }
    
    return {
      ok: false,
      status: 0,
      error: errorMessage,
    };
  }
}

// Test execution helper
async function runTest(
  name: string,
  agent: number,
  testFn: () => Promise<{ passed: boolean; error?: string; data?: any }>
): Promise<boolean> {
  const startTime = Date.now();
  logStep(`Testing: ${name}`);
  
  try {
    const result = await testFn();
    const duration = Date.now() - startTime;
    
    results.push({
      name,
      agent,
      passed: result.passed,
      error: result.error,
      data: result.data,
      duration,
    });
    
    if (result.passed) {
      log(`   ✅ PASSED (${duration}ms)`, 'green');
      if (result.data) {
        const preview = JSON.stringify(result.data, null, 2).split('\n').slice(0, 5).join('\n');
        log(`   ${preview}`, 'dim');
      }
    } else {
      log(`   ❌ FAILED (${duration}ms)`, 'red');
      log(`   Error: ${result.error}`, 'red');
    }
    
    return result.passed;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    results.push({
      name,
      agent,
      passed: false,
      error: error.message,
      duration,
    });
    log(`   ❌ EXCEPTION (${duration}ms): ${error.message}`, 'red');
    return false;
  }
}

// ============================================================================
// AGENT 1 TESTS: Zero Agent Layer (OAuth/Connection)
// ============================================================================

async function testAgent1_HealthCheck(): Promise<boolean> {
  return runTest('Backend Health Check', 1, async () => {
    const response = await request('GET', '/health', { timeout: TIMEOUT_FIRST_REQUEST });
    return {
      passed: response.ok && (response.data?.status === 'ok' || response.data?.healthy === true),
      error: response.error,
      data: response.data,
    };
  });
}

async function testAgent1_ConnectionStatus(): Promise<boolean> {
  return runTest('Get Amazon Connection Status', 1, async () => {
    const response = await request('GET', '/api/v1/integrations/amazon/status');
    return {
      passed: response.ok,
      error: response.error,
      data: response.data,
    };
  });
}

async function testAgent1_IntegrationsStatus(): Promise<boolean> {
  return runTest('Get Integrations Status (All Providers)', 1, async () => {
    const response = await request('GET', '/api/v1/integrations/status');
    return {
      passed: response.ok,
      error: response.error,
      data: response.data,
    };
  });
}

async function testAgent1_BypassOAuth(): Promise<boolean> {
  return runTest('Bypass OAuth (Use Existing Connection)', 1, async () => {
    const response = await request('GET', `/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=${encodeURIComponent(FRONTEND_URL)}`, {
      timeout: TIMEOUT_FIRST_REQUEST,
    });
    
    // Bypass is successful if:
    // 1. Response is OK with bypassed=true
    // 2. OR we get an authUrl (fallback to OAuth flow)
    const bypassed = response.data?.bypassed === true;
    const hasAuthUrl = !!(response.data?.authUrl || response.data?.auth_url);
    
    return {
      passed: response.ok && (bypassed || hasAuthUrl),
      error: response.error,
      data: {
        bypassed,
        hasAuthUrl,
        sandboxMode: response.data?.sandboxMode,
        connectionVerified: response.data?.connectionVerified,
        message: response.data?.message,
      },
    };
  });
}

async function testAgent1_OAuthStart(): Promise<boolean> {
  return runTest('Start OAuth Flow (Get Auth URL)', 1, async () => {
    const response = await request('GET', `/api/v1/integrations/amazon/auth/start?frontend_url=${encodeURIComponent(FRONTEND_URL)}`);
    
    const authUrl = response.data?.authUrl || response.data?.auth_url;
    
    return {
      passed: response.ok && !!authUrl,
      error: response.error || (!authUrl ? 'No auth URL returned' : undefined),
      data: {
        hasAuthUrl: !!authUrl,
        authUrlLength: authUrl?.length,
        state: response.data?.state,
      },
    };
  });
}

// ============================================================================
// AGENT 2 TESTS: Data Sync Agent
// ============================================================================

async function testAgent2_TriggerSync(): Promise<boolean> {
  return runTest('Trigger Data Sync', 2, async () => {
    const response = await request('POST', '/api/sync/start', { data: {} });
    
    // Handle both success and "sync already in progress"
    if (response.status === 409) {
      // Sync already in progress is acceptable
      testSyncId = response.data?.existingSyncId || '';
      return {
        passed: true,
        data: {
          alreadyInProgress: true,
          existingSyncId: testSyncId,
          message: response.data?.message,
        },
      };
    }
    
    testSyncId = response.data?.syncId || response.data?.sync_id || '';
    
    return {
      passed: response.ok && !!testSyncId,
      error: response.error || (!testSyncId ? 'No syncId returned' : undefined),
      data: {
        syncId: testSyncId,
        status: response.data?.status,
        message: response.data?.message,
      },
    };
  });
}

async function testAgent2_GetSyncStatus(): Promise<boolean> {
  return runTest('Get Sync Status (Active)', 2, async () => {
    const response = await request('GET', '/api/sync/status');
    
    return {
      passed: response.ok,
      error: response.error,
      data: {
        status: response.data?.status,
        progress: response.data?.progress,
        syncId: response.data?.syncId,
      },
    };
  });
}

async function testAgent2_WaitForSyncComplete(): Promise<boolean> {
  if (!testSyncId) {
    return runTest('Wait for Sync Complete', 2, async () => ({
      passed: false,
      error: 'No sync ID available - previous test failed',
    }));
  }
  
  return runTest('Wait for Sync Complete', 2, async () => {
    const startTime = Date.now();
    const pollInterval = 3000; // Poll every 3 seconds
    
    while (Date.now() - startTime < TIMEOUT_SYNC) {
      const response = await request('GET', `/api/sync/status/${testSyncId}`);
      
      if (!response.ok) {
        return { passed: false, error: response.error };
      }
      
      const status = response.data?.status;
      const progress = response.data?.progress || 0;
      
      log(`   ... Status: ${status}, Progress: ${progress}%`, 'dim');
      
      if (status === 'completed') {
        return {
          passed: true,
          data: {
            status,
            progress,
            ordersProcessed: response.data?.ordersProcessed,
            totalOrders: response.data?.totalOrders,
            inventoryCount: response.data?.inventoryCount,
            shipmentsCount: response.data?.shipmentsCount,
            returnsCount: response.data?.returnsCount,
            settlementsCount: response.data?.settlementsCount,
            claimsDetected: response.data?.claimsDetected,
            duration: `${Math.round((Date.now() - startTime) / 1000)}s`,
          },
        };
      }
      
      if (status === 'failed' || status === 'cancelled') {
        return {
          passed: false,
          error: `Sync ${status}: ${response.data?.message || 'Unknown error'}`,
          data: response.data,
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    return {
      passed: false,
      error: `Sync did not complete within ${TIMEOUT_SYNC / 1000}s`,
    };
  });
}

async function testAgent2_VerifySyncData(): Promise<boolean> {
  if (!testSyncId) {
    return runTest('Verify Sync Data', 2, async () => ({
      passed: false,
      error: 'No sync ID available - previous test failed',
    }));
  }
  
  return runTest('Verify Sync Data', 2, async () => {
    const response = await request('GET', `/api/sync/status/${testSyncId}`);
    
    if (!response.ok) {
      return { passed: false, error: response.error };
    }
    
    // Check that we have some data
    const data = response.data;
    const hasData = (data?.ordersProcessed || 0) > 0 ||
                   (data?.inventoryCount || 0) > 0 ||
                   (data?.shipmentsCount || 0) > 0 ||
                   (data?.returnsCount || 0) > 0;
    
    return {
      passed: data?.status === 'completed' && hasData,
      error: !hasData ? 'No data was synced (all counts are 0)' : undefined,
      data: {
        ordersProcessed: data?.ordersProcessed || 0,
        inventoryCount: data?.inventoryCount || 0,
        shipmentsCount: data?.shipmentsCount || 0,
        returnsCount: data?.returnsCount || 0,
        settlementsCount: data?.settlementsCount || 0,
        claimsDetected: data?.claimsDetected || 0,
      },
    };
  });
}

async function testAgent2_GetSyncHistory(): Promise<boolean> {
  return runTest('Get Sync History', 2, async () => {
    const response = await request('GET', '/api/sync/history?limit=5');
    
    return {
      passed: response.ok,
      error: response.error,
      data: {
        syncsCount: response.data?.syncs?.length || 0,
        total: response.data?.total,
      },
    };
  });
}

// ============================================================================
// AGENT 3 TESTS: Claim Detection Agent
// ============================================================================

async function testAgent3_GetDetectionResults(): Promise<boolean> {
  return runTest('Get Detection Results', 3, async () => {
    const response = await request('GET', '/api/detections/results?limit=20');
    
    return {
      passed: response.ok,
      error: response.error,
      data: {
        resultsCount: response.data?.results?.length || 0,
        total: response.data?.total,
        sample: response.data?.results?.[0] ? {
          anomaly_type: response.data.results[0].anomaly_type,
          confidence_score: response.data.results[0].confidence_score,
          estimated_value: response.data.results[0].estimated_value,
        } : null,
      },
    };
  });
}

async function testAgent3_GetDetectionStatistics(): Promise<boolean> {
  return runTest('Get Detection Statistics', 3, async () => {
    const response = await request('GET', '/api/detections/statistics');
    
    return {
      passed: response.ok,
      error: response.error,
      data: response.data?.statistics,
    };
  });
}

async function testAgent3_GetConfidenceDistribution(): Promise<boolean> {
  return runTest('Get Confidence Distribution', 3, async () => {
    const response = await request('GET', '/api/detections/confidence-distribution');
    
    return {
      passed: response.ok,
      error: response.error,
      data: response.data?.distribution,
    };
  });
}

async function testAgent3_GetClaimsApproachingDeadline(): Promise<boolean> {
  return runTest('Get Claims Approaching Deadline', 3, async () => {
    const response = await request('GET', '/api/detections/deadlines?days=30');
    
    return {
      passed: response.ok,
      error: response.error,
      data: {
        claimsCount: response.data?.claims?.length || 0,
        count: response.data?.count,
        thresholdDays: response.data?.threshold_days,
      },
    };
  });
}

async function testAgent3_TriggerDetection(): Promise<boolean> {
  return runTest('Trigger Claim Detection', 3, async () => {
    const response = await request('POST', '/api/detections/run', {
      data: testSyncId ? { syncId: testSyncId } : {},
    });
    
    return {
      passed: response.ok,
      error: response.error,
      data: {
        detectionId: response.data?.detectionId || response.data?.detection_id,
        message: response.data?.message,
      },
    };
  });
}

// ============================================================================
// FRONTEND API COMPATIBILITY TESTS
// ============================================================================

async function testFrontendAPI_GetAmazonClaims(): Promise<boolean> {
  return runTest('[FE] Get Amazon Claims', 1, async () => {
    const response = await request('GET', '/api/v1/integrations/amazon/claims');
    
    return {
      passed: response.ok,
      error: response.error,
      data: {
        claimsCount: response.data?.claims?.length || 0,
        isMock: response.data?.isMock,
        mockScenario: response.data?.mockScenario,
      },
    };
  });
}

async function testFrontendAPI_GetAmazonRecoveries(): Promise<boolean> {
  return runTest('[FE] Get Amazon Recoveries', 1, async () => {
    const response = await request('GET', '/api/v1/integrations/amazon/recoveries');
    
    return {
      passed: response.ok,
      error: response.error,
      data: {
        totalAmount: response.data?.totalAmount,
        currency: response.data?.currency,
        claimCount: response.data?.claimCount,
        source: response.data?.source,
      },
    };
  });
}

async function testFrontendAPI_GetAmazonInventory(): Promise<boolean> {
  return runTest('[FE] Get Amazon Inventory', 1, async () => {
    const response = await request('GET', '/api/v1/integrations/amazon/inventory');
    
    return {
      passed: response.ok,
      error: response.error,
      data: {
        inventoryCount: response.data?.inventory?.length || 0,
        isMock: response.data?.isMock,
      },
    };
  });
}

// ============================================================================
// SUMMARY
// ============================================================================

function printSummary() {
  logSection('TEST SUMMARY');
  
  const byAgent: Record<number, TestResult[]> = {};
  results.forEach(r => {
    if (!byAgent[r.agent]) byAgent[r.agent] = [];
    byAgent[r.agent].push(r);
  });
  
  const agentNames: Record<number, string> = {
    1: 'Agent 1: Zero Agent Layer (OAuth)',
    2: 'Agent 2: Data Sync Agent',
    3: 'Agent 3: Claim Detection Agent',
  };
  
  let totalPassed = 0;
  let totalFailed = 0;
  let totalDuration = 0;
  
  for (const agent of [1, 2, 3]) {
    const agentResults = byAgent[agent] || [];
    if (agentResults.length === 0) continue;
    
    const passed = agentResults.filter(r => r.passed).length;
    const failed = agentResults.filter(r => !r.passed).length;
    const duration = agentResults.reduce((sum, r) => sum + (r.duration || 0), 0);
    
    totalPassed += passed;
    totalFailed += failed;
    totalDuration += duration;
    
    console.log('');
    log(`${agentNames[agent]}`, 'cyan');
    
    for (const result of agentResults) {
      const icon = result.passed ? '✅' : '❌';
      const durationStr = result.duration ? ` (${result.duration}ms)` : '';
      console.log(`   ${icon} ${result.name}${durationStr}`);
      if (!result.passed && result.error) {
        log(`      └─ ${result.error}`, 'red');
      }
    }
    
    log(`   ${passed}/${agentResults.length} passed`, passed === agentResults.length ? 'green' : 'yellow');
  }
  
  console.log('\n' + '═'.repeat(60));
  const overallPassed = totalFailed === 0;
  log(`TOTAL: ${results.length} tests | ${totalPassed} passed | ${totalFailed} failed`, overallPassed ? 'green' : 'red');
  log(`Duration: ${(totalDuration / 1000).toFixed(1)}s`, 'dim');
  console.log('═'.repeat(60));
  
  if (totalFailed > 0) {
    console.log('\n⚠️  Some tests failed. Possible causes:');
    console.log('   - Backend not running or sleeping (Render free tier)');
    console.log('   - Missing environment variables');
    console.log('   - Database connection issues');
    console.log('   - No Amazon connection/mock data');
    console.log('\n💡 Tips:');
    console.log('   - Set USE_MOCK_DATA_GENERATOR=true for testing without real Amazon');
    console.log('   - Check backend logs for detailed errors');
    console.log('   - Ensure .env file has all required variables');
  }
  
  return overallPassed;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('');
  logSection('COMPREHENSIVE AGENT 1-3 TEST SUITE');
  console.log('');
  log(`Backend URL: ${NODE_API_URL}`, 'dim');
  log(`Frontend URL: ${FRONTEND_URL}`, 'dim');
  log(`Started at: ${new Date().toISOString()}`, 'dim');
  console.log('');
  log('⚠️  Note: First request may take 30-90s if Render backend is sleeping', 'yellow');
  
  // AGENT 1 Tests
  logSection('AGENT 1: ZERO AGENT LAYER (OAuth/Connection)');
  
  const healthOk = await testAgent1_HealthCheck();
  if (!healthOk) {
    log('\n❌ Backend health check failed - aborting tests', 'red');
    log('   Make sure the backend is running at: ' + NODE_API_URL, 'yellow');
    printSummary();
    process.exit(1);
  }
  
  await testAgent1_ConnectionStatus();
  await testAgent1_IntegrationsStatus();
  await testAgent1_BypassOAuth();
  await testAgent1_OAuthStart();
  
  // Frontend API compatibility tests
  logSection('FRONTEND API COMPATIBILITY');
  await testFrontendAPI_GetAmazonClaims();
  await testFrontendAPI_GetAmazonRecoveries();
  await testFrontendAPI_GetAmazonInventory();
  
  // AGENT 2 Tests
  logSection('AGENT 2: DATA SYNC AGENT');
  
  await testAgent2_TriggerSync();
  await testAgent2_GetSyncStatus();
  await testAgent2_WaitForSyncComplete();
  await testAgent2_VerifySyncData();
  await testAgent2_GetSyncHistory();
  
  // AGENT 3 Tests
  logSection('AGENT 3: CLAIM DETECTION AGENT');
  
  await testAgent3_TriggerDetection();
  
  // Wait a bit for detection to process
  log('\n⏳ Waiting 5 seconds for detection to process...', 'dim');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  await testAgent3_GetDetectionResults();
  await testAgent3_GetDetectionStatistics();
  await testAgent3_GetConfidenceDistribution();
  await testAgent3_GetClaimsApproachingDeadline();
  
  // Print summary
  const allPassed = printSummary();
  process.exit(allPassed ? 0 : 1);
}

main().catch(error => {
  console.error('❌ Test runner crashed:', error);
  process.exit(1);
});

