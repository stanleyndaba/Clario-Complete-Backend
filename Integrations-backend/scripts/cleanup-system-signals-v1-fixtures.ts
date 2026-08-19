import dotenv from 'dotenv';
import { Client } from 'pg';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for fixture cleanup');

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const fixtures = await client.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM tenants WHERE slug LIKE 'ssv1_cert_%' ORDER BY created_at`
    );
    const tenantIds = fixtures.rows.map((row) => row.id);
    console.log(`fixture_cleanup.tenants_found=${tenantIds.length}`);
    if (!tenantIds.length) return;

    const tenantScopedTables = await client.query<{ table_name: string; data_type: string }>(
      `SELECT DISTINCT table_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name = 'tenant_id'
         AND table_name NOT IN ('tenants', 'schema_migrations')
       ORDER BY table_name`
    );

    for (const { table_name, data_type } of tenantScopedTables.rows) {
      const isUuid = data_type === 'uuid';
      const result = await client.query(
        `DELETE FROM ${quoteIdentifier(table_name)} WHERE tenant_id = ANY($1::${isUuid ? 'uuid[]' : 'text[]'})`,
        [tenantIds]
      );
      if (result.rowCount) console.log(`fixture_cleanup.deleted.${table_name}=${result.rowCount}`);
    }

    const userResult = await client.query(`DELETE FROM users WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
    if (userResult.rowCount) console.log(`fixture_cleanup.deleted.users=${userResult.rowCount}`);

    const tenantResult = await client.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds]);
    console.log(`fixture_cleanup.deleted.tenants=${tenantResult.rowCount}`);

    const remaining = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM tenants WHERE slug LIKE 'ssv1_cert_%'`);
    console.log(`fixture_cleanup.remaining_tenants=${remaining.rows[0]?.count || '0'}`);
    if (remaining.rows[0]?.count !== '0') throw new Error('Synthetic certification fixtures remain after cleanup');
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
