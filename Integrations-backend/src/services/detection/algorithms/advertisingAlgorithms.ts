/**
 * Advertising Detection Algorithms - "The Ad Auditor"
 * 
 * Phase 2, P3 Priority: Advertising and Promotion Error Detection
 * Finds money lost to incorrectly applied coupons, promotions, and ad spend.
 * 
 * Covers:
 * - Coupon redemption errors (double-dips, expired coupons)
 * - Lightning deal fee errors
 * - Subscribe & Save discount errors
 * - Promotion stacking issues
 * - PPC spend anomalies (optional)
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type AdvertisingAnomalyType =
    | 'coupon_overapplied'
    | 'promotion_stacking_error'
    | 'lightning_deal_fee_error'
    | 'subscribe_save_error'
    | 'deal_fee_error'
    | 'coupon_bank_error';

export interface CouponEvent {
    id: string;
    seller_id: string;
    order_id: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // Coupon details
    coupon_code?: string;
    coupon_type: 'percentage' | 'fixed' | 'bogo' | 'free_shipping';
    coupon_value: number;         // The discount amount applied
    expected_max_value?: number;  // What it should have been
    currency: string;

    // Promotion details
    promotion_id?: string;
    promotion_name?: string;
    promotion_type?: string;

    // Order context
    order_date: string;
    sale_price: number;
    discount_applied: number;

    // Validity
    coupon_start_date?: string;
    coupon_end_date?: string;
    was_expired: boolean;
    was_stacked: boolean;
    stacked_with?: string[];

    created_at: string;
}

export interface DealEvent {
    id: string;
    seller_id: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // Deal details
    deal_type: 'lightning' | 'dotd' | 'wow' | 'best_deal' | 'other';
    deal_fee: number;
    expected_fee?: number;
    currency: string;

    // Deal performance
    deal_date: string;
    units_sold?: number;
    revenue?: number;

    // Fee breakdown
    base_fee?: number;
    performance_fee?: number;

    created_at: string;
}

export interface SubscribeSaveEvent {
    id: string;
    seller_id: string;
    order_id: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // S&S details
    subscription_discount: number;  // e.g., 5%, 10%, 15%
    actual_discount_applied: number;
    expected_discount: number;
    currency: string;

    // Order context
    order_date: string;
    sale_price: number;

    // Customer tier
    customer_tier?: 'new' | 'regular' | 'vip';
    subscription_count?: number;

    created_at: string;
}

export interface AdvertisingSyncedData {
    seller_id: string;
    sync_id: string;
    coupon_events: CouponEvent[];
    deal_events: DealEvent[];
    subscribe_save_events: SubscribeSaveEvent[];
}

export interface AdvertisingDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: AdvertisingAnomalyType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: AdvertisingEvidence;
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    order_id?: string;
    sku?: string;
    asin?: string;
    product_name?: string;
}

export interface AdvertisingEvidence {
    order_id?: string;
    sku?: string;
    asin?: string;
    product_name?: string;

    // Error details
    error_type: string;
    expected_amount: number;
    actual_amount: number;
    discrepancy_amount: number;

    // Context
    coupon_code?: string;
    promotion_name?: string;
    deal_type?: string;

    // Human-readable
    evidence_summary: string;

    // IDs
    event_ids: string[];
    date_range?: { start: string; end: string };
}

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

function calculateSeverity(amount: number): 'low' | 'medium' | 'high' | 'critical' {
    if (amount >= 100) return 'critical';
    if (amount >= 50) return 'high';
    if (amount >= 15) return 'medium';
    return 'low';
}

// ============================================================================
// Main Detection Algorithms
// ============================================================================

/**
 * Detect Coupon Over-Application Errors
 * 
 * Finds cases where:
 * - Discount applied exceeds coupon value
 * - Expired coupons were honored
 * - Multiple coupons were stacked incorrectly
 */
