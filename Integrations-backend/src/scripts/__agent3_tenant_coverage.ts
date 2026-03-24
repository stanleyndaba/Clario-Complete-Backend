import 'dotenv/config';

import { isRealDatabaseConfigured, supabaseAdmin } from '../database/supabaseClient';

type MembershipRow = {
  tenant_id: string;
  user_id: string;
  tenants?: { slug?: string | null } | null;
};

const TABLES: Array<{ table: string; sellerField: string }> = [
  { table: 'orders', sellerField: 'user_id' },
  { table: 'shipments', sellerField: 'user_id' },
  { table: 'returns', sellerField: 'user_id' },
  { table: 'settlements', sellerField: 'user_id' },
  { table: 'inventory_items', sellerField: 'user_id' },
  { table: 'inventory_ledger_events', sellerField: 'user_id' },
  { table: 'inventory_ledger', sellerField: 'user_id' },
  { table: 'financial_events', sellerField: 'seller_id' },
  { table: 'inventory_transfers', sellerField: 'seller_id' },
  { table: 'product_catalog', sellerField: 'seller_id' },
];

async function countRows(table: string, sellerField: string, tenantId: string, userId: string) {
  const result = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId as any)
    .eq(sellerField as any, userId as any);

  return {
    count: result.count || 0,
    error: result.error?.message || null,
  };
}

async function main() {
  if (!isRealDatabaseConfigured) {
    throw new Error('Real Supabase configuration is required');
  }

  const memberships = await supabaseAdmin
    .from('tenant_memberships')
    .select('tenant_id,user_id,tenants(slug)')
    .limit(200);

  if (memberships.error) {
    throw memberships.error;
  }

  const rows: any[] = [];

  for (const membership of (memberships.data || []) as MembershipRow[]) {
    const row: Record<string, any> = {
      tenant_id: membership.tenant_id,
      user_id: membership.user_id,
      slug: membership.tenants?.slug || null,
    };

    let coverageScore = 0;
    let nonZeroTables = 0;

    for (const source of TABLES) {
      const result = await countRows(source.table, source.sellerField, membership.tenant_id, membership.user_id);
      row[source.table] = result.count;
      if (result.error) {
        row[`${source.table}_error`] = result.error;
      }
      if (result.count > 0) {
        coverageScore += result.count;
        nonZeroTables += 1;
      }
    }

    row.coverageScore = coverageScore;
    row.nonZeroTables = nonZeroTables;
    rows.push(row);
  }

  rows.sort((a, b) => {
    if (b.nonZeroTables !== a.nonZeroTables) return b.nonZeroTables - a.nonZeroTables;
    return b.coverageScore - a.coverageScore;
  });

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
