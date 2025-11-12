# Phase 2: Frontend Implementation Guide
## Continuous Data Sync - What the Frontend Should Expect

## 📋 Overview

Phase 2 enables continuous synchronization of **Orders, Shipments, Returns, and Settlements** data from Amazon SP-API. The frontend needs to display this data, show sync status, and provide real-time updates.

---

## 🎯 Core Data Types

### 1. **Orders**
**What it is**: Customer orders from Amazon marketplace

**Frontend should display**:
- Order ID, Order Date, Shipment Date
- Order Status (Pending, Shipped, Delivered, Cancelled)
- Fulfillment Channel (FBA/FBM)
- Items (SKU, ASIN, Quantity, Price)
- Total Amount, Currency
- Order Type (Prime, Business, Premium)

**Key Fields**:
```typescript
interface Order {
  id: string;                    // UUID from database
  order_id: string;              // Amazon Order ID (e.g., "123-4567890-1234567")
  seller_id?: string;
  marketplace_id: string;
  order_date: string;            // ISO 8601 timestamp
  shipment_date?: string;        // ISO 8601 timestamp
  fulfillment_channel: string;   // "FBA" | "FBM"
  order_status: string;          // "Pending" | "Shipped" | "Delivered" | "Cancelled"
  items: OrderItem[];           // Array of items
  quantities: Record<string, number>; // Summary: { "SKU-001": 5, "SKU-002": 3 }
  total_amount?: number;
  currency: string;              // "USD" | "EUR" | etc.
  metadata: {
    orderType?: string;
    salesChannel?: string;
    isPrime?: boolean;
    isBusinessOrder?: boolean;
    numberOfItemsShipped?: number;
    numberOfItemsUnshipped?: number;
  };
  sync_timestamp: string;       // Last sync time
  is_sandbox: boolean;
  created_at: string;
  updated_at: string;
}

interface OrderItem {
  sku: string;
  asin: string;
  quantity: number;
  price: number;
  title?: string;
}
```

### 2. **Shipments**
**What it is**: FBA shipment tracking data

**Frontend should display**:
- Shipment ID, Tracking Number
- Order ID (link to order)
- Shipped Date, Received Date
- Status (in_transit, received, partial, lost, damaged)
- Carrier, Warehouse Location
- Items, Expected Quantity, Received Quantity, Missing Quantity

**Key Fields**:
```typescript
interface Shipment {
  id: string;
  shipment_id: string;          // FBA Shipment ID
  order_id?: string;            // Links to orders table
  tracking_number?: string;
  shipped_date?: string;        // ISO 8601
  received_date?: string;        // ISO 8601
  status: string;               // "in_transit" | "received" | "partial" | "lost" | "damaged"
  carrier?: string;
  warehouse_location?: string;
  items: ShipmentItem[];
  expected_quantity: number;
  received_quantity?: number;
  missing_quantity: number;     // Calculated: expected - received
  metadata: {
    shipmentType?: string;
    fulfillmentCenterId?: string;
  };
  sync_timestamp: string;
  is_sandbox: boolean;
  created_at: string;
  updated_at: string;
}

interface ShipmentItem {
  sku: string;
  asin: string;
  quantity: number;
}
```

### 3. **Returns**
**What it is**: Customer return data

**Frontend should display**:
- Return ID, Order ID (link to order)
- Reason, Returned Date
- Status (pending, processed, refunded, rejected)
- Refund Amount, Currency
- Items returned
- Partial Return flag

**Key Fields**:
```typescript
interface Return {
  id: string;
  return_id: string;
  order_id?: string;            // Links to orders table
  reason: string;               // "Defective" | "Wrong Item" | "Not as Described" | etc.
  returned_date: string;        // ISO 8601
  status: string;               // "pending" | "processed" | "refunded" | "rejected"
  refund_amount: number;
  currency: string;
  items: ReturnItem[];
  is_partial: boolean;          // True if not all items returned
  metadata: {
    returnType?: string;
    disposition?: string;
  };
  sync_timestamp: string;
  is_sandbox: boolean;
  created_at: string;
  updated_at: string;
}

interface ReturnItem {
  sku: string;
  asin: string;
  quantity: number;
  refund_amount: number;
}
```

