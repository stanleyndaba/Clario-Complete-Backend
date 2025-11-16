/**
 * Generate Large Mock Dataset for E2E Frontend Testing
 * 
 * This script generates large volumes of mock data to test the frontend
 * with realistic data volumes before launching with real SP-API.
 * 
 * Usage:
 *   MOCK_RECORD_COUNT=5000 npm run test:generate-large-dataset
 *   MOCK_SCENARIO=high_volume npm run test:generate-large-dataset
 */

import 'dotenv/config';
import agent2DataSyncService from '../src/services/agent2DataSyncService';
import { supabaseAdmin } from '../src/database/supabaseClient';
import logger from '../src/utils/logger';
import { randomUUID } from 'crypto';

const TEST_USER_ID = randomUUID();
const TEST_SELLER_ID = 'E2E_TEST_' + Date.now();

interface DatasetConfig {
  name: string;
  orders: number;
  shipments: number;
  returns: number;
  settlements: number;
  inventory: number;
  expectedDetections: number;
}

const SCENARIOS: Record<string, DatasetConfig> = {
  small: {
    name: 'Small Seller',
    orders: 500,
    shipments: 200,
    returns: 100,
    settlements: 200,
    inventory: 500,
    expectedDetections: 50
  },
  medium: {
    name: 'Medium Seller',
    orders: 5000,
    shipments: 2000,
    returns: 500,
    settlements: 2000,
    inventory: 5000,
    expectedDetections: 500
  },
  large: {
    name: 'Large Seller',
    orders: 50000,
    shipments: 20000,
    returns: 5000,
    settlements: 20000,
    inventory: 50000,
    expectedDetections: 5000
  }
};

async function generateLargeDataset() {
  console.log('🚀 Large Dataset Generator for E2E Frontend Testing\n');

  // Determine scenario
  const scenarioName = (process.env.MOCK_SCENARIO || 'medium').toLowerCase();
  const scenario = SCENARIOS[scenarioName] || SCENARIOS.medium;
  const recordCount = parseInt(process.env.MOCK_RECORD_COUNT || String(scenario.orders), 10);

  console.log(`📊 Configuration:`);
  console.log(`   Scenario: ${scenario.name}`);
  console.log(`   Record Count: ${recordCount}`);
  console.log(`   Expected Orders: ${scenario.orders}`);
  console.log(`   Expected Detections: ${scenario.expectedDetections}\n`);

  try {
    // Set environment for large dataset
    process.env.ENABLE_MOCK_SP_API = 'true';
    process.env.USE_MOCK_DATA_GENERATOR = 'true';
    process.env.MOCK_SCENARIO = 'high_volume';
    process.env.MOCK_RECORD_COUNT = String(recordCount);

    // Step 1: Create test user
    console.log('👤 Step 1: Creating test user...');
    const { data: testUser, error: userError } = await supabaseAdmin
      .from('users')
      .upsert({
        email: `${TEST_SELLER_ID}@e2e-test.com`,
        amazon_seller_id: TEST_SELLER_ID,
        company_name: `E2E Test - ${scenario.name}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'amazon_seller_id'
      })
      .select('id')
      .single();

    if (userError || !testUser?.id) {
      throw new Error(`User creation failed: ${userError?.message}`);
    }

    console.log(`   ✅ User created: ${testUser.id}\n`);

    // Step 2: Generate data via Agent 2
    console.log('📦 Step 2: Generating mock data via Agent 2...');
    const startTime = Date.now();
    
    const syncResult = await agent2DataSyncService.syncUserData(testUser.id);

    if (!syncResult.success) {
      throw new Error('Data sync failed');
    }

    const duration = Date.now() - startTime;
    console.log(`   ✅ Data sync completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`   📊 Summary:`);
    console.log(`      Orders: ${syncResult.summary.ordersCount}`);
    console.log(`      Shipments: ${syncResult.summary.shipmentsCount}`);
    console.log(`      Returns: ${syncResult.summary.returnsCount}`);
    console.log(`      Settlements: ${syncResult.summary.settlementsCount}`);
    console.log(`      Inventory: ${syncResult.summary.inventoryCount}`);
    console.log(`      Claims: ${syncResult.summary.claimsCount}\n`);

    // Step 3: Check detection results
    console.log('🔍 Step 3: Checking detection results...');
    const { data: detections } = await supabaseAdmin
      .from('detection_results')
      .select('*')
      .eq('seller_id', testUser.id)
      .order('created_at', { ascending: false });

    const detectionCount = detections?.length || 0;
    const totalValue = detections?.reduce((sum, d) => sum + (d.estimated_value || 0), 0) || 0;
    const avgConfidence = detections && detections.length > 0
      ? (detections.reduce((sum, d) => sum + (d.confidence_score || 0), 0) / detections.length * 100).toFixed(1)
      : '0';

    console.log(`   ✅ Detection results:`);
    console.log(`      Total Detections: ${detectionCount}`);
    console.log(`      Total Value: $${totalValue.toFixed(2)}`);
    console.log(`      Average Confidence: ${avgConfidence}%\n`);

    // Step 4: Summary
    console.log('📈 Dataset Generation Summary:');
    console.log('================================');
    console.log(`User ID: ${testUser.id}`);
    console.log(`Seller ID: ${TEST_SELLER_ID}`);
    console.log(`Sync ID: ${syncResult.syncId}`);
    console.log(`Total Duration: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    console.log(`\n✅ Dataset ready for frontend testing!`);
    console.log(`\n🔗 Use this user ID in your frontend: ${testUser.id}`);
    console.log(`   Or seller ID: ${TEST_SELLER_ID}`);

    return {
      success: true,
      userId: testUser.id,
      sellerId: TEST_SELLER_ID,
      syncId: syncResult.syncId,
      summary: syncResult.summary,
      detections: {
        count: detectionCount,
        totalValue,
        avgConfidence
      },
      duration: Date.now() - startTime
    };

  } catch (error: any) {
    console.error('\n❌ Dataset generation failed:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    // Cleanup env vars
    delete process.env.ENABLE_MOCK_SP_API;
    delete process.env.USE_MOCK_DATA_GENERATOR;
    delete process.env.MOCK_SCENARIO;
    delete process.env.MOCK_RECORD_COUNT;
  }
}

if (require.main === module) {
  generateLargeDataset()
    .then(result => {
      console.log('\n🎉 Generation complete!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export default generateLargeDataset;

