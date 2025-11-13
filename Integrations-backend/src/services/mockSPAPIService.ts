/**
 * Mock SP-API Service
 * Reads CSV files and returns data in SP-API format
 * Acts as a drop-in replacement for real Amazon SP-API
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import logger from '../utils/logger';

export interface MockSPAPIParams {
  PostedAfter?: string;
  PostedBefore?: string;
  CreatedAfter?: string;
  CreatedBefore?: string;
  MarketplaceIds?: string;
  NextToken?: string;
  limit?: number;
}

export class MockSPAPIService {
  private dataDir: string;
  private cache: Map<string, any[]> = new Map();

  constructor() {
    // Data directory relative to project root
    // Handle multiple deployment scenarios:
    // 1. Local: C:\Users\...\Clario-Complete-Backend\Integrations-backend
    // 2. Render: /opt/render/project/src/Integrations-backend
    // 3. Render (alternative): /opt/render/project/src/Clario-Complete-Backend/Integrations-backend
    
    let projectRoot = process.cwd();
    
    // If we're in Integrations-backend, go up one level
    if (projectRoot.includes('Integrations-backend')) {
      // Check if parent directory exists and contains 'data' folder
      const parentDir = path.join(projectRoot, '..');
      if (fs.existsSync(path.join(parentDir, 'data'))) {
        projectRoot = parentDir;
      } else {
        // On Render, data might be at project root level
        // Try going up to src level if we're in Integrations-backend
        const srcDir = path.join(projectRoot, '..', '..');
        if (fs.existsSync(path.join(srcDir, 'data'))) {
          projectRoot = srcDir;
        }
      }
    }
    
    this.dataDir = path.join(projectRoot, 'data', 'mock-spapi');
    
    // Ensure directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.warn('Created mock SP-API data directory (may be empty)', { path: this.dataDir });
    }
    
    // Log initialization status
    const useMock = process.env.USE_MOCK_SPAPI === 'true';
    const filesExist = fs.existsSync(this.dataDir);
    const csvFiles = filesExist ? fs.readdirSync(this.dataDir).filter(f => f.endsWith('.csv')) : [];
    
    logger.info('Mock SP-API Service initialized', {
      dataDir: this.dataDir,
      useMock,
      envVar: process.env.USE_MOCK_SPAPI,
      filesExist,
      csvFileCount: csvFiles.length,
      csvFiles: csvFiles.length > 0 ? csvFiles : 'none found',
      cwd: process.cwd()
    });
    
    if (useMock && csvFiles.length === 0) {
      logger.warn('USE_MOCK_SPAPI is enabled but no CSV files found in data directory', {
        dataDir: this.dataDir,
        hint: 'Ensure CSV files are uploaded to Render or the data directory is accessible'
      });
    }
  }

  /**
   * Load CSV file and parse to array of objects
   */
  private loadCSV(filename: string): any[] {
    const cacheKey = `csv_${filename}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const filePath = path.join(this.dataDir, filename);
    
    if (!fs.existsSync(filePath)) {
      logger.warn(`CSV file not found: ${filePath}`, { filename });
      return [];
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: (value, context) => {
          // Try to parse numbers
          if (context.header) return value;
          if (value === '' || value === null || value === undefined) return null;
          if (!isNaN(Number(value)) && value !== '') {
            return Number(value);
          }
          return value;
        }
      });

      // Cache the parsed data
      this.cache.set(cacheKey, records);
      logger.info(`Loaded ${records.length} records from ${filename}`, { 
        filename, 
        recordCount: records.length 
      });

      return records;
    } catch (error: any) {
      logger.error(`Error loading CSV file ${filename}:`, { 
        error: error.message, 
        filePath 
      });
      return [];
    }
  }

  /**
   * Filter records by date range
   */
  private filterByDateRange(
    records: any[], 
    dateField: string, 
    startDate?: string, 
    endDate?: string
  ): any[] {
    if (!startDate && !endDate) return records;

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    return records.filter(record => {
      const recordDate = record[dateField] ? new Date(record[dateField]) : null;
      if (!recordDate) return false;

      if (start && recordDate < start) return false;
      if (end && recordDate > end) return false;
      return true;
    });
  }

  /**
   * Paginate results
   */
  private paginate(records: any[], pageSize: number = 100, nextToken?: string): {
    data: any[];
    nextToken?: string;
  } {
    const page = nextToken ? parseInt(nextToken, 10) : 0;
    const start = page * pageSize;
    const end = start + pageSize;
    const paginatedData = records.slice(start, end);
    const hasMore = end < records.length;

    return {
      data: paginatedData,
      nextToken: hasMore ? String(page + 1) : undefined
    };
  }

  /**
   * Get Financial Events (Claims/Reimbursements)
   * Returns SP-API format: { payload: { FinancialEvents: { FBALiquidationEventList, AdjustmentEventList } } }
   */
  async getFinancialEvents(params: MockSPAPIParams): Promise<any> {
    const records = this.loadCSV('financial_events.csv');
    
    if (records.length === 0) {
      return {
        payload: {
          FinancialEvents: {
            FBALiquidationEventList: [],
            AdjustmentEventList: []
          }
        }
      };
    }

    // Filter by date range
    const filtered = this.filterByDateRange(
      records,
      'PostedDate',
      params.PostedAfter,
      params.PostedBefore
    );

    // Separate into liquidation events and adjustments
    const liquidationEvents = filtered
      .filter(r => r.EventType === 'FBALiquidationEvent' || r.type === 'liquidation')
      .map(r => ({
        OriginalRemovalOrderId: r.OriginalRemovalOrderId || r.orderId || r.id,
        LiquidationProceedsAmount: {
          CurrencyAmount: String(r.LiquidationProceedsAmount || r.amount || 0),
          CurrencyCode: r.CurrencyCode || r.currency || 'USD'
        },
        PostedDate: r.PostedDate || r.date || r.createdAt
      }));

    const adjustmentEvents = filtered
      .filter(r => r.EventType === 'AdjustmentEvent' || r.type === 'adjustment')
      .map(r => ({
        AdjustmentEventId: r.AdjustmentEventId || r.id,
        AdjustmentType: r.AdjustmentType || r.type || 'ADJUSTMENT',
        AdjustmentAmount: {
          CurrencyAmount: String(r.AdjustmentAmount || r.amount || 0),
          CurrencyCode: r.CurrencyCode || r.currency || 'USD'
        },
        PostedDate: r.PostedDate || r.date || r.createdAt
      }));

    // Paginate
    const allEvents = [...liquidationEvents, ...adjustmentEvents];
    const { data, nextToken } = this.paginate(allEvents, 100, params.NextToken);

    return {
      payload: {
        FinancialEvents: {
          FBALiquidationEventList: data.filter(e => e.OriginalRemovalOrderId),
          AdjustmentEventList: data.filter(e => e.AdjustmentEventId),
          NextToken: nextToken
        },
        NextToken: nextToken
      }
    };
  }

  /**
   * Get Orders
   * Returns SP-API format: { payload: { Orders: [...] } }
   */
  async getOrders(params: MockSPAPIParams): Promise<any> {
    const records = this.loadCSV('orders.csv');
    
    if (records.length === 0) {
      return {
        payload: {
          Orders: []
        }
      };
    }

    // Filter by date range
    const filtered = this.filterByDateRange(
      records,
      'PurchaseDate',
      params.CreatedAfter,
      params.CreatedBefore
    );

    // Transform to SP-API format
    const orders = filtered.map(r => ({
      AmazonOrderId: r.AmazonOrderId || r.orderId || r.order_id,
      SellerId: r.SellerId || r.sellerId,
      MarketplaceId: r.MarketplaceId || r.marketplaceId || 'ATVPDKIKX0DER',
      PurchaseDate: r.PurchaseDate || r.purchaseDate || r.order_date,
      OrderStatus: r.OrderStatus || r.orderStatus || r.status || 'Shipped',
      FulfillmentChannel: r.FulfillmentChannel || r.fulfillmentChannel || 'FBA',
      OrderType: r.OrderType || r.orderType,
      SalesChannel: r.SalesChannel || r.salesChannel,
      EarliestShipDate: r.EarliestShipDate || r.shipmentDate,
      OrderTotal: {
        Amount: String(r.OrderTotal || r.totalAmount || r.amount || 0),
        CurrencyCode: r.CurrencyCode || r.currency || 'USD'
      },
      NumberOfItemsShipped: r.NumberOfItemsShipped || r.itemsShipped || 0,
      NumberOfItemsUnshipped: r.NumberOfItemsUnshipped || r.itemsUnshipped || 0,
      IsPrime: r.IsPrime || r.isPrime || false,
      IsBusinessOrder: r.IsBusinessOrder || r.isBusinessOrder || false,
      OrderItems: r.OrderItems ? (Array.isArray(r.OrderItems) ? r.OrderItems : JSON.parse(r.OrderItems)) : (r.items ? (Array.isArray(r.items) ? r.items : JSON.parse(r.items)) : []).map((item: any) => ({
        SellerSKU: item.SellerSKU || item.sku || item.SKU,
        ASIN: item.ASIN || item.asin,
        QuantityOrdered: item.QuantityOrdered || item.quantity || 1,
        ItemPrice: {
          Amount: String(item.ItemPrice || item.price || 0),
          CurrencyCode: item.CurrencyCode || item.currency || 'USD'
        },
        Title: item.Title || item.title
      }))
    }));

    // Paginate
    const { data, nextToken } = this.paginate(orders, 100, params.NextToken);

    return {
      payload: {
        Orders: data,
        NextToken: nextToken
      }
    };
  }

  /**
   * Get Inventory Summaries
   * Returns SP-API format: { payload: { inventorySummaries: [...] } }
   */
  async getInventorySummaries(params: MockSPAPIParams): Promise<any> {
    const records = this.loadCSV('inventory.csv');
    
    if (records.length === 0) {
      return {
        payload: {
          inventorySummaries: []
        }
      };
    }

    // Transform to SP-API format
    const summaries = records.map(r => ({
      sellerSku: r.sellerSku || r.sku || r.SKU,
      asin: r.asin || r.ASIN,
      fnSku: r.fnSku || r.fnSKU || r.FNSKU,
      condition: r.condition || 'New',
      inventoryDetails: {
        availableQuantity: r.availableQuantity || r.quantity || r.available || 0,
        reservedQuantity: r.reservedQuantity || r.reserved || 0,
        damagedQuantity: r.damagedQuantity || r.damaged || 0,
        unfulfillableQuantity: r.unfulfillableQuantity || r.unfulfillable || 0
      },
      lastUpdatedTime: r.lastUpdatedTime || r.lastUpdated || r.updatedAt || new Date().toISOString()
    }));

    return {
      payload: {
        inventorySummaries: summaries
      }
    };
  }

  /**
   * Get Fees (from Financial Events)
   * Returns SP-API format: { payload: { FinancialEvents: { ServiceFeeEventList, OrderEventList } } }
   */
  async getFees(params: MockSPAPIParams): Promise<any> {
    const records = this.loadCSV('fees.csv');
    
    if (records.length === 0) {
      return {
        payload: {
          FinancialEvents: {
            ServiceFeeEventList: [],
            OrderEventList: []
          }
        }
      };
    }

    // Filter by date range
    const filtered = this.filterByDateRange(
      records,
      'PostedDate',
      params.PostedAfter,
      params.PostedBefore
    );

    // Transform to SP-API format
    const serviceFeeEvents = filtered
      .filter(r => r.EventType === 'ServiceFee' || r.type === 'fee')
      .map(r => ({
        AmazonOrderId: r.AmazonOrderId || r.orderId,
        SellerSKU: r.SellerSKU || r.sku,
        ASIN: r.ASIN || r.asin,
        PostedDate: r.PostedDate || r.date || r.createdAt,
        FeeList: [{
          FeeType: r.FeeType || r.feeType || 'SERVICE_FEE',
          FeeAmount: {
            CurrencyAmount: String(Math.abs(r.FeeAmount || r.amount || 0)),
            CurrencyCode: r.CurrencyCode || r.currency || 'USD'
          }
        }]
      }));

    const orderEvents = filtered
      .filter(r => r.EventType === 'OrderEvent' || r.type === 'order')
      .map(r => ({
        AmazonOrderId: r.AmazonOrderId || r.orderId,
        PostedDate: r.PostedDate || r.date || r.createdAt,
        OrderChargeList: [{
          ChargeType: r.ChargeType || r.chargeType || 'ORDER_CHARGE',
          ChargeAmount: {
            CurrencyAmount: String(Math.abs(r.ChargeAmount || r.amount || 0)),
            CurrencyCode: r.CurrencyCode || r.currency || 'USD'
          }
        }]
      }));

    // Paginate
    const allEvents = [...serviceFeeEvents, ...orderEvents];
    const { data, nextToken } = this.paginate(allEvents, 100, params.NextToken);

    return {
      payload: {
        FinancialEvents: {
          ServiceFeeEventList: data.filter(e => e.FeeList),
          OrderEventList: data.filter(e => e.OrderChargeList),
          NextToken: nextToken
        },
        NextToken: nextToken
      }
    };
  }

  /**
   * Get Shipments
   * Returns SP-API format: { payload: { Shipments: [...] } }
   */
  async getShipments(params: MockSPAPIParams): Promise<any> {
    const records = this.loadCSV('shipments_returns.csv');
    
    if (records.length === 0) {
      return {
        payload: {
          Shipments: []
        }
      };
    }

    // Filter shipments only
    const shipments = records
      .filter(r => r.type === 'shipment' || r.Type === 'Shipment' || !r.ReturnId)
      .map(r => ({
        ShipmentId: r.ShipmentId || r.shipmentId || r.id,
        AmazonOrderId: r.AmazonOrderId || r.orderId,
        ShipmentDate: r.ShipmentDate || r.shipmentDate || r.date,
        DestinationFulfillmentCenterId: r.DestinationFulfillmentCenterId || r.fulfillmentCenter || r.warehouse,
        ShipmentStatus: r.ShipmentStatus || r.status || 'RECEIVED',
        Items: r.Items ? (Array.isArray(r.Items) ? r.Items : JSON.parse(r.Items)) : (r.items ? (Array.isArray(r.items) ? JSON.parse(r.items) : r.items) : []).map((item: any) => ({
          SellerSKU: item.SellerSKU || item.sku,
          ASIN: item.ASIN || item.asin,
          QuantityShipped: item.QuantityShipped || item.quantity || 1
        }))
      }));

    return {
      payload: {
        Shipments: shipments
      }
    };
  }

  /**
   * Get Returns
   * Returns SP-API format: { payload: { Returns: [...] } }
   */
  async getReturns(params: MockSPAPIParams): Promise<any> {
    const records = this.loadCSV('shipments_returns.csv');
    
    if (records.length === 0) {
      return {
        payload: {
          Returns: []
        }
      };
    }

    // Filter returns only
    const returns = records
      .filter(r => r.type === 'return' || r.Type === 'Return' || r.ReturnId)
      .map(r => ({
        ReturnId: r.ReturnId || r.returnId || r.id,
        AmazonOrderId: r.AmazonOrderId || r.orderId,
        ReturnDate: r.ReturnDate || r.returnDate || r.date,
        ReturnStatus: r.ReturnStatus || r.status || 'RECEIVED',
        ReturnReason: r.ReturnReason || r.reason || 'CUSTOMER_REQUEST',
        RefundAmount: {
          Amount: String(r.RefundAmount || r.refundAmount || 0),
          CurrencyCode: r.CurrencyCode || r.currency || 'USD'
        },
        Items: r.Items ? (Array.isArray(r.Items) ? r.Items : JSON.parse(r.Items)) : (r.items ? (Array.isArray(r.items) ? JSON.parse(r.items) : r.items) : []).map((item: any) => ({
          SellerSKU: item.SellerSKU || item.sku,
          ASIN: item.ASIN || item.asin,
          QuantityReturned: item.QuantityReturned || item.quantity || 1
        }))
      }));

    return {
      payload: {
        Returns: returns
      }
    };
  }

  /**
   * Clear cache (useful for reloading CSV files)
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Mock SP-API cache cleared');
  }
}

// Singleton instance
export const mockSPAPIService = new MockSPAPIService();

