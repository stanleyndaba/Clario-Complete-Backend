/**
 * Reimbursement Underpayment Detection Algorithm
 * 
 * Agent 3: Discovery Agent - 2025 Reimbursement Overhaul Detection
 * 
 * Detects when Amazon underpays reimbursements by comparing:
 * - Actual reimbursement vs expected fair market value (median sale price)
 * - Actual reimbursement vs seller COGS
 * - Historical reimbursement patterns per SKU
 * 
 * Key Principles:
 * - Policy-aware (Amazon doesn't always pay retail)
 * - Evidence-based (no reckless false positives)
 * - Confidence-scored (only recommend filing at ≥0.75)
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ReimbursementEvent {
    id: string;
    seller_id: string;
    order_id?: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    quantity: number;
    reimbursement_amount: number;
    currency: string;
    reimbursement_date: string;
    reimbursement_type: string;
    reason?: string;
}

export interface ProductCost {
    sku: string;
    asin?: string;
    fnsku?: string;
    cogs_value: number;
    cost_currency: string;
    source: 'uploaded_invoice' | 'manual_input' | 'accounting_integration' | 'estimated';
    confidence_score: number;
    source_document_id?: string;
}

export interface ProductPriceHistory {
    sku: string;
    asin?: string;
    median_sale_price_30d?: number;
    median_sale_price_90d?: number;
    median_sale_price_180d?: number;
    avg_sale_price_30d?: number;
    min_sale_price_30d?: number;
    max_sale_price_30d?: number;
    buybox_price?: number;
    list_price?: number;
    sample_count_30d: number;
    sample_count_90d: number;
    price_variance_30d?: number;
    currency: string;
}

export interface UnderpaymentDetectionResult {
    seller_id: string;
    sync_id: string;
    reimbursement_id: string;
    order_id?: string;
    sku?: string;
    asin?: string;
    quantity: number;

    // Values
    actual_reimbursement: number;
    expected_fair_value: number;
    seller_cogs?: number;
    shortfall_amount: number;
    cogs_gap?: number;

    // Expected range
    expected_floor: number;
    expected_ceiling: number;

    // Detection flags
    is_below_floor: boolean;
    is_below_cogs: boolean;
    is_statistical_outlier: boolean;
    is_historically_underpaid: boolean;

    // Confidence
    confidence_score: number;
    confidence_factors: ConfidenceFactors;

    // Classification
    severity: 'low' | 'medium' | 'high' | 'critical';
    recommended_action: 'no_action' | 'review' | 'file_claim' | 'escalate';

    // Evidence
    evidence: {
        reimbursement_event: ReimbursementEvent;
        product_cost?: ProductCost;
        price_history?: ProductPriceHistory;
        detection_reasons: string[];
    };

    currency: string;
}

export interface ConfidenceFactors {
    cogs_available: boolean;        // +0.30
    invoice_proof_exists: boolean;  // +0.20
    median_price_stable: boolean;   // +0.20
    policy_supports_claim: boolean; // +0.20
    historical_higher: boolean;     // +0.10
    calculated_score: number;
}

export interface UnderpaymentSyncedData {
    seller_id: string;
    sync_id: string;
    reimbursement_events: ReimbursementEvent[];
}

// ============================================================================
// Constants
// ============================================================================

// Amazon typically reimburses "fair value", not always 100%
const EXPECTED_FLOOR_MULTIPLIER = 0.75;  // 75% of median is floor
const EXPECTED_CEILING_MULTIPLIER = 1.05; // 105% of median is ceiling

// Confidence thresholds
const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_RECOMMEND_FILING = 0.75;

// Confidence weights
const WEIGHT_COGS_AVAILABLE = 0.30;
const WEIGHT_INVOICE_PROOF = 0.20;
const WEIGHT_MEDIAN_STABLE = 0.20;
const WEIGHT_POLICY_SUPPORTS = 0.20;
const WEIGHT_HISTORICAL_HIGHER = 0.10;

// Category baseline prices (fallback when no data)
const CATEGORY_BASELINES: Record<string, number> = {
    'electronics': 50.00,
    'clothing': 25.00,
    'grocery': 15.00,
    'home': 35.00,
    'toys': 20.00,
    'default': 30.00
};

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect underpayments in reimbursement events
 */
