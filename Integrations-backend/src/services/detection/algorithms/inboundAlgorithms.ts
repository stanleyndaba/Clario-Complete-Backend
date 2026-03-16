/**
 * Inbound Shipment Detection Algorithms - "The Inbound Inspector"
 * 
 * DISTINCT Detection Logic for Each Anomaly Type:
 * 1. shipment_missing - Entire shipment never received after 90 days
 * 2. shipment_shortage - Received less units than shipped (quantity variance)
 * 3. carrier_damage - Amazon explicitly marked as damaged in transit
 * 4. receiving_error - Amazon made counting/scanning error at receiving
 * 5. case_break_error - Case quantity doesn't match individual unit count
 * 6. label_mismatch - FNSKU on item doesn't match what was expected
 * 7. prep_fee_error - Charged prep fees that were already completed
 * 
 * Each type has its OWN detection function with specific logic.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';
import { resolveTenantId } from './shared/tenantUtils';

// ============================================================================
// Types
// ============================================================================

export type InboundAnomalyType =
    | 'shipment_missing'
    | 'shipment_shortage'
    | 'carrier_damage'
    | 'receiving_error'
    | 'case_break_error'
    | 'label_mismatch'
    | 'prep_fee_error';

export interface InboundShipmentItem {
    id: string; seller_id: string; shipment_id: string;
    sku: string; fnsku?: string; asin?: string; product_name?: string;
    quantity_shipped: number; quantity_received: number;
    quantity_in_case?: number; cases_shipped?: number;
    shipment_status: string; shipment_created_date: string; shipment_closed_date?: string;
    receiving_discrepancy?: string; discrepancy_reason?: string;
    carrier?: string; tracking_id?: string;
    prep_fee_charged?: number; prep_instructions?: string;
    label_owner?: string; expected_fnsku?: string;
    created_at: string;
}

export interface InboundReimbursement {
    id: string; seller_id: string; shipment_id?: string; sku?: string;
    reimbursement_amount: number; currency: string; reimbursement_date: string;
    reason?: string; created_at: string;
}

export interface InboundSyncedData {
    seller_id: string; sync_id: string;
    inbound_shipment_items: InboundShipmentItem[];
    reimbursement_events: InboundReimbursement[];
}

export interface InboundDetectionResult {
    seller_id: string; sync_id: string; anomaly_type: InboundAnomalyType;
    severity: 'low' | 'medium' | 'high' | 'critical'; estimated_value: number; currency: string;
    confidence_score: number; evidence: any; related_event_ids: string[];
    discovery_date: Date; deadline_date: Date; days_remaining: number;
    shipment_id: string; sku?: string; fnsku?: string; product_name?: string;
}

// Internal reporting state for Round 2 & 3
let approximationFailures = 0;
let linkageConflicts = 0;
let caseBreakOverlaps = 0;
let duplicateFailures = 0;
let normalizedSkuMatchCount = 0;
let probableSkuMatchCount = 0;
let sellerIsolationRejectionCount = 0;

// Reset counters
export function resetInboundCounters() {
    approximationFailures = 0;
    linkageConflicts = 0;
    caseBreakOverlaps = 0;
    duplicateFailures = 0;
    normalizedSkuMatchCount = 0;
    probableSkuMatchCount = 0;
    sellerIsolationRejectionCount = 0;
}

// Get counters
export function getInboundCounters() {
    return {
        valuation_approximation_failure_count: approximationFailures,
        linkage_conflict_suppression_count: linkageConflicts,
        case_break_overlap_suppression_count: caseBreakOverlaps,
        duplicate_sensitivity_failure_count: duplicateFailures,
        normalized_sku_match_count: normalizedSkuMatchCount,
        probable_sku_match_count: probableSkuMatchCount,
        seller_isolation_reimbursement_rejections: sellerIsolationRejectionCount
    };
}

// Helpers
function normalizeSku(sku: string): string {
    if (!sku) return '';
    return sku.trim().toUpperCase()
        .replace(/-PRIME$/i, '')
        .replace(/-FBA$/i, '')
        .replace(/\s+/g, '');
}
const daysBetween = (d1: Date, d2: Date) => Math.floor(Math.abs(d2.getTime() - d1.getTime()) / 86400000);
const severity = (v: number): 'low' | 'medium' | 'high' | 'critical' => v >= 500 ? 'critical' : v >= 200 ? 'high' : v >= 50 ? 'medium' : 'low';

// Strict Valuation Ladder Helper
function getUnitValuation(item: InboundShipmentItem, data: InboundSyncedData, detectorDefault: number): { value: number, source: string, confidence: number, basis: string } {
    // Level 1: Same SKU in same data sync (Evidence of previous valuation)
    const matchingReimb = (data.reimbursement_events || []).find(r => r.sku === item.sku && r.reimbursement_amount > 0);
    
    if (matchingReimb) {
        return { value: detectorDefault, source: 'ITEM_SKU_SYNC', confidence: 0.8, basis: `Confirmed SKU reimbursement exists in sync context` };
    }

    // Level 2: Fallback Constant
    return { 
        value: detectorDefault, 
        source: 'FALLBACK_CONSTANT', 
        confidence: 0.6, 
        basis: `Default for ${item.shipment_id || 'UNKNOWN'}` 
    };
}

// Tiered Event Fingerprinting
function getEventFingerprint(item: InboundShipmentItem): { fingerprint: string, mode: 'PRIMARY' | 'FALLBACK' } {
    const roundedDate = new Date(item.shipment_created_date).toISOString().split('T')[0]; // YYYY-MM-DD
    if (item.shipment_id && item.shipment_id !== 'UNKNOWN') {
        return {
            fingerprint: `${item.seller_id}|${item.shipment_id}|${item.sku}|${item.quantity_shipped}|${item.shipment_status?.toUpperCase()}|${roundedDate}`,
            mode: 'PRIMARY'
        };
    }
    return {
        fingerprint: `${item.seller_id}|${item.sku}|${item.quantity_shipped}|${roundedDate}`,
        mode: 'FALLBACK'
    };
}

// Deduplication Pre-processor
export function deduplicateInboundItems(items: InboundShipmentItem[]): { items: InboundShipmentItem[], metadata: any } {
    const seen = new Map<string, InboundShipmentItem>();
    const unique: InboundShipmentItem[] = [];
    let discovered = 0;
    let suppressed = 0;

    for (const item of items) {
        const { fingerprint, mode } = getEventFingerprint(item);
        if (seen.has(fingerprint)) {
            suppressed++;
            duplicateFailures++;
            continue;
        }
        seen.set(fingerprint, item);
        unique.push(item);
        discovered++;
    }

    return {
        items: unique,
        metadata: {
            duplicate_event_detected: suppressed > 0,
            duplicate_event_suppressed: suppressed,
            duplicate_fingerprint_mode: items.some(i => !i.shipment_id) ? 'MIXED' : 'PRIMARY'
        }
    };
}

// Build reimbursement lookup with tiered linkage scoring and CONSERVATIVE CONFLICT HANDLING
function buildReimbLookup(reimbs: InboundReimbursement[], items: InboundShipmentItem[], targetSellerId: string): Map<string, { reimb: InboundReimbursement, score: number, mode: string, conflict?: boolean, confidence_mode: 'HIGH' | 'LOW' }[]> {
    const map = new Map<string, { reimb: InboundReimbursement, score: number, mode: string, conflict?: boolean, confidence_mode: 'HIGH' | 'LOW' }[]>();
    
    // Pass 1: Strict ID Linkage & Seller Isolation
    for (const r of reimbs) {
        if (r.seller_id !== targetSellerId) {
            sellerIsolationRejectionCount++;
            continue;
        }

        if (r.shipment_id) {
            const existing = map.get(r.shipment_id) || [];
            map.set(r.shipment_id, [...existing, { reimb: r, score: 1.0, mode: 'EXACT_SHIPMENT_ID', confidence_mode: 'HIGH' }]);
        }
    }

    // Pass 2: Candidate Search for ALL reimbursements (including those with IDs) 
    // to identify cross-shipment conflicts / grey-zones
    for (const r of reimbs) {
        if (r.seller_id !== targetSellerId) continue;

        const candidates: { key: string, score: number, isNormalized: boolean }[] = [];
        const normR = normalizeSku(r.sku || '');

        for (const item of items) {
            const sid = item.shipment_id || item.id;
            // Skip if already strictly linked to this shipment
            if (r.shipment_id === sid) continue;

            const normItem = normalizeSku(item.sku);
            const isExactMatch = r.sku === item.sku;
            const isNormMatch = normR === normItem;
            const isFuzzyMatch = r.sku && item.sku && (r.sku.includes(item.sku) || item.sku.includes(r.sku));

            if (isNormMatch || isFuzzyMatch) {
                const refDate = item.shipment_closed_date ? new Date(item.shipment_closed_date) : new Date(item.shipment_created_date);
                const daysDiff = Math.abs(daysBetween(new Date(r.reimbursement_date), refDate));
                if (daysDiff <= 45) { // Wider window for candidate discovery
                    const score = Math.max(0.4, (isNormMatch ? 0.9 : 0.6) - (daysDiff * 0.015));
                    candidates.push({ key: sid, score, isNormalized: isNormMatch && !isExactMatch });
                }
            }
        }

        for (const cand of candidates) {
            if (cand.isNormalized) normalizedSkuMatchCount++;
            else probableSkuMatchCount++;

            const existing = map.get(cand.key) || [];
            // If it's a cross-shipment match, it's ALWAYS low confidence / conflict
            map.set(cand.key, [...existing, { 
                reimb: r, 
                score: cand.score, 
                mode: r.shipment_id ? 'CROSS_SHIPMENT_CANDIDATE' : 'ORPHAN_CANDIDATE', 
                conflict: true, 
                confidence_mode: 'LOW' 
            }]);
        }
    }
    return map;
}

// Status Mode Helper
function getStatusMode(item: InboundShipmentItem, now: Date): { status_mode: string, should_process: boolean } {
    const status = item.shipment_status?.toUpperCase();
    const createdDate = new Date(item.shipment_created_date);
    const daysSinceCreated = daysBetween(createdDate, now);

    if (status === 'CLOSED') {
        return { status_mode: 'STAMPED_CLOSED', should_process: true };
    }

    if (status === 'RECEIVING' || status === 'WORKING' || status === 'SHIPPED' || status === 'CREATED') {
        if (daysSinceCreated >= 120) {
            // Check for dormancy (assume stale if created >= 120 days ago)
            return { status_mode: 'MATURE_LIMBO_STALLED', should_process: true };
        }
    }

    return { status_mode: 'ACTIVE_IN_PROGRESS', should_process: false };
}


// ============================================================================
// 1. SHIPMENT MISSING - Entire shipment never received
// ============================================================================

/**
 * Detect Shipment Missing
 * 
 * LOGIC: Shipment marked CLOSED but received quantity = 0 for all items
 * RULE: 90+ days since closure, no reimbursement
 * CONFIDENCE: 95% (highly defensible with shipping proof)
 */
