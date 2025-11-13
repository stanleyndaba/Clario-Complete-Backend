/**
 * Mock Data Generator for Amazon SP-API
 * Generates realistic SP-API responses programmatically for testing
 * Supports 3 test scenarios: normal_week, high_volume, with_issues
 */

import logger from '../utils/logger';

export type MockScenario = 'normal_week' | 'high_volume' | 'with_issues';

interface MockDataGeneratorOptions {
  scenario: MockScenario;
  recordCount?: number;
  startDate?: Date;
  endDate?: Date;
}

export class MockDataGenerator {
  public scenario: MockScenario;
  public recordCount: number;
  private startDate: Date;
  private endDate: Date;

  constructor(options: MockDataGeneratorOptions) {
    this.scenario = options.scenario || 'normal_week';
    this.recordCount = options.recordCount || 75; // Default 50-100 records
    this.startDate = options.startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
    this.endDate = options.endDate || new Date();
  }

  /**
   * Generate Financial Events (GET_LEDGER_DETAIL_VIEW_DATA)
   * Returns SP-API format: { payload: { FinancialEvents: { AdjustmentEventList, FBALiquidationEventList, ServiceFeeEventList, OrderEventList } } }
   */
  generateFinancialEvents(): any {
    const events = {
      AdjustmentEventList: [] as any[],
      FBALiquidationEventList: [] as any[],
      ServiceFeeEventList: [] as any[],
      OrderEventList: [] as any[]
    };

    const daysDiff = Math.ceil((this.endDate.getTime() - this.startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // Determine event distribution based on scenario
    let adjustmentCount = 0;
    let liquidationCount = 0;
    let feeCount = 0;
    let orderCount = 0;

    switch (this.scenario) {
      case 'normal_week':
        adjustmentCount = Math.floor(this.recordCount * 0.3); // 30% adjustments
        liquidationCount = Math.floor(this.recordCount * 0.2); // 20% liquidations
        feeCount = Math.floor(this.recordCount * 0.3); // 30% fees
        orderCount = Math.floor(this.recordCount * 0.2); // 20% orders
        break;
      case 'high_volume':
        adjustmentCount = Math.floor(this.recordCount * 0.25);
        liquidationCount = Math.floor(this.recordCount * 0.15);
        feeCount = Math.floor(this.recordCount * 0.35);
        orderCount = Math.floor(this.recordCount * 0.25);
        break;
      case 'with_issues':
        adjustmentCount = Math.floor(this.recordCount * 0.4); // More adjustments (issues)
        liquidationCount = Math.floor(this.recordCount * 0.3); // More liquidations
        feeCount = Math.floor(this.recordCount * 0.2);
        orderCount = Math.floor(this.recordCount * 0.1);
        break;
    }

    // Generate Adjustment Events (reimbursements, reversals, etc.)
    for (let i = 0; i < adjustmentCount; i++) {
      const date = this.randomDate(this.startDate, this.endDate);
      const amount = this.scenario === 'with_issues' 
        ? this.randomAmount(10, 500) // Higher amounts for issues
        : this.randomAmount(5, 200);
      
      events.AdjustmentEventList.push({
        AdjustmentEventId: `ADJ-${Date.now()}-${i}`,
        AdjustmentType: this.randomAdjustmentType(),
        AdjustmentAmount: {
          CurrencyAmount: this.scenario === 'with_issues' && Math.random() > 0.5
            ? -Math.abs(amount) // Negative for reversals
            : amount,
          CurrencyCode: 'USD'
        },
        PostedDate: date.toISOString(),
        AmazonOrderId: `112-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`,
        SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
        ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        Quantity: Math.floor(Math.random() * 5) + 1,
        Description: this.scenario === 'with_issues' 
          ? 'Inventory adjustment - potential claim opportunity'
          : 'Standard inventory adjustment',
        FulfillmentCenterId: `FBA${Math.floor(Math.random() * 5) + 1}`,
        Marketplace: ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'IT', 'ES'][Math.floor(Math.random() * 8)]
      });
    }

    // Generate FBA Liquidation Events
    for (let i = 0; i < liquidationCount; i++) {
      const date = this.randomDate(this.startDate, this.endDate);
      const amount = this.scenario === 'with_issues'
        ? this.randomAmount(20, 600)
        : this.randomAmount(10, 300);

      events.FBALiquidationEventList.push({
        OriginalRemovalOrderId: `RMO-${Date.now()}-${i}`,
        LiquidationProceedsAmount: {
          CurrencyAmount: amount,
          CurrencyCode: 'USD'
        },
        PostedDate: date.toISOString(),
        RemovalQuantity: Math.floor(Math.random() * 10) + 1,
        SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
        ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`
      });
    }

    // Generate Service Fee Events
    for (let i = 0; i < feeCount; i++) {
      const date = this.randomDate(this.startDate, this.endDate);
      const orderId = `112-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`;
      
      events.ServiceFeeEventList.push({
        AmazonOrderId: orderId,
        SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
        ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        PostedDate: date.toISOString(),
        FeeList: [
          {
            FeeType: ['SERVICE_FEE', 'REFERRAL_FEE', 'FBA_FULFILLMENT_FEE'][Math.floor(Math.random() * 3)],
            FeeAmount: {
              CurrencyAmount: this.randomAmount(1, 50),
              CurrencyCode: 'USD'
            }
          }
        ],
        ...(this.scenario === 'with_issues' && Math.random() > 0.7 ? {
          FeeDescription: 'Potential fee overcharge - review required'
        } : {})
      });
    }

    // Generate Order Events
    for (let i = 0; i < orderCount; i++) {
      const date = this.randomDate(this.startDate, this.endDate);
      const orderId = `112-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`;
      
      events.OrderEventList.push({
        AmazonOrderId: orderId,
        PostedDate: date.toISOString(),
        OrderChargeList: [
          {
            ChargeType: 'Principal',
            ChargeAmount: {
              CurrencyAmount: this.randomAmount(10, 500),
              CurrencyCode: 'USD'
            }
          },
          {
            ChargeType: 'Shipping',
            ChargeAmount: {
              CurrencyAmount: this.randomAmount(5, 25),
              CurrencyCode: 'USD'
            }
          }
        ],
        ...(this.scenario === 'with_issues' && Math.random() > 0.7 ? {
          OrderChargeAdjustmentList: [
            {
              ChargeType: 'Principal',
              ChargeAmount: {
                CurrencyAmount: -this.randomAmount(5, 50), // Negative adjustment
                CurrencyCode: 'USD'
              }
            }
          ]
        } : {})
      });
    }

    logger.info(`Generated ${this.recordCount} financial events for scenario: ${this.scenario}`, {
      adjustments: events.AdjustmentEventList.length,
      liquidations: events.FBALiquidationEventList.length,
      fees: events.ServiceFeeEventList.length,
      orders: events.OrderEventList.length
    });

    return {
      payload: {
        FinancialEvents: events
      }
    };
  }

  /**
   * Generate Inventory Data (GET_FBA_MYI_UNSUPPRESSED_INVENTORY)
   * Returns SP-API format: { payload: { inventorySummaries: [...] } }
   */
  generateInventory(): any {
    const summaries: any[] = [];
    
    // Generate SKUs
    const skuCount = this.scenario === 'high_volume' 
      ? this.recordCount 
      : Math.floor(this.recordCount * 0.8);

    for (let i = 0; i < skuCount; i++) {
      const sku = `SKU-${String(i + 1).padStart(4, '0')}`;
      const asin = `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`;
      const fnSku = `X00${String(Math.floor(Math.random() * 1000000)).padStart(7, '0')}`;

      // Determine quantities based on scenario
      let availableQuantity = 0;
      let reservedQuantity = 0;
      let damagedQuantity = 0;
      let unfulfillableQuantity = 0;

      switch (this.scenario) {
        case 'normal_week':
          availableQuantity = Math.floor(Math.random() * 100);
          reservedQuantity = Math.floor(Math.random() * 20);
          damagedQuantity = Math.floor(Math.random() * 5);
          unfulfillableQuantity = Math.floor(Math.random() * 3);
          break;
        case 'high_volume':
          availableQuantity = Math.floor(Math.random() * 500);
          reservedQuantity = Math.floor(Math.random() * 100);
          damagedQuantity = Math.floor(Math.random() * 10);
          unfulfillableQuantity = Math.floor(Math.random() * 5);
          break;
        case 'with_issues':
          availableQuantity = Math.floor(Math.random() * 50);
          reservedQuantity = Math.floor(Math.random() * 10);
          damagedQuantity = Math.floor(Math.random() * 20); // More damaged items
          unfulfillableQuantity = Math.floor(Math.random() * 15); // More unfulfillable
          break;
      }

      summaries.push({
        sellerSku: sku,
        asin: asin,
        fnSku: fnSku,
        condition: ['New', 'New', 'Used', 'New'][Math.floor(Math.random() * 4)], // Mostly New
        inventoryDetails: {
          availableQuantity: availableQuantity,
          reservedQuantity: reservedQuantity,
          damagedQuantity: damagedQuantity,
          unfulfillableQuantity: unfulfillableQuantity
        },
        lastUpdatedTime: this.randomDate(this.startDate, this.endDate).toISOString(),
        ...(this.scenario === 'with_issues' && Math.random() > 0.7 ? {
          discrepancy: true,
          expectedQuantity: availableQuantity + reservedQuantity + damagedQuantity + unfulfillableQuantity + Math.floor(Math.random() * 10)
        } : {})
      });
    }

    logger.info(`Generated ${summaries.length} inventory summaries for scenario: ${this.scenario}`);

    return {
      payload: {
        inventorySummaries: summaries
      }
    };
  }

  /**
   * Generate Orders Data (GET_ORDERS_DATA)
   * Returns SP-API format: { payload: { Orders: [...] } }
   */
  generateOrders(): any {
    const orders: any[] = [];
    
    const daysDiff = Math.ceil((this.endDate.getTime() - this.startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    for (let i = 0; i < this.recordCount; i++) {
      const purchaseDate = this.randomDate(this.startDate, this.endDate);
      const orderId = `112-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`;
      const itemCount = Math.floor(Math.random() * 5) + 1;
      
      const orderItems: any[] = [];
      let orderTotal = 0;

      // Generate order items
      for (let j = 0; j < itemCount; j++) {
        const itemPrice = this.randomAmount(10, 200);
        orderTotal += itemPrice;
        
        orderItems.push({
          SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
          ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
          QuantityOrdered: Math.floor(Math.random() * 3) + 1,
          ItemPrice: {
            Amount: itemPrice,
            CurrencyCode: 'USD'
          },
          Title: `Product ${j + 1}`
        });
      }

      // Determine order status based on scenario
      let orderStatus = 'Shipped';
      if (this.scenario === 'with_issues') {
        const rand = Math.random();
        if (rand > 0.8) orderStatus = 'Canceled';
        else if (rand > 0.6) orderStatus = 'Pending';
        else if (rand > 0.4) orderStatus = 'Unshipped';
      } else {
        const rand = Math.random();
        if (rand > 0.9) orderStatus = 'Pending';
        else if (rand > 0.8) orderStatus = 'Unshipped';
      }

      const earliestShipDate = new Date(purchaseDate);
      earliestShipDate.setDate(earliestShipDate.getDate() + Math.floor(Math.random() * 3));

      orders.push({
        AmazonOrderId: orderId,
        SellerId: 'A1EXAMPLE',
        MarketplaceId: ['ATVPDKIKX0DER', 'A1PA6795UKMFR9', 'A13V1IB3VIYZZH'][Math.floor(Math.random() * 3)], // US, DE, FR
        PurchaseDate: purchaseDate.toISOString(),
        OrderStatus: orderStatus,
        FulfillmentChannel: Math.random() > 0.2 ? 'FBA' : 'MFN', // 80% FBA
        OrderType: ['StandardOrder', 'Preorder'][Math.floor(Math.random() * 2)],
        SalesChannel: 'Amazon.com',
        EarliestShipDate: earliestShipDate.toISOString(),
        LatestShipDate: new Date(earliestShipDate.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        OrderTotal: {
          Amount: orderTotal.toFixed(2),
          CurrencyCode: 'USD'
        },
        NumberOfItemsShipped: orderStatus === 'Shipped' ? itemCount : 0,
        NumberOfItemsUnshipped: orderStatus === 'Unshipped' ? itemCount : 0,
        IsPrime: Math.random() > 0.5,
        IsBusinessOrder: Math.random() > 0.8,
        OrderItems: orderItems,
        ...(this.scenario === 'with_issues' && Math.random() > 0.7 ? {
          IsReplacementOrder: true,
          ReplacedOrderId: `112-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`
        } : {})
      });
    }

    logger.info(`Generated ${orders.length} orders for scenario: ${this.scenario}`);

    return {
      payload: {
        Orders: orders
      }
    };
  }

  // Helper methods
  private randomDate(start: Date, end: Date): Date {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  }

  private randomAmount(min: number, max: number): number {
    return Math.round((Math.random() * (max - min) + min) * 100) / 100;
  }

  private randomAdjustmentType(): string {
    const types = [
      'REVERSAL_REIMBURSEMENT',
      'REVERSAL_CHARGE',
      'CHARGEBACK_REVERSAL',
      'OTHER_ADJUSTMENT',
      'SHIPPING_CHARGEBACK',
      'RESERVE_DEBIT'
    ];
    return types[Math.floor(Math.random() * types.length)];
  }
}

/**
 * Factory function to create generator with scenario
 */
export function createMockDataGenerator(scenario: MockScenario = 'normal_week', recordCount?: number): MockDataGenerator {
  return new MockDataGenerator({
    scenario,
    recordCount: recordCount || (scenario === 'high_volume' ? 100 : 75)
  });
}

/**
 * Singleton instance for easy access
 */
let generatorInstance: MockDataGenerator | null = null;

export function getMockDataGenerator(scenario?: MockScenario): MockDataGenerator {
  const scenarioToUse = scenario || (process.env.MOCK_SCENARIO as MockScenario) || 'normal_week';
  const recordCount = process.env.MOCK_RECORD_COUNT ? parseInt(process.env.MOCK_RECORD_COUNT, 10) : undefined;
  
  if (!generatorInstance || generatorInstance.scenario !== scenarioToUse) {
    generatorInstance = createMockDataGenerator(scenarioToUse, recordCount);
  }
  
  return generatorInstance;
}

