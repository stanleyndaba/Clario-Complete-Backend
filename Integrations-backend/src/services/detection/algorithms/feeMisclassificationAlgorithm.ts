/**
 * Fee Misclassification Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Size/Storage/Fee Tier Analysis
 * 
 * Amazon sometimes:
 * - Classifies wrong size tier (Small Standard vs Large Standard vs Oversize)
 * - Applies wrong storage tier (Standard vs Dangerous Goods)
 * - Charges wrong pick/pack band
 * - Uses incorrect weight for dimensional weight calculation
 * 
 * This detects recurring fee leakage that compounds over time.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ProductDimensions {
    sku: string;
    asin?: string;
    fnsku?: string;
    product_name?: string;

    // Physical dimensions (inches for US)
    length: number;
    width: number;
    height: number;
    weight_oz: number; // Ounces

    // Derived
    dimensional_weight_oz?: number;
    billable_weight_oz?: number;

    // Amazon's classification
    amazon_size_tier?: string;
    amazon_product_tier?: string;

    // Source
    source: 'api' | 'manual' | 'catalog' | 'calculated';
    last_updated?: string;
}

export interface FeeTransaction {
    id: string;
    seller_id: string;
    transaction_date: string;
    sku: string;
    asin?: string;
    fnsku?: string;
    order_id?: string;

    // Fee details
    fee_type: FeeType;
    fee_amount: number;
    currency: string;

    // Amazon's stated basis
    stated_size_tier?: string;
    stated_weight_tier?: string;
    stated_storage_type?: string;

    quantity: number;
}

export type FeeType =
    | 'FBAPerUnitFulfillmentFee'
    | 'FBAPickAndPackFee'
    | 'FBAWeightHandlingFee'
    | 'FBAStorageFee'
    | 'FBALongTermStorageFee'
    | 'FBAReferralFee'
    | 'FBARemovalFee'
    | 'FBADisposalFee';

export interface FeeMisclassificationResult {
    seller_id: string;
    sync_id: string;
    sku: string;
    asin?: string;

    // Misclassification type
    misclass_type: MisclassificationType;
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Tier analysis
    expected_tier: string;
    amazon_charged_tier: string;
    tier_difference: string;

    // Financial impact
    expected_fee_per_unit: number;
    charged_fee_per_unit: number;
    overcharge_per_unit: number;

    // Scale
    affected_transactions: number;
    total_overcharge: number;
    projected_monthly_savings: number;
    projected_annual_savings: number;
    currency: string;

    // Recurrence
    is_recurring: boolean;
    first_occurrence: string;
    last_occurrence: string;
    days_active: number;

    // Confidence
    confidence_score: number;
    confidence_factors: FeeConfidenceFactors;

    // Recommendation
    recommended_action: 'monitor' | 'dispute_classification' | 'file_refund' | 'request_remeasurement';
    estimated_refund: number;

    // Evidence
    evidence: {
        product_dimensions?: ProductDimensions;
        sample_transactions: FeeTransaction[];
        expected_fee_breakdown: FeeBreakdown;
        charged_fee_breakdown: FeeBreakdown;
        detection_reasons: string[];
    };
}

export type MisclassificationType =
    | 'size_tier_overcharge'      // Wrong size tier (standard vs oversize)
    | 'weight_tier_overcharge'    // Wrong weight band
    | 'storage_tier_overcharge'   // Standard charged as dangerous goods
    | 'dimensional_weight_error'  // Wrong dimensional weight calculation
    | 'pick_pack_overcharge'      // Wrong pick/pack fee band
    | 'category_referral_error';  // Wrong category referral fee

export interface FeeConfidenceFactors {
    dimensions_verified: boolean;    // +0.30
    multiple_occurrences: boolean;   // +0.25
    clear_tier_mismatch: boolean;    // +0.25
    historical_pattern: boolean;     // +0.10
    amazon_data_matches: boolean;    // +0.10
    calculated_score: number;
}

export interface FeeBreakdown {
    base_fee: number;
    weight_fee: number;
    size_surcharge: number;
    total: number;
    tier_used: string;
    weight_used_oz: number;
}

export interface FeeMisclassSyncedData {
    seller_id: string;
    sync_id: string;
    dimensions: ProductDimensions[];
    fee_transactions: FeeTransaction[];
}

// ============================================================================
// Amazon FBA Fee Structure (2024-2025 US Rates)
// ============================================================================

// Size tier definitions (dimensions in inches, weight in oz)
const SIZE_TIERS = {
    SMALL_STANDARD: {
        name: 'Small Standard',
        maxLength: 15,
        maxWidth: 12,
        maxHeight: 0.75,
        maxWeight: 16, // 1 lb
        baseFee: 3.22
    },
    LARGE_STANDARD: {
        name: 'Large Standard',
        maxLength: 18,
        maxWidth: 14,
        maxHeight: 8,
        maxWeight: 320, // 20 lbs
        baseFee: 4.75
    },
    SMALL_OVERSIZE: {
        name: 'Small Oversize',
        maxLength: 60,
        maxWidth: 30,
        maxGirth: 130,
        maxWeight: 1120, // 70 lbs
        baseFee: 9.73
    },
    MEDIUM_OVERSIZE: {
        name: 'Medium Oversize',
        maxLength: 108,
        maxGirth: 130,
        maxWeight: 2240, // 150 lbs
        baseFee: 19.05
    },
    LARGE_OVERSIZE: {
        name: 'Large Oversize',
        maxLength: 108,
        maxGirth: 165,
        maxWeight: 2240, // 150 lbs
        baseFee: 89.98
    },
    SPECIAL_OVERSIZE: {
        name: 'Special Oversize',
        maxWeight: 2240,
        baseFee: 158.49
    }
};

// Weight handling fees per oz above base (simplified)
const WEIGHT_FEES = {
    SMALL_STANDARD: { perOz: 0.03, baseOz: 4 },
    LARGE_STANDARD: { perOz: 0.05, baseOz: 16 },
    SMALL_OVERSIZE: { perOz: 0.08, baseOz: 16 },
    MEDIUM_OVERSIZE: { perOz: 0.08, baseOz: 16 },
    LARGE_OVERSIZE: { perOz: 0.08, baseOz: 16 }
};

// Storage fee rates (per cubic foot per month)
const STORAGE_RATES = {
    STANDARD: {
        janSep: 0.87,
        octDec: 2.40
    },
    DANGEROUS_GOODS: {
        janSep: 0.99,
        octDec: 3.63
    }
};

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.60;
const THRESHOLD_RECOMMEND_ACTION = 0.75;
const MIN_OVERCHARGE_VALUE = 5; // Minimum to report

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect fee misclassifications
 */
