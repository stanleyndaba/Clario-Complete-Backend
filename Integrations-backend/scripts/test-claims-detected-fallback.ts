/**
 * Test if getSyncResults correctly finds detection results
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

const TEST_SYNC_ID = 'sync_test-discovery-1763504060197_1763504064920';
const TEST_USER_ID = 'test-discovery-1763504060197';

async function testClaimsDetectedFallback() {
  console.log('🔍 Testing claimsDetected fallback logic\n');
  console.log(`Sync ID: ${TEST_SYNC_ID}`);
  console.log(`User ID: ${TEST_USER_ID}\n`);

  // 1. Check sync_progress metadata
  console.log('1. Checking sync_progress metadata...');
  const { data: syncData, error: syncError } = await supabaseAdmin
    .from('sync_progress')
    .select('*')
    .eq('sync_id', TEST_SYNC_ID)
    .eq('user_id', TEST_USER_ID)
    .single();

  if (syncError || !syncData) {
    console.error('❌ Error fetching sync_progress:', syncError);
    return;
  }

  const metadata = (syncData.metadata as any) || {};
  console.log(`   Status: ${syncData.status}`);
  console.log(`   Progress: ${syncData.progress}%`);
  console.log(`   Metadata.claimsDetected: ${metadata.claimsDetected || 0}\n`);

  // 2. Query detection_results directly (same query as getSyncResults)
  console.log('2. Querying detection_results (same as getSyncResults)...');
  const { count: claimsCount, error: countError } = await supabaseAdmin
    .from('detection_results')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', TEST_USER_ID)
    .eq('sync_id', TEST_SYNC_ID);

  if (countError) {
    console.error('❌ Error counting detection_results:', countError);
    return;
  }

  console.log(`   Database claimsDetected count: ${claimsCount || 0}\n`);

  // 3. Check if there's a mismatch
  const metadataCount = metadata.claimsDetected || 0;
  const dbCount = claimsCount || 0;

  if (metadataCount === 0 && dbCount > 0) {
    console.log('⚠️  ISSUE FOUND:');
    console.log(`   - Metadata shows: ${metadataCount}`);
    console.log(`   - Database shows: ${dbCount}`);
    console.log(`   - The fallback logic should have caught this!\n`);

    // 4. Test the exact condition from getSyncStatus
    const normalizedStatus = syncData.status === 'completed' ? 'completed' : 
                             syncData.status === 'failed' ? 'failed' : 
                             'running';
    const shouldTriggerFallback = metadataCount === 0 && (
      normalizedStatus === 'completed' || 
      normalizedStatus === 'failed' || 
      (syncData.progress && syncData.progress >= 80)
    );

    console.log('4. Fallback condition check:');
    console.log(`   normalizedStatus: ${normalizedStatus}`);
    console.log(`   metadataCount === 0: ${metadataCount === 0}`);
    console.log(`   shouldTriggerFallback: ${shouldTriggerFallback}\n`);

    if (!shouldTriggerFallback) {
      console.log('❌ Fallback condition is FALSE - this is the bug!');
    } else {
      console.log('✅ Fallback condition is TRUE - getSyncResults should have been called');
      console.log('   But API still returned 0. This suggests getSyncResults might have an issue.');
    }
  } else if (metadataCount === dbCount && dbCount > 0) {
    console.log('✅ Metadata matches database - no issue');
  } else {
    console.log('ℹ️  Both show 0 claims - Discovery Agent may not have found any claimable items');
  }
}

testClaimsDetectedFallback().catch(console.error);













