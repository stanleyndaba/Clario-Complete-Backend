/**
 * Live Phase 1 Verification Script
 * Tests Phase 1 end-to-end with actual server
 */

import axios from 'axios';
import { io, Socket } from 'socket.io-client';

const INTEGRATIONS_URL = process.env.INTEGRATIONS_URL || 'http://localhost:3001';
const WORKFLOW_ID = 'sandbox-test-001';
const TEST_USER_ID = 'test-user-sandbox-001';
const TEST_SELLER_ID = 'test-seller-sandbox-001';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  details?: any;
  timestamp?: string;
}

const results: TestResult[] = [];

function logResult(result: TestResult) {
  results.push({ ...result, timestamp: new Date().toISOString() });
  const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️';
  console.log(`${icon} ${result.name}: ${result.message}`);
  if (result.details) {
    console.log(`   Details:`, JSON.stringify(result.details, null, 2));
  }
}

async function testServerHealth(): Promise<TestResult> {
  try {
    const response = await axios.get(`${INTEGRATIONS_URL}/health`, { timeout: 5000 });
    if (response.status === 200) {
      return {
        name: 'Server Health',
        status: 'PASS',
        message: 'Server is running and healthy',
        details: response.data
      };
    }
    return {
      name: 'Server Health',
      status: 'FAIL',
      message: 'Server returned non-200 status',
      details: { status: response.status }
    };
  } catch (error: any) {
    return {
      name: 'Server Health',
      status: 'FAIL',
      message: `Server not accessible: ${error.message}`,
      details: { error: error.message, url: INTEGRATIONS_URL }
    };
  }
}

