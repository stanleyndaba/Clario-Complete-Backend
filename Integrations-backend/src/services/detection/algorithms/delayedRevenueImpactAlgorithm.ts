/**
 * Delayed Revenue Impact Compensation Algorithm
 * 
 * Agent 3: Discovery Agent - Enterprise-Grade Justification Engine
 * 
 * Problem: Amazon's delays cause measurable revenue loss:
 * - Late restorations
 * - Delayed stock reactivation
 * - Listing suppressed periods
 * - Inventory trapped in lost status
 * 
 * This calculates LOST SALES OPPORTUNITY value, not just reimbursement.
 * Turns delay → quantifiable financial harm.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface DelayEvent {
    id: string;
    seller_id: string;
    sku: string;
    asin?: string;
    fnsku?: string;

    // Delay details
    delay_type: DelayType;
    delay_start_date: string;
    delay_end_date?: string;
    delay_duration_days: number;

    // Quantity affected
    quantity_affected: number;

    // Status
    is_resolved: boolean;
    resolution_type?: string;

    // Reference
    case_id?: string;
    shipment_id?: string;
}

export type DelayType =
    | 'late_restoration'          // Inventory restored late
    | 'delayed_reactivation'      // Stock reactivated late
    | 'listing_suppressed'        // Listing was down
    | 'inventory_trapped'         // Stuck in lost/damaged status
    | 'stranded_inventory'        // Can't sell, no buybox
    | 'inbound_delay'             // Shipment took too long
    | 'transfer_delay';           // FC-to-FC transfer delay

export interface SalesVelocity {
    sku: string;
    asin?: string;

    // Velocity metrics (units per day)
    avg_daily_units_7d: number;
    avg_daily_units_30d: number;
    avg_daily_units_90d: number;

    // Revenue metrics
    avg_unit_price_30d: number;
    avg_margin_30d: number;

    // Seasonality
    seasonality_factor: number;  // 1.0 = normal, >1 = peak, <1 = slow

    // Confidence
    sample_count: number;
    velocity_confidence: number;
}

export interface DelayedRevenueResult {
    seller_id: string;
    sync_id: string;

    // Delay identification
    delay_event_id: string;
    sku: string;
    asin?: string;
    delay_type: DelayType;

    // Duration
    delay_start: string;
    delay_end?: string;
    delay_duration_days: number;
    is_ongoing: boolean;

    // Quantity
    quantity_affected: number;

    // Revenue impact
    lost_units: number;
    lost_revenue: number;
    lost_margin: number;
    opportunity_cost: number;  // Interest on delayed capital
    total_financial_harm: number;
    currency: string;

    // Velocity basis
    velocity_used: 'daily_7d' | 'daily_30d' | 'daily_90d';
    units_per_day: number;
    avg_unit_price: number;

    // Severity
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Confidence
    confidence_score: number;
    confidence_factors: RevenueConfidenceFactors;

    // Recommendation
    recommended_action: 'monitor' | 'document' | 'file_claim' | 'escalate_with_evidence';
    claim_justification: string;

    // Evidence
    evidence: {
        delay_event: DelayEvent;
        sales_velocity: SalesVelocity;
        calculation_breakdown: CalculationBreakdown;
        detection_reasons: string[];
    };
}

export interface RevenueConfidenceFactors {
    stable_velocity: boolean;        // +0.30
    clear_delay_period: boolean;     // +0.25
    significant_impact: boolean;     // +0.20
    documented_cause: boolean;       // +0.15
    historical_pattern: boolean;     // +0.10
    calculated_score: number;
}

export interface CalculationBreakdown {
    delay_days: number;
    units_per_day: number;
    lost_units: number;
    unit_price: number;
    lost_revenue: number;
    estimated_margin_percent: number;
    lost_margin: number;
    capital_cost_rate: number;
    opportunity_cost: number;
    total_harm: number;
}

export interface DelayRevenueImpactSyncedData {
    seller_id: string;
    sync_id: string;
    delay_events: DelayEvent[];
    sales_velocity: Map<string, SalesVelocity>;
}

// ============================================================================
// Constants
// ============================================================================

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_FILE_CLAIM = 0.70;
const MIN_HARM_VALUE = 25; // $25 minimum financial harm
const MIN_DELAY_DAYS = 3; // At least 3 days to count

// Financial assumptions
const DEFAULT_MARGIN_PERCENT = 0.25; // 25% margin if unknown
const CAPITAL_COST_RATE = 0.08; // 8% annual opportunity cost

// Seasonality boost windows (month numbers)
const PEAK_MONTHS = [10, 11, 12]; // Q4
const SLOW_MONTHS = [1, 2]; // Post-holiday

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Calculate delayed revenue impact
 */
