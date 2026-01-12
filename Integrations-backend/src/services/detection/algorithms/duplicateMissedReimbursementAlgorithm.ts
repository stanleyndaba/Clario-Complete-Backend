/**
 * Duplicate / Missed Reimbursement Sentinel Algorithm
 * 
 * Agent 3: Discovery Agent - Recovery Lifecycle Reconciliation
 * 
 * Detects two dangerous realities:
 * A) MISSED: Amazon reimburses once, seller loses again, Amazon never reimburses again
 * B) DUPLICATE: Amazon reimburses twice (clawback risk)
 * 
 * Detection approach:
 * 1. Build recovery lifecycle per SKU/FNSKU
 * 2. Match losses to reimbursements
 * 3. Detect mismatches (unrecovered losses, duplicate payments)
 * 4. Score risk and defensibility
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface LossEvent {
    id: string;
    seller_id: string;
    event_type: 'lost' | 'damaged' | 'disposed' | 'removed' | 'adjustment';
    event_date: string;
    sku?: string;
    fnsku?: string;
    asin?: string;
    order_id?: string;
    shipment_id?: string;
    quantity: number;
    estimated_value: number;
    currency: string;
    source: 'inventory_ledger' | 'fba_returns' | 'removal_order' | 'adjustment_report';
}

export interface ReimbursementEvent {
    id: string;
    seller_id: string;
    reimbursement_date: string;
    sku?: string;
    fnsku?: string;
    asin?: string;
    order_id?: string;
    quantity: number;
    amount: number;
    currency: string;
    reason?: string;
    case_id?: string;
}

export interface RecoveryLifecycle {
    sku: string;
    fnsku?: string;
    asin?: string;

    // Aggregated data
    total_losses: number;
    total_loss_quantity: number;
    total_loss_value: number;

    total_reimbursements: number;
    total_reimbursement_quantity: number;
    total_reimbursement_value: number;

    // Matching status
    net_quantity_gap: number;      // Lost qty - Reimbursed qty
    net_value_gap: number;         // Lost value - Reimbursed value

    // Individual events
    loss_events: LossEvent[];
    reimbursement_events: ReimbursementEvent[];

    // Match analysis
    unmatched_losses: LossEvent[];
    potential_duplicates: ReimbursementEvent[];
}

export interface SentinelDetectionResult {
    seller_id: string;
    sync_id: string;

    detection_type: 'missed_reimbursement' | 'duplicate_reimbursement' | 'clawback_risk';

    // SKU info
    sku?: string;
    fnsku?: string;
    asin?: string;

    // Metrics
    loss_count: number;
    reimbursement_count: number;
    quantity_gap: number;
    value_gap: number;

    // Specific event references
    unmatched_loss_ids: string[];
    duplicate_reimbursement_ids: string[];

    // Financial impact
    estimated_recovery: number;
    clawback_risk_value: number;
    currency: string;

    // Classification
    severity: 'low' | 'medium' | 'high' | 'critical';
    risk_level: 'low' | 'moderate' | 'high' | 'extreme';
    recommended_action: 'monitor' | 'review' | 'file_claim' | 'preemptive_audit';

    // Confidence
    confidence_score: number;
    confidence_factors: SentinelConfidenceFactors;

    // Evidence
    evidence: {
        recovery_lifecycle: RecoveryLifecycle;
        detection_reasons: string[];
    };
}

export interface SentinelConfidenceFactors {
    clear_loss_trail: boolean;        // +0.25
    reimbursement_documented: boolean; // +0.20
    quantity_match_possible: boolean;  // +0.20
    time_proximity: boolean;           // +0.20
    consistent_sku_data: boolean;      // +0.15
    calculated_score: number;
}

export interface SentinelSyncedData {
    seller_id: string;
    sync_id: string;
    loss_events: LossEvent[];
    reimbursement_events: ReimbursementEvent[];
}

// ============================================================================
// Constants
// ============================================================================

// Time window for matching losses to reimbursements (days)
const MATCHING_WINDOW_DAYS = 90;

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_RECOMMEND_FILING = 0.75;

// Gap thresholds for detection
const MIN_QUANTITY_GAP = 1;
const MIN_VALUE_GAP = 10;

// Confidence weights
const WEIGHT_CLEAR_LOSS = 0.25;
const WEIGHT_REIMB_DOCUMENTED = 0.20;
const WEIGHT_QTY_MATCH = 0.20;
const WEIGHT_TIME_PROXIMITY = 0.20;
const WEIGHT_CONSISTENT_SKU = 0.15;

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect duplicate and missed reimbursements
 */
