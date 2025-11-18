/**
 * Debug script to trace why claimsDetected is 0
 *
 * Checks:
 * 1. What sync_id is used in sync_progress
 * 2. What sync_id is used when storing detection_results
 * 3. Whether detection_results are actually stored
 * 4. Whether the query in getSyncResults matches correctly
 *
 * Usage:
 *   ts-node scripts/debug-storage-flow.ts <syncId> <userId>
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

const TEST_SYNC_ID = process.argv[2] || 'sync_test-discovery-1763473552074_1763473553509';
const TEST_USER_ID = process.argv[3] || 'test-discovery-1763473552074';

async function debugStorageFlow() {
  console.log('🔍 Debugging Storage Flow\n');
  console.log(`Sync ID: ${TEST_SYNC_ID}`);
  console.log(`User ID: ${TEST_USER_ID}\n`);

  // 1. Check sync_progress table
  console.log('='.repeat(60));
  console.log('1. Checking sync_progress table');
  console.log('='.repeat(60));

  const { data: syncProgress, error: syncError } = await supabaseAdmin
    .from('sync_progress')
    .select('*')
    .eq('sync_id', TEST_SYNC_ID)
    .eq('user_id', TEST_USER_ID)
    .maybeSingle();

  if (syncError) {
    console.error('❌ Error querying sync_progress:', syncError);
  } else if (!syncProgress) {
    console.log('⚠️  No sync_progress record found');
    console.log('   Trying without user_id filter...');

    const { data: syncProgressAny } = await supabaseAdmin
      .from('sync_progress')
      .select('*')
      .eq('sync_id', TEST_SYNC_ID)
      .maybeSingle();

    if (syncProgressAny) {
      console.log('✅ Found sync_progress with different user_id:', syncProgressAny.user_id);
      console.log('   Metadata:', JSON.stringify(syncProgressAny.metadata, null, 2));
    } else {
      console.log('❌ No sync_progress found with this sync_id at all');
    }
  } else {
    console.log('✅ Found sync_progress record:');
    console.log('   sync_id:', syncProgress.sync_id);
    console.log('   user_id:', syncProgress.user_id);
    console.log('   status:', syncProgress.status);
    console.log('   progress:', syncProgress.progress);
    console.log('   metadata:', JSON.stringify(syncProgress.metadata, null, 2));
  }

  // 2. Check detection_results table
  console.log('\n' + '='.repeat(60));
  console.log('2. Checking detection_results table');
  console.log('='.repeat(60));

  const { data: detectionResults, error: detectionError } = await supabaseAdmin
    .from('detection_results')
    .select('*')
    .eq('sync_id', TEST_SYNC_ID)
    .eq('seller_id', TEST_USER_ID);

  if (detectionError) {
    console.error('❌ Error querying detection_results:', detectionError);
  } else if (!detectionResults || detectionResults.length === 0) {
    console.log('⚠️  No detection_results found with exact match');
    console.log('   Checking all detection_results for this user...');

    const { data: allUserDetections } = await supabaseAdmin
      .from('detection_results')
      .select('sync_id, seller_id, anomaly_type, estimated_value, created_at')
      .eq('seller_id', TEST_USER_ID)
      .order('created_at', { ascending: false })
      .limit(10);

    if (allUserDetections && allUserDetections.length > 0) {
      console.log(`   Found ${allUserDetections.length} detection_results for this user:`);
      allUserDetections.forEach((det, idx) => {
        console.log(`   ${idx + 1}. sync_id: ${det.sync_id}, type: ${det.anomaly_type}, value: ${det.estimated_value}`);
      });
      console.log(`\n   ⚠️  The sync_id in detection_results (${allUserDetections[0]?.sync_id}) doesn't match sync_progress sync_id (${TEST_SYNC_ID})`);
    } else {
      console.log('   ❌ No detection_results found for this user at all');
    }

    // Also check by sync_id only
    console.log('\n   Checking all detection_results with this sync_id (any seller_id)...');
    const { data: allSyncDetections } = await supabaseAdmin
      .from('detection_results')
      .select('sync_id, seller_id, anomaly_type, estimated_value, created_at')
      .eq('sync_id', TEST_SYNC_ID)
      .order('created_at', { ascending: false })
      .limit(10);

    if (allSyncDetections && allSyncDetections.length > 0) {
      console.log(`   Found ${allSyncDetections.length} detection_results with this sync_id:`);
      allSyncDetections.forEach((det, idx) => {
        console.log(`   ${idx + 1}. seller_id: ${det.seller_id}, type: ${det.anomaly_type}, value: ${det.estimated_value}`);
      });
      console.log(`\n   ⚠️  The seller_id in detection_results (${allSyncDetections[0]?.seller_id}) doesn't match user_id (${TEST_USER_ID})`);
    } else {
      console.log('   ❌ No detection_results found with this sync_id at all');
    }
  } else {
    console.log(`✅ Found ${detectionResults.length} detection_results:`);
    detectionResults.slice(0, 5).forEach((det, idx) => {
      console.log(`   ${idx + 1}. ${det.anomaly_type} - $${det.estimated_value} (confidence: ${det.confidence_score})`);
    });
    if (detectionResults.length > 5) {
      console.log(`   ... and ${detectionResults.length - 5} more`);
    }
  }

  // 3. Check detection_queue table
  console.log('\n' + '='.repeat(60));
  console.log('3. Checking detection_queue table');
  console.log('='.repeat(60));

  const { data: detectionQueue, error: queueError } = await supabaseAdmin
    .from('detection_queue')
    .select('*')
    .eq('sync_id', TEST_SYNC_ID)
    .eq('seller_id', TEST_USER_ID)
    .order('created_at', { ascending: false })
    .limit(1);

  if (queueError) {
    console.error('❌ Error querying detection_queue:', queueError);
  } else if (!detectionQueue || detectionQueue.length === 0) {
    console.log('⚠️  No detection_queue record found');
  } else {
    console.log('✅ Found detection_queue record:');
    console.log('   sync_id:', detectionQueue[0].sync_id);
    console.log('   seller_id:', detectionQueue[0].seller_id);
    console.log('   status:', detectionQueue[0].status);
    console.log('   payload:', JSON.stringify(detectionQueue[0].payload, null, 2));
  }

  // 4. Simulate the exact query from getSyncResults
  console.log('\n' + '='.repeat(60));
  console.log('4. Simulating getSyncResults query');
  console.log('='.repeat(60));

  const { count: claimsCount, error: countError } = await supabaseAdmin
    .from('detection_results')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', TEST_USER_ID)
    .eq('sync_id', TEST_SYNC_ID);

  if (countError) {
    console.error('❌ Error counting detection_results:', countError);
  } else {
    console.log(`✅ Query result: ${claimsCount || 0} claims detected`);
    if ((claimsCount || 0) === 0) {
      console.log('   ⚠️  This matches the 0 claimsDetected in the API response');
    }
  }

  // 5. Check what sync_id Agent 2 actually uses
  console.log('\n' + '='.repeat(60));
  console.log('5. Checking Agent 2 sync_id pattern');
  console.log('='.repeat(60));

  const agent2SyncIdPattern = `agent2_sync_${TEST_USER_ID}_%`;
  const { data: agent2Syncs } = await supabaseAdmin
    .from('sync_progress')
    .select('sync_id, user_id, status, metadata')
    .ilike('sync_id', agent2SyncIdPattern)
    .order('created_at', { ascending: false })
    .limit(5);

  if (agent2Syncs && agent2Syncs.length > 0) {
    console.log(`Found ${agent2Syncs.length} Agent 2 sync_ids:`);
    agent2Syncs.forEach((sync, idx) => {
      console.log(`   ${idx + 1}. ${sync.sync_id} (status: ${sync.status})`);
      const metadata = (sync.metadata as any) || {};
      console.log(`      claimsDetected in metadata: ${metadata.claimsDetected || 0}`);
    });
  } else {
    console.log('No Agent 2 sync_ids found');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log('If claimsDetected is 0, possible causes:');
  console.log('1. Detection results stored with different sync_id than sync_progress');
  console.log('2. Detection results stored with different seller_id than user_id');
  console.log('3. Detection results not stored at all (check logs for errors)');
  console.log('4. Python API returned all claimable=false predictions');
  console.log('5. No claims were prepared from normalized data');
}

debugStorageFlow().catch(error => {
  console.error('❌ Debug script error:', error);
  process.exit(1);
});
