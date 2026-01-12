/**
 * Reimbursement Delay Intelligence Algorithm
 * 
 * Agent 3: Discovery Agent - Cashflow Theft Detection
 * 
 * Detects when Amazon reimburses LATE (outside expected SLA window):
 * - Track expected reimbursement timeline
 * - Detect delayed reimbursement patterns
 * - Compute interest cost / holding penalty
 * - Confidence weighting by historical lateness
 * 
 * Amazon Reimbursement SLAs (typical):
 * - Lost in warehouse: 30 days
 * - Damaged inventory: 30 days
 * - Customer return not received: 45 days
 * - FBA fee errors: 60 days
 * - General adjustments: 90 days
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ReimbursementTimeline {
    id: string;
    seller_id: string;
    order_id?: string;
    sku?: string;
    asin?: string;

    // Timeline tracking
    claim_type: ReimbursementClaimType;
    incident_date: string;        // When the loss/damage/error occurred
    claim_filed_date?: string;    // When claim was filed (if manual)
    expected_reimbursement_date: string; // Based on SLA
    actual_reimbursement_date?: string;  // When Amazon actually paid

    // Amounts
    expected_amount: number;
    actual_amount?: number;
    currency: string;

    // Status
    status: 'pending' | 'overdue' | 'reimbursed' | 'denied';
}

export type ReimbursementClaimType =
    | 'lost_warehouse'
    | 'damaged_warehouse'
    | 'lost_inbound'
    | 'damaged_inbound'
    | 'customer_return_not_received'
    | 'refund_without_return'
    | 'fee_overcharge'
    | 'general_adjustment'
    | 'unknown';

export interface DelayDetectionResult {
    seller_id: string;
    sync_id: string;
    reimbursement_id: string;
    order_id?: string;
    sku?: string;

    // Delay metrics
    claim_type: ReimbursementClaimType;
    incident_date: string;
    expected_date: string;
    actual_date?: string;
    days_overdue: number;
    sla_days: number;

    // Financial impact
    reimbursement_amount: number;
    interest_cost: number;      // Cost of capital lost
    holding_penalty: number;    // Opportunity cost
    total_delay_cost: number;
    currency: string;

    // Classification
    severity: 'low' | 'medium' | 'high' | 'critical';
    delay_category: 'slight' | 'moderate' | 'severe' | 'extreme';
    recommended_action: 'monitor' | 'nudge' | 'escalate' | 'file_case';

    // Confidence
    confidence_score: number;
    confidence_factors: DelayConfidenceFactors;

    // Evidence
    evidence: {
        timeline: ReimbursementTimeline;
        historical_patterns?: HistoricalDelayPattern;
        detection_reasons: string[];
    };
}

export interface DelayConfidenceFactors {
    clear_incident_date: boolean;      // +0.25
    documented_sla: boolean;           // +0.25
    historical_pattern: boolean;       // +0.20
    amount_verified: boolean;          // +0.15
    claim_on_record: boolean;          // +0.15
    calculated_score: number;
}

export interface HistoricalDelayPattern {
    seller_id: string;
    avg_delay_days: number;
    median_delay_days: number;
    max_delay_days: number;
    total_delayed_count: number;
    total_delayed_value: number;
    delay_rate: number; // % of reimbursements that were late
}

export interface DelaySyncedData {
    seller_id: string;
    sync_id: string;
    pending_reimbursements: ReimbursementTimeline[];
}

// ============================================================================
// Constants
// ============================================================================

// Amazon SLA windows by claim type (in days)
const SLA_WINDOWS: Record<ReimbursementClaimType, number> = {
    lost_warehouse: 30,
    damaged_warehouse: 30,
    lost_inbound: 45,
    damaged_inbound: 45,
    customer_return_not_received: 45,
    refund_without_return: 60,
    fee_overcharge: 60,
    general_adjustment: 90,
    unknown: 60, // Default
};

// Delay severity thresholds (days overdue)
const DELAY_THRESHOLDS = {
    slight: 7,     // 1-7 days
    moderate: 21,  // 8-21 days
    severe: 45,    // 22-45 days
    extreme: 45,   // 45+ days
};

// Annual interest rate for cost of capital (8% annual = ~0.022% daily)
const ANNUAL_INTEREST_RATE = 0.08;
const DAILY_INTEREST_RATE = ANNUAL_INTEREST_RATE / 365;

// Confidence weights
const WEIGHT_CLEAR_INCIDENT = 0.25;
const WEIGHT_DOCUMENTED_SLA = 0.25;
const WEIGHT_HISTORICAL = 0.20;
const WEIGHT_AMOUNT_VERIFIED = 0.15;
const WEIGHT_CLAIM_ON_RECORD = 0.15;

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_RECOMMEND_FILING = 0.75;

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect delayed reimbursements
 */
