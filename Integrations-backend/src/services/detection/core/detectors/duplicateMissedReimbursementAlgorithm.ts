import { supabaseAdmin } from '../../../../database/supabaseClient';
import logger from '../../../../utils/logger';
import { relationExists, resolveTenantId } from './shared/tenantUtils';

// ============================================================================
// Types
// ============================================================================

export type SentinelAnomalyType = 'missed_reimbursement' | 'duplicate_reimbursement' | 'clawback_risk' | 'ASYMMETRIC_CLAWBACK' | 'GHOST_REVERSAL';

export interface LossEvent {
    id: string;
    seller_id: string;
    event_type: 'lost' | 'damaged' | 'disposed' | 'removed' | 'adjustment' | 'found';
    event_date: string;
    sku?: string;
    fnsku?: string;
    asin?: string;
    order_id?: string;
    shipment_id?: string;
    removal_id?: string;
    reimbursement_id?: string;
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
    shipment_id?: string;
    removal_id?: string;
    reimbursement_id?: string;
    quantity: number;
    amount: number;
    currency: string;
    reason?: string;
    case_id?: string;
}

export type CohortState = 
    | 'OPEN_EXPECTED' 
    | 'PARTIALLY_REIMBURSED' 
    | 'FULLY_REIMBURSED' 
    | 'DUPLICATE_REIMBURSED' 
    | 'LATE_REIMBURSED' 
    | 'ORPHAN_REIMBURSEMENT' 
    | 'REVERSED_OR_CLAWED_BACK' 
    | 'PARTIALLY_REVERSED'
    | 'UNRESOLVED';

export type EvidenceClass = 
    | 'STRICT_REFERENCE_MATCH' 
    | 'STRICT_IDENTITY_MATCH' 
    | 'APPROVED_CAUSAL_MAPPING' 
    | 'TEMPORAL_ONLY' 
    | 'UNRESOLVED';

export interface RecoveryCohort {
    cohort_id: string;
    tenant_id: string;
    marketplace: string;
    causal_identity_keys: {
        primary?: string; // order_id, shipment_id, case_id
        secondary?: string; // fnsku, sku, asin
    };
    
    loss_events: LossEvent[];
    reimbursement_events: ReimbursementEvent[];
    reversal_events: ReimbursementEvent[];
    
    total_loss_quantity: number;
    total_reimbursed_quantity: number;
    residual_quantity: number;
    
    expected_reimbursement_value: number;
    observed_reimbursement_value: number;
    residual_value_delta: number;
    
    cohort_state: CohortState;
    evidence_class: EvidenceClass;
    linkage_notes: string[];
}

export interface SentinelDetectionResult {
    seller_id: string;
    sync_id: string;

    // Production Standard Attributes
    anomaly_type: string;
    estimated_value: number;

    detection_type: SentinelAnomalyType;
    sku?: string;
    fnsku?: string;
    asin?: string;
    loss_count: number;
    reimbursement_count: number;
    quantity_gap: number;
    value_gap: number;
    unmatched_loss_ids: string[];
    duplicate_reimbursement_ids: string[];
    estimated_recovery: number;
    clawback_risk_value: number;
    currency: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    risk_level: 'low' | 'moderate' | 'high' | 'extreme';
    recommended_action: 'monitor' | 'review' | 'file_claim' | 'preemptive_audit' | 'escalate';
    confidence_score: number;
    confidence_factors: SentinelConfidenceFactors;
    evidence: {
        recovery_cohort: RecoveryCohort;
        detection_reasons: string[];
    };
}

export interface SentinelConfidenceFactors {
    clear_loss_trail: boolean;
    reimbursement_documented: boolean;
    quantity_match_possible: boolean;
    time_proximity: boolean;
    consistent_sku_data: boolean;
    calculated_score: number;
}

export interface SentinelSyncedData {
    seller_id: string;
    sync_id: string;
    loss_events: LossEvent[];
    reimbursement_events: ReimbursementEvent[];
}

// ============================================================================
// Constants & Policies
// ============================================================================

const CAUSAL_MAPPING_POLICY: Record<string, string[]> = {
    'lost': ['Lost', 'Missing', 'Lost:Inbound', 'Lost:Warehouse'],
    'damaged': ['Damaged', 'Damaged:Warehouse', 'Damaged:Inbound'],
    'disposed': ['Disposed'],
    'removed': ['Removed'],
    'customer_return': ['CustomerReturn', 'Refund']
};

