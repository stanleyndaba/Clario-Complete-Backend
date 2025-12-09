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
   * Generate Inbound Shipments Data (COMMERCIAL DEMO - Big Ticket Claims)
   * Creates 50 shipments with 10% having major discrepancies ($400-500 each)
   * Target: 5 shipments × $400 avg = $2,000 in detectable claims
   */
  generateInboundShipments(): any {
    const inboundShipments: any[] = [];

    // COMMERCIAL DEMO: Generate exactly 50 inbound shipments
    const shipmentCount = 50;

    // Track which shipments will have the "big ticket" 10-unit discrepancy
    // 10% (5 shipments) will have major discrepancies
    const majorDiscrepancyIndices = new Set<number>();
    while (majorDiscrepancyIndices.size < 5) {
      majorDiscrepancyIndices.add(Math.floor(Math.random() * shipmentCount));
    }

    for (let i = 0; i < shipmentCount; i++) {
      const shipmentId = `FBA${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`;
      const createdDate = this.randomDate(this.startDate, this.endDate);
      const receivedDate = new Date(createdDate.getTime() + Math.random() * 14 * 24 * 60 * 60 * 1000);

      // COMMERCIAL DEMO: High-value unit prices ($40-60)
      const unitValue = this.randomAmount(40, 60);

      // Standard shipment with 100 units
      let unitsShipped = 100;
      let unitsReceived = 100;
      let lostInTransit = 0;
      let damagedOnReceipt = 0;
      let status = 'RECEIVED';

      // THE BIG TICKET: 5 shipments (10%) with EXACTLY 10-unit discrepancy
      // "Amazon lost 10 units on the dock. That is $500 pure loss."
      if (majorDiscrepancyIndices.has(i)) {
        unitsShipped = 100;
        unitsReceived = 90;
        lostInTransit = 10; // Exactly 10 units lost
        status = 'RECEIVING_DISCREPANCY';
      }
      // Minor discrepancy (5%) - 1-3 units damaged
      else if (Math.random() < 0.05) {
        damagedOnReceipt = Math.floor(Math.random() * 3) + 1;
        status = 'DAMAGED_ON_RECEIPT';
      }

      // Calculate potential reimbursement value
      // For big ticket: 10 units × $50 avg = $500
      const potentialClaimValue = (lostInTransit + damagedOnReceipt) * unitValue;

      inboundShipments.push({
        shipment_id: shipmentId,
        shipment_name: `Inbound-${String(i + 1).padStart(3, '0')}`,
        destination_fulfillment_center: `FBA${Math.floor(Math.random() * 5) + 1}`,
        status: status,
        created_date: createdDate.toISOString(),
        received_date: receivedDate.toISOString(),
        units_shipped: unitsShipped,
        units_received: unitsReceived,
        lost_in_transit: lostInTransit,
        damaged_on_receipt: damagedOnReceipt,
        unit_value: unitValue,
        potential_claim_value: potentialClaimValue,
        is_claim_opportunity: lostInTransit > 0 || damagedOnReceipt > 0,
        carrier: ['UPS', 'FedEx', 'USPS', 'Amazon Partnered'][Math.floor(Math.random() * 4)],
        tracking_number: `TRK${String(Math.floor(Math.random() * 100000000)).padStart(12, '0')}`,
        bill_of_lading: lostInTransit > 0 ? `BOL-${shipmentId}` : null // Evidence reference
      });
    }

    logger.info(`Generated ${inboundShipments.length} inbound shipments for commercial demo`, {
      totalShipments: inboundShipments.length,
      majorDiscrepancies: 5,
      estimatedClaimValue: '$2,000-$2,500'
    });
    return { payload: { inboundShipments } };
  }

  /**
   * Generate Inventory Adjustments Data (COMMERCIAL DEMO - Ghost Inventory)
   * Creates 200 adjustment events with Amazon codes M (Missing) and E (Damaged)
   * Key: NO corresponding reimbursement or "Found" event within 45 days
   * Target: 15 claimable units × $50 = $750 in detectable claims
   */
  generateInventoryAdjustments(): any {
    const adjustments: any[] = [];

    // COMMERCIAL DEMO: Generate exactly 200 inventory adjustment events
    const adjustmentCount = 200;

    // Amazon adjustment reason codes (real codes used in FBA)
    const adjustmentReasons = [
      { code: 'M', reason: 'MISSING_FROM_INBOUND', description: 'Inventory missing - never checked in', isClaimable: true },
      { code: 'E', reason: 'DAMAGED_WAREHOUSE', description: 'Damaged by Amazon in warehouse', isClaimable: true },
      { code: 'D', reason: 'DAMAGED_DISTRIBUTOR', description: 'Damaged defective from distributor', isClaimable: false },
      { code: 'F', reason: 'FOUND', description: 'Found - inventory recovered', isClaimable: false },
      { code: 'Q', reason: 'TRANSFERRED', description: 'Transferred to another FC', isClaimable: false },
      { code: 'U', reason: 'UNRECOVERABLE', description: 'Unrecoverable - customer damage', isClaimable: false }
    ];

    // Generate adjustments with strategic distribution
    // 40% Code M (Missing) - HIGH VALUE CLAIMS
    // 20% Code E (Damaged) - HIGH VALUE CLAIMS  
    // 10% Code F (Found) - offsetting events (no claim)
    // 30% Other codes - noise

    for (let i = 0; i < adjustmentCount; i++) {
      const adjustmentId = `ADJ-${Date.now()}-${String(i).padStart(4, '0')}`;
      const adjustmentDate = this.randomDate(this.startDate, this.endDate);
      const sku = `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`;

      // Strategic distribution of reason codes
      let selectedReason: typeof adjustmentReasons[0];
      const rand = Math.random();
      if (rand < 0.40) {
        selectedReason = adjustmentReasons[0]; // Code M - MISSING (40%)
      } else if (rand < 0.60) {
        selectedReason = adjustmentReasons[1]; // Code E - DAMAGED (20%)
      } else if (rand < 0.70) {
        selectedReason = adjustmentReasons[3]; // Code F - FOUND (10%)
      } else {
        // Random from remaining codes (30%)
        selectedReason = adjustmentReasons[Math.floor(Math.random() * adjustmentReasons.length)];
      }

      // Quantity: 1-3 units per adjustment (realistic)
      const quantityAdjusted = selectedReason.code === 'F'
        ? Math.floor(Math.random() * 3) + 1  // Positive (found)
        : -(Math.floor(Math.random() * 3) + 1); // Negative (lost/damaged)

      // COMMERCIAL DEMO: High-value units ($40-60)
      const unitValue = this.randomAmount(40, 60);

      // THE KEY: Was this already reimbursed?
      // For Code M and E: Only 20% have been reimbursed (80% are claim opportunities!)
      // "Amazon broke it or lost it, and hoped you wouldn't notice."
      const wasReimbursed = selectedReason.isClaimable
        ? Math.random() < 0.20  // Only 20% reimbursed
        : false;

      // Check for corresponding "Found" event (breaks the claim)
      // Only 15% of missing items were later found
      const hasCorrespondingFound = selectedReason.code === 'M' && Math.random() < 0.15;

      // Calculate claim opportunity
      const isClaimOpportunity = selectedReason.isClaimable && !wasReimbursed && !hasCorrespondingFound;
      const claimValue = isClaimOpportunity ? Math.abs(quantityAdjusted) * unitValue : 0;

      adjustments.push({
        adjustment_id: adjustmentId,
        transaction_item_id: `TXN-${adjustmentId}`,
        seller_sku: sku,
        fnsku: `X00${String(Math.floor(Math.random() * 1000000)).padStart(7, '0')}`,
        asin: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        fulfillment_center: `FBA${Math.floor(Math.random() * 5) + 1}`,
        adjustment_date: adjustmentDate.toISOString(),
        reason_code: selectedReason.code,
        reason: selectedReason.reason,
        reason_description: selectedReason.description,
        quantity_adjusted: quantityAdjusted,
        unit_value: unitValue,
        total_value: Math.abs(quantityAdjusted) * unitValue,
        is_claimable: selectedReason.isClaimable,
        was_reimbursed: wasReimbursed,
        has_corresponding_found: hasCorrespondingFound,
        days_since_adjustment: Math.floor((Date.now() - adjustmentDate.getTime()) / (24 * 60 * 60 * 1000)),
        is_claim_opportunity: isClaimOpportunity,
        potential_claim_value: claimValue
      });
    }

    // Calculate statistics for logging
    const claimOpportunities = adjustments.filter(a => a.is_claim_opportunity);
    const totalClaimValue = claimOpportunities.reduce((sum, a) => sum + a.potential_claim_value, 0);

    logger.info(`Generated ${adjustments.length} inventory adjustments for commercial demo`, {
      totalAdjustments: adjustments.length,
      codeMCount: adjustments.filter(a => a.reason_code === 'M').length,
      codeECount: adjustments.filter(a => a.reason_code === 'E').length,
      claimOpportunities: claimOpportunities.length,
      estimatedClaimValue: `$${totalClaimValue.toFixed(2)}`
    });
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

  /**
   * Generate Fee Overcharges Data (COMMERCIAL DEMO - The Silent Killer)
   * Creates 1000 order fee records with 10% having wrong size tier billing
   * "They scanned your item wrong. You are overpaying $0.50 on every single sale."
   * Target: 100 overcharged orders × $0.50 = $50 per sale = $500 total
   */
  generateFeeOvercharges(): any {
    const feeRecords: any[] = [];

    // COMMERCIAL DEMO: 1000 order fee records
    const orderCount = 1000;

    // FBA Size Tiers and their fulfillment fees
    const sizeTiers = [
      { tier: 'Small Standard', weight: '12 oz or less', fee: 3.22 },
      { tier: 'Large Standard', weight: '12+ oz to 1 lb', fee: 3.82 },
      { tier: 'Large Standard', weight: '1+ lb to 2 lb', fee: 4.75 },
      { tier: 'Large Standard', weight: '2+ lb to 3 lb', fee: 5.40 },
      { tier: 'Small Oversize', weight: '0 to 70 lb', fee: 9.73 },
      { tier: 'Medium Oversize', weight: '0 to 150 lb', fee: 19.79 }
    ];

    // Track overcharges for statistics
    let overchargeCount = 0;
    let totalOverchargeAmount = 0;

    for (let i = 0; i < orderCount; i++) {
      const orderId = `112-${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}-${String(Math.floor(Math.random() * 1000000)).padStart(7, '0')}`;
      const orderDate = this.randomDate(this.startDate, this.endDate);
      const sku = `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`;

      // Assign actual size tier (majority should be Small Standard)
      const actualTierIndex = Math.random() < 0.7 ? 0 : Math.floor(Math.random() * 3);
      const actualTier = sizeTiers[actualTierIndex];

      let chargedTier = actualTier;
      let isOvercharge = false;
      let overchargeAmount = 0;

      // THE FLAW: 10% of orders are charged the WRONG (higher) tier
      // "They scanned your item wrong."
      if (Math.random() < 0.10) {
        // Charge the next higher tier
        const overchargeTierIndex = Math.min(actualTierIndex + 1, sizeTiers.length - 1);
        chargedTier = sizeTiers[overchargeTierIndex];

        if (chargedTier.tier !== actualTier.tier) {
          isOvercharge = true;
          overchargeAmount = chargedTier.fee - actualTier.fee;
          overchargeCount++;
          totalOverchargeAmount += overchargeAmount;
        }
      }

      feeRecords.push({
        order_id: orderId,
        seller_sku: sku,
        asin: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        order_date: orderDate.toISOString(),
        // Product actual dimensions
        actual_size_tier: actualTier.tier,
        actual_weight_class: actualTier.weight,
        actual_fulfillment_fee: actualTier.fee,
        // What Amazon charged
        charged_size_tier: chargedTier.tier,
        charged_weight_class: chargedTier.weight,
        charged_fulfillment_fee: chargedTier.fee,
        // Overcharge detection
        is_overcharge: isOvercharge,
        overcharge_amount: overchargeAmount,
        is_claim_opportunity: isOvercharge,
        potential_claim_value: overchargeAmount,
        // Evidence references
        product_dimensions: {
          length: this.randomAmount(5, 18),
          width: this.randomAmount(3, 14),
          height: this.randomAmount(1, 12),
          weight: this.randomAmount(0.1, 3)
        },
        amazon_measured_dimensions: isOvercharge ? {
          length: this.randomAmount(10, 25), // Inflated
          width: this.randomAmount(8, 18),   // Inflated
          height: this.randomAmount(4, 16),  // Inflated
          weight: this.randomAmount(0.5, 5)  // Inflated
        } : null
      });
    }

    logger.info(`Generated ${feeRecords.length} fee records for commercial demo`, {
      totalOrders: feeRecords.length,
      overchargedOrders: overchargeCount,
      totalOverchargeValue: `$${totalOverchargeAmount.toFixed(2)}`,
      averageOvercharge: `$${(totalOverchargeAmount / Math.max(overchargeCount, 1)).toFixed(2)}`
    });

    return { payload: { feeOvercharges: feeRecords } };
  }

  // Helper methods
  private randomDate(start: Date, end: Date): Date {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  }

  private randomAmount(min: number, max: number): number {
    return Math.round((Math.random() * (max - min) + min) * 100) / 100;
  }

  private randomAdjustmentType(): string {
    // ALL 64 Amazon Financial Event codes for comprehensive detection testing
    const types = [
      // Batch 1: Core Reimbursement Events (AdjustmentEvent codes) - 40% weight (most common)
      'Lost:Warehouse', 'Damaged:Warehouse', 'Lost:Inbound', 'Damaged:Inbound',
      'CarrierClaim', 'CustomerReturn', 'FBAInventoryReimbursementReversal',
      'ReimbursementReversal', 'WarehousingError', 'CustomerServiceIssue',
      'GeneralAdjustment', 'FBAInventoryReimbursement',

      // Batch 2: Fee Overcharges (ServiceFeeEvent/ShipmentEvent codes) - 25% weight
      'FBAWeightBasedFee', 'FBAPerUnitFulfillmentFee', 'FBAPerOrderFulfillmentFee',
      'FBATransportationFee', 'FBAInboundDefectFee', 'FBAInboundConvenienceFee',
      'FulfillmentNetworkFee', 'Commission', 'FixedClosingFee', 'VariableClosingFee',

      // Batch 3: Storage & Inventory Fees - 15% weight
      'FBAStorageFee', 'FBALongTermStorageFee', 'FBAInventoryStorageOverageFee',
      'FBAExtraLargeStorageFee', 'FBARemovalFee', 'FBADisposalFee',
      'FBALiquidationFee', 'FBAReturnProcessingFee', 'FBAUnplannedPrepFee',

      // Batch 4: Refunds & Returns - 10% weight
      'RefundEvent', 'RefundCommission', 'RestockingFee',
      'GiftWrapTax', 'ShippingTax', 'Goodwill',
      'RetrochargeEvent', 'HighVolumeListingFee', 'ServiceProviderCreditEvent',

      // Batch 5: Claims & Chargebacks - 5% weight
      'GuaranteeClaimEvent', 'ChargebackEvent', 'SafeTReimbursementEvent',
      'DebtRecoveryEvent', 'LoanServicingEvent', 'PayWithAmazonEvent',
      'RentalTransactionEvent', 'FBALiquidationEvent', 'TaxWithholdingEvent',

      // Batch 6: Advertising & Other - 5% weight
      'ProductAdsPaymentEvent', 'ServiceFeeEvent', 'SellerDealPaymentEvent',
      'CouponPaymentEvent', 'CouponRedemptionFee', 'RunLightningDealFee',
      'VineEnrollmentFee', 'ImagingServicesFeeEvent', 'EarlyReviewerProgramFee',
      'CouponClipFee', 'SellerReviewEnrollmentPaymentEvent',

      // Tax Collection at Source - International (rare but included)
      'TCS-CGST', 'TCS-SGST', 'TCS-IGST'
    ];

    // Weighted selection: Core events are more common
    const rand = Math.random();
    if (rand < 0.40) {
      // 40% Core Reimbursement (indices 0-11)
      return types[Math.floor(Math.random() * 12)];
    } else if (rand < 0.65) {
      // 25% Fee Overcharges (indices 12-21)
      return types[12 + Math.floor(Math.random() * 10)];
    } else if (rand < 0.80) {
      // 15% Storage & Inventory (indices 22-30)
      return types[22 + Math.floor(Math.random() * 9)];
    } else if (rand < 0.90) {
      // 10% Refunds & Returns (indices 31-39)
      return types[31 + Math.floor(Math.random() * 9)];
    } else if (rand < 0.95) {
      // 5% Claims & Chargebacks (indices 40-48)
      return types[40 + Math.floor(Math.random() * 9)];
    } else {
      // 5% Advertising & Other + TCS (indices 49-63)
      return types[49 + Math.floor(Math.random() * types.length - 49)];
    }
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
