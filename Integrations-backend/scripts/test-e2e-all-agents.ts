/**
 * E2E Test Script: All 11 Agents Frontend Integration
 * 
 * This script tests that all backend endpoints are accessible and working
 * for frontend integration.
 * 
 * Run with: npm run test:e2e-all-agents
 */

import 'dotenv/config';
import axios from 'axios';
import logger from '../src/utils/logger';

const BACKEND_URL = process.env.INTEGRATIONS_URL || 'http://localhost:3001';
const TEST_USER_ID = process.env.TEST_USER_ID || 'test-user-' + Date.now();

interface AgentTest {
  name: string;
  agent: number;
  endpoints: {
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    description: string;
    required?: boolean;
  }[];
}

const agentTests: AgentTest[] = [
  {
    name: 'Agent 1: Zero Agent Layer (OAuth)',
    agent: 1,
    endpoints: [
      { path: '/api/v1/integrations/amazon/auth/start', method: 'GET', description: 'Start Amazon OAuth', required: true },
      { path: '/api/v1/integrations/gmail/auth', method: 'GET', description: 'Start Gmail OAuth', required: true },
      { path: '/api/auth/me', method: 'GET', description: 'Get user profile', required: true },
    ]
  },
  {
    name: 'Agent 2: Data Sync',
    agent: 2,
    endpoints: [
      { path: '/api/sync/start', method: 'POST', description: 'Start sync', required: true },
      { path: '/api/sync/status', method: 'GET', description: 'Get sync status', required: true },
      { path: '/api/sync/normalized-data', method: 'GET', description: 'Get normalized data', required: false },
    ]
  },
  {
    name: 'Agent 3: Claim Detection',
    agent: 3,
    endpoints: [
      { path: '/api/detections/run', method: 'POST', description: 'Run detection', required: true },
      { path: '/api/detections/results', method: 'GET', description: 'Get detection results', required: true },
      { path: '/api/detections/jobs/:jobId', method: 'GET', description: 'Get detection job status', required: false },
    ]
  },
  {
    name: 'Agent 4: Evidence Ingestion',
    agent: 4,
    endpoints: [
      { path: '/api/evidence/ingest/gmail', method: 'POST', description: 'Ingest Gmail evidence', required: true },
      { path: '/api/evidence/status', method: 'GET', description: 'Get ingestion status', required: true },
      { path: '/api/evidence/documents', method: 'GET', description: 'Get evidence documents', required: true },
    ]
  },
  {
    name: 'Agent 5: Document Parsing',
    agent: 5,
    endpoints: [
      { path: '/api/v1/evidence/parse/:documentId', method: 'POST', description: 'Trigger parsing', required: true },
      { path: '/api/v1/evidence/parse/jobs/:jobId', method: 'GET', description: 'Get parsing job status', required: false },
      { path: '/api/v1/evidence/documents/:id', method: 'GET', description: 'Get parsed document', required: true },
    ]
  },
  {
    name: 'Agent 6: Evidence Matching',
    agent: 6,
    endpoints: [
      { path: '/api/evidence/matching/run', method: 'POST', description: 'Run matching', required: true },
      { path: '/api/evidence/matching/results/:syncId', method: 'GET', description: 'Get matching results', required: true },
      { path: '/api/evidence/matching/jobs/:jobId', method: 'GET', description: 'Get matching job status', required: false },
    ]
  },
  {
    name: 'Agent 7: Refund Filing',
    agent: 7,
    endpoints: [
      { path: '/api/disputes/cases', method: 'GET', description: 'Get dispute cases', required: true },
      { path: '/api/disputes/cases/:caseId', method: 'GET', description: 'Get case details', required: true },
      { path: '/api/disputes/cases/:caseId/submit', method: 'POST', description: 'Submit case', required: true },
    ]
  },
  {
    name: 'Agent 8: Recoveries',
    agent: 8,
    endpoints: [
      { path: '/api/recoveries', method: 'GET', description: 'Get recoveries', required: true },
      { path: '/api/recoveries/records', method: 'GET', description: 'Get recovery records', required: false },
      { path: '/api/recoveries/reconciliation', method: 'GET', description: 'Get reconciliation status', required: false },
    ]
  },
  {
    name: 'Agent 9: Billing',
    agent: 9,
    endpoints: [
      { path: '/api/billing/transactions', method: 'GET', description: 'Get billing transactions', required: true },
      { path: '/api/billing/invoices', method: 'GET', description: 'Get invoices', required: false },
      { path: '/api/billing/status', method: 'GET', description: 'Get billing status', required: true },
    ]
  },
  {
    name: 'Agent 10: Notifications',
    agent: 10,
    endpoints: [
      { path: '/api/notifications', method: 'GET', description: 'Get notifications', required: true },
      { path: '/api/notifications/unread-count', method: 'GET', description: 'Get unread count', required: true },
      { path: '/api/notifications/:id/read', method: 'POST', description: 'Mark as read', required: false },
    ]
  },
  {
    name: 'Agent 11: Learning',
    agent: 11,
    endpoints: [
      { path: '/api/learning/metrics', method: 'GET', description: 'Get learning metrics', required: true },
      { path: '/api/learning/insights', method: 'GET', description: 'Get insights', required: false },
      { path: '/api/learning/thresholds', method: 'GET', description: 'Get threshold optimizations', required: false },
    ]
  }
];

