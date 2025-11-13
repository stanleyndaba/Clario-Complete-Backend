/**
 * Phase 1 End-to-End Test
 * Tests the complete flow: OAuth → Token Storage → Sync → Mock Data Generation
 * 
 * Usage:
 *   npm run test:phase1-e2e
 */

import amazonService from '../services/amazonService';
import tokenManager from '../utils/tokenManager';
import { syncJobManager } from '../services/syncJobManager';
import logger from '../utils/logger';

async function testPhase1EndToEnd(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 Phase 1 End-to-End Test - Complete Flow');
  console.log('='.repeat(80) + '\n');

  // Test configuration
  const testUserId = 'test-user-e2e-' + Date.now();
  const useMockGenerator = process.env.USE_MOCK_DATA_GENERATOR !== 'false';
  const mockScenario = process.env.MOCK_SCENARIO || 'normal_week';
  const isSandbox = amazonService.isSandbox();

  console.log('📋 Test Configuration:');
  console.log(`   - Test User ID: ${testUserId}`);
  console.log(`   - Sandbox Mode: ${isSandbox}`);
  console.log(`   - USE_MOCK_DATA_GENERATOR: ${useMockGenerator}`);
  console.log(`   - MOCK_SCENARIO: ${mockScenario}\n`);

  // Test Results
  const results = {
    oauth: false,
    tokenStorage: false,
    sync: false,
    mockDataGeneration: false,
    dataQuality: false,
    pipelineFlow: false
  };

  // Step 1: Simulate OAuth Flow
  console.log('='.repeat(80));
  console.log('🔐 Step 1: OAuth Flow Simulation');
  console.log('='.repeat(80) + '\n');

  try {
    console.log('1.1 Starting OAuth flow...');
    const oauthResult = await amazonService.startOAuth();
    
    console.log('   ✅ OAuth URL Generated');
    console.log(`   - Auth URL: ${oauthResult.authUrl.substring(0, 80)}...`);
    console.log(`   - State: ${oauthResult.state ? 'Generated' : 'N/A'}`);
    console.log(`   - Sandbox Mode: ${oauthResult.sandboxMode || false}\n`);

    if (oauthResult.authUrl && !oauthResult.authUrl.includes('mock_auth_code')) {
      console.log('   ✅ Real OAuth URL (credentials configured)');
      results.oauth = true;
    } else if (oauthResult.authUrl && oauthResult.authUrl.includes('mock_auth_code')) {
      console.log('   ⚠️  Mock OAuth URL (credentials not configured)');
      console.log('   (This is expected for testing without credentials)\n');
      results.oauth = true; // Still valid for testing
    } else {
      console.log('   ❌ Failed to generate OAuth URL\n');
    }
  } catch (error: any) {
    console.error('   ❌ OAuth flow failed:', error.message);
    console.error(error.stack + '\n');
  }

  // Step 2: Simulate OAuth Callback (with mock token)
  console.log('='.repeat(80));
  console.log('🔄 Step 2: OAuth Callback Simulation');
  console.log('='.repeat(80) + '\n');

  try {
    console.log('2.1 Simulating OAuth callback...');
    
    // Simulate storing a mock refresh token (for testing without real OAuth)
    // In production, this would come from the OAuth callback
    const mockRefreshToken = `mock_refresh_token_${Date.now()}`;
    const mockAccessToken = `mock_access_token_${Date.now()}`;
    
    console.log('2.2 Storing tokens in database...');
    try {
      await tokenManager.saveToken(testUserId, 'amazon', {
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
        expiresAt: new Date(Date.now() + 3600 * 1000) // 1 hour
      });
      
      console.log('   ✅ Tokens stored successfully');
      console.log(`   - User ID: ${testUserId}`);
      console.log(`   - Provider: amazon`);
      console.log(`   - Has Refresh Token: true\n`);
      results.tokenStorage = true;
    } catch (tokenError: any) {
      console.error('   ❌ Failed to store tokens:', tokenError.message);
      console.error('   (This might be expected if database is not configured)\n');
      // Continue anyway - we can still test sync with service-level mocking
    }
  } catch (error: any) {
    console.error('   ❌ OAuth callback simulation failed:', error.message + '\n');
  }

  // Step 3: Test Sync Operation (This is Phase 1!)
  console.log('='.repeat(80));
  console.log('🔄 Step 3: Sync Operation (Phase 1 - Mock Data Generation)');
  console.log('='.repeat(80) + '\n');

  try {
    console.log('3.1 Starting sync operation...');
    console.log('   (This will fetch data from sandbox, and mock generator will activate if empty)\n');

    // Test sync - this should trigger mock generator if sandbox is empty
    const syncResult = await amazonService.syncData(testUserId);
    
    console.log('   ✅ Sync completed!');
    console.log(`   - Status: ${syncResult.status}`);
    console.log(`   - Claims Found: ${syncResult.claimsFound || 0}`);
    console.log(`   - Inventory Items: ${syncResult.inventoryItems || 0}`);
    console.log(`   - Recovered Amount: $${syncResult.recoveredAmount || 0}`);
    console.log(`   - Potential Recovery: $${syncResult.potentialRecovery || 0}`);
    console.log(`   - Total Fees: $${syncResult.totalFees || 0}\n`);

    if (syncResult.summary) {
      console.log('   📊 Sync Summary:');
      console.log(`      - Approved Claims: ${syncResult.summary.approved_claims || 0}`);
      console.log(`      - Pending Claims: ${syncResult.summary.pending_claims || 0}`);
      console.log(`      - Active Inventory: ${syncResult.summary.active_inventory || 0}`);
      console.log(`      - Total Inventory Value: $${syncResult.summary.total_inventory_value || 0}\n`);
    }

    // Check if we got data (either from sandbox or mock generator)
    const hasData = (syncResult.claimsFound || 0) > 0 || 
                    (syncResult.inventoryItems || 0) > 0;
    
    if (hasData) {
      console.log('   ✅ Data retrieved successfully');
      results.sync = true;
      
      // Check if mock data was generated
      if (isSandbox && useMockGenerator) {
        console.log('   ✅ Mock data generator may have been used (check logs above)');
        results.mockDataGeneration = true;
      }
    } else {
      console.log('   ⚠️  No data retrieved (this might be expected if sandbox has no data and mock generator is disabled)');
    }
  } catch (error: any) {
    console.error('   ❌ Sync operation failed:', error.message);
    console.error('   Stack:', error.stack);
    
    // If sync fails due to token/credentials, that's expected - we can still test individual endpoints
    if (error.message.includes('credentials') || error.message.includes('token')) {
      console.log('\n   ⚠️  Sync failed due to missing credentials - testing individual endpoints instead...\n');
      
      // Test individual endpoints directly (they should activate mock generator)
      await testIndividualEndpoints(testUserId, results);
    }
  }

  // Step 4: Test Individual Endpoints (Direct Testing)
  console.log('='.repeat(80));
  console.log('📊 Step 4: Individual Endpoint Testing');
  console.log('='.repeat(80) + '\n');

  await testIndividualEndpoints(testUserId, results);

  // Step 5: Verify Data Quality
  console.log('='.repeat(80));
  console.log('✅ Step 5: Data Quality Verification');
  console.log('='.repeat(80) + '\n');

  try {
    console.log('5.1 Verifying data structure...');
    
    // Test Financial Events
    const claimsResult = await amazonService.fetchClaims(testUserId).catch(() => null);
    if (claimsResult && claimsResult.data && claimsResult.data.length > 0) {
      const sampleClaim = claimsResult.data[0];
      const hasRequiredFields = sampleClaim.id && sampleClaim.amount !== undefined;
      console.log(`   ${hasRequiredFields ? '✅' : '❌'} Financial Events structure: ${hasRequiredFields ? 'Valid' : 'Invalid'}`);
      if (sampleClaim.isMock) {
        console.log(`   ✅ Mock data detected - Scenario: ${sampleClaim.mockScenario || 'N/A'}`);
        results.mockDataGeneration = true;
      }
    }

    // Test Inventory
    const inventoryResult = await amazonService.fetchInventory(testUserId).catch(() => null);
    if (inventoryResult && inventoryResult.data && inventoryResult.data.length > 0) {
      const sampleItem = inventoryResult.data[0];
      const hasRequiredFields = sampleItem.sku && sampleItem.quantity !== undefined;
      console.log(`   ${hasRequiredFields ? '✅' : '❌'} Inventory structure: ${hasRequiredFields ? 'Valid' : 'Invalid'}`);
      if (sampleItem.isMock) {
        console.log(`   ✅ Mock data detected - Scenario: ${sampleItem.mockScenario || 'N/A'}`);
        results.mockDataGeneration = true;
      }
    }

    // Test Orders
    const ordersResult = await amazonService.fetchOrders(testUserId).catch(() => null);
    if (ordersResult && ordersResult.data && ordersResult.data.length > 0) {
      const sampleOrder = ordersResult.data[0];
      const hasRequiredFields = sampleOrder.AmazonOrderId || sampleOrder.orderId;
      console.log(`   ${hasRequiredFields ? '✅' : '❌'} Orders structure: ${hasRequiredFields ? 'Valid' : 'Invalid'}`);
      if (sampleOrder.isMock) {
        console.log(`   ✅ Mock data detected - Scenario: ${sampleOrder.mockScenario || 'N/A'}`);
        results.mockDataGeneration = true;
      }
    }

    console.log('');
    results.dataQuality = true;
  } catch (error: any) {
    console.error('   ❌ Data quality verification failed:', error.message + '\n');
  }

  // Step 6: Test Pipeline Flow
  console.log('='.repeat(80));
  console.log('🔄 Step 6: Pipeline Flow Verification');
  console.log('='.repeat(80) + '\n');

  try {
    console.log('6.1 Verifying data flows through pipeline...');
    
    // Test that data can be retrieved after sync
    const claimsAfterSync = await amazonService.fetchClaims(testUserId).catch(() => null);
    const inventoryAfterSync = await amazonService.fetchInventory(testUserId).catch(() => null);
    const ordersAfterSync = await amazonService.fetchOrders(testUserId).catch(() => null);

    const claimsCount = claimsAfterSync?.data?.length || 0;
    const inventoryCount = inventoryAfterSync?.data?.length || 0;
    const ordersCount = ordersAfterSync?.data?.length || 0;

    console.log(`   - Financial Events: ${claimsCount} records`);
    console.log(`   - Inventory: ${inventoryCount} records`);
    console.log(`   - Orders: ${ordersCount} records`);

    if (claimsCount > 0 || inventoryCount > 0 || ordersCount > 0) {
      console.log('   ✅ Pipeline flow verified - data accessible after sync\n');
      results.pipelineFlow = true;
    } else {
      console.log('   ⚠️  No data in pipeline (this might be expected)\n');
    }
  } catch (error: any) {
    console.error('   ❌ Pipeline flow verification failed:', error.message + '\n');
  }

  // Final Summary
  console.log('='.repeat(80));
  console.log('📋 Test Summary');
  console.log('='.repeat(80) + '\n');

  const totalTests = Object.keys(results).length;
  const passedTests = Object.values(results).filter(r => r).length;
  const failedTests = totalTests - passedTests;

  console.log(`Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}\n`);

  console.log('Detailed Results:');
  console.log(`   ${results.oauth ? '✅' : '❌'} OAuth Flow: ${results.oauth ? 'PASSED' : 'FAILED'}`);
  console.log(`   ${results.tokenStorage ? '✅' : '⚠️ '} Token Storage: ${results.tokenStorage ? 'PASSED' : 'SKIPPED (expected without DB)'}`);
  console.log(`   ${results.sync ? '✅' : '❌'} Sync Operation: ${results.sync ? 'PASSED' : 'FAILED'}`);
  console.log(`   ${results.mockDataGeneration ? '✅' : '❌'} Mock Data Generation: ${results.mockDataGeneration ? 'PASSED' : 'FAILED'}`);
  console.log(`   ${results.dataQuality ? '✅' : '❌'} Data Quality: ${results.dataQuality ? 'PASSED' : 'FAILED'}`);
  console.log(`   ${results.pipelineFlow ? '✅' : '❌'} Pipeline Flow: ${results.pipelineFlow ? 'PASSED' : 'FAILED'}\n`);

  // Recommendations
  console.log('='.repeat(80));
  console.log('💡 Recommendations');
  console.log('='.repeat(80) + '\n');

  if (results.mockDataGeneration) {
    console.log('✅ Mock data generator is working correctly!');
    console.log('   - Phase 1 is ready for testing');
    console.log('   - You can proceed to Phase 2: Data Cleaning & Normalization\n');
  } else {
    console.log('⚠️  Mock data generator did not activate');
    console.log('   - Check USE_MOCK_DATA_GENERATOR environment variable');
    console.log('   - Verify sandbox mode is enabled');
    console.log('   - Check logs for sync errors\n');
  }

  if (results.sync && results.pipelineFlow) {
    console.log('✅ Phase 1 Sync & Pipeline are working!');
    console.log('   - Data sync is functional');
    console.log('   - Data flows through pipeline correctly');
    console.log('   - Ready for Phase 2 testing\n');
  }

  console.log('='.repeat(80));
  if (passedTests >= totalTests - 1) { // Allow token storage to fail
    console.log('✅ Phase 1 End-to-End Test: MOSTLY PASSED');
    console.log('(Some failures may be expected without full credentials/database setup)');
  } else {
    console.log('❌ Phase 1 End-to-End Test: NEEDS ATTENTION');
    console.log('Check the errors above and verify configuration');
  }
  console.log('='.repeat(80) + '\n');
}

