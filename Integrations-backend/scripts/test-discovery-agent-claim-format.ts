/**
 * Test Discovery Agent API with actual claim format from Agent 2
 */

import axios from 'axios';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'https://python-api-9.onrender.com';

// This is the exact format that Agent 2 sends (from prepareClaimsFromNormalizedData)
const testClaims = [
  {
    claim_id: 'claim_order_TEST-ORDER-1_1234567890',
    seller_id: 'test-user-123',
    order_id: 'TEST-ORDER-1',
    category: 'fee_error',
    subcategory: 'order_fee',
    reason_code: 'POTENTIAL_FEE_OVERCHARGE',
    marketplace: 'US',
    fulfillment_center: 'DEFAULT',
    amount: 15.50,
    quantity: 1,
    order_value: 100.00,
    shipping_cost: 5.00,
    days_since_order: 10,
    days_since_delivery: 7,
    description: 'Potential fee overcharge for order TEST-ORDER-1',
    reason: 'POTENTIAL_FEE_OVERCHARGE',
    notes: '',
    claim_date: new Date().toISOString()
  },
  {
    claim_id: 'claim_shipment_TEST-SHIP-1_1234567891',
    seller_id: 'test-user-123',
    order_id: 'TEST-ORDER-2',
    category: 'inventory_discrepancy',
    subcategory: 'missing_inventory',
    reason_code: 'LOST_SHIPMENT',
    marketplace: 'US',
    fulfillment_center: 'DEFAULT',
    amount: 25.00,
    quantity: 2,
    order_value: 50.00,
    shipping_cost: 0,
    days_since_order: 15,
    days_since_delivery: 12,
    description: 'Lost shipment for TEST-SHIP-1',
    reason: 'LOST_SHIPMENT',
    notes: '',
    claim_date: new Date().toISOString()
  }
];

async function testClaimFormat() {
  console.log('\n🧪 Testing Discovery Agent API with Agent 2 claim format...\n');
  console.log(`Python API URL: ${PYTHON_API_URL}\n`);
  console.log(`Sending ${testClaims.length} claims:\n`);
  testClaims.forEach((claim, idx) => {
    console.log(`Claim ${idx + 1}:`);
    console.log(`  - claim_id: ${claim.claim_id}`);
    console.log(`  - category: ${claim.category}`);
    console.log(`  - amount: $${claim.amount}`);
    console.log(`  - reason: ${claim.reason}\n`);
  });

  try {
    console.log('📤 Sending request to /api/v1/claim-detector/predict/batch...\n');
    
    const response = await axios.post(
      `${PYTHON_API_URL}/api/v1/claim-detector/predict/batch`,
      { claims: testClaims },
      {
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    console.log('✅ SUCCESS! API responded successfully\n');
    console.log(`Status: ${response.status}`);
    console.log(`Predictions received: ${response.data?.predictions?.length || 0}\n`);
    
    if (response.data?.predictions) {
      console.log('Sample predictions:');
      response.data.predictions.slice(0, 2).forEach((pred: any, idx: number) => {
        console.log(`\n  Prediction ${idx + 1}:`);
        console.log(`    - claim_id: ${pred.claim_id}`);
        console.log(`    - claimable: ${pred.claimable}`);
        console.log(`    - probability: ${pred.probability || pred.confidence || 'N/A'}`);
        console.log(`    - category: ${pred.category || 'N/A'}`);
      });
    }

    console.log('\n✅ Claim format is CORRECT - API accepts it!\n');
    return true;
  } catch (error: any) {
    console.error('\n❌ FAILED - API rejected the claim format\n');
    
    if (error.response) {
      console.error(`Status: ${error.response.status} ${error.response.statusText}\n`);
      console.error('Error Details:');
      console.error(JSON.stringify(error.response.data, null, 2));
      
      if (error.response.data?.details) {
        console.error('\n📋 Validation Errors:');
        error.response.data.details.forEach((detail: any, idx: number) => {
          console.error(`  ${idx + 1}. ${detail.loc.join('.')}: ${detail.msg}`);
        });
      }
    } else {
      console.error(`Error: ${error.message}`);
      if (error.code) {
        console.error(`Code: ${error.code}`);
      }
    }
    
    console.log('\n❌ Claim format needs to be FIXED\n');
    return false;
  }
}

testClaimFormat().catch(console.error);

















