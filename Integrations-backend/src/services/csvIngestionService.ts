/**
 * CSV Ingestion Service
 * 
 * Parses uploaded CSV files, auto-detects their type, maps columns to internal schema,
 * and inserts data into the correct Supabase tables — enabling Agent 3 detection
 * without requiring SP-API access.
 * 
 * This is the "things that don't scale" bridge: Upload CSV → Schema → Detection
 */

import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// CSV Parser (adapted from mockSPAPIService.ts)
// ============================================================================

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line: string, trim: boolean = true): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                i += 2;
                continue;
            } else {
                inQuotes = !inQuotes;
                i++;
                continue;
            }
        }

        if (char === ',' && !inQuotes) {
            values.push(trim ? current.trim() : current);
            current = '';
            i++;
            continue;
        }

        current += char;
        i++;
    }

    values.push(trim ? current.trim() : current);
    return values;
}

/**
 * Parse CSV content into array of objects
 */
function parseCSV(content: string): any[] {
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return []; // Need header + at least 1 data row

    const headers = parseCSVLine(lines[0]);
    const records: any[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const record: any = {};

        headers.forEach((header, index) => {
            let value: any = values[index] !== undefined ? values[index] : null;

            // Auto-cast numbers
            if (value !== null && value !== '' && !isNaN(Number(value))) {
                value = Number(value);
            }

            record[header] = value;
        });

        records.push(record);
    }

    return records;
}

// ============================================================================
// CSV Type Detection
// ============================================================================

export type CSVType = 'orders' | 'shipments' | 'returns' | 'settlements' | 'inventory' | 'financial_events' | 'fees' | 'unknown';

/**
 * Signature headers that identify each CSV type.
 * If ANY of the headers in a signature group match, that type is detected.
 */
const CSV_TYPE_SIGNATURES: Record<CSVType, string[][]> = {
    orders: [
        ['AmazonOrderId', 'PurchaseDate'],
        ['amazon-order-id', 'purchase-date'],
        ['order_id', 'order_date'],
        ['orderId', 'purchaseDate'],
        ['Order ID', 'Purchase Date'],
    ],
    shipments: [
        ['ShipmentId', 'ShipmentDate'],
        ['shipment_id', 'shipment_date'],
        ['shipmentId', 'shipmentDate'],
        ['Shipment ID', 'Shipment Date'],
        ['ShipmentId', 'DestinationFulfillmentCenterId'],
    ],
    returns: [
        ['ReturnId', 'ReturnDate'],
        ['return_id', 'return_date'],
        ['returnId', 'returnDate'],
        ['Return ID', 'Return Date'],
        ['ReturnId', 'ReturnReason'],
    ],
    settlements: [
        ['SettlementId', 'TransactionType'],
        ['settlement_id', 'transaction_type'],
        ['settlementId', 'transactionType'],
        ['Settlement ID', 'Transaction Type'],
        ['settlement-id', 'total-amount'],
    ],
    inventory: [
        ['sellerSku', 'asin'],
        ['seller-sku', 'asin'],
        ['sku', 'fnsku'],
        ['SKU', 'ASIN'],
        ['sellerSku', 'availableQuantity'],
        ['seller-sku', 'available'],
        ['sku', 'quantity'],
    ],
    financial_events: [
        ['EventType', 'PostedDate', 'Amount'],
        ['event_type', 'posted_date', 'amount'],
        ['eventType', 'postedDate', 'amount'],
        ['AdjustmentEventId', 'PostedDate'],
        ['OriginalRemovalOrderId', 'LiquidationProceedsAmount'],
    ],
    fees: [
        ['FeeType', 'FeeAmount'],
        ['fee_type', 'fee_amount'],
        ['feeType', 'feeAmount'],
        ['FeeType', 'PostedDate'],
    ],
    unknown: [],
};

/**
 * Detect CSV type from headers
 */
function detectCSVType(headers: string[]): CSVType {
    const headerSet = new Set(headers.map(h => h.toLowerCase().replace(/[_\- ]/g, '')));

    for (const [csvType, signatures] of Object.entries(CSV_TYPE_SIGNATURES)) {
        if (csvType === 'unknown') continue;

        for (const signature of signatures) {
            const normalizedSig = signature.map(s => s.toLowerCase().replace(/[_\- ]/g, ''));
            const allMatch = normalizedSig.every(s => headerSet.has(s));

            if (allMatch) {
                return csvType as CSVType;
            }
        }
    }

    return 'unknown';
}