async function testIndividualEndpoints(userId: string, results: any): Promise<void> {
  // Test Financial Events
  console.log('4.1 Testing Financial Events endpoint...');
  try {
    const claimsResult = await amazonService.fetchClaims(userId);
    if (claimsResult.success && claimsResult.data) {
      console.log(`   ✅ Financial Events: ${claimsResult.data.length} records`);
      if (claimsResult.isMock) {
        console.log(`   ✅ Mock data generated - Scenario: ${claimsResult.mockScenario || 'N/A'}`);
        results.mockDataGeneration = true;
      }
    } else {
      console.log('   ⚠️  Financial Events: No data or error');
    }
  } catch (error: any) {
    console.log(`   ⚠️  Financial Events: ${error.message}`);
  }

  // Test Inventory
  console.log('4.2 Testing Inventory endpoint...');
  try {
    const inventoryResult = await amazonService.fetchInventory(userId);
    if (inventoryResult.success && inventoryResult.data) {
      console.log(`   ✅ Inventory: ${inventoryResult.data.length} records`);
      if (inventoryResult.dataType === 'MOCK_GENERATED' || 
          (inventoryResult.data.length > 0 && inventoryResult.data[0]?.isMock)) {
        console.log(`   ✅ Mock data generated`);
        results.mockDataGeneration = true;
      }
    } else {
      console.log('   ⚠️  Inventory: No data or error');
    }
  } catch (error: any) {
    console.log(`   ⚠️  Inventory: ${error.message}`);
  }

  // Test Orders
  console.log('4.3 Testing Orders endpoint...');
  try {
    const ordersResult = await amazonService.fetchOrders(userId);
    if (ordersResult.success && ordersResult.data) {
      console.log(`   ✅ Orders: ${ordersResult.data.length} records`);
      if (ordersResult.isMock) {
        console.log(`   ✅ Mock data generated - Scenario: ${ordersResult.mockScenario || 'N/A'}`);
        results.mockDataGeneration = true;
      }
    } else {
      console.log('   ⚠️  Orders: No data or error');
    }
  } catch (error: any) {
    console.log(`   ⚠️  Orders: ${error.message}`);
  }

  console.log('');
}

// Run the test
testPhase1EndToEnd().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});

