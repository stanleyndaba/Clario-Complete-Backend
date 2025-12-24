/**
 * Fee Detection Algorithms - "The Fee Auditor"
 * 
 * Phase 2, P1 Priority: Fee Overcharge Detection
 * Finds money lost to incorrectly calculated or overcharged fees.
 * 
 * Covers:
 * - Weight/Dimensional fee overcharges
 * - Fulfillment fee errors
 * - Storage fee overcharges (monthly + long-term)
 * - Commission overcharges
 * - Referral fee errors
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type FeeAnomalyType =
    | 'weight_fee_overcharge'
    | 'fulfillment_fee_error'
    | 'storage_overcharge'
    | 'lts_overcharge'
    | 'commission_overcharge'
    | 'closing_fee_error'
    | 'referral_fee_error';

export interface FeeEvent {
    id: string;
    seller_id: string;
    order_id?: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    product_name?: string;

    // Fee details
    fee_type: string;           // 'FBAWeightBasedFee', 'FBAPerUnitFulfillmentFee', 'Commission', 'StorageFee', etc.
    fee_amount: number;         // What was actually charged
    currency: string;

    // Product dimensions (for weight fee validation)
    item_weight_oz?: number;
    item_length_in?: number;
    item_width_in?: number;
    item_height_in?: number;
    dimensional_weight_oz?: number;

    // For storage fees
    cubic_feet?: number;
    storage_month?: string;     // e.g., "2024-01"
    storage_type?: string;      // 'standard', 'long_term', 'oversize'

    // For commission/referral
    sale_price?: number;
    referral_rate?: number;
    expected_fee?: number;      // What it SHOULD have been

    // Metadata
    fee_date: string;
    marketplace_id?: string;
    created_at: string;
}

export interface ProductCatalog {
    sku: string;
    asin?: string;
    fnsku?: string;
    product_name?: string;

    // Actual dimensions
    weight_oz: number;
    length_in: number;
    width_in: number;
    height_in: number;

    // Size tier
    size_tier: 'small_standard' | 'large_standard' | 'small_oversize' | 'medium_oversize' | 'large_oversize' | 'special_oversize';

    // Category for referral rates
    category?: string;
    referral_rate?: number;
}

export interface FeeSyncedData {
    seller_id: string;
    sync_id: string;
    fee_events: FeeEvent[];
    product_catalog: ProductCatalog[];
}

export interface FeeDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: FeeAnomalyType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: FeeOverchargeEvidence;
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    sku?: string;
    asin?: string;
    product_name?: string;
}

export interface FeeOverchargeEvidence {
    sku?: string;
    asin?: string;
    product_name?: string;
    fee_type: string;

    // The comparison
    charged_amount: number;
    expected_amount: number;
    overcharge_amount: number;
    overcharge_percentage: number;

    // Calculation details
    calculation_method: string;
    calculation_inputs: Record<string, any>;

    // Human-readable
    evidence_summary: string;

    // IDs
    fee_event_ids: string[];
    date_range?: { start: string; end: string };
}

// ============================================================================
// Fee Rate Tables (Amazon 2024 rates - should be updated periodically)
// ============================================================================

const FBA_FULFILLMENT_FEES = {
    small_standard: {
        '0-4oz': 3.22,
        '4-8oz': 3.40,
        '8-12oz': 3.58,
        '12-16oz': 3.77,
    },
    large_standard: {
        '0-4oz': 3.86,
        '4-8oz': 4.08,
        '8-12oz': 4.24,
        '12-16oz': 4.75,
        '1-2lb': 5.40,
        '2-3lb': 5.69,
        '3lb+': 6.10, // + $0.16 per additional 4oz
    },
    small_oversize: { base: 9.73, perLb: 0.42 },
    medium_oversize: { base: 19.05, perLb: 0.42 },
    large_oversize: { base: 89.98, perLb: 0.83 },
    special_oversize: { base: 158.49, perLb: 0.83 },
};

const STORAGE_FEES_PER_CUBIC_FOOT = {
    standard: {
        'jan-sep': 0.87,
        'oct-dec': 2.40,
    },
    oversize: {
        'jan-sep': 0.56,
        'oct-dec': 1.40,
    },
    long_term: 6.90, // Per cubic foot for items > 365 days
};

const DEFAULT_REFERRAL_RATE = 0.15; // 15% default

// ============================================================================
// Helper Functions
// ============================================================================

function calculateDeadline(discoveryDate: Date): { deadline: Date; daysRemaining: number } {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);

    const now = new Date();
    const diffTime = deadline.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return { deadline, daysRemaining: Math.max(0, daysRemaining) };
}

function calculateSeverity(overchargeAmount: number): 'low' | 'medium' | 'high' | 'critical' {
    if (overchargeAmount >= 100) return 'critical';
    if (overchargeAmount >= 50) return 'high';
    if (overchargeAmount >= 10) return 'medium';
    return 'low';
}

function calculateDimensionalWeight(length: number, width: number, height: number): number {
    // Amazon dimensional weight formula: (L x W x H) / 139
    return (length * width * height) / 139;
}

function getSizeTier(weight: number, length: number, width: number, height: number): string {
    const longestSide = Math.max(length, width, height);
    const medianSide = [length, width, height].sort((a, b) => a - b)[1];
    const shortestSide = Math.min(length, width, height);

    // Small Standard: ≤15oz, ≤18" longest, ≤14" median, ≤8" shortest
    if (weight <= 15 && longestSide <= 18 && medianSide <= 14 && shortestSide <= 8) {
        return 'small_standard';
    }

    // Large Standard: ≤20lb, ≤18" longest side (or any side ≤14" for lighter items)
    if (weight <= 320 && longestSide <= 18) { // 320oz = 20lb
        return 'large_standard';
    }

    // Small Oversize: ≤70lb, ≤60" longest, ≤30" median
    if (weight <= 1120 && longestSide <= 60 && medianSide <= 30) {
        return 'small_oversize';
    }

    // Medium Oversize: ≤150lb, ≤108" longest
    if (weight <= 2400 && longestSide <= 108) {
        return 'medium_oversize';
    }

    // Large Oversize: ≤150lb, length + girth ≤ 165"
    const girth = 2 * (medianSide + shortestSide);
    if (weight <= 2400 && (longestSide + girth) <= 165) {
        return 'large_oversize';
    }

    return 'special_oversize';
}

function getExpectedFulfillmentFee(weight: number, sizeTier: string): number {
    const weightLb = weight / 16; // Convert oz to lb

    if (sizeTier === 'small_standard') {
        if (weight <= 4) return FBA_FULFILLMENT_FEES.small_standard['0-4oz'];
        if (weight <= 8) return FBA_FULFILLMENT_FEES.small_standard['4-8oz'];
        if (weight <= 12) return FBA_FULFILLMENT_FEES.small_standard['8-12oz'];
        return FBA_FULFILLMENT_FEES.small_standard['12-16oz'];
    }

    if (sizeTier === 'large_standard') {
        if (weight <= 4) return FBA_FULFILLMENT_FEES.large_standard['0-4oz'];
        if (weight <= 8) return FBA_FULFILLMENT_FEES.large_standard['4-8oz'];
        if (weight <= 12) return FBA_FULFILLMENT_FEES.large_standard['8-12oz'];
        if (weight <= 16) return FBA_FULFILLMENT_FEES.large_standard['12-16oz'];
        if (weight <= 32) return FBA_FULFILLMENT_FEES.large_standard['1-2lb'];
        if (weight <= 48) return FBA_FULFILLMENT_FEES.large_standard['2-3lb'];
        // 3lb+ : base + $0.16 per additional 4oz over 3lb
        const additionalOz = weight - 48;
        const additionalFee = Math.ceil(additionalOz / 4) * 0.16;
        return FBA_FULFILLMENT_FEES.large_standard['3lb+'] + additionalFee;
    }

    // Oversize tiers
    const oversizeFees = FBA_FULFILLMENT_FEES[sizeTier as keyof typeof FBA_FULFILLMENT_FEES];
    if (oversizeFees && typeof oversizeFees === 'object' && 'base' in oversizeFees) {
        return oversizeFees.base + (weightLb * oversizeFees.perLb);
    }

    return 0;
}

function getStorageMonth(dateStr: string): 'jan-sep' | 'oct-dec' {
    const month = new Date(dateStr).getMonth();
    return month >= 9 ? 'oct-dec' : 'jan-sep'; // Oct(9), Nov(10), Dec(11)
}

// ============================================================================
// Main Detection Algorithms
// ============================================================================

/**
 * Detect Fulfillment Fee Overcharges
 * 
 * Compares charged fulfillment fees against expected fees based on:
 * - Product weight and dimensions
 * - Size tier classification
 * - Current Amazon fee schedule
 */
