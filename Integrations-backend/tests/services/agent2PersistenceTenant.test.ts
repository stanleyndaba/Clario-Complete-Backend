// @ts-nocheck
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const insertMock = jest.fn();
const upsertMock = jest.fn();
const updateMock = jest.fn();
const selectMock = jest.fn();
const eqMock = jest.fn();
const inMock = jest.fn();

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: selectMock.mockImplementation(() => ({
            eq: eqMock.mockImplementation(() => ({
              eq: eqMock.mockImplementation(() => ({
                in: inMock.mockResolvedValue({
                  data: [{ order_id: 'ORDER-1' }],
                  error: null,
                }),
              })),
            })),
          })),
          insert: insertMock.mockResolvedValue({ error: null }),
          update: updateMock.mockImplementation(() => ({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ error: null }),
              }),
            }),
          })),
        };
      }

      return {
        upsert: upsertMock.mockResolvedValue({ error: null }),
      };
    }),
  },
}));

describe('Agent2 tenant-safe persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires tenant_id for orders persistence', async () => {
    const { OrdersService } = await import('../../src/services/ordersService');
    const service = new OrdersService();

    await expect(
      service.saveOrdersToDatabase('user-1', [
        {
          order_id: 'ORDER-1',
          marketplace_id: 'ATVPDKIKX0DER',
          order_date: new Date().toISOString(),
          fulfillment_channel: 'FBA',
          items: [],
          quantities: {},
          status: 'Shipped',
          currency: 'USD',
        },
      ])
    ).rejects.toThrow('tenantId is required');
  });

  it('persists orders idempotently within tenant scope', async () => {
    const { OrdersService } = await import('../../src/services/ordersService');
    const service = new OrdersService();

    await service.saveOrdersToDatabase(
      'user-1',
      [
        {
          order_id: 'ORDER-1',
          marketplace_id: 'ATVPDKIKX0DER',
          order_date: new Date().toISOString(),
          fulfillment_channel: 'FBA',
          items: [],
          quantities: {},
          status: 'Shipped',
          currency: 'USD',
        },
        {
          order_id: 'ORDER-2',
          marketplace_id: 'ATVPDKIKX0DER',
          order_date: new Date().toISOString(),
          fulfillment_channel: 'FBA',
          items: [],
          quantities: {},
          status: 'Shipped',
          currency: 'USD',
        },
      ],
      undefined,
      'tenant-a'
    );

    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertedRows = insertMock.mock.calls[0][0];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].order_id).toBe('ORDER-2');
    expect(insertedRows[0].tenant_id).toBe('tenant-a');
  });

  it('uses tenant-aware upsert key for settlements idempotency', async () => {
    const { SettlementsService } = await import('../../src/services/settlementsService');
    const service = new SettlementsService();

    await service.saveSettlementsToDatabase(
      'user-1',
      [
        {
          settlement_id: 'SET-1',
          transaction_type: 'fee',
          amount: 10,
          fees: 10,
          currency: 'USD',
          settlement_date: new Date().toISOString(),
          fee_breakdown: {},
        },
      ],
      undefined,
      'tenant-a'
    );

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [, options] = upsertMock.mock.calls[0];
    expect(options.onConflict).toContain('tenant_id');
  });
});
