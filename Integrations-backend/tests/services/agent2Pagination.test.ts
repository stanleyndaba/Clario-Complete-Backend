// @ts-nocheck
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { OrdersService } from '../../src/services/ordersService';
import { SettlementsService } from '../../src/services/settlementsService';

jest.mock('axios');
jest.mock('../../src/services/amazonService', () => ({
  __esModule: true,
  default: {
    getRegionalBaseUrl: jest.fn(() => 'https://sellingpartnerapi-na.amazon.com'),
  },
}));

describe('Agent2 pagination hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
  });

  it('consumes all order pages using NextToken', async () => {
    const service = new OrdersService();
    jest.spyOn(service as any, 'getAccessToken').mockResolvedValue('token');

    (axios.get as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          payload: {
            Orders: [{ AmazonOrderId: 'A-1', MarketplaceId: 'ATVPDKIKX0DER', PurchaseDate: new Date().toISOString() }],
            NextToken: 'next-1',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          payload: {
            Orders: [{ AmazonOrderId: 'A-2', MarketplaceId: 'ATVPDKIKX0DER', PurchaseDate: new Date().toISOString() }],
          },
        },
      });

    const result = await service.fetchOrders('user-1', new Date('2025-01-01'), new Date('2025-02-01'));
    expect(result.success).toBe(true);
    expect(result.data.length).toBe(2);
    expect((axios.get as jest.Mock).mock.calls.length).toBe(2);
  });

  it('consumes all settlements pages using NextToken', async () => {
    const service = new SettlementsService();
    jest.spyOn(service as any, 'getAccessToken').mockResolvedValue('token');

    (axios.get as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          payload: {
            FinancialEvents: {
              AdjustmentEventList: [
                {
                  AdjustmentType: 'ADJ-1',
                  AdjustmentAmount: { CurrencyAmount: '10', CurrencyCode: 'USD' },
                  PostedDate: new Date().toISOString(),
                },
              ],
            },
            NextToken: 'next-1',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          payload: {
            FinancialEvents: {
              AdjustmentEventList: [
                {
                  AdjustmentType: 'ADJ-2',
                  AdjustmentAmount: { CurrencyAmount: '5', CurrencyCode: 'USD' },
                  PostedDate: new Date().toISOString(),
                },
              ],
            },
          },
        },
      });

    const result = await service.fetchSettlements('user-1', new Date('2025-01-01'), new Date('2025-02-01'));
    expect(result.success).toBe(true);
    expect(result.data.length).toBe(2);
    expect((axios.get as jest.Mock).mock.calls.length).toBe(2);
  });
});
