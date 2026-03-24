import { supabaseAdmin } from './src/database/supabaseClient';

async function main() {
  const row = {
    id: '11111111-1111-1111-1111-111111111111',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    seller_id: 'cf6d8078-e83a-472a-baf5-d241eb7ab36e',
    transfer_id: 'TEST-TRANSFER-1',
    sku: 'TEST-SKU',
    asin: 'B00TEST123',
    fnsku: 'X00TEST123',
    source_fc: 'ABE8',
    destination_fc: 'LAX9',
    transfer_date: '2026-03-18T00:00:00.000Z',
    quantity_sent: 10,
    quantity_received: 8,
    status: 'received',
    unit_value: 12.5,
    currency: 'USD',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin.from('inventory_transfers').insert(row).select('*');
  console.log(JSON.stringify({ data, error }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
