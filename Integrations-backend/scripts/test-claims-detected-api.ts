/**
 * Test the /api/sync/status endpoint to verify claimsDetected fix
 */

import 'dotenv/config';
import axios from 'axios';
import { supabaseAdmin } from '../src/database/supabaseClient';

const NODE_API_URL = process.env.NODE_API_URL || 'https://opside-node-api.onrender.com';
const TEST_SYNC_ID = 'sync_test-discovery-1763504060197_1763504064920';
const TEST_USER_ID = 'test-discovery-1763504060197';

async function testClaimsDetectedAPI() {
  console.log('🧪 Testing claimsDetected API fix\n');
  console.log(`API URL: ${NODE_API_URL}`);
  console.log(`Sync ID: ${TEST_SYNC_ID}`);
  console.log(`User ID: ${TEST_USER_ID}\n`);

  // 1. Get direct database count
  console.log('1. Checking database directly...');
  const { count: dbCount, error: countError } = await supabaseAdmin
    .from('detection_results')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', TEST_USER_ID)
    .eq('sync_id', TEST_SYNC_ID);

  if (countError) {
    console.error('❌ Error counting detection_results:', countError);
    return;
  }

  console.log(`   Database claimsDetected: ${dbCount || 0}\n`);

  // 2. Check sync_progress metadata
  console.log('2. Checking sync_progress metadata...');
  const { data: syncData } = await supabaseAdmin
    .from('sync_progress')
    .select('status, progress, metadata')
    .eq('sync_id', TEST_SYNC_ID)
    .eq('user_id', TEST_USER_ID)
    .single();

  if (syncData) {
    const metadata = (syncData.metadata as any) || {};
    console.log(`   Status: ${syncData.status}`);
    console.log(`   Progress: ${syncData.progress}%`);
    console.log(`   Metadata.claimsDetected: ${metadata.claimsDetected || 0}\n`);
  }

  // 3. Call the API endpoint
  console.log('3. Calling API endpoint...');
  try {
    const response = await axios.get(`${NODE_API_URL}/api/sync/status/${TEST_SYNC_ID}`, {
      timeout: 30000,
    });

    console.log(`   Status Code: ${response.status}`);
    const apiClaimsDetected = response.data?.claimsDetected ?? 0;
    console.log(`   API claimsDetected: ${apiClaimsDetected}\n`);

    // 4. Compare results
    console.log('4. Results comparison:');
    console.log(`   Database count: ${dbCount || 0}`);
    console.log(`   API response: ${apiClaimsDetected}`);
    
    if (apiClaimsDetected === (dbCount || 0)) {
      console.log('\n✅ SUCCESS! API returns correct count');
    } else if (dbCount && dbCount > 0 && apiClaimsDetected === 0) {
      console.log('\n❌ FAILED! API still returns 0 despite database having claims');
      console.log('   The fix may not be deployed or there may be another issue.');
    } else {
      console.log('\n⚠️  Mismatch detected - investigate further');
    }
  } catch (error: any) {
    console.error('❌ Error calling API:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', error.response.data);
    }
  }
}

testClaimsDetectedAPI().catch(console.error);











