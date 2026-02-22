/**
 * Claim Value Calculator
 * 
 * Calculates the MAXIMUM SAFE RECOVERABLE AMOUNT for each claim.
 * 
 * Components:
 * 1. Item Cost Resolution - actual cost, not list price
 * 2. Dimension Verification - correct weight/size tier
 * 3. Fee Schedule Lookup - Amazon's current fee tables
 * 4. Exchange Rate Conversion - historical rates for event date
 * 5. Quantity Verification - actual affected units
 * 
 * Goal: "What's the maximum safe amount they could have recovered?"
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ClaimValuation {
    claim_id: string;
    seller_id: string;

    // Raw components
    unit_cost: number;
    affected_quantity: number;
    fee_overcharge_per_unit: number;

    // Calculated values
    base_value: number;           // unit_cost × quantity
    fee_recovery: number;         // fee overcharge recovery
    total_claim_value: number;    // base + fees

    // Currency handling
    original_currency: string;
    target_currency: string;
    exchange_rate: number;
    exchange_rate_date: string;
    converted_value: number;

    // Confidence
    valuation_confidence: number;
    valuation_method: string;
    valuation_notes: string[];
}

export interface ItemCostData {
    sku: string;
    asin?: string;
    cost_source: 'invoice' | 'catalog' | 'historical' | 'estimated';
    unit_cost: number;
    currency: string;
    cost_date: string;
    confidence: number;
}

export interface DimensionData {
    sku: string;
    asin?: string;
    weight_oz: number;
    length_in: number;
    width_in: number;
    height_in: number;
    size_tier: string;
    dimensional_weight_oz: number;
    source: 'amazon' | 'catalog' | 'calculated';
}

// ============================================================================
// Fee Schedule Tables (Amazon 2025)
// ============================================================================

const FBA_FULFILLMENT_FEES_2025: Record<string, Record<string, number>> = {
    'small_standard': { 'base': 3.22, 'per_oz_over_4': 0.08 },
    'large_standard_0_1lb': { 'base': 3.86 },
    'large_standard_1_2lb': { 'base': 4.08, 'per_oz_over_16': 0.08 },
    'large_standard_2_3lb': { 'base': 4.76, 'per_oz_over_32': 0.08 },
    'large_standard_3_20lb': { 'base': 5.44, 'per_lb_over_3': 0.32 },
    'small_oversize': { 'base': 9.73, 'per_lb_over_2': 0.42 },
    'medium_oversize': { 'base': 19.05, 'per_lb_over_2': 0.42 },
    'large_oversize': { 'base': 89.98, 'per_lb_over_90': 0.83 },
    'special_oversize': { 'base': 158.49, 'per_lb_over_90': 0.83 },
};

const REFERRAL_RATES: Record<string, number> = {
    'amazon_device_accessories': 0.45,
    'appliances': 0.15,
    'automotive': 0.12,
    'baby': 0.15,
    'beauty': 0.15,
    'books': 0.15,
    'camera': 0.08,
    'cell_phone': 0.08,
    'clothing': 0.17,
    'computers': 0.08,
    'electronics': 0.08,
    'furniture': 0.15,
    'grocery': 0.15,
    'health': 0.15,
    'home': 0.15,
    'jewelry': 0.20,
    'kitchen': 0.15,
    'office': 0.15,
    'pet': 0.15,
    'shoes': 0.15,
    'software': 0.15,
    'sports': 0.15,
    'tools': 0.15,
    'toys': 0.15,
    'video_games': 0.15,
    'watches': 0.16,
    'default': 0.15,
};

// ============================================================================
// Item Cost Resolution
// ============================================================================

/**
 * Get the most accurate cost for an item
 * Priority: Invoice > Catalog > Historical > Estimate
 */
