/**
 * Return Abuse Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Return Fraud & Non-Return Reimbursement
 * 
 * Detects return abuse patterns that rob sellers:
 * 1. Refund issued but buyer never returns item
 * 2. Buyer returns wrong/different item
 * 3. Buyer returns item damaged beyond policy
 * 4. Return window exceeded but refund still issued
 * 5. Serial returners exploiting policy
 * 
 * This prints money at scale.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface RefundEvent {
    id: string;
    seller_id: string;
    order_id: string;
    refund_date: string;
    refund_amount: number;
    refund_reason?: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    quantity: number;
    currency: string;
    buyer_id?: string;
}

export interface ReturnEvent {
    id: string;
    seller_id: string;
    order_id: string;
    return_date: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    quantity: number;
    return_reason?: string;
    item_condition?: ItemCondition;
    disposition?: ReturnDisposition;
    restockable: boolean;
    carrier_tracking?: string;
}

export type ItemCondition =
    | 'sellable'
    | 'damaged'
    | 'customer_damaged'
    | 'carrier_damaged'
    | 'defective'
    | 'expired'
    | 'wrong_item'
    | 'missing_parts'
    | 'unknown';

export type ReturnDisposition =
    | 'restocked'
    | 'disposed'
    | 'liquidated'
    | 'returned_to_seller'
    | 'pending'
    | 'unknown';

export interface ReturnAbuseResult {
    seller_id: string;
    sync_id: string;

    // Case identifiers
    order_id: string;
    sku?: string;
    asin?: string;

    // Abuse type
    abuse_type: ReturnAbuseType;
    abuse_severity: 'low' | 'medium' | 'high' | 'critical';

    // Financial impact
    refund_amount: number;
    expected_recovery: number;
    loss_type: 'full_loss' | 'partial_loss' | 'restocking_fee_owed' | 'replacement_cost';
    currency: string;

    // Details
    refund_date: string;
    return_date?: string;
    days_since_refund: number;
    return_window_days: number;

    // Classification
    severity: 'low' | 'medium' | 'high' | 'critical';
    recommended_action: 'monitor' | 'investigate' | 'file_claim' | 'flag_buyer';

    // Confidence
    confidence_score: number;
    confidence_factors: ReturnAbuseConfidenceFactors;

    // Evidence
    evidence: {
        refund_event?: RefundEvent;
        return_event?: ReturnEvent;
        detection_reasons: string[];
        buyer_history?: BuyerRiskProfile;
    };
}

export type ReturnAbuseType =
    | 'refund_no_return'             // Refund issued, item never returned
    | 'wrong_item_returned'          // Different item sent back
    | 'damaged_beyond_policy'        // Customer damaged but refunded
    | 'return_window_exceeded'       // Late return still refunded
    | 'partial_return'               // Qty mismatch
    | 'serial_returner'              // Repeat abuse pattern
    | 'restocking_fee_not_charged';  // Fee should have been deducted

export interface ReturnAbuseConfidenceFactors {
    clear_refund_record: boolean;      // +0.25
    return_status_clear: boolean;      // +0.25
    window_verifiable: boolean;        // +0.20
    condition_documented: boolean;     // +0.15
    buyer_pattern_known: boolean;      // +0.15
    calculated_score: number;
}

export interface BuyerRiskProfile {
    buyer_id: string;
    total_orders: number;
    total_returns: number;
    return_rate: number;
    abuse_incidents: number;
    risk_level: 'low' | 'medium' | 'high' | 'extreme';
}

export interface ReturnAbuseSyncedData {
    seller_id: string;
    sync_id: string;
    refund_events: RefundEvent[];
    return_events: ReturnEvent[];
}

// ============================================================================
// Constants
// ============================================================================

// Amazon return window (days)
const DEFAULT_RETURN_WINDOW = 30;
const EXTENDED_RETURN_WINDOW = 45; // During holidays

// Grace period for return to arrive after refund
const RETURN_GRACE_PERIOD_DAYS = 14;

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_RECOMMEND_FILING = 0.75;
const MIN_RECOVERY_VALUE = 10;

// Restocking fee rates
const RESTOCKING_FEES: Record<string, number> = {
    'customer_damaged': 0.20,    // 20% restocking fee
    'missing_parts': 0.15,
    'opened_box': 0.10,
    'defective': 0.00,           // No fee for defective
    'wrong_item': 1.00,          // Full value (seller keeps)
};

// Serial returner threshold
const SERIAL_RETURNER_THRESHOLD = 0.30; // 30%+ return rate

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect return abuse patterns
 */
