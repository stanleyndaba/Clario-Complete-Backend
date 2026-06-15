import dotenv from 'dotenv';
import { Client } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const migrationsDir = path.join(rootDir, 'migrations');
const migrationsTable = 'schema_migrations';

function getConnectionString(): string | undefined {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.Host || process.env.NEON_HOST;
  const database = process.env.Database || process.env.NEON_DATABASE;
  const role = process.env.Role || process.env.NEON_ROLE;
  const password = process.env.Password || process.env.DB_PASSWORD || process.env.NEON_PASSWORD;

  if (!host || !database || !role || !password) {
    return undefined;
  }

  const encodedRole = encodeURIComponent(role.toLowerCase());
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://${encodedRole}:${encodedPassword}@${host}/${database}?sslmode=require`;
}

function getMigrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .filter((file) => file !== 'combined_migration.sql')
    .sort((a, b) => a.localeCompare(b));
}

function neonCompatibleSql(sql: string): string {
  return sql
    .replace(
      /CREATE POLICY\s+((?:"[^"]+")|(?:[A-Za-z_][A-Za-z0-9_]*))\s+ON\s+([A-Za-z_][A-Za-z0-9_\.]*)/g,
      'DROP POLICY IF EXISTS $1 ON $2;\nCREATE POLICY $1 ON $2'
    )
    .replace(
      /ALTER PUBLICATION supabase_realtime ADD TABLE realtime_alerts;/g,
      `SELECT 1;`
    )
    .replace(/auth\.uid\(\)::uuid\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)/g, 'auth.uid()::text = $1::text')
    .replace(/([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*auth\.uid\(\)::uuid/g, '$1::text = auth.uid()::text')
    .replace(/auth\.uid\(\)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)/g, 'auth.uid()::text = $1::text')
    .replace(/([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*auth\.uid\(\)/g, '$1::text = auth.uid()::text');
}

async function ensureCompatibility(client: Client): Promise<void> {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'service_role')
    $$;

    CREATE OR REPLACE FUNCTION auth.jwt()
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email varchar(255) UNIQUE,
      amazon_seller_id varchar(255) UNIQUE,
      seller_id varchar(255),
      company_name varchar(255),
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ${migrationsTable} (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function run(): Promise<void> {
  const connectionString = getConnectionString();

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Add it to Integrations-backend/.env, or set Host/Database/Role/Password.'
    );
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? undefined : { rejectUnauthorized: false },
  });

  console.log('Connecting to PostgreSQL using DATABASE_URL...');
  await client.connect();
  console.log('Connected. Preparing Neon compatibility objects...');

  try {
    await ensureCompatibility(client);

    const appliedResult = await client.query<{ filename: string }>(
      `SELECT filename FROM ${migrationsTable}`
    );
    const applied = new Set(appliedResult.rows.map((row) => row.filename));
    const files = getMigrationFiles();

    console.log(`Found ${files.length} migration files. ${applied.size} already recorded.`);

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip ${file}`);
        continue;
      }

      const sql = neonCompatibleSql(readFileSync(path.join(migrationsDir, file), 'utf8'));

      console.log(`run  ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO ${migrationsTable} (filename) VALUES ($1)`, [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed: ${file}\n${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const countResult = await client.query<{ table_count: string }>(`
      SELECT COUNT(*)::text AS table_count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE';
    `);

    const tablesResult = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
      LIMIT 25;
    `);

    console.log(`Verification table_count=${countResult.rows[0]?.table_count ?? '0'}`);
    console.log(`Verification sample_tables=${tablesResult.rows.map((row) => row.table_name).join(', ')}`);
  } finally {
    await client.end();
  }
}

run().catch((error: any) => {
  const details = {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    errno: error?.errno,
    syscall: error?.syscall,
    hostname: error?.hostname,
  };
  console.error('Neon migration runner failed:', JSON.stringify(details, null, 2));
  process.exit(1);
});
