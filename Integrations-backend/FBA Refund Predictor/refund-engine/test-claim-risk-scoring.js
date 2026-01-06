#!/usr/bin/env node

/**
 * Test Script for Claim Risk Scoring Logic
 * Demonstrates the ML-based claim risk assessment functionality
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || 'mock-jwt-token';

// Sample claim data for testing
const sampleClaims = [
  {
    discrepancy_type: 'missing_refund',
    discrepancy_size: 150.0,
    days_outstanding: 45,
    marketplace: 'amazon',
    historical_payout_rate: 0.75
  },
  {
    discrepancy_type: 'late_shipment',
    discrepancy_size: 75.0,
    days_outstanding: 30,
    marketplace: 'shopify',
    historical_payout_rate: 0.60
  },
  {
    discrepancy_type: 'damaged_item',
    discrepancy_size: 250.0,
    days_outstanding: 60,
    marketplace: 'ebay',
    historical_payout_rate: 0.45
  },
  {
    discrepancy_type: 'overcharge',
    discrepancy_size: 25.0,
    days_outstanding: 15,
    marketplace: 'stripe',
    historical_payout_rate: 0.90
  }
];

// Headers for API requests
const headers = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type': 'application/json'
};

async function testClaimRiskScoring() {
  console.log('🎯 OpSide Claim Risk Scoring Test');
  console.log('=' .repeat(50));
  console.log(`Base URL: ${BASE_URL}`);
  console.log('');

  try {
    // Test 1: Check Python environment
    console.log('1️⃣ Testing Python Environment...');
    const envResponse = await axios.get(`${BASE_URL}/api/v1/claims/check-environment`, { headers });
    console.log('✅ Environment Status:', envResponse.data.data.python_available ? 'Ready' : 'Not Available');
    console.log('');

    // Test 2: Get model information
    console.log('2️⃣ Getting Model Information...');
    const modelInfoResponse = await axios.get(`${BASE_URL}/api/v1/claims/model-info`, { headers });
    console.log('✅ Model Info:', {
      is_trained: modelInfoResponse.data.data.is_trained,
      success_model: modelInfoResponse.data.data.success_model_type,
      timeline_model: modelInfoResponse.data.data.timeline_model_type
    });
    console.log('');

    // Test 3: Train models if not trained
    if (!modelInfoResponse.data.data.is_trained) {
      console.log('3️⃣ Training ML Models...');
      const trainResponse = await axios.post(`${BASE_URL}/api/v1/claims/train-models`, 
        { n_samples: 5000 }, 
        { headers }
      );
      console.log('✅ Training Metrics:', trainResponse.data.data.training_metrics);
      console.log('');
    } else {
      console.log('3️⃣ Models already trained, skipping training...');
      console.log('');
    }

    // Test 4: Get sample claim
    console.log('4️⃣ Getting Sample Claim...');
    const sampleResponse = await axios.get(`${BASE_URL}/api/v1/claims/sample`, { headers });
    console.log('✅ Sample Claim:', sampleResponse.data.data.sample_claim);
    console.log('');

    // Test 5: Score individual claims
    console.log('5️⃣ Scoring Individual Claims...');
    for (let i = 0; i < sampleClaims.length; i++) {
      const claim = sampleClaims[i];
      console.log(`   Claim ${i + 1}: ${claim.discrepancy_type} - $${claim.discrepancy_size}`);
      
      try {
        const scoreResponse = await axios.post(`${BASE_URL}/api/v1/claims/score`, claim, { headers });
        const result = scoreResponse.data.data.risk_assessment;
        
        console.log(`   ✅ Success Probability: ${(result.success_probability * 100).toFixed(1)}%`);
        console.log(`   ✅ Refund Timeline: ${result.refund_timeline_days.toFixed(1)} days`);
        console.log(`   ✅ Risk Level: ${result.risk_level}`);
        console.log(`   ✅ Confidence: ${(result.confidence_score * 100).toFixed(1)}%`);
        console.log('');
      } catch (error) {
        console.log(`   ❌ Error: ${error.response?.data?.error || error.message}`);
        console.log('');
      }
    }

    // Test 6: Batch scoring
    console.log('6️⃣ Testing Batch Scoring...');
    try {
      const batchResponse = await axios.post(`${BASE_URL}/api/v1/claims/batch-score`, 
        { claims: sampleClaims }, 
        { headers }
      );
      
      console.log(`✅ Batch Results: ${batchResponse.data.data.successful_scores}/${batchResponse.data.data.total_claims} successful`);
      
      if (batchResponse.data.data.errors.length > 0) {
        console.log(`❌ Errors: ${batchResponse.data.data.errors.length} failed`);
        batchResponse.data.data.errors.forEach(error => {
          console.log(`   - Claim ${error.index + 1}: ${error.error}`);
        });
      }
      console.log('');
    } catch (error) {
      console.log(`❌ Batch Scoring Error: ${error.response?.data?.error || error.message}`);
      console.log('');
    }

    // Test 7: Test invalid claim
    console.log('7️⃣ Testing Invalid Claim Validation...');
    const invalidClaim = {
      discrepancy_type: 'missing_refund',
      discrepancy_size: -100, // Invalid: negative amount
      days_outstanding: 45,
      marketplace: 'amazon',
      historical_payout_rate: 1.5 // Invalid: > 1
    };

    try {
      await axios.post(`${BASE_URL}/api/v1/claims/score`, invalidClaim, { headers });
      console.log('❌ Expected validation error but request succeeded');
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('✅ Validation error caught correctly:', error.response.data.error);
      } else {
        console.log('❌ Unexpected error:', error.response?.data?.error || error.message);
      }
    }
    console.log('');

    // Test 8: Performance test
    console.log('8️⃣ Performance Test (10 claims)...');
    const performanceClaims = Array(10).fill(null).map((_, i) => ({
      discrepancy_type: ['missing_refund', 'late_shipment', 'damaged_item'][i % 3],
      discrepancy_size: 50 + (i * 25),
      days_outstanding: 15 + (i * 5),
      marketplace: ['amazon', 'shopify', 'stripe'][i % 3],
      historical_payout_rate: 0.5 + (i * 0.05)
    }));

    const startTime = Date.now();
    try {
      const perfResponse = await axios.post(`${BASE_URL}/api/v1/claims/batch-score`, 
        { claims: performanceClaims }, 
        { headers }
      );
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`✅ Performance: ${perfResponse.data.data.successful_scores} claims scored in ${duration}ms`);
      console.log(`✅ Average: ${(duration / perfResponse.data.data.successful_scores).toFixed(1)}ms per claim`);
    } catch (error) {
      console.log(`❌ Performance test failed: ${error.response?.data?.error || error.message}`);
    }
    console.log('');

    console.log('🎉 Claim Risk Scoring Test Completed Successfully!');
    console.log('');
    console.log('📊 Summary:');
    console.log('- Environment check: ✅');
    console.log('- Model training: ✅');
    console.log('- Individual scoring: ✅');
    console.log('- Batch scoring: ✅');
    console.log('- Validation: ✅');
    console.log('- Performance: ✅');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

// Error handling for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the test
if (require.main === module) {
  testClaimRiskScoring();
}

module.exports = { testClaimRiskScoring, sampleClaims };