export async function detectReturnAbuse(
    sellerId: string,
    syncId: string,
    data: ReturnAbuseSyncedData
): Promise<ReturnAbuseResult[]> {
    const results: ReturnAbuseResult[] = [];

    logger.info('🔄 [RETURN-ABUSE] Starting return abuse detection', {
        sellerId,
        syncId,
        refundCount: data.refund_events?.length || 0,
        returnCount: data.return_events?.length || 0
    });

    if (!data.refund_events || data.refund_events.length === 0) {
        logger.info('🔄 [RETURN-ABUSE] No refund events to analyze');
        return results;
    }

    // Build return lookup by order_id
    const returnsByOrder = new Map<string, ReturnEvent[]>();
    for (const ret of (data.return_events || [])) {
        const existing = returnsByOrder.get(ret.order_id) || [];
        existing.push(ret);
        returnsByOrder.set(ret.order_id, existing);
    }

    // Build buyer risk profiles
    const buyerProfiles = await buildBuyerProfiles(sellerId, data.refund_events);
    logger.info('🔄 [RETURN-ABUSE] Built buyer profiles', { count: buyerProfiles.size });

    const today = new Date();

    // Analyze each refund for abuse patterns
    for (const refund of data.refund_events) {
        try {
            const returns = returnsByOrder.get(refund.order_id) || [];
            const buyerProfile = refund.buyer_id ? buyerProfiles.get(refund.buyer_id) : undefined;

            const detections = analyzeRefundForAbuse(
                sellerId,
                syncId,
                refund,
                returns,
                buyerProfile,
                today
            );

            for (const detection of detections) {
                if (detection.expected_recovery >= MIN_RECOVERY_VALUE &&
                    detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                    results.push(detection);
                }
            }
        } catch (error: any) {
            logger.warn('🔄 [RETURN-ABUSE] Error analyzing refund', {
                orderId: refund.order_id,
                error: error.message
            });
        }
    }

    // Sort by recovery value (highest first)
    results.sort((a, b) => b.expected_recovery - a.expected_recovery);

    const totalRecovery = results.reduce((sum, r) => sum + r.expected_recovery, 0);
    const noReturnCount = results.filter(r => r.abuse_type === 'refund_no_return').length;
    const wrongItemCount = results.filter(r => r.abuse_type === 'wrong_item_returned').length;

    logger.info('🔄 [RETURN-ABUSE] Detection complete', {
        sellerId,
        analyzed: data.refund_events.length,
        abuseDetected: results.length,
        refundsNoReturn: noReturnCount,
        wrongItemReturns: wrongItemCount,
        totalRecovery: totalRecovery.toFixed(2)
    });

    return results;
}

/**
 * Analyze a single refund for abuse patterns
 */