### 4. **Settlements**
**What it is**: Financial settlements and fee data

**Frontend should display**:
- Settlement ID, Order ID (link to order)
- Transaction Type (fee, refund, reimbursement, adjustment)
- Amount, Fees, Currency
- Settlement Date
- Fee Breakdown (FBA fee, referral fee, shipping fee, etc.)

**Key Fields**:
```typescript
interface Settlement {
  id: string;
  settlement_id: string;
  order_id?: string;            // Links to orders table
  transaction_type: string;     // "fee" | "refund" | "reimbursement" | "adjustment" | "payment"
  amount: number;
  fees: number;
  currency: string;
  settlement_date: string;      // ISO 8601
  fee_breakdown: {
    fba_fee?: number;
    referral_fee?: number;
    shipping_fee?: number;
    storage_fee?: number;
    long_term_storage_fee?: number;
    removal_fee?: number;
    [key: string]: number | undefined;
  };
  metadata: Record<string, any>;
  sync_timestamp: string;
  is_sandbox: boolean;
  created_at: string;
  updated_at: string;
}
```

---

## 🔌 API Endpoints

### 1. **Get Orders**
```http
GET /api/v1/integrations/amazon/orders
GET /api/sync/orders
```

**Query Parameters**:
- `userId` (required): User ID
- `startDate` (optional): ISO 8601 date string
- `endDate` (optional): ISO 8601 date string
- `status` (optional): Filter by order status
- `fulfillmentChannel` (optional): "FBA" | "FBM"
- `limit` (optional): Number of records (default: 100)
- `offset` (optional): Pagination offset

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "order_id": "123-4567890-1234567",
      "order_date": "2024-01-15T10:30:00Z",
      "order_status": "Shipped",
      "items": [...],
      "total_amount": 99.99,
      "currency": "USD",
      ...
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

### 2. **Get Shipments**
```http
GET /api/v1/integrations/amazon/shipments
GET /api/sync/shipments
```

**Query Parameters**:
- `userId` (required)
- `orderId` (optional): Filter by order ID
- `status` (optional): Filter by status
- `startDate`, `endDate` (optional)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "shipment_id": "FBA1234567",
      "order_id": "123-4567890-1234567",
      "tracking_number": "1Z999AA10123456784",
      "status": "received",
      "expected_quantity": 10,
      "received_quantity": 10,
      "missing_quantity": 0,
      ...
    }
  ]
}
```

### 3. **Get Returns**
```http
GET /api/v1/integrations/amazon/returns
GET /api/sync/returns
```

**Query Parameters**: Similar to shipments

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "return_id": "RET123456",
      "order_id": "123-4567890-1234567",
      "reason": "Defective",
      "status": "refunded",
      "refund_amount": 29.99,
      "is_partial": false,
      ...
    }
  ]
}
```

### 4. **Get Settlements**
```http
GET /api/v1/integrations/amazon/settlements
GET /api/sync/settlements
```

