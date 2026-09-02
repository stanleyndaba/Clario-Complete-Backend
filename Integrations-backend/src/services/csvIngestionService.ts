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
import { buildDetectionQueuePayload } from './detectionQueueContract';
import {
    SYNTHETIC_TRAINING_SYNC_PREFIX,
    createSyntheticAuditExecutionContext,
    validateSyntheticAuditExecutionContext,
    type SyntheticAuditExecutionContext,
} from './syntheticAuditExecutionContext';
import {
    buildCanonicalFinancialEventRow,
    classifyFinancialEventType,
    parseCurrencyAmount
} from '../utils/financialEventCanonical';

// ============================================================================
// Delimited Manual-Audit Parser
// ============================================================================

export type ManualAuditDelimiter = ',' | '\t';

/**
 * Count a delimiter outside CSV-style quoted fields. This is intentionally shared
 * by delimiter detection and parsing so a comma within a quoted TSV/CSV value
 * cannot make the file appear comma-delimited.
 */
function countUnquotedDelimiter(line: string, delimiter: ManualAuditDelimiter): number {
    let count = 0;
    let inQuotes = false;

    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        const nextChar = line[index + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                index++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }

        if (char === delimiter && !inQuotes) {
            count++;
        }
    }

    return count;
}

/**
 * Detect the delimiter from the header. Amazon Ledger documents are TSV, while
 * existing Manual Audit CSV uploads remain comma-delimited. A tab selects TSV
 * only when the header has no unquoted comma candidates; mixed unquoted comma
 * and tab evidence is rejected rather than guessed. Embedded quoted commas do
 * not affect delimiter selection.
 */
export function detectManualAuditDelimiter(headerLine: string): ManualAuditDelimiter {
    const tabCount = countUnquotedDelimiter(headerLine, '\t');
    const commaCount = countUnquotedDelimiter(headerLine, ',');

    if (tabCount > 0 && commaCount > 0) {
        throw new Error('Ambiguous delimiter in header: both unquoted comma and tab delimiters are present.');
    }

    return tabCount > 0 ? '\t' : ',';
}

type ParsedDelimitedLine = {
    values: string[];
    terminated: boolean;
};

/**
 * Parse one CSV or TSV line, preserving every field as text. Identifier-looking
 * values must remain strings: numeric conversion is performed only by explicit
 * downstream money/quantity mappings, never at file-boundary parsing time.
 */
function parseDelimitedLine(
    line: string,
    delimiter: ManualAuditDelimiter,
    trim: boolean = true
): ParsedDelimitedLine {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    let index = 0;

    while (index < line.length) {
        const char = line[index];
        const nextChar = line[index + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                index += 2;
                continue;
            }
            inQuotes = !inQuotes;
            index++;
            continue;
        }

        if (char === delimiter && !inQuotes) {
            values.push(trim ? current.trim() : current);
            current = '';
            index++;
            continue;
        }

        current += char;
        index++;
    }

    values.push(trim ? current.trim() : current);
    return { values, terminated: !inQuotes };
}

function normalizeManualAuditHeader(header: string): string {
    return header.toLowerCase().replace(/[_\-\s]/g, '');
}

function validateManualAuditHeaders(headers: string[]): void {
    const normalizedHeaders = new Set<string>();

    headers.forEach((header, index) => {
        if (!header) {
            throw new Error(`Invalid header at column ${index + 1}: header names must not be empty.`);
        }

        const normalized = normalizeManualAuditHeader(header);
        if (normalizedHeaders.has(normalized)) {
            throw new Error(`Duplicate normalized header: "${header}".`);
        }
        normalizedHeaders.add(normalized);
    });
}

/**
 * Parse CSV or TSV content into records. The parser does not auto-cast any field;
 * doing so corrupts leading-zero and high-precision Amazon identifiers before the
 * type-specific Manual Audit mapper can decide which fields are numeric. Structural
 * uncertainty fails closed before source recognition or persistence.
 */
export function parseManualAuditDelimitedRecords(content: string): Record<string, string | null>[] {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.replace(/^\uFEFF/, ''))
        .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#'));

    if (lines.length < 2) return [];

    const delimiter = detectManualAuditDelimiter(lines[0]);
    const parsedHeader = parseDelimitedLine(lines[0], delimiter);
    if (!parsedHeader.terminated) {
        throw new Error('Malformed header: unterminated quoted field.');
    }

    const headers = parsedHeader.values;
    validateManualAuditHeaders(headers);

    const records: Record<string, string | null>[] = [];

    for (let index = 1; index < lines.length; index++) {
        const parsedRow = parseDelimitedLine(lines[index], delimiter);
        const rowNumber = index + 1;
        if (!parsedRow.terminated) {
            throw new Error(`Malformed row ${rowNumber}: unterminated quoted field.`);
        }
        if (parsedRow.values.length !== headers.length) {
            throw new Error(
                `Malformed row ${rowNumber}: expected ${headers.length} columns but received ${parsedRow.values.length}.`
            );
        }

        const record: Record<string, string | null> = {};
        headers.forEach((header, columnIndex) => {
            record[header] = parsedRow.values[columnIndex];
        });

        records.push(record);
    }

    return records;
}

/** Parse and validate the header from a CSV/TSV that has no data rows. */
export function parseManualAuditHeaders(content: string): string[] {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.replace(/^\uFEFF/, ''))
        .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#'));
    if (lines.length === 0) return [];
    const delimiter = detectManualAuditDelimiter(lines[0]);
    const parsedHeader = parseDelimitedLine(lines[0], delimiter);
    if (!parsedHeader.terminated) throw new Error('Malformed header: unterminated quoted field.');
    validateManualAuditHeaders(parsedHeader.values);
    return parsedHeader.values;
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
        // Canonical/internal aliases.
        ['SettlementId', 'TransactionType'],
        ['settlement_id', 'transaction_type'],
        ['settlementId', 'transactionType'],
        ['Settlement ID', 'Transaction Type'],
        // Amazon Settlement Transaction report variants.
        ['settlement-id', 'total-amount'],
        ['settlement-id', 'transaction-type'],
        ['settlement-id', 'settlement-start-date', 'settlement-end-date'],
        ['settlement_id', 'total_amount'],
    ],
    inventory: [
        ['sellerSku', 'availableQuantity'],
        ['seller-sku', 'available'],
        ['FNSKU', 'MSKU', 'Quantity'],
        ['Date', 'FNSKU', 'ASIN', 'MSKU'],
        ['AdjustmentDate', 'FNSKU', 'ASIN'],
        ['EventDate', 'FNSKU', 'ASIN'],
        ['fnsku', 'disposition', 'fulfillment center'],
    ],
    financial_events: [
        // Canonical/internal aliases.
        ['EventType', 'PostedDate', 'Amount', 'Description'],
        ['event_type', 'event_date', 'amount'],
        ['EventType', 'PostedDate', 'Amount'],
        ['eventType', 'postedDate', 'amount', 'Description'],
        // Amazon Financial Events / adjustment export variants.
        ['AdjustmentEventId', 'PostedDate'],
        ['OriginalRemovalOrderId', 'LiquidationProceedsAmount'],
        ['amazon-order-id', 'posted-date', 'transaction-type', 'amount'],
        ['amazon_order_id', 'posted_date', 'transaction_type', 'amount'],
        ['event-type', 'posted-date', 'amount', 'description'],
        ['event_type', 'posted-date', 'amount', 'description'],
        ['event-id', 'posted-date', 'amount'],
    ],
    fees: [
        ['FeeType', 'FeeAmount'],
        ['fee_type', 'fee_amount'],
        ['feeType', 'feeAmount'],
        ['FeeType', 'PostedDate'],
        // Common normalized manual fee export: the reference column separates
        // it from a generic financial-event report with the same amount/date.
        ['EventType', 'PostedDate', 'Amount', 'CurrencyCode', 'Reference ID'],
        ['event_type', 'posted_date', 'amount', 'currency_code', 'reference_id'],
    ],
    transfers: [
        ['transfer_id', 'sku', 'quantity_sent', 'quantity_received', 'transfer_date'],
        ['TransferId', 'sku', 'QuantitySent', 'QuantityReceived', 'TransferDate'],
        ['transfer_id', 'from_fc', 'to_fc'],
    ],
    unknown: [],
};

/**
 * Detect CSV type only when exactly one supported report family has a matching
 * header signature. A filename is descriptive metadata, not evidence that can
 * resolve a structurally ambiguous schema. Callers that have an authoritative
 * report type may use the explicit typed upload route instead.
 */
export function detectCSVType(headers: string[], fileName: string = ''): CSVType {
    const headerSet = new Set(headers.map(h => h.toLowerCase().replace(/[_\- ]/g, '')));
    const matchedTypes = new Set<CSVType>();

    for (const [csvType, signatures] of Object.entries(CSV_TYPE_SIGNATURES)) {
        if (csvType === 'unknown') continue;

        const hasMatchingSignature = signatures.some((signature) => {
            const normalizedSig = signature.map(s => s.toLowerCase().replace(/[_\- ]/g, ''));
            return normalizedSig.every(s => headerSet.has(s));
        });
        if (hasMatchingSignature) {
            matchedTypes.add(csvType as CSVType);
        }
    }

    // The manual fee export also carries EventType/PostedDate/Amount, which is
    // valid for the minimal financial-event fallback. CurrencyCode + Reference
    // ID are the deliberate fee discriminators in that schema.
    if (matchedTypes.has('settlements') && matchedTypes.has('financial_events')) {
        const normalizedHeaders = new Set(headers.map(h => h.toLowerCase().replace(/[_\- ]/g, '')));
        if (normalizedHeaders.has('settlementid')) matchedTypes.delete('financial_events');
    }

    if (matchedTypes.has('financial_events') && matchedTypes.has('fees')) {
        const normalizedHeaders = new Set(headers.map(h => h.toLowerCase().replace(/[_\- ]/g, '')));
        const isFeeShape = normalizedHeaders.has('currencycode') && normalizedHeaders.has('referenceid');
        if (isFeeShape) matchedTypes.delete('financial_events');
    }

    if (matchedTypes.size > 1) {
        const fileContext = fileName ? ` for ${fileName}` : '';
        throw new Error(`Ambiguous CSV type${fileContext}: headers match multiple supported report families (${Array.from(matchedTypes).join(', ')}). Specify the report type explicitly.`);
    }

    return matchedTypes.values().next().value || 'unknown';
}

function assertSyntheticTrainingFilesContainNoTransferInput(
    files: { buffer: Buffer; originalname: string; mimetype: string }[],
    explicitType?: CSVType
): void {
    if (explicitType === 'transfers') {
        throw new Error('Transfer-like input is prohibited for synthetic training execution.');
    }

    for (const file of files) {
        if (/transfer/i.test(file.originalname)) {
            throw new Error(`Transfer-like input is prohibited for synthetic training execution: ${file.originalname}`);
        }

        const records = parseManualAuditDelimitedRecords(file.buffer.toString('utf-8'));
        if (records.length === 0) continue;

        const detectedType = detectCSVType(Object.keys(records[0]), file.originalname);
        if (detectedType === 'transfers') {
            throw new Error(`Transfer-like input is prohibited for synthetic training execution: ${file.originalname}`);
        }
    }
}

type OrdinaryTransferInputInspection = {
    csvType: CSVType;
    records: Record<string, string | null>[];
    prohibitedInventoryRowCount: number;
};

/**
 * Ordinary manual uploads remain fail-closed while Transfer is OFF. The guard
 * relies only on an explicit type, a detected report structure, or an exact
 * inventory event semantic. A filename or reference-id string alone is not
 * Transfer evidence and is intentionally not considered here.
 */
function inspectOrdinaryManualTransferInput(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    explicitType?: CSVType,
): OrdinaryTransferInputInspection | null {
    let records: Record<string, string | null>[];
    try {
        records = parseManualAuditDelimitedRecords(file.buffer.toString('utf-8'));
    } catch {
        // Preserve the established parser's malformed-input result.
        return null;
    }

    if (explicitType === 'transfers') {
        return { csvType: 'transfers', records, prohibitedInventoryRowCount: 0 };
    }
    if (records.length === 0) return null;

    let csvType: CSVType;
    try {
        csvType = explicitType || detectCSVType(Object.keys(records[0]), file.originalname);
    } catch {
        // Preserve the established parser's ambiguous-structure result.
        return null;
    }

    if (csvType === 'transfers') {
        return { csvType, records, prohibitedInventoryRowCount: 0 };
    }
    if (csvType !== 'inventory') return null;

    const prohibitedInventoryRowCount = records.filter((record) => {
        const eventType = getField(record, 'Event Type', 'event_type', 'EventType', 'type');
        const normalized = String(eventType || '').trim().toLowerCase();
        return normalized === 'transfer' || normalized === 'transfers';
    }).length;

    return prohibitedInventoryRowCount > 0
        ? { csvType, records, prohibitedInventoryRowCount }
        : null;
}

// ============================================================================
// Column Mapping — flexible mapping from various CSV column names → internal schema
// ============================================================================

/**
 * Robustly parse a numeric amount from CSV data.
 * Strips currency symbols ($, €, £), commas, whitespace, and handles negatives like ($145.00)
 */
/**
 * Parse optional monetary evidence without converting a blank or malformed cell
 * into a literal zero. Explicit 0, currency symbols, and parenthesized negatives
 * remain supported; absence is null and invalid supplied text rejects the row.
 */
function parseOptionalAmountField(raw: unknown, fieldName: string): number | null {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
        return null;
    }
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) throw new Error(`Invalid monetary field (${fieldName})`);
        return raw;
    }

    const source = String(raw).trim();
    const cleaned = source.replace(/[^0-9.\-]/g, '');
    const parsed = parseFloat(cleaned);
    if (!cleaned || !Number.isFinite(parsed)) {
        throw new Error(`Invalid monetary field (${fieldName})`);
    }
    return source.includes('(') && parsed > 0 ? -parsed : parsed;
}

/**
 * Parse a required numeric field without treating a blank or malformed provider
 * cell as zero. An explicit textual "0" remains a valid numeric zero.
 */
function parseRequiredNumericField(raw: unknown, fieldName: string): number {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
        throw new Error(`Missing required numeric field (${fieldName})`);
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid numeric field (${fieldName})`);
    }

    return parsed;
}

/**
 * Preserve optional numeric absence as null rather than fabricating zero. Explicit
 * numeric zero remains valid; malformed or non-finite supplied values invalidate
 * the row that supplied them.
 */
function parseOptionalNumericField(raw: unknown, fieldName: string): number | null {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
        return null;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid numeric field (${fieldName})`);
    }

    return parsed;
}

/**
 * Snapshot counts and list prices permit an observed literal zero but not a
 * negative value. Missing columns/cells remain null so database defaults and
 * downstream consumers cannot confuse unavailable evidence with zero.
 */