export function detectCouponErrors(
    sellerId: string,
    syncId: string,
    data: AdvertisingSyncedData
): AdvertisingDetectionResult[] {
    const results: AdvertisingDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    logger.info('📢 [AD AUDITOR] Starting Coupon Error Detection', {
        sellerId,
        syncId,
        couponEventCount: data.coupon_events?.length || 0
    });

    for (const coupon of (data.coupon_events || [])) {
        let anomalyType: AdvertisingAnomalyType | null = null;
        let discrepancyAmount = 0;
        let evidenceSummary = '';
        let confidence = 0;

        // Check 1: Discount exceeded expected max
        if (coupon.expected_max_value && coupon.coupon_value > coupon.expected_max_value) {
            anomalyType = 'coupon_overapplied';
            discrepancyAmount = coupon.coupon_value - coupon.expected_max_value;
            evidenceSummary = `Coupon ${coupon.coupon_code || 'unknown'} applied $${coupon.coupon_value.toFixed(2)} discount but max should be $${coupon.expected_max_value.toFixed(2)}. Overapplied by $${discrepancyAmount.toFixed(2)}.`;
            confidence = 0.90;
        }

        // Check 2: Expired coupon was honored
        if (!anomalyType && coupon.was_expired) {
            anomalyType = 'coupon_overapplied';
            discrepancyAmount = coupon.coupon_value;
            evidenceSummary = `Expired coupon ${coupon.coupon_code || 'unknown'} was honored for $${coupon.coupon_value.toFixed(2)} discount on order ${coupon.order_id}.`;
            confidence = 0.85;
        }

        // Check 3: Improper stacking
        if (!anomalyType && coupon.was_stacked && coupon.stacked_with && coupon.stacked_with.length > 0) {
            // Check if stacking resulted in excessive discount
            const discountPercentage = (coupon.discount_applied / coupon.sale_price) * 100;
            if (discountPercentage > 50) { // More than 50% off = suspicious stacking
                anomalyType = 'promotion_stacking_error';
                discrepancyAmount = coupon.discount_applied - (coupon.sale_price * 0.30); // Assume 30% was intended
                if (discrepancyAmount > 0) {
                    evidenceSummary = `Multiple promotions stacked on order ${coupon.order_id} resulting in ${discountPercentage.toFixed(1)}% discount ($${coupon.discount_applied.toFixed(2)}). Potential over-discount of $${discrepancyAmount.toFixed(2)}.`;
                    confidence = 0.70;
                }
            }
        }

        if (!anomalyType || discrepancyAmount <= 1) {
            continue;
        }

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: anomalyType,
            severity: calculateSeverity(discrepancyAmount),
            estimated_value: discrepancyAmount,
            currency: coupon.currency || 'USD',
            confidence_score: confidence,
            evidence: {
                order_id: coupon.order_id,
                sku: coupon.sku,
                asin: coupon.asin,
                product_name: coupon.product_name,
                error_type: anomalyType,
                expected_amount: coupon.expected_max_value || 0,
                actual_amount: coupon.coupon_value,
                discrepancy_amount: discrepancyAmount,
                coupon_code: coupon.coupon_code,
                promotion_name: coupon.promotion_name,
                evidence_summary: evidenceSummary,
                event_ids: [coupon.id]
            },
            related_event_ids: [coupon.id],
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            order_id: coupon.order_id,
            sku: coupon.sku,
            asin: coupon.asin,
            product_name: coupon.product_name
        });

        logger.info('📢 [AD AUDITOR] Coupon error detected!', {
            orderId: coupon.order_id,
            couponCode: coupon.coupon_code,
            discrepancy: discrepancyAmount
        });
    }

    return results;
}

/**
 * Detect Lightning Deal Fee Errors
 * 
 * Validates that deal fees match expected amounts based on:
 * - Deal type
 * - Units sold
 * - Amazon's fee schedule
 */
