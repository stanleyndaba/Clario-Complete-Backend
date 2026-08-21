import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const tables: Record<string, Row[]> = {};
const mockEvaluate: any = jest.fn();

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/featureFlagService', () => ({
  featureFlagService: { evaluate: (...args: any[]) => mockEvaluate(...args) },
}));

jest.mock('../../src/database/supabaseClient', () => {
  const builderFor = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let limit: number | undefined;
    let single = false;
    const builder: any = {
      select: () => builder,
      eq: (field: string, value: unknown) => {
        filters.push((row) => row[field] === value);
        return builder;
      },
      order: () => builder,
      limit: (value: number) => {
        limit = value;
        return builder;
      },
      maybeSingle: () => {
        single = true;
        return builder;
      },
      then: (resolve: any, reject: any) => {
        let rows = [...(tables[table] || [])].filter((row) => filters.every((filter) => filter(row)));
        if (limit !== undefined) rows = rows.slice(0, limit);
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  return { supabaseAdmin: { from: (table: string) => builderFor(table) } };
});

import {
  detectInboundAnomalies,
  runInboundDetection,
} from '../../src/services/detection/core/detectors/inboundAlgorithms';

describe('Inbound Inspector P1 Connected Audit regression', () => {
  beforeEach(() => {
    Object.keys(tables).forEach((key) => delete tables[key]);
    mockEvaluate.mockReset();
    tables.tenant_memberships = [{ user_id: 'user-1', tenant_id: 'tenant-a' }];
  });

  it('does not read or produce Connected Audit inbound claims while the canonical flag is OFF', async () => {
    mockEvaluate.mockResolvedValue({ enabled: false, reason: 'flag_disabled', payload: { mode: 'OFF' } });
    tables.inbound_source_runs = [{
      tenant_id: 'tenant-a',
      user_id: 'user-1',
      sync_id: 'sync-1',
      health_status: 'AVAILABLE_DATA',
    }];

    await expect(runInboundDetection('user-1', 'sync-1')).resolves.toEqual([]);
    expect(mockEvaluate).toHaveBeenCalledWith('connected_inbound_v0_primary', 'user-1');
  });

  it.each(['ACCESS_DENIED', 'UNSUPPORTED_ACCOUNT_OR_MARKETPLACE', 'PARSER_FAILURE', 'RATE_LIMITED_OR_TEMPORARY_ERROR', 'AVAILABLE_PARTIAL_HISTORY'])(
    'suppresses Connected Audit inbound output when canonical source health is %s',
    async (healthStatus) => {
      mockEvaluate.mockResolvedValue({ enabled: true, reason: 'user_targeted', payload: { mode: 'ON' } });
      tables.inbound_source_runs = [{
        tenant_id: 'tenant-a',
        user_id: 'user-1',
        sync_id: 'sync-1',
        health_status: healthStatus,
        completed_at: '2026-01-31T00:00:00.000Z',
      }];

      await expect(runInboundDetection('user-1', 'sync-1')).resolves.toEqual([]);
    },
  );

  it('keeps direct manual evidence evaluation available without invoking the Connected Audit source gate', () => {
    const results = detectInboundAnomalies('manual-user', 'manual-sync', {
      seller_id: 'manual-user',
      sync_id: 'manual-sync',
      inbound_shipment_items: [{
        id: 'manual-item-1',
        seller_id: 'manual-user',
        shipment_id: 'MANUAL-SHP-1',
        sku: 'SKU-1',
        quantity_shipped: 10,
        quantity_received: 8,
        shipment_status: 'CLOSED',
        shipment_created_date: '2025-01-01T00:00:00.000Z',
        shipment_closed_date: '2025-01-02T00:00:00.000Z',
        created_at: '2025-01-02T00:00:00.000Z',
      }],
      reimbursement_events: [],
    });

    expect(results.map((entry) => entry.anomaly_type)).toContain('shipment_shortage');
    expect(mockEvaluate).not.toHaveBeenCalled();
  });
});
