import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { csvIngestionService } from './src/services/csvIngestionService';
import { supabaseAdmin } from './src/database/supabaseClient';
import { fetchTransferRecords } from './src/services/detection/core/detectors/warehouseTransferLossAlgorithm';

async function main() {
  const userId = process.env.CSV_TEST_USER_ID || 'cf6d8078-e83a-472a-baf5-d241eb7ab36e';
  const tenantId = process.env.CSV_TEST_TENANT_ID || '00000000-0000-0000-0000-000000000001';
  const src = path.join(process.cwd(), 'inventory_transfers.csv');
  const lines = fs.readFileSync(src, 'utf-8').split(/\r?\n/).filter(Boolean);
  const header = lines[1];
  const rows = lines.slice(2).map((line, index) => {
    const parts = line.split(',');
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (20 - index));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    parts[6] = `${yyyy}-${mm}-${dd}`;
    return parts.join(',');
  });
  const out = ['# inventory_transfers_recent.csv', header, ...rows].join('\n');
  const tempName = '__inventory_transfers_recent.csv';
  fs.writeFileSync(path.join(process.cwd(), tempName), out, 'utf-8');

  const result = await csvIngestionService.ingestFiles(
    userId,
    [{ buffer: fs.readFileSync(path.join(process.cwd(), tempName)), originalname: tempName, mimetype: 'text/csv' }],
    { explicitType: 'transfers', triggerDetection: false, tenantId }
  );

  const visible = await fetchTransferRecords(userId);
  const count = await supabaseAdmin.from('inventory_transfers').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId as any).eq('seller_id', userId as any);
  const sample = await supabaseAdmin.from('inventory_transfers').select('transfer_id,transfer_date,quantity_sent,quantity_received,tenant_id,seller_id').eq('tenant_id', tenantId as any).eq('seller_id', userId as any).order('transfer_date', { ascending: true }).limit(3);

  console.log(JSON.stringify({ result, visibleCount: visible.length, visibleSample: visible.slice(0,3), dbCount: count.count || 0, sample: sample.data || [] }, null, 2));
}
main().catch(err => { console.error(err); process.exit(1); });
