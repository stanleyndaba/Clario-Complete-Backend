import { describe, expect, it } from '@jest/globals';
import {
  getMigrationFiles,
  getPendingMigrationFiles,
  validateMigrationCatalog,
} from '../../scripts/run-neon-migrations';

describe('canonical Neon migration catalog', () => {
  it('keeps both legacy duplicate-prefix 129 migrations independently addressable by full filename', () => {
    const files = getMigrationFiles();
    const applied = new Set(['129_add_support_request_delivery_truth.sql']);
    const pending = getPendingMigrationFiles(files, applied);

    expect(files).toEqual(expect.arrayContaining([
      '129_add_support_request_delivery_truth.sql',
      '129_transfer_ledger_observation_rail.sql',
      '133_reconcile_transfer_ledger_observation_rail.sql',
    ]));
    expect(pending).toContain('129_transfer_ledger_observation_rail.sql');
    expect(pending).not.toContain('129_add_support_request_delivery_truth.sql');
    expect(files).not.toContain('combined_migration.sql');
  });

  it('does not apply or record the historical Transfer file after its forward reconciliation is recorded', () => {
    const files = getMigrationFiles();
    const pending = getPendingMigrationFiles(files, new Set([
      '129_add_support_request_delivery_truth.sql',
      '133_reconcile_transfer_ledger_observation_rail.sql',
    ]));

    expect(pending).not.toContain('129_transfer_ledger_observation_rail.sql');
  });

  it('accepts the reviewed historical duplicate-prefix catalog', () => {
    expect(() => validateMigrationCatalog(getMigrationFiles())).not.toThrow();
  });

  it('rejects an undocumented duplicate numeric prefix rather than silently accepting it', () => {
    const files = getMigrationFiles();

    expect(() => validateMigrationCatalog([
      ...files,
      '133_unreviewed_duplicate.sql',
    ])).toThrow(/Duplicate prefix 133/);
  });
});
