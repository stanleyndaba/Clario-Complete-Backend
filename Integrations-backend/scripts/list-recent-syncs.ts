/**
 * List recent sync_progress records to see what sync_ids exist
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function listRecentSyncs() {
  console.log('📋 Listing Recent Syncs\n');

  const { data: syncs, error } = await supabaseAdmin
    .from('sync_progress')
    .select('sync_id, user_id, status, progress, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!syncs || syncs.length === 0) {
    console.log('⚠️  No sync_progress records found');
    return;
  }

  console.log(`Found ${syncs.length} recent syncs:\n`);
  syncs.forEach((sync, idx) => {
    const metadata = (sync.metadata as any) || {};
    console.log(`${idx + 1}. sync_id: ${sync.sync_id}`);
    console.log(`   user_id: ${sync.user_id}`);
    console.log(`   status: ${sync.status}`);
    console.log(`   progress: ${sync.progress || 'N/A'}`);
    console.log(`   claimsDetected: ${metadata.claimsDetected || 0}`);
    console.log(`   created_at: ${sync.created_at}`);
    console.log('');
  });

  // Also check detection_results
  console.log('\n📊 Recent Detection Results:\n');
  const { data: detections, error: detError } = await supabaseAdmin
    .from('detection_results')
    .select('sync_id, seller_id, anomaly_type, estimated_value, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (detError) {
    console.error('❌ Error:', detError);
  } else if (!detections || detections.length === 0) {
    console.log('⚠️  No detection_results found');
  } else {
    console.log(`Found ${detections.length} recent detections:\n`);
    detections.forEach((det, idx) => {
      console.log(`${idx + 1}. sync_id: ${det.sync_id}`);
      console.log(`   seller_id: ${det.seller_id}`);
      console.log(`   type: ${det.anomaly_type}`);
      console.log(`   value: $${det.estimated_value}`);
      console.log(`   created_at: ${det.created_at}`);
      console.log('');
    });
  }
}

listRecentSyncs().catch(error => {
  console.error('❌ Script error:', error);
  process.exit(1);
});




















