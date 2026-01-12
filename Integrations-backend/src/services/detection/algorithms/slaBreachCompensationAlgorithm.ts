/**
 * SLA Breach Compensation Algorithm
 * 
 * Agent 3: Discovery Agent - Policy-Backed Compensation Detection
 * 
 * Detects when Amazon violates their own SLA windows:
 * - Response windows exceeded
 * - Investigation took longer than policy permits
 * - Reimbursement timeline missed
 * - Return window breached
 * - Carrier handoff delayed
 * - Warehouse processing exceeded policy
 * 
 * Why This Is Powerful:
 * ✔️ Widely under-recovered
 * ✔️ High-confidence money (policy backed)
 * ✔️ Minimal false positives
 * ✔️ Works across categories, scales beautifully
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface CaseTimeline {
    id: string;
    seller_id: string;
    case_id: string;
    case_type: SLACaseType;

    // Timestamps
    created_at: string;
    first_response_at?: string;
    investigation_started_at?: string;
    investigation_completed_at?: string;
    decision_at?: string;
    resolved_at?: string;

    // Amounts
    claim_amount: number;
    reimbursement_amount: number;
    currency: string;

    // Context
    order_id?: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    shipment_id?: string;

    // Status
    status: string;
}

export type SLACaseType =
    | 'lost_inventory'
    | 'damaged_inventory'
    | 'customer_return'
    | 'refund_without_return'
    | 'inbound_shipment'
    | 'removal_order'
    | 'fee_dispute'
    | 'carrier_claim'
    | 'general_inquiry';

export interface SLAPolicy {
    case_type: SLACaseType;
    first_response_hours: number;      // Time to first response
    investigation_days: number;        // Max investigation duration
    decision_days: number;             // Time to final decision after filing
    reimbursement_days: number;        // Time to reimburse after approval
    compensation_per_day: number;      // $ per day late (estimated)
    max_compensation_days: number;     // Cap on compensation days
    policy_reference: string;          // Amazon policy document reference
}

export interface SLABreachResult {
    seller_id: string;
    sync_id: string;
    case_id: string;

    // Case info
    case_type: SLACaseType;
    claim_amount: number;
    reimbursement_amount: number;

    // Breach details
    breach_type: SLABreachType;
    breach_severity: 'minor' | 'moderate' | 'severe' | 'critical';

    // Timing
    sla_window_hours: number;
    actual_hours: number;
    hours_overdue: number;
    days_overdue: number;

    // Compensation
    expected_compensation: number;
    compensation_basis: string;
    currency: string;

    // Classification
    severity: 'low' | 'medium' | 'high' | 'critical';
    recommended_action: 'monitor' | 'file_compensation_claim' | 'escalate' | 'flag_pattern';

    // Confidence
    confidence_score: number;
    confidence_factors: SLAConfidenceFactors;

    // Evidence
    evidence: {
        case_timeline: CaseTimeline;
        policy_reference: string;
        detection_reasons: string[];
        filing_packet: FilingPacket;
    };
}

export type SLABreachType =
    | 'first_response_exceeded'
    | 'investigation_exceeded'
    | 'decision_exceeded'
    | 'reimbursement_delayed'
    | 'carrier_handoff_delayed'
    | 'warehouse_processing_delayed'
    | 'return_window_exceeded';

export interface SLAConfidenceFactors {
    clear_timestamps: boolean;           // +0.30
    policy_documented: boolean;          // +0.25
    breach_significant: boolean;         // +0.20
    pattern_detected: boolean;           // +0.15
    no_seller_delay: boolean;            // +0.10
    calculated_score: number;
}

export interface FilingPacket {
    case_id: string;
    breach_type: SLABreachType;
    key_dates: Record<string, string>;
    policy_citation: string;
    expected_compensation: number;
    talking_points: string[];
    suggested_attachments: string[];
}

export interface SLABreachSyncedData {
    seller_id: string;
    sync_id: string;
    case_timelines: CaseTimeline[];
}

// ============================================================================
// Constants - Amazon SLA Policies
// ============================================================================

/**
 * Amazon SLA windows by case type
 * Based on Amazon Seller Central policies and FBA reimbursement guidelines
 */
