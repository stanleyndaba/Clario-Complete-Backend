/**
 * Unified Ledger Service
 * 
 * Normalizes and deduplicates financial events across all data sources.
 * 
 * Purpose:
 * - No cent is double-counted
 * - No event is lost when spanning multiple reports
 * - Single source of truth for claim generation
 * 
 * Features:
 * - Event fingerprinting
 * - Cross-report deduplication
 * - Event merging and reconciliation
 * - Audit trail maintenance
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface UnifiedEvent {
    event_id: string;           // Unique fingerprint
    seller_id: string;

    // Original source
    source_type: 'order' | 'refund' | 'adjustment' | 'fee' | 'reimbursement' | 'inventory' | 'return';
    source_report: string;
    source_event_ids: string[]; // All original IDs that map to this

    // Normalized data
    event_date: Date;
    amazon_order_id?: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    quantity: number;
    amount: number;
    currency: string;
    event_subtype: string;

    // Dedup status
    is_deduplicated: boolean;
    duplicate_of?: string;
    merge_count: number;

    // Audit
    created_at: Date;
    last_reconciled: Date;
    reconciliation_notes: string[];
}

export interface DeduplicationResult {
    original_count: number;
    unique_count: number;
    duplicates_found: number;
    merged_events: number;
    events: UnifiedEvent[];
}

export interface ReconciliationReport {
    seller_id: string;
    report_date: Date;
    total_events: number;
    total_amount: number;
    by_source: Record<string, { count: number; amount: number }>;
    discrepancies: Array<{
        type: string;
        description: string;
        amount: number;
        event_ids: string[];
    }>;
}

// ============================================================================
// Event Fingerprinting
// ============================================================================

/**
 * Generate a unique fingerprint for an event
 * Used to detect duplicates across reports
 */
export function generateEventFingerprint(event: {
    amazon_order_id?: string;
    sku?: string;
    asin?: string;
    event_date: string | Date;
    event_type?: string;
    amount?: number;
    quantity?: number;
}): string {
    const dateStr = typeof event.event_date === 'string'
        ? event.event_date.substring(0, 10)
        : event.event_date.toISOString().substring(0, 10);

    const components = [
        event.amazon_order_id || '',
        event.sku || event.asin || '',
        dateStr,
        event.event_type || '',
        Math.abs(event.amount || 0).toFixed(2),
        (event.quantity || 1).toString()
    ];

    return components.join('|').toLowerCase();
}

/**
 * Generate a short hash from fingerprint
 */
function shortHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Deduplicate events from multiple sources
 */
export async function deduplicateEvents(
    sellerId: string,
    events: any[],
    sourceReport: string
): Promise<DeduplicationResult> {
    const fingerprintMap = new Map<string, UnifiedEvent>();
    const duplicates: string[] = [];
    let mergeCount = 0;

    for (const event of events) {
        const fingerprint = generateEventFingerprint(event);
        const eventId = `ue_${shortHash(fingerprint)}_${sellerId.substring(0, 6)}`;

        if (fingerprintMap.has(fingerprint)) {
            // Duplicate found - merge
            const existing = fingerprintMap.get(fingerprint)!;
            existing.source_event_ids.push(event.id);
            existing.merge_count++;
            existing.reconciliation_notes.push(
                `Merged with ${event.id} from ${sourceReport} on ${new Date().toISOString()}`
            );
            duplicates.push(event.id);
            mergeCount++;
        } else {
            // New unique event
            const unified: UnifiedEvent = {
                event_id: eventId,
                seller_id: sellerId,
                source_type: mapEventTypeToSource(event.event_type),
                source_report: sourceReport,
                source_event_ids: [event.id],
                event_date: new Date(event.event_date),
                amazon_order_id: event.amazon_order_id,
                sku: event.sku || event.amazon_sku,
                asin: event.asin,
                fnsku: event.fnsku,
                quantity: event.quantity || 1,
                amount: event.amount || 0,
                currency: event.currency || 'USD',
                event_subtype: event.event_type || 'unknown',
                is_deduplicated: false,
                merge_count: 1,
                created_at: new Date(),
                last_reconciled: new Date(),
                reconciliation_notes: [`Created from ${sourceReport}`]
            };

            fingerprintMap.set(fingerprint, unified);
        }
    }

    // Check for existing duplicates in database
    const uniqueEvents = Array.from(fingerprintMap.values());

    try {
        const { data: existingEvents } = await supabaseAdmin
            .from('unified_ledger')
            .select('event_id, source_event_ids')
            .eq('seller_id', sellerId)
            .limit(10000);

        if (existingEvents?.length) {
            const existingIds = new Set(existingEvents.flatMap(e => e.source_event_ids || []));

            for (const event of uniqueEvents) {
                const hasExisting = event.source_event_ids.some(id => existingIds.has(id));
                if (hasExisting) {
                    event.is_deduplicated = true;
                    duplicates.push(...event.source_event_ids);
                }
            }
        }
    } catch (error: any) {
        logger.warn('[UNIFIED LEDGER] Error checking existing events', { error: error.message });
    }

    const result: DeduplicationResult = {
        original_count: events.length,
        unique_count: uniqueEvents.filter(e => !e.is_deduplicated).length,
        duplicates_found: duplicates.length,
        merged_events: mergeCount,
        events: uniqueEvents
    };

    logger.info('[UNIFIED LEDGER] Deduplication complete', {
        sellerId,
        original: result.original_count,
        unique: result.unique_count,
        duplicates: result.duplicates_found
    });

    return result;
}