function analyzeRefundForAbuse(
    sellerId: string,
    syncId: string,
    refund: RefundEvent,
    returns: ReturnEvent[],
    buyerProfile: BuyerRiskProfile | undefined,
    today: Date
): ReturnAbuseResult[] {
    const results: ReturnAbuseResult[] = [];
    const refundDate = new Date(refund.refund_date);
    const daysSinceRefund = Math.floor((today.getTime() - refundDate.getTime()) / (1000 * 60 * 60 * 24));

    // Check 1: Refund with no return (after grace period)
    if (returns.length === 0 && daysSinceRefund > RETURN_GRACE_PERIOD_DAYS) {
        const detection = detectRefundNoReturn(sellerId, syncId, refund, daysSinceRefund, buyerProfile);
        if (detection) results.push(detection);
    }

    // For each return associated with this order
    for (const returnEvent of returns) {
        // Check 2: Wrong item returned
        if (returnEvent.item_condition === 'wrong_item') {
            const detection = detectWrongItemReturn(sellerId, syncId, refund, returnEvent, buyerProfile);
            if (detection) results.push(detection);
        }

        // Check 3: Damaged beyond policy
        if (returnEvent.item_condition === 'customer_damaged' && !returnEvent.restockable) {
            const detection = detectDamagedReturn(sellerId, syncId, refund, returnEvent, buyerProfile);
            if (detection) results.push(detection);
        }

        // Check 4: Return window exceeded
        const returnDate = new Date(returnEvent.return_date);
        const daysBetween = Math.floor((returnDate.getTime() - refundDate.getTime()) / (1000 * 60 * 60 * 24));
        if (Math.abs(daysBetween) > DEFAULT_RETURN_WINDOW) {
            const detection = detectLateReturn(sellerId, syncId, refund, returnEvent, daysBetween, buyerProfile);
            if (detection) results.push(detection);
        }

        // Check 5: Partial return (quantity mismatch)
        if (returnEvent.quantity < refund.quantity) {
            const detection = detectPartialReturn(sellerId, syncId, refund, returnEvent, buyerProfile);
            if (detection) results.push(detection);
        }

        // Check 6: Restocking fee not charged
        if (shouldHaveRestockingFee(returnEvent) && refund.refund_amount === getOriginalOrderValue(refund)) {
            const detection = detectMissingRestockingFee(sellerId, syncId, refund, returnEvent, buyerProfile);
            if (detection) results.push(detection);
        }
    }

    // Check 7: Serial returner pattern
    if (buyerProfile && buyerProfile.risk_level === 'extreme') {
        const detection = detectSerialReturner(sellerId, syncId, refund, buyerProfile);
        if (detection) results.push(detection);
    }

    return results;
}

// ============================================================================
// Individual Detection Functions
// ============================================================================

/**
 * Detect refund without return
 */
function detectRefundNoReturn(
    sellerId: string,
    syncId: string,
    refund: RefundEvent,
    daysSinceRefund: number,
    buyerProfile?: BuyerRiskProfile
): ReturnAbuseResult {
    const detectionReasons = [
        `Refund of $${refund.refund_amount.toFixed(2)} issued ${daysSinceRefund} days ago`,
        `No return received after ${RETURN_GRACE_PERIOD_DAYS}-day grace period`,
        `Order ID: ${refund.order_id}`
    ];

    if (buyerProfile && buyerProfile.return_rate > 0.20) {
        detectionReasons.push(`Buyer has ${(buyerProfile.return_rate * 100).toFixed(0)}% return rate`);
    }

    const confidence = calculateConfidence(refund, undefined, daysSinceRefund, buyerProfile);
    const severity = determineSeverity(refund.refund_amount, 'refund_no_return', daysSinceRefund);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        order_id: refund.order_id,
        sku: refund.sku,
        asin: refund.asin,

        abuse_type: 'refund_no_return',
        abuse_severity: categorizeAbuse(daysSinceRefund, refund.refund_amount),

        refund_amount: refund.refund_amount,
        expected_recovery: refund.refund_amount, // Full recovery expected
        loss_type: 'full_loss',
        currency: refund.currency,

        refund_date: refund.refund_date,
        return_date: undefined,
        days_since_refund: daysSinceRefund,
        return_window_days: DEFAULT_RETURN_WINDOW,

        severity,
        recommended_action: confidence.calculated_score >= THRESHOLD_RECOMMEND_FILING ? 'file_claim' : 'investigate',

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        evidence: {
            refund_event: refund,
            detection_reasons: detectionReasons,
            buyer_history: buyerProfile
        }
    };
}

/**
 * Detect wrong item returned
 */
