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

import { supabaseAdmin } from '../../../../database/supabaseClient';
import logger from '../../../../utils/logger';

import { resolveTenantId } from './shared/tenantUtils';
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
    anomaly_type: 'damaged_warehouse' | 'damaged_inbound' | 'damaged_removal' | 'DAMAGED_INVENTORY_SHORTFALL';
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

    // Found/Recovery check
    recovery_found: boolean;
    recovered_quantity: number;
    recovery_mode?: 'DIRECT' | 'CANDIDATE';
    recovery_confidence?: number;

    // Reimbursement check
    reimbursement_found: boolean;
    reimbursed_quantity?: number;

    // Quantitative reconciliation
    expected_damaged_units: number;
    unresolved_units: number;
    reimbursed_value: number;

    // Traceability
    duplicate_event_detected?: boolean;
    duplicate_event_suppressed?: boolean;
    duplicate_fingerprint_mode?: 'PRIMARY' | 'FALLBACK';

    // Metadata
    days_since_damage: number;

    // Valuation
    unit_value: number;
    total_value: number;
    valuation_source: 'CATALOG_METADATA' | 'SKU_SYNC' | 'LOCAL_CONTEXT' | 'DEFAULT_FALLBACK';
    valuation_basis?: string;
    valuation_confidence: number;

    evidence_summary: string;
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

interface ValuationResult {
    value: number;
    source: 'CATALOG_METADATA' | 'SKU_SYNC' | 'LOCAL_CONTEXT' | 'DEFAULT_FALLBACK';
    basis?: string;
    confidence: number;
}

