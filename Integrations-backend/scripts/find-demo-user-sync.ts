/**
 * Find latest demo-user sync
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function findDemoUserSync() {
  console.log('🔍 Finding latest demo-user sync...\n');

  // Search for demo-user syncs
  const { data: syncs, error } = await supabaseAdmin
    .from('sync_progress')
    .select('sync_id, user_id, status, progress, metadata, created_at, updated_at, current_step')
    .like('user_id', 'demo-user%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!syncs || syncs.length === 0) {
    console.log('⚠️  No demo-user syncs found');
    return;
  }

  console.log(`Found ${syncs.length} demo-user sync(s):\n`);
  for (const sync of syncs) {
    const metadata = (sync.metadata as any) || {};
    console.log(`sync_id: ${sync.sync_id}`);
    console.log(`user_id: ${sync.user_id}`);
    console.log(`status: ${sync.status}`);
    console.log(`progress: ${sync.progress || 'N/A'}%`);
    console.log(`message: ${sync.current_step || 'N/A'}`);
    console.log(`created_at: ${sync.created_at}`);
    console.log(`updated_at: ${sync.updated_at}`);
    console.log(`claimsDetected (metadata): ${metadata.claimsDetected || 0}`);
    
    // Check database count
    const { count: dbCount } = await supabaseAdmin
      .from('detection_results')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sync.user_id)
      .eq('sync_id', sync.sync_id);
    
    console.log(`claimsDetected (database): ${dbCount || 0}`);
    
    // Check if there are any detection_results for this sync
    if (dbCount && dbCount > 0) {
      const { data: samples } = await supabaseAdmin
        .from('detection_results')
        .select('id, sync_id, seller_id, anomaly_type, created_at')
        .eq('seller_id', sync.user_id)
        .eq('sync_id', sync.sync_id)
        .limit(3);
      
      console.log(`   Sample detection_results: ${samples?.length || 0} shown`);
      if (samples && samples.length > 0) {
        console.log(`   First result: ${samples[0].anomaly_type} (created: ${samples[0].created_at})`);
      }
    }
    
    console.log('\n---\n');
  }
}

findDemoUserSync().catch(console.error);











