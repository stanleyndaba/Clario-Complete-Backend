/**
 * Check specific sync for claims detected
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import { syncJobManager } from '../src/services/syncJobManager';

const SYNC_ID = 'sync_demo-user_1763509766018';

async function checkSyncClaims() {
  console.log('🔍 Checking sync for claims...\n');
  console.log(`Sync ID: ${SYNC_ID}\n`);

  // 1. Find sync in database
  console.log('1. Looking up sync in database...');
  const { data: syncs, error: syncError } = await supabaseAdmin
    .from('sync_progress')
    .select('sync_id, user_id, status, progress, metadata, created_at, updated_at')
    .eq('sync_id', SYNC_ID);

  if (syncError) {
    console.error('❌ Error querying sync:', syncError.message);
    return;
  }

  if (!syncs || syncs.length === 0) {
    console.error('❌ Sync not found');
    console.log('\nSearching for recent demo-user syncs...\n');
    const { data: recentSyncs } = await supabaseAdmin
      .from('sync_progress')
      .select('sync_id, user_id, status, progress, metadata, created_at')
      .like('sync_id', 'sync_demo-user%')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (recentSyncs && recentSyncs.length > 0) {
      console.log('Recent demo-user syncs:');
      recentSyncs.forEach(s => {
        const m = (s.metadata as any) || {};
        console.log(`  - ${s.sync_id} (status: ${s.status}, claimsDetected: ${m.claimsDetected || 0}, created: ${s.created_at})`);
      });
    }
    return;
  }

  const sync = syncs[0]; // Use first match
  if (syncs.length > 1) {
    console.log(`⚠️  Found ${syncs.length} matches, using first one`);
  }

  const metadata = (sync.metadata as any) || {};
  console.log(`   user_id: ${sync.user_id}`);
  console.log(`   status: ${sync.status}`);
  console.log(`   progress: ${sync.progress}%`);
  console.log(`   created_at: ${sync.created_at}`);
  console.log(`   updated_at: ${sync.updated_at}`);
  console.log(`   metadata.claimsDetected: ${metadata.claimsDetected || 0}\n`);

  // 2. Check database directly for detection_results
  console.log('2. Checking detection_results table...');
  const { count: dbCount, error: countError } = await supabaseAdmin
    .from('detection_results')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', sync.user_id)
    .eq('sync_id', SYNC_ID);

  if (countError) {
    console.error('❌ Error counting detection_results:', countError);
    return;
  }

  console.log(`   Database claimsDetected: ${dbCount || 0}\n`);

  // 3. Test getSyncStatus
  console.log('3. Testing syncJobManager.getSyncStatus...');
  const syncStatus = await syncJobManager.getSyncStatus(SYNC_ID, sync.user_id);

  if (!syncStatus) {
    console.error('❌ getSyncStatus returned null');
    return;
  }

  console.log(`   getSyncStatus.claimsDetected: ${syncStatus.claimsDetected}\n`);

  // 4. Summary
  console.log('📊 Summary:');
  console.log(`   Metadata: ${metadata.claimsDetected || 0}`);
  console.log(`   Database: ${dbCount || 0}`);
  console.log(`   getSyncStatus: ${syncStatus.claimsDetected}`);

  if (dbCount && dbCount > 0 && syncStatus.claimsDetected === dbCount) {
    console.log('\n✅ SUCCESS! All counts match - fix is working!');
  } else if (dbCount && dbCount > 0 && syncStatus.claimsDetected === 0) {
    console.log('\n❌ ISSUE! Database has claims but getSyncStatus returns 0');
    console.log('   The fix may not be deployed or there may be another issue.');
  } else if (dbCount === 0 && syncStatus.claimsDetected === 0) {
    console.log('\n⚠️  No claims detected in database - this sync may not have gone through detection yet');
  } else {
    console.log('\n⚠️  Counts do not match - investigate further');
  }
}

checkSyncClaims().catch(console.error);

