/**
 * Refund Price Shortfall Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Fair Refund Pricing Intelligence
 * 
 * Amazon often refunds based on:
 * ❌ Lowest historical price
 * ❌ Incorrect pricing window
 * ❌ Ignoring MAP / protected pricing
 * ❌ Ignoring 90-day median
 * 
 * This detects wrong refund VALUE per return event.
 * (Different from underpayment algorithm which handles reimbursement amounts)
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
    return_date: string;
    sku: string;
    asin?: string;
    fnsku?: string;

    // Refund details
    refund_amount: number;
    quantity: number;
    refund_per_unit: number;
    currency: string;

    // Amazon's stated basis
    amazon_price_basis?: string;
    amazon_reference_date?: string;
}

export interface PriceHistory {
    seller_id: string;
    sku: string;
    asin?: string;

    // Rolling medians
    current_price?: number;
    median_30d: number;
    median_90d: number;
    median_180d?: number;

    // Price stability
    avg_30d: number;
    min_30d: number;
    max_30d: number;
    price_variance_30d: number;

    // Amazon listing
    buybox_price?: number;
    list_price?: number;

    // Sales data
    sample_count_30d: number;
    sample_count_90d: number;
    last_order_date?: string;

    // Quality metrics
    is_stable: boolean;
    stability_score: number;
}

export interface RefundPriceShortfallResult {
    seller_id: string;
    sync_id: string;

    // Event identification
    order_id: string;
    sku: string;
    asin?: string;
    return_date: string;

    // Pricing analysis
    amazon_refund_price: number;
    fair_refund_price: number;
    price_basis_used: PriceBasis;

    // Shortfall
    shortfall_per_unit: number;
    quantity: number;
    total_shortfall: number;
    shortfall_percentage: number;
    currency: string;

    // Pattern flags
    pattern_type: RefundPricePattern;
    is_systematic: boolean;

    // Severity
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Confidence
    confidence_score: number;
    confidence_factors: RefundPriceConfidenceFactors;

    // Recommendation
    recommended_action: 'monitor' | 'review' | 'dispute' | 'escalate';

    // Evidence
    evidence: {
        price_history: PriceHistorySummary;
        refund_event: RefundEvent;
        detection_reasons: string[];
        price_comparison: PriceComparison;
    };
}

export type PriceBasis =
    | 'current_price'     // Current listing price
    | 'median_30d'        // 30-day median (preferred)
    | 'median_90d'        // 90-day stabilized median
    | 'median_180d'       // Long-term fallback
    | 'buybox_price'      // Amazon buybox
    | 'list_price';       // MSRP / List price

export type RefundPricePattern =
    | 'race_to_bottom'        // Amazon using lowest historical
    | 'stale_snapshot'        // Old price reference
    | 'median_ignored'        // Didn't use median
    | 'timing_anomaly'        // Suspicious timing
    | 'systematic_down_bias'  // Consistent under-refunding
    | 'normal_variance';      // Within acceptable range

export interface RefundPriceConfidenceFactors {
    stable_sku_pricing: boolean;       // +0.30
    clear_price_basis: boolean;        // +0.25
    multiple_data_points: boolean;     // +0.20
    pattern_detected: boolean;         // +0.15
    recent_sales_data: boolean;        // +0.10
    calculated_score: number;
}

export interface PriceHistorySummary {
    median_30d: number;
    median_90d: number;
    min_30d: number;
    max_30d: number;
    stability_score: number;
    sample_count: number;
}

export interface PriceComparison {
    amazon_used: number;
    fair_value: number;
    difference: number;
    difference_percent: number;
    price_basis: PriceBasis;
}

export interface RefundPriceSyncedData {
    seller_id: string;
    sync_id: string;
    refund_events: RefundEvent[];
    price_history: Map<string, PriceHistory>;
}

// ============================================================================
// Constants
// ============================================================================

// Fair refund price hierarchy preferences
const PRICE_HIERARCHY: PriceBasis[] = [
    'current_price',
    'median_30d',
    'median_90d',
    'median_180d',
    'buybox_price',
    'list_price'
];

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_DISPUTE = 0.75;
const MIN_SHORTFALL_VALUE = 5; // $5 minimum

// Acceptable variance (beyond this = shortfall)
const ACCEPTABLE_VARIANCE_PERCENT = 0.10; // 10%

// Price stability threshold
const STABILITY_THRESHOLD = 0.15; // 15% variance = unstable

// Days for "current" price consideration
const CURRENT_PRICE_WINDOW_DAYS = 14;

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect refund price shortfalls
 */
