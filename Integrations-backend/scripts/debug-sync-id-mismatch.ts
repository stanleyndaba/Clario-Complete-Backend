/**
 * Debug sync_id mismatch between detection_results and sync_progress
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uuuqpujtnubusmigbkvw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dXFwdWp0bnVidXNtaWdia3Z3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzM5NjgzOSwiZXhwIjoyMDY4OTcyODM5fQ.Z_1TUlk3WgtCggP80UYPGj8gK-JKdgjPf3rNkHxIrBE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function debugSyncIdMismatch() {
  console.log('\n🔍 Debugging sync_id mismatch...\n');

  // Get the most recent sync
  const { data: syncs } = await supabase
    .from('sync_progress')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!syncs || syncs.length === 0) {
    console.error('❌ No syncs found');
    return;
  }

  const sync = syncs[0];
  console.log(`Sync Progress:`);
  console.log(`  sync_id: ${sync.sync_id}`);
  console.log(`  user_id: ${sync.user_id}\n`);

  // Check detection_results with this sync_id
  const { data: results, count, error } = await supabase
    .from('detection_results')
    .select('sync_id, seller_id', { count: 'exact' })
    .eq('seller_id', sync.user_id)
    .eq('sync_id', sync.sync_id);

  console.log(`Detection Results query (sync_id = ${sync.sync_id}):`);
  console.log(`  Count: ${count || 0}`);
  if (error) {
    console.log(`  Error: ${error.message}`);
  }

  // Check all detection_results for this user
  const { data: allResults, count: allCount } = await supabase
    .from('detection_results')
    .select('sync_id, seller_id', { count: 'exact' })
    .eq('seller_id', sync.user_id)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log(`\nAll Detection Results for user ${sync.user_id}:`);
  console.log(`  Total count: ${allCount || 0}`);
  
  if (allResults && allResults.length > 0) {
    const uniqueSyncIds = [...new Set(allResults.map(r => r.sync_id))];
    console.log(`  Unique sync_ids: ${uniqueSyncIds.join(', ')}`);
    console.log(`\n  Sample results:`);
    allResults.slice(0, 5).forEach((r: any, idx: number) => {
      console.log(`    ${idx + 1}. sync_id: ${r.sync_id}`);
    });
  }

  // Check if sync_id matches
  if (allResults && allResults.length > 0) {
    const matchingResults = allResults.filter(r => r.sync_id === sync.sync_id);
    console.log(`\n  Results matching sync_id ${sync.sync_id}: ${matchingResults.length}`);
    
    if (matchingResults.length === 0 && allCount && allCount > 0) {
      console.log(`\n❌ MISMATCH FOUND!`);
      console.log(`  Detection results exist but sync_id doesn't match!`);
      console.log(`  Expected: ${sync.sync_id}`);
      console.log(`  Found: ${allResults[0].sync_id}`);
    }
  }

  console.log('\n');
}

debugSyncIdMismatch().catch(console.error);

