export async function detectDuplicateMissedReimbursements(
    sellerId: string,
    syncId: string,
    data: SentinelSyncedData
): Promise<SentinelDetectionResult[]> {
    const results: SentinelDetectionResult[] = [];

    logger.info('🔍 [SENTINEL] Starting duplicate/missed reimbursement detection', {
        sellerId,
        syncId,
        lossCount: data.loss_events?.length || 0,
        reimbursementCount: data.reimbursement_events?.length || 0
    });

    if (!data.loss_events?.length && !data.reimbursement_events?.length) {
        logger.info('🔍 [SENTINEL] No events to analyze');
        return results;
    }

    // Step 1: Build recovery lifecycle per SKU
    const lifecycles = buildRecoveryLifecycles(
        sellerId,
        data.loss_events || [],
        data.reimbursement_events || []
    );

    logger.info('🔍 [SENTINEL] Built recovery lifecycles', {
        skuCount: lifecycles.size
    });

    // Step 2: Analyze each lifecycle for anomalies
    for (const [sku, lifecycle] of lifecycles) {
        try {
            const detections = analyzeRecoveryLifecycle(sellerId, syncId, lifecycle);

            for (const detection of detections) {
                if (detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                    results.push(detection);
                }
            }
        } catch (error: any) {
            logger.warn('🔍 [SENTINEL] Error analyzing lifecycle', {
                sku,
                error: error.message
            });
        }
    }

    // Sort by value gap (highest first)
    results.sort((a, b) => Math.abs(b.value_gap) - Math.abs(a.value_gap));

    const missedCount = results.filter(r => r.detection_type === 'missed_reimbursement').length;
    const duplicateCount = results.filter(r => r.detection_type === 'duplicate_reimbursement').length;
    const totalRecovery = results.reduce((sum, r) => sum + r.estimated_recovery, 0);
    const totalClawbackRisk = results.reduce((sum, r) => sum + r.clawback_risk_value, 0);

    logger.info('🔍 [SENTINEL] Detection complete', {
        sellerId,
        missedReimbursements: missedCount,
        duplicateReimbursements: duplicateCount,
        totalRecoveryOpportunity: totalRecovery.toFixed(2),
        clawbackRisk: totalClawbackRisk.toFixed(2)
    });

    return results;
}

/**
 * Build recovery lifecycle per SKU
 */