const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_RECOMMEND_FILING = 0.75;
const MIN_QUANTITY_GAP = 1;
const MIN_VALUE_GAP = 10;
const EPSILON = 0.05;

// ============================================================================
// Core Algorithm
// ============================================================================

export async function detectDuplicateMissedReimbursements(
    sellerId: string,
    syncId: string,
    data: SentinelSyncedData
): Promise<SentinelDetectionResult[]> {
    const results: SentinelDetectionResult[] = [];
    
    if (!data.loss_events?.length && !data.reimbursement_events?.length) {
        return results;
    }

    const filteredLosses = (data.loss_events || []).filter(l => l.seller_id === sellerId);
    const filteredReimbs = (data.reimbursement_events || []).filter(r => r.seller_id === sellerId);

    const cohorts = buildRecoveryCohorts(sellerId, filteredLosses, filteredReimbs);
    
    for (const cohort of cohorts.values()) {
        try {
            const detections = analyzeRecoveryCohort(sellerId, syncId, cohort);
            for (const detection of detections) {
                if (detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                    results.push(detection);
                }
            }
        } catch (error: any) {
            logger.warn('🔍 [SENTINEL] Error analyzing cohort', { cohortId: cohort.cohort_id, error: error.message });
        }
    }

    results.sort((a, b) => Math.abs(b.value_gap) - Math.abs(a.value_gap));
    return results;
}

function buildRecoveryCohorts(
    sellerId: string,
    losses: LossEvent[],
    reimbursements: ReimbursementEvent[]
): Map<string, RecoveryCohort> {
    const cohorts = new Map<string, RecoveryCohort>();

    // 1. Group Events by Identity Hierarchy Precedence
    const getIdentity = (event: Partial<LossEvent & ReimbursementEvent>): { key: string, primary?: string, secondary?: string } => {
        if (event.reimbursement_id) return { key: `REIMB:${event.reimbursement_id}`, primary: event.reimbursement_id };
        if (event.case_id) return { key: `CASE:${event.case_id}`, primary: event.case_id };
        if (event.order_id) return { key: `ORDER:${event.order_id}`, primary: event.order_id };
        if (event.shipment_id) return { key: `SHIPMENT:${event.shipment_id}`, primary: event.shipment_id };
        if (event.removal_id) return { key: `REMOVAL:${event.removal_id}`, primary: event.removal_id };
        
        const sec = event.fnsku || event.sku || event.asin || 'UNKNOWN';
        return { key: `SECONDARY:${sec}`, secondary: sec };
    };

    const getCohort = (identity: { key: string, primary?: string, secondary?: string }): RecoveryCohort => {
        const key = identity.key;
        if (!cohorts.has(key)) {
            cohorts.set(key, {
                cohort_id: key,
                tenant_id: sellerId,
                marketplace: 'US', // default
                causal_identity_keys: {
                    primary: identity.primary,
                    secondary: identity.secondary
                },
                loss_events: [],
                reimbursement_events: [],
                reversal_events: [],
                total_loss_quantity: 0,
                total_reimbursed_quantity: 0,
                residual_quantity: 0,
                expected_reimbursement_value: 0,
                observed_reimbursement_value: 0,
                residual_value_delta: 0,
                cohort_state: 'UNRESOLVED',
                evidence_class: 'UNRESOLVED',
                linkage_notes: []
            });
        }
        return cohorts.get(key)!;
    };

    for (const loss of losses) {
        const identity = getIdentity(loss);
        const cohort = getCohort(identity);
        cohort.loss_events.push(loss);
        cohort.total_loss_quantity += loss.quantity;
        cohort.expected_reimbursement_value += loss.estimated_value;
    }

    for (const reimb of reimbursements) {
        const identity = getIdentity(reimb);
        const cohort = getCohort(identity);
        
        if (reimb.amount < 0 || reimb.quantity < 0) {
            cohort.reversal_events.push(reimb);
            cohort.total_reimbursed_quantity += reimb.quantity; // it's negative
            cohort.observed_reimbursement_value += reimb.amount; // it's negative
        } else {
            cohort.reimbursement_events.push(reimb);
            cohort.total_reimbursed_quantity += reimb.quantity;
            cohort.observed_reimbursement_value += reimb.amount;
        }
    }

    // 2. Resolve cohort states and evidence classes
    for (const cohort of cohorts.values()) {
        cohort.residual_quantity = cohort.total_loss_quantity - cohort.total_reimbursed_quantity;
        cohort.residual_value_delta = cohort.expected_reimbursement_value - cohort.observed_reimbursement_value;

        // Evidence Class Logic
        if (cohort.causal_identity_keys.primary) {
            cohort.evidence_class = 'STRICT_REFERENCE_MATCH';
        } else if (cohort.causal_identity_keys.secondary) {
            cohort.evidence_class = 'STRICT_IDENTITY_MATCH';
        }

        // Apply Approved Causal Mapping Check for Identity Matches
        if (cohort.evidence_class === 'STRICT_IDENTITY_MATCH' && cohort.loss_events.length > 0 && cohort.reimbursement_events.length > 0) {
            const hasValidMapping = cohort.loss_events.some(l => {
                const allowedReasons = CAUSAL_MAPPING_POLICY[l.event_type] || [];
                return cohort.reimbursement_events.some(r => r.reason && allowedReasons.includes(r.reason));
            });
            if (hasValidMapping) {
                cohort.evidence_class = 'APPROVED_CAUSAL_MAPPING';
            }
        }

        // State Machine
        if (cohort.reversal_events.length > 0) {
            if (cohort.total_reimbursed_quantity <= 0) {
                cohort.cohort_state = 'REVERSED_OR_CLAWED_BACK';
            } else {
                cohort.cohort_state = 'PARTIALLY_REVERSED';
            }
        } else if (cohort.loss_events.length > 0 && cohort.reimbursement_events.length === 0) {
            cohort.cohort_state = 'OPEN_EXPECTED';
        } else if (cohort.loss_events.length === 0 && cohort.reimbursement_events.length > 0) {
            cohort.cohort_state = 'ORPHAN_REIMBURSEMENT';
        } else if (cohort.residual_quantity > 0 || cohort.residual_value_delta > EPSILON) {
            cohort.cohort_state = 'PARTIALLY_REIMBURSED';
        } else if (cohort.residual_quantity < 0 || cohort.residual_value_delta < -EPSILON) {
            cohort.cohort_state = 'DUPLICATE_REIMBURSED';
        } else {
            cohort.cohort_state = 'FULLY_REIMBURSED';
        }
    }

    return cohorts;
}