export async function detectRefundPriceShortfall(
    sellerId: string,
    syncId: string,
    data: RefundPriceSyncedData
): Promise<RefundPriceShortfallResult[]> {
    const results: RefundPriceShortfallResult[] = [];

    logger.info('💵 [REFUND-PRICE] Starting refund price shortfall detection', {
        sellerId,
        syncId,
        refundEventCount: data.refund_events?.length || 0,
        priceHistoryCount: data.price_history?.size || 0
    });

    if (!data.refund_events || data.refund_events.length === 0) {
        logger.info('💵 [REFUND-PRICE] No refund events to analyze');
        return results;
    }

    // Analyze each refund event
    for (const refundEvent of data.refund_events) {
        try {
            const priceHistory = data.price_history.get(refundEvent.sku);

            if (!priceHistory) {
                continue; // No price data for this SKU
            }

            const detection = analyzeRefundPricing(
                sellerId,
                syncId,
                refundEvent,
                priceHistory
            );

            if (detection &&
                detection.total_shortfall >= MIN_SHORTFALL_VALUE &&
                detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                results.push(detection);
            }
        } catch (error: any) {
            logger.warn('💵 [REFUND-PRICE] Error analyzing refund event', {
                orderId: refundEvent.order_id,
                error: error.message
            });
        }
    }

    // Sort by total shortfall
    results.sort((a, b) => b.total_shortfall - a.total_shortfall);

    // Detect systematic patterns
    detectSystematicPatterns(results);

    const totalShortfall = results.reduce((sum, r) => sum + r.total_shortfall, 0);
    const systematicCount = results.filter(r => r.is_systematic).length;

    logger.info('💵 [REFUND-PRICE] Detection complete', {
        sellerId,
        eventsAnalyzed: data.refund_events.length,
        shortfallsFound: results.length,
        systematicCases: systematicCount,
        totalShortfall: totalShortfall.toFixed(2)
    });

    return results;
}

/**
 * Analyze a single refund event for price shortfall
 */
function analyzeRefundPricing(
    sellerId: string,
    syncId: string,
    refund: RefundEvent,
    priceHistory: PriceHistory
): RefundPriceShortfallResult | null {
    const detectionReasons: string[] = [];

    // Step 1: Determine "Fair Refund Basis Price"
    const fairPrice = determineFairRefundPrice(priceHistory, refund.return_date);

    if (!fairPrice.price || fairPrice.price <= 0) {
        return null;
    }

    // Step 2: Get Amazon's refund price
    const amazonRefundPrice = refund.refund_per_unit;

    if (!amazonRefundPrice || amazonRefundPrice <= 0) {
        return null;
    }

    // Step 3: Compute economic shortfall
    const shortfallPerUnit = fairPrice.price - amazonRefundPrice;
    const shortfallPercent = shortfallPerUnit / fairPrice.price;

    // Check if within acceptable variance
    if (shortfallPercent <= ACCEPTABLE_VARIANCE_PERCENT) {
        return null; // Within normal variance
    }

    const totalShortfall = shortfallPerUnit * refund.quantity;

    detectionReasons.push(
        `Fair refund price: $${fairPrice.price.toFixed(2)} (${fairPrice.basis})`,
        `Amazon refunded: $${amazonRefundPrice.toFixed(2)}`,
        `Shortfall: $${shortfallPerUnit.toFixed(2)} per unit (${(shortfallPercent * 100).toFixed(1)}%)`
    );

    // Step 4: Pattern recognition
    const patternType = classifyPattern(
        amazonRefundPrice,
        priceHistory,
        shortfallPercent
    );

    if (patternType !== 'normal_variance') {
        detectionReasons.push(`Pattern detected: ${patternType.replace(/_/g, ' ')}`);
    }

    // Step 5: Confidence model
    const confidence = calculateConfidence(priceHistory, patternType, shortfallPercent);

    // Determine severity
    const severity = determineSeverity(totalShortfall, shortfallPercent, patternType);

    // Determine recommended action
    const recommendedAction = determineAction(confidence.calculated_score, severity);

    // Build price comparison evidence
    const priceComparison: PriceComparison = {
        amazon_used: amazonRefundPrice,
        fair_value: fairPrice.price,
        difference: shortfallPerUnit,
        difference_percent: shortfallPercent * 100,
        price_basis: fairPrice.basis
    };

    // Build price history summary
    const priceHistorySummary: PriceHistorySummary = {
        median_30d: priceHistory.median_30d,
        median_90d: priceHistory.median_90d,
        min_30d: priceHistory.min_30d,
        max_30d: priceHistory.max_30d,
        stability_score: priceHistory.stability_score,
        sample_count: priceHistory.sample_count_30d
    };

    return {
        seller_id: sellerId,
        sync_id: syncId,

        order_id: refund.order_id,
        sku: refund.sku,
        asin: refund.asin,
        return_date: refund.return_date,

        amazon_refund_price: amazonRefundPrice,
        fair_refund_price: fairPrice.price,
        price_basis_used: fairPrice.basis,

        shortfall_per_unit: shortfallPerUnit,
        quantity: refund.quantity,
        total_shortfall: totalShortfall,
        shortfall_percentage: shortfallPercent * 100,
        currency: refund.currency,

        pattern_type: patternType,
        is_systematic: false, // Set by detectSystematicPatterns

        severity,

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        recommended_action: recommendedAction,

        evidence: {
            price_history: priceHistorySummary,
            refund_event: refund,
            detection_reasons: detectionReasons,
            price_comparison: priceComparison
        }
    };
}