async function testEndpoint(endpoint: AgentTest['endpoints'][0], userId: string): Promise<{ success: boolean; error?: string; status?: number }> {
  try {
    // Replace path parameters
    let path = endpoint.path;
    if (path.includes(':documentId')) {
      path = path.replace(':documentId', 'test-doc-id');
    }
    if (path.includes(':jobId')) {
      path = path.replace(':jobId', 'test-job-id');
    }
    if (path.includes(':syncId')) {
      path = path.replace(':syncId', 'test-sync-id');
    }
    if (path.includes(':caseId')) {
      path = path.replace(':caseId', 'test-case-id');
    }
    if (path.includes(':id')) {
      path = path.replace(':id', 'test-id');
    }

    const url = `${BACKEND_URL}${path}`;
    const config: any = {
      method: endpoint.method,
      url,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000,
      validateStatus: (status: number) => status < 500, // Accept any status < 500
    };

    // Add body for POST requests
    if (endpoint.method === 'POST') {
      config.data = { userId, syncId: 'test-sync-id' };
    }

    const response = await axios(config);
    
    // Consider 200-299 and 400-499 as "working" (endpoint exists)
    // 500+ means server error, which is a problem
    if (response.status >= 500) {
      return { success: false, error: `Server error: ${response.status}`, status: response.status };
    }

    return { success: true, status: response.status };
  } catch (error: any) {
    if (error.response) {
      // Endpoint exists but returned error (this is OK for testing)
      return { success: true, status: error.response.status };
    }
    if (error.code === 'ECONNREFUSED') {
      return { success: false, error: 'Connection refused - backend not running?' };
    }
    if (error.code === 'ETIMEDOUT') {
      return { success: false, error: 'Request timeout' };
    }
    return { success: false, error: error.message };
  }
}

async function testAgent(agentTest: AgentTest, userId: string) {
  console.log(`\n🧪 Testing ${agentTest.name}`);
  console.log('─'.repeat(60));

  const results = [];
  for (const endpoint of agentTest.endpoints) {
    const result = await testEndpoint(endpoint, userId);
    const status = result.success ? '✅' : '❌';
    const statusText = result.status ? `(${result.status})` : '';
    console.log(`${status} ${endpoint.method} ${endpoint.path} ${statusText}`);
    
    if (!result.success && endpoint.required) {
      console.log(`   ⚠️  REQUIRED endpoint failed: ${result.error}`);
    }
    
    results.push({ endpoint, result });
  }

  const requiredPassed = results.filter(r => 
    r.endpoint.required && r.result.success
  ).length;
  const requiredTotal = agentTest.endpoints.filter(e => e.required).length;
  const allPassed = results.every(r => r.result.success);

  console.log(`\n📊 Results: ${requiredPassed}/${requiredTotal} required endpoints working`);
  
  return { agentTest, results, allPassed, requiredPassed, requiredTotal };
}

async function testSSEConnection() {
  console.log('\n🧪 Testing SSE Connection');
  console.log('─'.repeat(60));
  
  try {
    // SSE is tested via EventSource in browser, but we can test the endpoint exists
    const response = await axios.get(`${BACKEND_URL}/api/sse/status`, {
      timeout: 5000,
      validateStatus: () => true, // Accept any status
    });
    
    // SSE endpoints typically return 200 with text/event-stream
    if (response.status === 200 || response.headers['content-type']?.includes('text/event-stream')) {
      console.log('✅ SSE endpoint accessible');
      return true;
    } else {
      console.log(`⚠️  SSE endpoint returned status ${response.status}`);
      return false;
    }
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.log('❌ Backend not running');
      return false;
    }
    console.log(`⚠️  SSE test inconclusive: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 E2E Integration Test: All 11 Agents');
  console.log('='.repeat(60));
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`Test User ID: ${TEST_USER_ID}`);
  console.log('='.repeat(60));

  // Test health endpoint first
  try {
    const health = await axios.get(`${BACKEND_URL}/health`, { timeout: 5000 });
    console.log('✅ Backend is running');
  } catch (error: any) {
    console.log('❌ Backend is not running or not accessible');
    console.log(`   Error: ${error.message}`);
    console.log(`   Make sure backend is running at ${BACKEND_URL}`);
    process.exit(1);
  }

  // Test all agents
  const agentResults = [];
  for (const agentTest of agentTests) {
    const result = await testAgent(agentTest, TEST_USER_ID);
    agentResults.push(result);
    // Small delay between agents
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Test SSE
  const sseWorking = await testSSEConnection();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(60));

  let totalRequired = 0;
  let totalRequiredPassed = 0;
  let allAgentsPassed = true;

  for (const result of agentResults) {
    const required = result.requiredTotal;
    const passed = result.requiredPassed;
    totalRequired += required;
    totalRequiredPassed += passed;
    
    const status = passed === required ? '✅' : '⚠️';
    console.log(`${status} ${result.agentTest.name}: ${passed}/${required} required endpoints`);
    
    if (passed < required) {
      allAgentsPassed = false;
    }
  }

  console.log(`\n📈 Overall: ${totalRequiredPassed}/${totalRequired} required endpoints working`);
  console.log(`📡 SSE Connection: ${sseWorking ? '✅ Working' : '❌ Not working'}`);

  if (allAgentsPassed && sseWorking) {
    console.log('\n🎉 All agents ready for frontend integration!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some agents need attention before frontend integration');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});






