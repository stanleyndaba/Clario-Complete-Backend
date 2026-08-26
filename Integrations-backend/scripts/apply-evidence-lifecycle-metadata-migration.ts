import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to apply the evidence lifecycle metadata migration.');
  }

  const migrationPath = join(__dirname, '..', 'migrations', '134_add_evidence_document_lifecycle_metadata.sql');
  const migrationSql = readFileSync(migrationPath, 'utf8');
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? undefined : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(migrationSql);
    await client.query('COMMIT');
    console.log('Evidence lifecycle metadata migration applied successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Evidence lifecycle metadata migration failed:', error);
  process.exit(1);
});
