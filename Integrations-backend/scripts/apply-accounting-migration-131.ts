import dotenv from 'dotenv';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const migrationName = '131_create_accounting_records.sql';
const migrationPath = path.resolve(__dirname, '..', 'migrations', migrationName);

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to apply the accounting migration.');
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const prior = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      [migrationName]
    );
    if (prior.rowCount) {
      console.log(JSON.stringify({ migration: migrationName, result: 'already_recorded' }));
      return;
    }

    const existingTable = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounting_records'
      ) AS exists
    `);
    if (existingTable.rows[0]?.exists) {
      throw new Error('accounting_records already exists but migration 131 is not recorded; inspect this partial state before retrying.');
    }

    const sql = readFileSync(migrationPath, 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [migrationName]);

    const verification = await client.query<{
      accounting_records: string;
      token_index: string;
      provider_constraint: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounting_records') AS accounting_records,
        (SELECT COUNT(*)::text FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tokens' AND indexname = 'idx_tokens_accounting_user_provider_tenant_unique') AS token_index,
        (SELECT COUNT(*)::text FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'evidence_sources' AND c.conname = 'evidence_sources_provider_check') AS provider_constraint
    `);

    console.log(JSON.stringify({
      migration: migrationName,
      result: 'applied',
      verification: verification.rows[0]
    }, null, 2));
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