// ============================================================================
// Column Mapping — flexible mapping from various CSV column names → internal schema
// ============================================================================

/**
 * Get value from record using multiple possible field names (case-insensitive, dash/underscore agnostic)
 */
function getField(record: any, ...possibleNames: string[]): any {
    for (const name of possibleNames) {
        if (record[name] !== undefined && record[name] !== null && record[name] !== '') {
            return record[name];
        }
    }

    // Try case-insensitive match
    const recordKeys = Object.keys(record);
    for (const name of possibleNames) {
        const normalizedName = name.toLowerCase().replace(/[_\- ]/g, '');
        const match = recordKeys.find(k => k.toLowerCase().replace(/[_\- ]/g, '') === normalizedName);
        if (match && record[match] !== undefined && record[match] !== null && record[match] !== '') {
            return record[match];
        }
    }

    return null;
}

// ============================================================================
// Ingestion Result
// ============================================================================

export interface IngestionResult {
    success: boolean;
    csvType: CSVType;
    fileName: string;
    rowsProcessed: number;
    rowsInserted: number;
    rowsFailed: number;
    errors: string[];
    detectionTriggered: boolean;
    detectionJobId?: string;
}

export interface BatchIngestionResult {
    success: boolean;
    userId: string;
    totalFiles: number;
    results: IngestionResult[];
    detectionTriggered: boolean;
    detectionJobId?: string;
    syncId: string;
}

// ============================================================================
// CSV Ingestion Service
// ============================================================================

export class CSVIngestionService {

    /**
     * Ingest multiple CSV files for a user
     */
    async ingestFiles(
        userId: string,
        files: { buffer: Buffer; originalname: string; mimetype: string }[],
        options: {
            explicitType?: CSVType;
            triggerDetection?: boolean;
            storeId?: string;
        } = {}
    ): Promise<BatchIngestionResult> {
        const syncId = `csv_upload_${userId}_${Date.now()}`;
        const results: IngestionResult[] = [];
        const triggerDetection = options.triggerDetection !== false;

        logger.info('📂 [CSV INGESTION] Starting batch ingestion', {
            userId,
            syncId,
            fileCount: files.length,
            fileNames: files.map(f => f.originalname),
            explicitType: options.explicitType || 'auto-detect',
        });

        for (const file of files) {
            try {
                const result = await this.ingestSingleFile(userId, file, syncId, {
                    explicitType: options.explicitType,
                    storeId: options.storeId,
                });
                results.push(result);
            } catch (error: any) {
                results.push({
                    success: false,
                    csvType: options.explicitType || 'unknown',
                    fileName: file.originalname,
                    rowsProcessed: 0,
                    rowsInserted: 0,
                    rowsFailed: 0,
                    errors: [error.message],
                    detectionTriggered: false,
                });
            }
        }

        // Trigger detection after all files are imported
        let detectionJobId: string | undefined;
        const anySuccess = results.some(r => r.success && r.rowsInserted > 0);

        if (triggerDetection && anySuccess) {
            try {
                detectionJobId = await this.triggerDetection(userId, syncId);
                logger.info('🔍 [CSV INGESTION] Detection triggered after CSV import', {
                    userId,
                    syncId,
                    detectionJobId,
                });
            } catch (error: any) {
                logger.error('❌ [CSV INGESTION] Failed to trigger detection', {
                    userId,
                    syncId,
                    error: error.message,
                });
            }
        }

        const batchResult: BatchIngestionResult = {
            success: anySuccess,
            userId,
            totalFiles: files.length,
            results,
            detectionTriggered: !!detectionJobId,
            detectionJobId,
            syncId,
        };

        logger.info('📂 [CSV INGESTION] Batch ingestion complete', {
            userId,
            syncId,
            totalFiles: files.length,
            successCount: results.filter(r => r.success).length,
            totalRowsInserted: results.reduce((sum, r) => sum + r.rowsInserted, 0),
            detectionTriggered: !!detectionJobId,
        });

        return batchResult;
    }

