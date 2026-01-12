/**
 * Silent Suppression / Listing Shadowban Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Visibility Intelligence
 * 
 * Problem: Listing technically active... but Amazon quietly suppresses exposure
 * - Buy box rotation vanished
 * - Search ranking crash
 * - FBA eligibility glitch
 * 
 * Connects: Traffic drops, sales collapse, system flags, known triggers
 * Outcome: Turns chaos → actionable case
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ListingPerformance {
    id: string;
    seller_id: string;
    sku: string;
    asin?: string;

    // Current state
    listing_status: 'active' | 'inactive' | 'suppressed' | 'stranded';
    buybox_eligible: boolean;
    buybox_percentage: number;  // 0-100
    is_fba_eligible: boolean;

    // Historical performance (daily data points)
    daily_metrics: DailyMetric[];

    // Flags
    has_listing_issues: boolean;
    issue_types: string[];

    // Product info
    product_name?: string;
    category?: string;
}

export interface DailyMetric {
    date: string;
    units_sold: number;
    page_views?: number;
    sessions?: number;
    conversion_rate?: number;
    buybox_percentage: number;
    search_rank?: number;
}

export interface SuppressionResult {
    seller_id: string;
    sync_id: string;

    // Listing
    sku: string;
    asin?: string;
    product_name?: string;

    // Suppression classification
    suppression_type: SuppressionType;
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Detection signals
    signals: SuppressionSignal[];
    signal_count: number;

    // Impact
    sales_drop_percent: number;
    buybox_drop_percent: number;
    estimated_daily_loss: number;
    estimated_weekly_loss: number;
    currency: string;

    // Timeline
    suppression_start_date: string;
    days_suppressed: number;

    // Confidence
    confidence_score: number;

    // Action
    recommended_action: 'monitor' | 'investigate' | 'fix_issue' | 'open_case';
    likely_cause: string;

    evidence: {
        performance: ListingPerformance;
        baseline_metrics: BaselineMetrics;
        current_metrics: CurrentMetrics;
        detection_reasons: string[];
    };
}

export type SuppressionType =
    | 'buybox_lost'             // Lost buy box
    | 'search_visibility_drop'  // Search rank crashed
    | 'fba_eligibility_lost'    // FBA removed
    | 'traffic_suppression'     // Views dropped
    | 'shadow_suppression'      // Active but hidden
    | 'algorithmic_demotion';   // Deprioritized

export interface SuppressionSignal {
    signal_type: string;
    description: string;
    severity: number;  // 1-10
    evidence: string;
}

export interface BaselineMetrics {
    period: string;
    avg_daily_sales: number;
    avg_buybox_percent: number;
    avg_page_views?: number;
    avg_conversion?: number;
}

export interface CurrentMetrics {
    period: string;
    avg_daily_sales: number;
    avg_buybox_percent: number;
    avg_page_views?: number;
    avg_conversion?: number;
}

// ============================================================================
// Constants
// ============================================================================

const THRESHOLD_SHOW = 0.55;
const MIN_LOSS_VALUE = 20;
const BASELINE_DAYS = 30;
const CURRENT_WINDOW = 7;

// Suppression thresholds
const SALES_DROP_THRESHOLD = 50;   // 50% drop
const BUYBOX_DROP_THRESHOLD = 30;  // 30% drop
const TRAFFIC_DROP_THRESHOLD = 40; // 40% drop

// Known suppression triggers
const SUPPRESSION_TRIGGERS = [
    'pricing_error',
    'policy_violation',
    'authenticity_complaint',
    'ip_complaint',
    'customer_complaints',
    'inventory_issue',
    'listing_quality',
    'category_issue'
];

// ============================================================================
// Core Detection
// ============================================================================

export async function detectSilentSuppression(
    sellerId: string,
    syncId: string,
    listings: ListingPerformance[]
): Promise<SuppressionResult[]> {
    const results: SuppressionResult[] = [];

    logger.info('🔇 [SUPPRESSION] Starting silent suppression detection', {
        sellerId, syncId, listingCount: listings.length
    });

    for (const listing of listings) {
        if (listing.daily_metrics.length < 14) continue; // Need history

        const analysis = analyzeListingForSuppression(sellerId, syncId, listing);

        if (analysis &&
            analysis.confidence_score >= THRESHOLD_SHOW &&
            analysis.estimated_weekly_loss >= MIN_LOSS_VALUE) {
            results.push(analysis);
        }
    }

    results.sort((a, b) => b.estimated_weekly_loss - a.estimated_weekly_loss);

    logger.info('🔇 [SUPPRESSION] Detection complete', {
        sellerId,
        suppressionsFound: results.length,
        criticalCount: results.filter(r => r.severity === 'critical').length,
        totalWeeklyLoss: results.reduce((sum, r) => sum + r.estimated_weekly_loss, 0).toFixed(2)
    });

    return results;
}

function analyzeListingForSuppression(
    sellerId: string,
    syncId: string,
    listing: ListingPerformance
): SuppressionResult | null {
    const signals: SuppressionSignal[] = [];
    const detectionReasons: string[] = [];

    // Sort metrics by date
    const metrics = [...listing.daily_metrics].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Calculate baseline (first 30 days or available)
    const baselineMetrics = metrics.slice(0, Math.min(BASELINE_DAYS, metrics.length - CURRENT_WINDOW));
    const currentMetrics = metrics.slice(-CURRENT_WINDOW);

    if (baselineMetrics.length < 7 || currentMetrics.length < 3) {
        return null;
    }

    const baseline = calculateAverages(baselineMetrics);
    const current = calculateAverages(currentMetrics);

    // Signal 1: Sales drop
    const salesDropPercent = baseline.avg_daily_sales > 0
        ? ((baseline.avg_daily_sales - current.avg_daily_sales) / baseline.avg_daily_sales) * 100
        : 0;

    if (salesDropPercent >= SALES_DROP_THRESHOLD) {
        signals.push({
            signal_type: 'sales_collapse',
            description: `Sales dropped ${salesDropPercent.toFixed(0)}% from baseline`,
            severity: Math.min(10, Math.floor(salesDropPercent / 10)),
            evidence: `Baseline: ${baseline.avg_daily_sales.toFixed(1)}/day → Current: ${current.avg_daily_sales.toFixed(1)}/day`
        });
        detectionReasons.push(`Sales collapsed by ${salesDropPercent.toFixed(0)}%`);
    }

    // Signal 2: Buy box loss
    const buyboxDropPercent = baseline.avg_buybox_percent - current.avg_buybox_percent;
    if (buyboxDropPercent >= BUYBOX_DROP_THRESHOLD) {
        signals.push({
            signal_type: 'buybox_lost',
            description: `Buy box dropped from ${baseline.avg_buybox_percent.toFixed(0)}% to ${current.avg_buybox_percent.toFixed(0)}%`,
            severity: Math.min(10, Math.floor(buyboxDropPercent / 10)),
            evidence: `Lost ${buyboxDropPercent.toFixed(0)}% buy box share`
        });
        detectionReasons.push(`Buy box dropped ${buyboxDropPercent.toFixed(0)}%`);
    }

    // Signal 3: Traffic/views drop (if available)
    if (baseline.avg_page_views && current.avg_page_views) {
        const trafficDropPercent = ((baseline.avg_page_views - current.avg_page_views) / baseline.avg_page_views) * 100;
        if (trafficDropPercent >= TRAFFIC_DROP_THRESHOLD) {
            signals.push({
                signal_type: 'traffic_suppression',
                description: `Page views dropped ${trafficDropPercent.toFixed(0)}%`,
                severity: Math.min(10, Math.floor(trafficDropPercent / 10)),
                evidence: `Baseline: ${baseline.avg_page_views?.toFixed(0)}/day → Current: ${current.avg_page_views?.toFixed(0)}/day`
            });
            detectionReasons.push(`Traffic suppressed by ${trafficDropPercent.toFixed(0)}%`);
        }
    }

    // Signal 4: FBA eligibility lost
    if (!listing.is_fba_eligible && listing.listing_status === 'active') {
        signals.push({
            signal_type: 'fba_eligibility_lost',
            description: 'FBA eligibility removed while listing active',
            severity: 7,
            evidence: 'Listing active but not FBA eligible'
        });
        detectionReasons.push('FBA eligibility lost');
    }

    // Signal 5: Known issue flags
    if (listing.has_listing_issues && listing.issue_types.length > 0) {
        const matchingTriggers = listing.issue_types.filter(t =>
            SUPPRESSION_TRIGGERS.some(trigger => t.toLowerCase().includes(trigger))
        );
        if (matchingTriggers.length > 0) {
            signals.push({
                signal_type: 'known_suppression_trigger',
                description: `Known suppression triggers: ${matchingTriggers.join(', ')}`,
                severity: 6,
                evidence: listing.issue_types.join(', ')
            });
            detectionReasons.push(`Known suppression trigger: ${matchingTriggers[0]}`);
        }
    }

    // Signal 6: Active but zero sales
    if (listing.listing_status === 'active' && current.avg_daily_sales === 0 && baseline.avg_daily_sales > 0.5) {
        signals.push({
            signal_type: 'shadow_suppression',
            description: 'Active listing with zero sales despite historical performance',
            severity: 9,
            evidence: `Was selling ${baseline.avg_daily_sales.toFixed(1)}/day, now zero`
        });
        detectionReasons.push('Active listing with zero sales (shadow ban suspected)');
    }

    // Need at least 2 signals for suppression
    if (signals.length < 2 && salesDropPercent < 70) {
        return null;
    }

    // Classify suppression type
    const suppressionType = classifySuppressionType(signals, listing);

    // Estimate financial impact
    const dailyLoss = Math.max(0, (baseline.avg_daily_sales - current.avg_daily_sales)) *
        (listing.daily_metrics[0]?.units_sold > 0 ? 20 : 15); // Estimate unit value
    const weeklyLoss = dailyLoss * 7;

    // Find suppression start
    const startDate = findSuppressionStart(metrics, baseline);
    const daysSuppressed = Math.floor((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));

    // Calculate confidence
    const confidence = calculateSuppressionConfidence(signals, salesDropPercent, buyboxDropPercent);

    // Determine cause and action
    const likelyCause = determineLikelyCause(signals, listing);
    const severity = determineSeverity(signals, weeklyLoss, daysSuppressed);
    const action = determineAction(severity, signals.length);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        sku: listing.sku,
        asin: listing.asin,
        product_name: listing.product_name,

        suppression_type: suppressionType,
        severity,

        signals,
        signal_count: signals.length,

        sales_drop_percent: salesDropPercent,
        buybox_drop_percent: buyboxDropPercent,
        estimated_daily_loss: dailyLoss,
        estimated_weekly_loss: weeklyLoss,
        currency: 'USD',

        suppression_start_date: startDate,
        days_suppressed: daysSuppressed,

        confidence_score: confidence,

        recommended_action: action,
        likely_cause: likelyCause,

        evidence: {
            performance: listing,
            baseline_metrics: {
                period: `${BASELINE_DAYS} days baseline`,
                avg_daily_sales: baseline.avg_daily_sales,
                avg_buybox_percent: baseline.avg_buybox_percent,
                avg_page_views: baseline.avg_page_views,
                avg_conversion: baseline.avg_conversion
            },
            current_metrics: {
                period: `Last ${CURRENT_WINDOW} days`,
                avg_daily_sales: current.avg_daily_sales,
                avg_buybox_percent: current.avg_buybox_percent,
                avg_page_views: current.avg_page_views,
                avg_conversion: current.avg_conversion
            },
            detection_reasons: detectionReasons
        }
    };
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateAverages(metrics: DailyMetric[]): {
    avg_daily_sales: number;
    avg_buybox_percent: number;
    avg_page_views?: number;
    avg_conversion?: number;
} {
    const count = metrics.length;
    if (count === 0) return { avg_daily_sales: 0, avg_buybox_percent: 0 };

    const totalSales = metrics.reduce((sum, m) => sum + m.units_sold, 0);
    const totalBuybox = metrics.reduce((sum, m) => sum + m.buybox_percentage, 0);
    const totalViews = metrics.reduce((sum, m) => sum + (m.page_views || 0), 0);
    const totalConversion = metrics.reduce((sum, m) => sum + (m.conversion_rate || 0), 0);

    return {
        avg_daily_sales: totalSales / count,
        avg_buybox_percent: totalBuybox / count,
        avg_page_views: totalViews > 0 ? totalViews / count : undefined,
        avg_conversion: totalConversion > 0 ? totalConversion / count : undefined
    };
}

function classifySuppressionType(
    signals: SuppressionSignal[],
    listing: ListingPerformance
): SuppressionType {
    const signalTypes = signals.map(s => s.signal_type);

    if (signalTypes.includes('shadow_suppression')) return 'shadow_suppression';
    if (signalTypes.includes('buybox_lost')) return 'buybox_lost';
    if (signalTypes.includes('traffic_suppression')) return 'traffic_suppression';
    if (signalTypes.includes('fba_eligibility_lost')) return 'fba_eligibility_lost';
    if (signalTypes.includes('search_rank_drop')) return 'search_visibility_drop';

    return 'algorithmic_demotion';
}

function findSuppressionStart(metrics: DailyMetric[], baseline: { avg_daily_sales: number }): string {
    // Find first day where sales dropped below 50% of baseline
    const threshold = baseline.avg_daily_sales * 0.5;

    for (let i = Math.floor(metrics.length / 2); i < metrics.length; i++) {
        if (metrics[i].units_sold < threshold) {
            return metrics[i].date;
        }
    }

    return metrics[Math.floor(metrics.length * 0.75)]?.date || new Date().toISOString();
}

function calculateSuppressionConfidence(
    signals: SuppressionSignal[],
    salesDrop: number,
    buyboxDrop: number
): number {
    let score = 0;

    // Signal count (+0.15 each, max 0.45)
    score += Math.min(0.45, signals.length * 0.15);

    // Sales drop severity (+0.25)
    if (salesDrop >= 70) score += 0.25;
    else if (salesDrop >= 50) score += 0.15;

    // Buybox drop (+0.20)
    if (buyboxDrop >= 50) score += 0.20;
    else if (buyboxDrop >= 30) score += 0.10;

    // High severity signals (+0.10)
    if (signals.some(s => s.severity >= 8)) score += 0.10;

    return Math.min(1, score);
}

function determineLikelyCause(signals: SuppressionSignal[], listing: ListingPerformance): string {
    if (signals.some(s => s.signal_type === 'known_suppression_trigger')) {
        return listing.issue_types[0] || 'Known policy issue';
    }
    if (signals.some(s => s.signal_type === 'buybox_lost')) {
        return 'Competitive pricing or seller metrics issue';
    }
    if (signals.some(s => s.signal_type === 'fba_eligibility_lost')) {
        return 'FBA eligibility issue - check inventory status';
    }
    if (signals.some(s => s.signal_type === 'shadow_suppression')) {
        return 'Possible algorithmic suppression - needs investigation';
    }
    return 'Unknown cause - recommend opening case with Amazon';
}

function determineSeverity(
    signals: SuppressionSignal[],
    weeklyLoss: number,
    daysSuppressed: number
): 'low' | 'medium' | 'high' | 'critical' {
    if (weeklyLoss >= 500 || signals.some(s => s.severity >= 9)) return 'critical';
    if (weeklyLoss >= 200 || daysSuppressed >= 14 || signals.length >= 4) return 'high';
    if (weeklyLoss >= 50 || signals.length >= 3) return 'medium';
    return 'low';
}

function determineAction(
    severity: 'low' | 'medium' | 'high' | 'critical',
    signalCount: number
): SuppressionResult['recommended_action'] {
    if (severity === 'critical') return 'open_case';
    if (severity === 'high' || signalCount >= 4) return 'fix_issue';
    if (severity === 'medium') return 'investigate';
    return 'monitor';
}

// ============================================================================
// Database Functions
// ============================================================================

export async function fetchListingPerformance(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<ListingPerformance[]> {
    const lookbackDays = options.lookbackDays || 60;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const listings: ListingPerformance[] = [];

    try {
        // Fetch listings with current status
        const { data: listingsData, error: listingsError } = await supabaseAdmin
            .from('listings')
            .select('*')
            .eq('seller_id', sellerId);

        if (listingsError || !listingsData) {
            logger.warn('🔇 [SUPPRESSION] No listings found', { sellerId });
            return listings;
        }

        // Fetch daily performance metrics
        const { data: metricsData, error: metricsError } = await supabaseAdmin
            .from('daily_sales_metrics')
            .select('*')
            .eq('seller_id', sellerId)
            .gte('date', cutoffDate.toISOString())
            .order('date', { ascending: true });

        // Group metrics by SKU
        const metricsBySku = new Map<string, DailyMetric[]>();
        if (!metricsError && metricsData) {
            for (const row of metricsData) {
                const existing = metricsBySku.get(row.sku) || [];
                existing.push({
                    date: row.date,
                    units_sold: row.units_sold || 0,
                    page_views: row.page_views,
                    sessions: row.sessions,
                    conversion_rate: row.conversion_rate,
                    buybox_percentage: row.buybox_percentage || 0,
                    search_rank: row.search_rank
                });
                metricsBySku.set(row.sku, existing);
            }
        }

        // Build listing performance objects
        for (const listing of listingsData) {
            const dailyMetrics = metricsBySku.get(listing.sku) || [];

            listings.push({
                id: listing.id,
                seller_id: sellerId,
                sku: listing.sku,
                asin: listing.asin,
                listing_status: listing.status || 'active',
                buybox_eligible: listing.buybox_eligible ?? true,
                buybox_percentage: listing.buybox_percentage || 0,
                is_fba_eligible: listing.fba_eligible ?? true,
                daily_metrics: dailyMetrics,
                has_listing_issues: (listing.issue_count || 0) > 0,
                issue_types: listing.issue_types || [],
                product_name: listing.product_name,
                category: listing.category
            });
        }

        logger.info('🔇 [SUPPRESSION] Fetched listing performance', {
            sellerId,
            listingCount: listings.length,
            withMetrics: listings.filter(l => l.daily_metrics.length > 0).length
        });
    } catch (err: any) {
        logger.error('🔇 [SUPPRESSION] Error fetching listings', { error: err.message });
    }

    return listings;
}

export async function storeSuppressionResults(results: SuppressionResult[]): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'silent_suppression',
            severity: r.severity,
            estimated_value: r.estimated_weekly_loss * 4, // Monthly impact
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                sku: r.sku,
                asin: r.asin,
                suppression_type: r.suppression_type,
                signals: r.signals,
                sales_drop_percent: r.sales_drop_percent,
                buybox_drop_percent: r.buybox_drop_percent,
                days_suppressed: r.days_suppressed,
                likely_cause: r.likely_cause,
                recommended_action: r.recommended_action,
                detection_reasons: r.evidence.detection_reasons
            },
            status: 'pending'
        }));

        await supabaseAdmin.from('detection_results').insert(records);
        logger.info('🔇 [SUPPRESSION] Stored results', { count: records.length });
    } catch (err: any) {
        logger.error('🔇 [SUPPRESSION] Error storing results', { error: err.message });
    }
}

export { THRESHOLD_SHOW, MIN_LOSS_VALUE, SALES_DROP_THRESHOLD, BUYBOX_DROP_THRESHOLD };