export function detectFulfillmentFeeOvercharge(
    sellerId: string,
    syncId: string,
    data: FeeSyncedData
): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    logger.info('💰 [FEE AUDITOR] Starting Fulfillment Fee Overcharge Detection', {
        sellerId,
        syncId,
        feeEventCount: data.fee_events?.length || 0,
        catalogCount: data.product_catalog?.length || 0
    });

    // Build catalog lookup
    const catalogBySku = new Map<string, ProductCatalog>();
    for (const product of (data.product_catalog || [])) {
        catalogBySku.set(product.sku, product);
    }

    // Filter to fulfillment fee events
    const fulfillmentFees = (data.fee_events || []).filter(
        e => e.fee_type.toLowerCase().includes('fulfillment') ||
            e.fee_type.toLowerCase().includes('fba')
    );

    // Group fees by SKU for aggregation
    const feesBySku = new Map<string, FeeEvent[]>();
    for (const fee of fulfillmentFees) {
        if (!fee.sku) continue;
        const existing = feesBySku.get(fee.sku) || [];
        existing.push(fee);
        feesBySku.set(fee.sku, existing);
    }

    // Analyze each SKU
    for (const [sku, fees] of feesBySku) {
        const catalog = catalogBySku.get(sku);

        // If we have catalog data, calculate expected fee
        let expectedFee: number;
        let calculationMethod: string;
        let calculationInputs: Record<string, any> = {};

        if (catalog) {
            const sizeTier = catalog.size_tier || getSizeTier(
                catalog.weight_oz,
                catalog.length_in,
                catalog.width_in,
                catalog.height_in
            );

            const billingWeight = Math.max(
                catalog.weight_oz,
                calculateDimensionalWeight(catalog.length_in, catalog.width_in, catalog.height_in) * 16
            );

            expectedFee = getExpectedFulfillmentFee(billingWeight, sizeTier);
            calculationMethod = 'catalog_weight_dimensions';
            calculationInputs = {
                weight_oz: catalog.weight_oz,
                dimensions: `${catalog.length_in} x ${catalog.width_in} x ${catalog.height_in}`,
                size_tier: sizeTier,
                billing_weight_oz: billingWeight
            };
        } else if (fees[0]?.expected_fee) {
            // Use expected fee from event if available
            expectedFee = fees[0].expected_fee;
            calculationMethod = 'event_expected_fee';
        } else {
            // Skip if we can't determine expected fee
            continue;
        }

        // Calculate total overcharge for this SKU
        let totalCharged = 0;
        let totalExpected = 0;
        const feeEventIds: string[] = [];

        for (const fee of fees) {
            totalCharged += Math.abs(fee.fee_amount);
            totalExpected += expectedFee;
            feeEventIds.push(fee.id);
        }

        const overchargeAmount = totalCharged - totalExpected;

        // Only flag if overcharge is significant (> $1 and > 10%)
        if (overchargeAmount <= 1) continue;

        const overchargePercentage = (overchargeAmount / totalExpected) * 100;
        if (overchargePercentage < 10) continue;

        // Calculate confidence based on data quality
        const confidenceScore = catalog ? 0.90 : 0.70;

        const evidence: FeeOverchargeEvidence = {
            sku,
            asin: catalog?.asin || fees[0]?.asin,
            product_name: catalog?.product_name || fees[0]?.product_name,
            fee_type: 'FBA Fulfillment Fee',
            charged_amount: totalCharged,
            expected_amount: totalExpected,
            overcharge_amount: overchargeAmount,
            overcharge_percentage: overchargePercentage,
            calculation_method: calculationMethod,
            calculation_inputs: calculationInputs,
            evidence_summary: `Fulfillment fees for SKU ${sku} total $${totalCharged.toFixed(2)} but should be $${totalExpected.toFixed(2)} based on ${calculationMethod}. Overcharged by $${overchargeAmount.toFixed(2)} (${overchargePercentage.toFixed(1)}%).`,
            fee_event_ids: feeEventIds
        };

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: 'fulfillment_fee_error',
            severity: calculateSeverity(overchargeAmount),
            estimated_value: overchargeAmount,
            currency: fees[0]?.currency || 'USD',
            confidence_score: confidenceScore,
            evidence,
            related_event_ids: feeEventIds,
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            sku,
            asin: catalog?.asin,
            product_name: catalog?.product_name
        });

        logger.info('💰 [FEE AUDITOR] Fulfillment fee overcharge detected!', {
            sku,
            overchargeAmount,
            overchargePercentage: overchargePercentage.toFixed(1) + '%'
        });
    }

    logger.info('💰 [FEE AUDITOR] Fulfillment fee detection complete', {
        sellerId,
        detectionsFound: results.length,
        totalRecovery: results.reduce((sum, r) => sum + r.estimated_value, 0)
    });

    return results;
}