function detectWrongItemReturn(
    sellerId: string,
    syncId: string,
    refund: RefundEvent,
    returnEvent: ReturnEvent,
    buyerProfile?: BuyerRiskProfile
): ReturnAbuseResult {
    const detectionReasons = [
        `Wrong item returned for order ${refund.order_id}`,
        `Original: ${refund.sku || refund.asin || 'Unknown'}`,
        `Returned item condition: ${returnEvent.item_condition}`,
        `Full refund of $${refund.refund_amount.toFixed(2)} was issued`
    ];

    const confidence = calculateConfidence(refund, returnEvent, 0, buyerProfile);
    // Wrong item = very high confidence
    confidence.calculated_score = Math.min(1, confidence.calculated_score + 0.15);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        order_id: refund.order_id,
        sku: refund.sku,
        asin: refund.asin,

        abuse_type: 'wrong_item_returned',
        abuse_severity: 'critical',

        refund_amount: refund.refund_amount,
        expected_recovery: refund.refund_amount,
        loss_type: 'full_loss',
        currency: refund.currency,

        refund_date: refund.refund_date,
        return_date: returnEvent.return_date,
        days_since_refund: 0,
        return_window_days: DEFAULT_RETURN_WINDOW,

        severity: 'critical',
        recommended_action: 'file_claim',

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        evidence: {
            refund_event: refund,
            return_event: returnEvent,
            detection_reasons: detectionReasons,
            buyer_history: buyerProfile
        }
    };
}

/**
 * Detect customer-damaged return
 */
function detectDamagedReturn(
    sellerId: string,
    syncId: string,
    refund: RefundEvent,
    returnEvent: ReturnEvent,
    buyerProfile?: BuyerRiskProfile
): ReturnAbuseResult {
    const restockingFeeRate = RESTOCKING_FEES['customer_damaged'] || 0.20;
    const expectedFee = refund.refund_amount * restockingFeeRate;

    const detectionReasons = [
        `Item returned with customer damage, not restockable`,
        `Full refund issued without restocking fee`,
        `Expected restocking fee: $${expectedFee.toFixed(2)} (${(restockingFeeRate * 100).toFixed(0)}%)`
    ];

    const confidence = calculateConfidence(refund, returnEvent, 0, buyerProfile);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        order_id: refund.order_id,
        sku: refund.sku,
        asin: refund.asin,

        abuse_type: 'damaged_beyond_policy',
        abuse_severity: 'high',

        refund_amount: refund.refund_amount,
        expected_recovery: expectedFee,
        loss_type: 'restocking_fee_owed',
        currency: refund.currency,

        refund_date: refund.refund_date,
        return_date: returnEvent.return_date,
        days_since_refund: 0,
        return_window_days: DEFAULT_RETURN_WINDOW,

        severity: 'high',
        recommended_action: 'file_claim',

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        evidence: {
            refund_event: refund,
            return_event: returnEvent,
            detection_reasons: detectionReasons,
            buyer_history: buyerProfile
        }
    };
}

/**
 * Detect late return
 */
function detectLateReturn(
    sellerId: string,
    syncId: string,
    refund: RefundEvent,
    returnEvent: ReturnEvent,
    daysBetween: number,
    buyerProfile?: BuyerRiskProfile
): ReturnAbuseResult {
    const daysLate = Math.abs(daysBetween) - DEFAULT_RETURN_WINDOW;

    const detectionReasons = [
        `Return received ${daysLate} days after return window closed`,
        `Return window: ${DEFAULT_RETURN_WINDOW} days, actual: ${Math.abs(daysBetween)} days`,
        `Refund should not have been issued for late return`
    ];

    const confidence = calculateConfidence(refund, returnEvent, daysLate, buyerProfile);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        order_id: refund.order_id,
        sku: refund.sku,
        asin: refund.asin,

        abuse_type: 'return_window_exceeded',
        abuse_severity: 'medium',

        refund_amount: refund.refund_amount,
        expected_recovery: refund.refund_amount,
        loss_type: 'full_loss',
        currency: refund.currency,

        refund_date: refund.refund_date,
        return_date: returnEvent.return_date,
        days_since_refund: daysBetween,
        return_window_days: DEFAULT_RETURN_WINDOW,

        severity: 'medium',
        recommended_action: 'investigate',

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        evidence: {
            refund_event: refund,
            return_event: returnEvent,
            detection_reasons: detectionReasons,
            buyer_history: buyerProfile
        }
    };
}

/**
 * Detect partial return
 */