function mapEventTypeToSource(eventType: string): UnifiedEvent['source_type'] {
    const typeMap: Record<string, UnifiedEvent['source_type']> = {
        'order': 'order',
        'sale': 'order',
        'refund': 'refund',
        'return': 'return',
        'adjustment': 'adjustment',
        'reimbursement': 'reimbursement',
        'fee': 'fee',
        'fba_fee': 'fee',
        'fulfillment_fee': 'fee',
        'inventory': 'inventory',
        'inventory_adjustment': 'inventory',
        'lost': 'inventory',
        'damaged': 'inventory',
    };

    return typeMap[eventType?.toLowerCase()] || 'adjustment';
}

// ============================================================================
// Ledger Operations
// ============================================================================

/**
 * Store unified events in the ledger
 */
export async function storeUnifiedEvents(events: UnifiedEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    const newEvents = events.filter(e => !e.is_deduplicated);
    if (newEvents.length === 0) return 0;

    try {
        const records = newEvents.map(e => ({
            event_id: e.event_id,
            seller_id: e.seller_id,
            source_type: e.source_type,
            source_report: e.source_report,
            source_event_ids: e.source_event_ids,
            event_date: e.event_date.toISOString(),
            amazon_order_id: e.amazon_order_id,
            sku: e.sku,
            asin: e.asin,
            fnsku: e.fnsku,
            quantity: e.quantity,
            amount: e.amount,
            currency: e.currency,
            event_subtype: e.event_subtype,
            merge_count: e.merge_count,
            reconciliation_notes: e.reconciliation_notes,
            created_at: e.created_at.toISOString()
        }));

        const { error } = await supabaseAdmin
            .from('unified_ledger')
            .upsert(records, { onConflict: 'event_id' });

        if (error) {
            logger.error('[UNIFIED LEDGER] Failed to store events', { error: error.message });
            return 0;
        }

        logger.info('[UNIFIED LEDGER] Events stored', { count: newEvents.length });
        return newEvents.length;

    } catch (error: any) {
        logger.error('[UNIFIED LEDGER] Error storing events', { error: error.message });
        return 0;
    }
}

/**
 * Get unified ledger for a seller
 */
export async function getUnifiedLedger(
    sellerId: string,
    options: {
        startDate?: string;
        endDate?: string;
        sourceType?: string;
        limit?: number;
    } = {}
): Promise<UnifiedEvent[]> {
    try {
        let query = supabaseAdmin
            .from('unified_ledger')
            .select('*')
            .eq('seller_id', sellerId)
            .order('event_date', { ascending: false });

        if (options.startDate) {
            query = query.gte('event_date', options.startDate);
        }
        if (options.endDate) {
            query = query.lte('event_date', options.endDate);
        }
        if (options.sourceType) {
            query = query.eq('source_type', options.sourceType);
        }
        if (options.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('[UNIFIED LEDGER] Failed to get ledger', { error: error.message });
            return [];
        }

        return (data || []).map(row => ({
            ...row,
            event_date: new Date(row.event_date),
            created_at: new Date(row.created_at),
            last_reconciled: new Date(row.last_reconciled || row.created_at),
            reconciliation_notes: row.reconciliation_notes || []
        }));

    } catch (error: any) {
        logger.error('[UNIFIED LEDGER] Error getting ledger', { error: error.message });
        return [];
    }
}