function analyzeRecoveryCohort(
    sellerId: string,
    syncId: string,
    cohort: RecoveryCohort
): SentinelDetectionResult[] {
    const results: SentinelDetectionResult[] = [];
    
    // Forbidden evidence classes
    if (cohort.evidence_class === 'TEMPORAL_ONLY' || cohort.evidence_class === 'UNRESOLVED') {
        return results; 
    }

    const confidenceFactors = calculateConfidence(cohort);
    
    // Extract base item info
    const baseSku = cohort.causal_identity_keys.secondary || cohort.loss_events[0]?.sku || cohort.reimbursement_events[0]?.sku;
    
    if (cohort.cohort_state === 'OPEN_EXPECTED' || cohort.cohort_state === 'PARTIALLY_REIMBURSED') {
        if (cohort.residual_value_delta > EPSILON) {
            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                anomaly_type: 'missed_reimbursement',
                estimated_value: cohort.residual_value_delta,
                detection_type: 'missed_reimbursement',
                sku: baseSku,
                loss_count: cohort.loss_events.length,
                reimbursement_count: cohort.reimbursement_events.length,
                quantity_gap: cohort.residual_quantity,
                value_gap: cohort.residual_value_delta,
                unmatched_loss_ids: cohort.loss_events.map(l => l.id),
                duplicate_reimbursement_ids: [],
                estimated_recovery: cohort.residual_value_delta,
                clawback_risk_value: 0,
                currency: 'USD',
                severity: determineSeverity(cohort.residual_value_delta, cohort.residual_quantity, 'missed'),
                risk_level: 'high',
                recommended_action: 'file_claim',
                confidence_score: confidenceFactors.calculated_score,
                confidence_factors: confidenceFactors,
                evidence: {
                    recovery_cohort: cohort,
                    detection_reasons: [
                        `Cohort State: ${cohort.cohort_state}`,
                        `Residual Quantity: ${cohort.residual_quantity} missing`,
                        `Shortfall Value: $${cohort.residual_value_delta.toFixed(2)}`,
                        `Evidence Class: ${cohort.evidence_class}`
                    ]
                }
            });
        }
    }
    
    if (cohort.cohort_state === 'DUPLICATE_REIMBURSED' || cohort.cohort_state === 'ORPHAN_REIMBURSEMENT') {
        const overValue = Math.abs(cohort.residual_value_delta);
        const overQty = Math.abs(cohort.residual_quantity);
        
        let shouldEmit = false;
        
        if (cohort.cohort_state === 'ORPHAN_REIMBURSEMENT') {
            shouldEmit = cohort.observed_reimbursement_value > 0 && 
                         cohort.loss_events.length === 0 &&
                         (cohort.evidence_class === 'STRICT_REFERENCE_MATCH' || cohort.evidence_class === 'STRICT_IDENTITY_MATCH') &&
                         overValue > EPSILON;
        } else {
            shouldEmit = cohort.observed_reimbursement_value > cohort.expected_reimbursement_value && overValue > EPSILON;
        }

        if (shouldEmit) {
            let detection_type: SentinelAnomalyType = cohort.cohort_state === 'ORPHAN_REIMBURSEMENT' ? 'clawback_risk' : 'duplicate_reimbursement';
            
            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                anomaly_type: detection_type,
                estimated_value: overValue,
                detection_type,
                sku: baseSku,
                loss_count: cohort.loss_events.length,
                reimbursement_count: cohort.reimbursement_events.length,
                quantity_gap: cohort.residual_quantity, // Negative
                value_gap: cohort.residual_value_delta, // Negative
                unmatched_loss_ids: [],
                duplicate_reimbursement_ids: cohort.reimbursement_events.map(r => r.id),
                estimated_recovery: 0,
                clawback_risk_value: overValue,
                currency: 'USD',
                severity: determineSeverity(overValue, overQty, 'duplicate'),
                risk_level: 'extreme',
                recommended_action: 'review',
                confidence_score: confidenceFactors.calculated_score,
                confidence_factors: confidenceFactors,
                evidence: {
                    recovery_cohort: cohort,
                    detection_reasons: [
                        `Cohort State: ${cohort.cohort_state}`,
                        `Over-reimbursed Quantity: ${overQty}`,
                        `Potential Clawback Risk: $${overValue.toFixed(2)}`,
                        `Evidence Class: ${cohort.evidence_class}`
                    ]
                }
            });
        }
    }
    
    // Asymmetric Clawback or Ghost Reversals
    if (cohort.cohort_state === 'REVERSED_OR_CLAWED_BACK' || cohort.cohort_state === 'PARTIALLY_REVERSED') {
        const originalValue = cohort.reimbursement_events.reduce((sum, r) => sum + r.amount, 0);
        const reversedValue = Math.abs(cohort.reversal_events.reduce((sum, r) => sum + r.amount, 0));
        
        if (reversedValue > originalValue + 0.05) {
            const delta = reversedValue - originalValue;
            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                anomaly_type: 'ASYMMETRIC_CLAWBACK',
                estimated_value: delta,
                detection_type: 'ASYMMETRIC_CLAWBACK',
                sku: baseSku,
                loss_count: cohort.loss_events.length,
                reimbursement_count: cohort.reimbursement_events.length + cohort.reversal_events.length,
                quantity_gap: cohort.residual_quantity,
                value_gap: -delta,
                unmatched_loss_ids: [],
                duplicate_reimbursement_ids: [...cohort.reimbursement_events.map(r=>r.id), ...cohort.reversal_events.map(r=>r.id)],
                estimated_recovery: delta,
                clawback_risk_value: delta,
                currency: 'USD',
                severity: 'high',
                risk_level: 'extreme',
                recommended_action: 'escalate',
                confidence_score: 1.0,
                confidence_factors: confidenceFactors,
                evidence: {
                    recovery_cohort: cohort,
                    detection_reasons: [
                        `Cohort State: ${cohort.cohort_state}`,
                        `Asymmetric Clawback: Reversed $${reversedValue.toFixed(2)} vs Original $${originalValue.toFixed(2)}`
                    ]
                }
            });
        } else if (cohort.residual_quantity > 0) {
            // Reversal happened, but no "Found" event balanced it out yet, and residual is positive
            const missingFoundValue = cohort.residual_value_delta;
            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                anomaly_type: 'GHOST_REVERSAL',
                estimated_value: missingFoundValue,
                detection_type: 'GHOST_REVERSAL',
                sku: baseSku,
                loss_count: cohort.loss_events.length,
                reimbursement_count: cohort.reimbursement_events.length + cohort.reversal_events.length,
                quantity_gap: cohort.residual_quantity,
                value_gap: cohort.residual_value_delta,
                unmatched_loss_ids: cohort.loss_events.map(l=>l.id),
                duplicate_reimbursement_ids: cohort.reversal_events.map(r=>r.id),
                estimated_recovery: missingFoundValue,
                clawback_risk_value: missingFoundValue,
                currency: 'USD',
                severity: 'critical',
                risk_level: 'extreme',
                recommended_action: 'file_claim',
                confidence_score: 0.95,
                confidence_factors: confidenceFactors,
                evidence: {
                    recovery_cohort: cohort,
                    detection_reasons: [
                        `Cohort State: ${cohort.cohort_state}`,
                        `Item lost but reimbursement was reversed without corresponding Found event`
                    ]
                }
            });
        }
    }

    return results;
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateConfidence(cohort: RecoveryCohort): SentinelConfidenceFactors {
    let score = 0;
    
    if (cohort.evidence_class === 'STRICT_REFERENCE_MATCH') {
        score = 1.0;
    } else if (cohort.evidence_class === 'APPROVED_CAUSAL_MAPPING') {
        score = 0.9;
    } else if (cohort.evidence_class === 'STRICT_IDENTITY_MATCH') {
        score = 0.8;
    }

    return {
        clear_loss_trail: cohort.loss_events.length > 0,
        reimbursement_documented: cohort.reimbursement_events.length > 0,
        quantity_match_possible: true, // Not relevant in cohort model, residuals are exact
        time_proximity: true, // Deprecated weak feature
        consistent_sku_data: !!cohort.causal_identity_keys.secondary,
        calculated_score: score
    };
}