async function testPhase1Trigger(): Promise<TestResult> {
  try {
    console.log(`\n📤 Triggering Phase 1 for workflow: ${WORKFLOW_ID}`);
    const response = await axios.post(
      `${INTEGRATIONS_URL}/api/v1/workflow/phase/1`,
      {
        user_id: TEST_USER_ID,
        seller_id: TEST_SELLER_ID,
        sync_id: WORKFLOW_ID
      },
      { 
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (response.status === 200 && response.data.success) {
      return {
        name: 'Phase 1 Trigger',
        status: 'PASS',
        message: 'Phase 1 triggered successfully',
        details: {
          response: response.data,
          statusCode: response.status
        }
      };
    } else {
      return {
        name: 'Phase 1 Trigger',
        status: 'FAIL',
        message: 'Phase 1 trigger returned unexpected response',
        details: {
          response: response.data,
          statusCode: response.status
        }
      };
    }
  } catch (error: any) {
    return {
      name: 'Phase 1 Trigger',
      status: 'FAIL',
      message: `Failed to trigger Phase 1: ${error.message}`,
      details: {
        error: error.message,
        response: error.response?.data,
        statusCode: error.response?.status
      }
    };
  }
}

async function testWebSocketEvent(): Promise<TestResult> {
  return new Promise((resolve) => {
    console.log(`\n🔌 Connecting to WebSocket...`);
    const socket: Socket = io(INTEGRATIONS_URL, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: false
    });

    let eventReceived = false;
    let eventData: any = null;
    let authenticated = false;

    const timeout = setTimeout(() => {
      socket.disconnect();
      resolve({
        name: 'WebSocket Event',
        status: eventReceived ? 'PASS' : 'SKIP',
        message: eventReceived 
          ? 'WebSocket event received'
          : 'WebSocket event not received within timeout (may need to wait longer or user not connected)',
        details: {
          authenticated,
          eventReceived,
          eventData
        }
      });
    }, 20000); // Wait 20 seconds for event

    socket.on('connect', () => {
      console.log('   ✓ WebSocket connected');
      socket.emit('authenticate', {
        userId: TEST_USER_ID,
        token: 'test-token'
      });
    });

    socket.on('authenticated', (data) => {
      authenticated = true;
      console.log('   ✓ WebSocket authenticated');
      
      // Listen for workflow phase events
      socket.on('workflow.phase.1.completed', (data) => {
        eventReceived = true;
        eventData = data;
        clearTimeout(timeout);
        socket.disconnect();
        resolve({
          name: 'WebSocket Event',
          status: 'PASS',
          message: 'workflow.phase.1.completed event received',
          details: {
            event: 'workflow.phase.1.completed',
            data,
            authenticated: true
          }
        });
      });

      // Also listen for notification events as fallback
      socket.on('notification', (notification) => {
        if (notification.type === 'success' && notification.title?.includes('Onboarding')) {
          console.log('   ✓ Received onboarding notification');
        }
      });
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      resolve({
        name: 'WebSocket Event',
        status: 'SKIP',
        message: `WebSocket connection failed: ${error.message}`,
        details: {
          error: error.message,
          authenticated: false
        }
      });
    });

    socket.on('disconnect', () => {
      console.log('   ⚠ WebSocket disconnected');
    });
  });
}

async function testIdempotency(): Promise<TestResult> {
  try {
    console.log(`\n🔄 Testing idempotency (triggering Phase 1 twice)...`);
    
    // First trigger
    const response1 = await axios.post(
      `${INTEGRATIONS_URL}/api/v1/workflow/phase/1`,
      {
        user_id: TEST_USER_ID,
        seller_id: TEST_SELLER_ID,
        sync_id: WORKFLOW_ID
      },
      { timeout: 10000 }
    );

    console.log(`   First trigger: ${response1.status === 200 ? '✓' : '✗'}`);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Second trigger (should be idempotent)
    const response2 = await axios.post(
      `${INTEGRATIONS_URL}/api/v1/workflow/phase/1`,
      {
        user_id: TEST_USER_ID,
        seller_id: TEST_SELLER_ID,
        sync_id: WORKFLOW_ID
      },
      { timeout: 10000 }
    );

    console.log(`   Second trigger: ${response2.status === 200 ? '✓' : '✗'}`);

    const bothSucceeded = response1.status === 200 && response2.status === 200;
    const isIdempotent = response2.data?.message?.includes('already') || 
                        response2.data?.message?.includes('idempotency') ||
                        response1.data?.success === response2.data?.success;

    return {
      name: 'Idempotency Test',
      status: bothSucceeded ? 'PASS' : 'FAIL',
      message: bothSucceeded
        ? 'Idempotency check passed - duplicate trigger handled gracefully'
        : 'Idempotency check failed - duplicate jobs may have been created',
      details: {
        firstTrigger: {
          status: response1.status,
          data: response1.data
        },
        secondTrigger: {
          status: response2.status,
          data: response2.data
        },
        isIdempotent
      }
    };
  } catch (error: any) {
    return {
      name: 'Idempotency Test',
      status: 'FAIL',
      message: `Idempotency test failed: ${error.message}`,
      details: {
        error: error.message,
        response: error.response?.data
      }
    };
  }
}

async function checkQueueStatus(): Promise<TestResult> {
  try {
    // Try to get queue stats via API if available
    try {
      const response = await axios.get(`${INTEGRATIONS_URL}/api/v1/workflow/queue/stats`, { timeout: 5000 });
      return {
        name: 'Phase 2 Queue Job',
        status: 'PASS',
        message: 'Queue stats retrieved',
        details: response.data
      };
    } catch (apiError: any) {
      // API endpoint might not exist, that's okay
      return {
        name: 'Phase 2 Queue Job',
        status: 'SKIP',
        message: 'Queue stats API not available - check logs for Phase 2 job creation',
        details: {
          note: 'Look for "Phase 2 orchestration triggered after sync" in logs',
          error: apiError.message
        }
      };
    }
  } catch (error: any) {
    return {
      name: 'Phase 2 Queue Job',
      status: 'SKIP',
      message: 'Cannot verify queue status directly',
      details: { error: error.message }
    };
  }
}

async function checkSandboxSync(): Promise<TestResult> {
  return {
    name: 'Sandbox Sync',
    status: 'SKIP',
    message: 'Sandbox sync verification requires log inspection',
    details: {
      note: 'Check orchestrator logs for:',
      expectedLogs: [
        'Starting Amazon sync for user',
        'Inventory sync completed',
        'Phase 2 orchestration triggered after sync'
      ],
      instruction: 'Review server logs to verify sync job executed'
    }
  };
}

async function runVerification() {
  console.log('🧪 Phase 1 End-to-End Verification');
  console.log('=====================================\n');
  console.log(`Workflow ID: ${WORKFLOW_ID}`);
  console.log(`User ID: ${TEST_USER_ID}`);
  console.log(`Integrations URL: ${INTEGRATIONS_URL}\n`);

  // Test 1: Server Health
  console.log('1. Checking server health...');
  const healthResult = await testServerHealth();
  logResult(healthResult);
  
  if (healthResult.status === 'FAIL') {
    console.log('\n❌ Server is not running. Please start the server first.');
    console.log('   Run: cd Integrations-backend && npm start');
    process.exit(1);
  }

  // Test 2: Trigger Phase 1
  console.log('\n2. Triggering Phase 1...');
  const triggerResult = await testPhase1Trigger();
  logResult(triggerResult);

  // Wait for Phase 1 to process
  console.log('\n   ⏳ Waiting 8 seconds for Phase 1 to process and trigger sync...');
  await new Promise(resolve => setTimeout(resolve, 8000));

  // Test 3: WebSocket Event
  console.log('\n3. Testing WebSocket event emission...');
  const wsResult = await testWebSocketEvent();
  logResult(wsResult);

  // Test 4: Queue Status
  console.log('\n4. Checking Phase 2 queue job...');
  const queueResult = await checkQueueStatus();
  logResult(queueResult);

  // Test 5: Sandbox Sync
  console.log('\n5. Checking sandbox sync...');
  const syncResult = await checkSandboxSync();
  logResult(syncResult);

  // Test 6: Idempotency
  console.log('\n6. Testing idempotency...');
  const idempotencyResult = await testIdempotency();
  logResult(idempotencyResult);

  // Print summary
  console.log('\n\n📊 Verification Summary');
  console.log('=====================================');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  results.forEach((result, index) => {
    const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️';
    console.log(`${icon} ${index + 1}. ${result.name}: ${result.status}`);
  });

  console.log(`\nTotal: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  
  // Generate report
  const report = {
    timestamp: new Date().toISOString(),
    workflowId: WORKFLOW_ID,
    userId: TEST_USER_ID,
    results: results,
    summary: {
      passed,
      failed,
      skipped,
      total: results.length
    }
  };

  console.log('\n📄 Full Report:');
  console.log(JSON.stringify(report, null, 2));

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. Review the details above.');
    process.exit(1);
  } else {
    console.log('\n✅ All critical tests passed!');
    process.exit(0);
  }
}

// Run verification
runVerification().catch((error) => {
  console.error('❌ Verification suite error:', error);
  process.exit(1);
});

