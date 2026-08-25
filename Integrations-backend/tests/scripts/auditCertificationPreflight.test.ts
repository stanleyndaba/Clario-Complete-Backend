import { describe, expect, it } from '@jest/globals';
import {
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
  REQUIRED_NON_TRANSFER_MIGRATIONS,
  REQUIRED_TABLES,
  evaluateAuditCertificationPreflight,
} from '../../scripts/run-audit-certification-preflight';

const safeFlags = [
  {
    flag_name: 'connected_inbound_v0_primary',
    is_enabled: false,
    rollout_percentage: 0,
    payload: { mode: 'OFF' },
  },
  {
    flag_name: 'connected_transfer_ledger_observation',
    is_enabled: false,
    rollout_percentage: 0,
    payload: { mode: 'OFF', claim_capable: false, observation_version: 'v1' },
  },
];

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateAuditCertificationPreflight({
    migrationRows: [
      ...REQUIRED_NON_TRANSFER_MIGRATIONS,
      '133_reconcile_transfer_ledger_observation_rail.sql',
    ],
    tableRows: [...REQUIRED_TABLES],
    indexRows: [...REQUIRED_INDEXES],
    flags: safeFlags,
    constraints: REQUIRED_CONSTRAINTS.map((conname) => ({
      table_name: 'settlements',
      conname,
      definition: 'UNIQUE (tenant_id, user_id, store_id, settlement_id, transaction_type)',
    })),
    ...overrides,
  });
}

describe('Audit Certification Transfer migration evidence', () => {
  it('passes with the historical Transfer migration record when all concrete safety checks pass', () => {
    const output = evaluate({
      migrationRows: [
        ...REQUIRED_NON_TRANSFER_MIGRATIONS,
        '129_transfer_ledger_observation_rail.sql',
      ],
    });

    expect(output.status).toBe('PASS');
    expect(output.checks.migrations.transferEvidencePresent).toEqual([
      '129_transfer_ledger_observation_rail.sql',
    ]);
  });

  it('passes with the forward-only reconciliation record when all concrete safety checks pass', () => {
    const output = evaluate();

    expect(output.status).toBe('PASS');
    expect(output.checks.migrations.transferEvidencePresent).toEqual([
      '133_reconcile_transfer_ledger_observation_rail.sql',
    ]);
    expect(output.checks.migrations.missingTransferEvidence).toEqual([]);
  });

  it('fails when neither legitimate Transfer migration record is present', () => {
    const output = evaluate({ migrationRows: [...REQUIRED_NON_TRANSFER_MIGRATIONS] });

    expect(output.status).toBe('FAIL');
    expect(output.checks.migrations.missingTransferEvidence).toEqual([
      'one of: 129_transfer_ledger_observation_rail.sql, 133_reconcile_transfer_ledger_observation_rail.sql',
    ]);
  });

  it('does not let a reconciliation record mask a missing Transfer table or index', () => {
    const missingTable = evaluate({
      tableRows: REQUIRED_TABLES.filter((name) => name !== 'transfer_ledger_observations'),
    });
    const missingIndex = evaluate({
      indexRows: REQUIRED_INDEXES.filter((name) => name !== 'transfer_ledger_observations_provider_scope_unique'),
    });

    expect(missingTable.status).toBe('FAIL');
    expect(missingTable.checks.schema.missingTables).toContain('transfer_ledger_observations');
    expect(missingIndex.status).toBe('FAIL');
    expect(missingIndex.checks.schema.missingIndexes).toContain('transfer_ledger_observations_provider_scope_unique');
  });

  it('fails closed when the Transfer flag is absent or no longer explicitly zero-claim', () => {
    const absent = evaluate({ flags: [safeFlags[0]] });
    const unsafe = evaluate({
      flags: [
        safeFlags[0],
        {
          ...safeFlags[1],
          is_enabled: true,
          rollout_percentage: 100,
          payload: { mode: 'SHADOW', claim_capable: true },
        },
      ],
    });

    expect(absent.status).toBe('FAIL');
    expect(absent.checks.flags.find((check) => check.flagName === 'connected_transfer_ledger_observation')?.safe).toBe(false);
    expect(unsafe.status).toBe('FAIL');
    expect(unsafe.checks.flags.find((check) => check.flagName === 'connected_transfer_ledger_observation')?.safe).toBe(false);
  });
});
