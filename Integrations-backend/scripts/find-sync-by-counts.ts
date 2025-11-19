/**
 * Find sync by data counts (75 orders, 75 inventory, 52 shipments, 37 returns, 45 settlements)
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import { syncJobManager } from '../src/services/syncJobManager';

async function findSyncByCounts() {
  console.log('🔍 Finding sync by data counts...\n');
  console.log('Looking for syncs with: 75 orders, 75 inventory, 52 shipments, 37 returns, 45 settlements\n');

  // Get all recent syncs and check their metadata
  const { data: syncs, error } = await supabaseAdmin
    .from('sync_progress')
    .select('sync_id, user_id, status, progress, metadata, created_at, updated_at, current_step')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!syncs || syncs.length === 0) {
    console.log('⚠️  No completed syncs found');
    return;
  }

  console.log(`Checking ${syncs.length} completed syncs...\n`);
  
  for (const sync of syncs) {
    const metadata = (sync.metadata as any) || {};
    const ordersProcessed = metadata.ordersProcessed || 0;
    const inventoryCount = metadata.inventoryCount || 0;
    const shipmentsCount = metadata.shipmentsCount || 0;
    const returnsCount = metadata.returnsCount || 0;
    const settlementsCount = metadata.settlementsCount || 0;
    
    // Check if this matches the description (75 orders, 75 inventory, 52 shipments, 37 returns, 45 settlements)
    if (ordersProcessed === 75 && inventoryCount === 75 && 
        shipmentsCount === 52 && returnsCount === 37 && settlementsCount === 45) {
      console.log('✅ FOUND MATCHING SYNC:');
      console.log(`   sync_id: ${sync.sync_id}`);
      console.log(`   user_id: ${sync.user_id}`);
      console.log(`   status: ${sync.status}`);
      console.log(`   progress: ${sync.progress}%`);
      console.log(`   message: ${sync.current_step || 'N/A'}`);
      console.log(`   created_at: ${sync.created_at}`);
      console.log(`   updated_at: ${sync.updated_at}`);
      console.log(`   ordersProcessed: ${ordersProcessed}`);
      console.log(`   inventoryCount: ${inventoryCount}`);
      console.log(`   shipmentsCount: ${shipmentsCount}`);
      console.log(`   returnsCount: ${returnsCount}`);
      console.log(`   settlementsCount: ${settlementsCount}`);
      console.log(`   claimsDetected (metadata): ${metadata.claimsDetected || 0}`);
      
      // Check database count
      const { count: dbCount } = await supabaseAdmin
        .from('detection_results')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', sync.user_id)
        .eq('sync_id', sync.sync_id);
      
      console.log(`   claimsDetected (database): ${dbCount || 0}\n`);
      
      // Now test getSyncStatus
      console.log('🧪 Testing syncJobManager.getSyncStatus...');
      const syncStatus = await syncJobManager.getSyncStatus(sync.sync_id, sync.user_id);
      
      if (syncStatus) {
        console.log(`   getSyncStatus returns: ${syncStatus.claimsDetected} claims detected`);
        if (syncStatus.claimsDetected === (dbCount || 0)) {
          console.log('   ✅ getSyncStatus returns correct count!');
        } else {
          console.log(`   ❌ getSyncStatus mismatch! Expected ${dbCount || 0}, got ${syncStatus.claimsDetected}`);
        }
      }
      
      console.log('\n');
      break;
    }
  }
  
  // If no exact match, show closest matches
  console.log('\n📊 Closest matches (within ±5):\n');
  for (const sync of syncs.slice(0, 5)) {
    const metadata = (sync.metadata as any) || {};
    console.log(`sync_id: ${sync.sync_id}`);
    console.log(`   user_id: ${sync.user_id}`);
    console.log(`   orders: ${metadata.ordersProcessed || 0}, inventory: ${metadata.inventoryCount || 0}`);
    console.log(`   shipments: ${metadata.shipmentsCount || 0}, returns: ${metadata.returnsCount || 0}`);
    console.log(`   settlements: ${metadata.settlementsCount || 0}`);
    console.log(`   claimsDetected: ${metadata.claimsDetected || 0}`);
    console.log(`   created_at: ${sync.created_at}\n`);
  }
}

findSyncByCounts().catch(console.error);