// ============================================================================
// Fair Price Determination
// ============================================================================

/**
 * Determine fair refund basis price using hierarchy
 */
function determineFairRefundPrice(
    priceHistory: PriceHistory,
    returnDate: string
): { price: number; basis: PriceBasis } {
    const returnDateTime = new Date(returnDate);
    const now = new Date();
    const daysSinceReturn = Math.floor((now.getTime() - returnDateTime.getTime()) / (1000 * 60 * 60 * 24));

    // Hierarchy:
    // 1. Current price if within X days and stable
    if (priceHistory.current_price &&
        priceHistory.current_price > 0 &&
        daysSinceReturn <= CURRENT_PRICE_WINDOW_DAYS &&
        priceHistory.is_stable) {
        return { price: priceHistory.current_price, basis: 'current_price' };
    }

    // 2. 30-day median if sufficient data and stable
    if (priceHistory.median_30d > 0 &&
        priceHistory.sample_count_30d >= 5 &&
        priceHistory.is_stable) {
        return { price: priceHistory.median_30d, basis: 'median_30d' };
    }

    // 3. 90-day stabilized median as fallback
    if (priceHistory.median_90d > 0 && priceHistory.sample_count_90d >= 10) {
        return { price: priceHistory.median_90d, basis: 'median_90d' };
    }

    // 4. 180-day median for long-term stability
    if (priceHistory.median_180d && priceHistory.median_180d > 0) {
        return { price: priceHistory.median_180d, basis: 'median_180d' };
    }

    // 5. Buybox price
    if (priceHistory.buybox_price && priceHistory.buybox_price > 0) {
        return { price: priceHistory.buybox_price, basis: 'buybox_price' };
    }

    // 6. List price (MSRP) as last resort
    if (priceHistory.list_price && priceHistory.list_price > 0) {
        return { price: priceHistory.list_price, basis: 'list_price' };
    }

    // Fallback to 30d median even if unstable
    return { price: priceHistory.median_30d || 0, basis: 'median_30d' };
}

// ============================================================================
// Pattern Classification
// ============================================================================

/**
 * Classify the refund pricing pattern
 */
function classifyPattern(
    amazonPrice: number,
    priceHistory: PriceHistory,
    shortfallPercent: number
): RefundPricePattern {
    // Race to bottom: Amazon used the minimum
    if (Math.abs(amazonPrice - priceHistory.min_30d) < 0.50) {
        return 'race_to_bottom';
    }

    // Stale snapshot: Amazon price doesn't match any recent data
    const matchesCurrent = priceHistory.current_price &&
        Math.abs(amazonPrice - priceHistory.current_price) < 0.50;
    const matchesMedian = Math.abs(amazonPrice - priceHistory.median_30d) < 1.00;

    if (!matchesCurrent && !matchesMedian && shortfallPercent > 0.20) {
        return 'stale_snapshot';
    }

    // Median ignored: Clear median exists but wasn't used
    if (priceHistory.is_stable &&
        priceHistory.sample_count_30d >= 10 &&
        Math.abs(amazonPrice - priceHistory.median_30d) > 2.00) {
        return 'median_ignored';
    }

    // Timing anomaly: Significant deviation from expected
    if (shortfallPercent > 0.30) {
        return 'timing_anomaly';
    }

    return 'normal_variance';
}

