/**
 * Test syncJobManager.getSyncStatus directly to verify the fix
 */

import 'dotenv/config';
import { syncJobManager } from '../src/services/syncJobManager';
import { supabase, supabaseAdmin } from '../src/database/supabaseClient';

const TEST_SYNC_ID = 'sync_test-discovery-1763504060197_1763504064920';
const TEST_USER_ID = 'test-discovery-1763504060197';

async function testSyncStatusDirect() {
  console.log('🧪 Testing syncJobManager.getSyncStatus directly\n');
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

  console.log(`   Database claimsDetected (admin client): ${dbCount || 0}\n`);

  // 1b. Test with regular supabase client (same as getSyncResults uses)
  console.log('1b. Checking database with regular supabase client (same as getSyncResults)...');
  const { count: dbCountRegular, error: countErrorRegular } = await supabase
    .from('detection_results')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', TEST_USER_ID)
    .eq('sync_id', TEST_SYNC_ID);

  if (countErrorRegular) {
    console.error('❌ Error counting detection_results (regular client):', countErrorRegular);
  } else {
    console.log(`   Database claimsDetected (regular client): ${dbCountRegular || 0}\n`);
  }

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

  // 3. Call syncJobManager.getSyncStatus directly
  console.log('3. Calling syncJobManager.getSyncStatus...');
  const syncStatus = await syncJobManager.getSyncStatus(TEST_SYNC_ID, TEST_USER_ID);

  if (!syncStatus) {
    console.error('❌ Sync not found');
    return;
  }

  console.log(`   Status: ${syncStatus.status}`);
  console.log(`   Progress: ${syncStatus.progress}%`);
  console.log(`   claimsDetected: ${syncStatus.claimsDetected}\n`);

  // 4. Compare results
  console.log('4. Results comparison:');
  console.log(`   Database count: ${dbCount || 0}`);
  console.log(`   Metadata count: ${syncData ? ((syncData.metadata as any)?.claimsDetected || 0) : 0}`);
  console.log(`   getSyncStatus response: ${syncStatus.claimsDetected}`);
  
  if (syncStatus.claimsDetected === (dbCount || 0)) {
    console.log('\n✅ SUCCESS! getSyncStatus returns correct count from database');
    console.log('   The fix is working! The API should now return the correct count.');
  } else if (dbCount && dbCount > 0 && syncStatus.claimsDetected === 0) {
    console.log('\n❌ FAILED! getSyncStatus still returns 0 despite database having claims');
    console.log('   The fix may not be deployed or there may be another issue.');
  } else {
    console.log('\n⚠️  Mismatch detected - investigate further');
  }
}

testSyncStatusDirect().catch(console.error);