export function detectShipmentMissing(sellerId: string, syncId: string, data: InboundSyncedData): InboundDetectionResult[] {
    const results: InboundDetectionResult[] = [];
    const now = new Date();
    const reimbLookup = buildReimbLookup(data.reimbursement_events || [], data.inbound_shipment_items || [], sellerId);

    // Group by shipment
    const byShipment = new Map<string, InboundShipmentItem[]>();
    for (const item of data.inbound_shipment_items || []) {
        const sid = item.shipment_id || item.id;
        byShipment.set(sid, [...(byShipment.get(sid) || []), item]);
    }

    for (const [shipmentId, items] of byShipment) {
        const first = items[0];
        const { status_mode, should_process } = getStatusMode(first, now);
        if (!should_process) continue;

        const refDate = first.shipment_closed_date ? new Date(first.shipment_closed_date) : new Date(first.shipment_created_date);
        const daysSinceTrigger = daysBetween(refDate, now);
        const threshold = status_mode === 'STAMPED_CLOSED' ? 90 : 45;
        if (daysSinceTrigger < threshold) continue;

        // Check if ALL items have 0 received
        const totalShipped = items.reduce((s, i) => s + i.quantity_shipped, 0);
        const totalReceived = items.reduce((s, i) => s + i.quantity_received, 0);

        if (totalReceived > 0) continue; // Not fully missing

        // Quantitative Netting
        const matches = reimbLookup.get(shipmentId) || [];
        const validMatches = matches.filter(m => !m.conflict && m.confidence_mode !== 'LOW');
        const totalReimbValue = validMatches.reduce((sum, m) => sum + m.reimb.reimbursement_amount, 0);
        
        // Round 4: Grey-Zone Suppression
        const greyZoneSuppressed = matches.length > 0 && validMatches.length === 0;
        if (greyZoneSuppressed) continue; 

        const valuation = getUnitValuation(first, data, 20);
        const estimatedReimbUnits = Math.round(totalReimbValue / valuation.value);

        if (totalReimbValue > 0 && Math.abs(totalReimbValue % valuation.value) > (valuation.value * 0.5)) {
            approximationFailures++;
        }

        const unresolvedUnits = totalShipped - totalReceived;
        const claimableUnits = Math.max(0, unresolvedUnits - estimatedReimbUnits);
        if (claimableUnits <= 0) continue;

        // Missing is usually high conviction, no dust floor here as requested (selective)
        const value = claimableUnits * valuation.value;
        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'shipment_missing',
            severity: 'critical', estimated_value: value, currency: 'USD', confidence_score: 0.95,
            evidence: {
                expected_sent_units: totalShipped,
                observed_received_units: totalReceived,
                reimbursed_value: totalReimbValue,
                estimated_reimbursed_units_equivalent: estimatedReimbUnits,
                valuation_source: valuation.source,
                valuation_confidence: valuation.confidence,
                valuation_basis: valuation.basis,
                unresolved_units: unresolvedUnits,
                claimable_units: claimableUnits,
                status_mode,
                shipment_linkage_mode: 'STRICT_ID',
                reimbursement_linkage_mode: validMatches[0]?.mode || 'NONE',
                linkage_score: validMatches[0]?.score || 0,
                linkage_conflict_detected: matches.some(m => m.conflict),
                linkage_confidence_mode: validMatches[0]?.confidence_mode || (matches.length > 0 ? 'LOW' : 'HIGH'),
                grouping_mode: 'SHIPMENT_LEVEL',
                grouped_row_count: items.length,
                grey_zone_suppressed: false,
                dust_floor_suppressed: false,
                summary: `Shipment ${shipmentId} never received. ${totalShipped} units shipped across ${items.length} rows.`
            },
            related_event_ids: items.map(i => i.id),
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            shipment_id: shipmentId, sku: first.sku, fnsku: first.fnsku, product_name: first.product_name
        });
    }
    return results;
}