function detectPartialReturn(
    sellerId: string,
    syncId: string,
    refund: RefundEvent,
    returnEvent: ReturnEvent,
    buyerProfile?: BuyerRiskProfile
): ReturnAbuseResult {
    const missingQty = refund.quantity - returnEvent.quantity;
    const unitPrice = refund.refund_amount / refund.quantity;
    const missingValue = missingQty * unitPrice;

    const detectionReasons = [
        `Partial return: ${returnEvent.quantity} of ${refund.quantity} units returned`,
        `Missing ${missingQty} units worth $${missingValue.toFixed(2)}`,
        `Full refund of $${refund.refund_amount.toFixed(2)} was issued`
    ];

    const confidence = calculateConfidence(refund, returnEvent, 0, buyerProfile);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        order_id: refund.order_id,
        sku: refund.sku,
        asin: refund.asin,

        abuse_type: 'partial_return',
        abuse_severity: 'high',

        refund_amount: refund.refund_amount,
        expected_recovery: missingValue,
        loss_type: 'partial_loss',
        currency: refund.currency,

        refund_date: refund.refund_date,
        return_date: returnEvent.return_date,
        days_since_refund: 0,
        return_window_days: DEFAULT_RETURN_WINDOW,

        severity: 'high',
        recommended_action: 'file_claim',

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        evidence: {
            refund_event: refund,
            return_event: returnEvent,
            detection_reasons: detectionReasons,
            buyer_history: buyerProfile
        }
    };
}

/**
 * Detect missing restocking fee
 */
function detectMissingRestockingFee(
    sellerId: string,
    syncId: string,
    refund: RefundEvent,
    returnEvent: ReturnEvent,
    buyerProfile?: BuyerRiskProfile
): ReturnAbuseResult {
    const feeRate = RESTOCKING_FEES[returnEvent.item_condition || ''] || 0.15;
    const expectedFee = refund.refund_amount * feeRate;

    const detectionReasons = [
        `Return condition "${returnEvent.item_condition}" should have ${(feeRate * 100).toFixed(0)}% restocking fee`,
        `Expected fee: $${expectedFee.toFixed(2)}`,
        `Full refund issued without deduction`
    ];

    const confidence = calculateConfidence(refund, returnEvent, 0, buyerProfile);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        order_id: refund.order_id,
        sku: refund.sku,
        asin: refund.asin,

        abuse_type: 'restocking_fee_not_charged',
        abuse_severity: 'medium',

        refund_amount: refund.refund_amount,
        expected_recovery: expectedFee,
        loss_type: 'restocking_fee_owed',
        currency: refund.currency,

        refund_date: refund.refund_date,
        return_date: returnEvent.return_date,
        days_since_refund: 0,
        return_window_days: DEFAULT_RETURN_WINDOW,

        severity: 'medium',
        recommended_action: 'file_claim',

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        evidence: {
            refund_event: refund,
            return_event: returnEvent,
            detection_reasons: detectionReasons,
            buyer_history: buyerProfile
        }
    };
}

/**
 * Detect serial returner abuse
 */