    /**
     * Ingest a single CSV file
     */
    private async ingestSingleFile(
        userId: string,
        file: { buffer: Buffer; originalname: string; mimetype: string },
        syncId: string,
        options: { explicitType?: CSVType; storeId?: string }
    ): Promise<IngestionResult> {
        const content = file.buffer.toString('utf-8');
        const records = parseCSV(content);

        if (records.length === 0) {
            return {
                success: false,
                csvType: 'unknown',
                fileName: file.originalname,
                rowsProcessed: 0,
                rowsInserted: 0,
                rowsFailed: 0,
                errors: ['CSV file is empty or has no data rows'],
                detectionTriggered: false,
            };
        }

        // Detect CSV type
        const headers = Object.keys(records[0]);
        const csvType = options.explicitType || detectCSVType(headers);

        if (csvType === 'unknown') {
            return {
                success: false,
                csvType: 'unknown',
                fileName: file.originalname,
                rowsProcessed: records.length,
                rowsInserted: 0,
                rowsFailed: 0,
                errors: [
                    `Could not detect CSV type from headers: [${headers.slice(0, 10).join(', ')}${headers.length > 10 ? '...' : ''}]. ` +
                    `Supported types: orders, shipments, returns, settlements, inventory, financial_events, fees. ` +
                    `Try specifying the type explicitly via /api/csv-upload/ingest/:type`
                ],
                detectionTriggered: false,
            };
        }

        logger.info(`📄 [CSV INGESTION] Processing ${file.originalname} as ${csvType}`, {
            userId,
            syncId,
            csvType,
            recordCount: records.length,
            headers: headers.slice(0, 15),
        });

        // Route to appropriate ingestion handler
        const result = await this.ingestByType(userId, csvType, records, syncId, options.storeId);

        return {
            ...result,
            fileName: file.originalname,
        };
    }

    /**
     * Route to the correct ingestion handler based on CSV type
     */
    private async ingestByType(
        userId: string,
        csvType: CSVType,
        records: any[],
        syncId: string,
        storeId?: string
    ): Promise<Omit<IngestionResult, 'fileName'>> {
        switch (csvType) {
            case 'orders':
                return this.ingestOrders(userId, records, syncId, storeId);
            case 'shipments':
                return this.ingestShipments(userId, records, syncId, storeId);
            case 'returns':
                return this.ingestReturns(userId, records, syncId, storeId);
            case 'settlements':
                return this.ingestSettlements(userId, records, syncId, storeId);
            case 'inventory':
                return this.ingestInventory(userId, records, syncId, storeId);
            case 'financial_events':
                return this.ingestFinancialEvents(userId, records, syncId, storeId);
            case 'fees':
                return this.ingestFees(userId, records, syncId, storeId);
            default:
                return {
                    success: false,
                    csvType,
                    rowsProcessed: records.length,
                    rowsInserted: 0,
                    rowsFailed: 0,
                    errors: [`Unsupported CSV type: ${csvType}`],
                    detectionTriggered: false,
                };
        }
    }

    // ============================================================================
    // Type-specific ingestion handlers
    // ============================================================================

    private async ingestOrders(userId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                rows.push({
                    id: uuidv4(),
                    user_id: userId,
                    store_id: storeId || null,
                    order_id: getField(r, 'AmazonOrderId', 'amazon-order-id', 'order_id', 'orderId', 'Order ID') || `csv_order_${i}`,
                    seller_id: getField(r, 'SellerId', 'seller_id', 'sellerId') || userId,
                    marketplace_id: getField(r, 'MarketplaceId', 'marketplace_id', 'marketplaceId') || 'ATVPDKIKX0DER',
                    order_date: getField(r, 'PurchaseDate', 'purchase_date', 'purchaseDate', 'order_date', 'Order Date') || new Date().toISOString(),
                    order_status: getField(r, 'OrderStatus', 'order_status', 'orderStatus', 'Status') || 'Shipped',
                    fulfillment_channel: getField(r, 'FulfillmentChannel', 'fulfillment_channel', 'fulfillmentChannel') || 'FBA',
                    total_amount: Number(getField(r, 'OrderTotal', 'total_amount', 'totalAmount', 'Amount', 'amount')) || 0,
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    items: [],
                    quantities: {},
                    sync_id: syncId,
                    sync_timestamp: new Date().toISOString(),
                    source: 'csv_upload',
                    is_sandbox: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
            }
        }

        return this.batchUpsert('orders', rows, 'orders', errors);
    }

