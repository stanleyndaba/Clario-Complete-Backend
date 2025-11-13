# Mock SP-API Data Directory

Place your CSV files here to use as mock Amazon SP-API data.

## Required CSV Files

### 1. `financial_events.csv`
Financial events including claims/reimbursements.

**Required Columns:**
- `OriginalRemovalOrderId` or `orderId` - Order ID
- `LiquidationProceedsAmount` or `amount` - Reimbursement amount
- `CurrencyCode` or `currency` - Currency (USD, etc.)
- `PostedDate` or `date` or `createdAt` - Date (ISO format)
- `EventType` or `type` - "FBALiquidationEvent" or "AdjustmentEvent"
- `AdjustmentEventId` or `id` - Event ID (for adjustments)
- `AdjustmentType` or `type` - Adjustment type

**Example:**
```csv
OriginalRemovalOrderId,amount,currency,PostedDate,EventType
123-4567890-1234567,89.99,USD,2024-01-15T10:00:00Z,FBALiquidationEvent
ADJ-001,45.50,USD,2024-01-16T10:00:00Z,AdjustmentEvent
```

### 2. `orders.csv`
Order data.

**Required Columns:**
- `AmazonOrderId` or `orderId` or `order_id` - Order ID
- `PurchaseDate` or `purchaseDate` or `order_date` - Order date (ISO format)
- `OrderStatus` or `orderStatus` or `status` - Status (Shipped, Pending, etc.)
- `FulfillmentChannel` or `fulfillmentChannel` - FBA or MFN
- `MarketplaceId` or `marketplaceId` - Marketplace ID
- `OrderTotal` or `totalAmount` or `amount` - Total amount
- `CurrencyCode` or `currency` - Currency
- `OrderItems` or `items` - JSON array of items OR separate columns

**Example:**
```csv
AmazonOrderId,PurchaseDate,OrderStatus,FulfillmentChannel,OrderTotal,CurrencyCode
123-4567890-1234567,2024-01-15T10:00:00Z,Shipped,FBA,89.99,USD
```

### 3. `inventory.csv`
Inventory data.

**Required Columns:**
- `sellerSku` or `sku` or `SKU` - SKU
- `asin` or `ASIN` - ASIN
- `fnSku` or `fnSKU` or `FNSKU` - FNSKU
- `availableQuantity` or `quantity` or `available` - Available quantity
- `reservedQuantity` or `reserved` - Reserved quantity
- `damagedQuantity` or `damaged` - Damaged quantity
- `condition` - Condition (New, Used, etc.)
- `lastUpdatedTime` or `lastUpdated` or `updatedAt` - Last updated (ISO format)

**Example:**
```csv
sellerSku,asin,availableQuantity,reservedQuantity,condition,lastUpdatedTime
SKU-001,B08N5WRWNW,45,5,New,2024-01-15T10:00:00Z
```

### 4. `fees.csv`
Fee data.

**Required Columns:**
- `AmazonOrderId` or `orderId` - Order ID
- `SellerSKU` or `sku` - SKU
- `ASIN` or `asin` - ASIN
- `FeeType` or `feeType` - Fee type (SERVICE_FEE, REFERRAL_FEE, etc.)
- `FeeAmount` or `amount` - Fee amount
- `CurrencyCode` or `currency` - Currency
- `PostedDate` or `date` or `createdAt` - Date (ISO format)
- `EventType` or `type` - "ServiceFee" or "OrderEvent"
- `ChargeType` or `chargeType` - Charge type (for OrderEvent)

**Example:**
```csv
AmazonOrderId,SellerSKU,FeeType,FeeAmount,CurrencyCode,PostedDate,EventType
123-4567890-1234567,SKU-001,SERVICE_FEE,2.99,USD,2024-01-15T10:00:00Z,ServiceFee
```

### 5. `shipments_returns.csv`
Shipments and returns data.

**Required Columns:**
- `ShipmentId` or `shipmentId` or `id` - Shipment/Return ID
- `AmazonOrderId` or `orderId` - Order ID
- `ShipmentDate` or `shipmentDate` or `date` - Date (ISO format)
- `ReturnDate` or `returnDate` or `date` - Date (for returns)
- `type` or `Type` - "shipment" or "return"
- `DestinationFulfillmentCenterId` or `fulfillmentCenter` or `warehouse` - Warehouse
- `ShipmentStatus` or `status` - Status
- `ReturnStatus` or `status` - Status (for returns)
- `ReturnReason` or `reason` - Return reason
- `RefundAmount` or `refundAmount` - Refund amount (for returns)
- `Items` or `items` - JSON array of items OR separate columns

**Example:**
```csv
ShipmentId,AmazonOrderId,ShipmentDate,type,status
SHIP-001,123-4567890-1234567,2024-01-15T10:00:00Z,shipment,RECEIVED
RET-001,123-4567890-1234567,2024-01-20T10:00:00Z,return,RECEIVED,CUSTOMER_REQUEST,45.99
```

## Usage

1. Place your CSV files in this directory
2. Set environment variable: `USE_MOCK_SPAPI=true`
3. Restart the backend
4. The system will read from CSV files instead of real SP-API

## Notes

- CSV files are cached in memory for performance
- Date filtering is applied automatically based on query parameters
- Pagination is handled automatically
- Missing columns will use defaults or null values
- The system handles both camelCase and snake_case column names

