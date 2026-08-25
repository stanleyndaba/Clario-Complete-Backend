import dotenv from 'dotenv';
import { Client } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';

const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const migrationsDir = path.join(rootDir, 'migrations');
const migrationsTable = 'schema_migrations';
const migrationCompatibilityCatalogPath = path.join(migrationsDir, 'migration-prefix-compatibility.json');
const migrationFilenamePattern = /^(\d+)_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;
const excludedSqlBundles = new Set(['combined_migration.sql']);
const supersededMigrationEvidence: Record<string, string> = {
  // The original Transfer migration was never deployed. A recorded forward-only
  // reconciliation is the truthful ledger evidence and must prevent a later
  // runner invocation from applying or recording the historical file.
  '129_transfer_ledger_observation_rail.sql': '133_reconcile_transfer_ledger_observation_rail.sql',
};

type MigrationPrefixCompatibilityCatalog = {
  legacyUnnumberedMigrationFiles: string[];
  duplicatePrefixes: Record<string, string[]>;
};

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

function sameNames(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

export function validateMigrationCatalog(files: string[]): void {
  if (!existsSync(migrationCompatibilityCatalogPath)) {
    throw new Error('Missing migrations/migration-prefix-compatibility.json compatibility catalog.');
  }

  const catalog = JSON.parse(
    readFileSync(migrationCompatibilityCatalogPath, 'utf8')
  ) as MigrationPrefixCompatibilityCatalog;
  const unnumberedFiles = files.filter((file) => !migrationFilenamePattern.test(file)).sort();
  const documentedUnnumberedFiles = [...(catalog.legacyUnnumberedMigrationFiles || [])].sort();
  if (!sameNames(unnumberedFiles, documentedUnnumberedFiles)) {
    throw new Error(
      `Undocumented or stale nonnumeric migration filenames. Actual: ${unnumberedFiles.join(', ') || '(none)'}. Documented: ${documentedUnnumberedFiles.join(', ') || '(none)'}.`
    );
  }

  const groups = new Map<string, string[]>();
  for (const file of files) {
    const prefix = file.match(migrationFilenamePattern)?.[1];
    if (!prefix) continue;
    groups.set(prefix, [...(groups.get(prefix) || []), file]);
  }

  const duplicateGroups = [...groups.entries()].filter(([, names]) => names.length > 1);
  const errors: string[] = [];

  for (const [prefix, names] of duplicateGroups) {
    const actual = [...names].sort();
    const documented = [...(catalog.duplicatePrefixes[prefix] || [])].sort();
    if (!sameNames(actual, documented)) {
      errors.push(
        `Duplicate prefix ${prefix} must exactly match its compatibility catalog entry. Actual: ${actual.join(', ')}. Documented: ${documented.join(', ') || '(none)'}.`
      );
    }
  }

  for (const [prefix, documentedNames] of Object.entries(catalog.duplicatePrefixes)) {
    const actual = [...(groups.get(prefix) || [])].sort();
    const documented = [...documentedNames].sort();
    if (!sameNames(actual, documented)) {
      errors.push(
        `Compatibility catalog prefix ${prefix} is stale or incomplete. Actual: ${actual.join(', ') || '(none)'}. Documented: ${documented.join(', ')}.`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Migration catalog validation failed:\n${errors.join('\n')}`);
  }
}

export function getMigrationFiles(directory = migrationsDir): string[] {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .filter((file) => !excludedSqlBundles.has(file))
    .sort((a, b) => a.localeCompare(b));
  validateMigrationCatalog(files);
  return files;
}

export function supersedingMigrationFor(file: string, applied: ReadonlySet<string>): string | null {
  const successor = supersededMigrationEvidence[file];
  return successor && applied.has(successor) ? successor : null;
}

export function getPendingMigrationFiles(files: readonly string[], applied: ReadonlySet<string>): string[] {
  return files.filter((file) => !applied.has(file) && !supersedingMigrationFor(file, applied));
}

function certificationBootstrapEnabled(): boolean {
  return process.env.CERTIFICATION_RUNTIME === 'true'
    && process.env.CERTIFICATION_DATABASE_BOOTSTRAP === 'true';
}

/**
 * An empty isolated certification database must never import production platform
 * administrator identities. Migration 130 otherwise creates a required schema
 * table and then asserts that two production administrators already exist.
 * Keep the schema portion but omit only that seed/assertion block when the
 * explicitly opt-in certification bootstrap mode is active.
 */
function certificationSafeMigrationSql(file: string, sql: string): string {
  if (!certificationBootstrapEnabled() || file !== '130_create_platform_admins_authority.sql') {
    return sql;
  }

  const withoutProductionAdminSeed = sql.replace(/\nDO \$\$[\s\S]*?END \$\$;\n?/, '\n');
  if (withoutProductionAdminSeed === sql) {
    throw new Error('Certification bootstrap could not safely remove the production platform-admin seed block.');
  }
  return withoutProductionAdminSeed;
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

    const pending = new Set(getPendingMigrationFiles(files, applied));
    for (const file of files) {
      if (!pending.has(file)) {
        const supersededBy = supersedingMigrationFor(file, applied);
        console.log(supersededBy ? `skip ${file} (superseded by ${supersededBy})` : `skip ${file}`);
        continue;
      }

      const rawSql = readFileSync(path.join(migrationsDir, file), 'utf8');
      const sql = neonCompatibleSql(certificationSafeMigrationSql(file, rawSql));

      const certificationOnlyMigration = certificationBootstrapEnabled() && file === '130_create_platform_admins_authority.sql';
      console.log(`run  ${file}${certificationOnlyMigration ? ' (certification schema-only platform-admin authority)' : ''}`);
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

if (require.main === module) {
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
}