export async function calculateDelayedRevenueImpact(
    sellerId: string,
    syncId: string,
    data: DelayRevenueImpactSyncedData
): Promise<DelayedRevenueResult[]> {
    const results: DelayedRevenueResult[] = [];

    logger.info('📉 [DELAY-REVENUE] Starting delayed revenue impact analysis', {
        sellerId,
        syncId,
        delayEventCount: data.delay_events?.length || 0,
        velocityDataCount: data.sales_velocity?.size || 0
    });

    if (!data.delay_events || data.delay_events.length === 0) {
        logger.info('📉 [DELAY-REVENUE] No delay events to analyze');
        return results;
    }

    // Current month for seasonality
    const currentMonth = new Date().getMonth() + 1;
    const seasonalityFactor = calculateSeasonalityFactor(currentMonth);

    // Analyze each delay event
    for (const delayEvent of data.delay_events) {
        try {
            // Skip if delay too short
            if (delayEvent.delay_duration_days < MIN_DELAY_DAYS) {
                continue;
            }

            const velocity = data.sales_velocity.get(delayEvent.sku);

            if (!velocity) {
                continue; // No velocity data
            }

            const impact = calculateRevenueImpact(
                sellerId,
                syncId,
                delayEvent,
                velocity,
                seasonalityFactor
            );

            if (impact &&
                impact.total_financial_harm >= MIN_HARM_VALUE &&
                impact.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                results.push(impact);
            }
        } catch (error: any) {
            logger.warn('📉 [DELAY-REVENUE] Error analyzing delay event', {
                eventId: delayEvent.id,
                error: error.message
            });
        }
    }

    // Sort by total financial harm
    results.sort((a, b) => b.total_financial_harm - a.total_financial_harm);

    const totalHarm = results.reduce((sum, r) => sum + r.total_financial_harm, 0);
    const totalLostRevenue = results.reduce((sum, r) => sum + r.lost_revenue, 0);
    const ongoingDelays = results.filter(r => r.is_ongoing).length;

    logger.info('📉 [DELAY-REVENUE] Analysis complete', {
        sellerId,
        eventsAnalyzed: data.delay_events.length,
        impactsCalculated: results.length,
        ongoingDelays,
        totalLostRevenue: totalLostRevenue.toFixed(2),
        totalFinancialHarm: totalHarm.toFixed(2)
    });

    return results;
}

/**
 * Calculate revenue impact for a single delay event
 */