function detectSerialReturner(
    sellerId: string,
    syncId: string,
    refund: RefundEvent,
    buyerProfile: BuyerRiskProfile
): ReturnAbuseResult {
    const detectionReasons = [
        `Buyer flagged as serial returner (${(buyerProfile.return_rate * 100).toFixed(0)}% return rate)`,
        `${buyerProfile.total_returns} returns out of ${buyerProfile.total_orders} orders`,
        `${buyerProfile.abuse_incidents} previous abuse incidents detected`,
        `Risk level: ${buyerProfile.risk_level.toUpperCase()}`
    ];

    return {
        seller_id: sellerId,
        sync_id: syncId,
        order_id: refund.order_id,
        sku: refund.sku,
        asin: refund.asin,

        abuse_type: 'serial_returner',
        abuse_severity: 'critical',

        refund_amount: refund.refund_amount,
        expected_recovery: refund.refund_amount * 0.5, // Partial recovery for pattern
        loss_type: 'full_loss',
        currency: refund.currency,

        refund_date: refund.refund_date,
        return_date: undefined,
        days_since_refund: 0,
        return_window_days: DEFAULT_RETURN_WINDOW,

        severity: 'critical',
        recommended_action: 'flag_buyer',

        confidence_score: 0.90,
        confidence_factors: {
            clear_refund_record: true,
            return_status_clear: true,
            window_verifiable: true,
            condition_documented: true,
            buyer_pattern_known: true,
            calculated_score: 0.90
        },

        evidence: {
            refund_event: refund,
            detection_reasons: detectionReasons,
            buyer_history: buyerProfile
        }
    };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate confidence score
 */
function calculateConfidence(
    refund: RefundEvent,
    returnEvent: ReturnEvent | undefined,
    daysOverdue: number,
    buyerProfile?: BuyerRiskProfile
): ReturnAbuseConfidenceFactors {
    let score = 0;

    // Clear refund record? +0.25
    const clearRefund = !!refund.order_id && !!refund.refund_amount;
    if (clearRefund) score += 0.25;

    // Return status clear? +0.25
    const returnClear = returnEvent ? !!returnEvent.item_condition : (daysOverdue > RETURN_GRACE_PERIOD_DAYS);
    if (returnClear) score += 0.25;

    // Window verifiable? +0.20
    const windowVerifiable = !!refund.refund_date;
    if (windowVerifiable) score += 0.20;

    // Condition documented? +0.15
    const conditionDocs = returnEvent ? !!returnEvent.item_condition && returnEvent.item_condition !== 'unknown' : false;
    if (conditionDocs) score += 0.15;

    // Buyer pattern known? +0.15
    const buyerKnown = buyerProfile && buyerProfile.total_orders >= 3;
    if (buyerKnown) score += 0.15;

    return {
        clear_refund_record: clearRefund,
        return_status_clear: returnClear,
        window_verifiable: windowVerifiable,
        condition_documented: conditionDocs,
        buyer_pattern_known: !!buyerKnown,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Categorize abuse severity
 */
function categorizeAbuse(
    daysOverdue: number,
    amount: number
): 'low' | 'medium' | 'high' | 'critical' {
    if (amount >= 100 || daysOverdue >= 60) return 'critical';
    if (amount >= 50 || daysOverdue >= 30) return 'high';
    if (amount >= 25 || daysOverdue >= 14) return 'medium';
    return 'low';
}

/**
 * Determine severity
 */
function determineSeverity(
    amount: number,
    abuseType: ReturnAbuseType,
    daysOverdue: number
): 'low' | 'medium' | 'high' | 'critical' {
    if (abuseType === 'wrong_item_returned' || abuseType === 'serial_returner') {
        return 'critical';
    }
    if (amount >= 100 || daysOverdue >= 45) return 'critical';
    if (amount >= 50 || daysOverdue >= 30) return 'high';
    if (amount >= 25) return 'medium';
    return 'low';
}

/**
 * Check if restocking fee should apply
 */
function shouldHaveRestockingFee(returnEvent: ReturnEvent): boolean {
    const feeConditions: ItemCondition[] = ['customer_damaged', 'missing_parts', 'opened_box' as any];
    return feeConditions.includes(returnEvent.item_condition || 'unknown');
}

/**
 * Get original order value (estimate)
 */
function getOriginalOrderValue(refund: RefundEvent): number {
    return refund.refund_amount; // Assume full refund = original value
}

/**
 * Build buyer risk profiles
 */
async function buildBuyerProfiles(
    sellerId: string,
    refunds: RefundEvent[]
): Promise<Map<string, BuyerRiskProfile>> {
    const profiles = new Map<string, BuyerRiskProfile>();
    const buyerStats = new Map<string, { orders: number; returns: number; abuse: number }>();

    // Count refunds per buyer
    for (const refund of refunds) {
        if (!refund.buyer_id) continue;

        const stats = buyerStats.get(refund.buyer_id) || { orders: 0, returns: 0, abuse: 0 };
        stats.returns++;
        buyerStats.set(refund.buyer_id, stats);
    }

    // Build profiles
    for (const [buyerId, stats] of buyerStats) {
        // Estimate orders (returns are typically 5-15% of orders)
        const estimatedOrders = Math.max(stats.returns, Math.round(stats.returns / 0.1));
        const returnRate = stats.returns / estimatedOrders;

        let riskLevel: BuyerRiskProfile['risk_level'] = 'low';
        if (returnRate >= 0.50) riskLevel = 'extreme';
        else if (returnRate >= 0.30) riskLevel = 'high';
        else if (returnRate >= 0.15) riskLevel = 'medium';

        profiles.set(buyerId, {
            buyer_id: buyerId,
            total_orders: estimatedOrders,
            total_returns: stats.returns,
            return_rate: returnRate,
            abuse_incidents: stats.abuse,
            risk_level: riskLevel
        });
    }

    return profiles;
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch refund events for analysis
 */
export async function fetchRefundEvents(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<RefundEvent[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const events: RefundEvent[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .in('transaction_type', ['refund', 'Refund'])
            .gte('settlement_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                events.push({
                    id: row.id,
                    seller_id: sellerId,
                    order_id: row.order_id,
                    refund_date: row.settlement_date,
                    refund_amount: Math.abs(parseFloat(row.amount) || 0),
                    refund_reason: row.metadata?.reason,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    quantity: row.quantity || 1,
                    currency: row.currency || 'USD',
                    buyer_id: row.metadata?.buyer_id
                });
            }
        }

        logger.info('🔄 [RETURN-ABUSE] Fetched refund events', { sellerId, count: events.length });
    } catch (err: any) {
        logger.error('🔄 [RETURN-ABUSE] Error fetching refund events', { error: err.message });
    }

    return events;
}

/**
 * Fetch return events for analysis
 */
export async function fetchReturnEvents(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<ReturnEvent[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const events: ReturnEvent[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('fba_returns')
            .select('*')
            .eq('user_id', sellerId)
            .gte('return_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                events.push({
                    id: row.id,
                    seller_id: sellerId,
                    order_id: row.order_id,
                    return_date: row.return_date,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    quantity: row.quantity || 1,
                    return_reason: row.reason,
                    item_condition: mapItemCondition(row.disposition),
                    disposition: mapDisposition(row.disposition),
                    restockable: row.restockable ?? (row.disposition === 'SELLABLE'),
                    carrier_tracking: row.tracking_number
                });
            }
        }

        logger.info('🔄 [RETURN-ABUSE] Fetched return events', { sellerId, count: events.length });
    } catch (err: any) {
        logger.error('🔄 [RETURN-ABUSE] Error fetching return events', { error: err.message });
    }

    return events;
}