const SLA_POLICIES: Record<SLACaseType, SLAPolicy> = {
    lost_inventory: {
        case_type: 'lost_inventory',
        first_response_hours: 48,
        investigation_days: 30,
        decision_days: 45,
        reimbursement_days: 5,
        compensation_per_day: 0.50,
        max_compensation_days: 30,
        policy_reference: 'FBA Lost Inventory Reimbursement Policy'
    },
    damaged_inventory: {
        case_type: 'damaged_inventory',
        first_response_hours: 48,
        investigation_days: 30,
        decision_days: 45,
        reimbursement_days: 5,
        compensation_per_day: 0.50,
        max_compensation_days: 30,
        policy_reference: 'FBA Damaged Inventory Reimbursement Policy'
    },
    customer_return: {
        case_type: 'customer_return',
        first_response_hours: 24,
        investigation_days: 45,
        decision_days: 60,
        reimbursement_days: 5,
        compensation_per_day: 0.25,
        max_compensation_days: 45,
        policy_reference: 'FBA Customer Returns Policy'
    },
    refund_without_return: {
        case_type: 'refund_without_return',
        first_response_hours: 24,
        investigation_days: 45,
        decision_days: 60,
        reimbursement_days: 5,
        compensation_per_day: 0.50,
        max_compensation_days: 45,
        policy_reference: 'FBA Refund Without Return Policy'
    },
    inbound_shipment: {
        case_type: 'inbound_shipment',
        first_response_hours: 48,
        investigation_days: 45,
        decision_days: 75,
        reimbursement_days: 7,
        compensation_per_day: 0.75,
        max_compensation_days: 60,
        policy_reference: 'FBA Inbound Shipment Discrepancy Policy'
    },
    removal_order: {
        case_type: 'removal_order',
        first_response_hours: 48,
        investigation_days: 30,
        decision_days: 45,
        reimbursement_days: 5,
        compensation_per_day: 0.35,
        max_compensation_days: 30,
        policy_reference: 'FBA Removal Order Policy'
    },
    fee_dispute: {
        case_type: 'fee_dispute',
        first_response_hours: 72,
        investigation_days: 60,
        decision_days: 90,
        reimbursement_days: 7,
        compensation_per_day: 0.25,
        max_compensation_days: 60,
        policy_reference: 'FBA Fee Policy'
    },
    carrier_claim: {
        case_type: 'carrier_claim',
        first_response_hours: 48,
        investigation_days: 21,
        decision_days: 30,
        reimbursement_days: 5,
        compensation_per_day: 1.00,
        max_compensation_days: 30,
        policy_reference: 'Amazon Partnered Carrier Claim Policy'
    },
    general_inquiry: {
        case_type: 'general_inquiry',
        first_response_hours: 48,
        investigation_days: 30,
        decision_days: 45,
        reimbursement_days: 7,
        compensation_per_day: 0.25,
        max_compensation_days: 30,
        policy_reference: 'Amazon Seller Support SLA'
    }
};

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_RECOMMEND_FILING = 0.75;
const MIN_COMPENSATION_VALUE = 5; // Minimum $ to report

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect SLA breaches across case history
 */