function buildRecoveryLifecycles(
    sellerId: string,
    losses: LossEvent[],
    reimbursements: ReimbursementEvent[]
): Map<string, RecoveryLifecycle> {
    const lifecycles = new Map<string, RecoveryLifecycle>();

    // Helper to get or create lifecycle
    const getLifecycle = (sku: string, fnsku?: string, asin?: string): RecoveryLifecycle => {
        const key = sku || fnsku || asin || 'unknown';
        if (!lifecycles.has(key)) {
            lifecycles.set(key, {
                sku: key,
                fnsku,
                asin,
                total_losses: 0,
                total_loss_quantity: 0,
                total_loss_value: 0,
                total_reimbursements: 0,
                total_reimbursement_quantity: 0,
                total_reimbursement_value: 0,
                net_quantity_gap: 0,
                net_value_gap: 0,
                loss_events: [],
                reimbursement_events: [],
                unmatched_losses: [],
                potential_duplicates: []
            });
        }
        return lifecycles.get(key)!;
    };

    // Process loss events
    for (const loss of losses) {
        const key = loss.sku || loss.fnsku || loss.asin;
        if (!key) continue;

        const lifecycle = getLifecycle(key, loss.fnsku, loss.asin);
        lifecycle.loss_events.push(loss);
        lifecycle.total_losses++;
        lifecycle.total_loss_quantity += loss.quantity;
        lifecycle.total_loss_value += loss.estimated_value;
    }

    // Process reimbursement events
    for (const reimb of reimbursements) {
        const key = reimb.sku || reimb.fnsku || reimb.asin;
        if (!key) continue;

        const lifecycle = getLifecycle(key, reimb.fnsku, reimb.asin);
        lifecycle.reimbursement_events.push(reimb);
        lifecycle.total_reimbursements++;
        lifecycle.total_reimbursement_quantity += reimb.quantity;
        lifecycle.total_reimbursement_value += reimb.amount;
    }

    // Calculate gaps and detect anomalies for each lifecycle
    for (const lifecycle of lifecycles.values()) {
        lifecycle.net_quantity_gap = lifecycle.total_loss_quantity - lifecycle.total_reimbursement_quantity;
        lifecycle.net_value_gap = lifecycle.total_loss_value - lifecycle.total_reimbursement_value;

        // Identify unmatched losses
        lifecycle.unmatched_losses = findUnmatchedLosses(lifecycle);

        // Identify potential duplicates
        lifecycle.potential_duplicates = findPotentialDuplicates(lifecycle);
    }

    return lifecycles;
}

/**
 * Find losses that don't have matching reimbursements
 */
