# Phase 2: Continuous Data Sync - Verification & Analysis

## 🎯 What We're Verifying

**Goal**: Verify that our smart inventory sync can pull **ALL data** needed for finding and matching everything for claim detection.

**Environment**: Sandbox (not Real SP-API)

---

## 📊 Current Data Sync Implementation

### ✅ What's Currently Being Pulled

#### 1. **Inventory Data** ✅
- **Endpoint**: `/fba/inventory/v1/summaries`
- **Status**: ✅ Implemented
- **Data Retrieved**:
  - SKU
  - FNSKU
  - ASIN
  - Quantity (available, reserved, unsellable, inbound)
  - Condition
  - Location/Warehouse
  - Last updated timestamp
- **Code Location**: `Integrations-backend/src/services/amazonService.ts:fetchInventory()`
- **Sandbox Support**: ✅ Yes (handles empty responses)

#### 2. **Claims/Reimbursements** ✅
- **Endpoint**: `/finances/v0/financialEvents` (FBALiquidationEventList, AdjustmentEventList)
- **Status**: ✅ Implemented
- **Data Retrieved**:
  - Reimbursement ID
  - Order ID
  - Amount
  - Currency
  - Status
  - Type (liquidation_reimbursement, adjustment_reimbursement)
  - Posted date
- **Code Location**: `Integrations-backend/src/services/amazonService.ts:fetchClaims()`
- **Sandbox Support**: ✅ Yes (handles empty responses)

#### 3. **Fees** ✅
- **Endpoint**: `/finances/v0/financialEvents` (ServiceFeeEventList, OrderEventList)
- **Status**: ✅ Implemented
- **Data Retrieved**:
  - Fee type
  - Amount
  - Currency
  - Order ID
  - SKU
  - Posted date
- **Code Location**: `Integrations-backend/src/services/amazonService.ts:fetchFees()`
- **Sandbox Support**: ✅ Yes

#### 4. **Financial Events** ✅
- **Endpoint**: `/finances/v0/financialEvents`
- **Status**: ✅ Implemented (via fees sync)
- **Data Retrieved**:
  - Service fees
  - Order events
  - Adjustment events
- **Code Location**: `Integrations-backend/src/jobs/amazonSyncJob.ts:ingestFinancialEvents()`
- **Sandbox Support**: ✅ Yes

---

## ❌ What's MISSING (Required for Phase 2)

### 1. **FBA Reports** ❌
**Status**: ⚠️ Partially Implemented (Report types defined, but not actively synced)

**Required Reports** (from `Integrations-backend/opsided-backend/integrations/amazon/reports/src/types/index.ts`):
- ❌ `GET_FLAT_FILE_INVENTORY_LEDGER_REPORT_V2` - Inventory ledger
- ❌ `GET_FBA_REIMBURSEMENTS_DATA` - FBA reimbursements
- ❌ `GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA` - FBA returns
- ❌ `GET_FLAT_FILE_INVENTORY_ADJUSTMENT_DATA_V2` - Inventory adjustments
- ❌ `GET_FBA_FULFILLMENT_SHIPMENT_DATA` - FBA shipments
- ❌ `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2` - Settlements
- ❌ `GET_STRANDED_INVENTORY_UI_DATA` - Stranded inventory
- ❌ `GET_FBA_INVENTORY_HEALTH_DATA` - Inventory health

**Why Critical**: These reports contain detailed transaction-level data needed for:
- Matching shipments to inventory
- Finding lost/damaged items
- Identifying fee discrepancies
- Tracking returns and adjustments

**Code Location**: 
- Types defined: `Integrations-backend/opsided-backend/integrations/amazon/reports/src/types/index.ts`
- Service exists: `Integrations-backend/opsided-backend/integrations/amazon/reports/src/services/report.sync.service.ts`
- **BUT**: Not integrated into main sync job

### 2. **Orders Data** ❌
**Status**: ❌ Not Implemented

**Required Data**:
- Order ID
- Order date
- Order status
- Order items (SKU, ASIN, quantity, price)
- Shipping information
- Customer information
- Marketplace

**Why Critical**: Needed for:
- Matching claims to orders
- Calculating expected vs actual inventory
- Finding missing shipments
- Return tracking

**Endpoint**: `/orders/v0/orders`
**Code Location**: Not found in current sync implementation

### 3. **Shipments Data** ❌
**Status**: ❌ Not Implemented (Report type exists but not synced)

**Required Data**:
- Shipment ID
- Shipment date
- Items in shipment (SKU, ASIN, quantity)
- Warehouse received date
- Carrier information
- Tracking numbers

**Why Critical**: Needed for:
- Matching shipments to inventory receipts
- Finding lost shipments
- Calculating expected inventory
- Proving shipment delivery