// ============================================================================
// Reconciliation
// ============================================================================

/**
 * Generate a reconciliation report
 */
export async function generateReconciliationReport(
    sellerId: string,
    startDate: string,
    endDate: string
): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
        seller_id: sellerId,
        report_date: new Date(),
        total_events: 0,
        total_amount: 0,
        by_source: {},
        discrepancies: []
    };

    try {
        // Get unified ledger for period
        const ledger = await getUnifiedLedger(sellerId, { startDate, endDate, limit: 10000 });

        report.total_events = ledger.length;
        report.total_amount = ledger.reduce((sum, e) => sum + e.amount, 0);

        // Group by source
        for (const event of ledger) {
            if (!report.by_source[event.source_type]) {
                report.by_source[event.source_type] = { count: 0, amount: 0 };
            }
            report.by_source[event.source_type].count++;
            report.by_source[event.source_type].amount += event.amount;
        }

        // Detect discrepancies
        // 1. Events with merge_count > 2 (triple-reported)
        const multiMerged = ledger.filter(e => e.merge_count > 2);
        if (multiMerged.length > 0) {
            report.discrepancies.push({
                type: 'multi_merge',
                description: `${multiMerged.length} events appear in 3+ reports`,
                amount: multiMerged.reduce((s, e) => s + e.amount, 0),
                event_ids: multiMerged.map(e => e.event_id)
            });
        }

        // 2. Large adjustments without matching order
        const largeAdjustments = ledger.filter(e =>
            e.source_type === 'adjustment' && Math.abs(e.amount) > 100
        );
        for (const adj of largeAdjustments) {
            if (adj.amazon_order_id) {
                const hasOrder = ledger.some(e =>
                    e.source_type === 'order' && e.amazon_order_id === adj.amazon_order_id
                );
                if (!hasOrder) {
                    report.discrepancies.push({
                        type: 'orphan_adjustment',
                        description: `Large adjustment ($${adj.amount}) without matching order`,
                        amount: adj.amount,
                        event_ids: [adj.event_id]
                    });
                }
            }
        }

        // 3. Refunds exceeding original order
        const refunds = ledger.filter(e => e.source_type === 'refund');
        for (const refund of refunds) {
            if (refund.amazon_order_id) {
                const order = ledger.find(e =>
                    e.source_type === 'order' && e.amazon_order_id === refund.amazon_order_id
                );
                if (order && Math.abs(refund.amount) > Math.abs(order.amount) * 1.1) {
                    report.discrepancies.push({
                        type: 'refund_exceeds_order',
                        description: `Refund $${Math.abs(refund.amount)} exceeds order $${Math.abs(order.amount)}`,
                        amount: Math.abs(refund.amount) - Math.abs(order.amount),
                        event_ids: [refund.event_id, order.event_id]
                    });
                }
            }
        }

        logger.info('[UNIFIED LEDGER] Reconciliation report generated', {
            sellerId,
            events: report.total_events,
            discrepancies: report.discrepancies.length
        });

    } catch (error: any) {
        logger.error('[UNIFIED LEDGER] Error generating report', { error: error.message });
    }

    return report;
}

/**
 * Check if an event would be a duplicate
 */
export async function isDuplicateEvent(
    sellerId: string,
    event: {
        amazon_order_id?: string;
        sku?: string;
        asin?: string;
        event_date: string | Date;
        event_type?: string;
        amount?: number;
    }
): Promise<boolean> {
    const fingerprint = generateEventFingerprint(event);
    const eventId = `ue_${shortHash(fingerprint)}_${sellerId.substring(0, 6)}`;

    try {
        const { data } = await supabaseAdmin
            .from('unified_ledger')
            .select('event_id')
            .eq('event_id', eventId)
            .limit(1)
            .maybeSingle();

        return !!data;
    } catch {
        return false;
    }
}

export default {
    generateEventFingerprint,
    deduplicateEvents,
    storeUnifiedEvents,
    getUnifiedLedger,
    generateReconciliationReport,
    isDuplicateEvent
};
