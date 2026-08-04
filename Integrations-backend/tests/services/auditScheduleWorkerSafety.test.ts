import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import auditRunService from '../../src/services/auditRunService';
import { supabaseAdmin } from '../../src/database/supabaseClient';
import workspaceEntitlementService from '../../src/services/workspaceEntitlementService';
import { withPostgresTransaction } from '../../src/database/postgresTransaction';

jest.mock('../../src/database/postgresTransaction', () => ({
  withPostgresTransaction: jest.fn(),
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('../../src/services/workspaceEntitlementService', () => ({
  __esModule: true,
  default: {
    getTenantEntitlement: jest.fn(),
  },
}));

jest.mock('../../src/services/userWorkspaceBootstrap', () => ({
  ensureAuthenticatedUserWorkspace: jest.fn(),
  convertUserIdToUuid: (value: string) => value,
}));

jest.mock('../../src/services/syncJobManager', () => ({
  syncJobManager: {},
}));

jest.mock('../../src/services/enhancedDetectionService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const dueSchedule = {
  id: 'schedule-1',
  user_id: 'user-1',
  tenant_id: 'tenant-1',
  cadence: 'weekly',
  preferred_day_of_week: 1,
  preferred_day_of_month: null,
  preferred_time: '09:00',
  timezone: 'Africa/Johannesburg',
  metadata: {},
};

function chain(result: any) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'insert', 'update', 'single']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn(async () => result);
  builder.single = jest.fn(async () => result);
  return builder;
}

describe('audit schedule worker safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('claims a due schedule once and skips a concurrent claimant', async () => {
    const withTx = withPostgresTransaction as any;
    withTx
      .mockImplementationOnce(async (operation: any) => operation({
        query: jest.fn(async () => ({ rows: [dueSchedule] })),
      }))
      .mockImplementationOnce(async (operation: any) => operation({
        query: jest.fn(async () => ({ rows: [] })),
      }));

    (workspaceEntitlementService.getTenantEntitlement as any).mockResolvedValue({
      entitlement: { entitled: false, state: 'none' },
    });
    (supabaseAdmin.from as any).mockReturnValue(chain({ data: null, error: null }));

    const [first, second] = await Promise.all([
      auditRunService.processDueSchedules(1),
      auditRunService.processDueSchedules(1),
    ]);

    expect(first.processed).toBe(1);
    expect(first.skipped).toBe(1);
    expect(second.processed).toBe(0);
    expect(withTx).toHaveBeenCalledTimes(2);
  });

  it('does not start a new audit when a tenant already has a running audit', async () => {
    (withPostgresTransaction as any).mockImplementationOnce(async (operation: any) => operation({
      query: jest.fn(async () => ({ rows: [dueSchedule] })),
    })).mockImplementationOnce(async (operation: any) => operation({
      query: jest.fn(async () => ({ rows: [] })),
    }));

    (workspaceEntitlementService.getTenantEntitlement as any).mockResolvedValue({
      entitlement: { entitled: true, state: 'active' },
    });

    const runningAudit = chain({ data: { id: 'audit-running', status: 'syncing' }, error: null });
    const updateSchedule = chain({ data: null, error: null });
    (supabaseAdmin.from as any)
      .mockReturnValueOnce(runningAudit)
      .mockReturnValueOnce(updateSchedule);

    const result = await auditRunService.processDueSchedules(1);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('tokens');
    expect(runningAudit.insert).not.toHaveBeenCalled();
  });

  it('handles a missing audit_schedules table as an unavailable worker dependency', async () => {
    (withPostgresTransaction as any).mockRejectedValueOnce(Object.assign(new Error('relation "audit_schedules" does not exist'), {
      code: '42P01',
    }));

    const result = await auditRunService.processDueSchedules(1);

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
  });
});