function determineSeverity(value: number, quantity: number, type: 'missed' | 'duplicate'): 'low'|'medium'|'high'|'critical' {
    if (type === 'duplicate') {
        if (value > 200 || quantity > 5) return 'critical';
        if (value > 50 || quantity > 2) return 'high';
        return 'medium';
    }
    if (value > 500 || quantity > 10) return 'critical';
    if (value > 100 || quantity > 5) return 'high';
    if (value > 25 || quantity > 2) return 'medium';
    return 'low';
}

// ============================================================================
// Database & Summary Functions
// ============================================================================

export async function fetchLossEvents(sellerId: string, options: { lookbackDays?: number } = {}): Promise<LossEvent[]> {
    const tenantId = await resolveTenantId(sellerId);
    const lookbackDays = options.lookbackDays || 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
    const events: LossEvent[] = [];
    try {
        if (await relationExists('inventory_ledger')) {
            const { data: ledgerData, error: ledgerError } = await supabaseAdmin
                .from('inventory_ledger')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('user_id', sellerId)
                .in('adjustment_type', ['Lost', 'Damaged', 'Disposed', 'M', 'P', 'E', 'D', 'Found', 'F'])
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
        }

        if (events.length === 0 && await relationExists('inventory_ledger_events')) {
            const { data: ledgerEvents, error: ledgerEventsError } = await supabaseAdmin
                .from('inventory_ledger_events')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('user_id', sellerId)
                .gte('event_date', cutoffDate.toISOString());

            if (!ledgerEventsError && ledgerEvents) {
                for (const row of ledgerEvents) {
                    events.push({
                        id: row.id || `ledger-event-${row.event_date}-${row.fnsku}`,
                        seller_id: sellerId,
                        event_type: mapEventType(row.reason || row.event_type),
                        event_date: row.event_date,
                        sku: row.sku,
                        fnsku: row.fnsku,
                        asin: row.asin,
                        quantity: Math.abs(row.quantity || 1),
                        estimated_value: Math.abs(row.unit_cost || row.average_sales_price || 0) * Math.abs(row.quantity || 1),
                        currency: 'USD',
                        source: 'inventory_ledger'
                    });
                }
            }
        }
        return events;
    } catch (err: any) {
        return [];
    }
}