export async function detectFeeMisclassification(
    sellerId: string,
    syncId: string,
    data: FeeMisclassSyncedData
): Promise<FeeMisclassificationResult[]> {
    const results: FeeMisclassificationResult[] = [];

    logger.info('💲 [FEE-MISCLASS] Starting fee misclassification detection', {
        sellerId,
        syncId,
        dimensionCount: data.dimensions?.length || 0,
        transactionCount: data.fee_transactions?.length || 0
    });

    if (!data.dimensions || data.dimensions.length === 0) {
        logger.info('💲 [FEE-MISCLASS] No product dimensions available for analysis');
        return results;
    }

    // Build dimension lookup
    const dimensionsBySku = new Map<string, ProductDimensions>();
    for (const dim of data.dimensions) {
        dimensionsBySku.set(dim.sku, dim);
    }

    // Group transactions by SKU
    const transactionsBySku = groupTransactionsBySku(data.fee_transactions || []);
    logger.info('💲 [FEE-MISCLASS] Grouped transactions', {
        skuCount: transactionsBySku.size
    });

    // Analyze each SKU with dimensions
    for (const [sku, dimensions] of dimensionsBySku) {
        try {
            const transactions = transactionsBySku.get(sku) || [];
            if (transactions.length === 0) continue;

            const detection = analyzeSkuForMisclassification(
                sellerId,
                syncId,
                sku,
                dimensions,
                transactions
            );

            if (detection &&
                detection.total_overcharge >= MIN_OVERCHARGE_VALUE &&
                detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                results.push(detection);
            }
        } catch (error: any) {
            logger.warn('💲 [FEE-MISCLASS] Error analyzing SKU', {
                sku,
                error: error.message
            });
        }
    }

    // Sort by total overcharge
    results.sort((a, b) => b.total_overcharge - a.total_overcharge);

    const totalOvercharge = results.reduce((sum, r) => sum + r.total_overcharge, 0);
    const projectedAnnualSavings = results.reduce((sum, r) => sum + r.projected_annual_savings, 0);

    logger.info('💲 [FEE-MISCLASS] Detection complete', {
        sellerId,
        skusAnalyzed: dimensionsBySku.size,
        misclassificationsFound: results.length,
        totalOvercharge: totalOvercharge.toFixed(2),
        projectedAnnualSavings: projectedAnnualSavings.toFixed(2)
    });

    return results;
}

