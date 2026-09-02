// @ts-nocheck
import { describe, expect, it, jest } from '@jest/globals';
import { executeTransferLedgerShadowObservation } from '../../src/services/agent2DataSyncService';

const context = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  tenantId: 'tenant-1',
  storeId: 'store-1',
  syncId: 'audit-sync-1',
  ledgerSyncId: 'ledger-sync-1',
  historyCoverageStart: new Date('2025-01-01T00:00:00.000Z'),
  historyCoverageEnd: new Date('2026-01-01T00:00:00.000Z'),
  historyCoverageStatus: 'FULL' as const,
  ledgerResult: { success: true, count: 1, message: 'persisted ledger only' },
  ...overrides,
});

const safeObservation = Object.freeze({
  sourceRunId: 'local-source-run',
  healthStatus: 'AMBIGUOUS_TRANSFER_EVIDENCE',
  observationCount: 2,
  ambiguityCount: 2,
  claimCapable: false,
  provenance: Object.freeze({
    sourceFingerprint: 'fixture-proof-only',
    origin: 'PERSISTED_PROVIDER_LEDGER',
    evidenceState: 'FRESH',
    executionContext: 'LOCAL_OBSERVATION_ONLY',
  }),
});

const dependencies = (flag: Record<string, unknown>, options: Record<string, unknown> = {}) => ({
  evaluateFlag: jest.fn().mockResolvedValue(flag),
  resolveMarketplaceId: jest.fn().mockResolvedValue('ATVPDKIKX0DER'),
  observe: jest.fn().mockResolvedValue(safeObservation),
  ...options,
});

describe('Transfer SHADOW observation execution boundary', () => {
  it('keeps OFF mode completely inert and exposes no activation capability', async () => {
    const deps = dependencies({
      enabled: false,
      reason: 'flag_disabled',
      payload: { mode: 'OFF', claim_capable: false, observation_version: 'v1' },
    });

    const result = await executeTransferLedgerShadowObservation(context(), deps);

    expect(deps.resolveMarketplaceId).not.toHaveBeenCalled();
    expect(deps.observe).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      attempted: false,
      claimCapable: false,
      detectorInvoked: false,
      catalogExecuted: false,
      recoveryInvoked: false,
      financialTruthInvoked: false,
      economicValue: null,
    }));
  });

  it.each([
    { mode: 'SHADOW', claim_capable: true, observation_version: 'v1' },
    { mode: 'ON', claim_capable: false, observation_version: 'v1' },
    { mode: 'SHADOW', claim_capable: false, observation_version: 'v2' },
    { mode: 'SHADOW', claim_capable: 'false', observation_version: 'v1' },
  ])('rejects unsafe or contradictory configuration without observing or activating: %o', async (payload) => {
    const deps = dependencies({ enabled: true, reason: 'enabled', payload });

    const result = await executeTransferLedgerShadowObservation(context(), deps);

    expect(deps.resolveMarketplaceId).not.toHaveBeenCalled();
    expect(deps.observe).not.toHaveBeenCalled();
    expect(result.attempted).toBe(false);
    expect(result).toEqual(expect.objectContaining({
      claimCapable: false,
      detectorInvoked: false,
      catalogExecuted: false,
      recoveryInvoked: false,
      financialTruthInvoked: false,
      economicValue: null,
    }));
  });

  it('allows only the exact zero-claim SHADOW contract to invoke the observer with persisted-ledger provenance', async () => {
    const deps = dependencies({
      enabled: true,
      reason: 'enabled',
      payload: { mode: 'SHADOW', claim_capable: false, observation_version: 'v1' },
    });

    const result = await executeTransferLedgerShadowObservation(context(), deps);

    expect(deps.evaluateFlag).toHaveBeenCalledWith('connected_transfer_ledger_observation', 'user-1');
    expect(deps.resolveMarketplaceId).toHaveBeenCalledWith('tenant-1', 'store-1');
    expect(deps.observe).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      storeId: 'store-1',
      marketplaceId: 'ATVPDKIKX0DER',
      syncId: 'audit-sync-1',
      ledgerSyncId: 'ledger-sync-1',
      originClassification: 'PERSISTED_PROVIDER_LEDGER',
    }));
    expect(result).toEqual(expect.objectContaining({
      attempted: true,
      observationResult: safeObservation,
      claimCapable: false,
      detectorInvoked: false,
      catalogExecuted: false,
      recoveryInvoked: false,
      financialTruthInvoked: false,
      economicValue: null,
    }));
  });

  it('propagates a failed observation dependency without fallback, detector, claim, recovery, or economic output', async () => {
    const failure = new Error('persisted ledger dependency failed');
    const deps = dependencies({
      enabled: true,
      reason: 'enabled',
      payload: { mode: 'SHADOW', claim_capable: false, observation_version: 'v1' },
    }, { observe: jest.fn().mockRejectedValue(failure) });

    await expect(executeTransferLedgerShadowObservation(context(), deps)).rejects.toThrow('persisted ledger dependency failed');
    expect(deps.resolveMarketplaceId).toHaveBeenCalledTimes(1);
    expect(deps.observe).toHaveBeenCalledTimes(1);
  });

  it('is deterministic under concurrent exact SHADOW attempts and never converts observation results into activation output', async () => {
    const deps = dependencies({
      enabled: true,
      reason: 'enabled',
      payload: { mode: 'SHADOW', claim_capable: false, observation_version: 'v1' },
    });

    const results = await Promise.all(Array.from({ length: 8 }, () => executeTransferLedgerShadowObservation(context(), deps)));

    expect(deps.observe).toHaveBeenCalledTimes(8);
    for (const result of results) {
      expect(result).toEqual(expect.objectContaining({
        attempted: true,
        claimCapable: false,
        detectorInvoked: false,
        catalogExecuted: false,
        recoveryInvoked: false,
        financialTruthInvoked: false,
        economicValue: null,
      }));
    }
  });
});
