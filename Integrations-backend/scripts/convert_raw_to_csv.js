/**
 * Convert raw SP-API JSON data to CSV files for Mock SP-API Service
 * 
 * Usage: node scripts/convert_raw_to_csv.js <path_to_raw_spapi_data.json>
 */

const fs = require('fs');
const path = require('path');

function convertToCSV(rows, columns) {
  if (rows.length === 0) return '';
  
  // Header
  const header = columns.join(',');
  
  // Rows
  const csvRows = rows.map(row => {
    return columns.map(col => {
      const value = row[col] || '';
      // Escape commas and quotes
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      // Handle JSON objects/arrays
      if (typeof value === 'object' && value !== null) {
        return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      }
      return value;
    }).join(',');
  });
  
  return [header, ...csvRows].join('\n');
}

function convertRawDataToCSV(rawDataPath) {
  console.log(`Reading raw SP-API data from: ${rawDataPath}`);
  const rawData = JSON.parse(fs.readFileSync(rawDataPath, 'utf-8'));
  
  const outputDir = path.join(process.cwd(), 'data', 'mock-spapi');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Handle nested payload structure
  const payload = rawData.payload || rawData;
  const financialEventsData = payload.FinancialEvents || rawData.FinancialEvents || {};
  
  // 1. Financial Events CSV
  const financialEvents = [];
  
  // FBALiquidationEventList
  if (financialEventsData.FBALiquidationEventList) {
    financialEventsData.FBALiquidationEventList.forEach(event => {
      financialEvents.push({
        OriginalRemovalOrderId: event.OriginalRemovalOrderId || event.orderId,
        amount: event.LiquidationProceedsAmount?.CurrencyAmount || event.amount || 0,
        currency: event.LiquidationProceedsAmount?.CurrencyCode || event.currency || 'USD',
        PostedDate: event.PostedDate || event.date || event.createdAt,
        EventType: 'FBALiquidationEvent',
        type: 'liquidation'
      });
    });
  }
  
  // AdjustmentEventList
  if (financialEventsData.AdjustmentEventList) {
    financialEventsData.AdjustmentEventList.forEach(event => {
      financialEvents.push({
        AdjustmentEventId: event.AdjustmentEventId || event.id,
        AdjustmentType: event.AdjustmentType || event.type || 'ADJUSTMENT',
        amount: event.AdjustmentAmount?.CurrencyAmount || event.amount || 0,
        currency: event.AdjustmentAmount?.CurrencyCode || event.currency || 'USD',
        PostedDate: event.PostedDate || event.date || event.createdAt,
        EventType: 'AdjustmentEvent',
        type: 'adjustment'
      });
    });
  }
  
  if (financialEvents.length > 0) {
    const financialEventsCSV = convertToCSV(financialEvents, [
      'OriginalRemovalOrderId', 'AdjustmentEventId', 'amount', 'currency', 
      'PostedDate', 'EventType', 'type', 'AdjustmentType'
    ]);
    fs.writeFileSync(path.join(outputDir, 'financial_events.csv'), financialEventsCSV);
    console.log(`✅ Created financial_events.csv with ${financialEvents.length} records`);
  }
  
  // 2. Orders CSV
  const orders = [];
  const ordersData = payload.Orders || rawData.Orders || [];
  if (ordersData && ordersData.length > 0) {
    ordersData.forEach(order => {
      orders.push({
        AmazonOrderId: order.AmazonOrderId || order.orderId || order.order_id,
        PurchaseDate: order.PurchaseDate || order.purchaseDate || order.order_date,
        OrderStatus: order.OrderStatus || order.orderStatus || order.status || 'Shipped',
        FulfillmentChannel: order.FulfillmentChannel || order.fulfillmentChannel || 'FBA',
        MarketplaceId: order.MarketplaceId || order.marketplaceId || 'ATVPDKIKX0DER',
        OrderTotal: order.OrderTotal?.Amount || order.totalAmount || order.amount || 0,
        CurrencyCode: order.OrderTotal?.CurrencyCode || order.currency || 'USD',
        OrderItems: JSON.stringify(order.OrderItems || order.items || [])
      });
    });
  }
  
  if (orders.length > 0) {
    const ordersCSV = convertToCSV(orders, [
      'AmazonOrderId', 'PurchaseDate', 'OrderStatus', 'FulfillmentChannel',
      'MarketplaceId', 'OrderTotal', 'CurrencyCode', 'OrderItems'
    ]);
    fs.writeFileSync(path.join(outputDir, 'orders.csv'), ordersCSV);
    console.log(`✅ Created orders.csv with ${orders.length} records`);
  }
  
  // 3. Inventory CSV
  const inventory = [];
  const inventoryData = payload.InventorySummaries || payload.inventorySummaries || rawData.InventorySummaries || rawData.inventorySummaries || [];
  if (inventoryData && inventoryData.length > 0) {
    const summaries = inventoryData;
    summaries.forEach(item => {
      inventory.push({
        sellerSku: item.sellerSku || item.sku || item.SKU,
        asin: item.asin || item.ASIN,
        fnSku: item.fnSku || item.fnSKU || item.FNSKU,
        availableQuantity: item.inventoryDetails?.availableQuantity || item.quantity || item.available || 0,
        reservedQuantity: item.inventoryDetails?.reservedQuantity || item.reserved || 0,
        damagedQuantity: item.inventoryDetails?.damagedQuantity || item.damaged || 0,
        condition: item.condition || 'New',
        lastUpdatedTime: item.lastUpdatedTime || item.lastUpdated || item.updatedAt || new Date().toISOString()
      });
    });
  }
  
  if (inventory.length > 0) {
    const inventoryCSV = convertToCSV(inventory, [
      'sellerSku', 'asin', 'fnSku', 'availableQuantity', 
      'reservedQuantity', 'damagedQuantity', 'condition', 'lastUpdatedTime'
    ]);
    fs.writeFileSync(path.join(outputDir, 'inventory.csv'), inventoryCSV);
    console.log(`✅ Created inventory.csv with ${inventory.length} records`);
  }
  
  // 4. Fees CSV
  const fees = [];
  // ServiceFeeEventList
  if (financialEventsData.ServiceFeeEventList) {
    financialEventsData.ServiceFeeEventList.forEach(feeEvent => {
      if (feeEvent.FeeList) {
        feeEvent.FeeList.forEach(fee => {
          fees.push({
            AmazonOrderId: feeEvent.AmazonOrderId || feeEvent.orderId,
            SellerSKU: feeEvent.SellerSKU || feeEvent.sku,
            ASIN: feeEvent.ASIN || feeEvent.asin,
            FeeType: fee.FeeType || fee.feeType || 'SERVICE_FEE',
            FeeAmount: fee.FeeAmount?.CurrencyAmount || fee.amount || 0,
            CurrencyCode: fee.FeeAmount?.CurrencyCode || fee.currency || 'USD',
            PostedDate: feeEvent.PostedDate || feeEvent.date || feeEvent.createdAt,
            EventType: 'ServiceFee'
          });
        });
      }
    });
  }
  
  // OrderEventList
  if (financialEventsData.OrderEventList) {
    financialEventsData.OrderEventList.forEach(orderEvent => {
      if (orderEvent.OrderChargeList) {
        orderEvent.OrderChargeList.forEach(charge => {
          fees.push({
            AmazonOrderId: orderEvent.AmazonOrderId || orderEvent.orderId,
            ChargeType: charge.ChargeType || charge.chargeType || 'ORDER_CHARGE',
            FeeAmount: charge.ChargeAmount?.CurrencyAmount || charge.amount || 0,
            CurrencyCode: charge.ChargeAmount?.CurrencyCode || charge.currency || 'USD',
            PostedDate: orderEvent.PostedDate || orderEvent.date || orderEvent.createdAt,
            EventType: 'OrderEvent'
          });
        });
      }
    });
  }
  
  if (fees.length > 0) {
    const feesCSV = convertToCSV(fees, [
      'AmazonOrderId', 'SellerSKU', 'ASIN', 'FeeType', 
      'FeeAmount', 'CurrencyCode', 'PostedDate', 'EventType', 'ChargeType'
    ]);
    fs.writeFileSync(path.join(outputDir, 'fees.csv'), feesCSV);
    console.log(`✅ Created fees.csv with ${fees.length} records`);
  }
  
  // 5. Shipments/Returns CSV (create empty if not in raw data)
  const shipmentsReturns = [];
  // Add sample structure if needed
  if (shipmentsReturns.length === 0) {
    // Create empty file with headers
    const headers = 'ShipmentId,AmazonOrderId,ShipmentDate,type,status,ReturnDate,ReturnStatus,ReturnReason,RefundAmount';
    fs.writeFileSync(path.join(outputDir, 'shipments_returns.csv'), headers);
    console.log(`✅ Created shipments_returns.csv (empty - add data if needed)`);
  } else {
    const shipmentsReturnsCSV = convertToCSV(shipmentsReturns, [
      'ShipmentId', 'AmazonOrderId', 'ShipmentDate', 'type', 
      'status', 'ReturnDate', 'ReturnStatus', 'ReturnReason', 'RefundAmount'
    ]);
    fs.writeFileSync(path.join(outputDir, 'shipments_returns.csv'), shipmentsReturnsCSV);
    console.log(`✅ Created shipments_returns.csv with ${shipmentsReturns.length} records`);
  }
  
  console.log(`\n✅ All CSV files created in: ${outputDir}`);
  console.log(`\nNext steps:`);
  console.log(`1. Set USE_MOCK_SPAPI=true in your .env file`);
  console.log(`2. Restart the backend`);
  console.log(`3. Trigger a sync - it will use your CSV files!`);
}

// Run if called directly
if (require.main === module) {
  const rawDataPath = process.argv[2];
  if (!rawDataPath) {
    console.error('Usage: node scripts/convert_raw_to_csv.js <path_to_raw_spapi_data.json>');
    console.error('Example: node scripts/convert_raw_to_csv.js /mnt/data/raw_spapi_data.json');
    process.exit(1);
  }
  
  if (!fs.existsSync(rawDataPath)) {
    console.error(`Error: File not found: ${rawDataPath}`);
    process.exit(1);
  }
  
  convertRawDataToCSV(rawDataPath);
}

module.exports = { convertRawDataToCSV };

