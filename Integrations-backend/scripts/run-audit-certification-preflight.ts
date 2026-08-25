import dotenv from 'dotenv';
import { Client } from 'pg';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const REQUIRED_MIGRATIONS = [
  '127_create_inbound_receiving_rail.sql',
  '128_add_inbound_v0_feature_flag.sql',
  '129_transfer_ledger_observation_rail.sql',
  '129_add_support_request_delivery_truth.sql',
  '132_harden_sp_api_settlement_store_identity.sql',
] as const;

const REQUIRED_TABLES = [
  'feature_flags',
  'settlements',
  'inbound_source_runs',
  'inbound_shipments',
  'inbound_shipment_items',
  'inventory_ledger',
  'inventory_ledger_events',
  'transfer_ledger_source_runs',
  'transfer_ledger_observations',
] as const;

const REQUIRED_INDEXES = [
  'inbound_source_runs_scope_provider_sync_idx',
  'inbound_source_runs_scope_status_idx',
  'inbound_shipments_provider_scope_unique',
  'inbound_shipments_detector_scope_idx',
  'inbound_shipment_items_provider_scope_unique',
  'inbound_shipment_items_detector_scope_idx',
  'inventory_ledger_provider_fingerprint_unique',
  'inventory_ledger_events_provider_fingerprint_unique',
  'idx_inventory_ledger_events_transfer_observation_scope',
  'transfer_ledger_source_runs_scope_sync_idx',
  'transfer_ledger_source_runs_scope_health_idx',
  'transfer_ledger_observations_provider_scope_unique',
  'transfer_ledger_observations_detector_scope_idx',
  'transfer_ledger_observations_source_run_idx',
] as const;

const REQUIRED_CONSTRAINTS = [
  'settlements_tenant_user_store_settlement_type_unique',
] as const;

const REQUIRED_FLAGS = [
  'connected_inbound_v0_primary',
  'connected_transfer_ledger_observation',
] as const;

type AuditFlagRow = {
  flag_name: string;
  is_enabled: boolean;
  rollout_percentage: number;
  payload: Record<string, unknown> | null;
};

type ConstraintRow = {
  table_name: string;
  conname: string;
  definition: string;
};

type PreflightStatus = 'PASS' | 'FAIL';

function missing(expected: readonly string[], observed: Iterable<string>): string[] {
  const actual = new Set(observed);
  return expected.filter((name) => !actual.has(name));
}

function flagSafety(flag: AuditFlagRow | undefined): {
  present: boolean;
  safe: boolean;
  issue: string | null;
} {
  if (!flag) {
    return { present: false, safe: false, issue: 'Flag is missing.' };
  }

  const payload = flag.payload || {};
  const mode = String(payload.mode || '').toUpperCase();

  if (flag.flag_name === 'connected_inbound_v0_primary') {
    const safe = flag.is_enabled === false && Number(flag.rollout_percentage) === 0 && mode === 'OFF';
    return {
      present: true,
      safe,
      issue: safe ? null : 'Inbound V0 must remain disabled with rollout 0 and payload.mode OFF before connected certification.',
    };
  }

  const claimCapable = payload.claim_capable;
  const safe = flag.is_enabled === false
    && Number(flag.rollout_percentage) === 0
    && mode === 'OFF'
    && claimCapable === false;

  return {
    present: true,
    safe,
    issue: safe ? null : 'Transfer observation must remain disabled, OFF, and explicitly claim_capable false before connected certification.',
  };
}

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the read-only Audit certification preflight. No database operation was attempted.');
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? undefined : { rejectUnauthorized: false },
  });

  await client.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    transactionOpen = true;

    const [migrations, tables, indexes, flags, constraints] = await Promise.all([
      client.query<{ filename: string }>(`
        SELECT filename
        FROM schema_migrations
        WHERE filename = ANY($1::text[])
        ORDER BY filename
      `, [REQUIRED_MIGRATIONS]),
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name
      `, [REQUIRED_TABLES]),
      client.query<{ indexname: string; tablename: string; indexdef: string }>(`
        SELECT indexname, tablename, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY($1::text[])
        ORDER BY tablename, indexname
      `, [REQUIRED_INDEXES]),
      client.query<AuditFlagRow>(`
        SELECT flag_name, is_enabled, rollout_percentage, payload
        FROM feature_flags
        WHERE flag_name = ANY($1::text[])
        ORDER BY flag_name
      `, [REQUIRED_FLAGS]),
      client.query<ConstraintRow>(`
        SELECT t.relname AS table_name,
               c.conname,
               pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = ANY($1::text[])
          AND c.contype IN ('c', 'f', 'p', 'u')
        ORDER BY t.relname, c.conname
      `, [[
        'settlements',
        'inbound_source_runs',
        'inbound_shipments',
        'inbound_shipment_items',
        'transfer_ledger_source_runs',
        'transfer_ledger_observations',
      ]]),
    ]);

    const migrationRows = migrations.rows.map((row) => row.filename);
    const tableRows = tables.rows.map((row) => row.table_name);
    const indexRows = indexes.rows.map((row) => row.indexname);
    const flagsByName = new Map(flags.rows.map((row) => [row.flag_name, row]));
    const flagChecks = REQUIRED_FLAGS.map((name) => ({
      flagName: name,
      ...flagSafety(flagsByName.get(name)),
      actual: flagsByName.get(name) || null,
    }));

    const missingMigrations = missing(REQUIRED_MIGRATIONS, migrationRows);
    const missingTables = missing(REQUIRED_TABLES, tableRows);
    const missingIndexes = missing(REQUIRED_INDEXES, indexRows);
    const missingConstraints = missing(REQUIRED_CONSTRAINTS, constraints.rows.map((row) => row.conname));
    const unsafeFlags = flagChecks.filter((check) => !check.safe);

    const status: PreflightStatus = (
      missingMigrations.length === 0
      && missingTables.length === 0
      && missingIndexes.length === 0
      && missingConstraints.length === 0
      && unsafeFlags.length === 0
    ) ? 'PASS' : 'FAIL';

    const output = {
      preflight: 'margin_audit_certification_foundation',
      mode: 'READ_ONLY',
      status,
      checks: {
        migrations: {
          required: REQUIRED_MIGRATIONS,
          applied: migrationRows,
          missing: missingMigrations,
        },
        schema: {
          requiredTables: REQUIRED_TABLES,
          presentTables: tableRows,
          missingTables,
          requiredIndexes: REQUIRED_INDEXES,
          presentIndexes: indexes.rows,
          missingIndexes,
          requiredConstraints: REQUIRED_CONSTRAINTS,
          missingConstraints,
          relevantConstraints: constraints.rows,
        },
        flags: flagChecks,
      },
    };

    console.log(JSON.stringify(output, null, 2));

    if (status === 'FAIL') {
      process.exitCode = 2;
    }
  } finally {
    if (transactionOpen) {
      await client.query('ROLLBACK');
    }
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