    private async ingestShipments(userId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                rows.push({
                    id: uuidv4(),
                    user_id: userId,
                    store_id: storeId || null,
                    shipment_id: getField(r, 'ShipmentId', 'shipment_id', 'shipmentId', 'Shipment ID') || `csv_ship_${i}`,
                    order_id: getField(r, 'AmazonOrderId', 'order_id', 'orderId') || null,
                    shipped_date: getField(r, 'ShipmentDate', 'shipment_date', 'shipmentDate', 'shipped_date') || new Date().toISOString(),
                    received_date: getField(r, 'ReceivedDate', 'received_date', 'receivedDate') || null,
                    status: getField(r, 'ShipmentStatus', 'status', 'Status') || 'RECEIVED',
                    carrier: getField(r, 'Carrier', 'carrier') || null,
                    tracking_number: getField(r, 'TrackingNumber', 'tracking_number', 'trackingNumber') || null,
                    warehouse_location: getField(r, 'DestinationFulfillmentCenterId', 'warehouse_location', 'fulfillmentCenter', 'warehouse') || null,
                    items: [],
                    shipped_quantity: Number(getField(r, 'QuantityShipped', 'shipped_quantity', 'quantityShipped')) || 0,
                    received_quantity: Number(getField(r, 'QuantityReceived', 'received_quantity', 'quantityReceived')) || 0,
                    missing_quantity: Number(getField(r, 'QuantityMissing', 'missing_quantity', 'quantityMissing')) || 0,
                    metadata: {},
                    sync_id: syncId,
                    sync_timestamp: new Date().toISOString(),
                    source: 'csv_upload',
                    is_sandbox: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
            }
        }

        return this.batchUpsert('shipments', rows, 'shipments', errors);
    }

    private async ingestReturns(userId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                rows.push({
                    id: uuidv4(),
                    user_id: userId,
                    store_id: storeId || null,
                    return_id: getField(r, 'ReturnId', 'return_id', 'returnId', 'Return ID') || `csv_return_${i}`,
                    order_id: getField(r, 'AmazonOrderId', 'order_id', 'orderId') || null,
                    reason: getField(r, 'ReturnReason', 'reason', 'Reason', 'return_reason') || 'CUSTOMER_REQUEST',
                    returned_date: getField(r, 'ReturnDate', 'return_date', 'returnDate', 'returned_date') || new Date().toISOString(),
                    status: getField(r, 'ReturnStatus', 'status', 'Status') || 'RECEIVED',
                    refund_amount: Number(getField(r, 'RefundAmount', 'refund_amount', 'refundAmount', 'Amount')) || 0,
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    items: [],
                    is_partial: false,
                    metadata: {},
                    sync_id: syncId,
                    sync_timestamp: new Date().toISOString(),
                    source: 'csv_upload',
                    is_sandbox: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
            }
        }

        return this.batchUpsert('returns', rows, 'returns', errors);
    }

    private async ingestSettlements(userId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                rows.push({
                    id: uuidv4(),
                    user_id: userId,
                    store_id: storeId || null,
                    settlement_id: getField(r, 'SettlementId', 'settlement_id', 'settlementId', 'Settlement ID') || `csv_settle_${i}`,
                    order_id: getField(r, 'AmazonOrderId', 'order_id', 'orderId') || null,
                    transaction_type: getField(r, 'TransactionType', 'transaction_type', 'transactionType', 'type') || 'Order',
                    amount: Number(getField(r, 'Amount', 'amount', 'TotalAmount', 'total_amount')) || 0,
                    fees: Number(getField(r, 'Fees', 'fees', 'TotalFees', 'total_fees')) || 0,
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    settlement_date: getField(r, 'PostedDate', 'settlement_date', 'posted_date', 'postedDate', 'SettlementDate') || new Date().toISOString(),
                    fee_breakdown: {},
                    metadata: {},
                    sync_id: syncId,
                    sync_timestamp: new Date().toISOString(),
                    source: 'csv_upload',
                    is_sandbox: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
            }
        }

        return this.batchUpsert('settlements', rows, 'settlements', errors);
    }