/**
 * Detect systematic patterns across multiple results
 */
function detectSystematicPatterns(results: RefundPriceShortfallResult[]): void {
    if (results.length < 3) return;

    // Group by SKU
    const bySku = new Map<string, RefundPriceShortfallResult[]>();
    for (const result of results) {
        const existing = bySku.get(result.sku) || [];
        existing.push(result);
        bySku.set(result.sku, existing);
    }

    // Check for systematic down-bias per SKU
    for (const [sku, skuResults] of bySku) {
        if (skuResults.length >= 3) {
            // All shortfalls in same direction = systematic
            const allShortfall = skuResults.every(r => r.shortfall_per_unit > 0);
            if (allShortfall) {
                for (const result of skuResults) {
                    result.is_systematic = true;
                    result.pattern_type = 'systematic_down_bias';
                }
            }
        }
    }

    // Global pattern: more than 50% of results are shortfalls
    const shortfallRate = results.filter(r => r.shortfall_per_unit > 0).length / results.length;
    if (shortfallRate >= 0.5 && results.length >= 10) {
        for (const result of results) {
            if (!result.is_systematic) {
                result.is_systematic = true;
            }
        }
    }
}

// ============================================================================
// Confidence & Classification
// ============================================================================

/**
 * Calculate confidence score
 */
function calculateConfidence(
    priceHistory: PriceHistory,
    patternType: RefundPricePattern,
    shortfallPercent: number
): RefundPriceConfidenceFactors {
    let score = 0;

    // Stable SKU pricing (+0.30)
    const stablePricing = priceHistory.is_stable && priceHistory.stability_score >= 0.7;
    if (stablePricing) score += 0.30;

    // Clear price basis (+0.25)
    const clearBasis = priceHistory.sample_count_30d >= 5 ||
        (priceHistory.buybox_price && priceHistory.buybox_price > 0);
    if (clearBasis) score += 0.25;

    // Multiple data points (+0.20)
    const multipleDataPoints = priceHistory.sample_count_90d >= 10;
    if (multipleDataPoints) score += 0.20;

    // Pattern detected (+0.15)
    const patternDetected = patternType !== 'normal_variance';
    if (patternDetected) score += 0.15;

    // Recent sales data (+0.10)
    const recentSales = priceHistory.last_order_date &&
        (new Date().getTime() - new Date(priceHistory.last_order_date).getTime()) < 30 * 24 * 60 * 60 * 1000;
    if (recentSales) score += 0.10;

    // Boost for high shortfall with stable pricing
    if (stablePricing && shortfallPercent > 0.20) {
        score += 0.10;
    }

    return {
        stable_sku_pricing: stablePricing,
        clear_price_basis: clearBasis,
        multiple_data_points: multipleDataPoints,
        pattern_detected: patternDetected,
        recent_sales_data: !!recentSales,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Determine severity
 */
function determineSeverity(
    totalShortfall: number,
    shortfallPercent: number,
    patternType: RefundPricePattern
): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: High value or systematic pattern
    if (totalShortfall >= 50 ||
        (shortfallPercent > 0.30 && patternType === 'systematic_down_bias')) {
        return 'critical';
    }

    // High: Significant shortfall or clear pattern
    if (totalShortfall >= 25 || shortfallPercent > 0.25 ||
        patternType === 'race_to_bottom') {
        return 'high';
    }

    // Medium: Notable shortfall
    if (totalShortfall >= 10 || shortfallPercent > 0.15) {
        return 'medium';
    }

    return 'low';
}

/**
 * Determine recommended action
 */
function determineAction(
    confidence: number,
    severity: 'low' | 'medium' | 'high' | 'critical'
): RefundPriceShortfallResult['recommended_action'] {
    if (severity === 'critical' && confidence >= THRESHOLD_DISPUTE) {
        return 'escalate';
    }
    if (confidence >= THRESHOLD_DISPUTE || severity === 'high') {
        return 'dispute';
    }
    if (severity === 'medium') {
        return 'review';
    }
    return 'monitor';
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch refund events for analysis
 */
export async function fetchRefundEventsForPricing(
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
                const amount = Math.abs(parseFloat(row.amount) || 0);
                const qty = row.quantity || 1;

                events.push({
                    id: row.id,
                    seller_id: sellerId,
                    order_id: row.order_id,
                    return_date: row.settlement_date,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    refund_amount: amount,
                    quantity: qty,
                    refund_per_unit: qty > 0 ? amount / qty : amount,
                    currency: row.currency || 'USD'
                });
            }
        }

        logger.info('💵 [REFUND-PRICE] Fetched refund events', {
            sellerId,
            count: events.length
        });
    } catch (err: any) {
        logger.error('💵 [REFUND-PRICE] Error fetching refund events', { error: err.message });
    }

    return events;
}

