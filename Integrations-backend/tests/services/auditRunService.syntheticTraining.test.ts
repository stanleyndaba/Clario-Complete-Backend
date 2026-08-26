import { afterEach, describe, expect, it, jest } from '@jest/globals';

const accept = jest.fn();

jest.mock('../../src/database/supabaseClient', () => ({
  convertUserIdToUuid: (value: string) => value,
  supabaseAdmin: { from: jest.fn() },
}));
jest.mock('../../src/services/userWorkspaceBootstrap', () => ({ ensureAuthenticatedUserWorkspace: jest.fn() }));
jest.mock('../../src/services/syncJobManager', () => ({ syncJobManager: { startSync: jest.fn(), getSyncStatus: jest.fn() } }));
jest.mock('../../src/services/enhancedDetectionService', () => ({ __esModule: true, default: { triggerDetectionPipeline: jest.fn() } }));
jest.mock('../../src/services/workspaceEntitlementService', () => ({ __esModule: true, default: { getTenantEntitlement: jest.fn() } }));
jest.mock('../../src/notifications/services/system_signal_service', () => ({ systemSignalService: { accept } }));

import auditRunService from '../../src/services/auditRunService';
import { syntheticTrainingSummaryFields } from '../../src/services/syntheticAuditExecutionContext';

const originalTenantId = process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;

function configureTrainingTenant() {
  process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';
}

afterEach(() => {
  jest.clearAllMocks();
  if (originalTenantId === undefined) delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
  else process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = originalTenantId;
});

describe('auditRunService synthetic training boundary', () => {
  it('fails closed if any caller attempts to persist a commercial outcome for a trusted synthetic audit', async () => {
    configureTrainingTenant();
    await expect((auditRunService as any).persistCommercialOutcome({
      audit: { id: 'synthetic-audit', sync_id: 'synthetic_csv_001', tenant_id: 'training-tenant' },
      summary: syntheticTrainingSummaryFields(),
      previousAudit: null,
      hasRecoveryWorkspace: false,
    })).rejects.toThrow('Synthetic training audits cannot persist commercial outcomes');
  });

  it('rejects a synthetic-looking sync that has no durable provenance before it can silently affect commercial handling', async () => {
    configureTrainingTenant();
    await expect((auditRunService as any).persistCommercialOutcome({
      audit: { id: 'prefix-only-audit', sync_id: 'synthetic_csv_001', tenant_id: 'training-tenant' },
      summary: { finalStatus: 'complete_no_findings' },
      previousAudit: null,
      hasRecoveryWorkspace: false,
    })).rejects.toThrow('Synthetic sync identity is missing trusted execution provenance');
  });

  it('suppresses a completed-audit system signal only for trusted synthetic provenance', async () => {
    configureTrainingTenant();
    await (auditRunService as any).emitCompletedAuditSignal({
      id: 'synthetic-audit',
      tenant_id: 'training-tenant',
      status: 'completed',
      sync_id: 'synthetic_csv_001',
    }, {
      finalStatus: 'complete_with_findings',
      ...syntheticTrainingSummaryFields(),
    });

    expect(accept).not.toHaveBeenCalled();
  });

  it('blocks control-statement and export artifacts and returns only an explicit synthetic activity record', async () => {
    configureTrainingTenant();
    const audit = {
      id: 'synthetic-audit',
      tenant_id: 'training-tenant',
      user_id: 'training-user',
      sync_id: 'synthetic_csv_001',
      status: 'completed',
      created_at: '2026-08-26T00:00:00.000Z',
      updated_at: '2026-08-26T00:10:00.000Z',
      completed_at: '2026-08-26T00:10:00.000Z',
      summary: {
        findingsCount: 3,
        scopeValue: 99,
        ...syntheticTrainingSummaryFields(),
      },
    };
    jest.spyOn(auditRunService as any, 'getAudit').mockResolvedValue(audit);

    await expect(auditRunService.getControlStatement('synthetic-audit', 'training-user', 'training-tenant'))
      .rejects.toThrow('Synthetic training audits cannot expose control statements');
    await expect(auditRunService.getExportSummary('synthetic-audit', 'training-user', 'training-tenant'))
      .rejects.toThrow('Synthetic training audits cannot produce reporting exports');

    await expect(auditRunService.getActivity('synthetic-audit', 'training-user', 'training-tenant'))
      .resolves.toEqual([expect.objectContaining({
        category: 'Synthetic training',
        message: expect.stringContaining('no Amazon seller data'),
      })]);
  });
});