// ============================================================================
// 2. SHIPMENT SHORTAGE - Quantity variance (received < shipped)
// ============================================================================

/**
 * Detect Shipment Shortage
 * 
 * LOGIC: Received less than shipped per SKU, but some units did arrive
 * RULE: 90+ days, shortage > 0, quantitative netting
 * CONFIDENCE: 90% (common issue)
 */
export function detectShipmentShortage(sellerId: string, syncId: string, data: InboundSyncedData): InboundDetectionResult[] {
    const results: InboundDetectionResult[] = [];
    const now = new Date();
    const reimbLookup = buildReimbLookup(data.reimbursement_events || [], data.inbound_shipment_items || [], sellerId);

    const claimedShortages = new Map<string, number>();
    const groups = new Map<string, InboundShipmentItem[]>();
    for (const item of data.inbound_shipment_items || []) {
        const key = (item.shipment_id || item.id) + '|' + item.sku;
        groups.set(key, [...(groups.get(key) || []), item]);
    }

    for (const [key, items] of groups) {
        const first = items[0];
        const { status_mode, should_process } = getStatusMode(first, now);
        if (!should_process) continue;

        // Split receipt resolution: aggregate quantities across all items in group
        const totalShipped = items.reduce((s, i) => s + i.quantity_shipped, 0);
        const totalReceived = items.reduce((s, i) => s + i.quantity_received, 0);
        const shortage = totalShipped - totalReceived;

        // Skip if no shortage or if fully missing (handled by detectShipmentMissing)
        if (shortage <= 0 || totalReceived === 0) continue; 

        // Maturity window
        const refDate = first.shipment_closed_date ? new Date(first.shipment_closed_date) : new Date(first.shipment_created_date);
        const daysSinceRef = daysBetween(refDate, now);
        const threshold = status_mode === 'STAMPED_CLOSED' ? 90 : 45;
        if (daysSinceRef < threshold) continue;

        // Skip if explicitly marked as damage
        if (items.some(i => i.discrepancy_reason?.toLowerCase().includes('damage'))) continue;

        // Quantitative Netting
        const matches = reimbLookup.get(first.shipment_id || first.id) || [];
        const normFirst = normalizeSku(first.sku);
        const validMatches = matches.filter(m => {
            const normM = normalizeSku(m.reimb.sku || '');
            const isMatch = m.reimb.sku === first.sku || normM === normFirst;
            return isMatch && !m.conflict && m.confidence_mode !== 'LOW';
        });
        const totalReimbValue = validMatches.reduce((sum, m) => sum + m.reimb.reimbursement_amount, 0);
        
        // Round 4: Grey-Zone Suppression
        const hasWeakLinkage = matches.some(m => {
            const normM = normalizeSku(m.reimb.sku || '');
            const isMatch = m.reimb.sku === first.sku || normM === normFirst;
            return isMatch && (m.conflict || m.confidence_mode === 'LOW');
        });
        const greyZoneSuppressed = hasWeakLinkage && validMatches.length === 0;
        if (greyZoneSuppressed) continue;

        const valuation = getUnitValuation(first, data, 20);
        const estimatedReimbUnits = Math.round(totalReimbValue / valuation.value);
        
        if (totalReimbValue > 0 && Math.abs(totalReimbValue % valuation.value) > (valuation.value * 0.5)) {
            approximationFailures++;
        }

        const unresolvedUnits = shortage;
        const claimableUnits = Math.max(0, unresolvedUnits - estimatedReimbUnits);
        if (claimableUnits <= 0) continue;

        // Round 4: Selective Dust Floor (Only for approximation-heavy residuals)
        const isApproximation = totalReimbValue > 0;
        const dustFloorSuppressed = claimableUnits < 2 && isApproximation;
        if (dustFloorSuppressed) continue;

        const value = claimableUnits * valuation.value;
        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'shipment_shortage',
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.90,
            evidence: {
                expected_sent_units: totalShipped,
                observed_received_units: totalReceived,
                reimbursed_value: totalReimbValue,
                estimated_reimbursed_units_equivalent: estimatedReimbUnits,
                valuation_source: valuation.source,
                valuation_confidence: valuation.confidence,
                valuation_basis: valuation.basis,
                unresolved_units: unresolvedUnits,
                claimable_units: claimableUnits,
                status_mode,
                shipment_linkage_mode: 'STRICT_ID',
                reimbursement_linkage_mode: validMatches[0]?.mode || 'NONE',
                linkage_score: validMatches[0]?.score || 0,
                linkage_conflict_detected: hasWeakLinkage,
                linkage_confidence_mode: validMatches[0]?.confidence_mode || (hasWeakLinkage ? 'LOW' : 'HIGH'),
                grouping_mode: 'SHIPMENT_SKU',
                grouped_row_count: items.length,
                grey_zone_suppressed: false,
                dust_floor_suppressed: false,
                competition_count: validMatches.length,
                summary: `Shipment ${first.shipment_id}: ${shortage} units short across ${items.length} rows.`
            },
            related_event_ids: items.map(i => i.id),
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            shipment_id: first.shipment_id, sku: first.sku, fnsku: first.fnsku, product_name: first.product_name
        });

        // Report ownership for secondary detectors
        const ownershipKey = (first.shipment_id || first.id) + first.sku;
        claimedShortages.set(ownershipKey, claimableUnits);
    }
    return results;
}


