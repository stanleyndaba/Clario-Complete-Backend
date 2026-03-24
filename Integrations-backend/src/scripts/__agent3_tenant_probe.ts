import 'dotenv/config';

import { isRealDatabaseConfigured, supabaseAdmin } from '../database/supabaseClient';

async function main() {
  if (!isRealDatabaseConfigured) {
    throw new Error('Real Supabase configuration is required');
  }

  const tenantId = process.env.AGENT3_TENANT_ID!;
  const userId = process.env.AGENT3_USER_ID!;

  if (!tenantId || !userId) {
    throw new Error('AGENT3_TENANT_ID and AGENT3_USER_ID are required');
  }

  const tables = [
    { table: 'orders', sellerField: 'user_id' },
    { table: 'shipments', sellerField: 'user_id' },
    { table: 'returns', sellerField: 'user_id' },
    { table: 'settlements', sellerField: 'user_id' },
    { table: 'inventory_items', sellerField: 'user_id' },
    { table: 'inventory_ledger_events', sellerField: 'user_id' },
    { table: 'inventory_transfers', sellerField: 'seller_id' },
    { table: 'financial_events', sellerField: 'seller_id' },
  ];

  const output: Record<string, any> = {
    tenantId,
    userId,
    tables: {},
  };

  for (const source of tables) {
    const sample = await supabaseAdmin
      .from(source.table)
      .select('*')
      .eq('tenant_id', tenantId as any)
      .eq(source.sellerField as any, userId as any)
      .limit(3);

    output.tables[source.table] = {
      count: sample.data?.length || 0,
      sample: sample.data || [],
      error: sample.error?.message || null,
    };
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
