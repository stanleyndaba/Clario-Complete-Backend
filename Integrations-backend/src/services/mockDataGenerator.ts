/**
 * Mock Data Generator for Amazon SP-API
 * Generates realistic SP-API responses programmatically for testing
 * Supports 4 test scenarios: normal_week, high_volume, with_issues, realistic
 */

import logger from '../utils/logger';

export type MockScenario = 'normal_week' | 'high_volume' | 'with_issues' | 'realistic';

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
      case 'realistic':
        // 15% global anomaly rate target
        adjustmentCount = Math.floor(this.recordCount * 0.15);
        liquidationCount = Math.floor(this.recordCount * 0.10);
        feeCount = Math.floor(this.recordCount * 0.40);
        orderCount = Math.floor(this.recordCount * 0.35);
        break;
    }

    // Generate Adjustment Events (reimbursements, reversals, etc.)
    for (let i = 0; i < adjustmentCount; i++) {
      const date = this.randomDate(this.startDate, this.endDate);
      const amount = this.scenario === 'with_issues'
        ? this.randomAmount(10, 500) // Higher amounts for issues
        : this.randomAmount(5, 200);

      // Realistic scenario: Add subtle anomalies
      let description = 'Standard inventory adjustment';
      let adjustmentType = this.randomAdjustmentType();

      if (this.scenario === 'realistic') {
        const rand = Math.random();
        if (rand < 0.05) {
          // 5% chance of late reimbursement (simulated by date manipulation in post-processing or here if we tracked state)
          description = 'Late inventory reimbursement';
        } else if (rand < 0.10) {
          // 5% chance of partial reimbursement logic (handled in amount)
          // We'll simulate this by creating a mismatch in the order generation side or here
        }
      } else if (this.scenario === 'with_issues') {
        description = 'Inventory adjustment - potential claim opportunity';
      }

      events.AdjustmentEventList.push({
        AdjustmentEventId: `ADJ-${Date.now()}-${i}`,
        AdjustmentType: adjustmentType,
        AdjustmentAmount: {
          CurrencyAmount: (this.scenario === 'with_issues' || (this.scenario === 'realistic' && Math.random() > 0.8)) && Math.random() > 0.5
            ? -Math.abs(amount) // Negative for reversals
            : amount,
          CurrencyCode: 'USD'
        },
        PostedDate: date.toISOString(),
        AmazonOrderId: `112-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`,
        SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
        ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        Quantity: Math.floor(Math.random() * 5) + 1,
        Description: description,
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

      // Realistic: Commission rounding errors or storage fee mismatches
      let feeAmount = this.randomAmount(1, 50);
      let feeDescription = '';

      if (this.scenario === 'realistic' && Math.random() < 0.05) {
        // 5% chance of commission rounding error (e.g. $10.00 item, 15% fee should be $1.50, but charged $1.53)
        feeAmount += (Math.random() * 0.04 + 0.01); // Add $0.01 - $0.05
        feeDescription = 'Commission fee';
      }

      events.ServiceFeeEventList.push({
        AmazonOrderId: orderId,
        SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
        ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        PostedDate: date.toISOString(),
        FeeList: [
          {
            FeeType: ['SERVICE_FEE', 'REFERRAL_FEE', 'FBA_FULFILLMENT_FEE'][Math.floor(Math.random() * 3)],
            FeeAmount: {
              CurrencyAmount: feeAmount,
              CurrencyCode: 'USD'
            }
          }
        ],
        ...((this.scenario === 'with_issues' && Math.random() > 0.7) || (this.scenario === 'realistic' && feeDescription) ? {
          FeeDescription: feeDescription || 'Potential fee overcharge - review required'
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
        ...((this.scenario === 'with_issues' && Math.random() > 0.7) ? {
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
        case 'realistic':
          availableQuantity = Math.floor(Math.random() * 80);
          reservedQuantity = Math.floor(Math.random() * 15);
          // Realistic: Small missing quantities (1 unit) mixed with later restock events
          damagedQuantity = Math.random() < 0.10 ? Math.floor(Math.random() * 3) + 1 : 0; // 10% chance of damage
          unfulfillableQuantity = Math.random() < 0.05 ? Math.floor(Math.random() * 2) + 1 : 0; // 5% chance of unfulfillable
          break;
      }

      // Realistic: Create "hard-to-decide" records by masking fields
      let fulfillmentCenterId = `FBA${Math.floor(Math.random() * 5) + 1}`;
      if (this.scenario === 'realistic' && Math.random() < 0.08) {
        // 8% chance to mask fulfillment center (simulates missing data)
        fulfillmentCenterId = '';
      }

      // Add weight and dimensions for fee validation (NEW for claim detection)
      const actualWeight = parseFloat((Math.random() * 10 + 0.5).toFixed(2)); // 0.5-10.5 lbs
      const actualLength = parseFloat((Math.random() * 20 + 2).toFixed(1)); // 2-22 inches
      const actualWidth = parseFloat((Math.random() * 15 + 1).toFixed(1)); // 1-16 inches  
      const actualHeight = parseFloat((Math.random() * 12 + 1).toFixed(1)); // 1-13 inches

      // Amazon's measured values (sometimes wrong - fee overcharge opportunity)
      let amazonWeight = actualWeight;
      let amazonLength = actualLength;
      let amazonWidth = actualWidth;
      let amazonHeight = actualHeight;

      // 8% chance of measurement discrepancy (fee overcharge)
      if (Math.random() < 0.08) {
        const discrepancyFactor = 1.1 + Math.random() * 0.3; // 10-40% higher
        amazonWeight = parseFloat((actualWeight * discrepancyFactor).toFixed(2));
        amazonLength = parseFloat((actualLength * discrepancyFactor).toFixed(1));
        amazonWidth = parseFloat((actualWidth * discrepancyFactor).toFixed(1));
        amazonHeight = parseFloat((actualHeight * discrepancyFactor).toFixed(1));
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
        // Weight and dimensions (NEW for fee overcharge detection)
        productDimensions: {
          weight: { value: actualWeight, unit: 'pounds' },
          length: { value: actualLength, unit: 'inches' },
          width: { value: actualWidth, unit: 'inches' },
          height: { value: actualHeight, unit: 'inches' }
        },
        amazonMeasurements: {
          weight: { value: amazonWeight, unit: 'pounds' },
          length: { value: amazonLength, unit: 'inches' },
          width: { value: amazonWidth, unit: 'inches' },
          height: { value: amazonHeight, unit: 'inches' }
        },
        hasMeasurementDiscrepancy: amazonWeight !== actualWeight,
        lastUpdatedTime: this.randomDate(this.startDate, this.endDate).toISOString(),
        // Add discrepancy flag for internal tracking/testing
        ...((this.scenario === 'with_issues' && Math.random() > 0.7) || (this.scenario === 'realistic' && Math.random() < 0.03) ? {
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

    for (let i = 0; i < this.recordCount; i++) {
      const purchaseDate = this.randomDate(this.startDate, this.endDate);
      let orderId = `112-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`;

      // Realistic: Introduce noise in order_id formatting for 1-2%
      if (this.scenario === 'realistic' && Math.random() < 0.015) {
        orderId = orderId.replace(/-/g, ''); // Remove dashes
      }

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
      } else if (this.scenario === 'realistic') {
        const rand = Math.random();
        if (rand > 0.95) orderStatus = 'Pending';
        else if (rand > 0.92) orderStatus = 'Unshipped';
        else if (rand > 0.88) orderStatus = 'Canceled';
      } else {
        const rand = Math.random();
        if (rand > 0.9) orderStatus = 'Pending';
        else if (rand > 0.8) orderStatus = 'Unshipped';
      }

      const earliestShipDate = new Date(purchaseDate);
      earliestShipDate.setDate(earliestShipDate.getDate() + Math.floor(Math.random() * 3));

      // Realistic: Mask optional fields
      const maskField = this.scenario === 'realistic' && Math.random() < 0.08;

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
        ...(maskField ? {} : {
          // Optional fields that might be masked
          FulfillmentSupplySourceId: `fs-${Math.random().toString(36).substring(7)}`
        }),
        ...((this.scenario === 'with_issues' && Math.random() > 0.7) ? {
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

  /**
   * Generate Shipments Data
   * Returns: { payload: { shipments: [...] } }
   */
  generateShipments(orders: any[]): any {
    const shipments: any[] = [];

    for (const order of orders) {
      if (order.OrderStatus === 'Shipped') {
        const shipmentId = `SH-${order.AmazonOrderId.replace('112-', '')}`;
        const shippedDate = order.EarliestShipDate;

        // Realistic: Create missing quantity issues
        let missingQuantity = 0;
        if (this.scenario === 'realistic' && Math.random() < 0.03) {
          // 3% chance of missing quantity
          missingQuantity = 1;
        } else if (this.scenario === 'with_issues' && Math.random() < 0.1) {
          missingQuantity = Math.floor(Math.random() * 2) + 1;
        }

        shipments.push({
          shipment_id: shipmentId,
          order_id: order.AmazonOrderId,
          fulfillment_center: `FBA${Math.floor(Math.random() * 5) + 1}`,
          status: 'SHIPPED',
          shipped_date: shippedDate,
          shipping_cost: parseFloat((Math.random() * 10 + 5).toFixed(2)),
          currency: 'USD',
          items: order.OrderItems.map((item: any) => ({
            sku: item.SellerSKU,
            quantity: item.QuantityOrdered,
            price: item.ItemPrice.Amount
          })),
          missing_quantity: missingQuantity,
          expected_quantity: order.OrderItems.reduce((sum: number, item: any) => sum + item.QuantityOrdered, 0)
        });
      }
    }

    logger.info(`Generated ${shipments.length} shipments for scenario: ${this.scenario}`);
    return { payload: { shipments } };
  }

  /**
   * Generate Returns Data
   * Returns: { payload: { returns: [...] } }
   */
  generateReturns(orders: any[]): any {
    const returns: any[] = [];

    // INCREASED return rate: 15% normal, 25% with_issues/realistic for more claim opportunities
    const returnRate = (this.scenario === 'with_issues' || this.scenario === 'realistic') ? 0.25 : 0.15;

    for (const order of orders) {
      if (order.OrderStatus === 'Shipped' && Math.random() < returnRate) {
        const returnId = `RET-${order.AmazonOrderId.replace('112-', '')}`;
        const returnDate = new Date(new Date(order.PurchaseDate).getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000); // 0-30 days after purchase

        // Realistic: Refund amount mismatch
        let refundAmount = parseFloat(order.OrderTotal.Amount);
        if (this.scenario === 'realistic' && Math.random() < 0.05) {
          // 5% chance of partial refund (60-90% of value)
          refundAmount = parseFloat((refundAmount * (0.6 + Math.random() * 0.3)).toFixed(2));
        }

        // NEW: Return status variations for claim detection
        let returnStatus = 'COMPLETED';
        let returnReceived = true;
        let refundIssued = true;

        // 10% chance: Customer refunded but item NOT returned to inventory (CLAIM OPPORTUNITY)
        if (Math.random() < 0.10) {
          returnReceived = false;
          returnStatus = 'REFUND_ISSUED_NO_RETURN';
        }
        // 5% chance: Return received but no credit issued (needs investigation)
        else if (Math.random() < 0.05) {
          refundIssued = false;
          returnStatus = 'RETURN_RECEIVED_NO_CREDIT';
        }

        returns.push({
          return_id: returnId,
          order_id: order.AmazonOrderId,
          status: returnStatus,
          returned_date: returnDate.toISOString(),
          refund_amount: refundAmount,
          currency: 'USD',
          reason: ['Customer Return', 'Damaged', 'Defective', 'Wrong Item', 'Not As Described'][Math.floor(Math.random() * 5)],
          returnReceived: returnReceived,
          refundIssued: refundIssued,
          isClaimOpportunity: !returnReceived && refundIssued, // Customer got money, item not returned
          items: order.OrderItems.map((item: any) => ({
            sku: item.SellerSKU,
            quantity: item.QuantityOrdered,
            refund_amount: item.ItemPrice.Amount
          }))
        });
      }
    }

    logger.info(`Generated ${returns.length} returns for scenario: ${this.scenario}`);
    return { payload: { returns } };
  }

  /**
   * Generate Settlements Data
   * Returns: { payload: { settlements: [...] } }
   */
  generateSettlements(): any {
    const settlements: any[] = [];
    const count = Math.floor(this.recordCount * 0.5); // Fewer settlements than orders

    for (let i = 0; i < count; i++) {
      const date = this.randomDate(this.startDate, this.endDate);
      const amount = this.randomAmount(100, 5000);

      // Realistic: Fee discrepancies
      let fees = amount * 0.15; // 15% base
      if (this.scenario === 'realistic' && Math.random() < 0.05) {
        // 5% chance of fee overcharge (18-25%)
        fees = amount * (0.18 + Math.random() * 0.07);
      }

      settlements.push({
        settlement_id: `SET-${Date.now()}-${i}`,
        settlement_date: date.toISOString(),
        amount: parseFloat(amount.toFixed(2)),
        fees: parseFloat(fees.toFixed(2)),
        currency: 'USD',
        transaction_type: 'Order',
        status: 'COMPLETED'
      });
    }

    logger.info(`Generated ${settlements.length} settlements for scenario: ${this.scenario}`);
    return { payload: { settlements } };
  }

  /**
   * Generate Inbound Shipments Data (NEW - for lost/damaged in transit claims)
   * Returns: { payload: { inboundShipments: [...] } }
   */
  generateInboundShipments(): any {
    const inboundShipments: any[] = [];

    // Generate 40-60 inbound shipments based on scenario
    const shipmentCount = this.scenario === 'high_volume'
      ? Math.floor(this.recordCount * 0.8)  // 60 for high volume
      : Math.floor(this.recordCount * 0.6); // 45 for normal

    for (let i = 0; i < shipmentCount; i++) {
      const shipmentId = `FBA${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`;
      const createdDate = this.randomDate(this.startDate, this.endDate);
      const receivedDate = new Date(createdDate.getTime() + Math.random() * 14 * 24 * 60 * 60 * 1000); // 0-14 days transit

      // Units shipped
      const unitsShipped = Math.floor(Math.random() * 100) + 10; // 10-110 units

      // Calculate units received with discrepancy logic
      let unitsReceived = unitsShipped;
      let lostInTransit = 0;
      let damagedOnReceipt = 0;
      let status = 'RECEIVED';

      // 10% chance: Lost in transit discrepancy (CLAIM OPPORTUNITY)
      if (Math.random() < 0.10) {
        lostInTransit = Math.floor(Math.random() * 5) + 1; // 1-5 units lost
        unitsReceived = unitsShipped - lostInTransit;
        status = 'RECEIVING_DISCREPANCY';
      }
      // 8% chance: Damaged on receipt (CLAIM OPPORTUNITY)
      else if (Math.random() < 0.08) {
        damagedOnReceipt = Math.floor(Math.random() * 3) + 1; // 1-3 units damaged
        status = 'DAMAGED_ON_RECEIPT';
      }
      // 5% chance: Still in transit (pending)
      else if (Math.random() < 0.05) {
        unitsReceived = 0;
        status = 'IN_TRANSIT';
      }

      // Calculate potential reimbursement value
      const unitValue = this.randomAmount(10, 100);
      const potentialClaimValue = (lostInTransit + damagedOnReceipt) * unitValue;

      inboundShipments.push({
        shipment_id: shipmentId,
        shipment_name: `Shipment-${i + 1}`,
        destination_fulfillment_center: `FBA${Math.floor(Math.random() * 5) + 1}`,
        status: status,
        created_date: createdDate.toISOString(),
        received_date: status !== 'IN_TRANSIT' ? receivedDate.toISOString() : null,
        units_shipped: unitsShipped,
        units_received: unitsReceived,
        lost_in_transit: lostInTransit,
        damaged_on_receipt: damagedOnReceipt,
        unit_value: unitValue,
        potential_claim_value: potentialClaimValue,
        is_claim_opportunity: lostInTransit > 0 || damagedOnReceipt > 0,
        carrier: ['UPS', 'FedEx', 'USPS', 'Amazon Partnered'][Math.floor(Math.random() * 4)],
        tracking_number: `TRK${String(Math.floor(Math.random() * 100000000)).padStart(12, '0')}`
      });
    }

    logger.info(`Generated ${inboundShipments.length} inbound shipments for scenario: ${this.scenario}`);
    return { payload: { inboundShipments } };
  }

  /**
   * Generate Inventory Adjustments Data (NEW - for lost/damaged in warehouse claims)
   * Returns: { payload: { inventoryAdjustments: [...] } }
   */
  generateInventoryAdjustments(): any {
    const adjustments: any[] = [];

    // Generate 30-50 inventory adjustments
    const adjustmentCount = this.scenario === 'with_issues'
      ? Math.floor(this.recordCount * 0.7)  // More for issues scenario
      : Math.floor(this.recordCount * 0.4); // Normal

    const adjustmentReasons = [
      { reason: 'WAREHOUSE_DAMAGE', isClaimable: true, frequency: 0.25 },
      { reason: 'LOST_WAREHOUSE', isClaimable: true, frequency: 0.20 },
      { reason: 'FOUND_INVENTORY', isClaimable: false, frequency: 0.10 },
      { reason: 'EXPIRED', isClaimable: false, frequency: 0.15 },
      { reason: 'TRANSFER_LOSS', isClaimable: true, frequency: 0.15 },
      { reason: 'CUSTOMER_DAMAGE', isClaimable: false, frequency: 0.10 },
      { reason: 'DISPOSED', isClaimable: true, frequency: 0.05 }
    ];

    for (let i = 0; i < adjustmentCount; i++) {
      const adjustmentId = `ADJ-${Date.now()}-${i}`;
      const adjustmentDate = this.randomDate(this.startDate, this.endDate);
      const sku = `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`;

      // Select reason based on weighted frequency
      const rand = Math.random();
      let cumulativeFreq = 0;
      let selectedReason = adjustmentReasons[0];
      for (const reason of adjustmentReasons) {
        cumulativeFreq += reason.frequency;
        if (rand < cumulativeFreq) {
          selectedReason = reason;
          break;
        }
      }

      const quantityAdjusted = selectedReason.reason === 'FOUND_INVENTORY'
        ? Math.floor(Math.random() * 5) + 1  // Positive adjustment
        : -(Math.floor(Math.random() * 10) + 1); // Negative adjustment (lost/damaged)

      const unitValue = this.randomAmount(15, 150);
      const claimValue = selectedReason.isClaimable ? Math.abs(quantityAdjusted) * unitValue : 0;

      // Check if already reimbursed (some should be, some shouldn't)
      const wasReimbursed = selectedReason.isClaimable ? Math.random() < 0.3 : false; // 30% already reimbursed

      adjustments.push({
        adjustment_id: adjustmentId,
        seller_sku: sku,
        asin: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        fulfillment_center: `FBA${Math.floor(Math.random() * 5) + 1}`,
        adjustment_date: adjustmentDate.toISOString(),
        reason: selectedReason.reason,
        quantity_adjusted: quantityAdjusted,
        unit_value: unitValue,
        total_value: Math.abs(quantityAdjusted) * unitValue,
        is_claimable: selectedReason.isClaimable,
        was_reimbursed: wasReimbursed,
        is_claim_opportunity: selectedReason.isClaimable && !wasReimbursed, // Claimable but NOT yet reimbursed
        potential_claim_value: selectedReason.isClaimable && !wasReimbursed ? claimValue : 0
      });
    }

    logger.info(`Generated ${adjustments.length} inventory adjustments for scenario: ${this.scenario}`);
    return { payload: { inventoryAdjustments: adjustments } };
  }

  /**
   * Generate Removal Orders Data (NEW - for lost during removal claims)
   * Returns: { payload: { removalOrders: [...] } }
   */
  generateRemovalOrders(): any {
    const removalOrders: any[] = [];

    // Generate 15-25 removal orders
    const orderCount = this.scenario === 'with_issues'
      ? Math.floor(this.recordCount * 0.35)
      : Math.floor(this.recordCount * 0.2);

    for (let i = 0; i < orderCount; i++) {
      const removalOrderId = `RMO-${Date.now()}-${i}`;
      const createdDate = this.randomDate(this.startDate, this.endDate);
      const completedDate = new Date(createdDate.getTime() + Math.random() * 21 * 24 * 60 * 60 * 1000); // 0-21 days
      const sku = `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`;

      const requestedQuantity = Math.floor(Math.random() * 50) + 5; // 5-55 units
      let returnedQuantity = requestedQuantity;
      let disposedQuantity = 0;
      let lostQuantity = 0;
      let status = 'COMPLETED';

      // Determine removal type
      const isReturn = Math.random() > 0.3; // 70% return, 30% disposal

      if (isReturn) {
        // 12% chance: Units lost during return (CLAIM OPPORTUNITY)
        if (Math.random() < 0.12) {
          lostQuantity = Math.floor(Math.random() * 5) + 1;
          returnedQuantity = requestedQuantity - lostQuantity;
          status = 'COMPLETED_WITH_DISCREPANCY';
        }
      } else {
        disposedQuantity = requestedQuantity;
        returnedQuantity = 0;
        // 8% chance: Disposal fee discrepancy
        if (Math.random() < 0.08) {
          status = 'DISPOSAL_FEE_ERROR';
        }
      }

      const unitValue = this.randomAmount(10, 80);
      const potentialClaimValue = lostQuantity * unitValue;

      removalOrders.push({
        removal_order_id: removalOrderId,
        seller_sku: sku,
        asin: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        order_type: isReturn ? 'RETURN' : 'DISPOSAL',
        status: status,
        created_date: createdDate.toISOString(),
        completed_date: completedDate.toISOString(),
        requested_quantity: requestedQuantity,
        returned_quantity: returnedQuantity,
        disposed_quantity: disposedQuantity,
        lost_quantity: lostQuantity,
        unit_value: unitValue,
        disposal_fee: isReturn ? 0 : parseFloat((requestedQuantity * 0.15).toFixed(2)), // $0.15/unit disposal fee
        is_claim_opportunity: lostQuantity > 0 || status === 'DISPOSAL_FEE_ERROR',
        potential_claim_value: potentialClaimValue
      });
    }

    logger.info(`Generated ${removalOrders.length} removal orders for scenario: ${this.scenario}`);
    return { payload: { removalOrders } };
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
