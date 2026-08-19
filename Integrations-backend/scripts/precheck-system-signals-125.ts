import dotenv from 'dotenv';
import { Client } from 'pg';
import path from 'path';
import { readdirSync } from 'fs';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required for System Signals migration precheck');
}

async function scalar(client: Client, sql: string, values: unknown[] = []): Promise<string> {
  const result = await client.query(sql, values);
  return String(result.rows[0]?.value ?? '');
}

async function main(): Promise<void> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const server = await client.query<{ version: string }>('SELECT version() AS version');
    console.log(`precheck.server=${String(server.rows[0]?.version || '').split(',')[0]}`);

    const requiredTables = ['notifications', 'tenant_memberships', 'users'];
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [requiredTables]
    );
    const foundTables = new Set(tables.rows.map((row) => row.table_name));
    for (const table of requiredTables) {
      console.log(`precheck.table.${table}=${foundTables.has(table) ? 'present' : 'missing'}`);
    }
    if (foundTables.size !== requiredTables.length) {
      throw new Error('MIGRATION_125_PRECHECK_FAILED: required table missing');
    }

    const notificationColumns = await client.query<{ column_name: string; data_type: string; udt_name: string; is_nullable: string }>(
      `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'notifications'
       ORDER BY ordinal_position`
    );
    const columnMap = new Map(notificationColumns.rows.map((row) => [row.column_name, row]));
    for (const column of ['id', 'tenant_id', 'user_id', 'dedupe_key', 'created_at']) {
      const info = columnMap.get(column);
      console.log(`precheck.notifications.${column}=${info ? `${info.data_type}:${info.udt_name}:${info.is_nullable}` : 'missing'}`);
      if (!info) throw new Error(`MIGRATION_125_PRECHECK_FAILED: notifications.${column} missing`);
    }

    const appliedTable = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'schema_migrations'
       ) AS exists`
    );
    if (!appliedTable.rows[0]?.exists) {
      throw new Error('MIGRATION_125_PRECHECK_FAILED: schema_migrations missing');
    }
    const appliedMigrations = await client.query<{ filename: string }>(`SELECT filename FROM schema_migrations ORDER BY filename`);
    const applied = new Set(appliedMigrations.rows.map((row) => row.filename));
    const migrationFiles = readdirSync(path.resolve(__dirname, '..', 'migrations'))
      .filter((file) => file.endsWith('.sql') && file !== 'combined_migration.sql')
      .sort((a, b) => a.localeCompare(b));
    const pendingMigrations = migrationFiles.filter((file) => !applied.has(file));
    console.log(`precheck.migration_125=${applied.has('125_system_signals_v1_foundation.sql') ? 'already_applied' : 'pending'}`);
    console.log(`precheck.pending_migrations=${pendingMigrations.join(',') || 'none'}`);
    if (pendingMigrations.some((file) => file !== '125_system_signals_v1_foundation.sql')) {
      throw new Error('MIGRATION_125_PRECHECK_FAILED: normal runner would apply additional pending migrations');
    }

    const deliveryTable = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'notification_signal_deliveries'
       ) AS exists`
    );
    console.log(`precheck.delivery_table=${deliveryTable.rows[0]?.exists ? 'already_present' : 'pending_creation'}`);

    const duplicateSignals = await scalar(client,
      `SELECT COUNT(*)::text AS value
       FROM notifications
       WHERE system_signal_id IS NOT NULL`,
    ).catch(() => 'column_not_present');
    console.log(`precheck.existing_canonical_rows=${duplicateSignals}`);

    for (const table of ['tenants', 'users', 'tenant_memberships', 'dispute_cases', 'detection_results', 'notifications', 'notification_signal_deliveries']) {
      const columns = await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table]
      );
      const contract = columns.rows.map((row) => `${row.column_name}:${row.data_type}:${row.is_nullable}:${row.column_default ? 'default' : 'required'}`).join('|');
      const requiredColumns = columns.rows
        .filter((row) => row.is_nullable === 'NO' && !row.column_default)
        .map((row) => row.column_name)
        .join(',');
      console.log(`precheck.columns.${table}=${contract || 'missing'}`);
      console.log(`precheck.required.${table}=${requiredColumns || 'none'}`);
    }

    const disputeConstraints = await client.query<{ conname: string; definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public.dispute_cases'::regclass AND contype = 'c'
       ORDER BY conname`
    );
    for (const constraint of disputeConstraints.rows) {
      console.log(`precheck.constraint.dispute_cases.${constraint.conname}=${constraint.definition}`);
    }

    console.log('MIGRATION_125_PRECHECK=PASS');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