**Query Parameters**: Similar to others

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "settlement_id": "SET123456",
      "order_id": "123-4567890-1234567",
      "transaction_type": "fee",
      "amount": 5.99,
      "fees": 5.99,
      "fee_breakdown": {
        "fba_fee": 3.99,
        "referral_fee": 2.00
      },
      ...
    }
  ]
}
```

### 5. **Trigger Manual Sync**
```http
POST /api/v1/integrations/amazon/sync
POST /api/sync/trigger
```

**Request Body**:
```json
{
  "userId": "user-id",
  "syncTypes": ["orders", "shipments", "returns", "settlements"] // Optional, all if omitted
}
```

**Response**:
```json
{
  "success": true,
  "syncId": "sync_user-id_1234567890",
  "message": "Sync initiated",
  "estimatedDuration": "30-60 seconds"
}
```

### 6. **Get Sync Status**
```http
GET /api/v1/integrations/amazon/sync/status
GET /api/sync/status?userId=user-id
```

**Response**:
```json
{
  "success": true,
  "status": "completed", // "running" | "completed" | "failed"
  "syncId": "sync_user-id_1234567890",
  "progress": 100,
  "results": {
    "orders": { "count": 25, "status": "success" },
    "shipments": { "count": 10, "status": "success" },
    "returns": { "count": 5, "status": "success" },
    "settlements": { "count": 30, "status": "success" }
  },
  "startedAt": "2024-01-15T10:00:00Z",
  "completedAt": "2024-01-15T10:00:30Z",
  "duration": 30000
}
```

---

## 🔔 Real-Time Updates (SSE)

### Sync Progress Events
**Endpoint**: `/api/sse/sync-progress?userId=user-id`

**Event Types**:
1. `sync_started` - Sync initiated
2. `sync_progress` - Progress update
3. `sync_completed` - Sync finished
4. `sync_failed` - Sync error

**Event Format**:
```json
{
  "event": "sync_progress",
  "data": {
    "syncId": "sync_user-id_1234567890",
    "progress": 50,
    "currentStep": "Syncing orders...",
    "results": {
      "orders": { "count": 25, "status": "completed" },
      "shipments": { "count": 0, "status": "in_progress" }
    }
  }
}
```

### Data Update Events
**Endpoint**: `/api/sse/data-updates?userId=user-id`

**Event Types**:
- `order_updated` - New/updated order
- `shipment_updated` - New/updated shipment
- `return_updated` - New/updated return
- `settlement_updated` - New/updated settlement

**Event Format**:
```json
{
  "event": "order_updated",
  "data": {
    "type": "order",
    "action": "created", // "created" | "updated"
    "order": { /* Order object */ }
  }
}
```

---

## 🎨 UI Components Needed

### 1. **Sync Status Indicator**
**Location**: Top navigation or dashboard header

**Shows**:
- Last sync time
- Sync status (idle, running, completed, failed)
- Progress bar (if running)
- Manual sync button

**States**:
- 🟢 **Idle**: "Last synced 2 hours ago" + "Sync Now" button
- 🟡 **Running**: "Syncing... 50% complete" + progress bar
- 🟢 **Completed**: "Synced 5 minutes ago" + checkmark
- 🔴 **Failed**: "Sync failed - Retry" + error message

### 2. **Orders Dashboard**
**Location**: Main dashboard or dedicated Orders page

**Displays**:
- Orders table with columns:
  - Order ID (clickable, links to detail)
  - Date
  - Status (badge with color)
  - Items Count
  - Total Amount
  - Fulfillment Channel
- Filters:
  - Date range
  - Status
  - Fulfillment Channel
  - Marketplace
- Search: By Order ID, SKU, ASIN
- Pagination

**Order Detail View**:
- Order information card
- Items list (expandable)
- Timeline (order placed → shipped → delivered)
- Related shipments, returns, settlements

### 3. **Shipments Dashboard**
**Location**: Dedicated Shipments page or Orders detail

**Displays**:
- Shipments table:
  - Shipment ID
  - Order ID (link)
  - Tracking Number (link to carrier)
  - Status (badge)
  - Shipped Date
  - Received Date
  - Quantity (Expected/Received/Missing)
- Status indicators:
  - 🟢 Received (all items)
  - 🟡 Partial (some missing)
  - 🔴 Lost/Damaged
  - ⚪ In Transit

**Shipment Detail View**:
- Shipment information
- Items list
- Tracking timeline
- Missing items alert (if any)

### 4. **Returns Dashboard**
**Location**: Dedicated Returns page

**Displays**:
- Returns table:
  - Return ID
  - Order ID (link)
  - Reason
  - Returned Date
  - Status
  - Refund Amount
  - Partial flag
- Filters: Status, Reason, Date range
- Summary cards:
  - Total Returns
  - Total Refunded
  - Average Refund Amount
  - Partial Returns Count

### 5. **Settlements Dashboard**
**Location**: Financial/Dashboard section

**Displays**:
- Settlements table:
  - Settlement ID
  - Order ID (link)
  - Transaction Type
  - Amount
  - Fees
  - Date
- Summary cards:
  - Total Fees
  - Total Reimbursements
  - Net Amount
  - Fee Breakdown (pie chart)
- Filters: Transaction Type, Date range

### 6. **Data Visualization**

**Charts Needed**:
1. **Orders Over Time** (line chart)
   - X-axis: Date
   - Y-axis: Order count
   - Series: By status or fulfillment channel

2. **Revenue by Order** (bar chart)
   - X-axis: Order ID or Date
   - Y-axis: Amount

3. **Shipment Status Distribution** (pie chart)
   - Received, In Transit, Partial, Lost

4. **Returns by Reason** (bar chart)
   - X-axis: Reason
   - Y-axis: Count

5. **Fee Breakdown** (stacked bar chart)
   - X-axis: Date
   - Y-axis: Amount
   - Stacked: FBA fee, Referral fee, Shipping fee, etc.

6. **Missing Inventory Alert** (if missing_quantity > 0)
   - Highlight shipments with missing items
   - Show potential claims

---

## 🔄 Loading States

### Initial Load
- Show skeleton loaders for tables
- Display "Loading orders..." message
- Disable filters/actions until data loads

### Sync in Progress
- Show sync progress indicator
- Disable manual sync button
- Display "Syncing data..." toast/notification
- Update data incrementally as sync completes

### Empty States
- **No Data**: "No orders found. Sync data to get started."
- **Sandbox Empty**: "Sandbox returned no data. This is normal for testing."
- **Sync Required**: "Click 'Sync Now' to fetch your data."

---

## ⚠️ Error Handling

### API Errors
**400 Bad Request**:
```json
{
  "success": false,
  "error": "Invalid parameters",
  "message": "startDate must be a valid ISO 8601 date"
}
```

**401 Unauthorized**:
```json
{
  "success": false,
  "error": "Unauthorized",
  "message": "Amazon connection expired. Please reconnect."
}
```

**404 Not Found**:
```json
{
  "success": false,
  "error": "Not Found",
  "message": "No orders found for the specified criteria"
}
```

**500 Server Error**:
```json
{
  "success": false,
  "error": "Internal Server Error",
  "message": "Sync failed. Please try again later."
}
```

### Frontend Error Handling
1. **Network Errors**: Show retry button, log error
2. **Timeout**: Show "Request timed out" + retry
3. **Invalid Data**: Validate response structure, show error message
4. **Sandbox Empty Responses**: Show friendly message (not an error)

---

## 📊 Data Relationships

### Order → Shipments
- One order can have multiple shipments
- Show shipments in order detail view
- Link shipment.order_id to order.order_id

### Order → Returns
- One order can have multiple returns
- Show returns in order detail view
- Link return.order_id to order.order_id

### Order → Settlements
- One order can have multiple settlements (fees, refunds, etc.)
- Show settlements in order detail view
- Link settlement.order_id to order.order_id

### Shipment → Missing Items
- If `missing_quantity > 0`, highlight as potential claim
- Show alert: "Missing items detected - potential reimbursement claim"

---

## 🎯 User Interactions

### 1. **Manual Sync**
- Button: "Sync Now" or "Refresh Data"
- Location: Dashboard header or sync status indicator
- Action: Triggers POST `/api/sync/trigger`
- Feedback: Show progress, update UI when complete

### 2. **Filter & Search**
- Real-time filtering as user types
- Debounce search (300ms)
- Clear filters button
- Save filter preferences (localStorage)

### 3. **Pagination**
- Load more button (infinite scroll option)
- Traditional pagination (page numbers)
- Remember page on refresh

### 4. **Export Data**
- Export to CSV/Excel
- Filtered data export
- Date range selection

### 5. **Real-Time Updates**
- Auto-refresh every 5 minutes (optional toggle)
- Show notification when new data arrives
- Highlight new/updated rows

---

## 🔍 Data Validation

### Frontend Validation
1. **Date Ranges**: Ensure startDate < endDate
2. **Required Fields**: Validate userId is present
3. **Pagination**: Validate limit (max 1000) and offset
4. **Status Filters**: Validate against allowed values

### Response Validation
```typescript
// Validate order response
function validateOrder(order: any): order is Order {
  return (
    typeof order.order_id === 'string' &&
    typeof order.order_date === 'string' &&
    Array.isArray(order.items) &&
    typeof order.quantities === 'object'
  );
}
```

---

## 📱 Mobile Considerations

### Responsive Tables
- Convert to cards on mobile
- Show key fields only
- Expandable details

### Touch Interactions
- Swipe to refresh
- Pull to sync
- Long press for actions

### Performance
- Virtual scrolling for large lists
- Lazy load images/icons
- Debounce search/filters

---

## 🧪 Testing Scenarios

### 1. **Empty State**
- No data synced yet
- Show "Sync Now" CTA

### 2. **Sandbox Empty Response**
- Sandbox returns empty arrays
- Show "Sandbox test mode - no data available"

### 3. **Sync in Progress**
- Show progress indicator
- Disable actions
- Update UI incrementally

### 4. **Large Dataset**
- 1000+ orders
- Test pagination
- Test performance

### 5. **Error States**
- Network error
- API error
- Invalid data

### 6. **Real-Time Updates**
- SSE connection
- Data updates
- Sync completion

---

## 📋 Implementation Checklist

### Phase 1: Basic Display
- [ ] Orders table with basic columns
- [ ] Shipments table
- [ ] Returns table
- [ ] Settlements table
- [ ] Sync status indicator
- [ ] Manual sync button

### Phase 2: Filtering & Search
- [ ] Date range filters
- [ ] Status filters
- [ ] Search functionality
- [ ] Pagination

### Phase 3: Detail Views
- [ ] Order detail page
- [ ] Shipment detail page
- [ ] Return detail page
- [ ] Settlement detail page

### Phase 4: Real-Time Updates
- [ ] SSE connection
- [ ] Progress updates
- [ ] Data update events
- [ ] Auto-refresh

### Phase 5: Data Visualization
- [ ] Charts and graphs
- [ ] Summary cards
- [ ] Export functionality

### Phase 6: Error Handling
- [ ] Error messages
- [ ] Retry logic
- [ ] Empty states
- [ ] Loading states

---

## 🚀 Quick Start Example

```typescript
// React example
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

function OrdersDashboard({ userId }: { userId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['orders', userId],
    queryFn: async () => {
      const response = await fetch(
        `/api/v1/integrations/amazon/orders?userId=${userId}`
      );
      return response.json();
    },
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  const handleSync = async () => {
    await fetch('/api/sync/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    refetch();
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;
  if (!data?.data?.length) return <EmptyState onSync={handleSync} />;

  return (
    <div>
      <SyncStatusIndicator onSync={handleSync} />
      <OrdersTable orders={data.data} />
    </div>
  );
}
```

---

## 📚 Additional Resources

- **API Documentation**: See `API_CONTRACTS.md`
- **Backend Implementation**: See `PHASE2_IMPLEMENTATION_COMPLETE.md`
- **Data Schema**: See database migration `002_create_phase2_tables.sql`
- **Testing Guide**: See `PHASE2_READY_FOR_IMPLEMENTATION.md`

---

**Status**: ✅ Phase 2 backend is complete and ready for frontend integration.