export async function fetchReimbursementEventsForSentinel(sellerId: string, options: { lookbackDays?: number } = {}): Promise<ReimbursementEvent[]> {
    const tenantId = await resolveTenantId(sellerId);
    const lookbackDays = options.lookbackDays || 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
    const events: ReimbursementEvent[] = [];
    try {
        const { data, error } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('user_id', sellerId)
            .eq('transaction_type', 'reimbursement')
            .gte('settlement_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                events.push({
                    id: row.id,
                    seller_id: sellerId,
                    reimbursement_date: row.settlement_date,
                    sku: row.sku || row.metadata?.sku,
                    fnsku: row.fnsku || row.metadata?.fnsku,
                    asin: row.asin || row.metadata?.asin,
                    order_id: row.order_id,
                    quantity: row.quantity || row.metadata?.quantity || 1,
                    amount: parseFloat(row.amount) || 0,
                    currency: row.currency || 'USD',
                    reason: row.metadata?.reason,
                    case_id: row.metadata?.case_id
                });
            }
        }

        if (events.length === 0 && await relationExists('financial_events')) {
            const { data: financialData, error: financialError } = await supabaseAdmin
                .from('financial_events')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('seller_id', sellerId)
                .eq('event_type', 'reimbursement')
                .gte('event_date', cutoffDate.toISOString());

            if (!financialError && financialData) {
                for (const row of financialData) {
                    events.push({
                        id: row.id,
                        seller_id: sellerId,
                        reimbursement_date: row.event_date,
                        sku: row.sku || row.amazon_sku,
                        fnsku: row.fnsku || row.raw_payload?.FNSKU,
                        asin: row.asin || row.raw_payload?.ASIN,
                        order_id: row.amazon_order_id,
                        quantity: row.quantity || row.raw_payload?.quantity || 1,
                        amount: parseFloat(row.amount) || 0,
                        currency: row.currency || 'USD',
                        reason: row.description || row.raw_payload?.reason,
                        case_id: row.raw_payload?.case_id
                    });
                }
            }
        }
        return events;
    } catch (err: any) {
        return [];
    }
}