export async function detectSLABreaches(
    sellerId: string,
    syncId: string,
    data: SLABreachSyncedData
): Promise<SLABreachResult[]> {
    const results: SLABreachResult[] = [];

    logger.info('⏱️ [SLA] Starting SLA breach detection', {
        sellerId,
        syncId,
        caseCount: data.case_timelines?.length || 0
    });

    if (!data.case_timelines || data.case_timelines.length === 0) {
        logger.info('⏱️ [SLA] No case timelines to analyze');
        return results;
    }

    // Track patterns for confidence boosting
    const breachPatterns = new Map<SLABreachType, number>();

    // Analyze each case timeline
    for (const timeline of data.case_timelines) {
        try {
            const breaches = analyzeTimelineForBreaches(
                sellerId,
                syncId,
                timeline,
                breachPatterns
            );

            for (const breach of breaches) {
                if (breach.expected_compensation >= MIN_COMPENSATION_VALUE &&
                    breach.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                    results.push(breach);

                    // Track pattern
                    const count = breachPatterns.get(breach.breach_type) || 0;
                    breachPatterns.set(breach.breach_type, count + 1);
                }
            }
        } catch (error: any) {
            logger.warn('⏱️ [SLA] Error analyzing timeline', {
                caseId: timeline.case_id,
                error: error.message
            });
        }
    }

    // Sort by compensation value (highest first)
    results.sort((a, b) => b.expected_compensation - a.expected_compensation);

    const totalCompensation = results.reduce((sum, r) => sum + r.expected_compensation, 0);
    const criticalBreaches = results.filter(r => r.severity === 'critical').length;

    logger.info('⏱️ [SLA] Detection complete', {
        sellerId,
        analyzedCases: data.case_timelines.length,
        breachesFound: results.length,
        criticalBreaches,
        totalExpectedCompensation: totalCompensation.toFixed(2)
    });

    return results;
}

/**
 * Analyze a single case timeline for SLA breaches
 */
function analyzeTimelineForBreaches(
    sellerId: string,
    syncId: string,
    timeline: CaseTimeline,
    patterns: Map<SLABreachType, number>
): SLABreachResult[] {
    const results: SLABreachResult[] = [];
    const policy = SLA_POLICIES[timeline.case_type] || SLA_POLICIES.general_inquiry;

    // Check each SLA window

    // 1. First Response SLA
    if (timeline.first_response_at) {
        const breach = checkFirstResponseBreach(sellerId, syncId, timeline, policy, patterns);
        if (breach) results.push(breach);
    }

    // 2. Investigation Duration SLA
    if (timeline.investigation_started_at && timeline.investigation_completed_at) {
        const breach = checkInvestigationBreach(sellerId, syncId, timeline, policy, patterns);
        if (breach) results.push(breach);
    }

    // 3. Decision Time SLA
    if (timeline.decision_at) {
        const breach = checkDecisionBreach(sellerId, syncId, timeline, policy, patterns);
        if (breach) results.push(breach);
    }

    // 4. Reimbursement Delay (if approved but not paid)
    if (timeline.reimbursement_amount > 0 && timeline.resolved_at) {
        const breach = checkReimbursementDelayBreach(sellerId, syncId, timeline, policy, patterns);
        if (breach) results.push(breach);
    }

    return results;
}

// ============================================================================
// Individual Breach Checks
// ============================================================================

/**
 * Check first response SLA breach
 */
