/**
 * Phase 1 Mock Data Generator Integration Test
 * Tests that the mock data generator activates when sandbox returns empty data
 * 
 * Usage:
 *   npm run test:phase1-mock
 */

import amazonService from '../services/amazonService';
import logger from '../utils/logger';

async function testPhase1MockIntegration(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 Phase 1 Mock Data Generator Integration Test');
  console.log('='.repeat(80) + '\n');

  // Test configuration
  const testUserId = 'test-user-' + Date.now();
  const useMockGenerator = process.env.USE_MOCK_DATA_GENERATOR !== 'false';
  const mockScenario = process.env.MOCK_SCENARIO || 'normal_week';
  const mockRecordCount = process.env.MOCK_RECORD_COUNT || '75';

  console.log('📋 Test Configuration:');
  console.log(`   - Test User ID: ${testUserId}`);
  console.log(`   - USE_MOCK_DATA_GENERATOR: ${useMockGenerator}`);
  console.log(`   - MOCK_SCENARIO: ${mockScenario}`);
  console.log(`   - MOCK_RECORD_COUNT: ${mockRecordCount}`);
  console.log(`   - Sandbox Mode: ${amazonService.isSandbox()}\n`);

  // Test 1: Financial Events (Claims)
  console.log('='.repeat(80));
  console.log('📊 Test 1: Financial Events (Claims)');
  console.log('='.repeat(80) + '\n');

  try {
    const claimsResult = await amazonService.fetchClaims(testUserId);
    
    console.log('✅ Financial Events Fetch Complete');
    console.log(`   - Success: ${claimsResult.success}`);
    console.log(`   - Total Claims: ${claimsResult.data?.length || 0}`);
    console.log(`   - Is Sandbox: ${claimsResult.isSandbox}`);
    console.log(`   - Data Type: ${claimsResult.dataType}`);
    console.log(`   - Is Mock: ${claimsResult.isMock || false}`);
    console.log(`   - Mock Scenario: ${claimsResult.mockScenario || 'N/A'}`);
    console.log(`   - Message: ${claimsResult.message}\n`);

    if (claimsResult.data && claimsResult.data.length > 0) {
      const sampleClaim = claimsResult.data[0];
      console.log('📋 Sample Claim:');
      console.log(`   - ID: ${sampleClaim.id}`);
      console.log(`   - Order ID: ${sampleClaim.orderId || 'N/A'}`);
      console.log(`   - Amount: $${sampleClaim.amount}`);
      console.log(`   - Status: ${sampleClaim.status}`);
      console.log(`   - Type: ${sampleClaim.type}`);
      console.log(`   - Currency: ${sampleClaim.currency}`);
      console.log(`   - Created: ${sampleClaim.createdAt}\n`);
    }

    // Validate mock data
    if (useMockGenerator && amazonService.isSandbox()) {
      if (claimsResult.isMock) {
        console.log('✅ Mock Data Generator Activated Successfully!');
        console.log(`   - Scenario: ${claimsResult.mockScenario}`);
        console.log(`   - Records Generated: ${claimsResult.data?.length || 0}\n`);
      } else if (claimsResult.data && claimsResult.data.length > 0) {
        console.log('⚠️  Sandbox returned data, mock generator not needed');
        console.log('   (This is fine if sandbox has test data)\n');
      } else {
        console.log('❌ Mock generator should have activated but didn\'t!');
        console.log('   Check USE_MOCK_DATA_GENERATOR environment variable\n');
      }
    }
  } catch (error: any) {
    console.error('❌ Error fetching claims:', error.message);
    console.error(error.stack);
  }

  // Test 2: Inventory
  console.log('='.repeat(80));
  console.log('📦 Test 2: Inventory');
  console.log('='.repeat(80) + '\n');

  try {
    const inventoryResult = await amazonService.fetchInventory(testUserId);
    
    console.log('✅ Inventory Fetch Complete');
    console.log(`   - Success: ${inventoryResult.success}`);
    console.log(`   - Total Items: ${inventoryResult.data?.length || 0}`);
    console.log(`   - Is Sandbox: ${inventoryResult.isSandbox}`);
    console.log(`   - Data Type: ${inventoryResult.dataType || 'N/A'}`);
    console.log(`   - Message: ${inventoryResult.message}\n`);

    if (inventoryResult.data && inventoryResult.data.length > 0) {
      const sampleItem = inventoryResult.data[0];
      console.log('📋 Sample Inventory Item:');
      console.log(`   - SKU: ${sampleItem.sku}`);
      console.log(`   - ASIN: ${sampleItem.asin || 'N/A'}`);
      console.log(`   - FNSKU: ${sampleItem.fnSku || 'N/A'}`);
      console.log(`   - Quantity: ${sampleItem.quantity}`);
      console.log(`   - Reserved: ${sampleItem.reserved || 0}`);
      console.log(`   - Damaged: ${sampleItem.damaged || 0}`);
      console.log(`   - Status: ${sampleItem.status}`);
      console.log(`   - Condition: ${sampleItem.condition}\n`);

      // Calculate totals
      const totalAvailable = inventoryResult.data.reduce((sum: number, item: any) => 
        sum + (item.quantity || 0), 0);
      const totalReserved = inventoryResult.data.reduce((sum: number, item: any) => 
        sum + (item.reserved || 0), 0);
      const totalDamaged = inventoryResult.data.reduce((sum: number, item: any) => 
        sum + (item.damaged || 0), 0);

      console.log('📊 Inventory Totals:');
      console.log(`   - Available: ${totalAvailable} units`);
      console.log(`   - Reserved: ${totalReserved} units`);
      console.log(`   - Damaged: ${totalDamaged} units\n`);
    }

    // Validate mock data
    if (useMockGenerator && amazonService.isSandbox()) {
      if (inventoryResult.data && inventoryResult.data.length > 0) {
        const isMock = inventoryResult.data[0]?.isMock || 
                      inventoryResult.dataType === 'MOCK_GENERATED';
        if (isMock) {
          console.log('✅ Mock Data Generator Activated Successfully!');
          console.log(`   - Records Generated: ${inventoryResult.data.length}\n`);
        } else {
          console.log('⚠️  Sandbox returned data, mock generator not needed\n');
        }
      } else {
        console.log('❌ Mock generator should have activated but didn\'t!\n');
      }
    }
  } catch (error: any) {
    console.error('❌ Error fetching inventory:', error.message);
    console.error(error.stack);
  }

  // Test 3: Orders
  console.log('='.repeat(80));
  console.log('🛒 Test 3: Orders');
  console.log('='.repeat(80) + '\n');

  try {
    const ordersResult = await amazonService.fetchOrders(testUserId);
    
    console.log('✅ Orders Fetch Complete');
    console.log(`   - Success: ${ordersResult.success}`);
    console.log(`   - Total Orders: ${ordersResult.data?.length || 0}`);
    console.log(`   - Is Sandbox: ${ordersResult.isSandbox}`);
    console.log(`   - Data Type: ${ordersResult.dataType || 'N/A'}`);
    console.log(`   - Is Mock: ${ordersResult.isMock || false}`);
    console.log(`   - Mock Scenario: ${ordersResult.mockScenario || 'N/A'}`);
    console.log(`   - Message: ${ordersResult.message}\n`);

    if (ordersResult.data && ordersResult.data.length > 0) {
      const sampleOrder = ordersResult.data[0];
      console.log('📋 Sample Order:');
      console.log(`   - Order ID: ${sampleOrder.AmazonOrderId || sampleOrder.orderId}`);
      console.log(`   - Status: ${sampleOrder.OrderStatus || sampleOrder.status}`);
      console.log(`   - Channel: ${sampleOrder.FulfillmentChannel || sampleOrder.fulfillmentChannel}`);
      console.log(`   - Total: $${sampleOrder.OrderTotal?.Amount || sampleOrder.totalAmount || 0}`);
      console.log(`   - Items: ${sampleOrder.OrderItems?.length || sampleOrder.items?.length || 0}`);
      console.log(`   - Prime: ${sampleOrder.IsPrime || sampleOrder.isPrime ? 'Yes' : 'No'}`);
      console.log(`   - Date: ${sampleOrder.PurchaseDate || sampleOrder.purchaseDate}\n`);

      // Calculate totals
      const totalValue = ordersResult.data.reduce((sum: number, order: any) => {
        const amount = parseFloat(order.OrderTotal?.Amount || order.totalAmount || '0');
        return sum + amount;
      }, 0);
      const shippedCount = ordersResult.data.filter((o: any) => 
        (o.OrderStatus || o.status) === 'Shipped').length;
      const fbaCount = ordersResult.data.filter((o: any) => 
        (o.FulfillmentChannel || o.fulfillmentChannel) === 'FBA').length;

      console.log('📊 Order Statistics:');
      console.log(`   - Total Value: $${totalValue.toFixed(2)}`);
      console.log(`   - Shipped: ${shippedCount}`);
      console.log(`   - FBA Orders: ${fbaCount} (${((fbaCount / ordersResult.data.length) * 100).toFixed(1)}%)\n`);
    }

    // Validate mock data
    if (useMockGenerator && amazonService.isSandbox()) {
      if (ordersResult.isMock) {
        console.log('✅ Mock Data Generator Activated Successfully!');
        console.log(`   - Scenario: ${ordersResult.mockScenario}`);
        console.log(`   - Records Generated: ${ordersResult.data?.length || 0}\n`);
      } else if (ordersResult.data && ordersResult.data.length > 0) {
        console.log('⚠️  Sandbox returned data, mock generator not needed\n');
      } else {
        console.log('❌ Mock generator should have activated but didn\'t!\n');
      }
    }
  } catch (error: any) {
    console.error('❌ Error fetching orders:', error.message);
    console.error(error.stack);
  }

  // Test 4: Full Sync
  console.log('='.repeat(80));
  console.log('🔄 Test 4: Full Data Sync');
  console.log('='.repeat(80) + '\n');

  try {
    const syncResult = await amazonService.syncData(testUserId);
    
    console.log('✅ Full Sync Complete');
    console.log(`   - Status: ${syncResult.status}`);
    console.log(`   - Claims Found: ${syncResult.claimsFound || 0}`);
    console.log(`   - Inventory Items: ${syncResult.inventoryItems || 0}`);
    console.log(`   - Recovered Amount: $${syncResult.recoveredAmount || 0}`);
    console.log(`   - Potential Recovery: $${syncResult.potentialRecovery || 0}`);
    console.log(`   - Total Fees: $${syncResult.totalFees || 0}\n`);

    if (syncResult.summary) {
      console.log('📊 Sync Summary:');
      console.log(`   - Approved Claims: ${syncResult.summary.approved_claims || 0}`);
      console.log(`   - Pending Claims: ${syncResult.summary.pending_claims || 0}`);
      console.log(`   - Active Inventory: ${syncResult.summary.active_inventory || 0}`);
      console.log(`   - Total Inventory Value: $${syncResult.summary.total_inventory_value || 0}\n`);
    }
  } catch (error: any) {
    console.error('❌ Error during sync:', error.message);
    console.error(error.stack);
  }

  // Summary
  console.log('='.repeat(80));
  console.log('📋 Test Summary');
  console.log('='.repeat(80) + '\n');

  console.log('✅ Phase 1 Mock Data Generator Integration Test Complete!\n');
  console.log('Next Steps:');
  console.log('  1. Verify all 3 endpoints (Financial Events, Inventory, Orders) work');
  console.log('  2. Check that mock data is generated when sandbox returns empty data');
  console.log('  3. Verify data structure matches SP-API format');
  console.log('  4. Test different scenarios: normal_week, high_volume, with_issues');
  console.log('  5. Proceed to Phase 2: Data Cleaning & Normalization\n');
}

// Run the test
testPhase1MockIntegration().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});

