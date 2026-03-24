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
  const tempName = '__inventory_transfers_retry.csv';
  fs.writeFileSync(path.join(process.cwd(), tempName), '# retry copy\n' + original, 'utf-8');

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

  const transfers = await fetchTransferRecords(userId);

  console.log(JSON.stringify({
    result,
    dbCount: countRes.count || 0,
    dbError: countRes.error || null,
    visibleToAgent3: transfers.length,
    sample: transfers.slice(0, 2),
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