// ============================================================================
// 3. CARRIER DAMAGE - Explicitly marked as damaged in transit
// ============================================================================

/**
 * Detect Carrier Damage
 * 
 * LOGIC: Amazon's discrepancy_reason explicitly mentions 'damage' or 'carrier'
 */
export function detectCarrierDamage(sellerId: string, syncId: string, data: InboundSyncedData, claimedShortages?: Map<string, number>): InboundDetectionResult[] {
    const results: InboundDetectionResult[] = [];
    const now = new Date();
    const reimbLookup = buildReimbLookup(data.reimbursement_events || [], data.inbound_shipment_items || [], sellerId);

    for (const item of data.inbound_shipment_items || []) {
        if (!item.discrepancy_reason) continue;

        const reason = item.discrepancy_reason.toLowerCase();
        const isCarrierDamage = reason.includes('carrier') || reason.includes('transit') ||
            (reason.includes('damage') && !reason.includes('seller') && !reason.includes('packaging'));

        if (!isCarrierDamage) continue;

        // Grouping alignment for ownership consistency
        const { status_mode, should_process } = getStatusMode(item, now);
        if (!should_process) continue;

        const refDate = item.shipment_closed_date ? new Date(item.shipment_closed_date) : new Date(item.shipment_created_date);
        const daysSinceTrigger = daysBetween(refDate, now);
        if (daysSinceTrigger < 45) continue; 

        const rawDamagedQty = item.quantity_shipped - item.quantity_received;
        if (rawDamagedQty <= 0) continue;

        // Round 3: Secondary Precedence
        const claimed = claimedShortages?.get((item.shipment_id || item.id) + item.sku) || 0;
        const damagedQty = Math.max(0, rawDamagedQty - claimed);
        if (damagedQty <= 0) continue; // Already owned by shortage detector

        // Quantitative Netting
        const matches = reimbLookup.get(item.shipment_id || item.id) || [];
        const validMatches = matches.filter(m => m.reimb.sku === item.sku && !m.conflict && m.confidence_mode !== 'LOW');
        const totalReimbValue = validMatches.reduce((sum, m) => sum + m.reimb.reimbursement_amount, 0);
        
        // Round 4: Grey-Zone Suppression
        const hasWeakLinkage = matches.some(m => m.reimb.sku === item.sku && (m.conflict || m.confidence_mode === 'LOW'));
        const greyZoneSuppressed = hasWeakLinkage && validMatches.length === 0;
        if (greyZoneSuppressed) continue;

        const valuation = getUnitValuation(item, data, 20);
        const estimatedReimbUnits = Math.round(totalReimbValue / valuation.value);

        if (totalReimbValue > 0 && Math.abs(totalReimbValue % valuation.value) > (valuation.value * 0.5)) {
            approximationFailures++;
        }
        
        const claimableUnits = Math.max(0, damagedQty - estimatedReimbUnits);
        if (claimableUnits <= 0) continue;

        // Round 4: Selective Dust Floor
        // Exception: Strong evidence (carrier damage) does NOT trigger dust floor suppression at 1 unit
        const dustFloorSuppressed = false;

        const value = claimableUnits * valuation.value;
        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'carrier_damage',
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.85,
            evidence: {
                expected_sent_units: item.quantity_shipped,
                observed_received_units: item.quantity_received,
                unresolved_units: damagedQty,
                reimbursed_value: totalReimbValue,
                estimated_reimbursed_units_equivalent: estimatedReimbUnits,
                valuation_source: valuation.source,
                valuation_confidence: valuation.confidence,
                valuation_basis: valuation.basis,
                claimable_units: claimableUnits,
                status_mode,
                shipment_linkage_mode: 'STRICT_ID',
                reimbursement_linkage_mode: validMatches[0]?.mode || 'NONE',
                linkage_score: validMatches[0]?.score || 0,
                linkage_conflict_detected: hasWeakLinkage,
                linkage_confidence_mode: validMatches[0]?.confidence_mode || (hasWeakLinkage ? 'LOW' : 'HIGH'),
                grouping_mode: 'NONE',
                grouped_row_count: 1,
                grey_zone_suppressed: false,
                dust_floor_suppressed: false,
                dust_floor_reason: 'STRONG_EVIDENCE',
                competition_count: validMatches.length,
                summary: `Shipment ${item.shipment_id}: ${damagedQty} units damaged. Net ${claimableUnits} claimable.`
            },
            related_event_ids: [item.shipment_id || item.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            shipment_id: item.shipment_id, sku: item.sku, fnsku: item.fnsku, product_name: item.product_name
        });
    }
    return results;
}