/**
 * Map disposition to item condition
 */
function mapItemCondition(disposition: string): ItemCondition {
    const mapping: Record<string, ItemCondition> = {
        'SELLABLE': 'sellable',
        'DAMAGED': 'damaged',
        'CUSTOMER_DAMAGED': 'customer_damaged',
        'CARRIER_DAMAGED': 'carrier_damaged',
        'DEFECTIVE': 'defective',
        'EXPIRED': 'expired',
        'WRONG_ITEM': 'wrong_item',
    };
    return mapping[disposition?.toUpperCase()] || 'unknown';
}

/**
 * Map disposition type
 */
function mapDisposition(disposition: string): ReturnDisposition {
    const mapping: Record<string, ReturnDisposition> = {
        'SELLABLE': 'restocked',
        'DISPOSED': 'disposed',
        'LIQUIDATED': 'liquidated',
        'RETURNED_TO_SELLER': 'returned_to_seller',
    };
    return mapping[disposition?.toUpperCase()] || 'unknown';
}

/**
 * Store return abuse detection results
 */
export async function storeReturnAbuseResults(
    results: ReturnAbuseResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'return_abuse',
            severity: r.severity,
            estimated_value: r.expected_recovery,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                order_id: r.order_id,
                sku: r.sku,
                abuse_type: r.abuse_type,
                abuse_severity: r.abuse_severity,
                refund_amount: r.refund_amount,
                loss_type: r.loss_type,
                days_since_refund: r.days_since_refund,
                recommended_action: r.recommended_action,
                detection_reasons: r.evidence.detection_reasons,
                buyer_risk: r.evidence.buyer_history?.risk_level
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('🔄 [RETURN-ABUSE] Error storing results', { error: error.message });
        } else {
            logger.info('🔄 [RETURN-ABUSE] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('🔄 [RETURN-ABUSE] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Exports
// ============================================================================

export { THRESHOLD_SHOW_TO_USER, THRESHOLD_RECOMMEND_FILING, DEFAULT_RETURN_WINDOW };
