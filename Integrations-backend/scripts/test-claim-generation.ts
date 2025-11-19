/**
 * Test if claims are being generated from normalized data
 * Simulates what happens during a sync
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uuuqpujtnubusmigbkvw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dXFwdWp0bnVidXNtaWdia3Z3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzM5NjgzOSwiZXhwIjoyMDY4OTcyODM5fQ.Z_1TUlk3WgtCggP80UYPGj8gK-JKdgjPf3rNkHxIrBE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkLatestSync() {
  console.log('\n🔍 Checking latest sync for claim generation...\n');

  // Get the most recent sync
  const { data: syncs, error } = await supabase
    .from('sync_progress')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !syncs || syncs.length === 0) {
    console.error('❌ No syncs found or error:', error);
    return;
  }

  const sync = syncs[0];
  console.log(`Sync ID: ${sync.sync_id}`);
  console.log(`User ID: ${sync.user_id}`);
  console.log(`Status: ${sync.status}`);
  console.log(`Progress: ${sync.progress}%`);
  console.log(`Created: ${sync.created_at}\n`);

  // Check detection queue
  const { data: detectionQueue } = await supabase
    .from('detection_queue')
    .select('*')
    .eq('sync_id', sync.sync_id)
    .eq('seller_id', sync.user_id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (detectionQueue && detectionQueue.length > 0) {
    const queue = detectionQueue[0];
    console.log('📋 Detection Queue:');
    console.log(`  Status: ${queue.status}`);
    console.log(`  Payload:`, JSON.stringify(queue.payload, null, 2));
    console.log(`  Error: ${queue.error_message || 'None'}\n`);
  } else {
    console.log('⚠️ No detection_queue entry found\n');
  }

  // Check detection results
  const { data: results, count } = await supabase
    .from('detection_results')
    .select('*', { count: 'exact' })
    .eq('sync_id', sync.sync_id)
    .eq('seller_id', sync.user_id);

  console.log(`📊 Detection Results: ${count || 0} found\n`);

  if (results && results.length > 0) {
    console.log('Sample results:');
    results.slice(0, 3).forEach((r: any, idx: number) => {
      console.log(`  ${idx + 1}. ${r.anomaly_type} - $${r.estimated_value} (confidence: ${r.confidence_score})`);
    });
  }

  // Check if metadata has info about orders/shipments
  if (sync.metadata) {
    console.log('\n📦 Sync Metadata:');
    console.log(`  Orders: ${sync.metadata.ordersCount || 0}`);
    console.log(`  Shipments: ${sync.metadata.shipmentsCount || 0}`);
    console.log(`  Returns: ${sync.metadata.returnsCount || 0}`);
    console.log(`  Settlements: ${sync.metadata.settlementsCount || 0}`);
    console.log(`  Claims Detected: ${sync.metadata.claimsDetected || 0}`);
  }

  console.log('\n');
}

checkLatestSync().catch(console.error);

