/**
 * Analyze a single SKU for fee misclassification
 */
function analyzeSkuForMisclassification(
    sellerId: string,
    syncId: string,
    sku: string,
    dimensions: ProductDimensions,
    transactions: FeeTransaction[]
): FeeMisclassificationResult | null {
    const detectionReasons: string[] = [];

    // Step 1: Derive correct size tier from dimensions
    const correctTier = deriveSizeTier(dimensions);

    // Step 2: Get Amazon's charged tier from transactions
    const amazonTier = getAmazonChargedTier(transactions);

    if (!correctTier || !amazonTier) {
        return null;
    }

    // Step 3: Check for tier mismatch
    if (correctTier.name === amazonTier) {
        return null; // No misclassification
    }

    // Step 4: Determine misclassification type
    const misclassType = classifyMismatch(correctTier.name, amazonTier);

    // Step 5: Calculate expected vs charged fees
    const expectedFee = calculateExpectedFee(dimensions, correctTier);
    const chargedFee = calculateChargedFee(transactions);
    const overchargePerUnit = chargedFee.per_unit - expectedFee.per_unit;

    if (overchargePerUnit <= 0) {
        return null; // Actually undercharged or correct
    }

    detectionReasons.push(
        `Product dimensions indicate ${correctTier.name} tier`,
        `Amazon charging as ${amazonTier} tier`,
        `Overcharge: $${overchargePerUnit.toFixed(2)} per unit`
    );

    // Step 6: Calculate scale of impact
    const totalUnits = transactions.reduce((sum, t) => sum + t.quantity, 0);
    const totalOvercharge = overchargePerUnit * totalUnits;

    // Calculate time range
    const dates = transactions.map(t => new Date(t.transaction_date).getTime());
    const firstOccurrence = new Date(Math.min(...dates)).toISOString();
    const lastOccurrence = new Date(Math.max(...dates)).toISOString();
    const daysActive = Math.ceil((Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24));

    // Project savings
    const avgDailyOvercharge = daysActive > 0 ? totalOvercharge / daysActive : totalOvercharge;
    const projectedMonthly = avgDailyOvercharge * 30;
    const projectedAnnual = avgDailyOvercharge * 365;

    const isRecurring = transactions.length >= 3 && daysActive >= 7;

    // Step 7: Calculate confidence
    const confidence = calculateMisclassConfidence(
        dimensions,
        transactions,
        correctTier.name,
        amazonTier,
        isRecurring
    );

    // Step 8: Determine severity and action
    const severity = determineSeverity(totalOvercharge, projectedAnnual, isRecurring);
    const recommendedAction = determineAction(confidence.calculated_score, severity, totalOvercharge);

    // Build evidence
    const sampleTransactions = transactions.slice(0, 5);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        sku,
        asin: dimensions.asin,

        misclass_type: misclassType,
        severity,

        expected_tier: correctTier.name,
        amazon_charged_tier: amazonTier,
        tier_difference: `${correctTier.name} → ${amazonTier}`,

        expected_fee_per_unit: expectedFee.per_unit,
        charged_fee_per_unit: chargedFee.per_unit,
        overcharge_per_unit: overchargePerUnit,

        affected_transactions: transactions.length,
        total_overcharge: totalOvercharge,
        projected_monthly_savings: projectedMonthly,
        projected_annual_savings: projectedAnnual,
        currency: 'USD',

        is_recurring: isRecurring,
        first_occurrence: firstOccurrence,
        last_occurrence: lastOccurrence,
        days_active: daysActive,

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        recommended_action: recommendedAction,
        estimated_refund: totalOvercharge,

        evidence: {
            product_dimensions: dimensions,
            sample_transactions: sampleTransactions,
            expected_fee_breakdown: {
                base_fee: expectedFee.base,
                weight_fee: expectedFee.weight,
                size_surcharge: 0,
                total: expectedFee.per_unit,
                tier_used: correctTier.name,
                weight_used_oz: dimensions.billable_weight_oz || dimensions.weight_oz
            },
            charged_fee_breakdown: {
                base_fee: chargedFee.base,
                weight_fee: chargedFee.weight,
                size_surcharge: chargedFee.surcharge,
                total: chargedFee.per_unit,
                tier_used: amazonTier,
                weight_used_oz: dimensions.weight_oz
            },
            detection_reasons: detectionReasons
        }
    };
}

