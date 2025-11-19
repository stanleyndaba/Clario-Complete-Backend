/**
 * Find sync by completion timestamp
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

// User mentioned: Started: 2025/11/19, 01:49:26, Completed: 2025/11/19, 01:49:56
// That's likely 2025-11-19T01:49:26Z (UTC)
const TARGET_START = '2025-11-19T01:49:26';
const TARGET_END = '2025-11-19T01:49:56';

async function findSyncByTimestamp() {
  console.log('🔍 Finding sync by timestamp...\n');
  console.log(`Looking for syncs around ${TARGET_START} - ${TARGET_END}\n`);

  // Search for syncs in that time window
  const { data: syncs, error } = await supabaseAdmin
    .from('sync_progress')
    .select('sync_id, user_id, status, progress, metadata, created_at, updated_at')
    .gte('created_at', '2025-11-19T01:49:00')
    .lte('created_at', '2025-11-19T01:50:00')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!syncs || syncs.length === 0) {
    console.log('⚠️  No syncs found in that time window');
    console.log('\nChecking all recent syncs from today...\n');
    
    // Try a broader search
    const { data: allSyncs } = await supabaseAdmin
      .from('sync_progress')
      .select('sync_id, user_id, status, progress, metadata, created_at, updated_at')
      .gte('created_at', '2025-11-19T00:00:00')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (allSyncs && allSyncs.length > 0) {
      console.log(`Found ${allSyncs.length} syncs from today:\n`);
      allSyncs.forEach((sync, idx) => {
        const metadata = (sync.metadata as any) || {};
        console.log(`${idx + 1}. sync_id: ${sync.sync_id}`);
        console.log(`   user_id: ${sync.user_id}`);
        console.log(`   status: ${sync.status}`);
        console.log(`   created_at: ${sync.created_at}`);
        console.log(`   updated_at: ${sync.updated_at}`);
        console.log(`   claimsDetected (metadata): ${metadata.claimsDetected || 0}`);
        
        // Check detection_results count
        (async () => {
          const { count } = await supabaseAdmin
            .from('detection_results')
            .select('id', { count: 'exact', head: true })
            .eq('seller_id', sync.user_id)
            .eq('sync_id', sync.sync_id);
          console.log(`   claimsDetected (database): ${count || 0}\n`);
        })();
      });
    } else {
      console.log('No syncs found from today');
    }
    return;
  }

  console.log(`Found ${syncs.length} sync(s):\n`);
  for (const sync of syncs) {
    const metadata = (sync.metadata as any) || {};
    console.log(`sync_id: ${sync.sync_id}`);
    console.log(`user_id: ${sync.user_id}`);
    console.log(`status: ${sync.status}`);
    console.log(`progress: ${sync.progress || 'N/A'}`);
    console.log(`created_at: ${sync.created_at}`);
    console.log(`updated_at: ${sync.updated_at}`);
    console.log(`claimsDetected (metadata): ${metadata.claimsDetected || 0}`);
    
    // Check database count
    const { count: dbCount } = await supabaseAdmin
      .from('detection_results')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sync.user_id)
      .eq('sync_id', sync.sync_id);
    
    console.log(`claimsDetected (database): ${dbCount || 0}\n`);
  }
}

findSyncByTimestamp().catch(console.error);