**Report Type**: `GET_FBA_FULFILLMENT_SHIPMENT_DATA`
**Code Location**: Not integrated into sync

### 4. **Returns Data** ❌
**Status**: ❌ Not Implemented (Report type exists but not synced)

**Required Data**:
- Return ID
- Order ID
- Return reason
- Return date
- Items returned (SKU, ASIN, quantity)
- Return status
- Refund amount

**Why Critical**: Needed for:
- Matching returns to claims
- Identifying return-related reimbursements
- Tracking return processing

**Report Type**: `GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA`
**Code Location**: Not integrated into sync

### 5. **Settlements Data** ❌
**Status**: ❌ Not Implemented (Report type exists but not synced)

**Required Data**:
- Settlement ID
- Settlement date
- Total amount
- Fees breakdown
- Reimbursements
- Adjustments

**Why Critical**: Needed for:
- Matching financial events to settlements
- Finding fee discrepancies
- Calculating expected payments

**Report Type**: `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`
**Code Location**: Not integrated into sync

---

## 🔍 Data Required for Claim Detection & Matching

Based on `Claim Detector Model/claim_detector/src/rules_engine/rules_engine.py` and evidence matching requirements:

### Required Fields for Claim Detection:
```python
class ClaimData:
    sku: str                    # ✅ From inventory
    asin: str                   # ✅ From inventory
    claim_type: str             # ✅ From claims/reimbursements
    quantity_affected: int      # ❌ Need from shipments/returns
    amount_requested: float      # ✅ From claims/reimbursements
    shipment_date: Optional[datetime]  # ❌ Need from shipments
    received_date: Optional[datetime]   # ❌ Need from shipments
    warehouse_location: Optional[str]  # ✅ From inventory
    marketplace: Optional[str]   # ✅ From inventory
    cost_per_unit: Optional[float] # ❌ Need from orders/settlements
    evidence_attached: bool      # ✅ From claims
```

### Evidence Sources Required (from `structured_claim.py`):
1. ✅ **Inventory Data** - Available
2. ❌ **Shipment Reconciliation Reports** - Missing
3. ❌ **Inbound Shipment Logs** - Missing
4. ❌ **FC Processing Logs** - Missing
5. ❌ **Carrier Confirmation** - Missing
6. ❌ **Shipping Manifests** - Missing
7. ❌ **Return Reports** - Missing
8. ❌ **Settlement Reports** - Missing
9. ✅ **Financial Events** - Available (partial)

---

## 📋 Current Sync Job Flow

**File**: `Integrations-backend/src/jobs/amazonSyncJob.ts`

**Current Flow**:
1. ✅ Check user has valid Amazon token
2. ✅ Fetch claims (reimbursements) from Financial Events API
3. ✅ Save claims to database
4. ✅ Fetch inventory from FBA Inventory API
5. ✅ Save inventory to database
6. ✅ Fetch fees from Financial Events API
7. ✅ Save fees to database
8. ✅ Ingest financial events
9. ✅ Trigger detection job

**Missing Steps**:
- ❌ Request FBA reports (inventory ledger, shipments, returns, settlements)
- ❌ Download and parse FBA reports
- ❌ Fetch orders data
- ❌ Normalize all data into unified schema
- ❌ Match shipments to inventory
- ❌ Match returns to orders
- ❌ Match financial events to settlements

---

## 🎯 Phase 2 Requirements vs Current State

### What Phase 2 Needs:
1. **Background workers continuously pull FBA reports** ❌
   - Current: Only pulls inventory summaries and financial events
   - Missing: FBA report requests, downloads, parsing

2. **Normalization layer unifies Amazon's messy data** ⚠️
   - Current: Basic transformation in `amazonService.ts`
   - Missing: Comprehensive normalization schema
   - Missing: Unified data model across all data types

3. **System becomes always-on radar** ⚠️
   - Current: Manual sync trigger or OAuth-triggered sync
   - Missing: Continuous background sync (cron jobs)
   - Missing: Real-time monitoring

4. **All data for finding and matching** ❌
   - Current: ~40% of required data
   - Missing: Orders, Shipments, Returns, Settlements, Detailed Reports

---

## 🚨 Critical Gaps

### 1. **FBA Reports Not Being Requested**
- Report types are defined but not actively requested
- Report sync service exists but not integrated
- No background job to request/download reports

### 2. **Orders API Not Called**
- No orders data being fetched
- Critical for matching claims to orders
- Needed for calculating expected inventory

### 3. **Shipments Data Missing**
- Shipment report type exists but not synced
- Critical for matching shipments to inventory
- Needed for lost shipment claims

### 4. **Returns Data Missing**
- Returns report type exists but not synced
- Critical for return-related claims
- Needed for matching returns to orders