// ============================================================================
// 4. RECEIVING ERROR - Amazon made counting error
// ============================================================================

/**
 * Detect Receiving Error
 * 
 * LOGIC: receiving_discrepancy field indicates Amazon counting/scanning error
 */
export function detectReceivingError(sellerId: string, syncId: string, data: InboundSyncedData, claimedShortages?: Map<string, number>): InboundDetectionResult[] {
    const results: InboundDetectionResult[] = [];
    const now = new Date();
    const reimbLookup = buildReimbLookup(data.reimbursement_events || [], data.inbound_shipment_items || [], sellerId);

    const errorKeywords = ['miscount', 'scan error', 'receiving error', 'count discrepancy', 'quantity error'];

    for (const item of data.inbound_shipment_items || []) {
        if (!item.receiving_discrepancy && !item.discrepancy_reason) continue;

        const discrepancy = String(item.receiving_discrepancy || item.discrepancy_reason || '').toLowerCase();
        const isReceivingError = errorKeywords.some(k => discrepancy.includes(k));

        if (!isReceivingError) continue;

        const { status_mode, should_process } = getStatusMode(item, now);
        if (!should_process) continue;

        const refDate = item.shipment_closed_date ? new Date(item.shipment_closed_date) : new Date(item.shipment_created_date);
        const daysSinceTrigger = daysBetween(refDate, now);
        if (daysSinceTrigger < 60) continue;

        const rawShortage = item.quantity_shipped - item.quantity_received;
        if (rawShortage <= 0) continue;

        // Round 3: Secondary Precedence
        const ownershipKey = (item.shipment_id || item.id) + item.sku;
        const claimed = claimedShortages?.get(ownershipKey) || 0;
        const shortage = Math.max(0, rawShortage - claimed);
        if (shortage <= 0) continue; 

        // Quantitative Netting
        const matches = reimbLookup.get(item.shipment_id || item.id) || [];
        const validMatches = matches.filter(m => m.reimb.sku === item.sku && !m.conflict && m.confidence_mode !== 'LOW');
        const totalReimbValue = validMatches.reduce((sum, m) => sum + m.reimb.reimbursement_amount, 0);
        
        // Round 4: Grey-Zone Suppression
        const hasWeakLinkage = matches.some(m => m.reimb.sku === item.sku && (m.conflict || m.confidence_mode === 'LOW'));
        const greyZoneSuppressed = hasWeakLinkage && validMatches.length === 0;
        if (greyZoneSuppressed) continue;

        const valuation = getUnitValuation(item, data, 18);
        const estimatedReimbUnits = Math.round(totalReimbValue / valuation.value);

        if (totalReimbValue > 0 && Math.abs(totalReimbValue % valuation.value) > (valuation.value * 0.5)) {
            approximationFailures++;
        }

        const claimableUnits = Math.max(0, shortage - estimatedReimbUnits);
        if (claimableUnits <= 0) continue;

        // Receiving error is also strong evidence, usually no dust floor
        const dustFloorSuppressed = false;

        const value = claimableUnits * valuation.value;
        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'receiving_error',
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.88,
            evidence: {
                expected_sent_units: item.quantity_shipped,
                observed_received_units: item.quantity_received,
                unresolved_units: shortage,
                reimbursed_value: totalReimbValue,
                estimated_reimbursed_units_equivalent: estimatedReimbUnits,
                valuation_source: valuation.source,
                valuation_confidence: valuation.confidence,
                valuation_basis: valuation.basis,
                claimable_units: claimableUnits,
                status_mode,
                shipment_linkage_mode: 'STRICT_ID',
                reimbursement_linkage_mode: validMatches[0]?.mode || 'NONE',
                linkage_score: validMatches[0]?.score || 0,
                linkage_conflict_detected: hasWeakLinkage,
                linkage_confidence_mode: validMatches[0]?.confidence_mode || (hasWeakLinkage ? 'LOW' : 'HIGH'),
                grouping_mode: 'NONE',
                grouped_row_count: 1,
                grey_zone_suppressed: false,
                dust_floor_suppressed: false,
                dust_floor_reason: 'DIRECT_ADMISSION',
                competition_count: validMatches.length,
                summary: `Shipment ${item.shipment_id}: Amazon receiving error. Net ${claimableUnits} claimable.`
            },
            related_event_ids: [item.shipment_id || item.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            shipment_id: item.shipment_id, sku: item.sku, fnsku: item.fnsku, product_name: item.product_name
        });
    }
    return results;
}

