/**
 * Test Script for Mock Data Generator
 * Verifies that the mock data generator works correctly for all 3 endpoints and scenarios
 * 
 * Usage:
 *   npm run test:mock-generator
 *   or
 *   ts-node src/scripts/testMockDataGenerator.ts [scenario]
 * 
 * Scenarios:
 *   normal_week (default)
 *   high_volume
 *   with_issues
 */

import { getMockDataGenerator, createMockDataGenerator, type MockScenario } from '../services/mockDataGenerator';
import logger from '../utils/logger';

interface TestResult {
  endpoint: string;
  scenario: string;
  recordCount: number;
  success: boolean;
  error?: string;
  dataSample?: any;
}

async function testMockDataGenerator(scenario: MockScenario = 'normal_week'): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log(`🧪 Testing Mock Data Generator - Scenario: ${scenario.toUpperCase()}`);
  console.log('='.repeat(80) + '\n');

  const results: TestResult[] = [];

  // Test 1: Financial Events (GET_LEDGER_DETAIL_VIEW_DATA)
  console.log('📊 Testing Financial Events...');
  try {
    const generator = createMockDataGenerator(scenario, 75);
    const response = generator.generateFinancialEvents();
    
    const financialEvents = response.payload?.FinancialEvents || {};
    const adjustmentCount = financialEvents.AdjustmentEventList?.length || 0;
    const liquidationCount = financialEvents.FBALiquidationEventList?.length || 0;
    const feeCount = financialEvents.ServiceFeeEventList?.length || 0;
    const orderEventCount = financialEvents.OrderEventList?.length || 0;
    const totalEvents = adjustmentCount + liquidationCount + feeCount + orderEventCount;

    console.log(`   ✅ Generated ${totalEvents} financial events`);
    console.log(`      - Adjustments: ${adjustmentCount}`);
    console.log(`      - Liquidations: ${liquidationCount}`);
    console.log(`      - Fees: ${feeCount}`);
    console.log(`      - Order Events: ${orderEventCount}`);

    // Validate structure
    const sampleAdjustment = financialEvents.AdjustmentEventList?.[0];
    const sampleLiquidation = financialEvents.FBALiquidationEventList?.[0];
    
    if (sampleAdjustment) {
      console.log(`   ✅ Sample Adjustment Event:`);
      console.log(`      - ID: ${sampleAdjustment.AdjustmentEventId}`);
      console.log(`      - Type: ${sampleAdjustment.AdjustmentType}`);
      console.log(`      - Amount: $${sampleAdjustment.AdjustmentAmount?.CurrencyAmount} ${sampleAdjustment.AdjustmentAmount?.CurrencyCode}`);
      console.log(`      - Date: ${sampleAdjustment.PostedDate}`);
      console.log(`      - Order ID: ${sampleAdjustment.AmazonOrderId || 'N/A'}`);
    }

    if (sampleLiquidation) {
      console.log(`   ✅ Sample Liquidation Event:`);
      console.log(`      - Order ID: ${sampleLiquidation.OriginalRemovalOrderId}`);
      console.log(`      - Amount: $${sampleLiquidation.LiquidationProceedsAmount?.CurrencyAmount} ${sampleLiquidation.LiquidationProceedsAmount?.CurrencyCode}`);
      console.log(`      - Date: ${sampleLiquidation.PostedDate}`);
    }

    results.push({
      endpoint: 'Financial Events (GET_LEDGER_DETAIL_VIEW_DATA)',
      scenario,
      recordCount: totalEvents,
      success: true,
      dataSample: sampleAdjustment || sampleLiquidation
    });
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    results.push({
      endpoint: 'Financial Events (GET_LEDGER_DETAIL_VIEW_DATA)',
      scenario,
      recordCount: 0,
      success: false,
      error: error.message
    });
  }

  console.log('');

  // Test 2: Inventory (GET_FBA_MYI_UNSUPPRESSED_INVENTORY)
  console.log('📦 Testing Inventory...');
  try {
    const generator = createMockDataGenerator(scenario, 75);
    const response = generator.generateInventory();
    
    const summaries = response.payload?.inventorySummaries || [];
    console.log(`   ✅ Generated ${summaries.length} inventory summaries`);

    // Calculate totals
    const totalAvailable = summaries.reduce((sum: number, item: any) => 
      sum + (item.inventoryDetails?.availableQuantity || 0), 0);
    const totalReserved = summaries.reduce((sum: number, item: any) => 
      sum + (item.inventoryDetails?.reservedQuantity || 0), 0);
    const totalDamaged = summaries.reduce((sum: number, item: any) => 
      sum + (item.inventoryDetails?.damagedQuantity || 0), 0);
    const totalUnfulfillable = summaries.reduce((sum: number, item: any) => 
      sum + (item.inventoryDetails?.unfulfillableQuantity || 0), 0);

    console.log(`   ✅ Inventory Totals:`);
    console.log(`      - Available: ${totalAvailable} units`);
    console.log(`      - Reserved: ${totalReserved} units`);
    console.log(`      - Damaged: ${totalDamaged} units`);
    console.log(`      - Unfulfillable: ${totalUnfulfillable} units`);

    // Sample item
    const sampleItem = summaries[0];
    if (sampleItem) {
      console.log(`   ✅ Sample Inventory Item:`);
      console.log(`      - SKU: ${sampleItem.sellerSku}`);
      console.log(`      - ASIN: ${sampleItem.asin}`);
      console.log(`      - FNSKU: ${sampleItem.fnSku}`);
      console.log(`      - Condition: ${sampleItem.condition}`);
      console.log(`      - Available: ${sampleItem.inventoryDetails?.availableQuantity} units`);
      console.log(`      - Reserved: ${sampleItem.inventoryDetails?.reservedQuantity} units`);
      console.log(`      - Damaged: ${sampleItem.inventoryDetails?.damagedQuantity} units`);
    }

    results.push({
      endpoint: 'Inventory (GET_FBA_MYI_UNSUPPRESSED_INVENTORY)',
      scenario,
      recordCount: summaries.length,
      success: true,
      dataSample: sampleItem
    });
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    results.push({
      endpoint: 'Inventory (GET_FBA_MYI_UNSUPPRESSED_INVENTORY)',
      scenario,
      recordCount: 0,
      success: false,
      error: error.message
    });
  }

  console.log('');

  // Test 3: Orders (GET_ORDERS_DATA)
  console.log('🛒 Testing Orders...');
  try {
    const generator = createMockDataGenerator(scenario, 75);
    const response = generator.generateOrders();
    
    const orders = response.payload?.Orders || [];
    console.log(`   ✅ Generated ${orders.length} orders`);

    // Calculate totals
    const totalAmount = orders.reduce((sum: number, order: any) => 
      sum + parseFloat(order.OrderTotal?.Amount || '0'), 0);
    const shippedCount = orders.filter((o: any) => o.OrderStatus === 'Shipped').length;
    const pendingCount = orders.filter((o: any) => o.OrderStatus === 'Pending').length;
    const unshippedCount = orders.filter((o: any) => o.OrderStatus === 'Unshipped').length;
    const canceledCount = orders.filter((o: any) => o.OrderStatus === 'Canceled').length;
    const fbaCount = orders.filter((o: any) => o.FulfillmentChannel === 'FBA').length;
    const primeCount = orders.filter((o: any) => o.IsPrime).length;

    console.log(`   ✅ Order Statistics:`);
    console.log(`      - Total Order Value: $${totalAmount.toFixed(2)}`);
    console.log(`      - Status: ${shippedCount} Shipped, ${pendingCount} Pending, ${unshippedCount} Unshipped, ${canceledCount} Canceled`);
    console.log(`      - FBA Orders: ${fbaCount} (${((fbaCount / orders.length) * 100).toFixed(1)}%)`);
    console.log(`      - Prime Orders: ${primeCount} (${((primeCount / orders.length) * 100).toFixed(1)}%)`);

    // Sample order
    const sampleOrder = orders[0];
    if (sampleOrder) {
      console.log(`   ✅ Sample Order:`);
      console.log(`      - Order ID: ${sampleOrder.AmazonOrderId}`);
      console.log(`      - Status: ${sampleOrder.OrderStatus}`);
      console.log(`      - Channel: ${sampleOrder.FulfillmentChannel}`);
      console.log(`      - Total: $${sampleOrder.OrderTotal?.Amount} ${sampleOrder.OrderTotal?.CurrencyCode}`);
      console.log(`      - Items: ${sampleOrder.OrderItems?.length || 0}`);
      console.log(`      - Prime: ${sampleOrder.IsPrime ? 'Yes' : 'No'}`);
      console.log(`      - Date: ${sampleOrder.PurchaseDate}`);
    }

    results.push({
      endpoint: 'Orders (GET_ORDERS_DATA)',
      scenario,
      recordCount: orders.length,
      success: true,
      dataSample: sampleOrder
    });
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    results.push({
      endpoint: 'Orders (GET_ORDERS_DATA)',
      scenario,
      recordCount: 0,
      success: false,
      error: error.message
    });
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📋 Test Summary');
  console.log('='.repeat(80) + '\n');

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalRecords = results.reduce((sum, r) => sum + r.recordCount, 0);

  console.log(`Scenario: ${scenario.toUpperCase()}`);
  console.log(`✅ Passed: ${successful}/${results.length} tests`);
  console.log(`❌ Failed: ${failed}/${results.length} tests`);
  console.log(`📊 Total Records Generated: ${totalRecords}\n`);

  // Detailed results
  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.endpoint}`);
    console.log(`   Records: ${result.recordCount}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    console.log('');
  });

  // Scenario-specific checks
  console.log('📊 Scenario-Specific Validation:');
  if (scenario === 'with_issues') {
    const generator = createMockDataGenerator(scenario, 75);
    const financialEvents = generator.generateFinancialEvents().payload?.FinancialEvents || {};
    const adjustments = financialEvents.AdjustmentEventList || [];
    const negativeAdjustments = adjustments.filter((a: any) => 
      parseFloat(a.AdjustmentAmount?.CurrencyAmount || '0') < 0).length;
    const highAmountAdjustments = adjustments.filter((a: any) => 
      Math.abs(parseFloat(a.AdjustmentAmount?.CurrencyAmount || '0')) > 300).length;

    console.log(`   - Negative Adjustments (Reversals): ${negativeAdjustments}`);
    console.log(`   - High-Value Adjustments (>$300): ${highAmountAdjustments}`);
    
    const inventory = generator.generateInventory().payload?.inventorySummaries || [];
    const damagedItems = inventory.filter((item: any) => 
      (item.inventoryDetails?.damagedQuantity || 0) > 5).length;
    console.log(`   - Items with High Damage (>5 units): ${damagedItems}`);

    const orders = generator.generateOrders().payload?.Orders || [];
    const canceledOrders = orders.filter((o: any) => o.OrderStatus === 'Canceled').length;
    console.log(`   - Canceled Orders: ${canceledOrders}`);
  } else if (scenario === 'high_volume') {
    const generator = createMockDataGenerator(scenario, 100);
    const financialEvents = generator.generateFinancialEvents().payload?.FinancialEvents || {};
    const totalEvents = (financialEvents.AdjustmentEventList?.length || 0) +
                       (financialEvents.FBALiquidationEventList?.length || 0) +
                       (financialEvents.ServiceFeeEventList?.length || 0) +
                       (financialEvents.OrderEventList?.length || 0);
    console.log(`   - Total Financial Events: ${totalEvents} (expected ~100)`);
    
    const inventory = generator.generateInventory().payload?.inventorySummaries || [];
    console.log(`   - Inventory Items: ${inventory.length} (expected ~100)`);
    
    const orders = generator.generateOrders().payload?.Orders || [];
    console.log(`   - Orders: ${orders.length} (expected ~100)`);
  }

  console.log('\n' + '='.repeat(80));
  if (failed === 0) {
    console.log('✅ All tests passed! Mock data generator is working correctly.');
  } else {
    console.log('❌ Some tests failed. Please check the errors above.');
  }
  console.log('='.repeat(80) + '\n');
}

// Run tests for all scenarios
async function testAllScenarios(): Promise<void> {
  const scenarios: MockScenario[] = ['normal_week', 'high_volume', 'with_issues'];
  
  for (const scenario of scenarios) {
    await testMockDataGenerator(scenario);
    console.log('\n\n');
  }
}

// Main execution
const args = process.argv.slice(2);
const scenario = args[0] as MockScenario;

if (scenario && ['normal_week', 'high_volume', 'with_issues'].includes(scenario)) {
  testMockDataGenerator(scenario).catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
} else if (args[0] === '--all') {
  testAllScenarios().catch(error => {
    console.error('Tests failed:', error);
    process.exit(1);
  });
} else {
  console.log('Usage:');
  console.log('  npm run test:mock-generator [scenario]');
  console.log('  npm run test:mock-generator --all');
  console.log('\nScenarios: normal_week, high_volume, with_issues');
  console.log('\nRunning default test (normal_week)...\n');
  testMockDataGenerator('normal_week').catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