### 5. **Settlements Data Missing**
- Settlement report type exists but not synced
- Critical for fee discrepancy detection
- Needed for matching financial events

### 6. **No Continuous Sync**
- Sync only runs on OAuth callback or manual trigger
- No scheduled background jobs
- No real-time monitoring

---

## ✅ Sandbox Considerations

### Current Sandbox Handling:
- ✅ Handles empty responses gracefully
- ✅ Logs sandbox mode clearly
- ✅ Returns empty arrays instead of errors
- ✅ Distinguishes between sandbox and production

### Sandbox Limitations:
- ⚠️ Sandbox may return limited/empty data
- ⚠️ Some report types may not be available in sandbox
- ⚠️ Orders API may return mock data only
- ⚠️ Financial Events may be limited

### Recommendations:
1. Test with sandbox but expect limited data
2. Verify all endpoints are called (even if empty)
3. Ensure error handling works for sandbox limitations
4. Log sandbox mode clearly in all sync operations

---

## 🔧 What Needs to Be Fixed/Added

### Priority 1: Critical for Phase 2
1. **Integrate FBA Reports Sync**
   - Connect report sync service to main sync job
   - Request all required report types
   - Download and parse reports
   - Save to database

2. **Add Orders API Integration**
   - Fetch orders from `/orders/v0/orders`
   - Save orders to database
   - Link orders to inventory and claims

3. **Add Shipments Sync**
   - Request shipment reports
   - Parse shipment data
   - Match shipments to inventory

4. **Add Returns Sync**
   - Request returns reports
   - Parse returns data
   - Match returns to orders

5. **Add Settlements Sync**
   - Request settlement reports
   - Parse settlement data
   - Match settlements to financial events

### Priority 2: Enhancement
6. **Continuous Background Sync**
   - Set up cron jobs for scheduled syncs
   - Implement incremental sync (only new data)
   - Add sync monitoring and alerts

7. **Normalization Layer**
   - Create unified data schema
   - Normalize all data types
   - Create matching/relationship logic

8. **Real-time Monitoring**
   - WebSocket/SSE for sync status
   - Dashboard for sync health
   - Alerts for sync failures

---

## 📊 Data Coverage Summary

| Data Type | Status | Coverage | Critical for Matching |
|-----------|--------|----------|----------------------|
| Inventory | ✅ | 100% | ✅ Yes |
| Claims/Reimbursements | ✅ | 80% | ✅ Yes |
| Fees | ✅ | 70% | ⚠️ Partial |
| Financial Events | ✅ | 60% | ⚠️ Partial |
| Orders | ❌ | 0% | ✅ **CRITICAL** |
| Shipments | ❌ | 0% | ✅ **CRITICAL** |
| Returns | ❌ | 0% | ✅ **CRITICAL** |
| Settlements | ❌ | 0% | ✅ **CRITICAL** |
| Inventory Ledger | ❌ | 0% | ✅ **CRITICAL** |
| Inventory Adjustments | ❌ | 0% | ✅ **CRITICAL** |
| Stranded Inventory | ❌ | 0% | ⚠️ Important |

**Overall Coverage**: ~35% of required data

---

## 🎯 Verification Checklist

### Current State Verification:
- [x] Inventory sync works (sandbox tested)
- [x] Claims sync works (sandbox tested)
- [x] Fees sync works (sandbox tested)
- [x] Financial events ingestion works
- [ ] FBA reports are requested
- [ ] FBA reports are downloaded
- [ ] FBA reports are parsed
- [ ] Orders are fetched
- [ ] Shipments are fetched
- [ ] Returns are fetched
- [ ] Settlements are fetched
- [ ] Data is normalized
- [ ] Data is matched/linked
- [ ] Continuous sync is running

### Phase 2 Readiness:
- [ ] All required data types are being pulled
- [ ] All data is normalized into unified schema
- [ ] Background workers are continuously syncing
- [ ] System can find and match all data for claims
- [ ] Sandbox mode is fully tested
- [ ] Error handling works for all data types
- [ ] Monitoring and alerts are in place

---

## 🚀 Next Steps

1. **Immediate**: Verify current sync works in sandbox
2. **Priority 1**: Add missing data sources (Orders, Shipments, Returns, Settlements)
3. **Priority 2**: Integrate FBA reports sync
4. **Priority 3**: Implement continuous background sync
5. **Priority 4**: Build normalization layer
6. **Priority 5**: Add matching/relationship logic

---

**Last Updated**: November 12, 2025  
**Status**: ⚠️ **INCOMPLETE** - Missing critical data sources for Phase 2  
**Sandbox Ready**: ✅ Yes (with limitations)  
**Production Ready**: ❌ No (missing critical components)

