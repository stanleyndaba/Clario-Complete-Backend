/**
 * Damaged Inventory Detection Algorithms - "The Broken Goods Hunter"
 * 
 * Phase 2, P0 Priority (Final): Amazon-at-Fault Damaged Inventory Detection
 * Completes the P0 Trinity alongside Whale Hunter and Refund Trap.
 * 
 * Algorithm Logic:
 * 1. Scan inventory_ledger for Adjustment events with DAMAGED/UNSELLABLE disposition
 * 2. Filter for Amazon-at-fault reason codes (E, M, Q, K, H)
 * 3. Check if reimbursement was issued within 45 days (matched by FNSKU + date + quantity)
 * 4. If no reimbursement found after 45 days = MONEY OWED
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

// Amazon-at-fault reason codes for damaged inventory
export const AMAZON_AT_FAULT_CODES = ['E', 'M', 'Q', 'K', 'H'] as const;
export type AmazonAtFaultCode = typeof AMAZON_AT_FAULT_CODES[number];

// Code descriptions for evidence
export const REASON_CODE_DESCRIPTIONS: Record<string, string> = {
    'E': 'Damaged by Amazon fulfillment center',
    'M': 'Damaged during inbound shipment (Amazon carrier)',
    'Q': 'Damaged during customer return processing',
    'K': 'Damaged during removal/disposal',
    'H': 'Damaged during transfer between warehouses',
};

export interface DamagedEvent {
    id: string;
    seller_id: string;
    fnsku: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // Event details
    event_type: string;           // 'Adjustment'
    event_date: string;
    disposition: string;          // 'DAMAGED', 'UNSELLABLE', 'DEFECTIVE'
    reason_code: string;          // E, M, Q, K, H, etc.

    // Quantity
    quantity: number;

    // Value (for recovery calculation)
    unit_value?: number;
    average_sales_price?: number;

    // Fulfillment center
    fulfillment_center_id?: string;

    // Metadata
    created_at: string;
}

export interface ReimbursementEvent {
    id: string;
    seller_id: string;
    fnsku?: string;
    sku?: string;
    asin?: string;

    // Reimbursement details
    reimbursement_type: string;   // 'REVERSAL', 'DAMAGED_WAREHOUSE', etc.
    reimbursement_date: string;
    reimbursement_amount: number;
    currency: string;
    quantity_reimbursed: number;

    // Reference
    reason_code?: string;
    amazon_order_id?: string;

    created_at: string;
}

export interface DamagedSyncedData {
    seller_id: string;
    sync_id: string;
    inventory_ledger: DamagedEvent[];
    reimbursement_events: ReimbursementEvent[];
}

export interface DamagedDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: 'damaged_warehouse' | 'damaged_inbound' | 'damaged_removal';
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: DamagedInventoryEvidence;
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    fnsku: string;
    sku?: string;
    asin?: string;
    product_name?: string;
}

export interface DamagedInventoryEvidence {
    fnsku: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // Damage event details
    damage_date: string;
    disposition: string;
    reason_code: string;
    reason_description: string;
    quantity_damaged: number;
    fulfillment_center?: string;

    // Reimbursement check
    reimbursement_found: boolean;
    days_since_damage: number;

    // Value
    unit_value: number;
    total_value: number;

    // Human-readable
    evidence_summary: string;

    // IDs
    damage_event_id: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateDeadline(discoveryDate: Date): { deadline: Date; daysRemaining: number } {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);

    const now = new Date();
    const diffTime = deadline.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return { deadline, daysRemaining: Math.max(0, daysRemaining) };
}

function calculateSeverity(totalValue: number): 'low' | 'medium' | 'high' | 'critical' {
    if (totalValue >= 200) return 'critical';
    if (totalValue >= 100) return 'high';
    if (totalValue >= 25) return 'medium';
    return 'low';
}

function daysBetween(date1: Date, date2: Date): number {
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function isAmazonAtFault(reasonCode: string): boolean {
    return AMAZON_AT_FAULT_CODES.includes(reasonCode.toUpperCase() as AmazonAtFaultCode);
}

function getAnomalyType(reasonCode: string): 'damaged_warehouse' | 'damaged_inbound' | 'damaged_removal' {
    const code = reasonCode.toUpperCase();
    switch (code) {
        case 'M': return 'damaged_inbound';
        case 'K': return 'damaged_removal';
        default: return 'damaged_warehouse';
    }
}

// ============================================================================
// Main Detection Algorithm - "The Broken Goods Hunter"
// ============================================================================

/**
 * Detect Damaged Inventory Without Reimbursement
 * 
 * The Final P0 Algorithm - Finds cases where:
 * - Amazon damaged inventory (at-fault codes E, M, Q, K, H)
 * - 45+ days have passed
 * - No reimbursement was issued
 * 
 * = SELLER IS OWED MONEY
 * 
 * Confidence:
 * - > 45 days since damage: 95% (highly defensible)
 * - < 45 days: Skip (Amazon still processing)
 */