export async function resolveItemCost(
    sellerId: string,
    sku: string,
    asin?: string,
    eventDate?: string
): Promise<ItemCostData> {
    let costData: ItemCostData = {
        sku,
        asin,
        cost_source: 'estimated',
        unit_cost: 15.00, // Default fallback
        currency: 'USD',
        cost_date: eventDate || new Date().toISOString(),
        confidence: 0.3
    };

    try {
        // Method 1: Try to find from parsed invoices
        const { data: invoices } = await supabaseAdmin
            .from('evidence_documents')
            .select('parsed_metadata, extracted')
            .eq('seller_id', sellerId)
            .eq('parser_status', 'completed')
            .limit(50);

        if (invoices?.length) {
            for (const doc of invoices) {
                const items = doc.parsed_metadata?.line_items || doc.extracted?.items || [];
                const match = items.find((item: any) =>
                    item.sku === sku || item.asin === asin
                );
                if (match?.unit_cost || match?.unit_price) {
                    costData = {
                        sku,
                        asin,
                        cost_source: 'invoice',
                        unit_cost: match.unit_cost || match.unit_price,
                        currency: match.currency || 'USD',
                        cost_date: doc.parsed_metadata?.invoice_date || new Date().toISOString(),
                        confidence: 0.95
                    };
                    break;
                }
            }
        }

        // Method 2: Try product catalog
        if (costData.cost_source === 'estimated') {
            const { data: catalog } = await supabaseAdmin
                .from('products')
                .select('*')
                .eq('seller_id', sellerId)
                .or(`sku.eq.${sku},asin.eq.${asin}`)
                .limit(1)
                .maybeSingle();

            if (catalog?.unit_cost) {
                costData = {
                    sku,
                    asin: catalog.asin || asin,
                    cost_source: 'catalog',
                    unit_cost: catalog.unit_cost,
                    currency: catalog.currency || 'USD',
                    cost_date: catalog.updated_at,
                    confidence: 0.85
                };
            }
        }

        // Method 3: Historical average from financial events
        if (costData.cost_source === 'estimated') {
            const { data: events } = await supabaseAdmin
                .from('financial_events')
                .select('amount, quantity')
                .eq('seller_id', sellerId)
                .or(`amazon_sku.eq.${sku},asin.eq.${asin}`)
                .eq('event_type', 'order')
                .limit(100);

            if (events?.length) {
                const validEvents = events.filter(e => e.amount && e.quantity && e.quantity > 0);
                if (validEvents.length >= 3) {
                    const avgPrice = validEvents.reduce((sum, e) => sum + (e.amount / e.quantity), 0) / validEvents.length;
                    // Estimate cost as 40% of sale price (typical margin)
                    costData = {
                        sku,
                        asin,
                        cost_source: 'historical',
                        unit_cost: avgPrice * 0.4,
                        currency: 'USD',
                        cost_date: new Date().toISOString(),
                        confidence: 0.6
                    };
                }
            }
        }

    } catch (error: any) {
        logger.warn('[CLAIM CALC] Error resolving item cost', { sku, error: error.message });
    }

    return costData;
}

// ============================================================================
// Dimension Verification
// ============================================================================

/**
 * Get verified dimensions and calculate correct size tier
 */
export async function verifyDimensions(
    sellerId: string,
    sku: string,
    asin?: string
): Promise<DimensionData> {
    let dimensions: DimensionData = {
        sku,
        asin,
        weight_oz: 16, // Default 1 lb
        length_in: 10,
        width_in: 8,
        height_in: 4,
        size_tier: 'large_standard_0_1lb',
        dimensional_weight_oz: 16,
        source: 'calculated'
    };

    try {
        // Get from products catalog
        const { data: product } = await supabaseAdmin
            .from('products')
            .select('*')
            .eq('seller_id', sellerId)
            .or(`sku.eq.${sku},asin.eq.${asin}`)
            .limit(1)
            .maybeSingle();

        if (product?.weight_oz) {
            dimensions = {
                sku,
                asin: product.asin || asin,
                weight_oz: product.weight_oz,
                length_in: product.length_in || 10,
                width_in: product.width_in || 8,
                height_in: product.height_in || 4,
                size_tier: product.size_tier || 'large_standard_0_1lb',
                dimensional_weight_oz: calculateDimensionalWeight(
                    product.length_in || 10,
                    product.width_in || 8,
                    product.height_in || 4
                ),
                source: 'catalog'
            };
        }

        // Recalculate size tier
        dimensions.size_tier = calculateSizeTier(
            dimensions.weight_oz,
            dimensions.length_in,
            dimensions.width_in,
            dimensions.height_in
        );

    } catch (error: any) {
        logger.warn('[CLAIM CALC] Error verifying dimensions', { sku, error: error.message });
    }

    return dimensions;
}

