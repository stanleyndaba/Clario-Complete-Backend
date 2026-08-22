import dotenv from 'dotenv';
import { Client } from 'pg';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the read-only accounting migration readiness probe.');
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    const [migrations, tokenIndexes, sourceConstraints, tables] = await Promise.all([
      client.query<{ filename: string }>(`
        SELECT filename FROM schema_migrations
        WHERE filename >= '084_agent1_connection_truth.sql'
        ORDER BY filename
      `),
      client.query<{ indexname: string; indexdef: string }>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'tokens'
        ORDER BY indexname
      `),
      client.query<{ conname: string; definition: string }>(`
        SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'evidence_sources'
          AND c.contype = 'c'
        ORDER BY c.conname
      `),
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('tokens', 'evidence_sources', 'accounting_records')
        ORDER BY table_name
      `)
    ]);

    console.log(JSON.stringify({
      appliedMigrationTail: migrations.rows.map((row) => row.filename),
      tokenIndexes: tokenIndexes.rows,
      evidenceSourceCheckConstraints: sourceConstraints.rows,
      relevantTables: tables.rows.map((row) => row.table_name)
    }, null, 2));
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
