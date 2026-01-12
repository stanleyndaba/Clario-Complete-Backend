/**
 * Phantom Refund Compensation Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Quiet Leak Stopper
 * 
 * Problem: Customer refunded, Amazon says item returned...
 * but inventory never actually increases.
 * 
 * This detects:
 * - Refund events where item "returned" but inventory not credited
 * - Warehouse processing failures
 * - Lost in transit returns that were marked delivered
 * 
 * The QUIET LEAK that compounds silently.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface RefundEventData {
    id: string;
    seller_id: string;
    order_id: string;
    refund_date: string;
    sku: string;
    asin?: string;
    fnsku?: string;

    // Refund details
    refund_amount: number;
    quantity: number;
    currency: string;

    // Return status from Amazon
    return_status: ReturnStatus;
    return_reason?: string;

    // Tracking
    return_tracking_id?: string;
    return_received_date?: string;
}

export type ReturnStatus =
    | 'return_received'     // Amazon says received
    | 'return_in_transit'   // On the way
    | 'return_delivered'    // Marked delivered
    | 'no_return_required'  // Refund without return
    | 'return_pending'      // Expected
    | 'unknown';

export interface InventoryAdjustment {
    id: string;
    seller_id: string;
    adjustment_date: string;
    sku: string;
    fnsku?: string;

    // Adjustment details
    adjustment_type: AdjustmentType;
    quantity_delta: number;
    reason_code?: string;

    // Reference
    reference_id?: string;
    order_id?: string;
}

export type AdjustmentType =
    | 'customer_return'
    | 'warehouse_damage'
    | 'warehouse_lost'
    | 'found'
    | 'unrecoverable_damage'
    | 'removal'
    | 'disposed'
    | 'other';

export interface PhantomRefundResult {
    seller_id: string;
    sync_id: string;

    // Event identification
    order_id: string;
    sku: string;
    asin?: string;
    refund_date: string;

    // Phantom status
    phantom_type: PhantomType;
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Quantities
    refunded_quantity: number;
    returned_quantity: number;  // What Amazon claims
    credited_quantity: number;  // What actually hit inventory
    phantom_quantity: number;   // Difference

    // Financial impact
    refund_amount: number;
    expected_inventory_value: number;
    phantom_loss_value: number;
    currency: string;

    // Time tracking
    return_claimed_date?: string;
    days_since_return: number;

    // Confidence
    confidence_score: number;
    confidence_factors: PhantomConfidenceFactors;

    // Recommendation
    recommended_action: 'monitor' | 'investigate' | 'file_claim' | 'escalate';

    // Evidence
    evidence: {
        refund_event: RefundEventData;
        matching_adjustments: InventoryAdjustment[];
        detection_reasons: string[];
        timeline: TimelineEvent[];
    };
}

export type PhantomType =
    | 'return_not_credited'      // Return received, inventory not increased
    | 'partial_credit'           // Only part of return credited
    | 'delayed_credit'           // Too long since return, still no credit
    | 'warehouse_black_hole'     // Received but "lost" in warehouse
    | 'duplicate_refund_single_return';  // Refunded twice, only one return

export interface PhantomConfidenceFactors {
    return_marked_received: boolean;   // +0.30
    sufficient_wait_time: boolean;     // +0.25
    no_matching_adjustment: boolean;   // +0.25
    clear_quantity_mismatch: boolean;  // +0.15
    tracking_confirmed: boolean;       // +0.05
    calculated_score: number;
}

export interface TimelineEvent {
    date: string;
    event_type: 'refund' | 'return_shipped' | 'return_received' | 'inventory_adjustment';
    description: string;
    quantity?: number;
}

export interface PhantomRefundSyncedData {
    seller_id: string;
    sync_id: string;
    refund_events: RefundEventData[];
    inventory_adjustments: InventoryAdjustment[];
}

// ============================================================================
// Constants
// ============================================================================

// Wait time before flagging (days)
const MIN_WAIT_DAYS_CREDIT = 14;  // 14 days to credit inventory
const MAX_WAIT_DAYS_CREDIT = 45;  // After this, definitely phantom

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_FILE_CLAIM = 0.75;
const MIN_PHANTOM_VALUE = 10; // $10 minimum

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect phantom refunds
 */
