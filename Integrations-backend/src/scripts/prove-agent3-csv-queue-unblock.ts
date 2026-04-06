import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { csvIngestionService } from '../services/csvIngestionService';
import { supabaseAdmin, isRealDatabaseConfigured } from '../database/supabaseClient';

type CountResult = {
  count: number;
  error: string | null;
};

const DEMO_DIR = path.resolve(process.cwd(), 'demo-csv');

async function ensureFreshTenantAndUser() {
  const stamp = Date.now();
  const tenantSlug = `agent3-demo-csv-${stamp}`;
  const tenantName = `Agent 3 Demo CSV ${stamp}`;
  const userId = crypto.randomUUID();
  const tenantEmail = `agent3-demo-csv-${stamp}@example.com`;

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .insert({
      name: tenantName,
      slug: tenantSlug,
      status: 'active',
      plan: 'enterprise',
    })
    .select('id, slug')
    .single();

  if (tenantError || !tenant?.id) {
    throw new Error(`Failed creating tenant: ${tenantError?.message || 'unknown error'}`);
  }

  const { error: userError } = await supabaseAdmin
    .from('users')
    .insert({
      id: userId,
      email: tenantEmail,
      tenant_id: tenant.id,
      company_name: tenantName,
      amazon_seller_id: `SELLER_${stamp}`,
      seller_id: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  if (userError) {
    throw new Error(`Failed creating user: ${userError.message}`);
  }

  const { error: membershipError } = await supabaseAdmin
    .from('tenant_memberships')
    .upsert(
      {
        tenant_id: tenant.id,
        user_id: userId,
        role: 'owner',
        is_active: true,
        accepted_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,user_id' }
    );

  if (membershipError) {
    throw new Error(`Failed creating tenant membership: ${membershipError.message}`);
  }

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    userId,
  };
}

async function countRows(table: string, tenantId: string, userId: string, syncId: string): Promise<CountResult> {
  const sellerField = table === 'financial_events' || table === 'inventory_transfers'
    ? 'seller_id'
    : 'user_id';

  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId as any)
    .eq(sellerField as any, userId as any)
    .eq('sync_id', syncId as any);

  return {
    count: count || 0,
    error: error?.message || null,
  };
}

async function main() {
  if (!isRealDatabaseConfigured) {
    throw new Error('Real database configuration is required for live proof');
  }

  if (!fs.existsSync(DEMO_DIR)) {
    throw new Error(`Demo CSV directory not found: ${DEMO_DIR}`);
  }

  const context = await ensureFreshTenantAndUser();
  const demoFiles = fs
    .readdirSync(DEMO_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith('.csv'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => ({
      buffer: fs.readFileSync(path.join(DEMO_DIR, fileName)),
      originalname: fileName,
      mimetype: 'text/csv',
    }));

  const batch = await csvIngestionService.ingestFiles(context.userId, demoFiles, {
    triggerDetection: true,
    tenantId: context.tenantId,
  });

  const syncId = batch.syncId;

  const tableCounts = {
    orders: await countRows('orders', context.tenantId, context.userId, syncId),
    shipments: await countRows('shipments', context.tenantId, context.userId, syncId),
    returns: await countRows('returns', context.tenantId, context.userId, syncId),
    settlements: await countRows('settlements', context.tenantId, context.userId, syncId),
    financial_events: await countRows('financial_events', context.tenantId, context.userId, syncId),
    inventory_ledger_events: await countRows('inventory_ledger_events', context.tenantId, context.userId, syncId),
    inventory_transfers: await countRows('inventory_transfers', context.tenantId, context.userId, syncId),
  };

  const { data: csvRun, error: csvRunError } = await supabaseAdmin
    .from('csv_upload_runs')
    .select('sync_id, status, detection_triggered, detection_job_id, created_at, updated_at, started_at, completed_at, error, is_sandbox')
    .eq('tenant_id', context.tenantId)
    .eq('seller_id', context.userId)
    .eq('sync_id', syncId)
    .maybeSingle();

  if (csvRunError && csvRunError.code !== 'PGRST116') {
    throw new Error(`Failed loading csv_upload_runs proof row: ${csvRunError.message}`);
  }

  const { data: queueRows, error: queueError, count: queueCount } = await supabaseAdmin
    .from('detection_queue')
    .select('id, sync_id, status, processed_at, error_message, created_at, updated_at, payload', { count: 'exact' })
    .eq('tenant_id', context.tenantId)
    .eq('seller_id', context.userId)
    .eq('sync_id', syncId)
    .order('created_at', { ascending: true });

  if (queueError) {
    throw new Error(`Failed loading detection_queue proof rows: ${queueError.message}`);
  }

  const { data: detectionRows, error: detectionError, count: detectionCount } = await supabaseAdmin
    .from('detection_results')
    .select('id, anomaly_type, status, estimated_value, source_type, created_at', { count: 'exact' })
    .eq('tenant_id', context.tenantId)
    .eq('seller_id', context.userId)
    .eq('sync_id', syncId)
    .order('created_at', { ascending: true });

  if (detectionError) {
    throw new Error(`Failed loading detection_results proof rows: ${detectionError.message}`);
  }

  console.log(JSON.stringify({
    context,
    batch: {
      success: batch.success,
      syncId: batch.syncId,
      detectionTriggered: batch.detectionTriggered,
      detectionJobId: batch.detectionJobId || null,
      fileErrors: batch.results.flatMap((result) => result.errors || []),
    },
    tableCounts,
    csvUploadRun: csvRun || null,
    detectionQueue: {
      count: queueCount || 0,
      rows: queueRows || [],
    },
    detectionResults: {
      count: detectionCount || 0,
      rows: detectionRows || [],
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
