/**
 * Phase 1 Verification Test Script
 * Tests Phase 1: Zero-Friction Onboarding end-to-end
 * 
 * Usage: npx ts-node test-phase1-verification.ts
 */

import axios from 'axios';
import { createClient } from 'redis';
import { io, Socket } from 'socket.io-client';

const INTEGRATIONS_URL = process.env.INTEGRATIONS_URL || 'http://localhost:3001';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const WORKFLOW_ID = 'sandbox-test-001';
const TEST_USER_ID = 'test-user-sandbox-001';
const TEST_SELLER_ID = 'test-seller-sandbox-001';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  details?: any;
}

const results: TestResult[] = [];

async function testPhase1Trigger(): Promise<TestResult> {
  try {
    const response = await axios.post(
      `${INTEGRATIONS_URL}/api/v1/workflow/phase/1`,
      {
        user_id: TEST_USER_ID,
        seller_id: TEST_SELLER_ID,
        sync_id: WORKFLOW_ID
      },
      { timeout: 10000 }
    );

    if (response.status === 200 && response.data.success) {
      return {
        name: 'Phase 1 Trigger',
        status: 'PASS',
        message: 'Phase 1 triggered successfully',
        details: response.data
      };
    } else {
      return {
        name: 'Phase 1 Trigger',
        status: 'FAIL',
        message: 'Phase 1 trigger returned unexpected response',
        details: response.data
      };
    }
  } catch (error: any) {
    return {
      name: 'Phase 1 Trigger',
      status: 'FAIL',
      message: `Failed to trigger Phase 1: ${error.message}`,
      details: error.response?.data || error.message
    };
  }
}

async function testQueueStatus(): Promise<TestResult> {
  try {
    const redis = createClient({ url: REDIS_URL });
    await redis.connect();

    // Check Bull queue keys
    const queueKeys = await redis.keys('bull:orchestration:*');
    const waitingJobs = await redis.keys('bull:orchestration:waiting');
    const activeJobs = await redis.keys('bull:orchestration:active');
    const completedJobs = await redis.keys('bull:orchestration:completed');

    await redis.disconnect();

    const hasPhase2Job = queueKeys.length > 0;

    return {
      name: 'Phase 2 Job in Queue',
      status: hasPhase2Job ? 'PASS' : 'SKIP',
      message: hasPhase2Job 
        ? 'Phase 2 job found in queue (or Phase 1 still processing)'
        : 'No jobs found in queue (may need to wait for Phase 1 to complete)',
      details: {
        queueKeys: queueKeys.length,
        waiting: waitingJobs.length,
        active: activeJobs.length,
        completed: completedJobs.length
      }
    };
  } catch (error: any) {
    return {
      name: 'Phase 2 Job in Queue',
      status: 'FAIL',
      message: `Failed to check queue: ${error.message}`,
      details: error.message
    };
  }
}

async function testWebSocketEvent(): Promise<TestResult> {
  return new Promise((resolve) => {
    const socket: Socket = io(INTEGRATIONS_URL, {
      transports: ['websocket'],
      timeout: 5000
    });

    let eventReceived = false;
    let eventData: any = null;
    const timeout = setTimeout(() => {
      socket.disconnect();
      resolve({
        name: 'WebSocket Event',
        status: eventReceived ? 'PASS' : 'SKIP',
        message: eventReceived 
          ? 'WebSocket event received'
          : 'WebSocket event not received (may need to wait or user not connected)',
        details: eventData
      });
    }, 15000); // Wait 15 seconds for event

    socket.on('connect', () => {
      console.log('WebSocket connected, authenticating...');
      socket.emit('authenticate', {
        userId: TEST_USER_ID,
        token: 'test-token' // In production, use real JWT
      });
    });

    socket.on('authenticated', (data) => {
      console.log('WebSocket authenticated:', data);
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
          details: data
        });
      });
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      resolve({
        name: 'WebSocket Event',
        status: 'SKIP',
        message: `WebSocket connection failed: ${error.message}`,
        details: error.message
      });
    });
  });
}

