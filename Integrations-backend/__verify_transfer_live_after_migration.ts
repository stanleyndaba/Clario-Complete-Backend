import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { csvIngestionService } from './src/services/csvIngestionService';
import { supabaseAdmin, isRealDatabaseConfigured } from './src/database/supabaseClient';
import { fetchTransferRecords } from './src/services/detection/core/detectors/warehouseTransferLossAlgorithm';

async function main() {
  if (!isRealDatabaseConfigured) throw new Error('Real database config required');
  const userId = process.env.CSV_TEST_USER_ID || 'cf6d8078-e83a-472a-baf5-d241eb7ab36e';
  const tenantId = process.env.CSV_TEST_TENANT_ID || '00000000-0000-0000-0000-000000000001';
  const original = fs.readFileSync(path.join(process.cwd(), 'inventory_transfers.csv'), 'utf-8');
  const tempName = '__inventory_transfers_live_verify.csv';
  fs.writeFileSync(path.join(process.cwd(), tempName), '# live verify copy\n' + original, 'utf-8');

  const result = await csvIngestionService.ingestFiles(
    userId,
    [{ buffer: fs.readFileSync(path.join(process.cwd(), tempName)), originalname: tempName, mimetype: 'text/csv' }],
    { explicitType: 'transfers', triggerDetection: false, tenantId }
  );

  const countRes = await supabaseAdmin
    .from('inventory_transfers')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId as any)
    .eq('seller_id', userId as any);

  const sampleRes = await supabaseAdmin
    .from('inventory_transfers')
    .select('tenant_id,seller_id,transfer_id,sku,source_fc,destination_fc,transfer_date,quantity_sent,quantity_received,status')
    .eq('tenant_id', tenantId as any)
    .eq('seller_id', userId as any)
    .order('transfer_date', { ascending: true })
    .limit(2);

  const transfers = await fetchTransferRecords(userId);

  const rerun = await csvIngestionService.ingestFiles(
    userId,
    [{ buffer: fs.readFileSync(path.join(process.cwd(), tempName)), originalname: tempName, mimetype: 'text/csv' }],
    { explicitType: 'transfers', triggerDetection: false, tenantId }
  );

  const countAfterRerun = await supabaseAdmin
    .from('inventory_transfers')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId as any)
    .eq('seller_id', userId as any);

  console.log(JSON.stringify({
    result,
    dbCount: countRes.count || 0,
    dbError: countRes.error || null,
    sample: sampleRes.data || [],
    sampleError: sampleRes.error || null,
    visibleToAgent3: transfers.length,
    visibleSample: transfers.slice(0, 2),
    rerun,
    countAfterRerun: countAfterRerun.count || 0,
    rerunDbError: countAfterRerun.error || null,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
