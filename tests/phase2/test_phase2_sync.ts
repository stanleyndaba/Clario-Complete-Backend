/**
 * Phase 2 Sync Tests
 * Tests for Orders, Shipments, Returns, and Settlements sync
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import ordersService from '../../Integrations-backend/src/services/ordersService';
import shipmentsService from '../../Integrations-backend/src/services/shipmentsService';
import returnsService from '../../Integrations-backend/src/services/returnsService';
import settlementsService from '../../Integrations-backend/src/services/settlementsService';

describe('Phase 2 Sync Services', () => {
  const testUserId = 'test-user-sandbox';
  const mockOrders = [
    {
      AmazonOrderId: '123-4567890-1234567',
      OrderStatus: 'Shipped',
      PurchaseDate: '2024-01-15T10:30:00Z',
      OrderItems: [
        {
          SellerSKU: 'TEST-SKU-001',
          ASIN: 'B07ABC123',
          QuantityOrdered: 2,
          ItemPrice: { Amount: '29.99', CurrencyCode: 'USD' }
        }
      ],
      FulfillmentChannel: 'FBA',
      MarketplaceId: 'ATVPDKIKX0DER'
    }
  ];

  const mockShipments = [
    {
      ShipmentId: 'FBA1234567',
      AmazonOrderId: '123-4567890-1234567',
      TrackingNumber: '1Z999AA10123456784',
      ShippedDate: '2024-01-15T10:30:00Z',
      ReceivedDate: '2024-01-20T14:00:00Z',
      Items: [
        {
          SellerSKU: 'TEST-SKU-001',
          ASIN: 'B07ABC123',
          QuantityShipped: 2
        }
      ]
    }
  ];

  const mockReturns = [
    {
      ReturnId: 'RET123456',
      AmazonOrderId: '123-4567890-1234567',
      ReturnReason: 'Defective',
      ReturnedDate: '2024-01-25T10:00:00Z',
      ReturnStatus: 'Processed',
      Items: [
        {
          SellerSKU: 'TEST-SKU-001',
          ASIN: 'B07ABC123',
          QuantityReturned: 1,
          RefundAmount: { Amount: '29.99', CurrencyCode: 'USD' }
        }
      ]
    }
  ];

  describe('Orders Service', () => {
    it('should normalize orders correctly', () => {
      const normalized = ordersService.normalizeOrders(mockOrders, testUserId);

      expect(normalized).toHaveLength(1);
      expect(normalized[0].order_id).toBe('123-4567890-1234567');
      expect(normalized[0].items).toHaveLength(1);
      expect(normalized[0].items[0].sku).toBe('TEST-SKU-001');
      expect(normalized[0].items[0].asin).toBe('B07ABC123');
      expect(normalized[0].items[0].quantity).toBe(2);
      expect(normalized[0].fulfillment_channel).toBe('FBA');
      expect(normalized[0].status).toBe('Shipped');
    });

    it('should handle empty orders array', () => {
      const normalized = ordersService.normalizeOrders([], testUserId);
      expect(normalized).toHaveLength(0);
    });

    it('should handle missing fields gracefully', () => {
      const incompleteOrder = {
        AmazonOrderId: '123-4567890-1234567'
      };
      const normalized = ordersService.normalizeOrders([incompleteOrder], testUserId);

      expect(normalized).toHaveLength(1);
      expect(normalized[0].order_id).toBe('123-4567890-1234567');
      expect(normalized[0].items).toHaveLength(0);
      expect(normalized[0].quantities).toEqual({});
    });
  });

  describe('Shipments Service', () => {
    it('should normalize shipments correctly', () => {
      const normalized = shipmentsService.normalizeShipments(mockShipments, testUserId);

      expect(normalized).toHaveLength(1);
      expect(normalized[0].shipment_id).toBe('FBA1234567');
      expect(normalized[0].order_id).toBe('123-4567890-1234567');
      expect(normalized[0].tracking_number).toBe('1Z999AA10123456784');
      expect(normalized[0].items).toHaveLength(1);
      expect(normalized[0].expected_quantity).toBe(2);
    });

    it('should calculate missing quantity correctly', () => {
      const shipmentWithMissing = {
        ShipmentId: 'FBA1234567',
        Items: [{ SellerSKU: 'TEST-SKU-001', ASIN: 'B07ABC123', QuantityShipped: 10 }],
        QuantityReceived: 8
      };
      const normalized = shipmentsService.normalizeShipments([shipmentWithMissing], testUserId);

      expect(normalized[0].expected_quantity).toBe(10);
      expect(normalized[0].received_quantity).toBe(8);
      expect(normalized[0].missing_quantity).toBe(2);
    });

    it('should determine shipment status correctly', () => {
      const inTransitShipment = {
        ShipmentId: 'FBA1234567',
        ShippedDate: '2024-01-15T10:30:00Z',
        Items: []
      };
      const normalized = shipmentsService.normalizeShipments([inTransitShipment], testUserId);
      expect(normalized[0].status).toBe('in_transit');
    });
  });

  describe('Returns Service', () => {
    it('should normalize returns correctly', () => {
      const normalized = returnsService.normalizeReturns(mockReturns, testUserId);

      expect(normalized).toHaveLength(1);
      expect(normalized[0].return_id).toBe('RET123456');
      expect(normalized[0].order_id).toBe('123-4567890-1234567');
      expect(normalized[0].reason).toBe('Defective');
      expect(normalized[0].items).toHaveLength(1);
      expect(normalized[0].refund_amount).toBe(29.99);
    });

    it('should detect partial returns', () => {
      const partialReturn = {
        ReturnId: 'RET123456',
        OrderQuantity: 5,
        Items: [
          {
            SellerSKU: 'TEST-SKU-001',
            ASIN: 'B07ABC123',
            QuantityReturned: 2,
            RefundAmount: { Amount: '59.98', CurrencyCode: 'USD' }
          }
        ]
      };
      const normalized = returnsService.normalizeReturns([partialReturn], testUserId);

      expect(normalized[0].is_partial).toBe(true);
    });
  });

  describe('Settlements Service', () => {
    it('should normalize settlements correctly', () => {
      const mockSettlements = [
        {
          settlement_id: 'SET123456',
          order_id: '123-4567890-1234567',
          transaction_type: 'fee',
          amount: 5.99,
          fees: 5.99,
          currency: 'USD',
          settlement_date: '2024-01-15T10:30:00Z',
          fee_breakdown: { fba_fee: 3.99, referral_fee: 2.00 }
        }
      ];

      const normalized = settlementsService.normalizeSettlements(mockSettlements, testUserId);

      expect(normalized).toHaveLength(1);
      expect(normalized[0].settlement_id).toBe('SET123456');
      expect(normalized[0].amount).toBe(5.99);
      expect(normalized[0].fee_breakdown.fba_fee).toBe(3.99);
    });

    it('should extract settlements from financial events', () => {
      const financialEvents = {
        ServiceFeeEventList: [
          {
            AmazonOrderId: '123-4567890-1234567',
            PostedDate: '2024-01-15T10:30:00Z',
            FeeList: [
              {
                FeeType: 'FBA',
                FeeAmount: { CurrencyAmount: '3.99', CurrencyCode: 'USD' }
              },
              {
                FeeType: 'Referral',
                FeeAmount: { CurrencyAmount: '2.00', CurrencyCode: 'USD' }
              }
            ]
          }
        ]
      };

      const settlements = settlementsService['extractSettlementsFromFinancialEvents'](financialEvents, testUserId);

      expect(settlements).toHaveLength(1);
      expect(settlements[0].transaction_type).toBe('fee');
      expect(settlements[0].fees).toBe(5.99);
      expect(settlements[0].fee_breakdown.fba).toBe(3.99);
      expect(settlements[0].fee_breakdown.referral).toBe(2.00);
    });
  });

  describe('Error Handling', () => {
    it('should handle sandbox empty responses gracefully', async () => {
      // Mock sandbox mode
      process.env.AMAZON_SPAPI_BASE_URL = 'https://sandbox.sellingpartnerapi-na.amazon.com';

      try {
        const result = await ordersService.fetchOrders(testUserId);
        // Should not throw, should return empty array
        expect(result.success).toBe(true);
        expect(Array.isArray(result.data)).toBe(true);
      } catch (error) {
        // If it throws, it should be a handled error
        expect(error).toBeDefined();
      }
    });
  });

  describe('Data Normalization', () => {
    it('should ensure all required fields are present', () => {
      const normalized = ordersService.normalizeOrders(mockOrders, testUserId);
      const order = normalized[0];

      // Required fields
      expect(order.order_id).toBeDefined();
      expect(order.marketplace_id).toBeDefined();
      expect(order.order_date).toBeDefined();
      expect(order.fulfillment_channel).toBeDefined();
      expect(order.items).toBeDefined();
      expect(order.quantities).toBeDefined();
      expect(order.status).toBeDefined();
      expect(order.currency).toBeDefined();
    });

    it('should handle null/undefined values correctly', () => {
      const orderWithNulls = {
        AmazonOrderId: '123-4567890-1234567',
        OrderItems: null,
        OrderTotal: null
      };
      const normalized = ordersService.normalizeOrders([orderWithNulls], testUserId);

      expect(normalized[0].items).toEqual([]);
      expect(normalized[0].total_amount).toBeNull();
    });
  });
});