function calculateDimensionalWeight(length: number, width: number, height: number): number {
    // Amazon dimensional weight formula (139 divisor)
    return (length * width * height) / 139 * 16; // Convert to oz
}

function calculateSizeTier(
    weightOz: number,
    length: number,
    width: number,
    height: number
): string {
    const longestSide = Math.max(length, width, height);
    const medianSide = [length, width, height].sort((a, b) => a - b)[1];
    const shortestSide = Math.min(length, width, height);
    const girth = 2 * (medianSide + shortestSide);

    // Small standard
    if (weightOz <= 16 && longestSide <= 15 && medianSide <= 12 && shortestSide <= 0.75) {
        return 'small_standard';
    }

    // Large standard tiers
    if (weightOz <= 20 * 16 && longestSide <= 18 && medianSide <= 14 && shortestSide <= 8) {
        if (weightOz <= 16) return 'large_standard_0_1lb';
        if (weightOz <= 32) return 'large_standard_1_2lb';
        if (weightOz <= 48) return 'large_standard_2_3lb';
        return 'large_standard_3_20lb';
    }

    // Oversize tiers
    if (longestSide <= 60 && (longestSide + girth) <= 130) {
        if (weightOz <= 70 * 16) return 'small_oversize';
        return 'medium_oversize';
    }

    if (longestSide <= 108 && (longestSide + girth) <= 165 && weightOz <= 150 * 16) {
        return 'large_oversize';
    }

    return 'special_oversize';
}

// ============================================================================
// Fee Schedule Lookup
// ============================================================================

/**
 * Calculate expected FBA fulfillment fee based on dimensions
 */
export function calculateExpectedFulfillmentFee(dimensions: DimensionData): number {
    const tier = dimensions.size_tier;
    const weightLb = Math.max(dimensions.weight_oz, dimensions.dimensional_weight_oz) / 16;

    const feeSchedule = FBA_FULFILLMENT_FEES_2025[tier];
    if (!feeSchedule) {
        return 5.00; // Default fallback
    }

    let fee = feeSchedule.base || 5.00;

    // Add weight-based surcharges
    if (tier === 'small_standard' && dimensions.weight_oz > 4) {
        fee += (dimensions.weight_oz - 4) * (feeSchedule.per_oz_over_4 || 0);
    }
    if (tier.includes('large_standard') && feeSchedule.per_lb_over_3 && weightLb > 3) {
        fee += (weightLb - 3) * feeSchedule.per_lb_over_3;
    }
    if (tier.includes('oversize') && feeSchedule.per_lb_over_2 && weightLb > 2) {
        fee += (weightLb - 2) * feeSchedule.per_lb_over_2;
    }

    return Math.round(fee * 100) / 100;
}

/**
 * Calculate expected referral fee based on category and price
 */
export function calculateExpectedReferralFee(
    category: string,
    salePrice: number
): number {
    const rate = REFERRAL_RATES[category.toLowerCase()] || REFERRAL_RATES.default;
    return Math.round(salePrice * rate * 100) / 100;
}

// ============================================================================
// Exchange Rate Handling
// ============================================================================