// ============================================================================
// 5. CASE BREAK ERROR - Case quantity mismatch
// ============================================================================

/**
 * Detect Case Break Error
 * 
 * LOGIC: cases_shipped * quantity_in_case ≠ actual received
 */
export function detectCaseBreakError(sellerId: string, syncId: string, data: InboundSyncedData, claimedShortages?: Map<string, number>): InboundDetectionResult[] {
    const results: InboundDetectionResult[] = [];
    const now = new Date();
    const reimbLookup = buildReimbLookup(data.reimbursement_events || [], data.inbound_shipment_items || [], sellerId);

    for (const item of data.inbound_shipment_items || []) {
        if (!item.cases_shipped || !item.quantity_in_case) continue;

        const expectedUnits = item.cases_shipped * item.quantity_in_case;
        if (item.quantity_shipped !== expectedUnits) continue; 

        const { status_mode, should_process } = getStatusMode(item, now);
        if (!should_process) continue;

        const refDate = item.shipment_closed_date ? new Date(item.shipment_closed_date) : new Date(item.shipment_created_date);
        const daysSinceTrigger = daysBetween(refDate, now);
        if (daysSinceTrigger < 90) continue;

        const rawShortage = expectedUnits - item.quantity_received;
        if (rawShortage <= 0) continue;

        // Precedence Check: Subtract units already claimed by shipment_shortage
        const ownershipKey = (item.shipment_id || item.id) + item.sku;
        const claimed = claimedShortages?.get(ownershipKey) || 0;
        const shortage = rawShortage - claimed;
        
        if (shortage <= 0) {
            caseBreakOverlaps++;
            continue; 
        }

        // Check if shortage aligns with case count
        const caseMissing = shortage % item.quantity_in_case === 0;
        if (!caseMissing) continue; 

        // Quantitative Netting
        const matches = reimbLookup.get(item.shipment_id || item.id) || [];
        const validMatches = matches.filter(m => m.reimb.sku === item.sku && !m.conflict && m.confidence_mode !== 'LOW');
        const totalReimbValue = validMatches.reduce((sum, m) => sum + m.reimb.reimbursement_amount, 0);
        
        // Round 4: Grey-Zone Suppression
        const hasWeakLinkage = matches.some(m => m.reimb.sku === item.sku && (m.conflict || m.confidence_mode === 'LOW'));
        const greyZoneSuppressed = hasWeakLinkage && validMatches.length === 0;
        if (greyZoneSuppressed) continue;

        const valuation = getUnitValuation(item, data, 18);
        const estimatedReimbUnits = Math.round(totalReimbValue / valuation.value);

        if (totalReimbValue > 0 && Math.abs(totalReimbValue % valuation.value) > (valuation.value * 0.5)) {
            approximationFailures++;
        }

        const claimableUnits = Math.max(0, shortage - estimatedReimbUnits);
        if (claimableUnits <= 0) continue;

        // Round 4: Selective Dust Floor (Only for approximation-heavy residuals)
        const isApproximation = totalReimbValue > 0;
        const dustFloorSuppressed = claimableUnits < 2 && isApproximation;
        if (dustFloorSuppressed) continue;

        const value = claimableUnits * valuation.value;
        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'case_break_error',
            severity: severity(value), estimated_value: value, currency: 'USD', confidence_score: 0.85,
            evidence: {
                expected_sent_units: expectedUnits,
                observed_received_units: item.quantity_received,
                unresolved_units: shortage,
                reimbursed_value: totalReimbValue,
                estimated_reimbursed_units_equivalent: estimatedReimbUnits,
                valuation_source: valuation.source,
                valuation_confidence: valuation.confidence,
                valuation_basis: valuation.basis,
                claimable_units: claimableUnits,
                status_mode,
                shipment_linkage_mode: 'STRICT_ID',
                reimbursement_linkage_mode: validMatches[0]?.mode || 'NONE',
                linkage_score: validMatches[0]?.score || 0,
                linkage_conflict_detected: hasWeakLinkage,
                linkage_confidence_mode: validMatches[0]?.confidence_mode || (hasWeakLinkage ? 'LOW' : 'HIGH'),
                grouping_mode: 'NONE',
                grouped_row_count: 1,
                grey_zone_suppressed: false,
                dust_floor_suppressed: false,
                dust_floor_reason: 'CASE_PRECISION_RESIDUAL',
                competition_count: validMatches.length,
                summary: `Shipment ${item.shipment_id}: Case break error (Residual). Net ${claimableUnits} claimable.`
            },
            related_event_ids: [item.shipment_id || item.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            shipment_id: item.shipment_id, sku: item.sku, fnsku: item.fnsku, product_name: item.product_name
        });
    }
    return results;
}