// ============================================================================
// Size Tier Calculation
// ============================================================================

/**
 * Derive correct size tier from product dimensions
 */
function deriveSizeTier(dimensions: ProductDimensions): { name: string; baseFee: number; maxWeight: number } | null {
    const { length, width, height, weight_oz } = dimensions;

    // Sort dimensions (longest first)
    const sorted = [length, width, height].sort((a, b) => b - a);
    const [longest, median, shortest] = sorted;

    // Calculate girth (for oversize)
    const girth = 2 * (median + shortest) + longest;

    // Calculate dimensional weight (DIM factor: 139 for standard, 166 for oversize)
    const cubicInches = longest * median * shortest;
    const dimWeightStandard = (cubicInches / 139) * 16; // Convert to oz
    const dimWeightOversize = (cubicInches / 166) * 16;

    // Billable weight is greater of actual or dimensional
    const billableWeight = Math.max(weight_oz, dimWeightStandard);
    dimensions.dimensional_weight_oz = dimWeightStandard;
    dimensions.billable_weight_oz = billableWeight;

    // Check Small Standard
    if (longest <= SIZE_TIERS.SMALL_STANDARD.maxLength &&
        median <= SIZE_TIERS.SMALL_STANDARD.maxWidth &&
        shortest <= SIZE_TIERS.SMALL_STANDARD.maxHeight &&
        billableWeight <= SIZE_TIERS.SMALL_STANDARD.maxWeight) {
        return SIZE_TIERS.SMALL_STANDARD;
    }

    // Check Large Standard
    if (longest <= SIZE_TIERS.LARGE_STANDARD.maxLength &&
        median <= SIZE_TIERS.LARGE_STANDARD.maxWidth &&
        shortest <= SIZE_TIERS.LARGE_STANDARD.maxHeight &&
        billableWeight <= SIZE_TIERS.LARGE_STANDARD.maxWeight) {
        return SIZE_TIERS.LARGE_STANDARD;
    }

    // Check Small Oversize
    if (longest <= SIZE_TIERS.SMALL_OVERSIZE.maxLength &&
        (median + shortest) * 2 + longest <= SIZE_TIERS.SMALL_OVERSIZE.maxGirth! &&
        weight_oz <= SIZE_TIERS.SMALL_OVERSIZE.maxWeight) {
        return SIZE_TIERS.SMALL_OVERSIZE;
    }

    // Check Medium Oversize
    if (longest <= SIZE_TIERS.MEDIUM_OVERSIZE.maxLength &&
        girth <= SIZE_TIERS.MEDIUM_OVERSIZE.maxGirth! &&
        weight_oz <= SIZE_TIERS.MEDIUM_OVERSIZE.maxWeight) {
        return SIZE_TIERS.MEDIUM_OVERSIZE;
    }

    // Check Large Oversize
    if (longest <= SIZE_TIERS.LARGE_OVERSIZE.maxLength &&
        girth <= SIZE_TIERS.LARGE_OVERSIZE.maxGirth! &&
        weight_oz <= SIZE_TIERS.LARGE_OVERSIZE.maxWeight) {
        return SIZE_TIERS.LARGE_OVERSIZE;
    }

    // Special Oversize
    return SIZE_TIERS.SPECIAL_OVERSIZE;
}

/**
 * Get Amazon's charged tier from transactions
 */
function getAmazonChargedTier(transactions: FeeTransaction[]): string | null {
    // Look for stated size tier in transactions
    for (const tx of transactions) {
        if (tx.stated_size_tier) {
            return tx.stated_size_tier;
        }
    }

    // Infer from fee amounts
    const avgFee = transactions.reduce((sum, t) => sum + t.fee_amount, 0) / transactions.length;

    if (avgFee <= 3.50) return 'Small Standard';
    if (avgFee <= 5.50) return 'Large Standard';
    if (avgFee <= 12.00) return 'Small Oversize';
    if (avgFee <= 25.00) return 'Medium Oversize';
    if (avgFee <= 100.00) return 'Large Oversize';
    return 'Special Oversize';
}

