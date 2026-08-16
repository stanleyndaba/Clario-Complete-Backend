import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import auditRunService from '../../src/services/auditRunService';
import { supabaseAdmin } from '../../src/database/supabaseClient';
import auditIntentService from '../../src/services/auditIntentService';
import { ensureAuthenticatedUserWorkspace } from '../../src/services/userWorkspaceBootstrap';

jest.mock('../../src/database/supabaseClient', () => ({
  convertUserIdToUuid: (value: string) => value,
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('../../src/services/userWorkspaceBootstrap', () => ({
  ensureAuthenticatedUserWorkspace: jest.fn(),
}));

jest.mock('../../src/services/syncJobManager', () => ({
  syncJobManager: {
    startSync: jest.fn(),
    getSyncStatus: jest.fn(),
  },
}));

jest.mock('../../src/services/enhancedDetectionService', () => ({
  __esModule: true,
  default: {
    triggerDetectionPipeline: jest.fn(),
  },
}));

jest.mock('../../src/services/workspaceEntitlementService', () => ({
  __esModule: true,
  default: {
    getTenantEntitlement: jest.fn(async () => ({ entitlement: { entitled: false } })),
  },
}));

jest.mock('../../src/utils/tokenManager', () => ({
  __esModule: true,
  default: {
    isTokenValid: jest.fn(),
  },
}));

function queryResult(result: any) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    neq: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
  };
  return chain;
}

describe('auditRunService CSV upload audit rail', () => {
  const service: any = auditRunService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete service.getCsvUploadRunForAudit;
    delete service.getCsvDetectionStatusForAudit;
    delete service.getLatestCompletedAudit;
    delete service.updateAudit;
    delete service.getAudit;
    delete service.getAmazonConnection;
    jest.restoreAllMocks();
  });

  it('resumes the same CSV sync audit without applying the 30-day block', async () => {
    const existingAudit = {
      id: 'audit-csv-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      source_type: 'csv_upload',
      sync_id: 'csv_123',
      status: 'detecting',
      activation_status: 'not_activated',
      summary: {},
    };

    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'csv_123',
      tenant_id: 'tenant-1',
      seller_id: 'user-1',
      detection_triggered: true,
      files_summary: [{ csvType: 'orders', rowsInserted: 10 }],
      created_at: '2026-08-01T00:00:00.000Z',
    }));
    service.getCsvDetectionStatusForAudit = jest.fn(async () => ({ status: 'running', resultCount: 0 }));
    service.getLatestCompletedAudit = jest.fn();
    service.updateAudit = jest.fn(async (_id: string, updates: any) => ({ ...existingAudit, ...updates }));

    (supabaseAdmin.from as any).mockReturnValueOnce(queryResult({ data: existingAudit, error: null }));

    const result = await auditRunService.createOrResumeCsvAuditFromSync({
      userId: 'user-1',
      tenantId: 'tenant-1',
      syncId: 'csv_123',
    });

    expect(result.id).toBe('audit-csv-1');
    expect(result.status).toBe('detecting');
    expect(service.getLatestCompletedAudit).toHaveBeenCalledWith('user-1', 'tenant-1', 'audit-csv-1');
  });

  it('blocks a genuinely new CSV audit inside the global 30-day complimentary window', async () => {
    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'csv_456',
      tenant_id: 'tenant-1',
      seller_id: 'user-1',
      detection_triggered: true,
      files_summary: [{ csvType: 'orders', rowsInserted: 10 }],
      created_at: '2026-08-01T00:00:00.000Z',
    }));
    service.getCsvDetectionStatusForAudit = jest.fn(async () => ({ status: 'running', resultCount: 0 }));
    service.getLatestCompletedAudit = jest.fn(async () => ({
      id: 'audit-prev',
      status: 'completed',
      next_eligible_at: '2999-01-01T00:00:00.000Z',
    }));
    service.updateAudit = jest.fn();

    (supabaseAdmin.from as any).mockReturnValueOnce(queryResult({ data: null, error: null }));

    await expect(auditRunService.createOrResumeCsvAuditFromSync({
      userId: 'user-1',
      tenantId: 'tenant-1',
      syncId: 'csv_456',
    })).rejects.toThrow('next complimentary manual report audit');

    expect(service.updateAudit).not.toHaveBeenCalled();
  });

  it('polls a CSV audit from runAudit without entering Amazon connection logic', async () => {
    const csvAudit = {
      id: 'audit-csv-2',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      source_type: 'csv_upload',
      sync_id: 'csv_789',
      status: 'detecting',
      summary: {},
    };

    service.getAudit = jest.fn(async () => csvAudit);
    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'csv_789',
      tenant_id: 'tenant-1',
      seller_id: 'user-1',
      detection_triggered: true,
      files_summary: [{ csvType: 'orders', rowsInserted: 4 }],
      created_at: '2026-08-01T00:00:00.000Z',
    }));
    service.getCsvDetectionStatusForAudit = jest.fn(async () => ({ status: 'running', resultCount: 0 }));
    service.getAmazonConnection = jest.fn();
    service.updateAudit = jest.fn(async (_id: string, updates: any) => ({ ...csvAudit, ...updates }));

    const result = await auditRunService.runAudit('audit-csv-2', 'user-1');

    expect(result.status).toBe('detecting');
    expect(result.summary.message).toContain('Manual report detection is still running');
    expect(service.getAmazonConnection).not.toHaveBeenCalled();
  });

  it('rejects a manual-report intent when starting a connected SP-API audit', async () => {
    (ensureAuthenticatedUserWorkspace as any).mockResolvedValue({
      userId: 'user-1',
      tenant: { id: 'tenant-1', slug: 'tenant-1' },
    });
    jest.spyOn(auditIntentService, 'getOwnedActiveIntent').mockResolvedValue({
      id: 'intent-manual',
      source_type: 'csv_upload',
      status: 'attached',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      audit_run_id: null,
      return_path: '/data-upload?returnTo=audit',
      metadata: {},
      attached_at: null,
      consumed_at: null,
      abandoned_at: null,
      expires_at: '2999-01-01T00:00:00.000Z',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    } as any);

    await expect(auditRunService.startAudit('user-1', 'seller@example.com', 'intent-manual'))
      .rejects.toThrow('manual report upload');
  });

  it('rejects a connected SP-API intent when creating a CSV manual audit', async () => {
    jest.spyOn(auditIntentService, 'getOwnedActiveIntent').mockResolvedValue({
      id: 'intent-connected',
      source_type: 'sp_api',
      status: 'attached',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      audit_run_id: null,
      return_path: '/audit',
      metadata: {},
      attached_at: null,
      consumed_at: null,
      abandoned_at: null,
      expires_at: '2999-01-01T00:00:00.000Z',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    } as any);

    await expect(auditRunService.createOrResumeCsvAuditFromSync({
      userId: 'user-1',
      tenantId: 'tenant-1',
      syncId: 'csv_999',
      auditIntentId: 'intent-connected',
    })).rejects.toThrow('connected Amazon audit');
  });

  it('rejects an expired connected audit intent before creating or resuming an SP-API audit', async () => {
    (ensureAuthenticatedUserWorkspace as any).mockResolvedValue({
      userId: 'user-1',
      tenant: { id: 'tenant-1', slug: 'tenant-1' },
    });
    jest.spyOn(auditIntentService, 'getOwnedActiveIntent').mockResolvedValue(null);

    await expect(auditRunService.startAudit('user-1', 'seller@example.com', 'intent-expired'))
      .rejects.toThrow('no longer active');
  });

  it('rejects an expired manual audit intent before binding a CSV upload audit', async () => {
    jest.spyOn(auditIntentService, 'getOwnedActiveIntent').mockResolvedValue(null);

    await expect(auditRunService.createOrResumeCsvAuditFromSync({
      userId: 'user-1',
      tenantId: 'tenant-1',
      syncId: 'csv_999',
      auditIntentId: 'intent-expired',
    })).rejects.toThrow('no longer active');
  });
});