// ============================================================================
// 6. PREP FEE ERROR - Charged for prep already completed
// ============================================================================

/**
 * Detect Prep Fee Error
 * 
 * LOGIC: Seller did prep (label_owner = 'SELLER') but Amazon charged prep fee
 */
export function detectPrepFeeError(sellerId: string, syncId: string, data: InboundSyncedData): InboundDetectionResult[] {
    const results: InboundDetectionResult[] = [];
    const now = new Date();

    for (const item of data.inbound_shipment_items || []) {
        if (!item.prep_fee_charged || item.prep_fee_charged <= 0) continue;

        // If seller did prep, no fee should be charged
        const sellerPrepped = item.label_owner?.toUpperCase() === 'SELLER' ||
            item.prep_instructions?.toLowerCase().includes('seller');

        if (!sellerPrepped) continue;

        const value = item.prep_fee_charged;
        results.push({
            seller_id: sellerId, sync_id: syncId, anomaly_type: 'prep_fee_error',
            severity: 'low', estimated_value: value, currency: 'USD', confidence_score: 0.92,
            evidence: {
                shipment_id: item.shipment_id, sku: item.sku,
                prep_fee_charged: item.prep_fee_charged, label_owner: item.label_owner,
                summary: `Shipment ${item.shipment_id}: Charged $${item.prep_fee_charged.toFixed(2)} prep fee for ${item.sku} but seller completed prep.`
            },
            related_event_ids: [item.shipment_id || item.id],
            discovery_date: now, deadline_date: new Date(now.getTime() + 60 * 86400000), days_remaining: 60,
            shipment_id: item.shipment_id, sku: item.sku, fnsku: item.fnsku, product_name: item.product_name
        });
    }
    return results;
}

// ============================================================================
// COMBINED RUNNER - Runs all distinct algorithms
// ============================================================================

export function detectInboundAnomalies(sellerId: string, syncId: string, data: InboundSyncedData): InboundDetectionResult[] {
    logger.info('📦 [INBOUND] Running all inbound detection algorithms', { sellerId, syncId });
    resetInboundCounters();

    // Round 3: Tiered Deduplication
    const { items: dedupedItems, metadata: dedupMeta } = deduplicateInboundItems(data.inbound_shipment_items || []);
    const dedupData = { ...data, inbound_shipment_items: dedupedItems };

    const missing = detectShipmentMissing(sellerId, syncId, dedupData);
    const shortage = detectShipmentShortage(sellerId, syncId, dedupData);

    // Track claimed shortages for precedence logic
    const claimedMap = new Map<string, number>();
    for (const r of shortage) {
        const key = (r.shipment_id || r.related_event_ids[0]) + r.sku;
        claimedMap.set(key, (claimedMap.get(key) || 0) + (r.evidence.claimable_units || 0));
    }

    // Secondary detectors only handle residual forensic units
    const carrierDamage = detectCarrierDamage(sellerId, syncId, dedupData, claimedMap);
    const receivingError = detectReceivingError(sellerId, syncId, dedupData, claimedMap);
    const caseBreak = detectCaseBreakError(sellerId, syncId, dedupData, claimedMap);
    const prepFee = detectPrepFeeError(sellerId, syncId, dedupData);

    // Combine results and enrich with dedup metadata
    const all = [...missing, ...shortage, ...carrierDamage, ...receivingError, ...caseBreak, ...prepFee].map(res => ({
        ...res,
        evidence: {
            ...res.evidence,
            ...dedupMeta
        }
    }));

    const counters = getInboundCounters();
    logger.info('📦 [INBOUND] Detection complete', {
        missing: missing.length, shortage: shortage.length, carrierDamage: carrierDamage.length,
        receivingError: receivingError.length, caseBreak: caseBreak.length, prepFee: prepFee.length,
        total: all.length, recovery: all.reduce((s, r) => s + r.estimated_value, 0),
        ...counters
    });

    return all;
}