    private async ingestInventory(userId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                rows.push({
                    id: uuidv4(),
                    user_id: userId,
                    store_id: storeId || null,
                    sku: getField(r, 'sellerSku', 'seller-sku', 'sku', 'SKU', 'seller_sku') || `csv_sku_${i}`,
                    asin: getField(r, 'asin', 'ASIN') || null,
                    fnsku: getField(r, 'fnSku', 'fnsku', 'FNSKU', 'fn_sku') || null,
                    product_name: getField(r, 'productName', 'product_name', 'title', 'Title', 'ProductName') || null,
                    condition_type: getField(r, 'condition', 'Condition', 'condition_type') || 'New',
                    quantity_available: Number(getField(r, 'availableQuantity', 'available', 'quantity_available', 'quantity', 'Quantity')) || 0,
                    quantity_reserved: Number(getField(r, 'reservedQuantity', 'reserved', 'quantity_reserved')) || 0,
                    quantity_inbound: Number(getField(r, 'inboundQuantity', 'inbound', 'quantity_inbound')) || 0,
                    price: Number(getField(r, 'price', 'Price', 'yourPrice', 'your_price')) || 0,
                    dimensions: {
                        damaged: Number(getField(r, 'damagedQuantity', 'damaged', 'quantity_damaged')) || 0,
                        unfulfillable: Number(getField(r, 'unfulfillableQuantity', 'unfulfillable', 'quantity_unfulfillable')) || 0,
                    },
                    sync_id: syncId,
                    sync_timestamp: new Date().toISOString(),
                    source: 'csv_upload',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
            }
        }

        return this.batchUpsert('inventory_items', rows, 'inventory', errors);
    }

    private async ingestFinancialEvents(userId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                rows.push({
                    id: uuidv4(),
                    seller_id: userId,
                    store_id: storeId || null,
                    event_type: getField(r, 'EventType', 'event_type', 'eventType', 'type', 'Type') || 'adjustment',
                    amount: Number(getField(r, 'Amount', 'amount', 'AdjustmentAmount', 'LiquidationProceedsAmount')) || 0,
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    event_date: getField(r, 'PostedDate', 'event_date', 'postedDate', 'posted_date', 'date', 'Date') || new Date().toISOString(),
                    amazon_order_id: getField(r, 'AmazonOrderId', 'amazon_order_id', 'orderId', 'order_id') || null,
                    sku: getField(r, 'SellerSKU', 'sku', 'SKU', 'seller_sku') || null,
                    asin: getField(r, 'ASIN', 'asin') || null,
                    description: getField(r, 'Description', 'description', 'AdjustmentType') || null,
                    raw_payload: r,
                    sync_id: syncId,
                    source: 'csv_upload',
                    created_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
            }
        }

        return this.batchUpsert('financial_events', rows, 'financial_events', errors);
    }

    private async ingestFees(userId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        // Fees are stored as financial_events with event_type = 'fee'
        const errors: string[] = [];
        const rows: any[] = [];

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                rows.push({
                    id: uuidv4(),
                    seller_id: userId,
                    store_id: storeId || null,
                    event_type: 'fee',
                    amount: Number(getField(r, 'FeeAmount', 'fee_amount', 'feeAmount', 'Amount', 'amount')) || 0,
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    event_date: getField(r, 'PostedDate', 'event_date', 'postedDate', 'posted_date', 'date') || new Date().toISOString(),
                    amazon_order_id: getField(r, 'AmazonOrderId', 'amazon_order_id', 'orderId', 'order_id') || null,
                    sku: getField(r, 'SellerSKU', 'sku', 'SKU', 'seller_sku') || null,
                    asin: getField(r, 'ASIN', 'asin') || null,
                    description: getField(r, 'FeeType', 'fee_type', 'feeType', 'Description') || 'SERVICE_FEE',
                    raw_payload: r,
                    sync_id: syncId,
                    source: 'csv_upload',
                    created_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
            }
        }

        return this.batchUpsert('financial_events', rows, 'fees', errors);
    }

    // ============================================================================
    // Database helpers
    // ============================================================================

    /**
     * Batch upsert rows into a Supabase table (in chunks of 500 to avoid API limits)
     */
    private async batchUpsert(
        table: string,
        rows: any[],
        csvType: string,
        accumulatedErrors: string[]
    ): Promise<Omit<IngestionResult, 'fileName'>> {
        let inserted = 0;
        let failed = 0;
        const BATCH_SIZE = 500;

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);