function calculateRevenueImpact(
    sellerId: string,
    syncId: string,
    delay: DelayEvent,
    velocity: SalesVelocity,
    seasonalityFactor: number
): DelayedRevenueResult | null {
    const detectionReasons: string[] = [];

    // Step 1: Determine best velocity to use
    const { unitsPerDay, velocityUsed } = selectBestVelocity(velocity);

    if (unitsPerDay <= 0) {
        return null; // No sales velocity
    }

    // Step 2: Calculate lost units (adjusted for seasonality)
    const adjustedUnitsPerDay = unitsPerDay * seasonalityFactor;
    const lostUnits = Math.round(adjustedUnitsPerDay * delay.delay_duration_days);

    if (lostUnits < 1) {
        return null; // Not meaningful
    }

    detectionReasons.push(
        `Delay type: ${delay.delay_type.replace(/_/g, ' ')}`,
        `Duration: ${delay.delay_duration_days} days`,
        `Sales velocity: ${adjustedUnitsPerDay.toFixed(2)} units/day`,
        `Estimated lost units: ${lostUnits}`
    );

    // Step 3: Calculate lost revenue
    const unitPrice = velocity.avg_unit_price_30d || 20; // Default $20 if unknown
    const lostRevenue = lostUnits * unitPrice;

    // Step 4: Calculate lost margin
    const marginPercent = velocity.avg_margin_30d || DEFAULT_MARGIN_PERCENT;
    const lostMargin = lostRevenue * marginPercent;

    // Step 5: Calculate opportunity cost (cost of tied-up capital)
    const capitalValue = delay.quantity_affected * unitPrice;
    const annualizedDays = delay.delay_duration_days / 365;
    const opportunityCost = capitalValue * CAPITAL_COST_RATE * annualizedDays;

    // Step 6: Total financial harm
    const totalHarm = lostRevenue + opportunityCost;

    detectionReasons.push(
        `Lost revenue: $${lostRevenue.toFixed(2)}`,
        `Lost margin: $${lostMargin.toFixed(2)}`,
        `Opportunity cost: $${opportunityCost.toFixed(2)}`,
        `Total financial harm: $${totalHarm.toFixed(2)}`
    );

    // Step 7: Build calculation breakdown
    const breakdown: CalculationBreakdown = {
        delay_days: delay.delay_duration_days,
        units_per_day: adjustedUnitsPerDay,
        lost_units: lostUnits,
        unit_price: unitPrice,
        lost_revenue: lostRevenue,
        estimated_margin_percent: marginPercent * 100,
        lost_margin: lostMargin,
        capital_cost_rate: CAPITAL_COST_RATE * 100,
        opportunity_cost: opportunityCost,
        total_harm: totalHarm
    };

    // Step 8: Confidence scoring
    const confidence = calculateConfidence(delay, velocity, lostRevenue);

    // Step 9: Determine severity
    const severity = determineSeverity(totalHarm, delay.delay_duration_days, delay.is_resolved);

    // Step 10: Determine action
    const recommendedAction = determineAction(confidence.calculated_score, severity, totalHarm);

    // Step 11: Build claim justification
    const claimJustification = buildClaimJustification(delay, lostRevenue, lostUnits, velocity);

    const isOngoing = !delay.is_resolved || !delay.delay_end_date;

    return {
        seller_id: sellerId,
        sync_id: syncId,

        delay_event_id: delay.id,
        sku: delay.sku,
        asin: delay.asin,
        delay_type: delay.delay_type,

        delay_start: delay.delay_start_date,
        delay_end: delay.delay_end_date,
        delay_duration_days: delay.delay_duration_days,
        is_ongoing: isOngoing,

        quantity_affected: delay.quantity_affected,

        lost_units: lostUnits,
        lost_revenue: lostRevenue,
        lost_margin: lostMargin,
        opportunity_cost: opportunityCost,
        total_financial_harm: totalHarm,
        currency: 'USD',

        velocity_used: velocityUsed,
        units_per_day: adjustedUnitsPerDay,
        avg_unit_price: unitPrice,

        severity,

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        recommended_action: recommendedAction,
        claim_justification: claimJustification,

        evidence: {
            delay_event: delay,
            sales_velocity: velocity,
            calculation_breakdown: breakdown,
            detection_reasons: detectionReasons
        }
    };
}

// ============================================================================
// Velocity & Seasonality
// ============================================================================

/**
 * Select the best velocity metric to use
 */
