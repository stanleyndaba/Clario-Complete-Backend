#!/usr/bin/env node

/**
 * Minimal test harness for Evidence & Value Engine
 * Tests POST /api/v1/claims/flag and GET /api/v1/proofs/:id
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_TOKEN = process.env.TEST_TOKEN || 'your-test-jwt-token-here';

const testInvoices = [
  {
    case_number: 'TEST-001',
    claim_amount: 150.00,
    invoice_text: 'Vendor: Amazon FBA, Invoice Number: INV-2024-001, Date: 2024-01-15, Overcharge detected on shipping fees $150.00'
  },
  {
    case_number: 'TEST-002', 
    claim_amount: 75.50,
    invoice_text: 'Vendor: Supplier Co, Invoice Number: INV-2024-002, Date: 2024-01-16, Damaged inventory reported, lost units value $75.50'
  },
  {
    case_number: 'TEST-003',
    claim_amount: 200.00,
    invoice_text: 'Vendor: Logistics Inc, Invoice Number: INV-2024-003, Date: 2024-01-17, Fee dispute on storage charges $200.00'
  }
];

async function testFlagClaim(invoice) {
  console.log(`\n🚩 Testing flag claim for case: ${invoice.case_number}`);
  
  try {
    const response = await fetch(`${BASE_URL}/api/v1/claims/flag`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_TOKEN}`
      },
      body: JSON.stringify(invoice)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ Flag claim failed: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json();
    console.log(`✅ Flag claim successful:`);
    console.log(`   Claim ID: ${result.data.claim.id}`);
    console.log(`   Proof ID: ${result.data.proof.id}`);
    console.log(`   Anomaly Score: ${result.data.claim.anomaly_score}`);
    
    return result.data.proof.id;
  } catch (error) {
    console.log(`❌ Flag claim error: ${error.message}`);
    return null;
  }
}

async function testGetProof(proofId) {
  console.log(`\n🔍 Testing get proof for ID: ${proofId}`);
  
  try {
    const response = await fetch(`${BASE_URL}/api/v1/proofs/${proofId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ Get proof failed: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json();
    console.log(`✅ Get proof successful:`);
    console.log(`   Proof Bundle: ${JSON.stringify(result.data.proof, null, 2)}`);
    console.log(`   Claim: ${JSON.stringify(result.data.claim, null, 2)}`);
    console.log(`   Evidence Links: ${JSON.stringify(result.data.links, null, 2)}`);
    
    return result.data;
  } catch (error) {
    console.log(`❌ Get proof error: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('🧪 Evidence & Value Engine Test Harness');
  console.log('=====================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test Token: ${TEST_TOKEN.substring(0, 20)}...`);
  
  const proofIds = [];
  
  // Test flag claims
  for (const invoice of testInvoices) {
    const proofId = await testFlagClaim(invoice);
    if (proofId) {
      proofIds.push(proofId);
    }
  }
  
  // Test get proofs
  for (const proofId of proofIds) {
    await testGetProof(proofId);
  }
  
  console.log('\n📊 Test Summary');
  console.log('================');
  console.log(`Total invoices tested: ${testInvoices.length}`);
  console.log(`Successful flags: ${proofIds.length}`);
  console.log(`Failed flags: ${testInvoices.length - proofIds.length}`);
  
  if (proofIds.length > 0) {
    console.log('\n🎯 Next steps:');
    console.log('1. Check Supabase for ProofBundle, Claim, and EvidenceLink records');
    console.log('2. Verify RLS policies are enforcing append-only writes');
    console.log('3. Test with real JWT tokens from your auth system');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testFlagClaim, testGetProof };