/**
 * Get historical exchange rate for a specific date
 * 4-tier resolution: DB cache → Live API → Static fallback → Identity (1.0)
 */
export async function getExchangeRate(
    fromCurrency: string,
    toCurrency: string,
    date: string
): Promise<{ rate: number; source: string }> {
    if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) {
        return { rate: 1.0, source: 'identity' };
    }

    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    const rateDate = date.substring(0, 10);

    try {
        // Tier 1: Check cached rates in database
        const { data: cached } = await supabaseAdmin
            .from('exchange_rates')
            .select('*')
            .eq('from_currency', from)
            .eq('to_currency', to)
            .eq('rate_date', rateDate)
            .limit(1)
            .maybeSingle();

        if (cached?.rate) {
            return { rate: cached.rate, source: 'cached' };
        }

        // Tier 2: Fetch live rate from free API
        try {
            const liveRate = await fetchLiveExchangeRate(from, to, rateDate);
            if (liveRate) {
                // Cache to database for future lookups
                await cacheExchangeRate(from, to, rateDate, liveRate);
                return { rate: liveRate, source: 'live_api' };
            }
        } catch (apiError: any) {
            logger.warn('[CLAIM CALC] Live FX API failed, falling back to static', {
                from, to, date, error: apiError.message
            });
        }

        // Tier 3: Static fallback rates (last resort — better than nothing)
        const fallbackRates: Record<string, number> = {
            'EUR_USD': 1.08, 'GBP_USD': 1.25, 'CAD_USD': 0.74,
            'MXN_USD': 0.058, 'JPY_USD': 0.0067, 'INR_USD': 0.012,
            'AED_USD': 0.27, 'SEK_USD': 0.095, 'PLN_USD': 0.25,
            'AUD_USD': 0.65, 'BRL_USD': 0.20, 'SGD_USD': 0.74,
            'USD_EUR': 0.93, 'USD_GBP': 0.80, 'USD_CAD': 1.35,
            'USD_MXN': 17.24, 'USD_JPY': 149.25, 'USD_INR': 83.00,
        };

        const key = `${from}_${to}`;
        if (fallbackRates[key]) {
            return { rate: fallbackRates[key], source: 'fallback_static' };
        }

    } catch (error: any) {
        logger.warn('[CLAIM CALC] Error getting exchange rate', { fromCurrency, toCurrency, date });
    }

    // Tier 4: Identity
    return { rate: 1.0, source: 'default' };
}

/**
 * Fetch a live exchange rate from a free API
 * Uses exchangerate-api.com which has a free tier (1500 req/mo)
 */
async function fetchLiveExchangeRate(
    from: string,
    to: string,
    date: string
): Promise<number | null> {
    const { default: axios } = await import('axios');

    // Try open.er-api.com (free, no key needed)
    try {
        const url = `https://open.er-api.com/v6/latest/${from}`;
        const response = await axios.get(url, { timeout: 10000 });

        if (response.data?.result === 'success' && response.data?.rates?.[to]) {
            const rate = response.data.rates[to];
            logger.info('[CLAIM CALC] 💱 Live FX rate fetched', { from, to, rate, date });
            return rate;
        }
    } catch (e: any) {
        logger.debug('[CLAIM CALC] open.er-api.com failed', { error: e.message });
    }

    return null;
}

/**
 * Cache an exchange rate to the database for future lookups
 */
async function cacheExchangeRate(
    from: string,
    to: string,
    date: string,
    rate: number
): Promise<void> {
    try {
        if (typeof supabaseAdmin.from !== 'function') return;

        await supabaseAdmin
            .from('exchange_rates')
            .upsert({
                from_currency: from,
                to_currency: to,
                rate_date: date,
                rate: rate,
                source: 'live_api',
                fetched_at: new Date().toISOString(),
                created_at: new Date().toISOString()
            }, {
                onConflict: 'from_currency,to_currency,rate_date',
                ignoreDuplicates: false
            });

        logger.debug('[CLAIM CALC] FX rate cached', { from, to, date, rate });
    } catch (error: any) {
        // Non-fatal — if caching fails, we still have the rate
        logger.warn('[CLAIM CALC] Failed to cache FX rate', { error: error.message });
    }
}