            try {
                const { data, error } = await supabaseAdmin
                    .from(table)
                    .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });

                if (error) {
                    logger.error(`❌ [CSV INGESTION] Batch insert failed for ${table}`, {
                        error: error.message,
                        code: error.code,
                        batchStart: i,
                        batchSize: batch.length,
                    });
                    accumulatedErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
                    failed += batch.length;
                } else {
                    inserted += batch.length;
                }
            } catch (error: any) {
                accumulatedErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
                failed += batch.length;
            }
        }

        logger.info(`✅ [CSV INGESTION] ${csvType}: ${inserted} rows inserted, ${failed} failed`, {
            table,
            csvType,
            inserted,
            failed,
            total: rows.length,
        });

        return {
            success: inserted > 0,
            csvType: csvType as CSVType,
            rowsProcessed: rows.length,
            rowsInserted: inserted,
            rowsFailed: failed,
            errors: accumulatedErrors,
            detectionTriggered: false,
        };
    }

    // ============================================================================
    // Detection Trigger
    // ============================================================================

    /**
     * Trigger Agent 3 detection pipeline after CSV data is ingested
     */
    private async triggerDetection(userId: string, syncId: string): Promise<string> {
        const jobId = `csv_detection_${userId}_${Date.now()}`;

        try {
            // Try EnhancedDetectionService first (runs all 26 algorithms)
            const { EnhancedDetectionService } = await import('./enhancedDetectionService');
            const enhancedService = new EnhancedDetectionService();

            const result = await enhancedService.triggerDetectionPipeline(
                userId,
                syncId,
                'csv_upload',
                { source: 'csv_upload', syncId }
            );

            logger.info('🔍 [CSV INGESTION] Enhanced detection pipeline triggered', {
                userId,
                syncId,
                jobId: result.jobId,
                detectionsFound: result.detectionsFound,
                estimatedRecovery: result.estimatedRecovery,
            });

            return result.jobId;
        } catch (error: any) {
            logger.warn('⚠️ [CSV INGESTION] Enhanced detection failed, trying basic detection', {
                userId,
                syncId,
                error: error.message,
            });

            // Fallback: try basic DetectionService
            try {
                const detectionService = (await import('./detectionService')).default;
                await detectionService.enqueueDetectionJob({
                    seller_id: userId,
                    sync_id: syncId,
                    timestamp: new Date().toISOString(),
                });

                return jobId;
            } catch (fallbackError: any) {
                logger.error('❌ [CSV INGESTION] Both detection services failed', {
                    userId,
                    syncId,
                    enhancedError: error.message,
                    basicError: fallbackError.message,
                });
                throw fallbackError;
            }
        }
    }

    // ============================================================================
    // Supported Types Info
    // ============================================================================

    /**
     * Get info about supported CSV types and their expected columns
     */
    getSupportedTypes(): {
        type: string;
        description: string;
        targetTable: string;
        exampleHeaders: string[];
    }[] {
        return [
            {
                type: 'orders',
                description: 'Amazon order data (Seller Central > Reports > Orders)',
                targetTable: 'orders',
                exampleHeaders: ['AmazonOrderId', 'PurchaseDate', 'OrderStatus', 'OrderTotal', 'FulfillmentChannel', 'CurrencyCode'],
            },
            {
                type: 'shipments',
                description: 'FBA inbound shipment data (Seller Central > Inventory > Shipments)',
                targetTable: 'shipments',
                exampleHeaders: ['ShipmentId', 'ShipmentDate', 'DestinationFulfillmentCenterId', 'ShipmentStatus', 'QuantityShipped', 'QuantityReceived'],
            },
            {
                type: 'returns',
                description: 'Customer return data (Seller Central > Reports > Returns)',
                targetTable: 'returns',
                exampleHeaders: ['ReturnId', 'ReturnDate', 'AmazonOrderId', 'ReturnReason', 'RefundAmount', 'ReturnStatus'],
            },
            {
                type: 'settlements',
                description: 'Settlement / payout reports (Seller Central > Reports > Payments)',
                targetTable: 'settlements',
                exampleHeaders: ['SettlementId', 'TransactionType', 'Amount', 'Fees', 'PostedDate', 'CurrencyCode'],
            },
            {
                type: 'inventory',
                description: 'FBA inventory data (Seller Central > Inventory > Manage FBA Inventory)',
                targetTable: 'inventory_items',
                exampleHeaders: ['sellerSku', 'asin', 'fnSku', 'availableQuantity', 'reservedQuantity', 'price'],
            },
            {
                type: 'financial_events',
                description: 'Financial events (adjustments, liquidations, etc.)',
                targetTable: 'financial_events',
                exampleHeaders: ['EventType', 'PostedDate', 'Amount', 'AmazonOrderId', 'CurrencyCode'],
            },
            {
                type: 'fees',
                description: 'FBA fee data (fulfillment fees, referral fees, storage fees)',
                targetTable: 'financial_events',
                exampleHeaders: ['FeeType', 'FeeAmount', 'PostedDate', 'SellerSKU', 'ASIN', 'AmazonOrderId'],
            },
        ];
    }
}

// Singleton export
export const csvIngestionService = new CSVIngestionService();
export default csvIngestionService;