export async function detectReimbursementDelays(
    sellerId: string,
    syncId: string,
    data: DelaySyncedData
): Promise<DelayDetectionResult[]> {
    const results: DelayDetectionResult[] = [];

    logger.info('⏰ [DELAY] Starting reimbursement delay detection', {
        sellerId,
        syncId,
        pendingCount: data.pending_reimbursements?.length || 0
    });

    if (!data.pending_reimbursements || data.pending_reimbursements.length === 0) {
        logger.info('⏰ [DELAY] No pending reimbursements to analyze');
        return results;
    }

    // Fetch historical delay patterns for confidence scoring
    const historicalPattern = await fetchHistoricalDelayPattern(sellerId);
    logger.info('⏰ [DELAY] Historical pattern loaded', {
        avgDelay: historicalPattern.avg_delay_days,
        delayRate: (historicalPattern.delay_rate * 100).toFixed(1) + '%'
    });

    const today = new Date();

    // Analyze each pending reimbursement
    for (const timeline of data.pending_reimbursements) {
        try {
            const detection = analyzeReimbursementDelay(
                sellerId,
                syncId,
                timeline,
                historicalPattern,
                today
            );

            if (detection && detection.days_overdue > 0 && detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                results.push(detection);
            }
        } catch (error: any) {
            logger.warn('⏰ [DELAY] Error analyzing timeline', {
                id: timeline.id,
                error: error.message
            });
        }
    }

    // Sort by days overdue (most urgent first)
    results.sort((a, b) => b.days_overdue - a.days_overdue);

    const totalDelayCost = results.reduce((sum, r) => sum + r.total_delay_cost, 0);
    const criticalCount = results.filter(r => r.severity === 'critical').length;

    logger.info('⏰ [DELAY] Detection complete', {
        sellerId,
        analyzed: data.pending_reimbursements.length,
        overdueFound: results.length,
        criticalCount,
        totalDelayCost: totalDelayCost.toFixed(2),
        avgDaysOverdue: results.length > 0
            ? (results.reduce((sum, r) => sum + r.days_overdue, 0) / results.length).toFixed(1)
            : 0
    });

    return results;
}

/**
 * Analyze a single reimbursement timeline for delay
 */