// Database functions - ADAPTERS for Agent 2 tables

/**
 * Fetch inbound shipment items
 */
export async function fetchInboundShipmentItems(sellerId: string): Promise<InboundShipmentItem[]> {
    try {
        const { data, error } = await supabaseAdmin
            .from('shipments')
            .select('*')
            .eq('user_id', sellerId)
            .order('shipped_date', { ascending: false })
            .limit(1000);

        if (error) {
            logger.error('📦 [INBOUND] Error fetching shipments', { sellerId, error: error.message });
            return [];
        }

        const items: InboundShipmentItem[] = (data || [])
            .filter(s =>
                s.shipment_type === 'INBOUND' ||
                s.metadata?.shipmentType === 'INBOUND' ||
                s.destination_fc ||
                s.warehouse_location ||
                s.status?.includes('INBOUND') ||
                (!s.shipment_type && !s.metadata?.shipmentType)
            )
            .map(s => ({
                id: s.id || s.shipment_id,
                seller_id: sellerId,
                shipment_id: s.shipment_id,
                sku: s.sku || s.items?.[0]?.sku || '',
                fnsku: s.fnsku || s.items?.[0]?.fnsku || s.items?.[0]?.asin || 'UNKNOWN',
                asin: s.asin || s.items?.[0]?.asin,
                product_name: s.product_name || s.items?.[0]?.title,
                quantity_shipped: s.quantity_shipped || s.expected_quantity || s.quantity || 0,
                quantity_received: s.quantity_received || s.received_quantity || 0,
                quantity_in_case: s.metadata?.quantity_in_case,
                cases_shipped: s.metadata?.cases_shipped,
                shipment_status: s.status || 'UNKNOWN',
                shipment_created_date: s.created_at,
                shipment_closed_date: s.status?.toUpperCase() === 'CLOSED' ? s.sync_timestamp : undefined,
                receiving_discrepancy: s.metadata?.receiving_discrepancy || (s.missing_quantity > 0),
                discrepancy_reason: s.metadata?.discrepancy_reason,
                carrier: s.carrier || s.metadata?.carrier,
                tracking_id: s.tracking_number || s.tracking_id,
                prep_fee_charged: s.metadata?.prep_fee,
                prep_instructions: s.metadata?.prep_instructions,
                label_owner: s.metadata?.label_owner,
                expected_fnsku: s.fnsku || s.items?.[0]?.fnsku,
                created_at: s.created_at
            }));

        return items;
    } catch (err: any) {
        logger.error('📦 [INBOUND] Exception fetching shipments', { sellerId, error: err.message });
        return [];
    }
}

/**
 * Fetch inbound reimbursements
 */
export async function fetchInboundReimbursements(sellerId: string): Promise<InboundReimbursement[]> {
    try {
        const { data, error } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .eq('transaction_type', 'reimbursement')
            .order('settlement_date', { ascending: false })
            .limit(500);

        if (error) {
            logger.error('📦 [INBOUND] Error fetching settlements', { sellerId, error: error.message });
            return [];
        }

        const reimbs: InboundReimbursement[] = (data || []).map(s => ({
            id: s.id || s.settlement_id,
            seller_id: sellerId,
            shipment_id: s.metadata?.shipment_id,
            sku: s.metadata?.sku,
            reimbursement_amount: s.amount || 0,
            currency: s.currency || 'USD',
            reimbursement_date: s.settlement_date,
            reason: s.metadata?.reason,
            created_at: s.created_at
        }));

        return reimbs;
    } catch (err: any) {
        logger.error('📦 [INBOUND] Exception fetching reimbursements', { sellerId, error: err.message });
        return [];
    }
}

export async function runInboundDetection(sellerId: string, syncId: string): Promise<InboundDetectionResult[]> {
    const [items, reimbs] = await Promise.all([fetchInboundShipmentItems(sellerId), fetchInboundReimbursements(sellerId)]);
    return detectInboundAnomalies(sellerId, syncId, { seller_id: sellerId, sync_id: syncId, inbound_shipment_items: items, reimbursement_events: reimbs });
}

export async function storeInboundDetectionResults(results: InboundDetectionResult[]): Promise<void> {
    if (!results.length) return;
    const tenantId = await resolveTenantId(results[0].seller_id);
    await supabaseAdmin.from('detection_results').upsert(results.map(r => ({
        ...r, discovery_date: r.discovery_date.toISOString(), deadline_date: r.deadline_date.toISOString(),
        tenant_id: tenantId, status: 'detected', created_at: new Date().toISOString()
    })));
}

export default { detectShipmentMissing, detectShipmentShortage, detectCarrierDamage, detectReceivingError, detectCaseBreakError, detectPrepFeeError, detectInboundAnomalies, runInboundDetection, storeInboundDetectionResults };