/**
 * Detect Storage Fee Overcharges
 * 
 * Compares charged storage fees against expected fees based on:
 * - Cubic feet used
 * - Storage month (Q4 rates are higher)
 * - Long-term storage penalties
 */
export function detectStorageFeeOvercharge(
    sellerId: string,
    syncId: string,
    data: FeeSyncedData
): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    logger.info('📦 [FEE AUDITOR] Starting Storage Fee Overcharge Detection', {
        sellerId,
        syncId
    });

    // Filter to storage fee events
    const storageFees = (data.fee_events || []).filter(
        e => e.fee_type.toLowerCase().includes('storage')
    );

    // Group by month for analysis
    const feesByMonth = new Map<string, FeeEvent[]>();
    for (const fee of storageFees) {
        const month = fee.storage_month || fee.fee_date.substring(0, 7); // YYYY-MM
        const existing = feesByMonth.get(month) || [];
        existing.push(fee);
        feesByMonth.set(month, existing);
    }

    // Analyze each month
    for (const [month, fees] of feesByMonth) {
        const period = getStorageMonth(month + '-01');
        const isLongTerm = fees.some(f => f.storage_type === 'long_term');
        const isOversize = fees.some(f => f.storage_type === 'oversize');

        // Calculate totals
        let totalCharged = 0;
        let totalCubicFeet = 0;
        const feeEventIds: string[] = [];

        for (const fee of fees) {
            totalCharged += Math.abs(fee.fee_amount);
            totalCubicFeet += fee.cubic_feet || 0;
            feeEventIds.push(fee.id);
        }

        if (totalCubicFeet === 0) continue;

        // Calculate expected fee
        let ratePerCubicFoot: number;
        let feeType: string;

        if (isLongTerm) {
            ratePerCubicFoot = STORAGE_FEES_PER_CUBIC_FOOT.long_term;
            feeType = 'Long-Term Storage';
        } else if (isOversize) {
            ratePerCubicFoot = STORAGE_FEES_PER_CUBIC_FOOT.oversize[period];
            feeType = 'Oversize Storage';
        } else {
            ratePerCubicFoot = STORAGE_FEES_PER_CUBIC_FOOT.standard[period];
            feeType = 'Standard Storage';
        }

        const expectedFee = totalCubicFeet * ratePerCubicFoot;
        const overchargeAmount = totalCharged - expectedFee;

        // Only flag if overcharge is significant
        if (overchargeAmount <= 5) continue;

        const overchargePercentage = (overchargeAmount / expectedFee) * 100;
        if (overchargePercentage < 15) continue;

        const evidence: FeeOverchargeEvidence = {
            fee_type: feeType,
            charged_amount: totalCharged,
            expected_amount: expectedFee,
            overcharge_amount: overchargeAmount,
            overcharge_percentage: overchargePercentage,
            calculation_method: 'cubic_feet_rate',
            calculation_inputs: {
                month,
                period,
                cubic_feet: totalCubicFeet,
                rate_per_cubic_foot: ratePerCubicFoot
            },
            evidence_summary: `Storage fees for ${month} total $${totalCharged.toFixed(2)} for ${totalCubicFeet.toFixed(2)} cubic feet. Expected $${expectedFee.toFixed(2)} at $${ratePerCubicFoot}/cu.ft. Overcharged by $${overchargeAmount.toFixed(2)}.`,
            fee_event_ids: feeEventIds
        };

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: isLongTerm ? 'lts_overcharge' : 'storage_overcharge',
            severity: calculateSeverity(overchargeAmount),
            estimated_value: overchargeAmount,
            currency: 'USD',
            confidence_score: 0.85,
            evidence,
            related_event_ids: feeEventIds,
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining
        });

        logger.info('📦 [FEE AUDITOR] Storage fee overcharge detected!', {
            month,
            overchargeAmount,
            overchargePercentage: overchargePercentage.toFixed(1) + '%'
        });
    }

    return results;
}