export function detectDealFeeErrors(
    sellerId: string,
    syncId: string,
    data: AdvertisingSyncedData
): AdvertisingDetectionResult[] {
    const results: AdvertisingDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    logger.info('📢 [AD AUDITOR] Starting Deal Fee Error Detection', {
        sellerId,
        syncId,
        dealEventCount: data.deal_events?.length || 0
    });

    // Standard Lightning Deal fees (approximate, varies by event)
    const LIGHTNING_DEAL_FEE = 150; // Standard LD fee
    const DOTD_FEE = 500;          // Deal of the Day fee
    const WOW_FEE = 300;           // Week of Wow fee

    for (const deal of (data.deal_events || [])) {
        let expectedFee = deal.expected_fee;

        if (!expectedFee) {
            // Estimate based on deal type
            switch (deal.deal_type) {
                case 'lightning': expectedFee = LIGHTNING_DEAL_FEE; break;
                case 'dotd': expectedFee = DOTD_FEE; break;
                case 'wow': expectedFee = WOW_FEE; break;
                default: expectedFee = LIGHTNING_DEAL_FEE;
            }
        }

        const actualFee = deal.deal_fee;
        const discrepancy = actualFee - expectedFee;

        // Only flag if overcharged by significant amount
        if (discrepancy <= 10) {
            continue;
        }

        const percentageOver = (discrepancy / expectedFee) * 100;
        if (percentageOver < 15) {
            continue;
        }

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: deal.deal_type === 'lightning' ? 'lightning_deal_fee_error' : 'deal_fee_error',
            severity: calculateSeverity(discrepancy),
            estimated_value: discrepancy,
            currency: deal.currency || 'USD',
            confidence_score: 0.75,
            evidence: {
                sku: deal.sku,
                asin: deal.asin,
                product_name: deal.product_name,
                error_type: `${deal.deal_type}_fee_error`,
                expected_amount: expectedFee,
                actual_amount: actualFee,
                discrepancy_amount: discrepancy,
                deal_type: deal.deal_type,
                evidence_summary: `${deal.deal_type.toUpperCase()} deal fee of $${actualFee.toFixed(2)} exceeds expected $${expectedFee.toFixed(2)} by $${discrepancy.toFixed(2)} (${percentageOver.toFixed(1)}% over).`,
                event_ids: [deal.id]
            },
            related_event_ids: [deal.id],
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            sku: deal.sku,
            asin: deal.asin,
            product_name: deal.product_name
        });
    }

    return results;
}

/**
 * Detect Subscribe & Save Discount Errors
 * 
 * Validates that S&S discounts are correctly applied
 */
export function detectSubscribeSaveErrors(
    sellerId: string,
    syncId: string,
    data: AdvertisingSyncedData
): AdvertisingDetectionResult[] {
    const results: AdvertisingDetectionResult[] = [];
    const discoveryDate = new Date();
    const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

    logger.info('📢 [AD AUDITOR] Starting Subscribe & Save Error Detection', {
        sellerId,
        syncId,
        snsEventCount: data.subscribe_save_events?.length || 0
    });

    for (const sns of (data.subscribe_save_events || [])) {
        const expectedDiscount = sns.expected_discount;
        const actualDiscount = sns.actual_discount_applied;
        const discrepancy = actualDiscount - expectedDiscount;

        // Only flag if seller gave more discount than expected
        if (discrepancy <= 0.50) {
            continue;
        }

        const percentageOver = (discrepancy / sns.sale_price) * 100;
        if (percentageOver < 3) { // At least 3% discrepancy
            continue;
        }

        results.push({
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: 'subscribe_save_error',
            severity: calculateSeverity(discrepancy),
            estimated_value: discrepancy,
            currency: sns.currency || 'USD',
            confidence_score: 0.80,
            evidence: {
                order_id: sns.order_id,
                sku: sns.sku,
                asin: sns.asin,
                product_name: sns.product_name,
                error_type: 'sns_discount_error',
                expected_amount: expectedDiscount,
                actual_amount: actualDiscount,
                discrepancy_amount: discrepancy,
                evidence_summary: `Subscribe & Save order ${sns.order_id} applied $${actualDiscount.toFixed(2)} discount but expected max is $${expectedDiscount.toFixed(2)}. Over-discounted by $${discrepancy.toFixed(2)}.`,
                event_ids: [sns.id]
            },
            related_event_ids: [sns.id],
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            order_id: sns.order_id,
            sku: sns.sku,
            asin: sns.asin,
            product_name: sns.product_name
        });
    }

    return results;
}

/**
 * Run all advertising detection algorithms
 */
export function detectAllAdvertisingErrors(
    sellerId: string,
    syncId: string,
    data: AdvertisingSyncedData
): AdvertisingDetectionResult[] {
    logger.info('📢 [AD AUDITOR] Running all advertising detection algorithms', {
        sellerId,
        syncId
    });

    const couponResults = detectCouponErrors(sellerId, syncId, data);
    const dealResults = detectDealFeeErrors(sellerId, syncId, data);
    const snsResults = detectSubscribeSaveErrors(sellerId, syncId, data);

    const allResults = [...couponResults, ...dealResults, ...snsResults];

    logger.info('📢 [AD AUDITOR] All advertising detection complete', {
        sellerId,
        couponCount: couponResults.length,
        dealCount: dealResults.length,
        snsCount: snsResults.length,
        totalCount: allResults.length,
        totalRecovery: allResults.reduce((sum, r) => sum + r.estimated_value, 0)
    });

    return allResults;
}