function parseOptionalNonNegativeNumericField(raw: unknown, fieldName: string): number | null {
    const parsed = parseOptionalNumericField(raw, fieldName);
    if (parsed !== null && parsed < 0) {
        throw new Error(`Invalid negative numeric field (${fieldName})`);
    }
    return parsed;
}

function parseRequiredNonNegativeNumericField(raw: unknown, fieldName: string): number {
    const parsed = parseRequiredNumericField(raw, fieldName);
    if (parsed < 0) {
        throw new Error(`Invalid negative numeric field (${fieldName})`);
    }
    return parsed;
}

/**
 * Parse a required Manual Audit source date. A valid source date is normalized to
 * ISO time; missing or invalid provider text must not become generated current-time
 * chronology before Audit reconciliation and maturity rules consume it.
 */
function parseOptionalIsoDateField(raw: unknown, fieldName: string): string | null {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
        return null;
    }

    const source = String(raw).trim();
    const dateOnlyMatch = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timestampMatch = source.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/);
    const calendarMatch = dateOnlyMatch || timestampMatch;
    if (!calendarMatch) {
        throw new Error(`Invalid or ambiguous date field (${fieldName})`);
    }

    const year = Number(calendarMatch[1]);
    const month = Number(calendarMatch[2]);
    const day = Number(calendarMatch[3]);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (
        calendar.getUTCFullYear() !== year
        || calendar.getUTCMonth() !== month - 1
        || calendar.getUTCDate() !== day
    ) {
        throw new Error(`Invalid date field (${fieldName})`);
    }

    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid date field (${fieldName})`);
    }
    return parsed.toISOString();
}

function parseRequiredIsoDateField(raw: unknown, fieldName: string): string {
    const parsed = parseOptionalIsoDateField(raw, fieldName);
    if (parsed === null) {
        throw new Error(`Missing required date field (${fieldName})`);
    }
    return parsed;
}

/**
 * Parse a required monetary field without turning missing or malformed source
 * evidence into zero. This retains the existing currency-symbol and
 * parenthesized-negative support used by Manual Audit amounts.
 */
function parseRequiredAmountField(raw: unknown, fieldName: string): number {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
        throw new Error(`Missing required monetary field (${fieldName})`);
    }
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) throw new Error(`Invalid monetary field (${fieldName})`);
        return raw;
    }

    const source = String(raw).trim();
    const cleaned = source.replace(/[^0-9.\-]/g, '');
    const parsed = parseFloat(cleaned);
    if (!cleaned || !Number.isFinite(parsed)) {
        throw new Error(`Invalid monetary field (${fieldName})`);
    }

    return source.includes('(') && parsed > 0 ? -parsed : parsed;
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

type CriticalAliasGroup = { field: string; aliases: string[] };

const CRITICAL_ALIAS_GROUPS: Partial<Record<Exclude<CSVType, 'unknown'>, CriticalAliasGroup[]>> = {
    orders: [
        { field: 'order identifier', aliases: ['AmazonOrderId', 'amazon-order-id', 'order_id', 'orderId', 'Order ID'] },
        { field: 'order date', aliases: ['PurchaseDate', 'purchase_date', 'purchaseDate', 'order_date', 'Order Date'] },
        { field: 'order total', aliases: ['OrderTotal', 'total_amount', 'totalAmount', 'Amount', 'amount'] },
    ],
    shipments: [
        { field: 'shipment identifier', aliases: ['ShipmentId', 'shipment_id', 'shipmentId', 'Shipment ID'] },
        { field: 'shipment date', aliases: ['ShipmentDate', 'shipment_date', 'shipmentDate', 'Shipment Date', 'shipped_date', 'Date'] },
    ],
    returns: [
        { field: 'return identifier', aliases: ['ReturnId', 'return_id', 'returnId', 'Return ID'] },
        { field: 'return date', aliases: ['ReturnDate', 'return_date', 'returnDate', 'Return Date'] },
        { field: 'return quantity', aliases: ['Quantity', 'quantity', 'ReturnQuantity', 'return_quantity'] },
    ],
    settlements: [
        { field: 'settlement identifier', aliases: ['SettlementId', 'settlement_id', 'settlementId', 'Settlement ID'] },
        { field: 'settlement date', aliases: ['PostedDate', 'posted_date', 'SettlementDate', 'settlement_date'] },
        { field: 'transaction type', aliases: ['TransactionType', 'transaction_type', 'transactionType'] },
        { field: 'settlement amount', aliases: ['Amount', 'amount', 'TotalAmount', 'total_amount', 'total-amount'] },
    ],
    financial_events: [
        { field: 'financial event identifier', aliases: ['AdjustmentEventId', 'EventId', 'event_id', 'eventId'] },
        { field: 'event type', aliases: ['EventType', 'event_type', 'eventType'] },
        { field: 'posted date', aliases: ['PostedDate', 'posted_date', 'postedDate', 'EventDate', 'event_date'] },
        { field: 'event amount', aliases: ['Amount', 'amount', 'EventAmount', 'event_amount'] },
    ],
    fees: [
        { field: 'fee type', aliases: ['FeeType', 'fee_type', 'feeType'] },
        { field: 'fee date', aliases: ['PostedDate', 'posted_date', 'postedDate', 'EventDate', 'event_date', 'date', 'Date'] },
        { field: 'fee amount', aliases: ['FeeAmount', 'fee_amount', 'feeAmount', 'Amount', 'amount'] },
    ],
    inventory: [
        { field: 'inventory SKU', aliases: ['sellerSku', 'seller-sku', 'seller_sku', 'SKU', 'sku', 'MSKU', 'msku'] },
        { field: 'inventory quantity', aliases: ['availableQuantity', 'available', 'quantity_available', 'quantity', 'Quantity'] },
        { field: 'inventory event date', aliases: ['Date', 'date', 'event_date', 'EventDate', 'PostedDate'] },
    ],
    transfers: [
        { field: 'transfer identifier', aliases: ['transfer_id', 'TransferId'] },
        { field: 'sent quantity', aliases: ['quantity_sent', 'QuantitySent'] },
        { field: 'received quantity', aliases: ['quantity_received', 'QuantityReceived'] },
    ],
};

function normalizeAliasValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized === '' ? null : normalized;
}

function findCriticalAliasConflict(records: Record<string, string | null>[], csvType: CSVType): { rowNumber: number; field: string } | null {
    if (csvType === 'unknown') return null;
    const groups = CRITICAL_ALIAS_GROUPS[csvType] || [];
    if (groups.length === 0) return null;

    for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const byNormalizedHeader = new Map(Object.keys(record).map((header) => [normalizeManualAuditHeader(header), record[header]]));
        for (const group of groups) {
            const observedValues = new Set(
                group.aliases
                    .map((alias) => normalizeAliasValue(byNormalizedHeader.get(normalizeManualAuditHeader(alias))))
                    .filter((value): value is string => value !== null)
            );
            if (observedValues.size > 1) {
                return { rowNumber: index + 1, field: group.field };
            }
        }
    }

    return null;
}

// ============================================================================
// Ingestion Result
// ============================================================================

export type CsvInputIssue = 'empty' | 'malformed' | 'ambiguous' | 'unsupported' | 'missing_required' | 'invalid_value' | 'prohibited';

function classifyCsvInputIssue(errors: unknown): CsvInputIssue | undefined {
    const message = Array.isArray(errors)
        ? errors.map((value) => String(value || '')).join(' ')
        : String(errors || '');

    if (/ambiguous\s+(delimiter|csv type)|multiple supported report families/i.test(message)) return 'ambiguous';
    if (/malformed|unterminated quoted field|duplicate normalized header|invalid header/i.test(message)) return 'malformed';
    if (/empty or has no data rows/i.test(message)) return 'empty';
    if (/could not detect csv type|unsupported csv type|temporarily disabled/i.test(message)) return 'unsupported';
    if (/missing required headers|missing required fields|missing required numeric field/i.test(message)) return 'missing_required';
    if (/invalid numeric field|invalid required|invalid date/i.test(message)) return 'invalid_value';
    if (/transfer-like input is prohibited while transfer is off/i.test(message)) return 'prohibited';
    return undefined;
}

function ensurePersistenceDiagnostics(result: IngestionResult): IngestionResult {
    return {
        ...result,
        persistenceStatus: result.persistenceStatus || (result.rowsInserted > 0 ? 'succeeded' : 'not_attempted'),
        persistenceError: result.persistenceError,
        persistenceOperations: result.persistenceOperations || [],
    };
}

export type CsvSubmissionDisposition = 'new' | 'mixed' | 'duplicate_reused';

export type ManualTemporalCoverageStatus = 'available' | 'partial' | 'unavailable';

export interface ManualFileTemporalEvidence {
    status: ManualTemporalCoverageStatus;
    sourceDateField: string | null;
    earliestAt: string | null;
    latestAt: string | null;
    observedDateCount: number;
    continuity: 'unknown';
    reason?: string;
}

export type PersistenceStatus = 'not_attempted' | 'succeeded' | 'partial' | 'failed';

export interface PersistenceOperationDiagnostic {
    table: string;
    operation: string;
    status: 'succeeded' | 'failed';
    batch?: number;
    rows?: number;
    errorCode?: string;
    message?: string;
    details?: string;
    hint?: string;
    metadata?: Record<string, unknown>;
}

export interface IngestionResult {
    success: boolean;
    csvType: CSVType;
    fileName: string;
    rowsProcessed: number;
    rowsInserted: number;
    rowsSkipped: number;
    rowsFailed: number;
    errors: string[];
    inputIssue?: CsvInputIssue;
    persistenceStatus?: PersistenceStatus;
    persistenceError?: string;
    persistenceOperations?: PersistenceOperationDiagnostic[];
    duplicateOfSyncId?: string;
    warnings?: string[];
    temporalEvidence?: ManualFileTemporalEvidence;
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
    submissionDisposition?: CsvSubmissionDisposition;
    reusedSyncId?: string;
}

export type CsvUploadRunStatus = 'started' | 'detection_processing' | 'completed' | 'partial' | 'failed';

export interface CsvUploadRunFileSummary {
    fileName: string;
    mimeType?: string;
    status: 'accepted' | 'ingested' | 'duplicate' | 'failed';
    csvType?: CSVType;
    rowsProcessed?: number;
    rowsInserted?: number;
    rowsSkipped?: number;
    rowsFailed?: number;
    errors?: string[];
    inputIssue?: CsvInputIssue;
    persistenceStatus?: PersistenceStatus;
    persistenceError?: string;
    persistenceOperations?: PersistenceOperationDiagnostic[];
    duplicateOfSyncId?: string;
    warnings?: string[];
    temporalEvidence?: ManualFileTemporalEvidence;
    detectionTriggered?: boolean;
    detectionJobId?: string;
}

const TEMPORAL_SOURCE_FIELD_DEFINITIONS: Partial<Record<Exclude<CSVType, 'unknown'>, {
    field: string;
    aliases: string[];
}>> = {
    orders: { field: 'order_date', aliases: ['PurchaseDate', 'purchase_date', 'purchaseDate', 'order_date', 'Order Date'] },
    shipments: { field: 'shipped_date', aliases: ['ShipmentDate', 'shipment_date', 'shipmentDate', 'shipped_date', 'Date'] },
    returns: { field: 'returned_date', aliases: ['ReturnDate', 'return_date', 'returnDate', 'returned_date'] },
    settlements: { field: 'settlement_date', aliases: ['PostedDate', 'settlement_date', 'posted_date', 'postedDate', 'SettlementDate'] },
    financial_events: { field: 'event_date', aliases: ['PostedDate', 'event_date', 'postedDate', 'posted_date', 'date', 'Date'] },
    fees: { field: 'event_date', aliases: ['PostedDate', 'event_date', 'postedDate', 'posted_date', 'date', 'Date'] },
    inventory: { field: 'event_date', aliases: ['Date', 'date', 'event_date', 'EventDate', 'PostedDate'] },
    transfers: { field: 'transfer_date', aliases: ['TransferDate', 'transfer_date', 'transferDate', 'date', 'Date'] },
};

function deriveManualFileTemporalEvidence(
    records: Record<string, string | null>[],
    csvType: CSVType,
    result: Pick<IngestionResult, 'rowsInserted' | 'rowsSkipped' | 'errors'>,
): ManualFileTemporalEvidence {
    const definition = TEMPORAL_SOURCE_FIELD_DEFINITIONS[csvType as Exclude<CSVType, 'unknown'>];
    if (!definition) {
        return {
            status: 'unavailable',
            sourceDateField: null,
            earliestAt: null,
            latestAt: null,
            observedDateCount: 0,
            continuity: 'unknown',
            reason: 'This report family has no supported source date field for temporal coverage.',
        };
    }

    const observedDates: string[] = [];
    let invalidDateCount = 0;
    for (const record of records) {
        try {
            const parsed = parseOptionalIsoDateField(getField(record, ...definition.aliases), definition.field);
            if (parsed) observedDates.push(parsed);
        } catch {
            invalidDateCount += 1;
        }
    }

    const distinctDates = Array.from(new Set(observedDates)).sort();
    if (result.rowsInserted <= 0 || distinctDates.length === 0) {
        return {
            status: 'unavailable',
            sourceDateField: definition.field,
            earliestAt: null,
            latestAt: null,
            observedDateCount: 0,
            continuity: 'unknown',
            reason: invalidDateCount > 0
                ? 'One or more source dates could not be safely interpreted; this file did not establish temporal coverage.'
                : 'No accepted source date was available to establish temporal coverage for this file.',
        };
    }

    return {
        status: invalidDateCount > 0 || result.rowsSkipped > 0 ? 'partial' : 'available',
        sourceDateField: definition.field,
        earliestAt: distinctDates[0],
        latestAt: distinctDates[distinctDates.length - 1],
        observedDateCount: distinctDates.length,
        continuity: 'unknown',
        reason: invalidDateCount > 0 || result.rowsSkipped > 0
            ? 'Only accepted dated rows are represented; skipped or invalid rows do not establish temporal coverage.'
            : 'Source dates are represented by accepted rows. Continuous day-by-day coverage is not inferred from event dates alone.',
    };
}

function normalizeManualFileTemporalEvidence(value: unknown): ManualFileTemporalEvidence | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const entry = value as Record<string, unknown>;
    const status = entry.status;
    if (status !== 'available' && status !== 'partial' && status !== 'unavailable') return undefined;

    const sourceDateField = typeof entry.sourceDateField === 'string' ? entry.sourceDateField : null;
    const normalizeStoredDate = (raw: unknown): string | null => {
        if (raw === null || raw === undefined) return null;
        try {
            return parseRequiredIsoDateField(raw, 'stored temporal evidence');
        } catch {
            return null;
        }
    };
    const earliestAt = normalizeStoredDate(entry.earliestAt);
    const latestAt = normalizeStoredDate(entry.latestAt);
    const observedDateCount = Number(entry.observedDateCount);
    const validCount = Number.isInteger(observedDateCount) && observedDateCount >= 0 ? observedDateCount : 0;

    if (status !== 'unavailable' && (!earliestAt || !latestAt || validCount <= 0)) {
        return {
            status: 'unavailable',
            sourceDateField,
            earliestAt: null,
            latestAt: null,
            observedDateCount: 0,
            continuity: 'unknown',
            reason: 'Stored temporal facts were incomplete or invalid and do not establish coverage.',
        };
    }

    return {
        status,
        sourceDateField,
        earliestAt: status === 'unavailable' ? null : earliestAt,
        latestAt: status === 'unavailable' ? null : latestAt,
        observedDateCount: status === 'unavailable' ? 0 : validCount,
        continuity: 'unknown',
        reason: typeof entry.reason === 'string' ? entry.reason : undefined,
    };
}

export interface CsvUploadDetectionSnapshot {
    status: DetectionQueueStatus | 'completed' | null;
    processedAt: string | null;
    errorMessage: string | null;
    resultsTotal: number;
    isSandbox: boolean;
}

export interface CsvUploadRunSnapshot {
    syncId: string;
    source: 'persisted_run' | 'detection_queue_fallback' | 'detection_results_fallback';
    uploadSummaryAvailable: boolean;
    recoveryNotice: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    status: CsvUploadRunStatus | null;
    fileCount: number;
    filesSummary: CsvUploadRunFileSummary[];
    detectionTriggered: boolean;
    detectionJobId?: string;
    error: string | null;
    isSandbox: boolean;
    batchResult: BatchIngestionResult | null;
    detection: CsvUploadDetectionSnapshot | null;
}

const DISABLED_TYPES = new Set<CSVType>(['transfers']);

type DetectionQueueStatus = 'pending' | 'processing' | 'completed' | 'failed';
type CsvUploadRunSource = CsvUploadRunSnapshot['source'];
type CsvUploadRunRow = {
    sync_id: string;
    success: boolean | null;
    total_files: number | null;
    file_count: number | null;
    detection_triggered: boolean | null;
    detection_job_id: string | null;
    ingestion_results: unknown;
    files_summary: unknown;
    created_at: string | null;
    updated_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    status: CsvUploadRunStatus | null;
    error: string | null;
    is_sandbox: boolean | null;
};

type DetectionQueueRow = {
    sync_id?: string | null;
    status?: DetectionQueueStatus | null;
    processed_at?: string | null;
    error_message?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    payload?: Record<string, any> | null;
};

type CsvIngestionRunRow = {
    id?: string | null;
    tenant_id?: string | null;
    user_id?: string | null;
    csv_type?: string | null;
    file_name?: string | null;
    file_hash?: string | null;
    created_at?: string | null;
};

// ============================================================================
// CSV Ingestion Service
// ============================================================================

export class CSVIngestionService {
    private normalizeCsvFileName(value: string | null | undefined): string {
        return String(value || '').trim().toLowerCase();
    }

    private getDetectionQueueSandboxFlag(row: DetectionQueueRow | null | undefined): boolean {
        if (!row?.payload || typeof row.payload !== 'object') {
            return false;
        }

        return !!(row.payload.is_sandbox ?? row.payload.isSandbox);
    }

    private getCountedDetectionValue(row: any): number {
        const countedValue = Number(row?.evidence?.economic_rollup?.counted_value);
        if (Number.isFinite(countedValue)) {
            return countedValue;
        }

        const estimatedValue = Number(row?.estimated_value);
        return Number.isFinite(estimatedValue) ? estimatedValue : 0;
    }

    private deriveDetectionReviewTier(row: any): 'claim_candidate' | 'review_only' | 'monitoring' {
        const evidence = row?.evidence && typeof row.evidence === 'object' ? row.evidence : {};
        const reviewTier = String(evidence.review_tier || '').toLowerCase();
        if (reviewTier === 'review_only' || reviewTier === 'monitoring') {
            return reviewTier as 'review_only' | 'monitoring';
        }

        const claimReadiness = String(evidence.claim_readiness || '').toLowerCase();
        if (claimReadiness === 'not_claim_ready') {
            return 'review_only';
        }

        const confidence = Number(row?.confidence_score);
        return Number.isFinite(confidence) && confidence >= 0.85 ? 'claim_candidate' : 'review_only';
    }

    private async notifyCsvDetectionSummary(
        userId: string,
        tenantId: string,
        syncId: string,
        detectionResults: any[]
    ): Promise<void> {
        if (detectionResults.length === 0) return;

        try {
            const notificationHelper = (await import('./notificationHelper')).default;
            const totalValue = detectionResults.reduce((sum, row) => sum + this.getCountedDetectionValue(row), 0);
            const claimReadyCount = detectionResults.filter((row) => this.deriveDetectionReviewTier(row) === 'claim_candidate').length;
            const reviewNeededCount = detectionResults.filter((row) => this.deriveDetectionReviewTier(row) === 'review_only').length;
            const monitoringCount = detectionResults.filter((row) => this.deriveDetectionReviewTier(row) === 'monitoring').length;
            const averageConfidence = detectionResults.length > 0
                ? detectionResults.reduce((sum, row) => sum + Number(row?.confidence_score || 0), 0) / detectionResults.length
                : 0;

            await notificationHelper.notifyClaimDetected(userId, {
                tenantId,
                count: detectionResults.length,
                totalValue,
                currency: detectionResults[0]?.currency || 'USD',
                confidence: averageConfidence,
                source: 'csv_upload',
                syncId,
                claimReadyCount,
                reviewNeededCount,
                monitoringCount,
            });

            logger.info('🔔 [CSV INGESTION] Durable notification created for persisted CSV detections', {
                userId,
                tenantId,
                syncId,
                count: detectionResults.length,
                totalValue,
            });
        } catch (error: any) {
            logger.warn('⚠️ [CSV INGESTION] Failed to create durable CSV detection notification', {
                userId,
                tenantId,
                syncId,
                error: error?.message || error,
            });
        }
    }

    /**
     * Ingest multiple CSV files for a user
     */
    async ingestSyntheticTrainingFiles(
        userId: string,
        files: { buffer: Buffer; originalname: string; mimetype: string }[],
        options: {
            explicitType?: CSVType;
            triggerDetection?: boolean;
            storeId?: string;
            tenantId: string;
        }
    ): Promise<BatchIngestionResult> {
        // Synthetic certification is intentionally non-Transfer: reject the input before
        // creating a CSV run, persisting rows, or invoking any detector.
        assertSyntheticTrainingFilesContainNoTransferInput(files, options.explicitType);
        const syntheticExecution = createSyntheticAuditExecutionContext(options.tenantId);
        return this.ingestFiles(userId, files, { ...options, syntheticExecution });
    }

    async ingestFiles(
        userId: string,
        files: { buffer: Buffer; originalname: string; mimetype: string }[],
        options: {
            explicitType?: CSVType;
            triggerDetection?: boolean;
            storeId?: string;
            tenantId?: string;
            syntheticExecution?: SyntheticAuditExecutionContext;
        } = {}
    ): Promise<BatchIngestionResult> {
        if (!options.tenantId) {
            throw new Error('tenantId is required for CSV ingestion');
        }

        const tenantId = options.tenantId;
        const syntheticExecution = options.syntheticExecution;
        if (syntheticExecution) {
            validateSyntheticAuditExecutionContext(tenantId, syntheticExecution);
        }
        const receivedFiles = files;
        const rejectedTransferResults: IngestionResult[] = [];
        if (!syntheticExecution) {
            files = files.filter((file) => {
                const inspection = inspectOrdinaryManualTransferInput(file, options.explicitType);
                const entireStructuredTransferFile = inspection?.csvType === 'transfers';
                const entireTransferLedgerFile = inspection?.csvType === 'inventory'
                    && inspection.prohibitedInventoryRowCount === inspection.records.length;
                if (!entireStructuredTransferFile && !entireTransferLedgerFile) return true;
                const rowsProcessed = inspection?.records.length || 0;
                rejectedTransferResults.push({
                    success: false,
                    csvType: inspection?.csvType || options.explicitType || 'unknown',
                    fileName: file.originalname,
                    rowsProcessed,
                    rowsInserted: 0,
                    rowsSkipped: rowsProcessed,
                    rowsFailed: rowsProcessed,
                    errors: ['Transfer-like input is prohibited while Transfer is OFF. This file was not persisted or sent to detection.'],
                    inputIssue: 'prohibited',
                    detectionTriggered: false,
                });
                return false;
            });
        }

        const triggerDetection = options.triggerDetection !== false;
        if (files.length === 0 && rejectedTransferResults.length > 0) {
            return {
                success: false,
                userId,
                totalFiles: receivedFiles.length,
                results: rejectedTransferResults,
                detectionTriggered: false,
                syncId: `csv_rejected_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
                submissionDisposition: 'new',
            };
        }

        // A timestamp alone can collide for simultaneous multipart submissions. Keep
        // the established CSV prefixes while adding entropy so each request gets a
        // separate lifecycle record; content identity remains the duplicate authority.
        const runEntropy = crypto.randomBytes(6).toString('hex');
        const syncId = syntheticExecution
            ? `${SYNTHETIC_TRAINING_SYNC_PREFIX}${Date.now()}_${runEntropy}`
            : `csv_${Date.now()}_${runEntropy}`;
        const results: IngestionResult[] = [...rejectedTransferResults];
        const runStartedAt = new Date().toISOString();
        const isSandbox = Boolean(syntheticExecution) || this.getCsvUploadSandboxFlag();

        logger.info('📂 [CSV INGESTION] Starting batch ingestion', {
            userId,
            syncId,
            fileCount: receivedFiles.length,
            fileNames: receivedFiles.map(f => f.originalname),
            explicitType: options.explicitType || 'auto-detect',
        });

        try {
            await this.persistCsvUploadRunRecord(tenantId, userId, syncId, {
                fileCount: receivedFiles.length,
                filesSummary: this.buildAcceptedCsvRunFilesSummary(files),
                startedAt: runStartedAt,
                status: 'started',
                detectionTriggered: false,
                detectionJobId: null,
                error: null,
                isSandbox,
            });
        } catch (error: any) {
            logger.warn('⚠️ [CSV INGESTION] Failed to create authoritative CSV run record at batch start', {
                tenantId,
                userId,
                syncId,
                error: error?.message || 'Unknown error',
            });
        }

        for (const file of files) {
            try {
                const result = await this.ingestSingleFile(userId, file, syncId, {
                    explicitType: options.explicitType,
                    storeId: options.storeId,
                    tenantId,
                    rejectTransferLikeInventoryRows: !syntheticExecution,
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
                    inputIssue: classifyCsvInputIssue(error.message),
                    detectionTriggered: false,
                });
            }
        }

        // Normalize every file result before persisting the run or triggering detection.
        // This guarantees diagnostics are present for validation, runtime, and DB failures.
        const diagnosticResults = results.map(ensurePersistenceDiagnostics);

        // Trigger detection after all files are imported
        let detectionJobId: string | undefined;
        let detectionError: string | null = null;
        const anySuccess = diagnosticResults.some(r => r.success && r.rowsInserted > 0);
        const allSucceeded = diagnosticResults.length > 0 && diagnosticResults.every(r => r.success);

        if (triggerDetection && anySuccess) {
            try {
                await this.persistCsvUploadRunRecord(tenantId, userId, syncId, {
                    success: allSucceeded,
                    fileCount: receivedFiles.length,
                    filesSummary: this.buildCsvRunFilesSummary(diagnosticResults),
                    startedAt: runStartedAt,
                    status: 'detection_processing',
                    detectionTriggered: true,
                    detectionJobId: null,
                    error: this.buildCsvUploadRunError(results),
                    isSandbox,
                });
            } catch (error: any) {
                logger.warn('⚠️ [CSV INGESTION] Failed to update authoritative CSV run before detection', {
                    tenantId,
                    userId,
                    syncId,
                    error: error?.message || 'Unknown error',
                });
            }

            try {
                detectionJobId = await this.triggerDetection(userId, syncId, tenantId, syntheticExecution);
                logger.info('🔍 [CSV INGESTION] Detection triggered after CSV import', {
                    userId,
                    syncId,
                    detectionJobId,
                });
            } catch (error: any) {
                detectionError = error.message || 'Detection trigger failed.';
                logger.error('❌ [CSV INGESTION] Failed to trigger detection', {
                    userId,
                    syncId,
                    error: error.message,
                });
            }
        }

        const detectionTriggered = !!detectionJobId;
        const detectionAttempted = triggerDetection && anySuccess;
        const unifiedResults = diagnosticResults.map(result => {
            if (!result.success || result.rowsInserted <= 0) {
                return {
                    ...result,
                    detectionTriggered: false,
                    detectionJobId: undefined,
                };
            }

            return {
                ...result,
                detectionTriggered: detectionAttempted,
                detectionJobId: detectionTriggered ? detectionJobId : undefined,
            };
        });

        let detectionSnapshot: CsvUploadDetectionSnapshot | null = null;
        if (triggerDetection && anySuccess) {
            try {
                detectionSnapshot = await this.getCsvDetectionSnapshot(userId, tenantId, syncId);
            } catch (error: any) {
                logger.warn('⚠️ [CSV INGESTION] Failed to refresh detection snapshot for CSV run record', {
                    tenantId,
                    userId,
                    syncId,
                    error: error?.message || 'Unknown error',
                });
            }
        }

        const batchError = this.buildCsvUploadRunError(unifiedResults, detectionError);
        const runStatus = this.deriveCsvUploadRunStatus(unifiedResults, {
            detectionTriggered: triggerDetection && anySuccess,
            detectionStatus: detectionSnapshot?.status || (detectionTriggered ? 'processing' : null),
            batchError,
        });

        const duplicateFileCount = unifiedResults.filter((result) =>
            result.success
            && result.rowsInserted === 0
            && result.rowsSkipped > 0
            && (result.errors || []).some((message) => /duplicate file upload detected/i.test(String(message)))
        ).length;
        const submissionDisposition: CsvSubmissionDisposition = duplicateFileCount === unifiedResults.length && unifiedResults.length > 0
            ? 'duplicate_reused'
            : duplicateFileCount > 0
                ? 'mixed'
                : 'new';

        const batchResult: BatchIngestionResult = {
            success: allSucceeded && anySuccess && (!detectionAttempted || detectionSnapshot?.status === 'completed'),
            userId,
            totalFiles: receivedFiles.length,
            results: unifiedResults,
            detectionTriggered: detectionAttempted,
            detectionJobId,
            syncId,
            submissionDisposition,
        };

        try {
            await this.persistCsvUploadRunRecord(tenantId, userId, syncId, {
                success: batchResult.success,
                fileCount: receivedFiles.length,
                filesSummary: this.buildCsvRunFilesSummary(unifiedResults),
                startedAt: runStartedAt,
                completedAt: this.isTerminalCsvUploadRunStatus(runStatus) ? new Date().toISOString() : null,
                status: runStatus,
                detectionTriggered: triggerDetection && anySuccess,
                detectionJobId: detectionJobId || null,
                error: batchError,
                isSandbox: detectionSnapshot?.isSandbox ?? isSandbox,
            });
        } catch (error: any) {
            logger.warn('⚠️ [CSV INGESTION] Failed to persist CSV upload run record', {
                tenantId,
                userId,
                syncId,
                error: error?.message || 'Unknown error',
            });
        }

        logger.info('📂 [CSV INGESTION] Batch ingestion complete', {
            userId,
            syncId,
            totalFiles: receivedFiles.length,
            successCount: results.filter(r => r.success).length,
            totalRowsInserted: results.reduce((sum, r) => sum + r.rowsInserted, 0),
            detectionTriggered,
        });

        return batchResult;
    }

    async getLatestCsvUploadRun(userId: string, tenantId: string): Promise<CsvUploadRunSnapshot | null> {
        try {
            const { data, error } = await supabaseAdmin
                .from('csv_upload_runs')
                .select('sync_id, success, total_files, file_count, detection_triggered, detection_job_id, ingestion_results, files_summary, created_at, updated_at, started_at, completed_at, status, error, is_sandbox')
                .eq('tenant_id', tenantId)
                .eq('seller_id', userId)
                .order('started_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error?.code === '42P01') {
                logger.warn('CSV upload run table is not deployed; falling back to detection truth for refresh recovery', {
                    table: 'csv_upload_runs',
                    tenantId,
                    userId,
                });
                return this.getLatestCsvUploadFallback(userId, tenantId);
            }

            if (error && error.code !== 'PGRST116') {
                throw new Error(`Failed to load latest CSV upload run: ${error.message}`);
            }

            if (data?.sync_id) {
                const detection = await this.getCsvDetectionSnapshot(userId, tenantId, data.sync_id);
                return this.mapCsvUploadRunSnapshot(userId, data as CsvUploadRunRow, 'persisted_run', detection, null);
            }
        } catch (error: any) {
            logger.warn('⚠️ [CSV INGESTION] Failed to load persisted CSV upload run; falling back to detection truth', {
                tenantId,
                userId,
                error: error?.message || 'Unknown error',
            });
        }

        return this.getLatestCsvUploadFallback(userId, tenantId);
    }

    async getCsvUploadRunBySyncId(userId: string, tenantId: string, syncId: string): Promise<CsvUploadRunSnapshot | null> {
        try {
            const { data, error } = await supabaseAdmin
                .from('csv_upload_runs')
                .select('sync_id, success, total_files, file_count, detection_triggered, detection_job_id, ingestion_results, files_summary, created_at, updated_at, started_at, completed_at, status, error, is_sandbox')
                .eq('tenant_id', tenantId)
                .eq('seller_id', userId)
                .eq('sync_id', syncId)
                .maybeSingle();

            if (error?.code === '42P01') {
                logger.warn('CSV upload run table is not deployed; falling back to detection truth for sync recovery', {
                    table: 'csv_upload_runs',
                    tenantId,
                    userId,
                    syncId,
                });
                return this.getCsvUploadFallbackBySyncId(userId, tenantId, syncId);
            }

            if (error && error.code !== 'PGRST116') {
                throw new Error(`Failed to load CSV upload run by sync id: ${error.message}`);
            }

            if (data?.sync_id) {
                const detection = await this.getCsvDetectionSnapshot(userId, tenantId, data.sync_id);
                return this.mapCsvUploadRunSnapshot(userId, data as CsvUploadRunRow, 'persisted_run', detection, null);
            }
        } catch (error: any) {
            logger.warn('⚠️ [CSV INGESTION] Failed to load CSV upload run by sync id; falling back to detection truth', {
                tenantId,
                userId,
                syncId,
                error: error?.message || 'Unknown error',
            });
        }

        return this.getCsvUploadFallbackBySyncId(userId, tenantId, syncId);
    }

    private normalizeHeader(value: string): string {
        return value.toLowerCase().replace(/[_\- ]/g, '');
    }

    private getCsvUploadSandboxFlag(): boolean {
        return process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox')
            || process.env.NODE_ENV === 'development';
    }

    private buildAcceptedCsvRunFilesSummary(
        files: { originalname: string; mimetype: string }[]
    ): CsvUploadRunFileSummary[] {
        return files.map((file) => ({
            fileName: file.originalname,
            mimeType: file.mimetype,
            status: 'accepted',
            errors: [],
        }));
    }

    private buildCsvRunFilesSummary(results: IngestionResult[]): CsvUploadRunFileSummary[] {
        return results.map((result) => ({
            fileName: result.fileName,
            status: !result.success
                ? 'failed'
                : result.rowsInserted > 0
                    ? 'ingested'
                    : 'duplicate',
            csvType: result.csvType,
            rowsProcessed: result.rowsProcessed,
            rowsInserted: result.rowsInserted,
            rowsSkipped: result.rowsSkipped,
            rowsFailed: result.rowsFailed,
            errors: result.errors || [],
            inputIssue: result.inputIssue || classifyCsvInputIssue(result.errors),
            persistenceStatus: result.persistenceStatus || 'not_attempted',
            persistenceError: result.persistenceError,
            persistenceOperations: result.persistenceOperations,
            duplicateOfSyncId: result.duplicateOfSyncId,
            warnings: result.warnings || [],
            temporalEvidence: result.temporalEvidence,
            detectionTriggered: result.detectionTriggered,
            detectionJobId: result.detectionJobId,
        }));
    }

    private normalizeCsvRunFilesSummary(
        filesSummaryRaw: unknown,
        ingestionResultsRaw: unknown
    ): CsvUploadRunFileSummary[] {
        const preferred = Array.isArray(filesSummaryRaw) && filesSummaryRaw.length > 0
            ? filesSummaryRaw
            : Array.isArray(ingestionResultsRaw)
                ? ingestionResultsRaw
                : [];

        return preferred.map((raw): CsvUploadRunFileSummary => {
            const entry = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
            const rowsInserted = Number(entry.rowsInserted || 0);
            const rowsSkipped = Number(entry.rowsSkipped || 0);
            const rowsFailed = Number(entry.rowsFailed || 0);
            const success = entry.success !== undefined ? !!entry.success : rowsFailed === 0;

            let status: CsvUploadRunFileSummary['status'] = 'accepted';
            if (typeof entry.status === 'string' && ['accepted', 'ingested', 'duplicate', 'failed'].includes(entry.status)) {
                status = entry.status as CsvUploadRunFileSummary['status'];
            } else if (!success) {
                status = 'failed';
            } else if (rowsInserted > 0) {
                status = 'ingested';
            } else if (rowsSkipped > 0) {
                status = 'duplicate';
            }

            return {
                fileName: String(entry.fileName || entry.originalname || 'Unknown file'),
                mimeType: typeof entry.mimeType === 'string' ? entry.mimeType : undefined,
                status,
                csvType: typeof entry.csvType === 'string' ? entry.csvType as CSVType : undefined,
                rowsProcessed: Number(entry.rowsProcessed || 0),
                rowsInserted,
                rowsSkipped,
                rowsFailed,
                errors: Array.isArray(entry.errors) ? entry.errors.map((value: unknown) => String(value)) : [],
                inputIssue: ['empty', 'malformed', 'ambiguous', 'unsupported', 'missing_required', 'invalid_value', 'prohibited'].includes(String(entry.inputIssue))
                    ? entry.inputIssue as CsvInputIssue
                    : classifyCsvInputIssue(entry.errors),
                persistenceStatus: ['not_attempted', 'succeeded', 'partial', 'failed'].includes(String(entry.persistenceStatus))
                    ? entry.persistenceStatus as PersistenceStatus
                    : 'not_attempted',
                persistenceError: typeof entry.persistenceError === 'string' ? entry.persistenceError : undefined,
                persistenceOperations: Array.isArray(entry.persistenceOperations) ? entry.persistenceOperations : undefined,
                duplicateOfSyncId: typeof entry.duplicateOfSyncId === 'string' ? entry.duplicateOfSyncId : undefined,
                warnings: Array.isArray(entry.warnings) ? entry.warnings.map((value: unknown) => String(value)) : [],
                temporalEvidence: normalizeManualFileTemporalEvidence(entry.temporalEvidence),
                detectionTriggered: !!entry.detectionTriggered,
                detectionJobId: typeof entry.detectionJobId === 'string' ? entry.detectionJobId : undefined,
            };
        });
    }

    private buildBatchResultFromCsvUploadRun(
        userId: string,
        row: CsvUploadRunRow,
        filesSummary: CsvUploadRunFileSummary[]
    ): BatchIngestionResult {
        const results: IngestionResult[] = filesSummary.map((entry) => ({
            success: entry.status !== 'failed',
            csvType: entry.csvType || 'unknown',
            fileName: entry.fileName,
            rowsProcessed: Number(entry.rowsProcessed || 0),
            rowsInserted: Number(entry.rowsInserted || 0),
            rowsSkipped: Number(entry.rowsSkipped || 0),
            rowsFailed: Number(entry.rowsFailed || 0),
            errors: entry.errors || [],
            inputIssue: entry.inputIssue || classifyCsvInputIssue(entry.errors),
            persistenceStatus: entry.persistenceStatus || 'not_attempted',
            persistenceError: entry.persistenceError,
            persistenceOperations: entry.persistenceOperations,
            duplicateOfSyncId: entry.duplicateOfSyncId,
            temporalEvidence: entry.temporalEvidence,
            detectionTriggered: !!entry.detectionTriggered,
            detectionJobId: entry.detectionJobId,
        }));

        return {
            success: !!row.success,
            userId,
            totalFiles: Number(row.file_count ?? row.total_files ?? filesSummary.length ?? 0),
            results,
            detectionTriggered: !!row.detection_triggered,
            detectionJobId: row.detection_job_id || undefined,
            syncId: row.sync_id,
        };
    }

    private buildCsvUploadRunError(results: IngestionResult[], batchError?: string | null): string | null {
        const messages = new Set<string>();

        if (batchError) {
            messages.add(batchError);
        }

        results.forEach((result) => {
            (result.errors || []).forEach((message) => {
                const normalized = typeof message === 'string' ? message.trim() : '';
                if (normalized) {
                    messages.add(normalized);
                }
            });
        });

        if (messages.size === 0) {
            return null;
        }

        return Array.from(messages).slice(0, 5).join(' | ');
    }

    private deriveCsvUploadRunStatus(
        results: IngestionResult[],
        options: {
            detectionTriggered?: boolean;
            detectionStatus?: DetectionQueueStatus | 'completed' | null;
            batchError?: string | null;
        } = {}
    ): CsvUploadRunStatus {
        const hasInserted = results.some((result) => result.rowsInserted > 0);
        const hasFailures = results.some((result) => !result.success || result.rowsFailed > 0);
        const hasSkippedOnly = !hasInserted && results.some((result) => result.rowsSkipped > 0) && !hasFailures;

        if (options.detectionStatus === 'processing' || options.detectionStatus === 'pending') {
            return 'detection_processing';
        }

        if (options.detectionStatus === 'failed') {
            return 'failed';
        }

        if (options.batchError && options.detectionTriggered && options.detectionStatus !== 'completed') {
            return 'failed';
        }

        if (options.batchError) {
            return hasInserted ? 'partial' : 'failed';
        }

        if (options.detectionTriggered && options.detectionStatus !== 'completed') {
            return 'detection_processing';
        }

        if (hasInserted) {
            return hasFailures ? 'partial' : 'completed';
        }

        if (hasSkippedOnly) {
            return 'completed';
        }

        if (hasFailures) {
            return 'failed';
        }

        return 'completed';
    }

    private isTerminalCsvUploadRunStatus(status: CsvUploadRunStatus): boolean {
        return status === 'completed' || status === 'partial' || status === 'failed';
    }

    private mapCsvUploadRunSnapshot(
        userId: string,
        row: CsvUploadRunRow,
        source: CsvUploadRunSource,
        detection: CsvUploadDetectionSnapshot | null,
        recoveryNotice: string | null
    ): CsvUploadRunSnapshot {
        const filesSummary = this.normalizeCsvRunFilesSummary(row.files_summary, row.ingestion_results);
        const status = row.status || this.deriveCsvUploadRunStatus(
            this.buildBatchResultFromCsvUploadRun(userId, row, filesSummary).results,
            {
                detectionTriggered: !!row.detection_triggered,
                detectionStatus: detection?.status || null,
                batchError: row.error,
            }
        );
        const uploadSummaryAvailable = status !== 'started' && filesSummary.length > 0;

        return {
            syncId: row.sync_id,
            source,
            uploadSummaryAvailable,
            recoveryNotice,
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || row.created_at || null,
            startedAt: row.started_at || row.created_at || null,
            completedAt: row.completed_at || null,
            status,
            fileCount: Number(row.file_count ?? row.total_files ?? filesSummary.length ?? 0),
            filesSummary,
            detectionTriggered: !!row.detection_triggered,
            detectionJobId: row.detection_job_id || undefined,
            error: row.error || null,
            isSandbox: !!row.is_sandbox,
            batchResult: uploadSummaryAvailable
                ? this.buildBatchResultFromCsvUploadRun(userId, row, filesSummary)
                : null,
            detection,
        };
    }

    private async persistCsvUploadRunRecord(
        tenantId: string,
        userId: string,
        syncId: string,
        patch: {
            success?: boolean;
            fileCount?: number;
            filesSummary?: CsvUploadRunFileSummary[];
            detectionTriggered?: boolean;
            detectionJobId?: string | null;
            startedAt?: string;
            completedAt?: string | null;
            status?: CsvUploadRunStatus;
            error?: string | null;
            isSandbox?: boolean;
        }
    ): Promise<void> {
        const nowIso = new Date().toISOString();
        const updatePayload: Record<string, unknown> = {
            updated_at: nowIso,
        };

        if (patch.success !== undefined) updatePayload.success = patch.success;
        if (patch.fileCount !== undefined) {
            updatePayload.total_files = patch.fileCount;
            updatePayload.file_count = patch.fileCount;
        }
        if (patch.filesSummary !== undefined) {
            updatePayload.files_summary = patch.filesSummary;
            updatePayload.ingestion_results = patch.filesSummary;
        }
        if (patch.detectionTriggered !== undefined) updatePayload.detection_triggered = patch.detectionTriggered;
        if (patch.detectionJobId !== undefined) updatePayload.detection_job_id = patch.detectionJobId;
        if (patch.startedAt !== undefined) updatePayload.started_at = patch.startedAt;
        if (patch.completedAt !== undefined) updatePayload.completed_at = patch.completedAt;
        if (patch.status !== undefined) updatePayload.status = patch.status;
        if (patch.error !== undefined) updatePayload.error = patch.error;
        if (patch.isSandbox !== undefined) updatePayload.is_sandbox = patch.isSandbox;

        const { data: updatedRows, error: updateError } = await supabaseAdmin
            .from('csv_upload_runs')
            .update(updatePayload)
            .eq('tenant_id', tenantId)
            .eq('seller_id', userId)
            .eq('sync_id', syncId)
            .select('sync_id');

        if (updateError?.code === '42P01') {
            logger.warn('CSV upload run table is not deployed; authoritative CSV run persistence skipped', {
                table: 'csv_upload_runs',
                tenantId,
                syncId,
            });
            return;
        }

        if (updateError) {
            throw new Error(`Failed to update CSV upload run: ${updateError.message}`);
        }

        if ((updatedRows || []).length > 0) {
            return;
        }

        const insertPayload = {
            tenant_id: tenantId,
            user_id: userId,
            seller_id: userId,
            sync_id: syncId,
            success: patch.success ?? false,
            total_files: patch.fileCount ?? 0,
            file_count: patch.fileCount ?? 0,
            detection_triggered: patch.detectionTriggered ?? false,
            detection_job_id: patch.detectionJobId ?? null,
            ingestion_results: patch.filesSummary ?? [],
            files_summary: patch.filesSummary ?? [],
            started_at: patch.startedAt || nowIso,
            completed_at: patch.completedAt ?? null,
            status: patch.status || 'started',
            error: patch.error ?? null,
            is_sandbox: patch.isSandbox ?? false,
        };

        const { error: insertError } = await supabaseAdmin
            .from('csv_upload_runs')
            .insert(insertPayload);

        if (insertError?.code === '42P01') {
            logger.warn('CSV upload run table is not deployed; authoritative CSV run insert skipped', {
                table: 'csv_upload_runs',
                tenantId,
                syncId,
            });
            return;
        }

        if (insertError) {
            throw new Error(`Failed to persist CSV upload run: ${insertError.message}`);
        }
    }

    private async getCsvDetectionSnapshot(userId: string, tenantId: string, syncId: string): Promise<CsvUploadDetectionSnapshot | null> {
        const [{ data: queueRows, error: queueError }, { count: resultsTotal, error: resultsError }] = await Promise.all([
            supabaseAdmin
                .from('detection_queue')
                .select('status, processed_at, error_message, created_at, updated_at, payload')
                .eq('tenant_id', tenantId)
                .eq('seller_id', userId)
                .eq('sync_id', syncId)
                .order('updated_at', { ascending: false })
                .limit(1),
            supabaseAdmin
                .from('detection_results')
                .select('id', { count: 'exact', head: true })
                .eq('tenant_id', tenantId)
                .eq('seller_id', userId)
                .eq('sync_id', syncId),
        ]);

        if (queueError) {
            throw new Error(`Failed to load detection queue snapshot: ${queueError.message}`);
        }

        if (resultsError) {
            throw new Error(`Failed to load detection results count: ${resultsError.message}`);
        }

        const queueRow = Array.isArray(queueRows) && queueRows.length > 0 ? (queueRows[0] as DetectionQueueRow) : null;
        const total = Number(resultsTotal || 0);

        if (!queueRow && total === 0) {
            return null;
        }

        return {
            status: (queueRow?.status as DetectionQueueStatus | undefined) || (total > 0 ? 'completed' : null),
            processedAt: queueRow?.processed_at || null,
            errorMessage: queueRow?.error_message || null,
            resultsTotal: total,
            isSandbox: this.getDetectionQueueSandboxFlag(queueRow),
        };
    }

    private async getLatestCsvUploadFallback(userId: string, tenantId: string): Promise<CsvUploadRunSnapshot | null> {
        const { data: latestQueueRows, error: queueError } = await supabaseAdmin
            .from('detection_queue')
            .select('sync_id, created_at, updated_at, status, processed_at, error_message, payload')
            .eq('tenant_id', tenantId)
            .eq('seller_id', userId)
            .like('sync_id', 'csv_%')
            .order('updated_at', { ascending: false })
            .limit(1);

        if (queueError) {
            throw new Error(`Failed to load latest CSV detection queue fallback: ${queueError.message}`);
        }

        const latestQueueRow = Array.isArray(latestQueueRows) && latestQueueRows.length > 0 ? (latestQueueRows[0] as DetectionQueueRow) : null;
        if (latestQueueRow?.sync_id) {
            const detection = await this.getCsvDetectionSnapshot(userId, tenantId, latestQueueRow.sync_id);
            return {
                syncId: latestQueueRow.sync_id,
                source: 'detection_queue_fallback',
                uploadSummaryAvailable: false,
                recoveryNotice: 'Per-file upload summary is not persisted for this CSV run yet. Detection truth was restored from the latest CSV detection record only.',
                createdAt: latestQueueRow.created_at || null,
                updatedAt: latestQueueRow.updated_at || latestQueueRow.created_at || null,
                startedAt: latestQueueRow.created_at || null,
                completedAt: latestQueueRow.processed_at || null,
                status: detection?.status === 'failed'
                    ? 'failed'
                    : detection?.status === 'completed'
                        ? 'completed'
                        : detection?.status === 'processing' || detection?.status === 'pending'
                            ? 'detection_processing'
                            : null,
                fileCount: 0,
                filesSummary: [],
                detectionTriggered: true,
                detectionJobId: undefined,
                error: latestQueueRow.error_message || null,
                isSandbox: this.getDetectionQueueSandboxFlag(latestQueueRow),
                batchResult: null,
                detection,
            };
        }

        const { data: latestResultRows, error: resultsError } = await supabaseAdmin
            .from('detection_results')
            .select('sync_id, created_at')
            .eq('tenant_id', tenantId)
            .eq('seller_id', userId)
            .like('sync_id', 'csv_%')
            .order('created_at', { ascending: false })
            .limit(1);

        if (resultsError) {
            throw new Error(`Failed to load latest CSV detection-results fallback: ${resultsError.message}`);
        }

        const latestResultRow = Array.isArray(latestResultRows) && latestResultRows.length > 0 ? latestResultRows[0] : null;
        if (!latestResultRow?.sync_id) {
            return null;
        }

        const detection = await this.getCsvDetectionSnapshot(userId, tenantId, latestResultRow.sync_id);

        return {
            syncId: latestResultRow.sync_id,
            source: 'detection_results_fallback',
            uploadSummaryAvailable: false,
            recoveryNotice: 'Per-file upload summary is not persisted for this CSV run yet. Detection truth was restored from persisted findings only.',
            createdAt: latestResultRow.created_at || null,
            updatedAt: latestResultRow.created_at || null,
            startedAt: latestResultRow.created_at || null,
            completedAt: detection?.processedAt || latestResultRow.created_at || null,
            status: detection?.status === 'failed'
                ? 'failed'
                : detection?.status === 'processing' || detection?.status === 'pending'
                    ? 'detection_processing'
                    : 'completed',
            fileCount: 0,
            filesSummary: [],
            detectionTriggered: true,
            detectionJobId: undefined,
            error: detection?.errorMessage || null,
            isSandbox: detection?.isSandbox || false,
            batchResult: null,
            detection,
        };
    }

    private async getCsvUploadFallbackBySyncId(userId: string, tenantId: string, syncId: string): Promise<CsvUploadRunSnapshot | null> {
        const { data: queueRows, error: queueError } = await supabaseAdmin
            .from('detection_queue')
            .select('sync_id, created_at, updated_at, status, processed_at, error_message, payload')
            .eq('tenant_id', tenantId)
            .eq('seller_id', userId)
            .eq('sync_id', syncId)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (queueError) {
            throw new Error(`Failed to load CSV detection queue fallback by sync id: ${queueError.message}`);
        }

        const queueRow = Array.isArray(queueRows) && queueRows.length > 0 ? (queueRows[0] as DetectionQueueRow) : null;
        if (queueRow?.sync_id) {
            const detection = await this.getCsvDetectionSnapshot(userId, tenantId, queueRow.sync_id);
            return {
                syncId: queueRow.sync_id,
                source: 'detection_queue_fallback',
                uploadSummaryAvailable: false,
                recoveryNotice: 'Per-file upload summary is not persisted for this CSV run yet. Detection truth was restored from the CSV detection queue only.',
                createdAt: queueRow.created_at || null,
                updatedAt: queueRow.updated_at || queueRow.created_at || null,
                startedAt: queueRow.created_at || null,
                completedAt: queueRow.processed_at || null,
                status: detection?.status === 'failed'
                    ? 'failed'
                    : detection?.status === 'completed'
                        ? 'completed'
                        : detection?.status === 'processing' || detection?.status === 'pending'
                            ? 'detection_processing'
                            : null,
                fileCount: 0,
                filesSummary: [],
                detectionTriggered: true,
                detectionJobId: undefined,
                error: queueRow.error_message || null,
                isSandbox: this.getDetectionQueueSandboxFlag(queueRow),
                batchResult: null,
                detection,
            };
        }

        const { data: resultRows, error: resultsError } = await supabaseAdmin
            .from('detection_results')
            .select('sync_id, created_at')
            .eq('tenant_id', tenantId)
            .eq('seller_id', userId)
            .eq('sync_id', syncId)
            .limit(1)
            .maybeSingle();

        if (resultsError && resultsError.code !== 'PGRST116') {
            throw new Error(`Failed to load CSV detection-results fallback by sync id: ${resultsError.message}`);
        }

        if (!resultRows?.sync_id) {
            return null;
        }

        const detection = await this.getCsvDetectionSnapshot(userId, tenantId, resultRows.sync_id);

        return {
            syncId: resultRows.sync_id,
            source: 'detection_results_fallback',
            uploadSummaryAvailable: false,
            recoveryNotice: 'Per-file upload summary is not persisted for this CSV run yet. Detection truth was restored from persisted findings only.',
            createdAt: resultRows.created_at || null,
            updatedAt: resultRows.created_at || null,
            startedAt: resultRows.created_at || null,
            completedAt: detection?.processedAt || resultRows.created_at || null,
            status: detection?.status === 'failed'
                ? 'failed'
                : detection?.status === 'processing' || detection?.status === 'pending'
                    ? 'detection_processing'
                    : 'completed',
            fileCount: 0,
            filesSummary: [],
            detectionTriggered: true,
            detectionJobId: undefined,
            error: detection?.errorMessage || null,
            isSandbox: detection?.isSandbox || false,
            batchResult: null,
            detection,
        };
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
            .select('id, file_name, created_at')
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
            const duplicateState = await this.resolveCsvDuplicateRegistrationState(
                tenantId,
                userId,
                csvType,
                String((data as CsvIngestionRunRow).file_name || fileName),
                data as CsvIngestionRunRow
            );

            if (duplicateState === 'trusted' || duplicateState === 'active') {
                return true;
            }

            const { error: releaseError } = await supabaseAdmin
                .from('csv_ingestion_runs')
                .delete()
                .eq('id', data.id);

            if (releaseError && releaseError.code !== 'PGRST116') {
                throw new Error(`Failed to release stale duplicate registration: ${releaseError.message}`);
            }

            logger.info('♻️ [CSV INGESTION] Released stale duplicate registration for retry', {
                tenantId,
                userId,
                csvType,
                fileName,
                registrationId: data.id,
                previousCreatedAt: (data as CsvIngestionRunRow).created_at || null,
            });
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

    private async resolveCsvDuplicateRegistrationState(
        tenantId: string,
        userId: string,
        csvType: CSVType,
        fileName: string,
        registration: CsvIngestionRunRow
    ): Promise<'trusted' | 'active' | 'stale'> {
        const { data: runRows, error } = await supabaseAdmin
            .from('csv_upload_runs')
            .select('sync_id, success, total_files, file_count, detection_triggered, detection_job_id, ingestion_results, files_summary, created_at, updated_at, started_at, completed_at, status, error, is_sandbox')
            .eq('tenant_id', tenantId)
            .eq('seller_id', userId)
            .order('started_at', { ascending: false })
            .limit(25);

        if (error?.code === '42P01') {
            logger.warn('CSV upload run table is not deployed; duplicate lock cannot be verified authoritatively', {
                table: 'csv_upload_runs',
                tenantId,
                userId,
                csvType,
                fileName,
            });
            return 'stale';
        }

        if (error) {
            throw new Error(`Failed to verify duplicate registration state: ${error.message}`);
        }

        const registrationTime = registration.created_at ? Date.parse(registration.created_at) : Number.NaN;
        const normalizedFileName = this.normalizeCsvFileName(fileName);
        const candidates = (runRows || [])
            .map((row) => {
                const typedRow = row as CsvUploadRunRow;
                const filesSummary = this.normalizeCsvRunFilesSummary(typedRow.files_summary, typedRow.ingestion_results);
                const matchingFile = filesSummary.some((entry) => {
                    if (this.normalizeCsvFileName(entry.fileName) !== normalizedFileName) {
                        return false;
                    }

                    return !entry.csvType || entry.csvType === csvType;
                });

                if (!matchingFile) {
                    return null;
                }

                const anchorRaw = typedRow.started_at || typedRow.created_at || typedRow.updated_at || typedRow.completed_at;
                const anchorTime = anchorRaw ? Date.parse(anchorRaw) : Number.NaN;
                const windowStartRaw = typedRow.started_at || typedRow.created_at || typedRow.updated_at;
                const windowEndRaw = typedRow.completed_at || typedRow.updated_at || typedRow.created_at || typedRow.started_at;
                const windowStart = windowStartRaw ? Date.parse(windowStartRaw) - (2 * 60 * 1000) : Number.NaN;
                const windowEnd = windowEndRaw ? Date.parse(windowEndRaw) + (5 * 60 * 1000) : Number.NaN;
                const inWindow = Number.isFinite(registrationTime) && Number.isFinite(windowStart) && Number.isFinite(windowEnd)
                    ? registrationTime >= windowStart && registrationTime <= windowEnd
                    : false;
                const distance = Number.isFinite(registrationTime) && Number.isFinite(anchorTime)
                    ? Math.abs(registrationTime - anchorTime)
                    : Number.MAX_SAFE_INTEGER;

                return {
                    row: typedRow,
                    filesSummary,
                    inWindow,
                    distance,
                };
            })
            .filter((entry): entry is { row: CsvUploadRunRow; filesSummary: CsvUploadRunFileSummary[]; inWindow: boolean; distance: number } => !!entry)
            .sort((left, right) => {
                if (left.inWindow !== right.inWindow) {
                    return left.inWindow ? -1 : 1;
                }

                return left.distance - right.distance;
            });

        const candidate = candidates[0];
        if (!candidate) {
            return 'stale';
        }

        let detection: CsvUploadDetectionSnapshot | null = null;
        try {
            if (candidate.row.sync_id) {
                detection = await this.getCsvDetectionSnapshot(userId, tenantId, candidate.row.sync_id);
            }
        } catch (snapshotError: any) {
            logger.warn('⚠️ [CSV INGESTION] Failed to refresh detection snapshot while verifying duplicate registration', {
                tenantId,
                userId,
                csvType,
                fileName,
                syncId: candidate.row.sync_id,
                error: snapshotError?.message || 'Unknown error',
            });
        }

        const effectiveStatus = this.deriveCsvUploadRunStatus(
            this.buildBatchResultFromCsvUploadRun(userId, candidate.row, candidate.filesSummary).results,
            {
                detectionTriggered: !!candidate.row.detection_triggered,
                detectionStatus: detection?.status || null,
                batchError: candidate.row.error,
            }
        );

        if (effectiveStatus === 'completed') {
            return 'trusted';
        }

        if (effectiveStatus === 'started' || effectiveStatus === 'detection_processing') {
            return 'active';
        }

        return 'stale';
    }

    /**
     * Ingest a single CSV file
     */
    private async ingestSingleFile(
        userId: string,
        file: { buffer: Buffer; originalname: string; mimetype: string },
        syncId: string,
        options: { explicitType?: CSVType; storeId?: string; tenantId?: string; rejectTransferLikeInventoryRows?: boolean }
    ): Promise<IngestionResult> {
        if (!options.tenantId) {
            throw new Error('tenantId is required for CSV ingestion');
        }

        const content = file.buffer.toString('utf-8');
        const records = parseManualAuditDelimitedRecords(content);

                if (records.length === 0) {
            try {
                const headers = parseManualAuditHeaders(content);
                const csvType = options.explicitType || detectCSVType(headers, file.originalname);
                if (csvType !== 'unknown' && !DISABLED_TYPES.has(csvType)) {
                    const headerValidation = this.hasRequiredHeaders(csvType, headers);
                    if (headerValidation.ok) {
                        return {
                            success: true,
                            csvType,
                            fileName: file.originalname,
                            rowsProcessed: 0,
                            rowsInserted: 0,
                            rowsSkipped: 0,
                            rowsFailed: 0,
                            errors: [],
                            inputIssue: 'empty',
                            temporalEvidence: {
                                status: 'unavailable',
                                sourceDateField: null,
                                earliestAt: null,
                                latestAt: null,
                                observedDateCount: 0,
                                continuity: 'unknown',
                                reason: 'The report family was recognized from its headers, but no data rows were supplied.',
                            },
                            detectionTriggered: false,
                        };
                    }
                }
            } catch {
                // Fall through to the safe unknown/empty response below.
            }
            return {
                success: false,
                csvType: 'unknown',
                fileName: file.originalname,
                rowsProcessed: 0,
                rowsInserted: 0,
                rowsSkipped: 0,
                rowsFailed: 0,
                errors: ['CSV file is empty or has no data rows'],
                inputIssue: 'empty',
                detectionTriggered: false,
            };
        }
        // Detect CSV type
        const headers = Object.keys(records[0]);
        const csvType = options.explicitType || detectCSVType(headers, file.originalname);

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
                    `Unsupported report structure: Margin could not identify a supported report family from the supplied headers. ` +
                    `Supported types: orders, shipments, returns, settlements, inventory, financial events, and fees. ` +
                    `Use the explicit report-type upload only when the source report family is known.`
                ],
                inputIssue: 'unsupported',
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
                errors: [`Unsupported report structure: ${csvType} is not available for this upload.`],
                inputIssue: 'unsupported',
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
                inputIssue: 'missing_required',
                detectionTriggered: false,
            };
        }

        const aliasConflict = findCriticalAliasConflict(records, csvType);
        if (aliasConflict) {
            return {
                success: false,
                csvType,
                fileName: file.originalname,
                rowsProcessed: records.length,
                rowsInserted: 0,
                rowsSkipped: records.length,
                rowsFailed: records.length,
                errors: [`Ambiguous critical evidence at row ${aliasConflict.rowNumber}: conflicting aliases for ${aliasConflict.field}. Margin did not choose a value.`],
                inputIssue: 'ambiguous',
                detectionTriggered: false,
            };
        }

        const prohibitedInventoryRecords = options.rejectTransferLikeInventoryRows && csvType === 'inventory'
            ? records.filter((record) => {
                const eventType = getField(record, 'Event Type', 'event_type', 'EventType', 'type');
                const normalized = String(eventType || '').trim().toLowerCase();
                return normalized === 'transfer' || normalized === 'transfers';
            })
            : [];
        const admissibleRecords = prohibitedInventoryRecords.length > 0
            ? records.filter((record) => !prohibitedInventoryRecords.includes(record))
            : records;

        if (prohibitedInventoryRecords.length === records.length) {
            return {
                success: false,
                csvType,
                fileName: file.originalname,
                rowsProcessed: records.length,
                rowsInserted: 0,
                rowsSkipped: records.length,
                rowsFailed: records.length,
                errors: ['Transfer-like inventory ledger input is prohibited while Transfer is OFF. No canonical Transfer evidence was persisted or sent to detection.'],
                inputIssue: 'prohibited',
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
        const result = await this.ingestByType(userId, options.tenantId, csvType, admissibleRecords, syncId, options.storeId);
        const rejectedTransferRowCount = prohibitedInventoryRecords.length;
        const errors = rejectedTransferRowCount > 0
            ? [
                ...(result.errors || []),
                `Rejected ${rejectedTransferRowCount} Transfer-labelled inventory ledger row(s): Transfer is OFF and the rows were not persisted or sent to detection.`,
            ]
            : result.errors;
        const normalizedResult: Omit<IngestionResult, 'fileName'> = {
            ...result,
            rowsProcessed: records.length,
            rowsSkipped: result.rowsSkipped + rejectedTransferRowCount,
            rowsFailed: result.rowsFailed + rejectedTransferRowCount,
            errors,
            inputIssue: rejectedTransferRowCount > 0 ? 'prohibited' : result.inputIssue || classifyCsvInputIssue(errors),
        };

        return {
            ...normalizedResult,
            fileName: file.originalname,
            temporalEvidence: deriveManualFileTemporalEvidence(admissibleRecords, csvType, normalizedResult),
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
        const candidates: any[] = [];
        const warnings: string[] = [];
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

                candidates.push({
                    id: uuidv4(),
                    __csv_row_number: i + 1,
                    __csv_source_record: r,
                    tenant_id: tenantId,
                    user_id: userId,
                    store_id: storeId || null,
                    order_id: orderId,
                    seller_id: getField(r, 'SellerId', 'seller_id', 'sellerId') || userId,
                    marketplace_id: getField(r, 'MarketplaceId', 'marketplace_id', 'marketplaceId') || 'ATVPDKIKX0DER',
                    order_date: parseRequiredIsoDateField(orderDate, 'order_date'),
                    order_status: getField(r, 'OrderStatus', 'order_status', 'orderStatus', 'Status') || 'Shipped',
                    fulfillment_channel: getField(r, 'FulfillmentChannel', 'fulfillment_channel', 'fulfillmentChannel') || 'FBA',
                    total_amount: parseRequiredNumericField(
                        getField(r, 'OrderTotal', 'total_amount', 'totalAmount', 'Amount', 'amount'),
                        'total_amount'
                    ),
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    items: [],
                    quantities: {},
                    sync_id: syncId,
                    sync_timestamp: new Date().toISOString(),
                    source: 'csv_upload',
                    is_sandbox: false,
                    metadata: {},
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
                skipped++;
            }
        }

        const rows: any[] = [];
        const byOrderId = new Map<string, any[]>();
        for (const candidate of candidates) {
            const key = String(candidate.order_id || '').trim();
            byOrderId.set(key, [...(byOrderId.get(key) || []), candidate]);
        }

        const comparableFields = [
            'seller_id',
            'marketplace_id',
            'order_date',
            'order_status',
            'fulfillment_channel',
            'total_amount',
            'currency',
        ];

        for (const [orderId, group] of byOrderId) {
            const canonical = { ...group[0] };
            const duplicateObservations = group.map((row, index) => ({
                row_number: row.__csv_row_number,
                canonical: index === 0,
                order_id: row.order_id,
                seller_id: row.seller_id,
                marketplace_id: row.marketplace_id,
                order_date: row.order_date,
                order_status: row.order_status,
                fulfillment_channel: row.fulfillment_channel,
                total_amount: row.total_amount,
                currency: row.currency,
                source_record: row.__csv_source_record,
            }));

            if (group.length > 1) {
                const conflictFields = comparableFields.filter(field => {
                    const first = JSON.stringify(group[0][field] ?? null);
                    return group.some(row => JSON.stringify(row[field] ?? null) !== first);
                });
                const conflictType = conflictFields.length > 0 ? 'conflicting_duplicate' : 'exact_duplicate';

                canonical.metadata = {
                    ...(canonical.metadata || {}),
                    csv_duplicate_summary: {
                        observed_count: group.length,
                        duplicate_count: group.length - 1,
                        conflict_type: conflictType,
                        conflict_fields: conflictFields,
                    },
                    csv_duplicate_observations: duplicateObservations,
                };

                skipped += group.length - 1;
                warnings.push(
                    conflictFields.length
                        ? `Order ${orderId}: collapsed ${group.length} duplicate CSV rows with conflicting fields (${conflictFields.join(', ')}).`
                        : `Order ${orderId}: collapsed ${group.length} exact duplicate CSV rows.`
                );
            }

            delete canonical.__csv_row_number;
            delete canonical.__csv_source_record;
            rows.push(canonical);
        }

        const result = await this.batchUpsert('orders', rows, 'orders', errors, skipped);
        return { ...result, warnings };
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
                    shipped_date: parseRequiredIsoDateField(shippedDate, 'shipped_date'),
                    received_date: parseOptionalIsoDateField(
                        getField(r, 'ReceivedDate', 'received_date', 'receivedDate'),
                        'received_date',
                    ),
                    status: getField(r, 'ShipmentStatus', 'status', 'Status') || 'RECEIVED',
                    carrier: getField(r, 'Carrier', 'carrier') || null,
                    tracking_number: getField(r, 'TrackingNumber', 'tracking_number', 'trackingNumber') || null,
                    warehouse_location: getField(r, 'DestinationFulfillmentCenterId', 'warehouse_location', 'fulfillmentCenter', 'warehouse', 'FC Location') || null,
                    items: [{
                        sku: getField(r, 'sku', 'SKU', 'sellerSku', 'seller_sku') || null,
                        asin: getField(r, 'asin', 'ASIN') || null,
                        fnsku: getField(r, 'fnsku', 'FNSKU', 'fnSku', 'fn_sku') || null,
                    }],
                    shipped_quantity: parseOptionalNonNegativeNumericField(getField(r, 'QuantityShipped', 'shipped_quantity', 'quantityShipped', 'Units Shipped'), 'shipped_quantity'),
                    received_quantity: parseOptionalNonNegativeNumericField(getField(r, 'QuantityReceived', 'received_quantity', 'quantityReceived', 'Units Received'), 'received_quantity'),
                    missing_quantity: parseOptionalNonNegativeNumericField(getField(r, 'QuantityMissing', 'missing_quantity', 'quantityMissing'), 'missing_quantity'),
                    metadata: {
                        sku: getField(r, 'sku', 'SKU', 'sellerSku', 'seller_sku') || null,
                        asin: getField(r, 'asin', 'ASIN') || null,
                        fnsku: getField(r, 'fnsku', 'FNSKU', 'fnSku', 'fn_sku') || null,
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
                    returned_date: parseRequiredIsoDateField(returnDate, 'returned_date'),
                    status: getField(r, 'ReturnStatus', 'status', 'Status') || 'RECEIVED',
                    refund_amount: parseOptionalAmountField(
                        getField(r, 'RefundAmount', 'refund_amount', 'refundAmount', 'Amount'),
                        'refund_amount',
                    ),
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    items: [{
                        sku: getField(r, 'sku', 'SKU', 'sellerSku', 'seller_sku') || null,
                        asin: getField(r, 'asin', 'ASIN') || null,
                        fnsku: getField(r, 'FNSKU', 'fnsku', 'FulfillmentNetworkSKU', 'fulfillmentNetworkSku') || null,
                        quantity: parseRequiredNonNegativeNumericField(getField(r, 'quantity', 'Quantity'), 'quantity'),
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
        const financialRows: any[] = [];
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

                const amount = parseRequiredAmountField(
                    getField(r, 'Amount', 'amount', 'TotalAmount', 'total_amount'),
                    'amount'
                );
                const reimbursementEvidence = {
                    fnsku: getField(r, 'FNSKU', 'fnsku', 'FulfillmentNetworkSKU', 'fulfillmentNetworkSku') || null,
                    sku: getField(r, 'SellerSKU', 'seller_sku', 'sku', 'SKU') || null,
                    asin: getField(r, 'ASIN', 'asin') || null,
                    quantity: parseOptionalNonNegativeNumericField(
                        getField(r, 'Quantity', 'quantity', 'QuantityReimbursed', 'quantity_reimbursed'),
                        'quantity'
                    ),
                    fulfillmentCenterId: getField(r, 'FulfillmentCenterId', 'fulfillment_center_id', 'Fulfillment Center', 'fulfillment_center', 'FC') || null,
                    reason: getField(r, 'Reason', 'reason', 'ReasonCode', 'reason_code') || null,
                };

                rows.push({
                    id: uuidv4(),
                    tenant_id: tenantId,
                    user_id: userId,
                    store_id: storeId || null,
                    settlement_id: settlementId,
                    order_id: getField(r, 'AmazonOrderId', 'order_id', 'orderId') || null,
                    transaction_type: transactionType,
                    amount,
                    fees: parseOptionalAmountField(getField(r, 'Fees', 'fees', 'TotalFees', 'total_fees'), 'fees'),
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                    settlement_date: parseRequiredIsoDateField(settlementDate, 'settlement_date'),
                    fee_breakdown: {},
                    metadata: reimbursementEvidence,
                    sync_id: syncId,
                    sync_timestamp: new Date().toISOString(),
                    source: 'csv_upload',
                    is_sandbox: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });

                const classification = classifyFinancialEventType(transactionType, transactionType);
                financialRows.push(
                    buildCanonicalFinancialEventRow({
                        sellerId: userId,
                        tenantId,
                        storeId: storeId || null,
                        syncId,
                        source: 'csv_upload',
                        eventType: classification.eventType,
                        eventSubtype: classification.eventSubtype || transactionType,
                        amount,
                        currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                        eventDate: parseRequiredIsoDateField(settlementDate, 'settlement_date'),
                        referenceId: settlementId,
                        referenceType: classification.referenceType || 'settlement',
                        settlementId,
                        payoutBatchId: settlementId,
                        amazonEventId: `csv_settlement:${settlementId}:${classification.eventType}:${transactionType}:${getField(r, 'AmazonOrderId', 'order_id', 'orderId') || ''}:${getField(r, 'SellerSKU', 'seller_sku', 'sku', 'SKU') || ''}:${getField(r, 'FNSKU', 'fnsku', 'FulfillmentNetworkSKU', 'fulfillmentNetworkSku') || ''}:${amount}:${i + 1}`,
                        amazonOrderId: getField(r, 'AmazonOrderId', 'order_id', 'orderId') || null,
                        amazonSku: getField(r, 'SellerSKU', 'seller_sku', 'sku', 'SKU') || null,
                        sku: getField(r, 'SellerSKU', 'seller_sku', 'sku', 'SKU') || null,
                        asin: getField(r, 'ASIN', 'asin') || null,
                        description: transactionType,
                        rawPayload: r,
                        metadata: {
                            csvType: 'settlements',
                            fees: parseOptionalAmountField(getField(r, 'Fees', 'fees', 'TotalFees', 'total_fees'), 'fees'),
                            ...reimbursementEvidence,
                        },
                        isPayoutEvent: classification.isPayoutEvent && amount > 0
                    })
                );
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
                skipped++;
            }
        }

        const settlementResult = await this.batchUpsert('settlements', rows, 'settlements', errors, skipped, 'settlements insert/upsert');
        const financialResult = await this.batchUpsert('financial_events', financialRows, 'settlement_financial_events', errors, 0, 'financial_events insert/upsert');
        const persistenceOperations = [
            ...(settlementResult.persistenceOperations || []),
            ...(financialResult.persistenceOperations || []),
        ];
        const persistenceStatus: PersistenceStatus = settlementResult.persistenceStatus === 'failed' || financialResult.persistenceStatus === 'failed'
            ? (settlementResult.persistenceStatus === 'succeeded' || financialResult.persistenceStatus === 'succeeded' ? 'partial' : 'failed')
            : settlementResult.persistenceStatus === 'not_attempted' && financialResult.persistenceStatus === 'not_attempted'
                ? 'not_attempted'
                : 'succeeded';

        return {
            success: settlementResult.success && financialResult.success,
            csvType: 'settlements',
            rowsProcessed: settlementResult.rowsProcessed,
            rowsInserted: settlementResult.rowsInserted,
            rowsSkipped: settlementResult.rowsSkipped,
            rowsFailed: settlementResult.rowsFailed + financialResult.rowsFailed,
            errors,
            persistenceStatus,
            persistenceError: persistenceOperations.find((entry) => entry.status === 'failed')?.message,
            persistenceOperations,
            detectionTriggered: false,
        };
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
        const hasSnapshotColumns = records.length > 0 && (
            getField(records[0], 'availableQuantity', 'available', 'quantity_available') !== null ||
            getField(records[0], 'reservedQuantity', 'reserved', 'quantity_reserved') !== null ||
            getField(records[0], 'inboundQuantity', 'inbound', 'quantity_inbound') !== null ||
            getField(records[0], 'price', 'Price', 'yourPrice', 'your_price') !== null
        );
        const isLedgerOnlyInventory = hasLedgerColumns && !hasSnapshotColumns;

        if (isLedgerOnlyInventory) {
            return this.ingestInventoryLedgerEvents(userId, tenantId, records, syncId, storeId);
        }

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
                    quantity_available: parseOptionalNonNegativeNumericField(
                        getField(r, 'availableQuantity', 'available', 'quantity_available', 'quantity', 'Quantity'),
                        'quantity_available',
                    ),
                    quantity_reserved: parseOptionalNonNegativeNumericField(
                        getField(r, 'reservedQuantity', 'reserved', 'quantity_reserved'),
                        'quantity_reserved',
                    ),
                    quantity_inbound: parseOptionalNonNegativeNumericField(
                        getField(r, 'inboundQuantity', 'inbound', 'quantity_inbound'),
                        'quantity_inbound',
                    ),
                    price: parseOptionalNonNegativeNumericField(
                        getField(r, 'price', 'Price', 'yourPrice', 'your_price'),
                        'price',
                    ),
                    dimensions: {
                        damaged: parseOptionalNonNegativeNumericField(
                            getField(r, 'damagedQuantity', 'damaged', 'quantity_damaged'),
                            'quantity_damaged',
                        ),
                        unfulfillable: parseOptionalNonNegativeNumericField(
                            getField(r, 'unfulfillableQuantity', 'unfulfillable', 'quantity_unfulfillable'),
                            'quantity_unfulfillable',
                        ),
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
        if (hasLedgerColumns) {
            const ledgerResult = await this.ingestInventoryLedgerEvents(userId, tenantId, records, syncId, storeId);
            result.success = result.success || ledgerResult.success;
            result.rowsInserted += ledgerResult.rowsInserted;
            result.rowsSkipped += ledgerResult.rowsSkipped;
            result.rowsFailed += ledgerResult.rowsFailed;
            result.errors = Array.from(new Set([...(result.errors || []), ...(ledgerResult.errors || [])]));
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
    ): Promise<Omit<IngestionResult, 'fileName'>> {
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
        let skipped = 0;

        for (let i = 0; i < records.length; i++) {
            try {
                const r = records[i];
                const rawEventType = getField(r, 'Event Type', 'event_type', 'EventType', 'type') || 'Adjustment';
                const fnsku = getField(r, 'FNSKU', 'fnsku', 'fn_sku', 'fnSku', 'sku', 'SKU');

                if (!fnsku) {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing FNSKU, skipping ledger event`);
                    continue;
                }

                const rawQuantity = parseRequiredNumericField(getField(r, 'Quantity', 'quantity', 'qty'), 'quantity');

                // Map the CSV event type to our internal type
                const mapped = EVENT_TYPE_MAP[rawEventType.toLowerCase()] || { eventType: 'Adjustment', direction: rawQuantity >= 0 ? 'in' : 'out' };

                // For transfers: quantity sign determines direction
                let direction = mapped.direction;
                if (mapped.eventType === 'Transfer') {
                    direction = rawQuantity >= 0 ? 'in' : 'out';
                }

                const eventDate = parseRequiredIsoDateField(
                    getField(r, 'Date', 'date', 'event_date', 'EventDate', 'PostedDate'),
                    'event_date',
                );

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
                    event_date: eventDate,
                    fulfillment_center: getField(r, 'Fulfillment Center', 'fulfillment_center', 'FulfillmentCenter', 'FC', 'warehouse') || null,
                    disposition: getField(r, 'Disposition', 'disposition') || null,
                    reason: getField(r, 'Reason', 'reason') || null,
                    reference_id: getField(r, 'Reference ID', 'reference_id', 'ReferenceId', 'ref_id', 'event_id', 'EventId', 'eventId') || null,
                    unit_cost: parseOptionalNumericField(
                        getField(r, 'Unit Cost', 'unit_cost', 'UnitCost', 'Unit Price', 'unit_price', 'UnitPrice', 'Price', 'price'),
                        'unit cost'
                    ),
                    average_sales_price: null,
                    country: getField(r, 'Country', 'country') || 'US',
                    raw_payload: r,
                    source: 'csv_upload',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
            } catch (error: any) {
                errors.push(`Ledger Row ${i + 1}: ${error.message}`);
                skipped++;
            }
        }

        if (ledgerRows.length === 0) {
            logger.warn('📊 [CSV INGESTION] No inventory ledger events to write', { userId, syncId });
            return {
                success: false,
                csvType: 'inventory',
                rowsProcessed: records.length,
                rowsInserted: 0,
                rowsSkipped: skipped,
                rowsFailed: 0,
                errors,
                detectionTriggered: false,
            };
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
        const result = await this.batchUpsert(
            'inventory_ledger_events',
            ledgerRows,
            'inventory_ledger',
            errors,
            skipped,
            `inventory_ledger_events insert (${Object.keys(balanceByFnsku).length} calculated snapshots included)`,
        );

        logger.info('📊 [CSV INGESTION] Inventory ledger events written', {
            userId,
            syncId,
            ledgerEventsInserted: result.rowsInserted,
            snapshotsCreated: Object.keys(balanceByFnsku).length,
            uniqueFnskus: Object.keys(balanceByFnsku).length,
            errors: errors.length > 0 ? errors : undefined,
        });

        return {
            ...result,
            csvType: 'inventory',
            rowsProcessed: records.length,
            persistenceError: result.persistenceError,
            persistenceOperations: result.persistenceOperations,
        };
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
                if (!rawEventType) {
                    skipped++;
                    errors.push(`Row ${i + 1}: Missing required field (event_type)`);
                    continue;
                }
                const eventDate = parseRequiredIsoDateField(
                    getField(r, 'PostedDate', 'event_date', 'postedDate', 'posted_date', 'date', 'Date'),
                    'event_date'
                );
                const amount = parseRequiredAmountField(rawAmount, 'amount');
                const feeType = getField(r, 'fee_type', 'FeeType', 'feeType');
                const classification = classifyFinancialEventType(feeType || rawEventType, getField(r, 'Description', 'description', 'AdjustmentType'));
                const amountInfo = parseCurrencyAmount({
                    amount,
                    currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD'
                });
                const referenceId =
                    getField(r, 'Reference ID', 'reference_id', 'ReferenceId', 'AdjustmentEventId', 'adjustment_event_id', 'EventId', 'event_id') ||
                    getField(r, 'SettlementId', 'settlement_id', 'Settlement ID') ||
                    getField(r, 'AmazonOrderId', 'amazon_order_id', 'orderId', 'order_id', 'OrderId') ||
                    null;
                const orderId = getField(r, 'AmazonOrderId', 'amazon_order_id', 'orderId', 'order_id', 'OrderId') || null;
                const sku = getField(r, 'SellerSKU', 'sku', 'SKU', 'seller_sku') || null;
                const asin = getField(r, 'ASIN', 'asin') || null;
                rows.push({
                    ...buildCanonicalFinancialEventRow({
                        sellerId: userId,
                        tenantId,
                        storeId: storeId || null,
                        syncId,
                        source: 'csv_upload',
                        eventType: classification.eventType,
                        eventSubtype: classification.eventSubtype || String(feeType || rawEventType),
                        amount: amountInfo.amount,
                        currency: amountInfo.currency,
                        eventDate,
                        referenceId,
                        referenceType: classification.referenceType,
                        settlementId: getField(r, 'SettlementId', 'settlement_id', 'Settlement ID') || null,
                        payoutBatchId: getField(r, 'PayoutBatchId', 'payout_batch_id', 'DisbursementId', 'disbursement_id') || null,
                        amazonEventId: getField(r, 'amazon_event_id', 'AmazonEventId', 'EventId', 'event_id', 'AdjustmentEventId', 'adjustment_event_id') || undefined,
                        amazonOrderId: orderId,
                        amazonSku: sku,
                        sku,
                        asin,
                        description: getField(r, 'Description', 'description', 'AdjustmentType', 'fee_type', 'FeeType') || null,
                        rawPayload: r,
                        metadata: {
                            csvType: 'financial_events'
                        },
                        isPayoutEvent: classification.isPayoutEvent && amountInfo.amount > 0
                    }),
                    quantity: parseOptionalNonNegativeNumericField(
                        getField(r, 'Quantity', 'quantity', 'Qty', 'qty', 'QuantityReimbursed', 'quantity_reimbursed'),
                        'quantity'
                    ),
                    fulfillment_center_id: getField(
                        r,
                        'FulfillmentCenterId',
                        'fulfillment_center_id',
                        'FulfillmentCenter',
                        'fulfillment_center',
                        'FC',
                        'warehouse'
                    ) || null
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
                const eventDate = parseRequiredIsoDateField(
                    getField(r, 'PostedDate', 'event_date', 'postedDate', 'posted_date', 'date'),
                    'event_date',
                );
                const amount = parseRequiredAmountField(feeAmount, 'fee_amount');
                const sku = getField(r, 'SellerSKU', 'sku', 'SKU', 'seller_sku') || null;
                rows.push({
                    ...buildCanonicalFinancialEventRow({
                        sellerId: userId,
                        tenantId,
                        storeId: storeId || null,
                        syncId,
                        source: 'csv_upload',
                        eventType: 'fee',
                        eventSubtype: getField(r, 'FeeType', 'fee_type', 'feeType', 'Description') || 'service_fee',
                        amount,
                        currency: getField(r, 'CurrencyCode', 'currency', 'Currency') || 'USD',
                        eventDate,
                        referenceId: getField(r, 'Reference ID', 'reference_id', 'ReferenceId') || getField(r, 'AmazonOrderId', 'amazon_order_id', 'orderId', 'order_id') || sku,
                        referenceType: 'fee',
                        amazonEventId: getField(r, 'amazon_event_id', 'AmazonEventId', 'EventId', 'event_id') || undefined,
                        amazonOrderId: getField(r, 'AmazonOrderId', 'amazon_order_id', 'orderId', 'order_id') || null,
                        amazonSku: sku,
                        sku,
                        asin: getField(r, 'ASIN', 'asin') || null,
                        description: getField(r, 'FeeType', 'fee_type', 'feeType', 'Description') || 'SERVICE_FEE',
                        rawPayload: r,
                        metadata: {
                            csvType: 'fees'
                        },
                        isPayoutEvent: false
                    })
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
                    sync_id: syncId,
                    transfer_id: transferId,
                    sku: getField(r, 'sku', 'SKU', 'sellerSku') || null,
                    asin: getField(r, 'asin', 'ASIN') || null,
                    fnsku: getField(r, 'fnsku', 'FNSKU', 'fnSku', 'sku', 'SKU') || null,
                    source_fc: getField(r, 'from_fc', 'source_fc', 'fromFc', 'SourceFC') || null,
                    destination_fc: getField(r, 'to_fc', 'destination_fc', 'toFc', 'DestinationFC') || null,
                    transfer_date: transferDate,
                    quantity_sent: parseRequiredNumericField(
                        getField(r, 'quantity_sent', 'QuantitySent'),
                        'quantity_sent'
                    ),
                    quantity_received: parseRequiredNumericField(
                        getField(r, 'quantity_received', 'QuantityReceived'),
                        'quantity_received'
                    ),
                    status: 'received',
                    unit_value: Number(getField(r, 'unit_value', 'UnitValue', 'price', 'Price')) || 0,
                    currency: getField(r, 'currency', 'Currency', 'CurrencyCode') || 'USD',
                    source: 'csv_upload',
                    raw_payload: r,
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
        settlements: 'tenant_id,user_id,store_id,settlement_id,transaction_type',
        inventory_items: 'tenant_id,user_id,sku,asin,fnsku',
        // The deployed ledger uniqueness is a partial index on provider_row_fingerprint IS NULL,
        // which PostgreSQL cannot infer from a plain ON CONFLICT target. Manual ledger rows
        // therefore use the file-level duplicate guard plus a plain insert.

        financial_events: 'tenant_id,seller_id,source,amazon_event_id',
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
        skipped = 0,
        operation = 'upsert'
    ): Promise<Omit<IngestionResult, 'fileName'>> {
        let inserted = 0;
        let failed = 0;
        const persistenceOperations: PersistenceOperationDiagnostic[] = [];
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
                        const diagnostic: PersistenceOperationDiagnostic = {
                            table,
                            operation,
                            status: 'failed',
                            batch: Math.floor(i / BATCH_SIZE) + 1,
                            rows: batch.length,
                            errorCode: error.code,
                            message: error.message,
                            details: error.details,
                            hint: error.hint,
                        };
                        persistenceOperations.push(diagnostic);
                        logger.error(`❌ [CSV INGESTION] Database write failed`, {
                            stage: 'persistence',
                            table,
                            operation,
                            errorCode: error.code,
                            message: error.message,
                            details: error.details,
                            hint: error.hint,
                            batch: diagnostic.batch,
                            batchSize: batch.length,
                            conflictKey: conflictKey || null,
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
                        persistenceOperations.push({
                            table,
                            operation,
                            status: 'succeeded',
                            batch: Math.floor(i / BATCH_SIZE) + 1,
                            rows: batch.length,
                            metadata: { conflictKey: conflictKey || null },
                        });
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
                    persistenceOperations.push({
                        table,
                        operation,
                        status: 'failed',
                        batch: Math.floor(i / BATCH_SIZE) + 1,
                        rows: batch.length,
                        message: error?.message,
                        details: error?.details,
                        hint: error?.hint,
                    });
                    logger.error('❌ [CSV INGESTION] Database write threw an exception', {
                        stage: 'persistence',
                        table,
                        operation,
                        errorCode: error?.code,
                        message: error?.message,
                        details: error?.details,
                        hint: error?.hint,
                        batch: Math.floor(i / BATCH_SIZE) + 1,
                        batchSize: batch.length,
                        conflictKey: conflictKey || null,
                    });
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
            persistenceStatus: rows.length === 0 ? 'not_attempted' : failed > 0
                ? (inserted > 0 ? 'partial' : 'failed')
                : 'succeeded',
            persistenceError: persistenceOperations.find((entry) => entry.status === 'failed')?.message,
            persistenceOperations,
            detectionTriggered: false,
        };
    }

    // ============================================================================
    // Detection Trigger
    // ============================================================================

    /**
     * Trigger Agent 3 detection pipeline after CSV data is ingested
     */
    private async triggerDetection(
        userId: string,
        syncId: string,
        tenantId: string,
        syntheticExecution?: SyntheticAuditExecutionContext,
    ): Promise<string> {
        const jobId = `csv_detection_${userId}_${Date.now()}`;
        const isSandbox = Boolean(syntheticExecution) || this.getCsvUploadSandboxFlag();
        let failureStatusRecorded = false;

        try {
            await this.recordDetectionQueueStatus(userId, tenantId, syncId, 'processing', {
                jobId,
                isSandbox,
                payload: {
                    engine: 'enhanced',
                    job_id: jobId,
                    detection_phase: 'triggered',
                    ...(syntheticExecution ? { execution_provenance: syntheticExecution.provenance } : {}),
                },
            }, syntheticExecution);

            // Try EnhancedDetectionService first (production flagship detector set)
            const { EnhancedDetectionService } = await import('./enhancedDetectionService');
            const enhancedService = new EnhancedDetectionService();

            const result = await enhancedService.triggerDetectionPipeline(
                userId,
                syncId,
                'csv_upload',
                {
                    tenantId,
                    syncId,
                    source_type: 'csv_upload',
                    trigger_type: 'csv_upload',
                    syntheticExecution,
                }
            );

            if (!result.success) {
                await this.recordDetectionQueueStatus(userId, tenantId, syncId, 'failed', {
                    jobId: result.jobId || jobId,
                    isSandbox,
                    errorMessage: result.message || 'Enhanced detection pipeline returned unsuccessful state.',
                    payload: {
                        engine: 'enhanced',
                        job_id: result.jobId || jobId,
                        detection_phase: 'completed_with_error',
                        failure_stage: 'enhanced_pipeline',
                        fallback_used: false,
                        failure_reason: result.message || 'Enhanced detection pipeline returned unsuccessful state.',
                        detectionsFound: result.detectionsFound || 0,
                        estimatedRecovery: result.estimatedRecovery || 0,
                    },
                }, syntheticExecution);
                failureStatusRecorded = true;
                throw new Error(result.message || 'Enhanced detection pipeline returned unsuccessful state.');
            }

            const persistedResults = await this.loadPersistedDetectionResults(userId, tenantId, syncId);
            const reportedDetectionsFound = Number(result.detectionsFound || 0);
            const persistedResultsCount = persistedResults.length;

            if (reportedDetectionsFound > 0 && persistedResultsCount === 0) {
                const persistenceError = `Enhanced detection reported ${reportedDetectionsFound} findings but persisted 0 detection_results rows.`;
                await this.recordDetectionQueueStatus(userId, tenantId, syncId, 'failed', {
                    jobId: result.jobId || jobId,
                    isSandbox,
                    errorMessage: persistenceError,
                    payload: {
                        engine: 'enhanced',
                        job_id: result.jobId || jobId,
                        detection_phase: 'failed',
                        failure_stage: 'persistence_verification',
                        fallback_used: false,
                        detectionsFound: reportedDetectionsFound,
                        estimatedRecovery: result.estimatedRecovery || 0,
                        persisted_results_count: persistedResultsCount,
                    },
                }, syntheticExecution);
                failureStatusRecorded = true;
                throw new Error(persistenceError);
            }

            await this.recordDetectionQueueStatus(userId, tenantId, syncId, 'completed', {
                jobId: result.jobId,
                isSandbox,
                payload: {
                    engine: 'enhanced',
                    job_id: result.jobId,
                    detection_phase: 'completed',
                    detectionsFound: reportedDetectionsFound,
                    estimatedRecovery: result.estimatedRecovery || 0,
                    persisted_results_count: persistedResultsCount,
                },
            }, syntheticExecution);

            if (!syntheticExecution) {
                await this.emitPersistedDetectionEvents(userId, tenantId, syncId, result.jobId);
            } else {
                logger.info('🧪 [CSV INGESTION] Synthetic training detection completed without commercial event emission', {
                    tenantId,
                    userId,
                    syncId,
                    provenance: syntheticExecution.provenance,
                });
            }

            logger.info('🔍 [CSV INGESTION] Enhanced detection pipeline triggered', {
                userId,
                syncId,
                jobId: result.jobId,
                detectionsFound: result.detectionsFound,
                estimatedRecovery: result.estimatedRecovery,
            });

            return result.jobId;
        } catch (error: any) {
            logger.error('❌ [CSV INGESTION] Enhanced detection failed; CSV legacy fallback disabled', {
                userId,
                syncId,
                error: error.message,
            });
            if (!failureStatusRecorded) {
                try {
                    await this.recordDetectionQueueStatus(userId, tenantId, syncId, 'failed', {
                        jobId,
                        isSandbox,
                        errorMessage: error.message || 'Enhanced detection pipeline failed.',
                        payload: {
                            engine: 'enhanced',
                            job_id: jobId,
                            detection_phase: 'failed',
                            fallback_used: false,
                            failure_reason: error.message || 'Enhanced detection pipeline failed.',
                        },
                    }, syntheticExecution);
                } catch (statusError: any) {
                    logger.error('❌ [CSV INGESTION] Failed to persist detection failure status', {
                        userId,
                        syncId,
                        error: statusError.message,
                    });
                }
            }

            throw new Error(error.message || 'Enhanced detection pipeline failed.');
        }
    }

    private async emitPersistedDetectionEvents(
        userId: string,
        tenantId: string,
        syncId: string,
        detectionJobId?: string
    ): Promise<void> {
        const detectionResults = await this.loadPersistedDetectionResults(userId, tenantId, syncId);
        if (detectionResults.length === 0) {
            logger.warn('⚠️ [CSV INGESTION] No persisted detection rows found for canonical event emission', {
                userId,
                tenantId,
                syncId,
                detectionJobId,
            });
            return;
        }

        try {
            const { upsertDisputesAndRecoveriesFromDetections } = await import('./disputeBackfillService');
            await upsertDisputesAndRecoveriesFromDetections(detectionResults as any[]);
        } catch (backfillError: any) {
            logger.warn('⚠️ [CSV INGESTION] Failed to backfill dispute/recovery records from persisted detections', {
                userId,
                tenantId,
                syncId,
                error: backfillError?.message || backfillError,
            });
        }

        const [{ default: sseHub }, { resolveTenantSlug }] = await Promise.all([
            import('../utils/sseHub'),
            import('../utils/tenantEventRouting'),
        ]);
        const tenantSlug = await resolveTenantSlug(tenantId);
        const totalRecoverableValue = detectionResults.reduce((sum, row) => sum + this.getCountedDetectionValue(row), 0);

        await this.notifyCsvDetectionSummary(userId, tenantId, syncId, detectionResults);

        sseHub.sendEvent(userId, 'detection.completed', {
            tenant_id: tenantId,
            tenant_slug: tenantSlug,
            sync_id: syncId,
            detection_id: detectionJobId || syncId,
            claimsDetected: detectionResults.length,
            totalRecoverableValue,
            count: detectionResults.length,
            amount: totalRecoverableValue,
            currency: 'USD',
            status: 'completed',
            message: `Detection complete: ${detectionResults.length} persisted claims detected`
        });

        for (const detection of detectionResults) {
            sseHub.sendEvent(userId, 'detection.created', {
                tenant_id: tenantId,
                tenant_slug: tenantSlug,
                sync_id: syncId,
                detection_id: detection.id,
                entity_id: detection.id,
                anomaly_type: detection.anomaly_type,
                amount: detection.estimated_value || 0,
                estimated_value: detection.estimated_value || 0,
                currency: detection.currency || 'USD',
                status: detection.status || 'detected',
                message: `Detection created for ${detection.anomaly_type || 'claim'}`,
                created_at: detection.created_at
            });
        }
    }

    private async loadPersistedDetectionResults(
        userId: string,
        tenantId: string,
        syncId: string
    ): Promise<any[]> {
        for (let attempt = 1; attempt <= 3; attempt++) {
            const { data, error } = await supabaseAdmin
                .from('detection_results')
                .select('*')
                .eq('seller_id', userId)
                .eq('tenant_id', tenantId)
                .eq('sync_id', syncId)
                .order('created_at', { ascending: true });

            if (error) {
                throw new Error(`Failed to load persisted detection results: ${error.message}`);
            }

            if ((data || []).length > 0) {
                return data;
            }

            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 250 * attempt));
            }
        }

        return [];
    }

    private async syncCsvUploadRunFromDetectionState(
        userId: string,
        tenantId: string,
        syncId: string,
        status: DetectionQueueStatus,
        options: {
            jobId?: string;
            isSandbox?: boolean;
            errorMessage?: string;
        } = {}
    ): Promise<void> {
        try {
            const { data, error } = await supabaseAdmin
                .from('csv_upload_runs')
                .select('sync_id, success, total_files, file_count, detection_triggered, detection_job_id, ingestion_results, files_summary, created_at, updated_at, started_at, completed_at, status, error, is_sandbox')
                .eq('tenant_id', tenantId)
                .eq('seller_id', userId)
                .eq('sync_id', syncId)
                .maybeSingle();

            if (error?.code === '42P01') {
                return;
            }

            if (error && error.code !== 'PGRST116') {
                throw new Error(`Failed to load CSV upload run for detection sync: ${error.message}`);
            }

            const row = data as CsvUploadRunRow | null;
            const filesSummary = row
                ? this.normalizeCsvRunFilesSummary(row.files_summary, row.ingestion_results)
                : [];
            const results = row
                ? this.buildBatchResultFromCsvUploadRun(userId, row, filesSummary).results
                : [];
            const batchError = this.buildCsvUploadRunError(results, options.errorMessage || row?.error || null);
            const runStatus = this.deriveCsvUploadRunStatus(results, {
                detectionTriggered: true,
                detectionStatus: status,
                batchError: status === 'failed' ? batchError : null,
            });

            await this.persistCsvUploadRunRecord(tenantId, userId, syncId, {
                success: row?.success ?? false,
                fileCount: Number(row?.file_count ?? row?.total_files ?? filesSummary.length ?? 0),
                filesSummary,
                startedAt: row?.started_at || row?.created_at || new Date().toISOString(),
                completedAt: this.isTerminalCsvUploadRunStatus(runStatus) ? new Date().toISOString() : null,
                status: runStatus,
                detectionTriggered: true,
                detectionJobId: options.jobId ?? row?.detection_job_id ?? null,
                error: status === 'failed' ? batchError : null,
                isSandbox: options.isSandbox ?? row?.is_sandbox ?? false,
            });
        } catch (error: any) {
            logger.warn('⚠️ [CSV INGESTION] Failed to sync authoritative CSV run from detection state', {
                tenantId,
                userId,
                syncId,
                status,
                error: error?.message || 'Unknown error',
            });
        }
    }

    private async recordDetectionQueueStatus(
        userId: string,
        tenantId: string,
        syncId: string,
        status: DetectionQueueStatus,
        options: {
            jobId?: string;
            isSandbox?: boolean;
            errorMessage?: string;
            payload?: Record<string, any>;
        } = {},
        syntheticExecution?: SyntheticAuditExecutionContext,
    ): Promise<void> {
        const nowIso = new Date().toISOString();
        const payload = buildDetectionQueuePayload(
            {
                tenant_id: tenantId,
                sync_id: syncId,
                source_type: 'csv_upload',
                trigger_type: 'csv_upload',
                seller_id: userId,
            },
            {
                // Keep optional metadata inside payload so queue persistence depends only on live core columns.
                ...(options.jobId ? { job_id: options.jobId } : {}),
                ...(options.isSandbox !== undefined ? { is_sandbox: !!options.isSandbox } : {}),
                ...(options.payload || {}),
                // The caller-provided detail payload must never override server-issued provenance.
                ...(syntheticExecution ? { execution_provenance: syntheticExecution.provenance } : {}),
            }
        );

        const nextValues = {
            status,
            priority: 1,
            payload,
            processed_at: status === 'completed' || status === 'failed' ? nowIso : null,
            error_message: status === 'failed' ? options.errorMessage || 'Detection failed' : null,
            updated_at: nowIso,
        };

        const { data: updatedRows, error: updateError } = await supabaseAdmin
            .from('detection_queue')
            .update(nextValues)
            .eq('tenant_id', tenantId)
            .eq('seller_id', userId)
            .eq('sync_id', syncId)
            .select('id');

        if (updateError) {
            throw new Error(`Failed to update detection queue status: ${updateError.message}`);
        }

        if ((updatedRows || []).length === 0) {
            const { error: insertError } = await supabaseAdmin
                .from('detection_queue')
                .insert({
                    tenant_id: tenantId,
                    seller_id: userId,
                    sync_id: syncId,
                    created_at: nowIso,
                    ...nextValues,
                });

            if (insertError) {
                throw new Error(`Failed to persist detection queue status: ${insertError.message}`);
            }
        }

        await this.syncCsvUploadRunFromDetectionState(userId, tenantId, syncId, status, {
            jobId: options.jobId,
            isSandbox: options.isSandbox,
            errorMessage: options.errorMessage,
        });
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
                description: 'Shipment records, including inbound shipment CSVs that land in canonical shipments rows',
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
                description: 'Inventory transfer records between fulfillment centers; use this for transfer-style inbound movement files',
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
