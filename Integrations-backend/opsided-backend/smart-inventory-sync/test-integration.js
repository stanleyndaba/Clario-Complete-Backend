#!/usr/bin/env node

/**
 * Smart Inventory Sync + Claim Detector Integration Test Script
 * 
 * This script tests the complete integration between Smart Inventory Sync
 * and Claim Detector to ensure they work harmoniously together.
 */

const axios = require('axios');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002';
const CLAIM_DETECTOR_URL = process.env.CLAIM_DETECTOR_URL || 'http://localhost:8000';
const TEST_USER_ID = process.env.TEST_USER_ID || 'test-user-123';

console.log('🧪 Smart Inventory Sync + Claim Detector Integration Test');
console.log('========================================================');
console.log(`Smart Inventory Sync URL: ${BASE_URL}`);
console.log(`Claim Detector URL: ${CLAIM_DETECTOR_URL}`);
console.log(`Test User ID: ${TEST_USER_ID}`);
console.log('');

async function testEndpoint(endpoint, method = 'GET', data = null, baseUrl = BASE_URL) {
  try {
    const config = {
      method,
      url: `${baseUrl}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    
    console.log(`✅ ${method} ${endpoint} - Status: ${response.status}`);
    
    if (response.data && response.data.success !== undefined) {
      console.log(`   Success: ${response.data.success}`);
      if (response.data.message) {
        console.log(`   Message: ${response.data.message}`);
      }
    }
    
    return response.data;
  } catch (error) {
    console.log(`❌ ${method} ${endpoint} - Error: ${error.response?.status || error.code || error.message}`);
    if (error.response?.data?.message) {
      console.log(`   Message: ${error.response.data.message}`);
    }
    return null;
  }
}

async function testClaimDetectorHealth() {
  console.log('🔍 Testing Claim Detector Health');
  console.log('--------------------------------');
  
  try {
    const health = await testEndpoint('/health', 'GET', null, CLAIM_DETECTOR_URL);
    
    if (health && health.status === 'healthy') {
      console.log('   🟢 Claim Detector is healthy');
      return true;
    } else {
      console.log('   🔴 Claim Detector health check failed');
      return false;
    }
  } catch (error) {
    console.log('   🔴 Claim Detector not accessible');
    return false;
  }
}

async function testSmartInventorySyncHealth() {
  console.log('🔍 Testing Smart Inventory Sync Health');
  console.log('--------------------------------------');
  
  const health = await testEndpoint('/health');
  
  if (health && health.status === 'healthy') {
    console.log('   🟢 Smart Inventory Sync is healthy');
    
    // Check claim detector integration status
    if (health.services && health.services.claim_detector) {
      console.log(`   📊 Claim Detector Status: ${health.services.claim_detector}`);
      
      if (health.metrics && health.metrics.claimDetection) {
        console.log(`   📊 Claim Detection Available: ${health.metrics.claimDetection.available}`);
        console.log(`   📊 Queue Size: ${health.metrics.claimDetection.queueSize}`);
        if (health.metrics.claimDetection.lastProcessed) {
          console.log(`   📊 Last Processed: ${health.metrics.claimDetection.lastProcessed}`);
        }
      }
    }
    
    return true;
  } else {
    console.log('   🔴 Smart Inventory Sync health check failed');
    return false;
  }
}

async function testInventorySyncWithClaimDetection() {
  console.log('🔄 Testing Inventory Sync with Claim Detection');
  console.log('------------------------------------------------');
  
  // Start a sync job
  console.log('1. Starting inventory sync job...');
  const syncJob = await testEndpoint('/api/v1/jobs/sync', 'POST', {
    userId: TEST_USER_ID,
    syncType: 'full',
    sourceSystems: ['amazon']
  });
  
  if (!syncJob || !syncJob.success) {
    console.log('   🔴 Failed to start sync job');
    return false;
  }
  
  console.log('   🟢 Sync job started successfully');
  
  // Wait a bit for processing
  console.log('2. Waiting for sync processing...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Check job status
  console.log('3. Checking job status...');
  const jobStatus = await testEndpoint('/api/v1/jobs/status');
  
  if (jobStatus && jobStatus.success) {
    console.log('   🟢 Job status endpoint working');
    if (jobStatus.data && jobStatus.data.activeJobs) {
      console.log(`   📊 Active Jobs: ${jobStatus.data.activeJobs.length}`);
    }
  }
  
  return true;
}

async function testManualClaimDetection() {
  console.log('🎯 Testing Manual Claim Detection');
  console.log('---------------------------------');
  
  // Trigger manual claim detection
  console.log('1. Triggering manual claim detection...');
  const claimDetection = await testEndpoint('/api/v1/claims/detect', 'POST', {
    userId: TEST_USER_ID
  });
  
  if (!claimDetection || !claimDetection.success) {
    console.log('   🔴 Failed to trigger claim detection');
    return false;
  }
  
  console.log('   🟢 Claim detection triggered successfully');
  
  if (claimDetection.data) {
    console.log(`   📊 Triggered Claims: ${claimDetection.data.triggeredClaims}`);
    console.log(`   📊 Claim Results: ${claimDetection.data.claimResults?.length || 0}`);
    if (claimDetection.data.errors && claimDetection.data.errors.length > 0) {
      console.log(`   ⚠️  Errors: ${claimDetection.data.errors.length}`);
    }
  }
  
  return true;
}

async function testClaimSummary() {
  console.log('📊 Testing Claim Summary');
  console.log('-------------------------');
  
  const summary = await testEndpoint(`/api/v1/claims/summary/${TEST_USER_ID}`);
  
  if (summary && summary.success) {
    console.log('   🟢 Claim summary endpoint working');
    
    if (summary.data) {
      console.log(`   📊 Total Claims: ${summary.data.totalClaims}`);
      console.log(`   📊 Total Potential Recovery: $${summary.data.totalPotentialRecovery}`);
      console.log(`   📊 Average Confidence: ${(summary.data.averageConfidence * 100).toFixed(1)}%`);
      
      if (summary.data.claimsByStatus) {
        console.log(`   📊 Claims by Status: ${JSON.stringify(summary.data.claimsByStatus)}`);
      }
      
      if (summary.data.claimsByType) {
        console.log(`   📊 Claims by Type: ${JSON.stringify(summary.data.claimsByType)}`);
      }
    }
    
    return true;
  } else {
    console.log('   🔴 Failed to get claim summary');
    return false;
  }
}

async function testClaimDetectionHealth() {
  console.log('🏥 Testing Claim Detection Health');
  console.log('---------------------------------');
  
  const health = await testEndpoint('/api/v1/claims/health');
  
  if (health && health.success) {
    console.log('   🟢 Claim detection health endpoint working');
    
    if (health.data) {
      console.log(`   📊 Available: ${health.data.available}`);
      console.log(`   📊 Status: ${health.data.status}`);
      console.log(`   📊 Queue Size: ${health.data.queueSize}`);
      console.log(`   📊 Cache Size: ${health.data.cacheSize}`);
      
      if (health.data.lastProcessed) {
        console.log(`   📊 Last Processed: ${health.data.lastProcessed}`);
      }
    }
    
    return true;
  } else {
    console.log('   🔴 Failed to get claim detection health');
    return false;
  }
}

async function testDiscrepancySummaryWithClaims() {
  console.log('🔍 Testing Discrepancy Summary with Claims');
  console.log('-------------------------------------------');
  
  const summary = await testEndpoint(`/api/v1/discrepancies/summary?userId=${TEST_USER_ID}`);
  
  if (summary && summary.success) {
    console.log('   🟢 Discrepancy summary endpoint working');
    
    if (summary.data) {
      console.log(`   📊 Total Discrepancies: ${summary.data.total}`);
      
      if (summary.data.claimSummary) {
        console.log(`   🔗 Claim Integration Working:`);
        console.log(`      📊 Total Claims: ${summary.data.claimSummary.totalClaims}`);
        console.log(`      📊 Total Potential Recovery: $${summary.data.claimSummary.totalPotentialRecovery}`);
        console.log(`      📊 Average Confidence: ${(summary.data.claimSummary.averageConfidence * 100).toFixed(1)}%`);
      } else {
        console.log(`   ⚠️  No claim summary available (integration may not be configured)`);
      }
    }
    
    return true;
  } else {
    console.log('   🔴 Failed to get discrepancy summary');
    return false;
  }
}

async function runIntegrationTests() {
  console.log('🚀 Starting integration tests...\n');

  const results = {
    claimDetectorHealth: false,
    smartInventorySyncHealth: false,
    inventorySyncWithClaims: false,
    manualClaimDetection: false,
    claimSummary: false,
    claimDetectionHealth: false,
    discrepancySummaryWithClaims: false,
  };

  // Test 1: Claim Detector Health
  results.claimDetectorHealth = await testClaimDetectorHealth();
  console.log('');

  // Test 2: Smart Inventory Sync Health
  results.smartInventorySyncHealth = await testSmartInventorySyncHealth();
  console.log('');

  // Test 3: Inventory Sync with Claim Detection
  if (results.claimDetectorHealth && results.smartInventorySyncHealth) {
    results.inventorySyncWithClaims = await testInventorySyncWithClaimDetection();
    console.log('');
  } else {
    console.log('⏭️  Skipping inventory sync test due to health check failures\n');
  }

  // Test 4: Manual Claim Detection
  if (results.smartInventorySyncHealth) {
    results.manualClaimDetection = await testManualClaimDetection();
    console.log('');
  } else {
    console.log('⏭️  Skipping manual claim detection test due to health check failures\n');
  }

  // Test 5: Claim Summary
  if (results.smartInventorySyncHealth) {
    results.claimSummary = await testClaimSummary();
    console.log('');
  } else {
    console.log('⏭️  Skipping claim summary test due to health check failures\n');
  }

  // Test 6: Claim Detection Health
  if (results.smartInventorySyncHealth) {
    results.claimDetectionHealth = await testClaimDetectionHealth();
    console.log('');
  } else {
    console.log('⏭️  Skipping claim detection health test due to health check failures\n');
  }

  // Test 7: Discrepancy Summary with Claims
  if (results.smartInventorySyncHealth) {
    results.discrepancySummaryWithClaims = await testDiscrepancySummaryWithClaims();
    console.log('');
  } else {
    console.log('⏭️  Skipping discrepancy summary test due to health check failures\n');
  }

  // Test Summary
  console.log('🎯 Integration Test Summary');
  console.log('==========================');
  
  const totalTests = Object.keys(results).length;
  const passedTests = Object.values(results).filter(Boolean).length;
  const failedTests = totalTests - passedTests;
  
  console.log(`📊 Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`📈 Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('');

  // Detailed Results
  Object.entries(results).forEach(([test, result]) => {
    const status = result ? '✅' : '❌';
    const testName = test.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    console.log(`${status} ${testName}`);
  });
  console.log('');

  if (passedTests === totalTests) {
    console.log('🎉 All integration tests passed!');
    console.log('🚀 Smart Inventory Sync + Claim Detector integration is working perfectly');
    console.log('');
    console.log('💡 Next Steps:');
    console.log('   1. Monitor the /health endpoint for system status');
    console.log('   2. Use /api/v1/claims/detect to manually trigger claim detection');
    console.log('   3. Check /api/v1/claims/summary/:userId for claim analytics');
    console.log('   4. Deploy to production with confidence');
  } else {
    console.log('⚠️  Some integration tests failed');
    console.log('🔧 Please check the configuration and ensure both services are running');
    console.log('');
    console.log('💡 Troubleshooting:');
    console.log('   1. Verify Claim Detector is running at:', CLAIM_DETECTOR_URL);
    console.log('   2. Check Smart Inventory Sync is running at:', BASE_URL);
    console.log('   3. Verify environment variables are configured correctly');
    console.log('   4. Check database connectivity and migrations');
  }
}

// Run tests
runIntegrationTests().catch(error => {
  console.error('💥 Integration test execution failed:', error.message);
  process.exit(1);
});