function analyzeReimbursementDelay(
    sellerId: string,
    syncId: string,
    timeline: ReimbursementTimeline,
    historicalPattern: HistoricalDelayPattern,
    today: Date
): DelayDetectionResult | null {

    const incidentDate = new Date(timeline.incident_date);
    const expectedDate = new Date(timeline.expected_reimbursement_date);
    const slaWindow = SLA_WINDOWS[timeline.claim_type] || SLA_WINDOWS.unknown;

    // Calculate days overdue
    const daysOverdue = Math.floor((today.getTime() - expectedDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysOverdue <= 0) {
        // Not yet overdue
        return null;
    }

    const detectionReasons: string[] = [];

    // Determine delay category
    const delayCategory = categorizeDelay(daysOverdue);
    detectionReasons.push(`Reimbursement is ${daysOverdue} days overdue (SLA: ${slaWindow} days)`);

    // Calculate financial impact
    const amount = timeline.expected_amount || 0;
    const interestCost = calculateInterestCost(amount, daysOverdue);
    const holdingPenalty = calculateHoldingPenalty(amount, daysOverdue, delayCategory);
    const totalDelayCost = interestCost + holdingPenalty;

    if (totalDelayCost > 1) {
        detectionReasons.push(`Estimated delay cost: $${totalDelayCost.toFixed(2)}`);
    }

    // Calculate confidence
    const confidenceFactors = calculateDelayConfidence(timeline, historicalPattern);

    // Determine severity
    const severity = determineSeverity(daysOverdue, amount, delayCategory);

    // Determine recommended action
    const recommendedAction = determineAction(daysOverdue, severity, confidenceFactors.calculated_score);

    if (recommendedAction === 'file_case') {
        detectionReasons.push('Recommend filing a case with Amazon Seller Support');
    } else if (recommendedAction === 'escalate') {
        detectionReasons.push('Escalation recommended - significantly overdue');
    }

    return {
        seller_id: sellerId,
        sync_id: syncId,
        reimbursement_id: timeline.id,
        order_id: timeline.order_id,
        sku: timeline.sku,

        claim_type: timeline.claim_type,
        incident_date: timeline.incident_date,
        expected_date: timeline.expected_reimbursement_date,
        actual_date: timeline.actual_reimbursement_date,
        days_overdue: daysOverdue,
        sla_days: slaWindow,

        reimbursement_amount: amount,
        interest_cost: interestCost,
        holding_penalty: holdingPenalty,
        total_delay_cost: totalDelayCost,
        currency: timeline.currency || 'USD',

        severity,
        delay_category: delayCategory,
        recommended_action: recommendedAction,

        confidence_score: confidenceFactors.calculated_score,
        confidence_factors: confidenceFactors,

        evidence: {
            timeline,
            historical_patterns: historicalPattern,
            detection_reasons: detectionReasons
        }
    };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Categorize delay severity
 */
function categorizeDelay(daysOverdue: number): 'slight' | 'moderate' | 'severe' | 'extreme' {
    if (daysOverdue <= DELAY_THRESHOLDS.slight) return 'slight';
    if (daysOverdue <= DELAY_THRESHOLDS.moderate) return 'moderate';
    if (daysOverdue <= DELAY_THRESHOLDS.severe) return 'severe';
    return 'extreme';
}

/**
 * Calculate interest cost (cost of capital)
 */
function calculateInterestCost(amount: number, daysOverdue: number): number {
    // Simple interest: P * r * t
    return amount * DAILY_INTEREST_RATE * daysOverdue;
}

/**
 * Calculate holding penalty (opportunity cost escalator)
 */
function calculateHoldingPenalty(
    amount: number,
    daysOverdue: number,
    category: 'slight' | 'moderate' | 'severe' | 'extreme'
): number {
    // Escalating penalty based on severity
    const multipliers: Record<string, number> = {
        slight: 0.001,    // 0.1% per day
        moderate: 0.002,  // 0.2% per day
        severe: 0.003,    // 0.3% per day
        extreme: 0.005,   // 0.5% per day
    };

    const multiplier = multipliers[category] || 0.001;
    return amount * multiplier * daysOverdue;
}

/**
 * Calculate confidence score for delay detection
 */
function calculateDelayConfidence(
    timeline: ReimbursementTimeline,
    historicalPattern: HistoricalDelayPattern
): DelayConfidenceFactors {
    let score = 0;

    // Clear incident date? +0.25
    const clearIncident = !!timeline.incident_date;
    if (clearIncident) score += WEIGHT_CLEAR_INCIDENT;

    // Documented SLA? +0.25
    const documentedSla = timeline.claim_type !== 'unknown';
    if (documentedSla) score += WEIGHT_DOCUMENTED_SLA;

    // Historical pattern supports? +0.20
    const hasHistorical = historicalPattern.total_delayed_count >= 3;
    if (hasHistorical) score += WEIGHT_HISTORICAL;

    // Amount verified? +0.15
    const amountVerified = !!timeline.expected_amount && timeline.expected_amount > 0;
    if (amountVerified) score += WEIGHT_AMOUNT_VERIFIED;

    // Claim on record? +0.15
    const claimOnRecord = !!timeline.claim_filed_date || timeline.status !== 'pending';
    if (claimOnRecord) score += WEIGHT_CLAIM_ON_RECORD;

    return {
        clear_incident_date: clearIncident,
        documented_sla: documentedSla,
        historical_pattern: hasHistorical,
        amount_verified: amountVerified,
        claim_on_record: claimOnRecord,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Determine severity based on delay and amount
 */
function determineSeverity(
    daysOverdue: number,
    amount: number,
    category: 'slight' | 'moderate' | 'severe' | 'extreme'
): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: Extreme delay OR high value + severe delay
    if (category === 'extreme' || (amount > 500 && category === 'severe')) {
        return 'critical';
    }

    // High: Severe delay OR moderate delay with high value
    if (category === 'severe' || (amount > 200 && category === 'moderate')) {
        return 'high';
    }

    // Medium: Moderate delay
    if (category === 'moderate' || amount > 100) {
        return 'medium';
    }

    return 'low';
}

/**
 * Determine recommended action
 */
function determineAction(
    daysOverdue: number,
    severity: 'low' | 'medium' | 'high' | 'critical',
    confidence: number
): 'monitor' | 'nudge' | 'escalate' | 'file_case' {
    // File case: Critical with high confidence
    if (severity === 'critical' && confidence >= THRESHOLD_RECOMMEND_FILING) {
        return 'file_case';
    }

    // Escalate: High severity or very overdue
    if (severity === 'high' || daysOverdue > 30) {
        return 'escalate';
    }

    // Nudge: Medium severity
    if (severity === 'medium' || daysOverdue > 14) {
        return 'nudge';
    }

    return 'monitor';
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch historical delay pattern for seller
 */
async function fetchHistoricalDelayPattern(sellerId: string): Promise<HistoricalDelayPattern> {
    const defaultPattern: HistoricalDelayPattern = {
        seller_id: sellerId,
        avg_delay_days: 0,
        median_delay_days: 0,
        max_delay_days: 0,
        total_delayed_count: 0,
        total_delayed_value: 0,
        delay_rate: 0
    };

    try {
        // Get completed reimbursements to analyze delay patterns
        const { data, error } = await supabaseAdmin
            .from('reimbursement_analysis')
            .select('*')
            .eq('seller_id', sellerId)
            .not('actual_reimbursement', 'is', null);

        if (error || !data || data.length === 0) {
            return defaultPattern;
        }

        // Calculate delay metrics from historical data
        let totalDelayDays = 0;
        let delayCount = 0;
        let maxDelay = 0;
        let delayedValue = 0;
        const delays: number[] = [];

        for (const record of data) {
            // If we have timeline data, calculate delay
            if (record.created_at && record.updated_at) {
                const created = new Date(record.created_at);
                const updated = new Date(record.updated_at);
                const delayDays = Math.floor((updated.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));

                if (delayDays > 0) {
                    delays.push(delayDays);
                    totalDelayDays += delayDays;
                    delayCount++;
                    maxDelay = Math.max(maxDelay, delayDays);
                    delayedValue += record.actual_reimbursement || 0;
                }
            }
        }

        // Calculate median
        let median = 0;
        if (delays.length > 0) {
            const sorted = delays.sort((a, b) => a - b);
            median = sorted[Math.floor(sorted.length / 2)];
        }

        return {
            seller_id: sellerId,
            avg_delay_days: delayCount > 0 ? totalDelayDays / delayCount : 0,
            median_delay_days: median,
            max_delay_days: maxDelay,
            total_delayed_count: delayCount,
            total_delayed_value: delayedValue,
            delay_rate: data.length > 0 ? delayCount / data.length : 0
        };
    } catch (err: any) {
        logger.error('⏰ [DELAY] Error fetching historical pattern', { error: err.message });
        return defaultPattern;
    }
}

/**
 * Fetch pending reimbursements that need delay analysis
 */
export async function fetchPendingReimbursements(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<ReimbursementTimeline[]> {
    const lookbackDays = options.lookbackDays || 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    try {
        // Get claims/disputes that are pending reimbursement
        const { data: claims, error: claimsError } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('user_id', sellerId)
            .in('status', ['pending', 'submitted', 'under_review'])
            .gte('created_at', cutoffDate.toISOString());

        if (claimsError) {
            logger.warn('⏰ [DELAY] Error fetching dispute cases', { error: claimsError.message });
        }

        const timelines: ReimbursementTimeline[] = [];

        // Transform claims to timeline format
        for (const claim of (claims || [])) {
            const claimType = mapClaimType(claim.case_type);
            const slaWindow = SLA_WINDOWS[claimType];
            const incidentDate = new Date(claim.incident_date || claim.created_at);
            const expectedDate = new Date(incidentDate);
            expectedDate.setDate(expectedDate.getDate() + slaWindow);

            timelines.push({
                id: claim.id,
                seller_id: sellerId,
                order_id: claim.order_id,
                sku: claim.sku,
                asin: claim.asin,
                claim_type: claimType,
                incident_date: incidentDate.toISOString(),
                claim_filed_date: claim.filed_date,
                expected_reimbursement_date: expectedDate.toISOString(),
                actual_reimbursement_date: claim.resolved_date,
                expected_amount: claim.amount || 0,
                actual_amount: claim.reimbursement_amount,
                currency: claim.currency || 'USD',
                status: claim.status === 'resolved' ? 'reimbursed' :
                    claim.status === 'denied' ? 'denied' :
                        new Date() > expectedDate ? 'overdue' : 'pending'
            });
        }

        logger.info('⏰ [DELAY] Fetched pending reimbursements', {
            sellerId,
            count: timelines.length,
            overdue: timelines.filter(t => t.status === 'overdue').length
        });

        return timelines;
    } catch (err: any) {
        logger.error('⏰ [DELAY] Exception fetching pending reimbursements', { error: err.message });
        return [];
    }
}

/**
 * Map case type to reimbursement claim type
 */
function mapClaimType(caseType: string | undefined): ReimbursementClaimType {
    if (!caseType) return 'unknown';

    const mapping: Record<string, ReimbursementClaimType> = {
        'lost_inventory': 'lost_warehouse',
        'damaged_inventory': 'damaged_warehouse',
        'lost_inbound': 'lost_inbound',
        'damaged_inbound': 'damaged_inbound',
        'customer_return': 'customer_return_not_received',
        'refund_without_return': 'refund_without_return',
        'fee_overcharge': 'fee_overcharge',
        'fee_error': 'fee_overcharge',
        'adjustment': 'general_adjustment',
    };

    return mapping[caseType.toLowerCase()] || 'unknown';
}

/**
 * Store delay detection results
 */
export async function storeDelayResults(
    results: DelayDetectionResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        // Store in detection_results with anomaly_type = 'reimbursement_delayed'
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'reimbursement_delayed',
            severity: r.severity,
            estimated_value: r.reimbursement_amount,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                days_overdue: r.days_overdue,
                delay_category: r.delay_category,
                interest_cost: r.interest_cost,
                holding_penalty: r.holding_penalty,
                total_delay_cost: r.total_delay_cost,
                claim_type: r.claim_type,
                recommended_action: r.recommended_action,
                detection_reasons: r.evidence.detection_reasons
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('⏰ [DELAY] Error storing results', { error: error.message });
        } else {
            logger.info('⏰ [DELAY] Stored delay detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('⏰ [DELAY] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Utility: Get Delay Summary for Seller
// ============================================================================

/**
 * Generate a cashflow risk summary for seller dashboard
 */
export async function getDelaySummary(sellerId: string): Promise<{
    pendingCount: number;
    overdueCount: number;
    totalPendingValue: number;
    totalOverdueValue: number;
    estimatedDelayCost: number;
    avgDaysOverdue: number;
    urgentActions: number;
}> {
    try {
        const pendingTimelines = await fetchPendingReimbursements(sellerId);

        let overdueCount = 0;
        let totalPendingValue = 0;
        let totalOverdueValue = 0;
        let totalDelayCost = 0;
        let totalDaysOverdue = 0;
        let urgentActions = 0;
        const today = new Date();

        for (const timeline of pendingTimelines) {
            totalPendingValue += timeline.expected_amount || 0;

            if (timeline.status === 'overdue') {
                overdueCount++;
                totalOverdueValue += timeline.expected_amount || 0;

                const expectedDate = new Date(timeline.expected_reimbursement_date);
                const daysOverdue = Math.floor((today.getTime() - expectedDate.getTime()) / (1000 * 60 * 60 * 24));

                if (daysOverdue > 0) {
                    totalDaysOverdue += daysOverdue;
                    const category = categorizeDelay(daysOverdue);
                    totalDelayCost += calculateInterestCost(timeline.expected_amount, daysOverdue);
                    totalDelayCost += calculateHoldingPenalty(timeline.expected_amount, daysOverdue, category);

                    if (daysOverdue > 30) {
                        urgentActions++;
                    }
                }
            }
        }

        return {
            pendingCount: pendingTimelines.length,
            overdueCount,
            totalPendingValue,
            totalOverdueValue,
            estimatedDelayCost: totalDelayCost,
            avgDaysOverdue: overdueCount > 0 ? totalDaysOverdue / overdueCount : 0,
            urgentActions
        };
    } catch (err: any) {
        logger.error('⏰ [DELAY] Error generating summary', { error: err.message });
        return {
            pendingCount: 0,
            overdueCount: 0,
            totalPendingValue: 0,
            totalOverdueValue: 0,
            estimatedDelayCost: 0,
            avgDaysOverdue: 0,
            urgentActions: 0
        };
    }
}

// ============================================================================
// Exports
// ============================================================================

export { THRESHOLD_SHOW_TO_USER, THRESHOLD_RECOMMEND_FILING, SLA_WINDOWS };