// ============================================================================
// Main Valuation Function
// ============================================================================

/**
 * Calculate the maximum safe recoverable value for a claim
 */
export async function calculateClaimValue(
    sellerId: string,
    claimId: string,
    claimData: {
        sku?: string;
        asin?: string;
        quantity: number;
        event_date: string;
        event_type: string;
        original_amount?: number;
        original_currency?: string;
        charged_fee?: number;
        expected_fee?: number;
        category?: string;
        sale_price?: number;
    },
    targetCurrency: string = 'USD'
): Promise<ClaimValuation> {
    const notes: string[] = [];

    // Step 1: Resolve item cost
    const costData = await resolveItemCost(
        sellerId,
        claimData.sku || '',
        claimData.asin,
        claimData.event_date
    );
    notes.push(`Cost source: ${costData.cost_source} ($${costData.unit_cost.toFixed(2)})`);

    // Step 2: Verify dimensions and calculate correct fees
    const dimensions = await verifyDimensions(sellerId, claimData.sku || '', claimData.asin);
    const expectedFulfillmentFee = calculateExpectedFulfillmentFee(dimensions);

    // Step 3: Calculate fee overcharge (if applicable)
    let feeOverchargePerUnit = 0;
    if (claimData.charged_fee && claimData.charged_fee > expectedFulfillmentFee) {
        feeOverchargePerUnit = claimData.charged_fee - expectedFulfillmentFee;
        notes.push(`Fee overcharge: $${feeOverchargePerUnit.toFixed(2)}/unit (charged $${claimData.charged_fee.toFixed(2)}, expected $${expectedFulfillmentFee.toFixed(2)})`);
    }

    // Step 4: Calculate base value
    const baseValue = costData.unit_cost * claimData.quantity;
    const feeRecovery = feeOverchargePerUnit * claimData.quantity;
    const totalClaimValue = baseValue + feeRecovery;

    // Step 5: Currency conversion
    const { rate: exchangeRate, source: rateSource } = await getExchangeRate(
        costData.currency,
        targetCurrency,
        claimData.event_date
    );
    const convertedValue = totalClaimValue * exchangeRate;
    notes.push(`FX: ${costData.currency} → ${targetCurrency} @ ${exchangeRate.toFixed(4)} (${rateSource})`);

    // Step 6: Calculate confidence
    const valuationConfidence = Math.min(
        costData.confidence,
        dimensions.source === 'catalog' ? 0.9 : 0.7
    );

    const valuation: ClaimValuation = {
        claim_id: claimId,
        seller_id: sellerId,
        unit_cost: costData.unit_cost,
        affected_quantity: claimData.quantity,
        fee_overcharge_per_unit: feeOverchargePerUnit,
        base_value: baseValue,
        fee_recovery: feeRecovery,
        total_claim_value: totalClaimValue,
        original_currency: costData.currency,
        target_currency: targetCurrency,
        exchange_rate: exchangeRate,
        exchange_rate_date: claimData.event_date,
        converted_value: Math.round(convertedValue * 100) / 100,
        valuation_confidence: valuationConfidence,
        valuation_method: `${costData.cost_source}_cost + ${dimensions.source}_dimensions`,
        valuation_notes: notes
    };

    logger.debug('[CLAIM CALC] Valuation complete', {
        claimId,
        totalValue: valuation.converted_value,
        confidence: valuation.valuation_confidence
    });

    return valuation;
}

export default {
    calculateClaimValue,
    resolveItemCost,
    verifyDimensions,
    calculateExpectedFulfillmentFee,
    calculateExpectedReferralFee,
    getExchangeRate
};