/**
 * Detect Commission/Referral Fee Overcharges
 * 
 * Validates that referral fees match expected rates based on:
 * - Product category
 * - Sale price
 * - Applicable referral rate
 */
export function detectCommissionOvercharge(
    sellerId: string,
    syncId: string,
    data: FeeSyncedData
): FeeDetectionResult[] {
    const results: FeeDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    logger.info('💵 [FEE AUDITOR] Starting Commission/Referral Fee Detection', {
        sellerId,
        syncId
    });

    // Filter to commission/referral fee events
    const commissionFees = (data.fee_events || []).filter(
        e => e.fee_type.toLowerCase().includes('commission') ||
            e.fee_type.toLowerCase().includes('referral')
    );

    // Build catalog lookup for referral rates
    const catalogBySku = new Map<string, ProductCatalog>();
    for (const product of (data.product_catalog || [])) {
        catalogBySku.set(product.sku, product);
    }

    // Analyze each commission event
    for (const fee of commissionFees) {
        if (!fee.sale_price || fee.sale_price <= 0) continue;

        const catalog = fee.sku ? catalogBySku.get(fee.sku) : undefined;
        const referralRate = fee.referral_rate || catalog?.referral_rate || DEFAULT_REFERRAL_RATE;

        const expectedFee = fee.sale_price * referralRate;
        const chargedFee = Math.abs(fee.fee_amount);
        const overchargeAmount = chargedFee - expectedFee;

        // Only flag if overcharge is significant
        if (overchargeAmount <= 0.50) continue;

        const overchargePercentage = (overchargeAmount / expectedFee) * 100;
        if (overchargePercentage < 5) continue;

        const evidence: FeeOverchargeEvidence = {
            sku: fee.sku,
            asin: fee.asin,
            product_name: fee.product_name || catalog?.product_name,
            fee_type: 'Referral/Commission Fee',
            charged_amount: chargedFee,
            expected_amount: expectedFee,
            overcharge_amount: overchargeAmount,
            overcharge_percentage: overchargePercentage,
            calculation_method: 'sale_price_referral_rate',
            calculation_inputs: {
                sale_price: fee.sale_price,
                referral_rate: referralRate,
                order_id: fee.order_id
            },
            evidence_summary: `Commission on $${fee.sale_price.toFixed(2)} sale should be $${expectedFee.toFixed(2)} at ${(referralRate * 100).toFixed(1)}% rate. Charged $${chargedFee.toFixed(2)}, overcharge of $${overchargeAmount.toFixed(2)}.`,
            fee_event_ids: [fee.id]
        };

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: 'commission_overcharge',
            severity: calculateSeverity(overchargeAmount),
            estimated_value: overchargeAmount,
            currency: fee.currency || 'USD',
            confidence_score: 0.80,
            evidence,
            related_event_ids: [fee.id],
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            sku: fee.sku,
            asin: fee.asin,
            product_name: fee.product_name
        });
    }

    return results;
}