function selectBestVelocity(velocity: SalesVelocity): {
    unitsPerDay: number;
    velocityUsed: 'daily_7d' | 'daily_30d' | 'daily_90d';
} {
    // Prefer 30d if stable (good balance of recency and stability)
    if (velocity.avg_daily_units_30d > 0 && velocity.sample_count >= 10) {
        return {
            unitsPerDay: velocity.avg_daily_units_30d,
            velocityUsed: 'daily_30d'
        };
    }

    // Use 7d if recent sales are higher (trending up)
    if (velocity.avg_daily_units_7d > velocity.avg_daily_units_30d) {
        return {
            unitsPerDay: velocity.avg_daily_units_7d,
            velocityUsed: 'daily_7d'
        };
    }

    // Fallback to 90d for stability
    if (velocity.avg_daily_units_90d > 0) {
        return {
            unitsPerDay: velocity.avg_daily_units_90d,
            velocityUsed: 'daily_90d'
        };
    }

    // Last resort: use whatever we have
    return {
        unitsPerDay: velocity.avg_daily_units_30d || velocity.avg_daily_units_7d || 0,
        velocityUsed: 'daily_30d'
    };
}

/**
 * Calculate seasonality factor
 */
function calculateSeasonalityFactor(month: number): number {
    if (PEAK_MONTHS.includes(month)) {
        return 1.5; // 50% boost during Q4
    }
    if (SLOW_MONTHS.includes(month)) {
        return 0.75; // 25% reduction post-holiday
    }
    return 1.0; // Normal
}

// ============================================================================
// Confidence & Classification
// ============================================================================

/**
 * Calculate confidence score
 */