/**
 * Classify the type of mismatch
 */
function classifyMismatch(correctTier: string, amazonTier: string): MisclassificationType {
    const isOversize = (tier: string) => tier.includes('Oversize');
    const isStandard = (tier: string) => tier.includes('Standard');

    // Standard to Oversize = major size tier overcharge
    if (isStandard(correctTier) && isOversize(amazonTier)) {
        return 'size_tier_overcharge';
    }

    // Small to Large within same category
    if (correctTier.includes('Small') && amazonTier.includes('Large')) {
        return 'size_tier_overcharge';
    }

    // Weight tier issues
    if (correctTier === amazonTier) {
        return 'weight_tier_overcharge';
    }

    return 'size_tier_overcharge';
}

// ============================================================================
// Fee Calculation
// ============================================================================

/**
 * Calculate expected fee based on dimensions
 */
function calculateExpectedFee(
    dimensions: ProductDimensions,
    tier: { name: string; baseFee: number; maxWeight: number }
): { per_unit: number; base: number; weight: number } {
    const baseFee = tier.baseFee;

    // Calculate weight fee
    let weightFee = 0;
    const tierKey = tier.name.replace(' ', '_').toUpperCase() as keyof typeof WEIGHT_FEES;
    const weightConfig = WEIGHT_FEES[tierKey];

    if (weightConfig) {
        const billableWeight = dimensions.billable_weight_oz || dimensions.weight_oz;
        const excessWeight = Math.max(0, billableWeight - weightConfig.baseOz);
        weightFee = excessWeight * weightConfig.perOz;
    }

    return {
        per_unit: baseFee + weightFee,
        base: baseFee,
        weight: weightFee
    };
}

/**
 * Calculate charged fee from transactions
 */
function calculateChargedFee(
    transactions: FeeTransaction[]
): { per_unit: number; base: number; weight: number; surcharge: number } {
    const fulfillmentFees = transactions.filter(t =>
        t.fee_type === 'FBAPerUnitFulfillmentFee' ||
        t.fee_type === 'FBAPickAndPackFee'
    );

    if (fulfillmentFees.length === 0) {
        return { per_unit: 0, base: 0, weight: 0, surcharge: 0 };
    }

    const totalFee = fulfillmentFees.reduce((sum, t) => sum + Math.abs(t.fee_amount), 0);
    const totalQty = fulfillmentFees.reduce((sum, t) => sum + t.quantity, 0);
    const perUnit = totalQty > 0 ? totalFee / totalQty : 0;

    return {
        per_unit: perUnit,
        base: perUnit * 0.7, // Estimate
        weight: perUnit * 0.3,
        surcharge: 0
    };
}

// ============================================================================
// Confidence & Classification
// ============================================================================

/**
 * Calculate confidence score
 */