function mapEventType(adjustmentType: string): 'lost' | 'damaged' | 'disposed' | 'removed' | 'adjustment' | 'found' {
    const typeMap: Record<string, 'lost' | 'damaged' | 'disposed' | 'removed' | 'adjustment' | 'found'> = {
        'Lost': 'lost', 'M': 'lost', 'Damaged': 'damaged', 'D': 'damaged', 'E': 'damaged',
        'Disposed': 'disposed', 'P': 'disposed', 'Removed': 'removed', 'Found': 'found', 'F': 'found'
    };
    return typeMap[adjustmentType] || 'adjustment';
}

export async function storeSentinelResults(results: SentinelDetectionResult[]): Promise<void> {
    if (results.length === 0) return;
    const tenantId = await resolveTenantId(results[0].seller_id);
    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            tenant_id: tenantId,
            sync_id: r.sync_id,
            anomaly_type: 'reimbursement_duplicate_missed',
            severity: r.severity,
            estimated_value: r.detection_type === 'missed_reimbursement' ? r.estimated_recovery : r.clawback_risk_value,
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
        await supabaseAdmin.from('detection_results').insert(records);
    } catch (err: any) {
        logger.error('🔍 [SENTINEL] Exception storing results', { error: err.message });
    }
}

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
        const cohorts = buildRecoveryCohorts(sellerId, losses, reimbursements);
        let unmatchedValue = 0;
        let clawbackRisk = 0;
        let skusAtRisk = 0;

        for (const cohort of cohorts.values()) {
            if (cohort.cohort_state === 'OPEN_EXPECTED' || cohort.cohort_state === 'PARTIALLY_REIMBURSED') {
                unmatchedValue += cohort.residual_value_delta;
                skusAtRisk++;
            }
            if (cohort.cohort_state === 'DUPLICATE_REIMBURSED') {
                clawbackRisk += Math.abs(cohort.residual_value_delta);
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
        return {
            totalLossEvents: 0, totalReimbursements: 0, recoveryRate: 0,
            unmatchedLossValue: 0, clawbackRiskValue: 0, skusAtRisk: 0, actionRequired: false
        };
    }
}

export async function runSentinelDetection(sellerId: string, syncId: string): Promise<SentinelDetectionResult[]> {
    logger.info('🔍 [SENTINEL] Starting automated run', { sellerId, syncId });
    
    const [losses, reimbursements] = await Promise.all([
        fetchLossEvents(sellerId, { lookbackDays: 180 }),
        fetchReimbursementEventsForSentinel(sellerId, { lookbackDays: 180 })
    ]);
    
    const results = await detectDuplicateMissedReimbursements(sellerId, syncId, { 
        seller_id: sellerId, 
        sync_id: syncId, 
        loss_events: losses, 
        reimbursement_events: reimbursements 
    });
    
    if (results.length > 0) {
        await storeSentinelResults(results);
    }
    
    return results;
}

export { THRESHOLD_SHOW_TO_USER, THRESHOLD_RECOMMEND_FILING };
