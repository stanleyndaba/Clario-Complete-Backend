import { afterEach, describe, expect, it } from '@jest/globals';
import { assertApplyEnvironment, assertApprovedProductionTarget } from '../../scripts/apply-transfer-ledger-reconciliation-133';

const originalConfirmation = process.env.CONFIRM_TRANSFER_RECONCILIATION_133;

afterEach(() => {
  if (originalConfirmation === undefined) {
    delete process.env.CONFIRM_TRANSFER_RECONCILIATION_133;
  } else {
    process.env.CONFIRM_TRANSFER_RECONCILIATION_133 = originalConfirmation;
  }
});

describe('Transfer reconciliation apply guard', () => {
  it('fails closed when no approved confirmation is supplied', () => {
    delete process.env.CONFIRM_TRANSFER_RECONCILIATION_133;

    expect(() => assertApplyEnvironment()).toThrow(/Refusing to apply Transfer reconciliation/);
  });

  it('fails closed for an imprecise confirmation value', () => {
    process.env.CONFIRM_TRANSFER_RECONCILIATION_133 = 'true';

    expect(() => assertApplyEnvironment()).toThrow(/CONFIRM_TRANSFER_RECONCILIATION_133=APPLY/);
  });

  it('accepts only the exact controlled-apply confirmation value', () => {
    process.env.CONFIRM_TRANSFER_RECONCILIATION_133 = 'APPLY';

    expect(() => assertApplyEnvironment()).not.toThrow();
  });

  it('accepts only the approved Neon host and database target', () => {
    expect(() => assertApprovedProductionTarget('postgresql://role:password@ep-purple-sun-ata5l2u7.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require')).not.toThrow();
    expect(() => assertApprovedProductionTarget('postgresql://role:password@localhost/neondb')).toThrow(/approved Neon production database/);
    expect(() => assertApprovedProductionTarget('postgresql://role:password@ep-purple-sun-ata5l2u7.c-9.us-east-1.aws.neon.tech/other_database')).toThrow(/approved Neon production database/);
  });
});