function findUnmatchedLosses(lifecycle: RecoveryLifecycle): LossEvent[] {
    const unmatched: LossEvent[] = [];
    const usedReimbursements = new Set<string>();

    // Sort by date
    const sortedLosses = [...lifecycle.loss_events].sort(
        (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
    );
    const sortedReimbs = [...lifecycle.reimbursement_events].sort(
        (a, b) => new Date(a.reimbursement_date).getTime() - new Date(b.reimbursement_date).getTime()
    );

    for (const loss of sortedLosses) {
        const lossDate = new Date(loss.event_date);
        let matched = false;

        // Look for a matching reimbursement within window
        for (const reimb of sortedReimbs) {
            if (usedReimbursements.has(reimb.id)) continue;

            const reimbDate = new Date(reimb.reimbursement_date);
            const daysDiff = Math.abs((reimbDate.getTime() - lossDate.getTime()) / (1000 * 60 * 60 * 24));

            // Match criteria: within window, similar quantity
            if (daysDiff <= MATCHING_WINDOW_DAYS && reimb.quantity >= loss.quantity * 0.8) {
                usedReimbursements.add(reimb.id);
                matched = true;
                break;
            }
        }

        if (!matched) {
            unmatched.push(loss);
        }
    }

    return unmatched;
}

/**
 * Find reimbursements that might be duplicates
 */
function findPotentialDuplicates(lifecycle: RecoveryLifecycle): ReimbursementEvent[] {
    const duplicates: ReimbursementEvent[] = [];
    const seen = new Map<string, ReimbursementEvent>();

    for (const reimb of lifecycle.reimbursement_events) {
        // Create a signature for matching
        const signature = `${reimb.order_id || ''}-${reimb.quantity}-${Math.round(reimb.amount)}`;

        if (seen.has(signature)) {
            const first = seen.get(signature)!;
            const daysDiff = Math.abs(
                (new Date(reimb.reimbursement_date).getTime() - new Date(first.reimbursement_date).getTime()) /
                (1000 * 60 * 60 * 24)
            );

            // If reimbursed twice within 30 days for same order/amount, likely duplicate
            if (daysDiff <= 30) {
                if (!duplicates.find(d => d.id === first.id)) {
                    duplicates.push(first);
                }
                duplicates.push(reimb);
            }
        } else {
            seen.set(signature, reimb);
        }
    }

    return duplicates;
}

/**
 * Analyze a recovery lifecycle for anomalies
 */
function analyzeRecoveryLifecycle(
    sellerId: string,
    syncId: string,
    lifecycle: RecoveryLifecycle
): SentinelDetectionResult[] {
    const results: SentinelDetectionResult[] = [];
    const detectionReasons: string[] = [];

    // Detection A: Missed Reimbursements
    if (lifecycle.unmatched_losses.length > 0 && lifecycle.net_quantity_gap >= MIN_QUANTITY_GAP) {
        const unmatchedValue = lifecycle.unmatched_losses.reduce((sum, l) => sum + l.estimated_value, 0);
        const unmatchedQty = lifecycle.unmatched_losses.reduce((sum, l) => sum + l.quantity, 0);

        if (unmatchedValue >= MIN_VALUE_GAP) {
            detectionReasons.push(
                `${lifecycle.unmatched_losses.length} loss event(s) without matching reimbursement`
            );
            detectionReasons.push(
                `Unrecovered quantity: ${unmatchedQty} units worth $${unmatchedValue.toFixed(2)}`
            );

            const confidenceFactors = calculateConfidence(lifecycle, 'missed');
            const severity = determineSeverity(unmatchedValue, unmatchedQty, 'missed');
            const action = determineAction(confidenceFactors.calculated_score, severity, 'missed');

            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                detection_type: 'missed_reimbursement',
                sku: lifecycle.sku,
                fnsku: lifecycle.fnsku,
                asin: lifecycle.asin,
                loss_count: lifecycle.unmatched_losses.length,
                reimbursement_count: lifecycle.total_reimbursements,
                quantity_gap: unmatchedQty,
                value_gap: unmatchedValue,
                unmatched_loss_ids: lifecycle.unmatched_losses.map(l => l.id),
                duplicate_reimbursement_ids: [],
                estimated_recovery: unmatchedValue,
                clawback_risk_value: 0,
                currency: lifecycle.unmatched_losses[0]?.currency || 'USD',
                severity,
                risk_level: 'high',
                recommended_action: action,
                confidence_score: confidenceFactors.calculated_score,
                confidence_factors: confidenceFactors,
                evidence: {
                    recovery_lifecycle: lifecycle,
                    detection_reasons: [...detectionReasons]
                }
            });
        }
    }

    // Detection B: Duplicate Reimbursements (Clawback Risk)
    if (lifecycle.potential_duplicates.length > 0) {
        const duplicateValue = lifecycle.potential_duplicates.reduce((sum, r) => sum + r.amount, 0) / 2;
        const duplicateQty = lifecycle.potential_duplicates.reduce((sum, r) => sum + r.quantity, 0) / 2;

        const dupReasons: string[] = [
            `${lifecycle.potential_duplicates.length} potential duplicate reimbursement(s) detected`,
            `Clawback risk: $${duplicateValue.toFixed(2)}`
        ];

        const confidenceFactors = calculateConfidence(lifecycle, 'duplicate');
        const severity = determineSeverity(duplicateValue, duplicateQty, 'duplicate');
        const action = determineAction(confidenceFactors.calculated_score, severity, 'duplicate');

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            detection_type: 'duplicate_reimbursement',
            sku: lifecycle.sku,
            fnsku: lifecycle.fnsku,
            asin: lifecycle.asin,
            loss_count: lifecycle.total_losses,
            reimbursement_count: lifecycle.potential_duplicates.length,
            quantity_gap: -duplicateQty, // Negative = over-reimbursed
            value_gap: -duplicateValue,
            unmatched_loss_ids: [],
            duplicate_reimbursement_ids: lifecycle.potential_duplicates.map(r => r.id),
            estimated_recovery: 0,
            clawback_risk_value: duplicateValue,
            currency: lifecycle.potential_duplicates[0]?.currency || 'USD',
            severity,
            risk_level: 'high',
            recommended_action: action,
            confidence_score: confidenceFactors.calculated_score,
            confidence_factors: confidenceFactors,
            evidence: {
                recovery_lifecycle: lifecycle,
                detection_reasons: dupReasons
            }
        });
    }

    // Detection C: Over-reimbursement clawback risk (net negative gap)
    if (lifecycle.net_quantity_gap < -1 && lifecycle.net_value_gap < -MIN_VALUE_GAP) {
        const overValue = Math.abs(lifecycle.net_value_gap);
        const overQty = Math.abs(lifecycle.net_quantity_gap);

        // Only if not already caught by duplicate detection
        if (!results.find(r => r.detection_type === 'duplicate_reimbursement')) {
            const clawbackReasons: string[] = [
                `Reimbursed ${overQty} more units than losses recorded`,
                `Potential clawback: $${overValue.toFixed(2)}`
            ];

            const confidenceFactors = calculateConfidence(lifecycle, 'duplicate');
            const severity = determineSeverity(overValue, overQty, 'duplicate');

            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                detection_type: 'clawback_risk',
                sku: lifecycle.sku,
                fnsku: lifecycle.fnsku,
                asin: lifecycle.asin,
                loss_count: lifecycle.total_losses,
                reimbursement_count: lifecycle.total_reimbursements,
                quantity_gap: lifecycle.net_quantity_gap,
                value_gap: lifecycle.net_value_gap,
                unmatched_loss_ids: [],
                duplicate_reimbursement_ids: [],
                estimated_recovery: 0,
                clawback_risk_value: overValue,
                currency: 'USD',
                severity,
                risk_level: 'extreme',
                recommended_action: 'preemptive_audit',
                confidence_score: confidenceFactors.calculated_score,
                confidence_factors: confidenceFactors,
                evidence: {
                    recovery_lifecycle: lifecycle,
                    detection_reasons: clawbackReasons
                }
            });
        }
    }

    return results;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate confidence score
 */