export async function detectReimbursementUnderpayments(
    sellerId: string,
    syncId: string,
    data: UnderpaymentSyncedData
): Promise<UnderpaymentDetectionResult[]> {
    const results: UnderpaymentDetectionResult[] = [];

    logger.info('💰 [UNDERPAYMENT] Starting reimbursement underpayment detection', {
        sellerId,
        syncId,
        reimbursementCount: data.reimbursement_events?.length || 0
    });

    if (!data.reimbursement_events || data.reimbursement_events.length === 0) {
        logger.info('💰 [UNDERPAYMENT] No reimbursement events to analyze');
        return results;
    }

    // Fetch COGS data for seller
    const cogsMap = await fetchProductCosts(sellerId);
    logger.info('💰 [UNDERPAYMENT] Loaded COGS data', { skuCount: cogsMap.size });

    // Fetch price history for seller
    const priceHistoryMap = await fetchProductPriceHistory(sellerId);
    logger.info('💰 [UNDERPAYMENT] Loaded price history', { skuCount: priceHistoryMap.size });

    // Fetch historical reimbursements for comparison
    const historicalReimbMap = await fetchHistoricalReimbursements(sellerId);

    // Analyze each reimbursement event
    for (const event of data.reimbursement_events) {
        try {
            const detection = await analyzeReimbursementEvent(
                sellerId,
                syncId,
                event,
                cogsMap,
                priceHistoryMap,
                historicalReimbMap
            );

            if (detection && detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                results.push(detection);
            }
        } catch (error: any) {
            logger.warn('💰 [UNDERPAYMENT] Error analyzing event', {
                eventId: event.id,
                error: error.message
            });
        }
    }

    logger.info('💰 [UNDERPAYMENT] Detection complete', {
        sellerId,
        analyzed: data.reimbursement_events.length,
        detected: results.length,
        highSeverity: results.filter(r => r.severity === 'high' || r.severity === 'critical').length,
        totalShortfall: results.reduce((sum, r) => sum + r.shortfall_amount, 0)
    });

    return results;
}

/**
 * Analyze a single reimbursement event for underpayment
 */