export async function detectPhantomRefunds(
    sellerId: string,
    syncId: string,
    data: PhantomRefundSyncedData
): Promise<PhantomRefundResult[]> {
    const results: PhantomRefundResult[] = [];

    logger.info('👻 [PHANTOM] Starting phantom refund detection', {
        sellerId,
        syncId,
        refundEventCount: data.refund_events?.length || 0,
        adjustmentCount: data.inventory_adjustments?.length || 0
    });

    if (!data.refund_events || data.refund_events.length === 0) {
        logger.info('👻 [PHANTOM] No refund events to analyze');
        return results;
    }

    // Build adjustment lookup by SKU and order
    const adjustmentsBySku = new Map<string, InventoryAdjustment[]>();
    const adjustmentsByOrder = new Map<string, InventoryAdjustment[]>();

    for (const adj of data.inventory_adjustments || []) {
        // By SKU
        const skuAdjs = adjustmentsBySku.get(adj.sku) || [];
        skuAdjs.push(adj);
        adjustmentsBySku.set(adj.sku, skuAdjs);

        // By Order
        if (adj.order_id) {
            const orderAdjs = adjustmentsByOrder.get(adj.order_id) || [];
            orderAdjs.push(adj);
            adjustmentsByOrder.set(adj.order_id, orderAdjs);
        }
    }

    // Analyze each refund event
    for (const refundEvent of data.refund_events) {
        try {
            // Skip if no return required
            if (refundEvent.return_status === 'no_return_required') {
                continue;
            }

            const detection = analyzePhantomRefund(
                sellerId,
                syncId,
                refundEvent,
                adjustmentsBySku.get(refundEvent.sku) || [],
                adjustmentsByOrder.get(refundEvent.order_id) || []
            );

            if (detection &&
                detection.phantom_loss_value >= MIN_PHANTOM_VALUE &&
                detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                results.push(detection);
            }
        } catch (error: any) {
            logger.warn('👻 [PHANTOM] Error analyzing refund event', {
                orderId: refundEvent.order_id,
                error: error.message
            });
        }
    }

    // Sort by phantom loss value
    results.sort((a, b) => b.phantom_loss_value - a.phantom_loss_value);

    const totalPhantomLoss = results.reduce((sum, r) => sum + r.phantom_loss_value, 0);
    const totalPhantomQty = results.reduce((sum, r) => sum + r.phantom_quantity, 0);

    logger.info('👻 [PHANTOM] Detection complete', {
        sellerId,
        eventsAnalyzed: data.refund_events.length,
        phantomsFound: results.length,
        totalPhantomQuantity: totalPhantomQty,
        totalPhantomLoss: totalPhantomLoss.toFixed(2)
    });

    return results;
}

/**
 * Analyze a single refund event for phantom return
 */