function calculateMisclassConfidence(
    dimensions: ProductDimensions,
    transactions: FeeTransaction[],
    correctTier: string,
    amazonTier: string,
    isRecurring: boolean
): FeeConfidenceFactors {
    let score = 0;

    // Dimensions verified
    const dimensionsVerified = dimensions.source !== 'calculated' &&
        dimensions.length > 0 && dimensions.width > 0 && dimensions.height > 0;
    if (dimensionsVerified) score += 0.30;

    // Multiple occurrences
    const multipleOccurrences = transactions.length >= 5;
    if (multipleOccurrences) score += 0.25;

    // Clear tier mismatch
    const clearMismatch = correctTier !== amazonTier;
    if (clearMismatch) score += 0.25;

    // Historical pattern
    const historicalPattern = isRecurring;
    if (historicalPattern) score += 0.10;

    // Amazon data matches
    const amazonDataMatches = transactions.some(t => t.stated_size_tier);
    if (amazonDataMatches) score += 0.10;

    return {
        dimensions_verified: dimensionsVerified,
        multiple_occurrences: multipleOccurrences,
        clear_tier_mismatch: clearMismatch,
        historical_pattern: historicalPattern,
        amazon_data_matches: amazonDataMatches,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Determine severity
 */
function determineSeverity(
    totalOvercharge: number,
    projectedAnnual: number,
    isRecurring: boolean
): 'low' | 'medium' | 'high' | 'critical' {
    if (projectedAnnual >= 1000 || (totalOvercharge >= 100 && isRecurring)) {
        return 'critical';
    }
    if (projectedAnnual >= 500 || totalOvercharge >= 50) {
        return 'high';
    }
    if (projectedAnnual >= 100 || totalOvercharge >= 20) {
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
    totalOvercharge: number
): FeeMisclassificationResult['recommended_action'] {
    if (severity === 'critical' && confidence >= THRESHOLD_RECOMMEND_ACTION) {
        return 'request_remeasurement';
    }
    if (severity === 'high' || totalOvercharge >= 50) {
        return 'dispute_classification';
    }
    if (confidence >= THRESHOLD_RECOMMEND_ACTION) {
        return 'file_refund';
    }
    return 'monitor';
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group transactions by SKU
 */
function groupTransactionsBySku(transactions: FeeTransaction[]): Map<string, FeeTransaction[]> {
    const map = new Map<string, FeeTransaction[]>();

    for (const tx of transactions) {
        const existing = map.get(tx.sku) || [];
        existing.push(tx);
        map.set(tx.sku, existing);
    }

    return map;
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch product dimensions
 */
export async function fetchProductDimensions(
    sellerId: string
): Promise<ProductDimensions[]> {
    const dimensions: ProductDimensions[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('product_catalog')
            .select('*')
            .eq('seller_id', sellerId)
            .not('length', 'is', null);

        if (!error && data) {
            for (const row of data) {
                dimensions.push({
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    product_name: row.product_name,
                    length: parseFloat(row.length) || 0,
                    width: parseFloat(row.width) || 0,
                    height: parseFloat(row.height) || 0,
                    weight_oz: (parseFloat(row.weight_lb) || 0) * 16,
                    amazon_size_tier: row.size_tier,
                    amazon_product_tier: row.product_tier,
                    source: 'catalog'
                });
            }
        }

        logger.info('💲 [FEE-MISCLASS] Fetched product dimensions', {
            sellerId,
            count: dimensions.length
        });
    } catch (err: any) {
        logger.error('💲 [FEE-MISCLASS] Error fetching dimensions', { error: err.message });
    }

    return dimensions;
}

/**
 * Fetch fee transactions
 */
export async function fetchFeeTransactions(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<FeeTransaction[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const transactions: FeeTransaction[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .in('transaction_type', ['FBA fees', 'FBAPerUnitFulfillmentFee', 'FBAPickAndPackFee'])
            .gte('settlement_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                transactions.push({
                    id: row.id,
                    seller_id: sellerId,
                    transaction_date: row.settlement_date,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    order_id: row.order_id,
                    fee_type: row.transaction_type as FeeType,
                    fee_amount: Math.abs(parseFloat(row.amount) || 0),
                    currency: row.currency || 'USD',
                    stated_size_tier: row.metadata?.size_tier,
                    stated_weight_tier: row.metadata?.weight_tier,
                    quantity: row.quantity || 1
                });
            }
        }

        logger.info('💲 [FEE-MISCLASS] Fetched fee transactions', {
            sellerId,
            count: transactions.length
        });
    } catch (err: any) {
        logger.error('💲 [FEE-MISCLASS] Error fetching fee transactions', { error: err.message });
    }

    return transactions;
}

/**
 * Store misclassification results
 */
export async function storeFeeMisclassResults(
    results: FeeMisclassificationResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'fee_misclassification',
            severity: r.severity,
            estimated_value: r.total_overcharge,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                sku: r.sku,
                misclass_type: r.misclass_type,
                expected_tier: r.expected_tier,
                amazon_charged_tier: r.amazon_charged_tier,
                overcharge_per_unit: r.overcharge_per_unit,
                affected_transactions: r.affected_transactions,
                projected_annual_savings: r.projected_annual_savings,
                is_recurring: r.is_recurring,
                recommended_action: r.recommended_action,
                detection_reasons: r.evidence.detection_reasons
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('💲 [FEE-MISCLASS] Error storing results', { error: error.message });
        } else {
            logger.info('💲 [FEE-MISCLASS] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('💲 [FEE-MISCLASS] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Exports
// ============================================================================

export { SIZE_TIERS, WEIGHT_FEES, THRESHOLD_SHOW_TO_USER, THRESHOLD_RECOMMEND_ACTION };
