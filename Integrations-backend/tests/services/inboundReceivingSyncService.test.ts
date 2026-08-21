import { beforeEach, describe, expect, it, jest } from '@jest/globals';

let mockProviderResult: any;
const mockWrites: Array<{ table: string; rows: any }> = [];

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/fulfillmentInboundV0Service', () => ({
  INBOUND_PROVIDER_SOURCE: 'fulfillment_inbound_v0',
  INBOUND_PROVIDER_CONTRACT_VERSION: 'v0',
  fulfillmentInboundV0Service: {
    readInboundReceivingWindow: jest.fn(async () => mockProviderResult),
  },
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: jest.fn(async (rows: any) => {
        mockWrites.push({ table, rows });
        if (table === 'inbound_shipments') {
          return { data: (rows || []).map((row: any) => ({ id: `db-${row.provider_shipment_id}`, provider_shipment_id: row.provider_shipment_id })), error: null };
        }
        return { data: null, error: null };
      }),
    }),
  },
}));

import {
  InboundNormalizationError,
  InboundReceivingSyncService,
  mapInboundStatus,
  normalizeFulfillmentInboundV0,
} from '../../src/services/inboundReceivingSyncService';

const health = (status = 'AVAILABLE_DATA') => ({
  status,
  historyCoverageStatus: status === 'AVAILABLE_PARTIAL_HISTORY' ? 'PARTIAL' : 'FULL',
  requestedAfter: '2026-01-01T00:00:00.000Z',
  requestedBefore: '2026-01-31T00:00:00.000Z',
  providerRequestCount: 2,
});

const result = (overrides: Record<string, unknown> = {}): any => ({
  source: 'fulfillment_inbound_v0',
  contractVersion: 'v0',
  shipments: [{
    ShipmentId: 'SHP-1',
    ShipmentStatus: 'CLOSED',
    CreatedDate: '2025-12-01T00:00:00.000Z',
    LastUpdatedDate: '2026-01-01T00:00:00.000Z',
    DestinationFulfillmentCenterId: 'ABE8',
  }],
  shipmentItems: [{
    ShipmentId: 'SHP-1',
    SellerSKU: 'SKU-1',
    FulfillmentNetworkSKU: 'FNSKU-1',
    QuantityShipped: 10,
    QuantityReceived: null,
  }],
  health: health(),
  ...overrides,
});

const input = {
  userId: 'user-1',
  tenantId: 'tenant-a',
  storeId: 'store-1',
  syncId: 'sync-1',
  marketplaceId: 'ATVPDKIKX0DER',
  lastUpdatedAfter: new Date('2026-01-01T00:00:00.000Z'),
  lastUpdatedBefore: new Date('2026-01-31T00:00:00.000Z'),
};

describe('Inbound receiving normalization', () => {
  beforeEach(() => {
    mockWrites.length = 0;
    mockProviderResult = result();
  });

  it.each([
    ['WORKING', 'PLANNED'],
    ['READY_TO_SHIP', 'PLANNED'],
    ['SHIPPED', 'IN_TRANSIT'],
    ['IN_TRANSIT', 'IN_TRANSIT'],
    ['DELIVERED', 'DELIVERED_OR_CHECKED_IN'],
    ['CHECKED_IN', 'DELIVERED_OR_CHECKED_IN'],
    ['RECEIVING', 'RECEIVING'],
    ['CLOSED', 'CLOSED'],
    ['CANCELLED', 'CANCELLED_OR_DELETED'],
    ['CANCELED', 'CANCELLED_OR_DELETED'],
    ['DELETED', 'CANCELLED_OR_DELETED'],
    ['NEW_PROVIDER_STATE', 'PROVIDER_ERROR_OR_UNKNOWN'],
  ])('maps provider status %s to the controlled canonical status %s', (raw, canonical) => {
    expect(mapInboundStatus(raw)).toBe(canonical);
  });

  it('preserves shipped quantity and keeps unknown received quantity null', () => {
    const normalized = normalizeFulfillmentInboundV0(result());

    expect(normalized.items).toEqual([expect.objectContaining({
      quantityShipped: 10,
      quantityReceived: null,
      providerItemIdentity: 'SHP-1|SKU-1|FNSKU-1',
    })]);
    expect(normalized.shipments[0]).toEqual(expect.objectContaining({
      shipmentStatusCanonical: 'CLOSED',
      destinationFulfillmentCenterId: 'ABE8',
    }));
  });

  it('fails closed for conflicting duplicate shipment or item identities', () => {
    const duplicateShipment = result({
      shipments: [
        result().shipments[0],
        { ...result().shipments[0], ShipmentStatus: 'RECEIVING' },
      ],
    });
    const duplicateItem = result({
      shipmentItems: [
        result().shipmentItems[0],
        { ...result().shipmentItems[0], QuantityReceived: 8 },
      ],
    });

    expect(() => normalizeFulfillmentInboundV0(duplicateShipment)).toThrow(InboundNormalizationError);
    expect(() => normalizeFulfillmentInboundV0(duplicateItem)).toThrow(InboundNormalizationError);
  });

  it('fails closed for an item without a shipment parent', () => {
    const orphan = result({
      shipmentItems: [{ ...result().shipmentItems[0], ShipmentId: 'MISSING-PARENT' }],
    });

    let thrown: unknown;
    try {
      normalizeFulfillmentInboundV0(orphan);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual(expect.objectContaining({ code: 'ORPHAN_INBOUND_ITEM' }));
  });

  it('persists unavailable source health without canonical rows and returns non-claim-capable output', async () => {
    mockProviderResult = result({
      shipments: [],
      shipmentItems: [],
      health: { ...health('ACCESS_DENIED'), errorCode: '403', errorMessage: 'Access denied' },
    });
    const service = new InboundReceivingSyncService();

    const output = await service.synchronize(input);

    expect(output).toEqual(expect.objectContaining({
      healthStatus: 'ACCESS_DENIED',
      claimCapable: false,
      shipmentCount: 0,
      itemCount: 0,
      errorCode: '403',
    }));
    expect(mockWrites).toHaveLength(1);
    expect(mockWrites[0]).toEqual(expect.objectContaining({
      table: 'inbound_source_runs',
      rows: expect.objectContaining({ health_status: 'ACCESS_DENIED', sync_id: 'sync-1' }),
    }));
  });
});