function calculateConfidence(
    delay: DelayEvent,
    velocity: SalesVelocity,
    lostRevenue: number
): RevenueConfidenceFactors {
    let score = 0;

    // Stable velocity (+0.30)
    const stableVelocity = velocity.velocity_confidence >= 0.7 && velocity.sample_count >= 20;
    if (stableVelocity) score += 0.30;

    // Clear delay period (+0.25)
    const clearPeriod = delay.delay_duration_days >= MIN_DELAY_DAYS &&
        !!delay.delay_start_date;
    if (clearPeriod) score += 0.25;

    // Significant impact (+0.20)
    const significantImpact = lostRevenue >= 50;
    if (significantImpact) score += 0.20;

    // Documented cause (+0.15)
    const documentedCause = !!delay.case_id || !!delay.shipment_id;
    if (documentedCause) score += 0.15;

    // Historical pattern (+0.10)
    const historicalPattern = velocity.sample_count >= 30;
    if (historicalPattern) score += 0.10;

    return {
        stable_velocity: stableVelocity,
        clear_delay_period: clearPeriod,
        significant_impact: significantImpact,
        documented_cause: documentedCause,
        historical_pattern: historicalPattern,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Determine severity
 */
function determineSeverity(
    totalHarm: number,
    delayDays: number,
    isResolved: boolean
): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: High harm or ongoing long delay
    if (totalHarm >= 500 || (delayDays >= 30 && !isResolved)) {
        return 'critical';
    }

    // High: Significant harm or extended delay
    if (totalHarm >= 200 || delayDays >= 14) {
        return 'high';
    }

    // Medium: Notable harm
    if (totalHarm >= 50 || delayDays >= 7) {
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
    totalHarm: number
): DelayedRevenueResult['recommended_action'] {
    if (severity === 'critical' && confidence >= THRESHOLD_FILE_CLAIM) {
        return 'escalate_with_evidence';
    }
    if (confidence >= THRESHOLD_FILE_CLAIM || totalHarm >= 200) {
        return 'file_claim';
    }
    if (severity === 'medium' || totalHarm >= 50) {
        return 'document';
    }
    return 'monitor';
}

/**
 * Build compelling claim justification
 */
function buildClaimJustification(
    delay: DelayEvent,
    lostRevenue: number,
    lostUnits: number,
    velocity: SalesVelocity
): string {
    const delayTypeReadable = delay.delay_type.replace(/_/g, ' ');

    return `Due to ${delayTypeReadable} lasting ${delay.delay_duration_days} days ` +
        `(${delay.delay_start_date} to ${delay.delay_end_date || 'ongoing'}), ` +
        `we estimate ${lostUnits} lost sales based on historical velocity of ` +
        `${velocity.avg_daily_units_30d.toFixed(1)} units/day. ` +
        `This represents approximately $${lostRevenue.toFixed(2)} in lost revenue. ` +
        `We request compensation for the documented financial harm caused by this delay.`;
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch delay events from various sources
 */
export async function fetchDelayEvents(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<DelayEvent[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const events: DelayEvent[] = [];

    try {
        // Fetch from inventory issues (stranded, suppressed)
        const { data: issuesData, error: issuesError } = await supabaseAdmin
            .from('inventory_issues')
            .select('*')
            .eq('seller_id', sellerId)
            .gte('issue_date', cutoffDate.toISOString());

        if (!issuesError && issuesData) {
            for (const row of issuesData) {
                const durationDays = calculateDelayDuration(row.issue_date, row.resolved_date);

                events.push({
                    id: row.id,
                    seller_id: sellerId,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    delay_type: mapIssueTypeToDelayType(row.issue_type),
                    delay_start_date: row.issue_date,
                    delay_end_date: row.resolved_date,
                    delay_duration_days: durationDays,
                    quantity_affected: row.quantity || 1,
                    is_resolved: !!row.resolved_date,
                    resolution_type: row.resolution_type,
                    case_id: row.case_id
                });
            }
        }

        // Fetch from shipment delays
        const { data: shipmentsData, error: shipmentsError } = await supabaseAdmin
            .from('fba_shipments')
            .select('*')
            .eq('user_id', sellerId)
            .gte('created_at', cutoffDate.toISOString())
            .not('delay_days', 'is', null);

        if (!shipmentsError && shipmentsData) {
            for (const row of shipmentsData) {
                if (row.delay_days >= MIN_DELAY_DAYS) {
                    events.push({
                        id: row.id,
                        seller_id: sellerId,
                        sku: row.sku || 'MULTI-SKU',
                        asin: row.asin,
                        fnsku: row.fnsku,
                        delay_type: 'inbound_delay',
                        delay_start_date: row.shipped_date,
                        delay_end_date: row.received_date,
                        delay_duration_days: row.delay_days,
                        quantity_affected: row.quantity_shipped || 1,
                        is_resolved: row.status === 'CLOSED' || row.status === 'RECEIVED',
                        shipment_id: row.shipment_id
                    });
                }
            }
        }

        logger.info('📉 [DELAY-REVENUE] Fetched delay events', {
            sellerId,
            count: events.length
        });
    } catch (err: any) {
        logger.error('📉 [DELAY-REVENUE] Error fetching delay events', { error: err.message });
    }

    return events;
}

/**
 * Calculate delay duration in days
 */
function calculateDelayDuration(startDate: string, endDate?: string): number {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Map issue types to delay types
 */
function mapIssueTypeToDelayType(issueType: string): DelayType {
    const typeLower = (issueType || '').toLowerCase();

    if (typeLower.includes('suppress')) return 'listing_suppressed';
    if (typeLower.includes('strand')) return 'stranded_inventory';
    if (typeLower.includes('lost')) return 'inventory_trapped';
    if (typeLower.includes('transfer')) return 'transfer_delay';
    if (typeLower.includes('inbound')) return 'inbound_delay';
    if (typeLower.includes('restor')) return 'late_restoration';
    if (typeLower.includes('reactiv')) return 'delayed_reactivation';

    return 'inventory_trapped';
}

/**
 * Fetch sales velocity data
 */
export async function fetchSalesVelocity(
    sellerId: string,
    skus: string[]
): Promise<Map<string, SalesVelocity>> {
    const velocityMap = new Map<string, SalesVelocity>();

    if (skus.length === 0) return velocityMap;

    try {
        // Fetch from price history (has median prices)
        const { data: priceData, error: priceError } = await supabaseAdmin
            .from('product_price_history')
            .select('*')
            .eq('seller_id', sellerId)
            .in('sku', skus);

        // Fetch from orders to calculate velocity
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: ordersData, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('sku, quantity, order_date, item_price')
            .eq('user_id', sellerId)
            .in('sku', skus)
            .gte('order_date', thirtyDaysAgo.toISOString());

        // Calculate velocity per SKU
        const skuOrders = new Map<string, { count: number; revenue: number; days: Set<string> }>();

        if (!ordersError && ordersData) {
            for (const order of ordersData) {
                const existing = skuOrders.get(order.sku) || { count: 0, revenue: 0, days: new Set() };
                existing.count += order.quantity || 1;
                existing.revenue += parseFloat(order.item_price) || 0;
                existing.days.add(order.order_date.substring(0, 10));
                skuOrders.set(order.sku, existing);
            }
        }

        // Build velocity objects
        for (const sku of skus) {
            const orderData = skuOrders.get(sku);
            const priceRow = priceData?.find(p => p.sku === sku);

            const sampleCount = orderData?.count || 0;
            const avgDailyUnits = sampleCount / 30;
            const avgPrice = priceRow?.median_sale_price_30d ||
                (orderData?.revenue && sampleCount ? orderData.revenue / sampleCount : 20);

            velocityMap.set(sku, {
                sku,
                asin: priceRow?.asin,
                avg_daily_units_7d: avgDailyUnits * 1.1, // Assume slightly higher recent
                avg_daily_units_30d: avgDailyUnits,
                avg_daily_units_90d: avgDailyUnits * 0.95, // Slightly lower historical
                avg_unit_price_30d: avgPrice,
                avg_margin_30d: DEFAULT_MARGIN_PERCENT,
                seasonality_factor: 1.0,
                sample_count: sampleCount,
                velocity_confidence: sampleCount >= 10 ? 0.8 : sampleCount >= 5 ? 0.6 : 0.4
            });
        }

        logger.info('📉 [DELAY-REVENUE] Fetched sales velocity', {
            sellerId,
            skuCount: velocityMap.size
        });
    } catch (err: any) {
        logger.error('📉 [DELAY-REVENUE] Error fetching velocity', { error: err.message });
    }

    return velocityMap;
}

/**
 * Store delayed revenue impact results
 */
export async function storeDelayedRevenueResults(
    results: DelayedRevenueResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'delayed_revenue_impact',
            severity: r.severity,
            estimated_value: r.total_financial_harm,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                delay_event_id: r.delay_event_id,
                sku: r.sku,
                delay_type: r.delay_type,
                delay_duration_days: r.delay_duration_days,
                is_ongoing: r.is_ongoing,
                lost_units: r.lost_units,
                lost_revenue: r.lost_revenue,
                lost_margin: r.lost_margin,
                opportunity_cost: r.opportunity_cost,
                velocity_used: r.velocity_used,
                units_per_day: r.units_per_day,
                recommended_action: r.recommended_action,
                claim_justification: r.claim_justification,
                calculation_breakdown: r.evidence.calculation_breakdown
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('📉 [DELAY-REVENUE] Error storing results', { error: error.message });
        } else {
            logger.info('📉 [DELAY-REVENUE] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('📉 [DELAY-REVENUE] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Exports
// ============================================================================

export {
    THRESHOLD_SHOW_TO_USER,
    THRESHOLD_FILE_CLAIM,
    MIN_HARM_VALUE,
    MIN_DELAY_DAYS,
    DEFAULT_MARGIN_PERCENT,
    CAPITAL_COST_RATE
};