export function detectDamagedInventory(
    sellerId: string,
    syncId: string,
    data: DamagedSyncedData
): DamagedDetectionResult[] {
    const results: DamagedDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);
    const now = new Date();

    logger.info('💥 [BROKEN GOODS] Starting Damaged Inventory Detection', {
        sellerId,
        syncId,
        ledgerEventCount: data.inventory_ledger?.length || 0,
        reimbursementCount: data.reimbursement_events?.length || 0
    });

    if (!data.inventory_ledger || data.inventory_ledger.length === 0) {
        logger.warn('💥 [BROKEN GOODS] No inventory ledger events found', { sellerId, syncId });
        return results;
    }

    // Build reimbursement lookup map by FNSKU
    const reimbursementsByFnsku = new Map<string, ReimbursementEvent[]>();
    for (const reimb of (data.reimbursement_events || [])) {
        if (!reimb.fnsku) continue;
        const existing = reimbursementsByFnsku.get(reimb.fnsku) || [];
        existing.push(reimb);
        reimbursementsByFnsku.set(reimb.fnsku, existing);
    }

    // Filter to damaged/adjustment events with Amazon-at-fault codes
    const damageEvents = data.inventory_ledger.filter(event => {
        // Check event type
        if (event.event_type?.toLowerCase() !== 'adjustment') {
            return false;
        }

        // Check disposition
        const disposition = event.disposition?.toUpperCase();
        if (!disposition || !['DAMAGED', 'UNSELLABLE', 'DEFECTIVE'].includes(disposition)) {
            return false;
        }

        // Check for Amazon-at-fault reason code
        if (!event.reason_code || !isAmazonAtFault(event.reason_code)) {
            return false;
        }

        return true;
    });

    logger.info('💥 [BROKEN GOODS] Found Amazon-at-fault damage events', {
        sellerId,
        count: damageEvents.length
    });

    // Process each damage event
    for (const damage of damageEvents) {
        const damageDate = new Date(damage.event_date);
        const daysSinceDamage = daysBetween(damageDate, now);

        // THE 45-DAY RULE: Skip events less than 45 days old
        // Amazon needs time to process, so we can't claim before then
        if (daysSinceDamage < 45) {
            continue;
        }

        // Check for matching reimbursement
        const reimbursements = reimbursementsByFnsku.get(damage.fnsku) || [];

        // Look for a reimbursement that matches:
        // - Same FNSKU
        // - Happened within 45 days of damage
        // - Quantity matches (approximately)
        const matchingReimbursement = reimbursements.find(reimb => {
            const reimbDate = new Date(reimb.reimbursement_date);
            const daysBetweenEvents = daysBetween(damageDate, reimbDate);

            // Reimbursement should happen after damage, within 45 days
            if (reimbDate < damageDate) return false;
            if (daysBetweenEvents > 45) return false;

            // Check quantity (allow some tolerance)
            const quantityMatch = Math.abs(reimb.quantity_reimbursed - damage.quantity) <= 1;

            return quantityMatch;
        });

        // If reimbursement found, skip - Amazon already paid
        if (matchingReimbursement) {
            continue;
        }

        // 💥 THE TRAP IS SPRUNG! Amazon damaged it and didn't pay

        // Calculate value
        const unitValue = damage.unit_value || damage.average_sales_price || 15; // Default $15 if unknown
        const totalValue = damage.quantity * unitValue;

        // Skip tiny amounts
        if (totalValue < 5) {
            continue;
        }

        // Build evidence
        const reasonDescription = REASON_CODE_DESCRIPTIONS[damage.reason_code.toUpperCase()]
            || `Amazon damage code ${damage.reason_code}`;

        const evidenceSummary = `Amazon marked ${damage.quantity} units of ${damage.fnsku} as ${damage.disposition} ` +
            `(Code ${damage.reason_code}: ${reasonDescription}) on ${damageDate.toLocaleDateString()}. ` +
            `No reimbursement found after ${daysSinceDamage} days. Recovery value: $${totalValue.toFixed(2)}.`;

        const evidence: DamagedInventoryEvidence = {
            fnsku: damage.fnsku,
            sku: damage.sku,
            asin: damage.asin,
            product_name: damage.product_name,

            damage_date: damage.event_date,
            disposition: damage.disposition,
            reason_code: damage.reason_code,
            reason_description: reasonDescription,
            quantity_damaged: damage.quantity,
            fulfillment_center: damage.fulfillment_center_id,

            reimbursement_found: false,
            days_since_damage: daysSinceDamage,

            unit_value: unitValue,
            total_value: totalValue,

            evidence_summary: evidenceSummary,
            damage_event_id: damage.id
        };

        // Create detection result
        const result: DamagedDetectionResult = {
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: getAnomalyType(damage.reason_code),
            severity: calculateSeverity(totalValue),
            estimated_value: totalValue,
            currency: 'USD',
            confidence_score: 0.95, // High confidence since > 45 days
            evidence,
            related_event_ids: [damage.id],
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            fnsku: damage.fnsku,
            sku: damage.sku,
            asin: damage.asin,
            product_name: damage.product_name
        };

        results.push(result);

        logger.info('💥 [BROKEN GOODS] Unreimbursed damage detected!', {
            fnsku: damage.fnsku,
            quantity: damage.quantity,
            reasonCode: damage.reason_code,
            daysSinceDamage,
            totalValue
        });
    }

    logger.info('💥 [BROKEN GOODS] Detection complete', {
        sellerId,
        syncId,
        detectionsFound: results.length,
        totalEstimatedRecovery: results.reduce((sum, r) => sum + r.estimated_value, 0)
    });

    return results;
}