// ============================================================================
// Combined Fee Detection Runner
// ============================================================================

/**
 * Run all fee detection algorithms
 */
export function detectAllFeeOvercharges(
    sellerId: string,
    syncId: string,
    data: FeeSyncedData
): FeeDetectionResult[] {
    logger.info('💰 [FEE AUDITOR] Running all fee detection algorithms', {
        sellerId,
        syncId
    });

    const fulfillmentResults = detectFulfillmentFeeOvercharge(sellerId, syncId, data);
    const storageResults = detectStorageFeeOvercharge(sellerId, syncId, data);
    const commissionResults = detectCommissionOvercharge(sellerId, syncId, data);

    const allResults = [...fulfillmentResults, ...storageResults, ...commissionResults];

    logger.info('💰 [FEE AUDITOR] All fee detection complete', {
        sellerId,
        fulfillmentCount: fulfillmentResults.length,
        storageCount: storageResults.length,
        commissionCount: commissionResults.length,
        totalCount: allResults.length,
        totalRecovery: allResults.reduce((sum, r) => sum + r.estimated_value, 0)
    });

    return allResults;
}

// ============================================================================
// Database Integration
// ============================================================================

/**
 * Fetch fee events from database
 */
export async function fetchFeeEvents(
    sellerId: string,
    options?: { startDate?: string; feeTypes?: string[]; limit?: number }
): Promise<FeeEvent[]> {
    try {
        let query = supabaseAdmin
            .from('fee_events')
            .select('*')
            .eq('seller_id', sellerId)
            .order('fee_date', { ascending: false });

        if (options?.startDate) {
            query = query.gte('fee_date', options.startDate);
        }

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('💰 [FEE AUDITOR] Error fetching fee events', {
                sellerId,
                error: error.message
            });
            return [];
        }

        return data || [];
    } catch (err: any) {
        logger.error('💰 [FEE AUDITOR] Exception fetching fee events', {
            sellerId,
            error: err.message
        });
        return [];
    }
}