async function analyzeReimbursementEvent(
    sellerId: string,
    syncId: string,
    event: ReimbursementEvent,
    cogsMap: Map<string, ProductCost>,
    priceHistoryMap: Map<string, ProductPriceHistory>,
    historicalReimbMap: Map<string, number[]>
): Promise<UnderpaymentDetectionResult | null> {

    const sku = event.sku || event.fnsku || event.asin;
    if (!sku) {
        logger.debug('💰 [UNDERPAYMENT] Skipping event without SKU identifier', { eventId: event.id });
        return null;
    }

    const actualReimb = event.reimbursement_amount * (event.quantity || 1);
    const detectionReasons: string[] = [];

    // =========================================================================
    // Step 1: Resolve Ground Truth Pricing
    // =========================================================================
    const priceHistory = priceHistoryMap.get(sku);
    const expectedFairValue = resolveExpectedFairValue(priceHistory, sku);
    const expectedFloor = expectedFairValue * EXPECTED_FLOOR_MULTIPLIER;
    const expectedCeiling = expectedFairValue * EXPECTED_CEILING_MULTIPLIER;

    // =========================================================================
    // Step 2: Factor COGS
    // =========================================================================
    const productCost = cogsMap.get(sku);
    const sellerCogs = productCost?.cogs_value;
    let cogsGap: number | undefined;
    let isBelowCogs = false;

    if (sellerCogs && actualReimb < sellerCogs) {
        isBelowCogs = true;
        cogsGap = sellerCogs - actualReimb;
        detectionReasons.push(`Reimbursement ($${actualReimb.toFixed(2)}) is below COGS ($${sellerCogs.toFixed(2)})`);
    }

    // =========================================================================
    // Step 3: Detect Suspicion Patterns
    // =========================================================================
    const isBelowFloor = actualReimb < expectedFloor;
    if (isBelowFloor) {
        detectionReasons.push(`Reimbursement ($${actualReimb.toFixed(2)}) is below 75% of fair value ($${expectedFloor.toFixed(2)})`);
    }

    const isStatisticalOutlier = detectStatisticalOutlier(actualReimb, priceHistory);
    if (isStatisticalOutlier) {
        detectionReasons.push('Reimbursement is a statistical outlier compared to price variance');
    }

    const historicalReimbs = historicalReimbMap.get(sku) || [];
    const isHistoricallyUnderpaid = detectHistoricalUnderpayment(actualReimb, historicalReimbs);
    if (isHistoricallyUnderpaid) {
        detectionReasons.push('Reimbursement is significantly lower than historical average for this SKU');
    }

    // =========================================================================
    // Step 4: Shortfall Calculation
    // =========================================================================
    const shortfallAmount = Math.max(0, expectedFairValue - actualReimb);

    // =========================================================================
    // Step 5: Confidence Scoring
    // =========================================================================
    const confidenceFactors = calculateConfidenceFactors(
        productCost,
        priceHistory,
        isHistoricallyUnderpaid
    );

    // Only return if we found an issue
    if (!isBelowFloor && !isBelowCogs && !isStatisticalOutlier && !isHistoricallyUnderpaid) {
        return null;
    }

    // Determine severity
    const severity = determineSeverity(isBelowCogs, cogsGap, shortfallAmount, confidenceFactors.calculated_score);

    // Determine recommended action
    const recommendedAction = determineRecommendedAction(confidenceFactors.calculated_score, severity);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        reimbursement_id: event.id,
        order_id: event.order_id,
        sku: event.sku,
        asin: event.asin,
        quantity: event.quantity || 1,

        actual_reimbursement: actualReimb,
        expected_fair_value: expectedFairValue,
        seller_cogs: sellerCogs,
        shortfall_amount: shortfallAmount,
        cogs_gap: cogsGap,

        expected_floor: expectedFloor,
        expected_ceiling: expectedCeiling,

        is_below_floor: isBelowFloor,
        is_below_cogs: isBelowCogs,
        is_statistical_outlier: isStatisticalOutlier,
        is_historically_underpaid: isHistoricallyUnderpaid,

        confidence_score: confidenceFactors.calculated_score,
        confidence_factors: confidenceFactors,

        severity,
        recommended_action: recommendedAction,

        evidence: {
            reimbursement_event: event,
            product_cost: productCost,
            price_history: priceHistory,
            detection_reasons: detectionReasons
        },

        currency: event.currency || 'USD'
    };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Step 1: Resolve expected fair value from available data
 */
function resolveExpectedFairValue(
    priceHistory: ProductPriceHistory | undefined,
    sku: string
): number {
    // Priority: 90d median > 180d median > 30d avg > buybox > list price > category baseline
    if (priceHistory) {
        if (priceHistory.median_sale_price_90d && priceHistory.sample_count_90d >= 5) {
            return priceHistory.median_sale_price_90d;
        }
        if (priceHistory.median_sale_price_180d) {
            return priceHistory.median_sale_price_180d;
        }
        if (priceHistory.avg_sale_price_30d && priceHistory.sample_count_30d >= 3) {
            return priceHistory.avg_sale_price_30d;
        }
        if (priceHistory.buybox_price) {
            return priceHistory.buybox_price;
        }
        if (priceHistory.list_price) {
            return priceHistory.list_price;
        }
    }

    // Fallback to category baseline
    return getCategoryBaseline(sku);
}

