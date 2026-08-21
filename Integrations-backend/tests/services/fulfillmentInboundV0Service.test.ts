import { describe, expect, it, jest } from '@jest/globals';
import { FulfillmentInboundV0Service } from '../../src/services/fulfillmentInboundV0Service';

const INPUT = {
  userId: 'user-1',
  tenantId: 'tenant-a',
  storeId: 'store-1',
  marketplaceId: 'ATVPDKIKX0DER',
  lastUpdatedAfter: new Date('2026-01-01T00:00:00.000Z'),
  lastUpdatedBefore: new Date('2026-01-31T00:00:00.000Z'),
};

const shipment = (id: string) => ({
  ShipmentId: id,
  ShipmentStatus: 'CLOSED',
  LastUpdatedDate: '2026-01-01T00:00:00.000Z',
});

const item = (shipmentId: string, sku = 'SKU-1') => ({
  ShipmentId: shipmentId,
  SellerSKU: sku,
  QuantityShipped: 10,
  QuantityReceived: 8,
});

const providerError = (status: number, message: string) => Object.assign(new Error(message), {
  response: {
    status,
    data: { errors: [{ code: String(status), message }] },
  },
});

const makeService = (request: any, sleep?: any) => new FulfillmentInboundV0Service({
  request: request as any,
  getAccessToken: async () => 'access-token',
  getRegionalBaseUrl: () => 'https://sellingpartnerapi-na.amazon.com',
  ...(sleep ? { sleep: sleep as any } : {}),
  maxRetries: 2,
});

describe('FulfillmentInboundV0Service', () => {
  it('uses DATE_RANGE with the explicit marketplace scope and canonical v0 paths', async () => {
    const request: any = jest.fn(async ({ url, params }: any) => {
      if (url.endsWith('/shipments')) return { data: { payload: { ShipmentData: [shipment('SHP-1')] } } };
      return { data: { payload: { ItemData: [item('SHP-1')] } } };
    });
    const service = makeService(request);

    const result = await service.readInboundReceivingWindow(INPUT);

    expect(result.health.status).toBe('AVAILABLE_DATA');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toEqual(expect.objectContaining({
      url: 'https://sellingpartnerapi-na.amazon.com/fba/inbound/v0/shipments',
      params: {
        QueryType: 'DATE_RANGE',
        MarketplaceId: 'ATVPDKIKX0DER',
        LastUpdatedAfter: '2026-01-01T00:00:00.000Z',
        LastUpdatedBefore: '2026-01-31T00:00:00.000Z',
      },
    }));
    expect(request.mock.calls[1][0].url).toBe('https://sellingpartnerapi-na.amazon.com/fba/inbound/v0/shipmentItems');
  });

  it('follows independent shipment and item NextToken pages', async () => {
    const request: any = jest.fn(async ({ url, params }: any) => {
      if (url.endsWith('/shipments') && params.QueryType === 'DATE_RANGE') {
        return { data: { payload: { ShipmentData: [shipment('SHP-1')], NextToken: 'shipments-page-2' } } };
      }
      if (url.endsWith('/shipments')) {
        expect(params).toEqual({ QueryType: 'NEXT_TOKEN', NextToken: 'shipments-page-2' });
        return { data: { payload: { ShipmentData: [shipment('SHP-2')] } } };
      }
      if (params.QueryType === 'DATE_RANGE') {
        return { data: { payload: { ItemData: [item('SHP-1')], NextToken: 'items-page-2' } } };
      }
      expect(params).toEqual({ QueryType: 'NEXT_TOKEN', NextToken: 'items-page-2' });
      return { data: { payload: { ItemData: [item('SHP-2', 'SKU-2')] } } };
    });
    const service = makeService(request);

    const result = await service.readInboundReceivingWindow(INPUT);

    expect(result.health.status).toBe('AVAILABLE_DATA');
    expect(result.shipments.map(row => row.ShipmentId)).toEqual(['SHP-1', 'SHP-2']);
    expect(result.shipmentItems.map(row => row.ShipmentId)).toEqual(['SHP-1', 'SHP-2']);
    expect(result.health.providerRequestCount).toBe(4);
  });

  it('retries a temporary rate limit with a bounded backoff', async () => {
    const request: any = jest.fn();
    request.mockRejectedValueOnce(providerError(429, 'slow down'));
    request.mockResolvedValueOnce({ data: { payload: { ShipmentData: [shipment('SHP-1')] } } });
    request.mockResolvedValueOnce({ data: { payload: { ItemData: [item('SHP-1')] } } });
    const sleep: any = jest.fn(async () => undefined);
    const service = makeService(request, sleep);

    const result = await service.readInboundReceivingWindow(INPUT);

    expect(result.health.status).toBe('AVAILABLE_DATA');
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('fails closed on permanent authentication failure and does not retry', async () => {
    const request: any = jest.fn();
    request.mockRejectedValue(providerError(403, 'Access denied'));
    const service = makeService(request);

    const result = await service.readInboundReceivingWindow(INPUT);

    expect(result.health.status).toBe('ACCESS_DENIED');
    expect(result.health.errorCode).toBe('403');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('bounds repeated 5xx retries and classifies the source as temporary failure', async () => {
    const request: any = jest.fn();
    request.mockRejectedValue(providerError(503, 'upstream unavailable'));
    const sleep: any = jest.fn(async () => undefined);
    const service = makeService(request, sleep);

    const result = await service.readInboundReceivingWindow(INPUT);

    expect(result.health.status).toBe('RATE_LIMITED_OR_TEMPORARY_ERROR');
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('distinguishes a successful empty response from an orphaned item response', async () => {
    const emptyService = makeService(jest.fn(async ({ url }: any) => url.endsWith('/shipments')
      ? { data: { payload: { ShipmentData: [] } } }
      : { data: { payload: { ItemData: [] } } }));
    const orphanService = makeService(jest.fn(async ({ url }: any) => url.endsWith('/shipments')
      ? { data: { payload: { ShipmentData: [shipment('SHP-1')] } } }
      : { data: { payload: { ItemData: [item('MISSING-PARENT')] } } }));

    await expect(emptyService.readInboundReceivingWindow(INPUT)).resolves.toMatchObject({
      health: { status: 'AVAILABLE_ZERO_QUALIFYING_DATA' },
      shipments: [],
      shipmentItems: [],
    });
    await expect(orphanService.readInboundReceivingWindow(INPUT)).resolves.toMatchObject({
      health: { status: 'PARSER_FAILURE', errorCode: 'ORPHAN_INBOUND_ITEM' },
      shipments: [],
      shipmentItems: [],
    });
  });
});