function getDamagedValuation(
    damage: DamagedEvent,
    linkedReimbs: ReimbursementEvent[]
): ValuationResult {
    // 1. Primary: Exact Item Metadata / unit_value from ledger (if it exists and is non-zero)
    if (damage.unit_value && damage.unit_value > 0) {
        return { 
            value: damage.unit_value, 
            source: 'CATALOG_METADATA', 
            basis: `Ledger unit_value provided: ${damage.unit_value}`,
            confidence: 1.0 
        };
    }

    // 2. Secondary: Recent SKU-level synced value (average_sales_price)
    if (damage.average_sales_price && damage.average_sales_price > 0) {
        return { 
            value: damage.average_sales_price, 
            source: 'SKU_SYNC', 
            basis: `Ledger SKU ASP: ${damage.average_sales_price}`,
            confidence: 0.95 
        };
    }

    // 3. Tertiary: Local context (Historical reimbursement basis for this set)
    if (linkedReimbs.length > 0) {
        const totalAmt = linkedReimbs.reduce((sum, r) => sum + r.reimbursement_amount, 0);
        const totalQty = linkedReimbs.reduce((sum, r) => sum + (r.quantity_reimbursed || 1), 0);
        if (totalQty > 0) {
            const histBasis = totalAmt / totalQty;
            return { 
                value: histBasis, 
                source: 'LOCAL_CONTEXT', 
                basis: `Reimbursement basis: ${histBasis.toFixed(2)}`,
                confidence: 0.9 
            };
        }
    }

    // 4. Last Resort: Default Fallback
    return { 
        value: 15, 
        source: 'DEFAULT_FALLBACK', 
        basis: 'Static industry default fallback',
        confidence: 0.7 
    };
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

    if (!data.inventory_ledger || data.inventory_ledger.length === 0) {
        return results;
    }

    // 1. Tiered Ledger Deduplication
    const processedFingerprints = new Set<string>();
    const deduplicatedLedger: DamagedEvent[] = [];

    for (const event of data.inventory_ledger) {
        // Only deduplicate if this is an adjustment we care about
        if (event.event_type?.toLowerCase() !== 'adjustment') {
            deduplicatedLedger.push(event);
            continue;
        }

        const dateKey = event.event_date ? new Date(event.event_date).toISOString() : 'no-date';
        
        // Tier 1: Primary Fingerprint (Richest)
        const primaryFingerprint = [
            event.seller_id,
            event.fnsku,
            dateKey,
            event.quantity,
            event.reason_code,
            event.fulfillment_center_id,
            event.disposition
        ].join('|');

        // Tier 2: Fallback Fingerprint (Missing FC)
        const fallbackFingerprint = [
            event.seller_id,
            event.fnsku,
            dateKey,
            event.quantity,
            event.reason_code
        ].join('|');

        if (processedFingerprints.has(primaryFingerprint)) {
            logger.info('💥 [BROKEN GOODS] duplicate_event_suppressed', { 
                fnsku: event.fnsku, 
                mode: 'PRIMARY',
                fingerprint: primaryFingerprint 
            });
            continue;
        }

        // Check fallback if FC is missing or we suspect generic stutter
        if (!event.fulfillment_center_id && processedFingerprints.has(fallbackFingerprint)) {
            logger.info('💥 [BROKEN GOODS] duplicate_event_suppressed', { 
                fnsku: event.fnsku, 
                mode: 'FALLBACK',
                fingerprint: fallbackFingerprint 
            });
            continue;
        }

        processedFingerprints.add(primaryFingerprint);
        processedFingerprints.add(fallbackFingerprint);
        deduplicatedLedger.push(event);
    }

    // 2. Tenant-Safe Lookup Maps
    const reimbursementsByFnsku = new Map<string, ReimbursementEvent[]>();
    for (const reimb of (data.reimbursement_events || [])) {
        if (!reimb.fnsku || reimb.seller_id !== sellerId) continue;
        const existing = reimbursementsByFnsku.get(reimb.fnsku) || [];
        existing.push(reimb);
        reimbursementsByFnsku.set(reimb.fnsku, existing);
    }

    // Filter to damaged events
    const damageEvents = deduplicatedLedger.filter(event => 
        event.seller_id === sellerId &&
        event.event_type?.toLowerCase() === 'adjustment' &&
        ['DAMAGED', 'UNSELLABLE', 'DEFECTIVE'].includes(event.disposition?.toUpperCase() || '') &&
        isAmazonAtFault(event.reason_code || '')
    );

    // 3. Reimbursement Consumption Pool (To prevent double-counting linkage)
    const consumedReimbIds = new Set<string>();
    const consumedReimbQtyPerFnsku = new Map<string, number>();
    const consumedReimbValPerFnsku = new Map<string, number>();

    // 4. Tripartite Reconciliation
    for (const damage of damageEvents) {
        const damageDate = new Date(damage.event_date);
        const daysSinceDamage = daysBetween(damageDate, now);

        // a. Physical Recovery Expansion (Direct vs Candidate)
        // ... (preserving Round 1 wins)
        const thirtyDaysAfter = new Date(damageDate);
        thirtyDaysAfter.setDate(thirtyDaysAfter.getDate() + 30);

        const salvageEvents = deduplicatedLedger.filter(l => {
            if (l.seller_id !== sellerId || l.fnsku !== damage.fnsku) return false;
            if (l.disposition?.toUpperCase() !== 'SELLABLE') return false;
            const lDate = new Date(l.event_date);
            return lDate >= damageDate && lDate <= thirtyDaysAfter;
        });

        let recoveredUnits = 0;
        let recoveryMode: 'DIRECT' | 'CANDIDATE' | undefined;
        let recoveryConfidence = 0;

        for (const l of salvageEvents) {
            const lDate = new Date(l.event_date);
            const code = l.reason_code?.toUpperCase();
            const sameFC = (l.fulfillment_center_id && damage.fulfillment_center_id && l.fulfillment_center_id === damage.fulfillment_center_id);
            const narrowWindow = daysBetween(damageDate, lDate) <= 1;

            const isDirectCode = (code === 'F' || code === 'FOUND');
            const isCandidateCode = (code === 'P' || code === 'O');
            const isEmptyCode = !code || code === '';
            const isWash = (code === damage.reason_code?.toUpperCase() && l.quantity < 0);

            const strongSupport = sameFC || narrowWindow;

            if (isDirectCode || isWash || (isCandidateCode && strongSupport) || (isEmptyCode && strongSupport)) {
                recoveredUnits += Math.abs(l.quantity);
                recoveryMode = 'DIRECT';
                recoveryConfidence = 1.0;
            } else if (isCandidateCode) {
                recoveredUnits += (Math.abs(l.quantity) * 0.8);
                if (!recoveryMode) recoveryMode = 'CANDIDATE';
                recoveryConfidence = Math.max(recoveryConfidence, 0.8);
            }
        }

        const effectiveDamagedQty = Math.abs(damage.quantity);
        const physicalUnresolvedQty = Math.max(0, effectiveDamagedQty - recoveredUnits);

        if (physicalUnresolvedQty <= 0) continue;

        // b. Value-Aware Financial Reconciliation
        const reimbursements = reimbursementsByFnsku.get(damage.fnsku) || [];
        
        // Link available (unconsumed) reimbursements
        const linkedReimbs = reimbursements.filter(reimb => {
            if (consumedReimbIds.has(reimb.id)) return false;
            const reimbDate = new Date(reimb.reimbursement_date);
            const daysDiff = daysBetween(damageDate, reimbDate);
            return reimbDate >= damageDate && daysDiff <= 45;
        });

        // c. Valuation Ladder
        const val = getDamagedValuation(damage, linkedReimbs);
        
        let localReimbursedValue = 0;
        let localReimbursedQty = 0;
        const currentLinkedIds: string[] = [];

        for (const reimb of linkedReimbs) {
            if (localReimbursedQty >= physicalUnresolvedQty) break;
            
            localReimbursedValue += reimb.reimbursement_amount;
            localReimbursedQty += (reimb.quantity_reimbursed || 1);
            consumedReimbIds.add(reimb.id);
            currentLinkedIds.push(reimb.id);
        }

        // d. Value-Aware Reconciliation
        const totalDamageValue = physicalUnresolvedQty * val.value;
        const shortfallValue = totalDamageValue - localReimbursedValue;

        // 30-Day SLA Trigger
        if (daysSinceDamage < 30) continue;

        if (shortfallValue > 0.05) {
            const anomalyType = getAnomalyType(damage.reason_code);
            
            const evidence: DamagedInventoryEvidence = {
                fnsku: damage.fnsku,
                sku: damage.sku,
                asin: damage.asin,
                product_name: damage.product_name,
                damage_date: damage.event_date,
                disposition: damage.disposition,
                reason_code: damage.reason_code,
                reason_description: REASON_CODE_DESCRIPTIONS[damage.reason_code.toUpperCase()] || damage.reason_code,
                
                expected_damaged_units: effectiveDamagedQty,
                recovery_found: recoveredUnits > 0,
                recovered_quantity: recoveredUnits,
                recovery_mode: recoveryMode,
                recovery_confidence: recoveryConfidence,

                reimbursement_found: localReimbursedValue > 0,
                reimbursed_quantity: localReimbursedQty,
                reimbursed_value: localReimbursedValue,
                unresolved_units: physicalUnresolvedQty,

                quantity_damaged: damage.quantity, // Legacy compat
                days_since_damage: daysSinceDamage,
                
                // Valuation Ladder Traceability
                unit_value: val.value,
                total_value: totalDamageValue,
                valuation_source: val.source,
                valuation_basis: val.basis,
                valuation_confidence: val.confidence,

                evidence_summary: `[${recoveryMode || 'NO_RECOVERY'}] Reconciliation: ${physicalUnresolvedQty.toFixed(1)} units un-reconciled. ` +
                                 `Source: ${val.source} ($${val.value.toFixed(2)}/unit). ` +
                                 `Expected: $${totalDamageValue.toFixed(2)}, Reimbursed: $${localReimbursedValue.toFixed(2)}. ` +
                                 `Shortfall: $${shortfallValue.toFixed(2)}.`,
                damage_event_id: damage.id
            };

            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                anomaly_type: anomalyType as any,
                severity: calculateSeverity(shortfallValue),
                estimated_value: shortfallValue,
                currency: 'USD',
                confidence_score: (recoveryMode === 'CANDIDATE' ? 0.8 : 0.95) * val.confidence,
                evidence,
                related_event_ids: [damage.id, ...currentLinkedIds],
                discovery_date: discoveryDate,
                deadline_date: deadline,
                days_remaining: daysRemaining,
                fnsku: damage.fnsku,
                sku: damage.sku,
                asin: damage.asin,
                product_name: damage.product_name
            });
        }
    }

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

    const results = await detectDamagedInventory(sellerId, syncId, syncedData);
    
    if (results.length > 0) {
        await storeDamagedDetectionResults(results);
    }
    
    return results;
}

/**
 * Store damaged inventory detection results
 */
export async function storeDamagedDetectionResults(results: DamagedDetectionResult[]): Promise<void> {
    if (results.length === 0) return;

    // Resolve tenant_id for multi-tenancy
    const tenantId = await resolveTenantId(results[0].seller_id);

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
            tenant_id: tenantId,

            status: 'detected',
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