// ============================================================================
// Database Integration
// ============================================================================

/**
 * Fetch damaged inventory events from ledger
 * 
 * ADAPTER: Agent 2 doesn't have inventory_ledger. 
 * We extract damaged events from returns table (disposition field).
 */
export async function fetchDamagedEvents(
    sellerId: string,
    options?: { startDate?: string; limit?: number }
): Promise<DamagedEvent[]> {
    try {
        logger.info('💥 [BROKEN GOODS] Fetching damaged events from returns table', { sellerId });

        // Get returns with damaged/defective items
        const { data: returns, error } = await supabaseAdmin
            .from('returns')
            .select('*')
            .eq('user_id', sellerId)
            .order('returned_date', { ascending: false });

        if (error) {
            logger.error('💥 [BROKEN GOODS] Error fetching returns', { sellerId, error: error.message });
            return [];
        }

        // Transform into DamagedEvent format - filter for damaged items
        const events: DamagedEvent[] = [];
        for (const ret of (returns || [])) {
            const disposition = ret.metadata?.disposition?.toUpperCase() || '';
            if (!['DAMAGED', 'UNSELLABLE', 'DEFECTIVE'].includes(disposition)) continue;

            for (const item of (ret.items || [])) {
                events.push({
                    id: `damage-${ret.return_id}-${item.sku || 'item'}`,
                    seller_id: sellerId,
                    fnsku: item.fnsku || item.asin || 'UNKNOWN',
                    sku: item.sku,
                    asin: item.asin,
                    event_type: 'Adjustment',
                    event_date: ret.returned_date,
                    disposition: disposition,
                    reason_code: ret.metadata?.reason_code || 'Q', // Default to 'Q' - return processing damage
                    quantity: item.quantity || 1,
                    unit_value: item.refund_amount,
                    average_sales_price: item.refund_amount,
                    fulfillment_center_id: ret.metadata?.fulfillmentCenterId,
                    created_at: ret.created_at
                });
            }
        }

        logger.info('💥 [BROKEN GOODS] Extracted damaged events', { count: events.length });
        return events;
    } catch (err: any) {
        logger.error('💥 [BROKEN GOODS] Exception fetching damaged events', { sellerId, error: err.message });
        return [];
    }
}

