/**
 * Quick validation that SUPABASE_SERVICE_ROLE_KEY can write to the tables
 * Agent 2 needs (detection_results + sync_progress).
 *
 * Usage:
 *   npx ts-node scripts/test-supabase-service-role.ts
 *
 * Environment:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set (same as backend).
 */

import { supabaseAdmin } from '../src/database/supabaseClient';

const TEST_USER_ID = process.env.TEST_USER_ID || `service-role-test-${Date.now()}`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function assertAdminClient() {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    throw new Error(
      'supabaseAdmin client is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this test.'
    );
  }
}

async function upsertSyncProgress(syncId: string) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('sync_progress')
    .upsert(
      {
        user_id: TEST_USER_ID,
        sync_id: syncId,
        status: 'completed',
        progress: 100,
        current_step: 'Service role permission check',
        metadata: {
          claimsDetected: 0,
          ordersProcessed: 0,
          totalOrders: 0,
          testRun: true
        },
        created_at: now,
        updated_at: now
      },
      { onConflict: 'sync_id' }
    );

  if (error) {
    throw new Error(`Failed to upsert sync_progress (service role might be missing write perms): ${error.message}`);
  }
}

async function insertDetectionResult(syncId: string) {
  const now = new Date();
  const discoveryDate = now.toISOString();
  const deadlineDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const detectionPayload = {
    seller_id: TEST_USER_ID,
    sync_id: syncId,
    anomaly_type: 'missing_unit',
    severity: 'medium',
    estimated_value: 123.45,
    currency: 'USD',
    confidence_score: 0.67,
    evidence: { source: 'service-role-test-script' },
    related_event_ids: ['service-role-test-event'],
    discovery_date: discoveryDate,
    deadline_date: deadlineDate,
    days_remaining: 60,
    expired: false,
    expiration_alert_sent: false,
    status: 'pending',
    created_at: discoveryDate,
    updated_at: discoveryDate
  };

  const { data, error } = await supabaseAdmin
    .from('detection_results')
    .insert(detectionPayload)
    .select('id');

  if (error) {
    throw new Error(`Failed to insert into detection_results (service role may lack insert privileges): ${error.message}`);
  }

  return data?.[0]?.id as string | undefined;
}

async function verifyDetectionPersisted(syncId: string) {
  const { data, error } = await supabaseAdmin
    .from('detection_results')
    .select('id, estimated_value, confidence_score')
    .eq('sync_id', syncId);

  if (error) {
    throw new Error(`Failed to read detection_results (service role may lack read privileges): ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error('Detection record insert appeared to succeed but no rows were returned when querying by sync_id.');
  }

  return data;
}

async function cleanupDetection(syncId: string) {
  await supabaseAdmin.from('detection_results').delete().eq('sync_id', syncId);
}

async function main() {
  await assertAdminClient();

  const syncId = `sync_service_role_test_${Date.now()}`;

  console.log('🔐 Testing Supabase service role permissions');
  console.log('   User:', TEST_USER_ID);
  console.log('   Sync ID:', syncId);

  await upsertSyncProgress(syncId);
  console.log('   ✅ sync_progress upsert succeeded');

  const insertedId = await insertDetectionResult(syncId);
  console.log('   ✅ detection_results insert succeeded', insertedId ? { id: insertedId } : '');

  // Wait briefly to avoid read-after-write race conditions on some Postgres replicas.
  await sleep(750);

  const detections = await verifyDetectionPersisted(syncId);
  console.log('   ✅ detection_results read succeeded', { rows: detections.length });

  await cleanupDetection(syncId);
  console.log('   🧹 cleaned up test detection rows (sync_progress row left for auditing)');

  console.log('\n🎉 Service role key can write to detection_results and sync_progress.\n');
}

main().catch((error) => {
  console.error('\n❌ Service role permission test failed:\n', error);
  process.exit(1);
});