// ============================================================================
// Database Integration
// ============================================================================

/**
 * Fetch coupon events from database
 */
export async function fetchCouponEvents(
    sellerId: string,
    options?: { startDate?: string; limit?: number }
): Promise<CouponEvent[]> {
    try {
        let query = supabaseAdmin
            .from('coupon_events')
            .select('*')
            .eq('seller_id', sellerId)
            .order('order_date', { ascending: false });

        if (options?.startDate) {
            query = query.gte('order_date', options.startDate);
        }

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('📢 [AD AUDITOR] Error fetching coupon events', {
                sellerId,
                error: error.message
            });
            return [];
        }

        return data || [];
    } catch (err: any) {
        logger.error('📢 [AD AUDITOR] Exception fetching coupon events', {
            sellerId,
            error: err.message
        });
        return [];
    }
}

/**
 * Fetch deal events from database
 */
export async function fetchDealEvents(
    sellerId: string,
    options?: { startDate?: string; limit?: number }
): Promise<DealEvent[]> {
    try {
        let query = supabaseAdmin
            .from('deal_events')
            .select('*')
            .eq('seller_id', sellerId)
            .order('deal_date', { ascending: false });

        if (options?.startDate) {
            query = query.gte('deal_date', options.startDate);
        }

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('📢 [AD AUDITOR] Error fetching deal events', {
                sellerId,
                error: error.message
            });
            return [];
        }

        return data || [];
    } catch (err: any) {
        logger.error('📢 [AD AUDITOR] Exception fetching deal events', {
            sellerId,
            error: err.message
        });
        return [];
    }
}

/**
 * Fetch subscribe & save events from database
 */
export async function fetchSubscribeSaveEvents(
    sellerId: string,
    options?: { startDate?: string; limit?: number }
): Promise<SubscribeSaveEvent[]> {
    try {
        let query = supabaseAdmin
            .from('subscribe_save_events')
            .select('*')
            .eq('seller_id', sellerId)
            .order('order_date', { ascending: false });

        if (options?.startDate) {
            query = query.gte('order_date', options.startDate);
        }

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('📢 [AD AUDITOR] Error fetching S&S events', {
                sellerId,
                error: error.message
            });
            return [];
        }

        return data || [];
    } catch (err: any) {
        logger.error('📢 [AD AUDITOR] Exception fetching S&S events', {
            sellerId,
            error: err.message
        });
        return [];
    }
}

/**
 * Run full advertising detection for a seller
 */
export async function runAdvertisingDetection(
    sellerId: string,
    syncId: string
): Promise<AdvertisingDetectionResult[]> {
    logger.info('📢 [AD AUDITOR] Starting full advertising detection', { sellerId, syncId });

    const lookbackDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [couponEvents, dealEvents, subscribeSaveEvents] = await Promise.all([
        fetchCouponEvents(sellerId, { startDate: lookbackDate }),
        fetchDealEvents(sellerId, { startDate: lookbackDate }),
        fetchSubscribeSaveEvents(sellerId, { startDate: lookbackDate })
    ]);

    const syncedData: AdvertisingSyncedData = {
        seller_id: sellerId,
        sync_id: syncId,
        coupon_events: couponEvents,
        deal_events: dealEvents,
        subscribe_save_events: subscribeSaveEvents
    };

    return detectAllAdvertisingErrors(sellerId, syncId, syncedData);
}

/**
 * Store advertising detection results
 */
export async function storeAdvertisingDetectionResults(results: AdvertisingDetectionResult[]): Promise<void> {
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
            logger.error('📢 [AD AUDITOR] Error storing advertising results', {
                error: error.message,
                count: results.length
            });
        } else {
            logger.info('📢 [AD AUDITOR] Advertising results stored', {
                count: results.length
            });
        }
    } catch (err: any) {
        logger.error('📢 [AD AUDITOR] Exception storing results', {
            error: err.message
        });
    }
}

// ============================================================================
// Exports
// ============================================================================

export default {
    detectCouponErrors,
    detectDealFeeErrors,
    detectSubscribeSaveErrors,
    detectAllAdvertisingErrors,
    fetchCouponEvents,
    fetchDealEvents,
    fetchSubscribeSaveEvents,
    runAdvertisingDetection,
    storeAdvertisingDetectionResults
};