/**
 * Fetch price history for SKUs
 */
export async function fetchPriceHistoryForRefunds(
    sellerId: string,
    skus: string[]
): Promise<Map<string, PriceHistory>> {
    const priceMap = new Map<string, PriceHistory>();

    if (skus.length === 0) return priceMap;

    try {
        const { data, error } = await supabaseAdmin
            .from('product_price_history')
            .select('*')
            .eq('seller_id', sellerId)
            .in('sku', skus);

        if (!error && data) {
            for (const row of data) {
                const variance = parseFloat(row.price_variance_30d) || 0;
                const median = parseFloat(row.median_sale_price_30d) || 0;
                const stabilityScore = median > 0 ? 1 - (variance / median) : 0.5;

                priceMap.set(row.sku, {
                    seller_id: sellerId,
                    sku: row.sku,
                    asin: row.asin,
                    current_price: parseFloat(row.buybox_price) || undefined,
                    median_30d: parseFloat(row.median_sale_price_30d) || 0,
                    median_90d: parseFloat(row.median_sale_price_90d) || 0,
                    median_180d: parseFloat(row.median_sale_price_180d) || undefined,
                    avg_30d: parseFloat(row.avg_sale_price_30d) || 0,
                    min_30d: parseFloat(row.min_sale_price_30d) || 0,
                    max_30d: parseFloat(row.max_sale_price_30d) || 0,
                    price_variance_30d: variance,
                    buybox_price: parseFloat(row.buybox_price) || undefined,
                    list_price: parseFloat(row.list_price) || undefined,
                    sample_count_30d: row.sample_count_30d || 0,
                    sample_count_90d: row.sample_count_90d || 0,
                    last_order_date: row.last_order_date,
                    is_stable: variance / (median || 1) <= STABILITY_THRESHOLD,
                    stability_score: Math.max(0, Math.min(1, stabilityScore))
                });
            }
        }

        logger.info('💵 [REFUND-PRICE] Fetched price history', {
            sellerId,
            skuCount: priceMap.size
        });
    } catch (err: any) {
        logger.error('💵 [REFUND-PRICE] Error fetching price history', { error: err.message });
    }

    return priceMap;
}

/**
 * Store refund price shortfall results
 */
export async function storeRefundPriceShortfallResults(
    results: RefundPriceShortfallResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'refund_price_shortfall',
            severity: r.severity,
            estimated_value: r.total_shortfall,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                order_id: r.order_id,
                sku: r.sku,
                amazon_refund_price: r.amazon_refund_price,
                fair_refund_price: r.fair_refund_price,
                price_basis: r.price_basis_used,
                shortfall_per_unit: r.shortfall_per_unit,
                shortfall_percentage: r.shortfall_percentage,
                pattern_type: r.pattern_type,
                is_systematic: r.is_systematic,
                recommended_action: r.recommended_action,
                detection_reasons: r.evidence.detection_reasons,
                price_comparison: r.evidence.price_comparison
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('💵 [REFUND-PRICE] Error storing results', { error: error.message });
        } else {
            logger.info('💵 [REFUND-PRICE] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('💵 [REFUND-PRICE] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Exports
// ============================================================================

export {
    THRESHOLD_SHOW_TO_USER,
    THRESHOLD_DISPUTE,
    PRICE_HIERARCHY,
    ACCEPTABLE_VARIANCE_PERCENT
};