/**
 * Get category baseline price (fallback)
 */
function getCategoryBaseline(sku: string): number {
    // In a real implementation, we'd look up the product category
    // For now, use default
    return CATEGORY_BASELINES['default'];
}

/**
 * Detect if reimbursement is a statistical outlier
 */
function detectStatisticalOutlier(
    actualReimb: number,
    priceHistory: ProductPriceHistory | undefined
): boolean {
    if (!priceHistory || !priceHistory.price_variance_30d || !priceHistory.avg_sale_price_30d) {
        return false;
    }

    // Use 2 standard deviations as outlier threshold
    const stdDev = Math.sqrt(priceHistory.price_variance_30d);
    const lowerBound = priceHistory.avg_sale_price_30d - (2 * stdDev);

    return actualReimb < lowerBound * 0.75; // Below 75% of 2σ lower bound
}

/**
 * Detect if current reimbursement is historically underpaid
 */
function detectHistoricalUnderpayment(
    actualReimb: number,
    historicalReimbs: number[]
): boolean {
    if (historicalReimbs.length < 3) {
        return false;
    }

    const sorted = [...historicalReimbs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // Flag if current is 30%+ below historical median
    return actualReimb < median * 0.70;
}

/**
 * Step 5: Calculate confidence score
 */
function calculateConfidenceFactors(
    productCost: ProductCost | undefined,
    priceHistory: ProductPriceHistory | undefined,
    isHistoricallyUnderpaid: boolean
): ConfidenceFactors {
    let score = 0;

    // COGS available? +0.30
    const cogsAvailable = !!productCost && productCost.cogs_value > 0;
    if (cogsAvailable) score += WEIGHT_COGS_AVAILABLE;

    // Invoice proof exists? +0.20
    const invoiceProofExists = !!productCost?.source_document_id || productCost?.source === 'uploaded_invoice';
    if (invoiceProofExists) score += WEIGHT_INVOICE_PROOF;

    // Median sale price stable? +0.20
    const medianStable = priceHistory &&
        priceHistory.sample_count_90d >= 10 &&
        priceHistory.price_variance_30d !== undefined &&
        priceHistory.price_variance_30d < (priceHistory.avg_sale_price_30d || 100) * 0.3;
    if (medianStable) score += WEIGHT_MEDIAN_STABLE;

    // Policy supports claim? +0.20 (assume true if we have COGS and price data)
    const policySupports = cogsAvailable && !!priceHistory?.median_sale_price_90d;
    if (policySupports) score += WEIGHT_POLICY_SUPPORTS;

    // Historical reimbursements higher? +0.10
    if (isHistoricallyUnderpaid) score += WEIGHT_HISTORICAL_HIGHER;

    return {
        cogs_available: cogsAvailable,
        invoice_proof_exists: invoiceProofExists,
        median_price_stable: !!medianStable,
        policy_supports_claim: policySupports,
        historical_higher: isHistoricallyUnderpaid,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Determine severity based on detection results
 */
function determineSeverity(
    isBelowCogs: boolean,
    cogsGap: number | undefined,
    shortfallAmount: number,
    confidenceScore: number
): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: Below COGS with significant gap
    if (isBelowCogs && cogsGap && cogsGap > 20) {
        return 'critical';
    }

    // High: Below COGS or large shortfall with high confidence
    if (isBelowCogs || (shortfallAmount > 50 && confidenceScore >= 0.75)) {
        return 'high';
    }

    // Medium: Moderate shortfall
    if (shortfallAmount > 20 || confidenceScore >= 0.6) {
        return 'medium';
    }

    return 'low';
}

/**
 * Determine recommended action based on confidence and severity
 */
function determineRecommendedAction(
    confidenceScore: number,
    severity: 'low' | 'medium' | 'high' | 'critical'
): 'no_action' | 'review' | 'file_claim' | 'escalate' {
    if (confidenceScore >= THRESHOLD_RECOMMEND_FILING && (severity === 'high' || severity === 'critical')) {
        return severity === 'critical' ? 'escalate' : 'file_claim';
    }

    if (confidenceScore >= THRESHOLD_SHOW_TO_USER) {
        return 'review';
    }

    return 'no_action';
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch product costs (COGS) for seller
 */
async function fetchProductCosts(sellerId: string): Promise<Map<string, ProductCost>> {
    const map = new Map<string, ProductCost>();

    try {
        const { data, error } = await supabaseAdmin
            .from('product_costs')
            .select('*')
            .eq('seller_id', sellerId)
            .is('effective_date_end', null); // Only active costs

        if (error) {
            logger.warn('💰 [UNDERPAYMENT] Error fetching product costs', { error: error.message });
            return map;
        }

        for (const row of (data || [])) {
            const key = row.sku || row.fnsku || row.asin;
            if (key) {
                map.set(key, {
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    cogs_value: row.cogs_value,
                    cost_currency: row.cost_currency,
                    source: row.source,
                    confidence_score: row.confidence_score,
                    source_document_id: row.source_document_id
                });
            }
        }
    } catch (err: any) {
        logger.error('💰 [UNDERPAYMENT] Exception fetching product costs', { error: err.message });
    }

    return map;
}

/**
 * Fetch product price history for seller
 */
async function fetchProductPriceHistory(sellerId: string): Promise<Map<string, ProductPriceHistory>> {
    const map = new Map<string, ProductPriceHistory>();

    try {
        const { data, error } = await supabaseAdmin
            .from('product_price_history')
            .select('*')
            .eq('seller_id', sellerId);

        if (error) {
            logger.warn('💰 [UNDERPAYMENT] Error fetching price history', { error: error.message });
            return map;
        }

        for (const row of (data || [])) {
            const key = row.sku || row.fnsku || row.asin;
            if (key) {
                map.set(key, {
                    sku: row.sku,
                    asin: row.asin,
                    median_sale_price_30d: row.median_sale_price_30d,
                    median_sale_price_90d: row.median_sale_price_90d,
                    median_sale_price_180d: row.median_sale_price_180d,
                    avg_sale_price_30d: row.avg_sale_price_30d,
                    min_sale_price_30d: row.min_sale_price_30d,
                    max_sale_price_30d: row.max_sale_price_30d,
                    buybox_price: row.buybox_price,
                    list_price: row.list_price,
                    sample_count_30d: row.sample_count_30d || 0,
                    sample_count_90d: row.sample_count_90d || 0,
                    price_variance_30d: row.price_variance_30d,
                    currency: row.currency || 'USD'
                });
            }
        }
    } catch (err: any) {
        logger.error('💰 [UNDERPAYMENT] Exception fetching price history', { error: err.message });
    }

    return map;
}

/**
 * Fetch historical reimbursements for comparison
 */
async function fetchHistoricalReimbursements(sellerId: string): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();

    try {
        // Get reimbursements from last 180 days
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 180);

        const { data, error } = await supabaseAdmin
            .from('settlements')
            .select('sku, amount')
            .eq('user_id', sellerId)
            .eq('transaction_type', 'reimbursement')
            .gte('settlement_date', cutoffDate.toISOString())
            .not('sku', 'is', null);

        if (error) {
            logger.warn('💰 [UNDERPAYMENT] Error fetching historical reimbursements', { error: error.message });
            return map;
        }

        for (const row of (data || [])) {
            if (row.sku && row.amount) {
                const existing = map.get(row.sku) || [];
                existing.push(parseFloat(row.amount));
                map.set(row.sku, existing);
            }
        }
    } catch (err: any) {
        logger.error('💰 [UNDERPAYMENT] Exception fetching historical reimbursements', { error: err.message });
    }

    return map;
}

/**
 * Store detection results in reimbursement_analysis table
 */
export async function storeUnderpaymentResults(
    results: UnderpaymentDetectionResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            reimbursement_id: r.reimbursement_id,
            order_id: r.order_id,
            sku: r.sku,
            asin: r.asin,
            quantity: r.quantity,
            actual_reimbursement: r.actual_reimbursement,
            expected_fair_value: r.expected_fair_value,
            seller_cogs: r.seller_cogs,
            expected_floor: r.expected_floor,
            expected_ceiling: r.expected_ceiling,
            shortfall_amount: r.shortfall_amount,
            cogs_gap: r.cogs_gap,
            is_below_floor: r.is_below_floor,
            is_below_cogs: r.is_below_cogs,
            is_statistical_outlier: r.is_statistical_outlier,
            is_historically_underpaid: r.is_historically_underpaid,
            confidence_score: r.confidence_score,
            confidence_factors: r.confidence_factors,
            severity: r.severity,
            recommended_action: r.recommended_action,
            currency: r.currency,
            status: 'detected'
        }));

        const { error } = await supabaseAdmin
            .from('reimbursement_analysis')
            .upsert(records, { onConflict: 'seller_id,reimbursement_id' });

        if (error) {
            logger.error('💰 [UNDERPAYMENT] Error storing results', { error: error.message });
        } else {
            logger.info('💰 [UNDERPAYMENT] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('💰 [UNDERPAYMENT] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Missing Documentation Detection
// ============================================================================

/**
 * Detect sellers missing COGS/invoice data
 * Returns alert for users to upload documentation
 */
export async function detectMissingDocumentation(
    sellerId: string
): Promise<{
    hasCogs: boolean;
    hasInvoices: boolean;
    skusWithoutCogs: number;
    totalSkus: number;
    potentialRecoveryAtRisk: number;
    alertMessage?: string;
}> {
    try {
        // Get count of SKUs with COGS
        const { count: cogsCount } = await supabaseAdmin
            .from('product_costs')
            .select('*', { count: 'exact', head: true })
            .eq('seller_id', sellerId);

        // Get count of SKUs with invoices
        const { count: invoiceCount } = await supabaseAdmin
            .from('product_costs')
            .select('*', { count: 'exact', head: true })
            .eq('seller_id', sellerId)
            .eq('source', 'uploaded_invoice');

        // Get total unique SKUs from orders
        const { count: totalSkus } = await supabaseAdmin
            .from('orders')
            .select('sku', { count: 'exact', head: true })
            .eq('user_id', sellerId);

        // Estimate potential recovery at risk (based on missing COGS)
        const skusWithoutCogs = Math.max(0, (totalSkus || 0) - (cogsCount || 0));
        const potentialRecoveryAtRisk = skusWithoutCogs * 25; // Estimate $25 per SKU

        const hasCogs = (cogsCount || 0) > 0;
        const hasInvoices = (invoiceCount || 0) > 0;

        let alertMessage: string | undefined;
        if (!hasCogs) {
            alertMessage = `You have no COGS data uploaded. Upload product costs to unlock potential recovery opportunities worth an estimated $${potentialRecoveryAtRisk.toFixed(0)}+.`;
        } else if (skusWithoutCogs > 5) {
            alertMessage = `${skusWithoutCogs} SKUs are missing COGS data. Upload costs for better reimbursement detection.`;
        }

        return {
            hasCogs,
            hasInvoices,
            skusWithoutCogs,
            totalSkus: totalSkus || 0,
            potentialRecoveryAtRisk,
            alertMessage
        };
    } catch (err: any) {
        logger.error('💰 [UNDERPAYMENT] Error checking documentation', { error: err.message });
        return {
            hasCogs: false,
            hasInvoices: false,
            skusWithoutCogs: 0,
            totalSkus: 0,
            potentialRecoveryAtRisk: 0
        };
    }
}

// ============================================================================
// Exports
// ============================================================================

export {
    detectReimbursementUnderpayments,
    THRESHOLD_SHOW_TO_USER,
    THRESHOLD_RECOMMEND_FILING
};
