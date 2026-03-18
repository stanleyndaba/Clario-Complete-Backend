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
import crypto from 'crypto';

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
    const lines = content
        .split(/\r?\n/)
        .map(line => line.replace(/^\uFEFF/, '').trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
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

export type CSVType = 'orders' | 'shipments' | 'returns' | 'settlements' | 'inventory' | 'financial_events' | 'fees' | 'transfers' | 'unknown';

/**
 * Signature headers that identify each CSV type.
 * If ANY of the headers in a signature group match, that type is detected.
 */
const CSV_TYPE_SIGNATURES: Record<CSVType, string[][]> = {
    orders: [
        ['AmazonOrderId', 'PurchaseDate'],
        ['amazon-order-id', 'purchase-date'],
        ['order_id', 'order_date'],
        ['order_id', 'purchase_date'],
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
        ['FNSKU', 'ASIN', 'Event Type'],
        ['FNSKU', 'ASIN', 'Disposition'],
        ['FNSKU', 'MSKU', 'Quantity'],
        ['Date', 'FNSKU', 'ASIN', 'MSKU'],
        ['fnsku', 'asin', 'event type'],
        ['fnsku', 'disposition', 'fulfillment center'],
    ],
    financial_events: [
        ['EventType', 'PostedDate', 'Amount', 'Description'],
        ['event_type', 'posted_date', 'amount'],
        ['event_type', 'event_date', 'amount'],
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
    transfers: [
        ['transfer_id', 'sku', 'quantity_sent', 'quantity_received', 'transfer_date'],
        ['TransferId', 'sku', 'QuantitySent', 'QuantityReceived', 'TransferDate'],
        ['transfer_id', 'from_fc', 'to_fc'],
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
 * Robustly parse a numeric amount from CSV data.
 * Strips currency symbols ($, €, £), commas, whitespace, and handles negatives like ($145.00)
 */
function parseAmount(raw: any): number {
    if (raw === null || raw === undefined || raw === '') return 0;
    if (typeof raw === 'number') return raw;
    // Strip everything except digits, dots, minuses
    const cleaned = String(raw).replace(/[^0-9.\-]/g, '');
    const parsed = parseFloat(cleaned);
    // If original had parentheses like ($145.00), treat as negative
    if (String(raw).includes('(') && parsed > 0) return -parsed;
    return isNaN(parsed) ? 0 : parsed;
}

/**
 * Normalize event type values from CSV to database-compatible values.
 * Maps common synonyms and ensures lowercase.
 */
function normalizeEventType(raw: string | null): string {
    if (!raw) return 'adjustment';
    const lower = raw.toLowerCase().trim();
    // Map common CSV values to DB-accepted values
    const mapping: Record<string, string> = {
        'order': 'order',
        'order payment': 'order',
        'fee': 'fee',
        'fba referral fee': 'fee',
        'refund': 'return',
        'customer return refund': 'return',
        'return': 'return',
        'reimbursement': 'reimbursement',
        'shipment': 'shipment',
        'adjustment': 'adjustment',
        'fbaliquidationevent': 'adjustment',
        'adjustmentevent': 'adjustment',
    };
    return mapping[lower] || lower;
}

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
    rowsSkipped: number;
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

const DISABLED_TYPES = new Set<CSVType>([]);

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
            tenantId?: string;
        } = {}
    ): Promise<BatchIngestionResult> {
        if (!options.tenantId) {
            throw new Error('tenantId is required for CSV ingestion');
        }

        const syncId = `csv_${Date.now()}`;
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
                    tenantId: options.tenantId,
                });
                results.push(result);
            } catch (error: any) {
                results.push({
                    success: false,
                    csvType: options.explicitType || 'unknown',
                    fileName: file.originalname,
                    rowsProcessed: 0,
                    rowsInserted: 0,
                    rowsSkipped: 0,
                    rowsFailed: 0,
                    errors: [error.message],
                    detectionTriggered: false,
                });
            }
        }

        // Trigger detection after all files are imported
        let detectionJobId: string | undefined;
        const anySuccess = results.some(r => r.success && r.rowsInserted > 0);
        const allSucceeded = results.length > 0 && results.every(r => r.success);

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
            success: allSucceeded && anySuccess,
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

    private normalizeHeader(value: string): string {
        return value.toLowerCase().replace(/[_\- ]/g, '');
    }

    private hasRequiredHeaders(csvType: CSVType, headers: string[]): { ok: boolean; missing: string[] } {
        if (csvType === 'unknown') {
            return { ok: false, missing: ['unknown CSV type'] };
        }

        const signatures = CSV_TYPE_SIGNATURES[csvType] || [];
        if (signatures.length === 0) {
            return { ok: true, missing: [] };
        }

        const set = new Set(headers.map(h => this.normalizeHeader(h)));
        const missingBySignature = signatures.map(signature =>
            signature.filter(h => !set.has(this.normalizeHeader(h)))
        );
        const matchedSignature = missingBySignature.find(missing => missing.length === 0);

        if (matchedSignature) {
            return { ok: true, missing: [] };
        }

        const bestCandidate = missingBySignature.sort((a, b) => a.length - b.length)[0] || [];
        return { ok: false, missing: bestCandidate };
    }

    private async isDuplicateUpload(
        userId: string,
        tenantId: string,
        csvType: CSVType,
        fileName: string,
        content: Buffer
    ): Promise<boolean> {
        const fileHash = crypto.createHash('sha256').update(content).digest('hex');

        const { data, error } = await supabaseAdmin
            .from('csv_ingestion_runs')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('user_id', userId)
            .eq('csv_type', csvType)
            .eq('file_hash', fileHash)
            .maybeSingle();

        if (error?.code === '42P01') {
            logger.warn('CSV duplicate tracking table is not deployed; falling back to row-level idempotency only', {
                table: 'csv_ingestion_runs',
                tenantId,
                userId,
                csvType,
            });
            return false;
        }

        if (error && error.code !== 'PGRST116') {
            throw new Error(`Failed duplicate check: ${error.message}`);
        }

        if (data?.id) {
            return true;
        }

        const { error: insertError } = await supabaseAdmin
            .from('csv_ingestion_runs')
            .insert({
                tenant_id: tenantId,
                user_id: userId,
                csv_type: csvType,
                file_name: fileName,
                file_hash: fileHash,
                created_at: new Date().toISOString(),
            });

        if (insertError?.code === '42P01') {
            logger.warn('CSV duplicate tracking table is not deployed; file-level duplicate registration skipped', {
                table: 'csv_ingestion_runs',
                tenantId,
                userId,
                csvType,
            });
            return false;
        }

        if (insertError && insertError.code !== '23505') {
            throw new Error(`Failed duplicate registration: ${insertError.message}`);
        }

        return insertError?.code === '23505';
    }

    /**
     * Ingest a single CSV file
     */
    private async ingestSingleFile(
        userId: string,
        file: { buffer: Buffer; originalname: string; mimetype: string },
        syncId: string,
        options: { explicitType?: CSVType; storeId?: string; tenantId?: string }
    ): Promise<IngestionResult> {
        if (!options.tenantId) {
            throw new Error('tenantId is required for CSV ingestion');
        }

        const content = file.buffer.toString('utf-8');
        const records = parseCSV(content);

        if (records.length === 0) {
            return {
                success: false,
                csvType: 'unknown',
                fileName: file.originalname,
                rowsProcessed: 0,
                rowsInserted: 0,
                rowsSkipped: 0,
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
                rowsSkipped: 0,
                rowsFailed: 0,
                errors: [
                    `Could not detect CSV type from headers: [${headers.slice(0, 10).join(', ')}${headers.length > 10 ? '...' : ''}]. ` +
                    `Supported types: orders, shipments, returns, settlements, inventory, financial_events, fees, transfers. ` +
                    `Try specifying the type explicitly via /api/csv-upload/ingest/:type`
                ],
                detectionTriggered: false,
            };
        }

        if (DISABLED_TYPES.has(csvType)) {
            return {
                success: false,
                csvType,
                fileName: file.originalname,
                rowsProcessed: records.length,
                rowsInserted: 0,
                rowsSkipped: records.length,
                rowsFailed: records.length,
                errors: [`CSV type "${csvType}" is temporarily disabled.`],
                detectionTriggered: false,
            };
        }

        const headerValidation = this.hasRequiredHeaders(csvType, headers);
        if (!headerValidation.ok) {
            return {
                success: false,
                csvType,
                fileName: file.originalname,
                rowsProcessed: records.length,
                rowsInserted: 0,
                rowsSkipped: records.length,
                rowsFailed: records.length,
                errors: [`Missing required headers for ${csvType}: ${headerValidation.missing.join(', ')}`],
                detectionTriggered: false,
            };
        }

        const duplicate = await this.isDuplicateUpload(userId, options.tenantId, csvType, file.originalname, file.buffer);
        if (duplicate) {
            return {
                success: true,
                csvType,
                fileName: file.originalname,
                rowsProcessed: records.length,
                rowsInserted: 0,
                rowsSkipped: records.length,
                rowsFailed: 0,
                errors: ['Duplicate file upload detected; ingestion skipped.'],
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
        const result = await this.ingestByType(userId, options.tenantId, csvType, records, syncId, options.storeId);

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
        tenantId: string,
        csvType: CSVType,
        records: any[],
        syncId: string,
        storeId?: string
    ): Promise<Omit<IngestionResult, 'fileName'>> {
        switch (csvType) {
            case 'orders':
                return this.ingestOrders(userId, tenantId, records, syncId, storeId);
            case 'shipments':
                return this.ingestShipments(userId, tenantId, records, syncId, storeId);
            case 'returns':
                return this.ingestReturns(userId, tenantId, records, syncId, storeId);
            case 'settlements':
                return this.ingestSettlements(userId, tenantId, records, syncId, storeId);
            case 'inventory':
                return this.ingestInventory(userId, tenantId, records, syncId, storeId);
            case 'financial_events':
                return this.ingestFinancialEvents(userId, tenantId, records, syncId, storeId);
            case 'fees':
                return this.ingestFees(userId, tenantId, records, syncId, storeId);
            case 'transfers':
                return this.ingestTransfers(userId, tenantId, records, syncId);
            default:
                return {
                    success: false,
                    csvType,
                    rowsProcessed: records.length,
                    rowsInserted: 0,
                    rowsSkipped: records.length,
                    rowsFailed: records.length,
                    errors: [`Unsupported CSV type: ${csvType}`],
                    detectionTriggered: false,
                };
        }
    }

    // ============================================================================
    // Type-specific ingestion handlers
    // ============================================================================

    private async ingestOrders(userId: string, tenantId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];
        let skipped = 0;

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const orderId = getField(r, 'AmazonOrderId', 'amazon-order-id', 'order_id', 'orderId', 'Order ID');
                const orderDate = getField(r, 'PurchaseDate', 'purchase_date', 'purchaseDate', 'order_date', 'Order Date');

                if (!orderId || !orderDate) {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing required fields (order_id/order_date)`);
                    continue;
                }

                rows.push({
                    id: uuidv4(),
                    tenant_id: tenantId,
                    user_id: userId,
                    store_id: storeId || null,
                    order_id: orderId,
                    seller_id: getField(r, 'SellerId', 'seller_id', 'sellerId') || userId,
                    marketplace_id: getField(r, 'MarketplaceId', 'marketplace_id', 'marketplaceId') || 'ATVPDKIKX0DER',
                    order_date: orderDate,
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
                skipped++;
            }
        }

        return this.batchUpsert('orders', rows, 'orders', errors, skipped);
    }

    private async ingestShipments(userId: string, tenantId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];
        let skipped = 0;

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const shipmentId = getField(r, 'ShipmentId', 'shipment_id', 'shipmentId', 'Shipment ID');
                const shippedDate = getField(r, 'ShipmentDate', 'shipment_date', 'shipmentDate', 'shipped_date', 'Date');

                if (!shipmentId || !shippedDate) {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing required fields (shipment_id/shipped_date)`);
                    continue;
                }

                rows.push({
                    id: uuidv4(),
                    tenant_id: tenantId,
                    user_id: userId,
                    store_id: storeId || null,
                    shipment_id: shipmentId,
                    order_id: getField(r, 'AmazonOrderId', 'order_id', 'orderId') || null,
                    shipped_date: shippedDate,
                    received_date: getField(r, 'ReceivedDate', 'received_date', 'receivedDate') || null,
                    status: getField(r, 'ShipmentStatus', 'status', 'Status') || 'RECEIVED',
                    carrier: getField(r, 'Carrier', 'carrier') || null,
                    tracking_number: getField(r, 'TrackingNumber', 'tracking_number', 'trackingNumber') || null,
                    warehouse_location: getField(r, 'DestinationFulfillmentCenterId', 'warehouse_location', 'fulfillmentCenter', 'warehouse', 'FC Location') || null,
                    items: [],
                    shipped_quantity: Number(getField(r, 'QuantityShipped', 'shipped_quantity', 'quantityShipped', 'Units Shipped')) || 0,
                    received_quantity: Number(getField(r, 'QuantityReceived', 'received_quantity', 'quantityReceived', 'Units Received')) || 0,
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
                skipped++;
            }
        }

        return this.batchUpsert('shipments', rows, 'shipments', errors, skipped);
    }

    private async ingestReturns(userId: string, tenantId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];
        let skipped = 0;

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const returnId = getField(r, 'ReturnId', 'return_id', 'returnId', 'Return ID');
                const returnDate = getField(r, 'ReturnDate', 'return_date', 'returnDate', 'returned_date');

                if (!returnId || !returnDate) {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing required fields (return_id/returned_date)`);
                    continue;
                }

                rows.push({
                    id: uuidv4(),
                    tenant_id: tenantId,
                    user_id: userId,
                    store_id: storeId || null,
                    return_id: returnId,
                    order_id: getField(r, 'AmazonOrderId', 'order_id', 'orderId') || null,
                    reason: getField(r, 'ReturnReason', 'reason', 'Reason', 'return_reason') || 'CUSTOMER_REQUEST',
                    returned_date: returnDate,
                    status: getField(r, 'ReturnStatus', 'status', 'Status') || 'RECEIVED',
                    refund_amount: parseAmount(getField(r, 'RefundAmount', 'refund_amount', 'refundAmount', 'Amount')),
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    items: [{
                        sku: getField(r, 'sku', 'SKU', 'sellerSku', 'seller_sku') || null,
                        asin: getField(r, 'asin', 'ASIN') || null,
                        quantity: Number(getField(r, 'quantity', 'Quantity')) || 1,
                    }],
                    is_partial: false,
                    metadata: {
                        disposition: getField(r, 'disposition', 'Disposition') || null,
                        condition_notes: getField(r, 'condition_notes', 'ConditionNotes', 'conditionNotes') || null,
                    },
                    sync_id: syncId,
                    sync_timestamp: new Date().toISOString(),
                    source: 'csv_upload',
                    is_sandbox: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
                skipped++;
            }
        }

        return this.batchUpsert('returns', rows, 'returns', errors, skipped);
    }

    private async ingestSettlements(userId: string, tenantId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];
        let skipped = 0;

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const settlementId = getField(r, 'SettlementId', 'settlement_id', 'settlementId', 'Settlement ID');
                const settlementDate = getField(r, 'PostedDate', 'settlement_date', 'posted_date', 'postedDate', 'SettlementDate');
                const transactionType = getField(r, 'TransactionType', 'transaction_type', 'transactionType', 'type', 'EventType', 'event_type');

                if (!settlementId || !settlementDate || !transactionType) {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing required fields (settlement_id/transaction_type/settlement_date)`);
                    continue;
                }

                rows.push({
                    id: uuidv4(),
                    tenant_id: tenantId,
                    user_id: userId,
                    store_id: storeId || null,
                    settlement_id: settlementId,
                    order_id: getField(r, 'AmazonOrderId', 'order_id', 'orderId') || null,
                    transaction_type: transactionType,
                    amount: parseAmount(getField(r, 'Amount', 'amount', 'TotalAmount', 'total_amount')),
                    fees: parseAmount(getField(r, 'Fees', 'fees', 'TotalFees', 'total_fees')),
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    settlement_date: settlementDate,
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
                skipped++;
            }
        }

        return this.batchUpsert('settlements', rows, 'settlements', errors, skipped);
    }

    private async ingestInventory(userId: string, tenantId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];
        let skipped = 0;

        // Check if this CSV has ledger-style columns (Event Type, Reference ID, Disposition, etc.)
        const hasLedgerColumns = records.length > 0 && (
            getField(records[0], 'Event Type', 'event_type', 'EventType') !== null ||
            getField(records[0], 'Disposition', 'disposition') !== null ||
            getField(records[0], 'Reference ID', 'reference_id', 'ReferenceId') !== null ||
            getField(records[0], 'event_id', 'EventId', 'eventId') !== null
        );

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const sku = getField(r, 'sellerSku', 'seller-sku', 'sku', 'SKU', 'seller_sku', 'MSKU', 'msku');
                if (!sku) {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing required field (sku)`);
                    continue;
                }

                rows.push({
                    id: uuidv4(),
                    tenant_id: tenantId,
                    user_id: userId,
                    store_id: storeId || null,
                    sku,
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
                skipped++;
            }
        }

        const result = await this.batchUpsert('inventory_items', rows, 'inventory', errors, skipped);

        // If this CSV has ledger-style columns, ALSO write to inventory_ledger_events
        // so the Whale Hunter detection algorithm can pick them up
        if (hasLedgerColumns && result.rowsInserted > 0) {
            await this.ingestInventoryLedgerEvents(userId, tenantId, records, syncId, storeId);
        }

        return result;
    }

    /**
     * Write inventory ledger events to the dedicated inventory_ledger_events table.
     * This bridges CSV uploads to the Whale Hunter detection algorithm.
     * Maps CSV "Event Type" values to detection-compatible event types.
     */
    private async ingestInventoryLedgerEvents(
        userId: string,
        tenantId: string,
        records: any[],
        syncId: string,
        storeId?: string
    ): Promise<void> {
        const EVENT_TYPE_MAP: Record<string, { eventType: string; direction: 'in' | 'out' }> = {
            'receipts': { eventType: 'Receipt', direction: 'in' },
            'receipt': { eventType: 'Receipt', direction: 'in' },
            'receive': { eventType: 'Receipt', direction: 'in' },
            'shipments': { eventType: 'Shipment', direction: 'out' },
            'shipment': { eventType: 'Shipment', direction: 'out' },
            'customer shipments': { eventType: 'Shipment', direction: 'out' },
            'adjustments': { eventType: 'Adjustment', direction: 'in' },
            'adjustment': { eventType: 'Adjustment', direction: 'in' },
            'returns': { eventType: 'Return', direction: 'in' },
            'return': { eventType: 'Return', direction: 'in' },
            'customer returns': { eventType: 'Return', direction: 'in' },
            'removals': { eventType: 'Removal', direction: 'out' },
            'removal': { eventType: 'Removal', direction: 'out' },
            'disposals': { eventType: 'Disposal', direction: 'out' },
            'disposal': { eventType: 'Disposal', direction: 'out' },
            'transfers': { eventType: 'Transfer', direction: 'out' }, // direction determined by quantity sign
            'transfer': { eventType: 'Transfer', direction: 'out' },
            'damaged': { eventType: 'Adjustment', direction: 'out' },
            'damaged inventory': { eventType: 'Adjustment', direction: 'out' },
            'misplaced': { eventType: 'Adjustment', direction: 'out' },
            'found': { eventType: 'Adjustment', direction: 'in' },
            'vendor returns': { eventType: 'Removal', direction: 'out' },
        };

        const ledgerRows: any[] = [];
        const errors: string[] = [];

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const rawEventType = getField(r, 'Event Type', 'event_type', 'EventType', 'type') || 'Adjustment';
                const rawQuantity = Number(getField(r, 'Quantity', 'quantity', 'qty') || 0);
                const fnsku = getField(r, 'FNSKU', 'fnsku', 'fn_sku', 'fnSku', 'sku', 'SKU');

                if (!fnsku) {
                    errors.push(`Row ${i + 1}: Missing FNSKU, skipping ledger event`);
                    continue;
                }

                // Map the CSV event type to our internal type
                const mapped = EVENT_TYPE_MAP[rawEventType.toLowerCase()] || { eventType: 'Adjustment', direction: rawQuantity >= 0 ? 'in' : 'out' };

                // For transfers: quantity sign determines direction
                let direction = mapped.direction;
                if (mapped.eventType === 'Transfer') {
                    direction = rawQuantity >= 0 ? 'in' : 'out';
                }

                const eventDate = getField(r, 'Date', 'date', 'event_date', 'EventDate', 'PostedDate');

                ledgerRows.push({
                    id: uuidv4(),
                    user_id: userId,
                    tenant_id: tenantId,
                    store_id: storeId || null,
                    sync_id: syncId,
                    fnsku,
                    asin: getField(r, 'ASIN', 'asin') || null,
                    sku: getField(r, 'MSKU', 'msku', 'SKU', 'sku', 'sellerSku', 'seller-sku') || null,
                    product_name: getField(r, 'Title', 'title', 'productName', 'product_name', 'ProductName') || null,
                    event_type: mapped.eventType,
                    quantity: Math.abs(rawQuantity),
                    quantity_direction: direction,
                    warehouse_balance: null, // Will be calculated per-FNSKU after all events
                    event_date: eventDate ? new Date(eventDate).toISOString() : new Date().toISOString(),
                    fulfillment_center: getField(r, 'Fulfillment Center', 'fulfillment_center', 'FulfillmentCenter', 'FC', 'warehouse') || null,
                    disposition: getField(r, 'Disposition', 'disposition') || null,
                    reason: getField(r, 'Reason', 'reason') || null,
                    reference_id: getField(r, 'Reference ID', 'reference_id', 'ReferenceId', 'ref_id', 'event_id', 'EventId', 'eventId') || null,
                    unit_cost: null,
                    average_sales_price: null,
                    country: getField(r, 'Country', 'country') || 'US',
                    raw_payload: r,
                    source: 'csv_upload',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Ledger Row ${i + 1}: ${error.message}`);
            }
        }

        if (ledgerRows.length === 0) {
            logger.warn('📊 [CSV INGESTION] No inventory ledger events to write', { userId, syncId });
            return;
        }

        // Calculate ending warehouse balance per FNSKU (running tally)
        // Group by FNSKU, then compute balance = sum of (in quantities) - sum of (out quantities)
        const balanceByFnsku: Record<string, number> = {};
        for (const row of ledgerRows) {
            if (!balanceByFnsku[row.fnsku]) balanceByFnsku[row.fnsku] = 0;
            if (row.quantity_direction === 'in') {
                balanceByFnsku[row.fnsku] += row.quantity;
            } else {
                balanceByFnsku[row.fnsku] -= row.quantity;
            }
        }

        // Add a Snapshot event for each FNSKU with the calculated ending balance
        // This gives the Whale Hunter the endingWarehouseBalance it needs
        const snapshotDate = new Date().toISOString();
        for (const [fnsku, balance] of Object.entries(balanceByFnsku)) {
            // Find the last event for this FNSKU to get metadata
            const lastEvent = [...ledgerRows].reverse().find(r => r.fnsku === fnsku);
            ledgerRows.push({
                id: uuidv4(),
                user_id: userId,
                tenant_id: tenantId,
                store_id: storeId || null,
                sync_id: syncId,
                fnsku,
                asin: lastEvent?.asin || null,
                sku: lastEvent?.sku || null,
                product_name: lastEvent?.product_name || null,
                event_type: 'Snapshot',
                quantity: Math.max(0, balance),
                quantity_direction: 'in',
                warehouse_balance: Math.max(0, balance),
                event_date: snapshotDate,
                fulfillment_center: lastEvent?.fulfillment_center || null,
                disposition: 'SELLABLE',
                reason: 'CSV ledger snapshot',
                reference_id: syncId,
                unit_cost: null,
                average_sales_price: null,
                country: lastEvent?.country || 'US',
                raw_payload: { type: 'calculated_snapshot', balance, fnsku },
                source: 'csv_upload',
                created_at: snapshotDate,
                updated_at: snapshotDate,
            });
        }

        // Insert into inventory_ledger_events table
        const result = await this.batchUpsert('inventory_ledger_events', ledgerRows, 'inventory_ledger', [], 0);

        logger.info('📊 [CSV INGESTION] Inventory ledger events written', {
            userId,
            syncId,
            ledgerEventsInserted: result.rowsInserted,
            snapshotsCreated: Object.keys(balanceByFnsku).length,
            uniqueFnskus: Object.keys(balanceByFnsku).length,
            errors: errors.length > 0 ? errors : undefined,
        });
    }

    private async ingestFinancialEvents(userId: string, tenantId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];
        let skipped = 0;

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const rawEventType = getField(r, 'EventType', 'event_type', 'eventType', 'type', 'Type');
                const rawAmount = getField(r, 'Amount', 'amount', 'AdjustmentAmount', 'LiquidationProceedsAmount');
                const eventDate = getField(r, 'PostedDate', 'event_date', 'postedDate', 'posted_date', 'date', 'Date');
                if (!rawEventType || eventDate === null || eventDate === undefined || eventDate === '') {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing required fields (event_type/event_date)`);
                    continue;
                }
                const feeType = getField(r, 'fee_type', 'FeeType', 'feeType');
                rows.push({
                    seller_id: userId,
                    tenant_id: tenantId,
                    store_id: storeId || null,
                    sync_id: syncId,
                    source: 'csv_upload',
                    event_type: feeType ? 'fee' : normalizeEventType(rawEventType),
                    amount: parseAmount(rawAmount),
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    event_date: eventDate,
                    amazon_order_id: getField(r, 'AmazonOrderId', 'amazon_order_id', 'orderId', 'order_id', 'OrderId') || null,
                    amazon_sku: getField(r, 'SellerSKU', 'sku', 'SKU', 'seller_sku') || null,
                    sku: getField(r, 'SellerSKU', 'sku', 'SKU', 'seller_sku') || null,
                    description: getField(r, 'Description', 'description', 'AdjustmentType', 'fee_type', 'FeeType') || null,
                    raw_payload: r,
                    created_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
                skipped++;
            }
        }

        return this.batchUpsert('financial_events', rows, 'financial_events', errors, skipped);
    }

    private async ingestFees(userId: string, tenantId: string, records: any[], syncId: string, storeId?: string): Promise<Omit<IngestionResult, 'fileName'>> {
        // Fees are stored as financial_events with event_type = 'fee'
        const errors: string[] = [];
        const rows: any[] = [];
        let skipped = 0;

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const feeAmount = getField(r, 'FeeAmount', 'fee_amount', 'feeAmount', 'Amount', 'amount');
                const eventDate = getField(r, 'PostedDate', 'event_date', 'postedDate', 'posted_date', 'date');
                if (feeAmount === null || feeAmount === undefined || feeAmount === '' || !eventDate) {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing required fields (fee_amount/event_date)`);
                    continue;
                }
                rows.push({
                    id: uuidv4(),
                    seller_id: userId,
                    tenant_id: tenantId,
                    store_id: storeId || null,
                    event_type: 'fee',
                    amount: Number(feeAmount) || 0,
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    event_date: eventDate,
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
                skipped++;
            }
        }

        return this.batchUpsert('financial_events', rows, 'fees', errors, skipped);
    }

    private async ingestTransfers(userId: string, tenantId: string, records: any[], syncId: string): Promise<Omit<IngestionResult, 'fileName'>> {
        const errors: string[] = [];
        const rows: any[] = [];
        let skipped = 0;

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const transferId = getField(r, 'transfer_id', 'TransferId', 'transferId');
                const transferDate = getField(r, 'transfer_date', 'TransferDate', 'transferDate', 'date', 'Date');

                if (!transferId || !transferDate) {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing required fields (transfer_id/transfer_date)`);
                    continue;
                }

                rows.push({
                    id: uuidv4(),
                    tenant_id: tenantId,
                    seller_id: userId,
                    transfer_id: transferId,
                    sku: getField(r, 'sku', 'SKU', 'sellerSku') || null,
                    asin: getField(r, 'asin', 'ASIN') || null,
                    fnsku: getField(r, 'fnsku', 'FNSKU', 'fnSku', 'sku', 'SKU') || null,
                    source_fc: getField(r, 'from_fc', 'source_fc', 'fromFc', 'SourceFC') || null,
                    destination_fc: getField(r, 'to_fc', 'destination_fc', 'toFc', 'DestinationFC') || null,
                    transfer_date: transferDate,
                    quantity_sent: Number(getField(r, 'quantity_sent', 'QuantitySent')) || 0,
                    quantity_received: Number(getField(r, 'quantity_received', 'QuantityReceived')) || 0,
                    status: 'received',
                    unit_value: Number(getField(r, 'unit_value', 'UnitValue', 'price', 'Price')) || 0,
                    currency: getField(r, 'currency', 'Currency', 'CurrencyCode') || 'USD',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
                skipped++;
            }
        }

        return this.batchUpsert('inventory_transfers', rows, 'transfers', errors, skipped);
    }

    // ============================================================================
    // Database helpers
    // ============================================================================

    /**
     * Table-specific conflict keys for UPSERT idempotency.
     * When a row with the same natural key already exists, it is UPDATED instead of duplicated.
     * IMPORTANT: Only include tables that have a DB-level UNIQUE constraint.
     * Tables without a constraint will fall back to plain .insert().
     */
    private static readonly CONFLICT_KEYS: Record<string, string> = {
        orders: 'tenant_id,user_id,order_id',
        shipments: 'tenant_id,user_id,shipment_id',
        returns: 'tenant_id,user_id,return_id',
        settlements: 'tenant_id,user_id,settlement_id,transaction_type',
        inventory_items: 'tenant_id,user_id,sku,asin,fnsku',
        inventory_ledger_events: 'tenant_id,user_id,fnsku,event_type,event_date,reference_id',
        financial_events: 'tenant_id,seller_id,event_type,event_date,amazon_order_id,amazon_sku,amount',
        inventory_transfers: 'tenant_id,seller_id,transfer_id',
        // Other tables (orders, shipments, returns, settlements, inventory_items, financial_events)
        // do NOT have unique constraints yet — they fall back to .insert() automatically.
    };

    /**
     * Batch upsert rows into a Supabase table (in chunks of 500 to avoid API limits).
     * Uses .upsert() with table-specific onConflict keys to prevent duplicate rows.
     */
    private async batchUpsert(
        table: string,
        rows: any[],
        csvType: string,
        accumulatedErrors: string[],
        skipped = 0
    ): Promise<Omit<IngestionResult, 'fileName'>> {
        let inserted = 0;
        let failed = 0;
        const BATCH_SIZE = 500;
        const conflictKey = CSVIngestionService.CONFLICT_KEYS[table];

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const maxAttempts = 3;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    // Use upsert with onConflict when a natural key exists for this table,
                    // otherwise fall back to plain insert (for tables without a unique constraint yet).
                    const query = conflictKey
                        ? supabaseAdmin.from(table).upsert(batch, { onConflict: conflictKey, ignoreDuplicates: false })
                        : supabaseAdmin.from(table).insert(batch);

                    const { error } = await query;

                    if (error) {
                        const errorMessage =
                            error.message ||
                            error.details ||
                            error.hint ||
                            JSON.stringify(error);
                        const isRetriable = !error.code && errorMessage.includes('fetch failed');
                        logger.error(`❌ [CSV INGESTION] Batch upsert failed for ${table}`, {
                            error: errorMessage,
                            code: error.code,
                            batchStart: i,
                            batchSize: batch.length,
                            conflictKey: conflictKey || 'none (plain insert)',
                            attempt,
                            maxAttempts,
                        });

                        if (isRetriable && attempt < maxAttempts) {
                            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                            continue;
                        }

                        accumulatedErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${errorMessage}`);
                        failed += batch.length;
                    } else {
                        inserted += batch.length;
                    }

                    break;
                } catch (error: any) {
                    const errorMessage =
                        error?.message ||
                        error?.details ||
                        error?.hint ||
                        JSON.stringify(error);
                    const isRetriable = String(errorMessage).includes('fetch failed');
                    if (isRetriable && attempt < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                        continue;
                    }
                    accumulatedErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${errorMessage}`);
                    failed += batch.length;
                    break;
                }
            }
        }

        logger.info(`✅ [CSV INGESTION] ${csvType}: ${inserted} rows upserted, ${failed} failed`, {
            table,
            csvType,
            inserted,
            failed,
            total: rows.length,
            conflictKey: conflictKey || 'none',
        });

        return {
            success: inserted > 0,
            csvType: csvType as CSVType,
            rowsProcessed: rows.length + skipped,
            rowsInserted: inserted,
            rowsSkipped: skipped,
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
        enabled: boolean;
    }[] {
        return [
            {
                type: 'orders',
                description: 'Amazon order data (Seller Central > Reports > Orders)',
                targetTable: 'orders',
                exampleHeaders: ['AmazonOrderId', 'PurchaseDate', 'OrderStatus', 'OrderTotal', 'FulfillmentChannel', 'CurrencyCode'],
                enabled: !DISABLED_TYPES.has('orders'),
            },
            {
                type: 'shipments',
                description: 'FBA inbound shipment data (Seller Central > Inventory > Shipments)',
                targetTable: 'shipments',
                exampleHeaders: ['ShipmentId', 'ShipmentDate', 'DestinationFulfillmentCenterId', 'ShipmentStatus', 'QuantityShipped', 'QuantityReceived'],
                enabled: !DISABLED_TYPES.has('shipments'),
            },
            {
                type: 'returns',
                description: 'Customer return data (Seller Central > Reports > Returns)',
                targetTable: 'returns',
                exampleHeaders: ['ReturnId', 'ReturnDate', 'AmazonOrderId', 'ReturnReason', 'RefundAmount', 'ReturnStatus'],
                enabled: !DISABLED_TYPES.has('returns'),
            },
            {
                type: 'settlements',
                description: 'Settlement / payout reports (Seller Central > Reports > Payments)',
                targetTable: 'settlements',
                exampleHeaders: ['SettlementId', 'TransactionType', 'Amount', 'Fees', 'PostedDate', 'CurrencyCode'],
                enabled: !DISABLED_TYPES.has('settlements'),
            },
            {
                type: 'inventory',
                description: 'FBA inventory data (Seller Central > Inventory > Manage FBA Inventory)',
                targetTable: 'inventory_items',
                exampleHeaders: ['sellerSku', 'asin', 'fnSku', 'availableQuantity', 'reservedQuantity', 'price'],
                enabled: !DISABLED_TYPES.has('inventory'),
            },
            {
                type: 'financial_events',
                description: 'Financial events (adjustments, liquidations, etc.)',
                targetTable: 'financial_events',
                exampleHeaders: ['EventType', 'PostedDate', 'Amount', 'AmazonOrderId', 'CurrencyCode'],
                enabled: !DISABLED_TYPES.has('financial_events'),
            },
            {
                type: 'fees',
                description: 'FBA fee data (fulfillment fees, referral fees, storage fees)',
                targetTable: 'financial_events',
                exampleHeaders: ['FeeType', 'FeeAmount', 'PostedDate', 'SellerSKU', 'ASIN', 'AmazonOrderId'],
                enabled: !DISABLED_TYPES.has('fees'),
            },
            {
                type: 'transfers',
                description: 'Inventory transfer data between fulfillment centers',
                targetTable: 'inventory_transfers',
                exampleHeaders: ['transfer_id', 'sku', 'from_fc', 'to_fc', 'quantity_sent', 'quantity_received', 'transfer_date'],
                enabled: !DISABLED_TYPES.has('transfers'),
            },
        ];
    }
}

// Singleton export
export const csvIngestionService = new CSVIngestionService();
export default csvIngestionService;