function calculateConfidence(
    lifecycle: RecoveryLifecycle,
    type: 'missed' | 'duplicate'
): SentinelConfidenceFactors {
    let score = 0;

    // Clear loss trail? +0.25
    const clearLoss = lifecycle.loss_events.length > 0 &&
        lifecycle.loss_events.every(l => l.sku || l.fnsku);
    if (clearLoss) score += WEIGHT_CLEAR_LOSS;

    // Reimbursement documented? +0.20
    const reimbDoc = lifecycle.reimbursement_events.length > 0 &&
        lifecycle.reimbursement_events.every(r => r.sku || r.fnsku);
    if (reimbDoc) score += WEIGHT_REIMB_DOCUMENTED;

    // Quantity match possible? +0.20
    const qtyMatch = type === 'missed'
        ? lifecycle.unmatched_losses.length <= lifecycle.total_losses * 0.5 // Not all unmatched
        : lifecycle.potential_duplicates.length >= 2; // Clear duplicate pattern
    if (qtyMatch) score += WEIGHT_QTY_MATCH;

    // Time proximity in events? +0.20
    const hasTimeProximity = checkTimeProximity(lifecycle);
    if (hasTimeProximity) score += WEIGHT_TIME_PROXIMITY;

    // Consistent SKU data? +0.15
    const consistentSku = !!lifecycle.sku && lifecycle.sku !== 'unknown';
    if (consistentSku) score += WEIGHT_CONSISTENT_SKU;

    return {
        clear_loss_trail: clearLoss,
        reimbursement_documented: reimbDoc,
        quantity_match_possible: qtyMatch,
        time_proximity: hasTimeProximity,
        consistent_sku_data: consistentSku,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Check if events have reasonable time proximity
 */
function checkTimeProximity(lifecycle: RecoveryLifecycle): boolean {
    if (lifecycle.loss_events.length === 0 || lifecycle.reimbursement_events.length === 0) {
        return false;
    }

    const latestLoss = Math.max(...lifecycle.loss_events.map(l => new Date(l.event_date).getTime()));
    const earliestReimb = Math.min(...lifecycle.reimbursement_events.map(r => new Date(r.reimbursement_date).getTime()));

    const daysDiff = (earliestReimb - latestLoss) / (1000 * 60 * 60 * 24);

    return daysDiff >= 0 && daysDiff <= MATCHING_WINDOW_DAYS;
}

/**
 * Determine severity
 */
function determineSeverity(
    value: number,
    quantity: number,
    type: 'missed' | 'duplicate'
): 'low' | 'medium' | 'high' | 'critical' {
    if (type === 'duplicate') {
        // Duplicate/clawback is always concerning
        if (value > 200 || quantity > 5) return 'critical';
        if (value > 50 || quantity > 2) return 'high';
        return 'medium';
    }

    // Missed reimbursement
    if (value > 500 || quantity > 10) return 'critical';
    if (value > 100 || quantity > 5) return 'high';
    if (value > 25 || quantity > 2) return 'medium';
    return 'low';
}

/**
 * Determine recommended action
 */
function determineAction(
    confidence: number,
    severity: 'low' | 'medium' | 'high' | 'critical',
    type: 'missed' | 'duplicate'
): 'monitor' | 'review' | 'file_claim' | 'preemptive_audit' {
    if (type === 'duplicate') {
        // Duplicate detection should trigger audit to confirm
        return 'preemptive_audit';
    }

    // Missed reimbursement actions
    if (confidence >= THRESHOLD_RECOMMEND_FILING && (severity === 'high' || severity === 'critical')) {
        return 'file_claim';
    }

    if (confidence >= THRESHOLD_SHOW_TO_USER || severity === 'high') {
        return 'review';
    }

    return 'monitor';
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch loss events from inventory ledger and related tables
 */
export async function fetchLossEvents(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<LossEvent[]> {
    const lookbackDays = options.lookbackDays || 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const events: LossEvent[] = [];

    try {
        // Get from inventory_ledger (lost/damaged events)
        const { data: ledgerData, error: ledgerError } = await supabaseAdmin
            .from('inventory_ledger')
            .select('*')
            .eq('user_id', sellerId)
            .in('adjustment_type', ['Lost', 'Damaged', 'Disposed', 'M', 'P', 'E', 'D'])
            .gte('event_date', cutoffDate.toISOString());

        if (!ledgerError && ledgerData) {
            for (const row of ledgerData) {
                events.push({
                    id: row.id || `ledger-${row.event_date}-${row.fnsku}`,
                    seller_id: sellerId,
                    event_type: mapEventType(row.adjustment_type),
                    event_date: row.event_date,
                    sku: row.sku,
                    fnsku: row.fnsku,
                    asin: row.asin,
                    quantity: Math.abs(row.quantity || 1),
                    estimated_value: Math.abs(row.unit_price || 0) * Math.abs(row.quantity || 1),
                    currency: 'USD',
                    source: 'inventory_ledger'
                });
            }
        }

        logger.info('🔍 [SENTINEL] Fetched loss events', {
            sellerId,
            count: events.length
        });

        return events;
    } catch (err: any) {
        logger.error('🔍 [SENTINEL] Error fetching loss events', { error: err.message });
        return [];
    }
}

/**
 * Fetch reimbursement events from settlements
 */
export async function fetchReimbursementEventsForSentinel(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<ReimbursementEvent[]> {
    const lookbackDays = options.lookbackDays || 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const events: ReimbursementEvent[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .eq('transaction_type', 'reimbursement')
            .gte('settlement_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                events.push({
                    id: row.id,
                    seller_id: sellerId,
                    reimbursement_date: row.settlement_date,
                    sku: row.sku,
                    fnsku: row.fnsku,
                    asin: row.asin,
                    order_id: row.order_id,
                    quantity: row.quantity || 1,
                    amount: Math.abs(parseFloat(row.amount) || 0),
                    currency: row.currency || 'USD',
                    reason: row.metadata?.reason,
                    case_id: row.metadata?.case_id
                });
            }
        }

        logger.info('🔍 [SENTINEL] Fetched reimbursement events', {
            sellerId,
            count: events.length
        });

        return events;
    } catch (err: any) {
        logger.error('🔍 [SENTINEL] Error fetching reimbursement events', { error: err.message });
        return [];
    }
}

/**
 * Map adjustment type to event type
 */
function mapEventType(adjustmentType: string): 'lost' | 'damaged' | 'disposed' | 'removed' | 'adjustment' {
    const typeMap: Record<string, 'lost' | 'damaged' | 'disposed' | 'removed' | 'adjustment'> = {
        'Lost': 'lost',
        'M': 'lost', // Missing
        'Damaged': 'damaged',
        'D': 'damaged',
        'E': 'damaged', // Expired
        'Disposed': 'disposed',
        'P': 'disposed',
        'Removed': 'removed'
    };
    return typeMap[adjustmentType] || 'adjustment';
}

/**
 * Store sentinel detection results
 */
export async function storeSentinelResults(
    results: SentinelDetectionResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'reimbursement_duplicate_missed',
            severity: r.severity,
            estimated_value: r.detection_type === 'missed_reimbursement'
                ? r.estimated_recovery
                : r.clawback_risk_value,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                detection_type: r.detection_type,
                sku: r.sku,
                quantity_gap: r.quantity_gap,
                value_gap: r.value_gap,
                unmatched_loss_ids: r.unmatched_loss_ids,
                duplicate_reimbursement_ids: r.duplicate_reimbursement_ids,
                recommended_action: r.recommended_action,
                risk_level: r.risk_level,
                detection_reasons: r.evidence.detection_reasons
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('🔍 [SENTINEL] Error storing results', { error: error.message });
        } else {
            logger.info('🔍 [SENTINEL] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('🔍 [SENTINEL] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Utility: Recovery Lifecycle Summary
// ============================================================================

/**
 * Get recovery health summary for seller dashboard
 */
export async function getRecoveryHealthSummary(sellerId: string): Promise<{
    totalLossEvents: number;
    totalReimbursements: number;
    recoveryRate: number;
    unmatchedLossValue: number;
    clawbackRiskValue: number;
    skusAtRisk: number;
    actionRequired: boolean;
}> {
    try {
        const losses = await fetchLossEvents(sellerId, { lookbackDays: 180 });
        const reimbursements = await fetchReimbursementEventsForSentinel(sellerId, { lookbackDays: 180 });

        const lifecycles = buildRecoveryLifecycles(sellerId, losses, reimbursements);

        let unmatchedValue = 0;
        let clawbackRisk = 0;
        let skusAtRisk = 0;

        for (const lifecycle of lifecycles.values()) {
            if (lifecycle.unmatched_losses.length > 0) {
                unmatchedValue += lifecycle.unmatched_losses.reduce((s, l) => s + l.estimated_value, 0);
                skusAtRisk++;
            }
            if (lifecycle.potential_duplicates.length > 0) {
                clawbackRisk += lifecycle.potential_duplicates.reduce((s, r) => s + r.amount, 0) / 2;
            }
        }

        const totalLossValue = losses.reduce((s, l) => s + l.estimated_value, 0);
        const totalReimbValue = reimbursements.reduce((s, r) => s + r.amount, 0);
        const recoveryRate = totalLossValue > 0 ? totalReimbValue / totalLossValue : 1;

        return {
            totalLossEvents: losses.length,
            totalReimbursements: reimbursements.length,
            recoveryRate: Math.min(1, recoveryRate),
            unmatchedLossValue: unmatchedValue,
            clawbackRiskValue: clawbackRisk,
            skusAtRisk,
            actionRequired: unmatchedValue > 100 || clawbackRisk > 50
        };
    } catch (err: any) {
        logger.error('🔍 [SENTINEL] Error generating summary', { error: err.message });
        return {
            totalLossEvents: 0,
            totalReimbursements: 0,
            recoveryRate: 0,
            unmatchedLossValue: 0,
            clawbackRiskValue: 0,
            skusAtRisk: 0,
            actionRequired: false
        };
    }
}

// ============================================================================
// Exports
// ============================================================================

export { THRESHOLD_SHOW_TO_USER, THRESHOLD_RECOMMEND_FILING };
