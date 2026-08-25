import dotenv from 'dotenv';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const migrationName = '133_reconcile_transfer_ledger_observation_rail.sql';
const historicalMigrationName = '129_transfer_ledger_observation_rail.sql';
const migrationPath = path.resolve(__dirname, '..', 'migrations', migrationName);
const approvedProductionHost = 'ep-purple-sun-ata5l2u7.c-9.us-east-1.aws.neon.tech';
const approvedProductionDatabase = 'neondb';

const requiredTables = [
  'transfer_ledger_source_runs',
  'transfer_ledger_observations',
] as const;

const requiredIndexes = [
  'inventory_ledger_provider_fingerprint_unique',
  'inventory_ledger_events_provider_fingerprint_unique',
  'idx_inventory_ledger_events_transfer_observation_scope',
  'transfer_ledger_source_runs_scope_sync_idx',
  'transfer_ledger_source_runs_scope_health_idx',
  'transfer_ledger_observations_provider_scope_unique',
  'transfer_ledger_observations_detector_scope_idx',
  'transfer_ledger_observations_source_run_idx',
] as const;

type VerificationRow = {
  table_count: string;
  index_count: string;
  legacy_constraint_count: string;
  legacy_index_count: string;
  flag_safe: boolean | null;
};

export function assertApplyEnvironment(): void {
  if (process.env.CONFIRM_TRANSFER_RECONCILIATION_133 !== 'APPLY') {
    throw new Error('Refusing to apply Transfer reconciliation. Set CONFIRM_TRANSFER_RECONCILIATION_133=APPLY only after approved change control.');
  }
}

export function assertApprovedProductionTarget(connectionString: string): void {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (url.hostname !== approvedProductionHost || database !== approvedProductionDatabase) {
    throw new Error('Refusing Transfer reconciliation: DATABASE_URL does not target the approved Neon production database.');
  }
}

async function run(): Promise<void> {
  assertApplyEnvironment();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to apply the controlled Transfer reconciliation.');
  }

  assertApprovedProductionTarget(connectionString);

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? undefined : { rejectUnauthorized: false },
  });

  await client.connect();
  let transactionOpen = false;

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const ledger = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations WHERE filename = ANY($1::text[]) ORDER BY filename',
      [[historicalMigrationName, migrationName]]
    );
    const recorded = new Set(ledger.rows.map((row) => row.filename));

    if (recorded.has(historicalMigrationName) && !recorded.has(migrationName)) {
      throw new Error(
        `Refusing reconciliation: ${historicalMigrationName} is already recorded. Investigate actual schema rather than creating duplicate deployment evidence.`
      );
    }

    const verificationBefore = await client.query<VerificationRow>(`
      SELECT
        (SELECT COUNT(*)::text FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])) AS table_count,
        (SELECT COUNT(*)::text FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = ANY($2::text[])) AS index_count,
        (SELECT COUNT(*)::text FROM pg_constraint
          WHERE conname IN ('uq_inventory_ledger_event', 'uq_ledger_event')) AS legacy_constraint_count,
        (SELECT COUNT(*)::text FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN ('inventory_ledger_tenant_event_unique', 'inventory_ledger_events_tenant_user_event_unique')) AS legacy_index_count,
        (SELECT is_enabled = FALSE
          AND rollout_percentage = 0
          AND payload = '{"mode":"OFF","claim_capable":false,"observation_version":"v1"}'::jsonb
          FROM feature_flags
          WHERE flag_name = 'connected_transfer_ledger_observation') AS flag_safe
    `, [requiredTables, requiredIndexes]);

    const before = verificationBefore.rows[0];
    const schemaAlreadyReconciled = before.table_count === String(requiredTables.length)
      && before.index_count === String(requiredIndexes.length)
      && before.legacy_constraint_count === '0'
      && before.legacy_index_count === '0'
      && before.flag_safe === true;

    if (recorded.has(migrationName)) {
      if (!schemaAlreadyReconciled) {
        throw new Error(`${migrationName} is recorded but Transfer reconciliation verification is incomplete; stop and investigate before any retry.`);
      }
      console.log(JSON.stringify({ migration: migrationName, result: 'already_recorded_and_verified' }, null, 2));
      return;
    }

    if (schemaAlreadyReconciled) {
      throw new Error(`${migrationName} is not recorded but the target schema/flag state already exists; stop and investigate ledger divergence before recording anything.`);
    }

    const sql = readFileSync(migrationPath, 'utf8');
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [migrationName]);
    await client.query('COMMIT');
    transactionOpen = false;

    const verificationAfter = await client.query<VerificationRow>(`
      SELECT
        (SELECT COUNT(*)::text FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])) AS table_count,
        (SELECT COUNT(*)::text FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = ANY($2::text[])) AS index_count,
        (SELECT COUNT(*)::text FROM pg_constraint
          WHERE conname IN ('uq_inventory_ledger_event', 'uq_ledger_event')) AS legacy_constraint_count,
        (SELECT COUNT(*)::text FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN ('inventory_ledger_tenant_event_unique', 'inventory_ledger_events_tenant_user_event_unique')) AS legacy_index_count,
        (SELECT is_enabled = FALSE
          AND rollout_percentage = 0
          AND payload = '{"mode":"OFF","claim_capable":false,"observation_version":"v1"}'::jsonb
          FROM feature_flags
          WHERE flag_name = 'connected_transfer_ledger_observation') AS flag_safe
    `, [requiredTables, requiredIndexes]);

    const after = verificationAfter.rows[0];
    if (
      after.table_count !== String(requiredTables.length)
      || after.index_count !== String(requiredIndexes.length)
      || after.legacy_constraint_count !== '0'
      || after.legacy_index_count !== '0'
      || after.flag_safe !== true
    ) {
      throw new Error('Transfer reconciliation committed but post-apply verification is incomplete. Stop and investigate before any follow-on action.');
    }

    console.log(JSON.stringify({
      migration: migrationName,
      result: 'applied_and_verified',
      verification: after,
      transferMode: 'OFF',
      claimCapable: false,
    }, null, 2));
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