/**
 * Fetch product catalog from database
 */
export async function fetchProductCatalog(
    sellerId: string
): Promise<ProductCatalog[]> {
    try {
        const { data, error } = await supabaseAdmin
            .from('product_catalog')
            .select('*')
            .eq('seller_id', sellerId);

        if (error) {
            logger.error('💰 [FEE AUDITOR] Error fetching product catalog', {
                sellerId,
                error: error.message
            });
            return [];
        }

        return data || [];
    } catch (err: any) {
        logger.error('💰 [FEE AUDITOR] Exception fetching product catalog', {
            sellerId,
            error: err.message
        });
        return [];
    }
}

/**
 * Run full fee detection for a seller
 */
export async function runFeeOverchargeDetection(
    sellerId: string,
    syncId: string
): Promise<FeeDetectionResult[]> {
    logger.info('💰 [FEE AUDITOR] Starting full fee detection run', { sellerId, syncId });

    const lookbackDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [feeEvents, productCatalog] = await Promise.all([
        fetchFeeEvents(sellerId, { startDate: lookbackDate }),
        fetchProductCatalog(sellerId)
    ]);

    const syncedData: FeeSyncedData = {
        seller_id: sellerId,
        sync_id: syncId,
        fee_events: feeEvents,
        product_catalog: productCatalog
    };

    return detectAllFeeOvercharges(sellerId, syncId, syncedData);
}

/**
 * Store fee detection results
 */
export async function storeFeeDetectionResults(results: FeeDetectionResult[]): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: r.anomaly_type,
            severity: r.severity,
            estimated_value: r.estimated_value,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: r.evidence,
            related_event_ids: r.related_event_ids,
            discovery_date: r.discovery_date.toISOString(),
            deadline_date: r.deadline_date.toISOString(),
            days_remaining: r.days_remaining,
            status: 'open',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .upsert(records, {
                onConflict: 'seller_id,sync_id,anomaly_type',
                ignoreDuplicates: false
            });

        if (error) {
            logger.error('💰 [FEE AUDITOR] Error storing fee detection results', {
                error: error.message,
                count: results.length
            });
        } else {
            logger.info('💰 [FEE AUDITOR] Fee detection results stored', {
                count: results.length
            });
        }
    } catch (err: any) {
        logger.error('💰 [FEE AUDITOR] Exception storing results', {
            error: err.message
        });
    }
}

// ============================================================================
// Exports
// ============================================================================

export default {
    detectFulfillmentFeeOvercharge,
    detectStorageFeeOvercharge,
    detectCommissionOvercharge,
    detectAllFeeOvercharges,
    fetchFeeEvents,
    fetchProductCatalog,
    runFeeOverchargeDetection,
    storeFeeDetectionResults
};
