/**
 * Debug script to check what claims are being prepared from normalized data
 */

import { Agent2DataSyncService } from '../src/services/agent2DataSyncService';
import { MockDataGenerator, MockScenario } from '../src/services/mockDataGenerator';
import { OrdersService } from '../src/services/ordersService';
import { ShipmentsService } from '../src/services/shipmentsService';

const userId = 'test-debug-user';
const recordCount = 10; // Small sample for debugging

async function debugClaimsPreparation() {
  console.log('🔍 Debugging Claims Preparation\n');
  console.log('='.repeat(80));

  // Step 1: Generate mock data
  console.log('\n1. Generating mock data (high_losses scenario)...');
  const generator = new MockDataGenerator({
    scenario: 'high_losses' as MockScenario,
    recordCount,
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    endDate: new Date()
  });

  const mockOrders = generator.generateOrders().payload?.Orders || [];
  // MockDataGenerator doesn't have generateShipments, use empty array for now
  const mockShipments: any[] = [];

  console.log(`   Generated ${mockOrders.length} orders`);
  console.log(`   Generated ${mockShipments.length} shipments`);

  // Step 2: Normalize data
  console.log('\n2. Normalizing data...');
  const ordersService = new OrdersService();
  const shipmentsService = new ShipmentsService();

  const normalizedOrders = ordersService.normalizeOrders(mockOrders, userId);
  const normalizedShipments = shipmentsService.normalizeShipments(mockShipments, userId);

  console.log(`   Normalized ${normalizedOrders.length} orders`);
  console.log(`   Normalized ${normalizedShipments.length} shipments`);

  // Step 3: Check what fields are present
  console.log('\n3. Checking normalized order fields...');
  // total_fees is added later in validateAndNormalizeInputContract, so check total_amount
  const ordersWithAmount = normalizedOrders.filter(o => (o.total_amount || 0) > 0);
  const ordersWithoutAmount = normalizedOrders.filter(o => !o.total_amount || o.total_amount === 0);
  
  console.log(`   Orders with total_amount > 0: ${ordersWithAmount.length}`);
  console.log(`   Orders without total_amount: ${ordersWithoutAmount.length}`);
  
  if (normalizedOrders.length > 0) {
    const sampleOrder = normalizedOrders[0];
    console.log(`   Sample order:`);
    console.log(`     - order_id: ${sampleOrder.order_id}`);
    console.log(`     - total_amount: ${sampleOrder.total_amount}`);
    console.log(`     - would have total_fees: ${sampleOrder.total_amount ? (sampleOrder.total_amount * 0.05).toFixed(2) : '0'} (5% of total)`);
    console.log(`     - currency: ${sampleOrder.currency}`);
  }

  console.log('\n4. Checking normalized shipment fields...');
  const shipmentsWithMissing = normalizedShipments.filter(s => (s.missing_quantity || 0) > 0);
  const shipmentsWithoutMissing = normalizedShipments.filter(s => !s.missing_quantity || s.missing_quantity === 0);
  
  console.log(`   Shipments with missing_quantity: ${shipmentsWithMissing.length}`);
  console.log(`   Shipments without missing_quantity: ${shipmentsWithoutMissing.length}`);
  
  if (normalizedShipments.length > 0) {
    const sampleShipment = normalizedShipments[0];
    console.log(`   Sample shipment:`);
    console.log(`     - shipment_id: ${sampleShipment.shipment_id}`);
    console.log(`     - expected_quantity: ${sampleShipment.expected_quantity || 'NOT SET'}`);
    console.log(`     - received_quantity: ${sampleShipment.received_quantity || 'NOT SET'}`);
    console.log(`     - missing_quantity: ${sampleShipment.missing_quantity || 'NOT SET'}`);
  }

  // Step 4: Simulate validateAndNormalizeInputContract (adds total_fees)
  console.log('\n4. Simulating validateAndNormalizeInputContract (adds total_fees)...');
  const normalizedWithFees = normalizedOrders.map((order: any) => {
    const normalizedOrder = { ...order };
    if (!normalizedOrder.total_fees && normalizedOrder.total_fees !== 0) {
      normalizedOrder.total_fees = normalizedOrder.total_amount 
        ? parseFloat((normalizedOrder.total_amount * 0.05).toFixed(2))
        : 0;
    }
    return normalizedOrder;
  });
  
  const ordersWithFees = normalizedWithFees.filter((o: any) => (o.total_fees || 0) > 0);
  console.log(`   Orders with total_fees > 0: ${ordersWithFees.length}`);
  if (ordersWithFees.length > 0) {
    console.log(`   Sample: order_id=${ordersWithFees[0].order_id}, total_amount=${ordersWithFees[0].total_amount}, total_fees=${ordersWithFees[0].total_fees}`);
  }

  // Step 5: Use Agent2DataSyncService to prepare claims
  console.log('\n5. Preparing claims using Agent2DataSyncService...');
  const agent2Service = new Agent2DataSyncService();
  
  // Access the private method via reflection (for debugging only)
  const prepareClaimsMethod = (agent2Service as any).prepareClaimsFromNormalizedData.bind(agent2Service);
  
  const claimsToDetect = prepareClaimsMethod({
    orders: normalizedWithFees, // Use orders with fees added
    shipments: normalizedShipments,
    returns: [],
    settlements: [],
    inventory: [],
    claims: []
  }, userId);

  console.log(`   Claims prepared: ${claimsToDetect.length}`);
  
  if (claimsToDetect.length > 0) {
    console.log(`\n   Sample claims:`);
    claimsToDetect.slice(0, 3).forEach((claim: any, idx: number) => {
      console.log(`   ${idx + 1}. ${claim.category}/${claim.subcategory}: $${claim.amount} (${claim.reason_code})`);
    });
  } else {
    console.log(`\n   ⚠️  NO CLAIMS PREPARED!`);
    console.log(`   This means:`);
    console.log(`   - No orders with total_fees > 0`);
    console.log(`   - No shipments with missing_quantity > 0`);
    console.log(`   - No returns with refund_amount > 0`);
    console.log(`   - No settlements with discrepancies`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Debug complete!');
}

debugClaimsPreparation().catch(console.error);