function analyzePhantomRefund(
    sellerId: string,
    syncId: string,
    refund: RefundEventData,
    skuAdjustments: InventoryAdjustment[],
    orderAdjustments: InventoryAdjustment[]
): PhantomRefundResult | null {
    const detectionReasons: string[] = [];
    const timeline: TimelineEvent[] = [];

    // Add refund to timeline
    timeline.push({
        date: refund.refund_date,
        event_type: 'refund',
        description: `Refund of $${refund.refund_amount} for ${refund.quantity} units`,
        quantity: refund.quantity
    });

    // Step 1: Check if return was marked as received
    const returnReceived = refund.return_status === 'return_received' ||
        refund.return_status === 'return_delivered';

    if (!returnReceived && refund.return_status !== 'return_pending') {
        return null; // Not a return we can analyze yet
    }

    // Add return received to timeline
    if (refund.return_received_date) {
        timeline.push({
            date: refund.return_received_date,
            event_type: 'return_received',
            description: `Return marked as received`,
            quantity: refund.quantity
        });
    }

    // Step 2: Calculate days since return
    const returnDate = refund.return_received_date || refund.refund_date;
    const daysSinceReturn = Math.floor(
        (Date.now() - new Date(returnDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Skip if too recent
    if (daysSinceReturn < MIN_WAIT_DAYS_CREDIT) {
        return null; // Give it time to be credited
    }

    // Step 3: Find matching inventory credits
    const matchingCredits = findMatchingCredits(
        refund,
        skuAdjustments,
        orderAdjustments,
        timeline
    );

    const creditedQuantity = matchingCredits.reduce((sum, adj) => sum + adj.quantity_delta, 0);
    const phantomQuantity = refund.quantity - Math.max(0, creditedQuantity);

    // No phantom if everything was credited
    if (phantomQuantity <= 0) {
        return null;
    }

    // Step 4: Classify phantom type
    const phantomType = classifyPhantomType(
        refund,
        creditedQuantity,
        phantomQuantity,
        daysSinceReturn
    );

    detectionReasons.push(
        `Return marked as ${refund.return_status}`,
        `${daysSinceReturn} days since return`,
        `Expected inventory credit: ${refund.quantity} units`,
        `Actual credits found: ${creditedQuantity} units`,
        `Phantom quantity: ${phantomQuantity} units`
    );

    // Step 5: Calculate financial impact
    const unitValue = refund.refund_amount / refund.quantity;
    const phantomLossValue = unitValue * phantomQuantity;
    const expectedInventoryValue = unitValue * refund.quantity;

    // Step 6: Confidence scoring
    const confidence = calculatePhantomConfidence(
        refund,
        creditedQuantity,
        phantomQuantity,
        daysSinceReturn,
        matchingCredits
    );

    // Step 7: Determine severity
    const severity = determineSeverity(phantomLossValue, phantomQuantity, daysSinceReturn);

    // Step 8: Determine action
    const recommendedAction = determineAction(confidence.calculated_score, severity, daysSinceReturn);

    return {
        seller_id: sellerId,
        sync_id: syncId,

        order_id: refund.order_id,
        sku: refund.sku,
        asin: refund.asin,
        refund_date: refund.refund_date,

        phantom_type: phantomType,
        severity,

        refunded_quantity: refund.quantity,
        returned_quantity: refund.quantity, // What Amazon claims
        credited_quantity: Math.max(0, creditedQuantity),
        phantom_quantity: phantomQuantity,

        refund_amount: refund.refund_amount,
        expected_inventory_value: expectedInventoryValue,
        phantom_loss_value: phantomLossValue,
        currency: refund.currency,

        return_claimed_date: refund.return_received_date,
        days_since_return: daysSinceReturn,

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        recommended_action: recommendedAction,

        evidence: {
            refund_event: refund,
            matching_adjustments: matchingCredits,
            detection_reasons: detectionReasons,
            timeline: timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        }
    };
}

// ============================================================================
// Credit Matching
// ============================================================================

/**
 * Find inventory adjustments that match the refund
 */
function findMatchingCredits(
    refund: RefundEventData,
    skuAdjustments: InventoryAdjustment[],
    orderAdjustments: InventoryAdjustment[],
    timeline: TimelineEvent[]
): InventoryAdjustment[] {
    const matchingCredits: InventoryAdjustment[] = [];
    const refundDate = new Date(refund.refund_date);

    // Look for credits within reasonable time window after refund
    const windowStart = new Date(refundDate);
    windowStart.setDate(windowStart.getDate() - 7); // 7 days before

    const windowEnd = new Date(refundDate);
    windowEnd.setDate(windowEnd.getDate() + MAX_WAIT_DAYS_CREDIT); // 45 days after

    // First try to match by order ID
    for (const adj of orderAdjustments) {
        if (adj.adjustment_type === 'customer_return' && adj.quantity_delta > 0) {
            const adjDate = new Date(adj.adjustment_date);
            if (adjDate >= windowStart && adjDate <= windowEnd) {
                matchingCredits.push(adj);

                // Add to timeline
                timeline.push({
                    date: adj.adjustment_date,
                    event_type: 'inventory_adjustment',
                    description: `Inventory credit: ${adj.quantity_delta} units (${adj.adjustment_type})`,
                    quantity: adj.quantity_delta
                });
            }
        }
    }

    // If no order match, try SKU-level matching
    if (matchingCredits.length === 0) {
        for (const adj of skuAdjustments) {
            if (adj.adjustment_type === 'customer_return' && adj.quantity_delta > 0) {
                const adjDate = new Date(adj.adjustment_date);
                if (adjDate >= windowStart && adjDate <= windowEnd) {
                    matchingCredits.push(adj);

                    timeline.push({
                        date: adj.adjustment_date,
                        event_type: 'inventory_adjustment',
                        description: `Inventory credit: ${adj.quantity_delta} units (SKU match)`,
                        quantity: adj.quantity_delta
                    });
                }
            }
        }
    }

    return matchingCredits;
}

// ============================================================================
// Classification
// ============================================================================

/**
 * Classify the phantom type
 */
function classifyPhantomType(
    refund: RefundEventData,
    creditedQty: number,
    phantomQty: number,
    daysSince: number
): PhantomType {
    // No credit at all
    if (creditedQty <= 0) {
        if (daysSince > MAX_WAIT_DAYS_CREDIT) {
            return 'warehouse_black_hole';
        }
        return 'return_not_credited';
    }

    // Partial credit
    if (creditedQty > 0 && phantomQty > 0) {
        return 'partial_credit';
    }

    // Delayed but pending
    if (daysSince > MIN_WAIT_DAYS_CREDIT && daysSince <= MAX_WAIT_DAYS_CREDIT) {
        return 'delayed_credit';
    }

    return 'return_not_credited';
}

// ============================================================================
// Confidence & Severity
// ============================================================================

/**
 * Calculate confidence score
 */
function calculatePhantomConfidence(
    refund: RefundEventData,
    creditedQty: number,
    phantomQty: number,
    daysSince: number,
    matchingCredits: InventoryAdjustment[]
): PhantomConfidenceFactors {
    let score = 0;

    // Return marked as received (+0.30)
    const returnReceived = refund.return_status === 'return_received' ||
        refund.return_status === 'return_delivered';
    if (returnReceived) score += 0.30;

    // Sufficient wait time (+0.25)
    const sufficientWait = daysSince >= MIN_WAIT_DAYS_CREDIT;
    if (sufficientWait) score += 0.25;

    // No matching adjustment (+0.25)
    const noMatchingAdj = matchingCredits.length === 0 || creditedQty < refund.quantity;
    if (noMatchingAdj) score += 0.25;

    // Clear quantity mismatch (+0.15)
    const clearMismatch = phantomQty >= 1;
    if (clearMismatch) score += 0.15;

    // Tracking confirmed (+0.05)
    const trackingConfirmed = !!refund.return_tracking_id && returnReceived;
    if (trackingConfirmed) score += 0.05;

    // Boost for very long delays
    if (daysSince >= MAX_WAIT_DAYS_CREDIT) {
        score += 0.10;
    }

    return {
        return_marked_received: returnReceived,
        sufficient_wait_time: sufficientWait,
        no_matching_adjustment: noMatchingAdj,
        clear_quantity_mismatch: clearMismatch,
        tracking_confirmed: trackingConfirmed,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Determine severity
 */
function determineSeverity(
    phantomLoss: number,
    phantomQty: number,
    daysSince: number
): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: High value or very long delay
    if (phantomLoss >= 100 || (daysSince >= MAX_WAIT_DAYS_CREDIT && phantomLoss >= 25)) {
        return 'critical';
    }

    // High: Significant loss or multiple units
    if (phantomLoss >= 50 || phantomQty >= 3 || daysSince >= 30) {
        return 'high';
    }

    // Medium: Notable loss
    if (phantomLoss >= 20 || phantomQty >= 2) {
        return 'medium';
    }

    return 'low';
}

/**
 * Determine recommended action
 */
function determineAction(
    confidence: number,
    severity: 'low' | 'medium' | 'high' | 'critical',
    daysSince: number
): PhantomRefundResult['recommended_action'] {
    if (severity === 'critical' && confidence >= THRESHOLD_FILE_CLAIM) {
        return 'escalate';
    }
    if (confidence >= THRESHOLD_FILE_CLAIM || (severity === 'high' && daysSince >= 30)) {
        return 'file_claim';
    }
    if (severity === 'medium' || daysSince >= MIN_WAIT_DAYS_CREDIT) {
        return 'investigate';
    }
    return 'monitor';
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch refund events with return status
 */
export async function fetchRefundEventsWithReturns(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<RefundEventData[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const events: RefundEventData[] = [];

    try {
        // Fetch from returns table with refund status
        const { data: returnsData, error: returnsError } = await supabaseAdmin
            .from('returns')
            .select('*')
            .eq('user_id', sellerId)
            .gte('return_date', cutoffDate.toISOString());

        if (!returnsError && returnsData) {
            for (const row of returnsData) {
                events.push({
                    id: row.id,
                    seller_id: sellerId,
                    order_id: row.order_id,
                    refund_date: row.return_date,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    refund_amount: Math.abs(parseFloat(row.refund_amount) || 0),
                    quantity: row.quantity || 1,
                    currency: row.currency || 'USD',
                    return_status: mapReturnStatus(row.status),
                    return_reason: row.reason,
                    return_tracking_id: row.tracking_id,
                    return_received_date: row.received_date
                });
            }
        }

        // Also check settlements for refunds
        const { data: settlementsData, error: settlementsError } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .in('transaction_type', ['refund', 'Refund'])
            .gte('settlement_date', cutoffDate.toISOString());

        if (!settlementsError && settlementsData) {
            for (const row of settlementsData) {
                // Check if we already have this order from returns
                const exists = events.some(e => e.order_id === row.order_id);
                if (!exists) {
                    events.push({
                        id: row.id,
                        seller_id: sellerId,
                        order_id: row.order_id,
                        refund_date: row.settlement_date,
                        sku: row.sku,
                        asin: row.asin,
                        fnsku: row.fnsku,
                        refund_amount: Math.abs(parseFloat(row.amount) || 0),
                        quantity: row.quantity || 1,
                        currency: row.currency || 'USD',
                        return_status: 'return_pending', // Default
                        return_reason: row.metadata?.return_reason
                    });
                }
            }
        }

        logger.info('👻 [PHANTOM] Fetched refund events', {
            sellerId,
            count: events.length
        });
    } catch (err: any) {
        logger.error('👻 [PHANTOM] Error fetching refund events', { error: err.message });
    }

    return events;
}

/**
 * Map return status strings
 */
function mapReturnStatus(status: string): ReturnStatus {
    const statusLower = (status || '').toLowerCase();

    if (statusLower.includes('received')) return 'return_received';
    if (statusLower.includes('delivered')) return 'return_delivered';
    if (statusLower.includes('transit')) return 'return_in_transit';
    if (statusLower.includes('no return') || statusLower.includes('keepit')) return 'no_return_required';
    if (statusLower.includes('pending')) return 'return_pending';

    return 'unknown';
}

/**
 * Fetch inventory adjustments
 */
export async function fetchInventoryAdjustmentsForPhantom(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<InventoryAdjustment[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const adjustments: InventoryAdjustment[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('inventory_adjustments')
            .select('*')
            .eq('seller_id', sellerId)
            .gte('adjustment_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                adjustments.push({
                    id: row.id,
                    seller_id: sellerId,
                    adjustment_date: row.adjustment_date,
                    sku: row.sku,
                    fnsku: row.fnsku,
                    adjustment_type: mapAdjustmentType(row.reason_code || row.adjustment_type),
                    quantity_delta: row.quantity || 0,
                    reason_code: row.reason_code,
                    reference_id: row.reference_id,
                    order_id: row.order_id
                });
            }
        }

        logger.info('👻 [PHANTOM] Fetched inventory adjustments', {
            sellerId,
            count: adjustments.length
        });
    } catch (err: any) {
        logger.error('👻 [PHANTOM] Error fetching adjustments', { error: err.message });
    }

    return adjustments;
}

/**
 * Map adjustment type strings
 */
function mapAdjustmentType(typeString: string): AdjustmentType {
    const typeLower = (typeString || '').toLowerCase();

    if (typeLower.includes('customer') && typeLower.includes('return')) return 'customer_return';
    if (typeLower.includes('damage')) return 'warehouse_damage';
    if (typeLower.includes('lost')) return 'warehouse_lost';
    if (typeLower.includes('found')) return 'found';
    if (typeLower.includes('removal')) return 'removal';
    if (typeLower.includes('disposed')) return 'disposed';

    return 'other';
}

/**
 * Store phantom refund results
 */
export async function storePhantomRefundResults(
    results: PhantomRefundResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'phantom_refund',
            severity: r.severity,
            estimated_value: r.phantom_loss_value,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                order_id: r.order_id,
                sku: r.sku,
                phantom_type: r.phantom_type,
                refunded_quantity: r.refunded_quantity,
                credited_quantity: r.credited_quantity,
                phantom_quantity: r.phantom_quantity,
                days_since_return: r.days_since_return,
                recommended_action: r.recommended_action,
                detection_reasons: r.evidence.detection_reasons,
                timeline: r.evidence.timeline
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('👻 [PHANTOM] Error storing results', { error: error.message });
        } else {
            logger.info('👻 [PHANTOM] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('👻 [PHANTOM] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Exports
// ============================================================================

export {
    THRESHOLD_SHOW_TO_USER,
    THRESHOLD_FILE_CLAIM,
    MIN_WAIT_DAYS_CREDIT,
    MAX_WAIT_DAYS_CREDIT
};