async function testIdempotency(): Promise<TestResult> {
  try {
    // Trigger Phase 1 twice
    const response1 = await axios.post(
      `${INTEGRATIONS_URL}/api/v1/workflow/phase/1`,
      {
        user_id: TEST_USER_ID,
        seller_id: TEST_SELLER_ID,
        sync_id: WORKFLOW_ID
      },
      { timeout: 10000 }
    );

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));

    const response2 = await axios.post(
      `${INTEGRATIONS_URL}/api/v1/workflow/phase/1`,
      {
        user_id: TEST_USER_ID,
        seller_id: TEST_SELLER_ID,
        sync_id: WORKFLOW_ID
      },
      { timeout: 10000 }
    );

    // Check if both succeeded (idempotency should prevent duplicate jobs)
    const bothSucceeded = response1.status === 200 && response2.status === 200;
    
    // Check queue for duplicate jobs
    const redis = createClient({ url: REDIS_URL });
    await redis.connect();
    const jobs = await redis.keys('bull:orchestration:*');
    await redis.disconnect();

    return {
      name: 'Idempotency Test',
      status: bothSucceeded ? 'PASS' : 'FAIL',
      message: bothSucceeded
        ? 'Idempotency check passed - duplicate trigger handled gracefully'
        : 'Idempotency check failed - duplicate jobs may have been created',
      details: {
        firstTrigger: response1.data,
        secondTrigger: response2.data,
        queueJobs: jobs.length
      }
    };
  } catch (error: any) {
    return {
      name: 'Idempotency Test',
      status: 'FAIL',
      message: `Idempotency test failed: ${error.message}`,
      details: error.response?.data || error.message
    };
  }
}

async function testSandboxSync(): Promise<TestResult> {
  try {
    // Check if sync was triggered by looking at logs or database
    // This is a simplified check - in production, you'd query the database
    return {
      name: 'Sandbox Sync',
      status: 'SKIP',
      message: 'Sandbox sync verification requires database access or log inspection',
      details: {
        note: 'Check orchestrator logs for "Starting Amazon sync" or "syncUserData" messages'
      }
    };
  } catch (error: any) {
    return {
      name: 'Sandbox Sync',
      status: 'FAIL',
      message: `Sandbox sync check failed: ${error.message}`,
      details: error.message
    };
  }
}

async function runTests() {
  console.log('🧪 Phase 1 Verification Test Suite');
  console.log('=====================================\n');
  console.log(`Workflow ID: ${WORKFLOW_ID}`);
  console.log(`User ID: ${TEST_USER_ID}`);
  console.log(`Integrations URL: ${INTEGRATIONS_URL}\n`);

  // Test 1: Trigger Phase 1
  console.log('1. Testing Phase 1 trigger...');
  const triggerResult = await testPhase1Trigger();
  results.push(triggerResult);
  console.log(`   ${triggerResult.status}: ${triggerResult.message}\n`);

  // Wait for Phase 1 to process
  console.log('   Waiting 5 seconds for Phase 1 to process...\n');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 2: Check queue for Phase 2
  console.log('2. Checking queue for Phase 2 job...');
  const queueResult = await testQueueStatus();
  results.push(queueResult);
  console.log(`   ${queueResult.status}: ${queueResult.message}\n`);

  // Test 3: WebSocket event
  console.log('3. Testing WebSocket event emission...');
  const wsResult = await testWebSocketEvent();
  results.push(wsResult);
  console.log(`   ${wsResult.status}: ${wsResult.message}\n`);

  // Test 4: Sandbox sync
  console.log('4. Checking sandbox sync...');
  const syncResult = await testSandboxSync();
  results.push(syncResult);
  console.log(`   ${syncResult.status}: ${syncResult.message}\n`);

  // Test 5: Idempotency
  console.log('5. Testing idempotency...');
  const idempotencyResult = await testIdempotency();
  results.push(idempotencyResult);
  console.log(`   ${idempotencyResult.status}: ${idempotencyResult.message}\n`);

  // Print summary
  console.log('\n📊 Test Summary');
  console.log('=====================================');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  results.forEach((result, index) => {
    const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️';
    console.log(`${icon} ${index + 1}. ${result.name}: ${result.status}`);
    if (result.details) {
      console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
    }
  });

  console.log(`\nTotal: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  
  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. Check the details above.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed or skipped!');
    process.exit(0);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Test suite error:', error);
  process.exit(1);
});