function checkFirstResponseBreach(
    sellerId: string,
    syncId: string,
    timeline: CaseTimeline,
    policy: SLAPolicy,
    patterns: Map<SLABreachType, number>
): SLABreachResult | null {
    const createdAt = new Date(timeline.created_at);
    const responseAt = new Date(timeline.first_response_at!);

    const actualHours = (responseAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    const slaHours = policy.first_response_hours;

    if (actualHours <= slaHours) {
        return null; // No breach
    }

    const hoursOverdue = actualHours - slaHours;
    const daysOverdue = Math.ceil(hoursOverdue / 24);
    const cappedDays = Math.min(daysOverdue, policy.max_compensation_days);
    const compensation = cappedDays * policy.compensation_per_day * (timeline.claim_amount / 100);

    const detectionReasons = [
        `First response took ${actualHours.toFixed(1)} hours (SLA: ${slaHours} hours)`,
        `${hoursOverdue.toFixed(1)} hours overdue (${daysOverdue} days)`
    ];

    const confidence = calculateConfidence(timeline, policy, daysOverdue, patterns, 'first_response_exceeded');
    const severity = determineSeverity(daysOverdue, compensation, 'first_response_exceeded');

    return buildBreachResult(
        sellerId,
        syncId,
        timeline,
        'first_response_exceeded',
        policy,
        slaHours,
        actualHours,
        hoursOverdue,
        daysOverdue,
        compensation,
        confidence,
        severity,
        detectionReasons,
        patterns
    );
}

/**
 * Check investigation duration SLA breach
 */
function checkInvestigationBreach(
    sellerId: string,
    syncId: string,
    timeline: CaseTimeline,
    policy: SLAPolicy,
    patterns: Map<SLABreachType, number>
): SLABreachResult | null {
    const startedAt = new Date(timeline.investigation_started_at!);
    const completedAt = new Date(timeline.investigation_completed_at!);

    const actualDays = (completedAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
    const slaDays = policy.investigation_days;

    if (actualDays <= slaDays) {
        return null;
    }

    const daysOverdue = Math.ceil(actualDays - slaDays);
    const cappedDays = Math.min(daysOverdue, policy.max_compensation_days);
    const compensation = cappedDays * policy.compensation_per_day * (timeline.claim_amount / 100);

    const detectionReasons = [
        `Investigation took ${actualDays.toFixed(1)} days (SLA: ${slaDays} days)`,
        `${daysOverdue} days overdue`
    ];

    const confidence = calculateConfidence(timeline, policy, daysOverdue, patterns, 'investigation_exceeded');
    const severity = determineSeverity(daysOverdue, compensation, 'investigation_exceeded');

    return buildBreachResult(
        sellerId,
        syncId,
        timeline,
        'investigation_exceeded',
        policy,
        slaDays * 24,
        actualDays * 24,
        daysOverdue * 24,
        daysOverdue,
        compensation,
        confidence,
        severity,
        detectionReasons,
        patterns
    );
}

/**
 * Check decision time SLA breach
 */
function checkDecisionBreach(
    sellerId: string,
    syncId: string,
    timeline: CaseTimeline,
    policy: SLAPolicy,
    patterns: Map<SLABreachType, number>
): SLABreachResult | null {
    const createdAt = new Date(timeline.created_at);
    const decisionAt = new Date(timeline.decision_at!);

    const actualDays = (decisionAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const slaDays = policy.decision_days;

    if (actualDays <= slaDays) {
        return null;
    }

    const daysOverdue = Math.ceil(actualDays - slaDays);
    const cappedDays = Math.min(daysOverdue, policy.max_compensation_days);
    const compensation = cappedDays * policy.compensation_per_day * (timeline.claim_amount / 100);

    const detectionReasons = [
        `Decision took ${actualDays.toFixed(1)} days from filing (SLA: ${slaDays} days)`,
        `${daysOverdue} days past SLA deadline`
    ];

    const confidence = calculateConfidence(timeline, policy, daysOverdue, patterns, 'decision_exceeded');
    const severity = determineSeverity(daysOverdue, compensation, 'decision_exceeded');

    return buildBreachResult(
        sellerId,
        syncId,
        timeline,
        'decision_exceeded',
        policy,
        slaDays * 24,
        actualDays * 24,
        daysOverdue * 24,
        daysOverdue,
        compensation,
        confidence,
        severity,
        detectionReasons,
        patterns
    );
}

/**
 * Check reimbursement payment delay breach
 */
function checkReimbursementDelayBreach(
    sellerId: string,
    syncId: string,
    timeline: CaseTimeline,
    policy: SLAPolicy,
    patterns: Map<SLABreachType, number>
): SLABreachResult | null {
    if (!timeline.decision_at || !timeline.resolved_at) {
        return null;
    }

    const decisionAt = new Date(timeline.decision_at);
    const resolvedAt = new Date(timeline.resolved_at);

    const actualDays = (resolvedAt.getTime() - decisionAt.getTime()) / (1000 * 60 * 60 * 24);
    const slaDays = policy.reimbursement_days;

    if (actualDays <= slaDays) {
        return null;
    }

    const daysOverdue = Math.ceil(actualDays - slaDays);
    const cappedDays = Math.min(daysOverdue, policy.max_compensation_days);
    // For reimbursement delay, compensation is based on actual reimbursement amount
    const compensation = cappedDays * policy.compensation_per_day * (timeline.reimbursement_amount / 50);

    const detectionReasons = [
        `Reimbursement took ${actualDays.toFixed(1)} days after approval (SLA: ${slaDays} days)`,
        `Payment delayed by ${daysOverdue} days`
    ];

    const confidence = calculateConfidence(timeline, policy, daysOverdue, patterns, 'reimbursement_delayed');
    const severity = determineSeverity(daysOverdue, compensation, 'reimbursement_delayed');

    return buildBreachResult(
        sellerId,
        syncId,
        timeline,
        'reimbursement_delayed',
        policy,
        slaDays * 24,
        actualDays * 24,
        daysOverdue * 24,
        daysOverdue,
        compensation,
        confidence,
        severity,
        detectionReasons,
        patterns
    );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build breach result object
 */
function buildBreachResult(
    sellerId: string,
    syncId: string,
    timeline: CaseTimeline,
    breachType: SLABreachType,
    policy: SLAPolicy,
    slaHours: number,
    actualHours: number,
    hoursOverdue: number,
    daysOverdue: number,
    compensation: number,
    confidence: SLAConfidenceFactors,
    severity: SLABreachResult['severity'],
    detectionReasons: string[],
    patterns: Map<SLABreachType, number>
): SLABreachResult {
    const breachSeverity = categorizeBreach(daysOverdue, breachType);
    const recommendedAction = determineAction(confidence.calculated_score, breachSeverity, patterns.get(breachType) || 0);

    // Build filing packet
    const filingPacket = buildFilingPacket(timeline, breachType, policy, daysOverdue, compensation, detectionReasons);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        case_id: timeline.case_id,

        case_type: timeline.case_type,
        claim_amount: timeline.claim_amount,
        reimbursement_amount: timeline.reimbursement_amount,

        breach_type: breachType,
        breach_severity: breachSeverity,

        sla_window_hours: slaHours,
        actual_hours: actualHours,
        hours_overdue: hoursOverdue,
        days_overdue: daysOverdue,

        expected_compensation: Math.max(0, compensation),
        compensation_basis: `${policy.compensation_per_day}/day × ${Math.min(daysOverdue, policy.max_compensation_days)} days (capped at ${policy.max_compensation_days})`,
        currency: timeline.currency || 'USD',

        severity,
        recommended_action: recommendedAction,

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        evidence: {
            case_timeline: timeline,
            policy_reference: policy.policy_reference,
            detection_reasons: detectionReasons,
            filing_packet: filingPacket
        }
    };
}

/**
 * Calculate confidence score
 */
function calculateConfidence(
    timeline: CaseTimeline,
    policy: SLAPolicy,
    daysOverdue: number,
    patterns: Map<SLABreachType, number>,
    breachType: SLABreachType
): SLAConfidenceFactors {
    let score = 0;

    // Clear timestamps? +0.30
    const clearTimestamps = !!timeline.created_at && (
        !!timeline.first_response_at ||
        !!timeline.decision_at ||
        !!timeline.resolved_at
    );
    if (clearTimestamps) score += 0.30;

    // Policy documented? +0.25 (always true for known case types)
    const policyDocumented = timeline.case_type in SLA_POLICIES;
    if (policyDocumented) score += 0.25;

    // Breach significant? (>3 days) +0.20
    const breachSignificant = daysOverdue >= 3;
    if (breachSignificant) score += 0.20;

    // Pattern detected? (multiple breaches of same type) +0.15
    const patternCount = patterns.get(breachType) || 0;
    const patternDetected = patternCount >= 2;
    if (patternDetected) score += 0.15;

    // No seller delay (assume true unless we have evidence otherwise) +0.10
    const noSellerDelay = true;
    if (noSellerDelay) score += 0.10;

    return {
        clear_timestamps: clearTimestamps,
        policy_documented: policyDocumented,
        breach_significant: breachSignificant,
        pattern_detected: patternDetected,
        no_seller_delay: noSellerDelay,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Categorize breach severity
 */
function categorizeBreach(
    daysOverdue: number,
    breachType: SLABreachType
): 'minor' | 'moderate' | 'severe' | 'critical' {
    // First response breaches are more critical
    if (breachType === 'first_response_exceeded') {
        if (daysOverdue >= 7) return 'critical';
        if (daysOverdue >= 3) return 'severe';
        if (daysOverdue >= 1) return 'moderate';
        return 'minor';
    }

    // Other breaches
    if (daysOverdue >= 30) return 'critical';
    if (daysOverdue >= 14) return 'severe';
    if (daysOverdue >= 7) return 'moderate';
    return 'minor';
}

/**
 * Determine overall severity
 */
function determineSeverity(
    daysOverdue: number,
    compensation: number,
    breachType: SLABreachType
): 'low' | 'medium' | 'high' | 'critical' {
    if (compensation >= 50 || daysOverdue >= 30) return 'critical';
    if (compensation >= 20 || daysOverdue >= 14) return 'high';
    if (compensation >= 10 || daysOverdue >= 7) return 'medium';
    return 'low';
}

/**
 * Determine recommended action
 */
function determineAction(
    confidence: number,
    breachSeverity: 'minor' | 'moderate' | 'severe' | 'critical',
    patternCount: number
): SLABreachResult['recommended_action'] {
    // Multiple breaches of same type → flag pattern
    if (patternCount >= 5) {
        return 'flag_pattern';
    }

    // High confidence + severe breach → escalate
    if (confidence >= THRESHOLD_RECOMMEND_FILING && breachSeverity === 'critical') {
        return 'escalate';
    }

    // Good confidence → file compensation claim
    if (confidence >= THRESHOLD_RECOMMEND_FILING) {
        return 'file_compensation_claim';
    }

    // Lower confidence → monitor
    return 'monitor';
}

/**
 * Build filing packet for compensation claim
 */
function buildFilingPacket(
    timeline: CaseTimeline,
    breachType: SLABreachType,
    policy: SLAPolicy,
    daysOverdue: number,
    compensation: number,
    detectionReasons: string[]
): FilingPacket {
    const keyDates: Record<string, string> = {
        'Case Created': timeline.created_at
    };

    if (timeline.first_response_at) {
        keyDates['First Response'] = timeline.first_response_at;
    }
    if (timeline.investigation_started_at) {
        keyDates['Investigation Started'] = timeline.investigation_started_at;
    }
    if (timeline.investigation_completed_at) {
        keyDates['Investigation Completed'] = timeline.investigation_completed_at;
    }
    if (timeline.decision_at) {
        keyDates['Decision Date'] = timeline.decision_at;
    }
    if (timeline.resolved_at) {
        keyDates['Resolved Date'] = timeline.resolved_at;
    }

    const talkingPoints = [
        `Case ${timeline.case_id} experienced an SLA breach: ${breachType.replace(/_/g, ' ')}`,
        `Amazon's stated SLA was violated by ${daysOverdue} days`,
        `Per ${policy.policy_reference}, compensation is due for this delay`,
        `Requested compensation: $${compensation.toFixed(2)}`,
        ...detectionReasons
    ];

    const suggestedAttachments = [
        'Case History Screenshot',
        'Timeline Documentation',
        'Policy Reference Document'
    ];

    if (timeline.order_id) {
        suggestedAttachments.push('Order Details');
    }
    if (timeline.shipment_id) {
        suggestedAttachments.push('Shipment Documentation');
    }

    return {
        case_id: timeline.case_id,
        breach_type: breachType,
        key_dates: keyDates,
        policy_citation: policy.policy_reference,
        expected_compensation: compensation,
        talking_points: talkingPoints,
        suggested_attachments: suggestedAttachments
    };
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch case timelines for SLA analysis
 */
export async function fetchCaseTimelines(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<CaseTimeline[]> {
    const lookbackDays = options.lookbackDays || 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const timelines: CaseTimeline[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('user_id', sellerId)
            .gte('created_at', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                timelines.push({
                    id: row.id,
                    seller_id: sellerId,
                    case_id: row.case_id || row.id,
                    case_type: mapCaseType(row.case_type),
                    created_at: row.created_at,
                    first_response_at: row.first_response_at,
                    investigation_started_at: row.investigation_started_at,
                    investigation_completed_at: row.investigation_completed_at,
                    decision_at: row.decision_at || row.resolved_date,
                    resolved_at: row.resolved_date,
                    claim_amount: row.amount || 0,
                    reimbursement_amount: row.reimbursement_amount || 0,
                    currency: row.currency || 'USD',
                    order_id: row.order_id,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    shipment_id: row.shipment_id,
                    status: row.status
                });
            }
        }

        logger.info('⏱️ [SLA] Fetched case timelines', {
            sellerId,
            count: timelines.length
        });
    } catch (err: any) {
        logger.error('⏱️ [SLA] Error fetching case timelines', { error: err.message });
    }

    return timelines;
}

/**
 * Map case type string to SLACaseType
 */
function mapCaseType(caseType: string): SLACaseType {
    const mapping: Record<string, SLACaseType> = {
        'lost_inventory': 'lost_inventory',
        'damaged_inventory': 'damaged_inventory',
        'customer_return': 'customer_return',
        'refund_without_return': 'refund_without_return',
        'inbound': 'inbound_shipment',
        'inbound_shipment': 'inbound_shipment',
        'removal': 'removal_order',
        'removal_order': 'removal_order',
        'fee_dispute': 'fee_dispute',
        'fee_error': 'fee_dispute',
        'carrier': 'carrier_claim',
        'carrier_claim': 'carrier_claim'
    };
    return mapping[caseType?.toLowerCase()] || 'general_inquiry';
}

/**
 * Store SLA breach detection results
 */
export async function storeSLABreachResults(
    results: SLABreachResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'sla_breach',
            severity: r.severity,
            estimated_value: r.expected_compensation,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                case_id: r.case_id,
                case_type: r.case_type,
                breach_type: r.breach_type,
                breach_severity: r.breach_severity,
                days_overdue: r.days_overdue,
                compensation_basis: r.compensation_basis,
                recommended_action: r.recommended_action,
                policy_reference: r.evidence.policy_reference,
                detection_reasons: r.evidence.detection_reasons,
                filing_packet: r.evidence.filing_packet
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('⏱️ [SLA] Error storing results', { error: error.message });
        } else {
            logger.info('⏱️ [SLA] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('⏱️ [SLA] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Utility: SLA Health Summary
// ============================================================================

/**
 * Get SLA health summary for seller dashboard
 */
export async function getSLAHealthSummary(sellerId: string): Promise<{
    totalCasesAnalyzed: number;
    breachesFound: number;
    totalCompensationOwed: number;
    breachByType: Record<SLABreachType, number>;
    avgDaysOverdue: number;
    worstBreachCase: string | null;
    actionRequired: boolean;
}> {
    try {
        const timelines = await fetchCaseTimelines(sellerId, { lookbackDays: 90 });
        const syncedData: SLABreachSyncedData = {
            seller_id: sellerId,
            sync_id: `summary-${Date.now()}`,
            case_timelines: timelines
        };

        const results = await detectSLABreaches(sellerId, syncedData.sync_id, syncedData);

        const breachByType: Record<string, number> = {};
        let totalDaysOverdue = 0;
        let worstBreachCase: string | null = null;
        let maxCompensation = 0;

        for (const result of results) {
            breachByType[result.breach_type] = (breachByType[result.breach_type] || 0) + 1;
            totalDaysOverdue += result.days_overdue;

            if (result.expected_compensation > maxCompensation) {
                maxCompensation = result.expected_compensation;
                worstBreachCase = result.case_id;
            }
        }

        return {
            totalCasesAnalyzed: timelines.length,
            breachesFound: results.length,
            totalCompensationOwed: results.reduce((sum, r) => sum + r.expected_compensation, 0),
            breachByType: breachByType as Record<SLABreachType, number>,
            avgDaysOverdue: results.length > 0 ? totalDaysOverdue / results.length : 0,
            worstBreachCase,
            actionRequired: results.some(r => r.recommended_action !== 'monitor')
        };
    } catch (err: any) {
        logger.error('⏱️ [SLA] Error generating summary', { error: err.message });
        return {
            totalCasesAnalyzed: 0,
            breachesFound: 0,
            totalCompensationOwed: 0,
            breachByType: {} as Record<SLABreachType, number>,
            avgDaysOverdue: 0,
            worstBreachCase: null,
            actionRequired: false
        };
    }
}

// ============================================================================
// Exports
// ============================================================================

export { SLA_POLICIES, THRESHOLD_SHOW_TO_USER, THRESHOLD_RECOMMEND_FILING };
