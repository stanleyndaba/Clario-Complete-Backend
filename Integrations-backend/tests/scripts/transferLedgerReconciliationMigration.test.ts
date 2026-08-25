import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const migrationPath = path.resolve(
  __dirname,
  '../../migrations/133_reconcile_transfer_ledger_observation_rail.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('133_reconcile_transfer_ledger_observation_rail.sql', () => {
  it('is a forward-only, lock-bounded reconciliation migration', () => {
    expect(path.basename(migrationPath)).toBe('133_reconcile_transfer_ledger_observation_rail.sql');
    expect(sql).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(sql).toMatch(/SET LOCAL statement_timeout = '60s';/);
    expect(sql).toMatch(/forward-only reconciliation/i);
    expect(sql).not.toMatch(/schema_migrations/i);
  });

  it('preserves provider facts and removes every production legacy uniqueness blocker', () => {
    for (const table of ['inventory_ledger', 'inventory_ledger_events']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE IF EXISTS ${table}[\\s\\S]*?provider_row_fingerprint TEXT`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE IF EXISTS ${table}[\\s\\S]*?provider_event_type_raw TEXT`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE IF EXISTS ${table}[\\s\\S]*?raw_quantity INTEGER`));
    }

    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS uq_inventory_ledger_event;/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS uq_ledger_event;/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS inventory_ledger_tenant_event_unique;/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS inventory_ledger_events_tenant_user_event_unique;/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_provider_fingerprint_unique/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_events_provider_fingerprint_unique/);
  });

  it('creates the observation-only source-run and observation contracts with all required indexes', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS transfer_ledger_source_runs/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS transfer_ledger_observations/);
    expect(sql).toMatch(/PENDING_PROVIDER_SEMANTICS/);

    for (const index of [
      'idx_inventory_ledger_events_transfer_observation_scope',
      'transfer_ledger_source_runs_scope_sync_idx',
      'transfer_ledger_source_runs_scope_health_idx',
      'transfer_ledger_observations_provider_scope_unique',
      'transfer_ledger_observations_detector_scope_idx',
      'transfer_ledger_observations_source_run_idx',
    ]) {
      expect(sql).toContain(index);
    }

    expect(sql).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|ALTER TABLE|CREATE TABLE)\s+(?:public\.)?(?:inventory_transfers|detection_results|financial_events|settlements)\b/i);
  });

  it('forces the Transfer flag to an explicit disabled, zero-rollout, zero-claim contract', () => {
    expect(sql).toMatch(/'connected_transfer_ledger_observation'/);
    expect(sql).toMatch(/ON CONFLICT \(flag_name\) DO UPDATE/);
    expect(sql).toMatch(/is_enabled = FALSE/);
    expect(sql).toMatch(/rollout_percentage = 0/);
    expect(sql).toMatch(/payload = '\{"mode":"OFF","claim_capable":false,"observation_version":"v1"\}'::jsonb/);
    expect(sql).toMatch(/auto_expand = FALSE/);
  });
});