/**
 * Fetch reimbursement events
 * 
 * ADAPTER: Uses Agent 2's settlements table filtered by 'reimbursement' type
 */
export async function fetchReimbursementsForDamage(
    sellerId: string,
    options?: { startDate?: string; limit?: number }
): Promise<ReimbursementEvent[]> {
    try {
        logger.info('💥 [BROKEN GOODS] Fetching reimbursements from settlements', { sellerId });

        const { data, error } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .eq('transaction_type', 'reimbursement')
            .order('settlement_date', { ascending: false });

        if (error) {
            logger.error('💥 [BROKEN GOODS] Error fetching settlements', { sellerId, error: error.message });
            return [];
        }

        // Transform to ReimbursementEvent format
        const events: ReimbursementEvent[] = (data || []).map(s => ({
            id: s.id || s.settlement_id,
            seller_id: sellerId,
            fnsku: s.metadata?.fnsku,
            sku: s.metadata?.sku,
            asin: s.metadata?.asin,
            reimbursement_type: s.metadata?.adjustmentType || 'REIMBURSEMENT',
            reimbursement_date: s.settlement_date,
            reimbursement_amount: s.amount || 0,
            currency: s.currency || 'USD',
            quantity_reimbursed: s.metadata?.quantity || 1,
            reason_code: s.metadata?.reason,
            amazon_order_id: s.order_id,
            created_at: s.created_at
        }));

        logger.info('💥 [BROKEN GOODS] Fetched reimbursements', { count: events.length });
        return events;
    } catch (err: any) {
        logger.error('💥 [BROKEN GOODS] Exception fetching reimbursements', { sellerId, error: err.message });
        return [];
    }
}

/**
 * Run full damaged inventory detection for a seller
 */
export async function runDamagedInventoryDetection(
    sellerId: string,
    syncId: string
): Promise<DamagedDetectionResult[]> {
    logger.info('💥 [BROKEN GOODS] Starting full detection run', { sellerId, syncId });

    // Look back 120 days to catch 45+ day old events
    const lookbackDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();

    const [damagedEvents, reimbursementEvents] = await Promise.all([
        fetchDamagedEvents(sellerId, { startDate: lookbackDate }),
        fetchReimbursementsForDamage(sellerId, { startDate: lookbackDate })
    ]);

    logger.info('💥 [BROKEN GOODS] Data fetched', {
        sellerId,
        damaged: damagedEvents.length,
        reimbursements: reimbursementEvents.length
    });

    if (damagedEvents.length === 0) {
        logger.warn('💥 [BROKEN GOODS] No damaged events found', { sellerId });
        return [];
    }

    // Build synced data object
    const syncedData: DamagedSyncedData = {
        seller_id: sellerId,
        sync_id: syncId,
        inventory_ledger: damagedEvents,
        reimbursement_events: reimbursementEvents
    };

    return detectDamagedInventory(sellerId, syncId, syncedData);
}

/**
 * Store damaged inventory detection results
 */
export async function storeDamagedDetectionResults(results: DamagedDetectionResult[]): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: r.anomaly_type,
            severity: r.severity,
            estimated_value: r.estimated_value,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: r.evidence,
            related_event_ids: r.related_event_ids,
            discovery_date: r.discovery_date.toISOString(),
            deadline_date: r.deadline_date.toISOString(),
            days_remaining: r.days_remaining,
            status: 'open',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .upsert(records, {
                onConflict: 'seller_id,sync_id,anomaly_type',
                ignoreDuplicates: false
            });

        if (error) {
            logger.error('💥 [BROKEN GOODS] Error storing detection results', {
                error: error.message,
                count: results.length
            });
        } else {
            logger.info('💥 [BROKEN GOODS] Detection results stored', {
                count: results.length
            });
        }
    } catch (err: any) {
        logger.error('💥 [BROKEN GOODS] Exception storing results', {
            error: err.message
        });
    }
}

// ============================================================================
// Exports
// ============================================================================

export default {
    detectDamagedInventory,
    fetchDamagedEvents,
    fetchReimbursementsForDamage,
    runDamagedInventoryDetection,
    storeDamagedDetectionResults,
    AMAZON_AT_FAULT_CODES,
    REASON_CODE_DESCRIPTIONS
};
