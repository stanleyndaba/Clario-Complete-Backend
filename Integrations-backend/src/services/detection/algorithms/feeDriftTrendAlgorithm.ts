/**
 * Fee Drift Trend Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Slow Fee Overcharge Prevention
 * 
 * Problem: Amazon fee mistakes don't always happen instantly — they creep
 * 
 * This detects:
 * - Abnormal upward drift in fees over time
 * - Slow bleeding products with creeping costs
 * - Multi-month fee increases without cause
 * 
 * Prevents multi-month losses that go unnoticed.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface FeeHistoryPoint {
    date: string;
    sku: string;
    asin?: string;

    // Fee breakdown
    fulfillment_fee: number;
    storage_fee: number;
    referral_fee: number;
    total_fee: number;

    // Context
    unit_price?: number;
    quantity_sold?: number;
    fee_per_unit: number;
}

export interface FeeBaseline {
    sku: string;
    asin?: string;

    // Baseline metrics (from first period)
    baseline_period_start: string;
    baseline_period_end: string;
    baseline_avg_fee: number;
    baseline_median_fee: number;
    baseline_std_dev: number;

    // Current metrics
    current_period_start: string;
    current_period_end: string;
    current_avg_fee: number;
    current_median_fee: number;

    // Trend
    fee_change_percent: number;
    fee_change_absolute: number;
    is_upward_drift: boolean;

    // Data quality
    baseline_sample_count: number;
    current_sample_count: number;
}

export interface FeeDriftResult {
    seller_id: string;
    sync_id: string;

    // Product
    sku: string;
    asin?: string;
    product_name?: string;

    // Drift analysis
    drift_type: FeeDriftType;
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Baseline vs current
    baseline_fee: number;
    current_fee: number;
    drift_amount: number;
    drift_percent: number;

    // Time analysis
    drift_start_date: string;
    drift_duration_days: number;
    is_accelerating: boolean;

    // Financial impact
    monthly_overcharge: number;
    projected_annual_impact: number;
    cumulative_overcharge: number;
    currency: string;

    // Confidence
    confidence_score: number;
    confidence_factors: DriftConfidenceFactors;

    // Recommendation
    recommended_action: 'monitor' | 'investigate' | 'dispute' | 'file_claim';

    // Evidence
    evidence: {
        baseline: FeeBaseline;
        fee_history: FeeHistoryPoint[];
        trend_data: TrendDataPoint[];
        detection_reasons: string[];
    };
}

export type FeeDriftType =
    | 'gradual_increase'      // Slow steady climb
    | 'step_increase'         // Sudden jump not reversed
    | 'accelerating_drift'    // Getting worse over time
    | 'cyclical_inflation'    // Seasonal but not resetting
    | 'category_drift';       // Fee category changed

export interface DriftConfidenceFactors {
    sufficient_history: boolean;     // +0.30
    clear_upward_trend: boolean;     // +0.25
    no_product_change: boolean;      // +0.20
    significant_amount: boolean;     // +0.15
    consistent_pattern: boolean;     // +0.10
    calculated_score: number;
}

export interface TrendDataPoint {
    period: string;
    avg_fee: number;
    sample_count: number;
    change_from_baseline: number;
    change_percent: number;
}

export interface FeeDriftSyncedData {
    seller_id: string;
    sync_id: string;
    fee_history: FeeHistoryPoint[];
}

// ============================================================================
// Constants
// ============================================================================

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.55;
const THRESHOLD_DISPUTE = 0.75;
const MIN_DRIFT_PERCENT = 5; // 5% minimum drift
const MIN_MONTHLY_IMPACT = 10; // $10 minimum monthly impact
const MIN_BASELINE_SAMPLES = 10; // At least 10 data points for baseline
const BASELINE_DAYS = 30; // First 30 days = baseline
const MIN_HISTORY_DAYS = 45; // Need at least 45 days of data

// Statistical thresholds
const SIGNIFICANT_DEVIATION_MULTIPLIER = 2.0; // 2 standard deviations

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect fee drift trends
 */
export async function detectFeeDriftTrend(
    sellerId: string,
    syncId: string,
    data: FeeDriftSyncedData
): Promise<FeeDriftResult[]> {
    const results: FeeDriftResult[] = [];

    logger.info('📈 [FEE-DRIFT] Starting fee drift trend detection', {
        sellerId,
        syncId,
        feeHistoryCount: data.fee_history?.length || 0
    });

    if (!data.fee_history || data.fee_history.length < MIN_BASELINE_SAMPLES) {
        logger.info('📈 [FEE-DRIFT] Insufficient fee history for analysis');
        return results;
    }

    // Group by SKU
    const feesBySku = groupFeesBySku(data.fee_history);

    logger.info('📈 [FEE-DRIFT] Analyzing SKUs for drift', {
        skuCount: feesBySku.size
    });

    // Analyze each SKU
    for (const [sku, feeHistory] of feesBySku) {
        try {
            if (feeHistory.length < MIN_BASELINE_SAMPLES) continue;

            const drift = analyzeSkuForDrift(sellerId, syncId, sku, feeHistory);

            if (drift &&
                drift.monthly_overcharge >= MIN_MONTHLY_IMPACT &&
                drift.drift_percent >= MIN_DRIFT_PERCENT &&
                drift.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                results.push(drift);
            }
        } catch (error: any) {
            logger.warn('📈 [FEE-DRIFT] Error analyzing SKU', {
                sku,
                error: error.message
            });
        }
    }

    // Sort by projected annual impact
    results.sort((a, b) => b.projected_annual_impact - a.projected_annual_impact);

    const totalAnnualImpact = results.reduce((sum, r) => sum + r.projected_annual_impact, 0);
    const criticalCount = results.filter(r => r.severity === 'critical').length;

    logger.info('📈 [FEE-DRIFT] Detection complete', {
        sellerId,
        skusAnalyzed: feesBySku.size,
        driftsFound: results.length,
        criticalDrifts: criticalCount,
        totalAnnualImpact: totalAnnualImpact.toFixed(2)
    });

    return results;
}

/**
 * Analyze a single SKU for fee drift
 */
function analyzeSkuForDrift(
    sellerId: string,
    syncId: string,
    sku: string,
    feeHistory: FeeHistoryPoint[]
): FeeDriftResult | null {
    const detectionReasons: string[] = [];

    // Sort by date
    feeHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Check data span
    const firstDate = new Date(feeHistory[0].date);
    const lastDate = new Date(feeHistory[feeHistory.length - 1].date);
    const daySpan = Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daySpan < MIN_HISTORY_DAYS) {
        return null; // Not enough history
    }

    // Step 1: Build baseline from first period
    const baseline = buildBaseline(feeHistory);
    if (!baseline || baseline.baseline_sample_count < MIN_BASELINE_SAMPLES) {
        return null;
    }

    // Step 2: Calculate current period metrics
    const current = calculateCurrentPeriod(feeHistory, baseline);
    if (!current || current.sample_count < 5) {
        return null;
    }

    // Step 3: Calculate drift
    const driftAmount = current.avg_fee - baseline.baseline_avg_fee;
    const driftPercent = baseline.baseline_avg_fee > 0
        ? (driftAmount / baseline.baseline_avg_fee) * 100
        : 0;

    // Only report upward drift
    if (driftAmount <= 0 || driftPercent < MIN_DRIFT_PERCENT) {
        return null;
    }

    detectionReasons.push(
        `Baseline fee: $${baseline.baseline_avg_fee.toFixed(2)}`,
        `Current fee: $${current.avg_fee.toFixed(2)}`,
        `Drift: +${driftPercent.toFixed(1)}%`
    );

    // Step 4: Classify drift type
    const trendData = buildTrendData(feeHistory, baseline);
    const driftType = classifyDriftType(trendData, baseline, driftPercent);

    // Step 5: Check if accelerating
    const isAccelerating = checkAcceleration(trendData);
    if (isAccelerating) {
        detectionReasons.push('Drift is accelerating');
    }

    // Step 6: Calculate financial impact
    const monthlyVolume = calculateMonthlyVolume(feeHistory);
    const monthlyOvercharge = driftAmount * monthlyVolume;
    const projectedAnnual = monthlyOvercharge * 12;

    // Cumulative = overcharge per unit * total units since drift started
    const driftStartDate = findDriftStartDate(trendData, baseline);
    const driftDurationDays = Math.floor((lastDate.getTime() - new Date(driftStartDate).getTime()) / (1000 * 60 * 60 * 24));
    const cumulativeUnits = Math.round(monthlyVolume * (driftDurationDays / 30));
    const cumulativeOvercharge = driftAmount * cumulativeUnits;

    detectionReasons.push(
        `Monthly overcharge: $${monthlyOvercharge.toFixed(2)}`,
        `Projected annual impact: $${projectedAnnual.toFixed(2)}`
    );

    // Step 7: Confidence scoring
    const confidence = calculateDriftConfidence(
        baseline,
        driftPercent,
        trendData,
        monthlyOvercharge
    );

    // Step 8: Severity
    const severity = determineSeverity(projectedAnnual, driftPercent, isAccelerating);

    // Step 9: Action
    const recommendedAction = determineAction(confidence.calculated_score, severity);

    // Update baseline with current data
    const fullBaseline: FeeBaseline = {
        sku,
        asin: feeHistory[0].asin,
        baseline_period_start: baseline.start,
        baseline_period_end: baseline.end,
        baseline_avg_fee: baseline.baseline_avg_fee,
        baseline_median_fee: baseline.baseline_median_fee,
        baseline_std_dev: baseline.std_dev,
        current_period_start: current.start,
        current_period_end: current.end,
        current_avg_fee: current.avg_fee,
        current_median_fee: current.median_fee,
        fee_change_percent: driftPercent,
        fee_change_absolute: driftAmount,
        is_upward_drift: true,
        baseline_sample_count: baseline.baseline_sample_count,
        current_sample_count: current.sample_count
    };

    return {
        seller_id: sellerId,
        sync_id: syncId,

        sku,
        asin: feeHistory[0].asin,

        drift_type: driftType,
        severity,

        baseline_fee: baseline.baseline_avg_fee,
        current_fee: current.avg_fee,
        drift_amount: driftAmount,
        drift_percent: driftPercent,

        drift_start_date: driftStartDate,
        drift_duration_days: driftDurationDays,
        is_accelerating: isAccelerating,

        monthly_overcharge: monthlyOvercharge,
        projected_annual_impact: projectedAnnual,
        cumulative_overcharge: cumulativeOvercharge,
        currency: 'USD',

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        recommended_action: recommendedAction,

        evidence: {
            baseline: fullBaseline,
            fee_history: feeHistory.slice(-20), // Last 20 points
            trend_data: trendData,
            detection_reasons: detectionReasons
        }
    };
}

// ============================================================================
// Baseline & Trend Building
// ============================================================================

/**
 * Build baseline from first period
 */
function buildBaseline(feeHistory: FeeHistoryPoint[]): {
    baseline_avg_fee: number;
    baseline_median_fee: number;
    baseline_sample_count: number;
    std_dev: number;
    start: string;
    end: string;
} | null {
    const firstDate = new Date(feeHistory[0].date);
    const baselineEnd = new Date(firstDate);
    baselineEnd.setDate(baselineEnd.getDate() + BASELINE_DAYS);

    const baselineFees = feeHistory
        .filter(f => new Date(f.date) <= baselineEnd)
        .map(f => f.fee_per_unit);

    if (baselineFees.length < MIN_BASELINE_SAMPLES) {
        return null;
    }

    const avg = baselineFees.reduce((sum, f) => sum + f, 0) / baselineFees.length;
    const sorted = [...baselineFees].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // Standard deviation
    const squaredDiffs = baselineFees.map(f => Math.pow(f - avg, 2));
    const stdDev = Math.sqrt(squaredDiffs.reduce((sum, d) => sum + d, 0) / baselineFees.length);

    return {
        baseline_avg_fee: avg,
        baseline_median_fee: median,
        baseline_sample_count: baselineFees.length,
        std_dev: stdDev,
        start: feeHistory[0].date,
        end: baselineEnd.toISOString()
    };
}

/**
 * Calculate current period metrics
 */
function calculateCurrentPeriod(
    feeHistory: FeeHistoryPoint[],
    baseline: { baseline_avg_fee: number; end: string }
): {
    avg_fee: number;
    median_fee: number;
    sample_count: number;
    start: string;
    end: string;
} | null {
    const lastDate = new Date(feeHistory[feeHistory.length - 1].date);
    const currentStart = new Date(lastDate);
    currentStart.setDate(currentStart.getDate() - 30); // Last 30 days

    const currentFees = feeHistory
        .filter(f => new Date(f.date) >= currentStart)
        .map(f => f.fee_per_unit);

    if (currentFees.length < 5) {
        return null;
    }

    const avg = currentFees.reduce((sum, f) => sum + f, 0) / currentFees.length;
    const sorted = [...currentFees].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    return {
        avg_fee: avg,
        median_fee: median,
        sample_count: currentFees.length,
        start: currentStart.toISOString(),
        end: lastDate.toISOString()
    };
}

/**
 * Build trend data by week
 */
function buildTrendData(
    feeHistory: FeeHistoryPoint[],
    baseline: { baseline_avg_fee: number }
): TrendDataPoint[] {
    const trendData: TrendDataPoint[] = [];

    // Group by week
    const byWeek = new Map<string, number[]>();

    for (const fee of feeHistory) {
        const date = new Date(fee.date);
        const weekStart = new Date(date);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekKey = weekStart.toISOString().substring(0, 10);

        const existing = byWeek.get(weekKey) || [];
        existing.push(fee.fee_per_unit);
        byWeek.set(weekKey, existing);
    }

    // Convert to trend points
    for (const [week, fees] of byWeek) {
        const avg = fees.reduce((sum, f) => sum + f, 0) / fees.length;
        const change = avg - baseline.baseline_avg_fee;
        const changePercent = baseline.baseline_avg_fee > 0
            ? (change / baseline.baseline_avg_fee) * 100
            : 0;

        trendData.push({
            period: week,
            avg_fee: avg,
            sample_count: fees.length,
            change_from_baseline: change,
            change_percent: changePercent
        });
    }

    return trendData.sort((a, b) => a.period.localeCompare(b.period));
}

// ============================================================================
// Classification
// ============================================================================

/**
 * Classify drift type
 */
function classifyDriftType(
    trendData: TrendDataPoint[],
    baseline: { std_dev: number },
    driftPercent: number
): FeeDriftType {
    if (trendData.length < 3) return 'gradual_increase';

    // Check for step increase (sudden jump)
    let maxJump = 0;
    for (let i = 1; i < trendData.length; i++) {
        const jump = trendData[i].avg_fee - trendData[i - 1].avg_fee;
        if (jump > maxJump) maxJump = jump;
    }

    if (maxJump > baseline.std_dev * 3) {
        return 'step_increase';
    }

    // Check for acceleration
    const firstHalfAvg = trendData.slice(0, Math.floor(trendData.length / 2))
        .reduce((sum, t) => sum + t.change_percent, 0) / Math.floor(trendData.length / 2);
    const secondHalfAvg = trendData.slice(Math.floor(trendData.length / 2))
        .reduce((sum, t) => sum + t.change_percent, 0) / Math.ceil(trendData.length / 2);

    if (secondHalfAvg > firstHalfAvg * 1.5) {
        return 'accelerating_drift';
    }

    return 'gradual_increase';
}

/**
 * Check if drift is accelerating
 */
function checkAcceleration(trendData: TrendDataPoint[]): boolean {
    if (trendData.length < 4) return false;

    const recentTrend = trendData.slice(-3);
    const olderTrend = trendData.slice(-6, -3);

    if (olderTrend.length < 2) return false;

    const recentAvgChange = recentTrend.reduce((sum, t) => sum + t.change_percent, 0) / recentTrend.length;
    const olderAvgChange = olderTrend.reduce((sum, t) => sum + t.change_percent, 0) / olderTrend.length;

    return recentAvgChange > olderAvgChange * 1.3; // 30% acceleration
}

/**
 * Find when drift started
 */
function findDriftStartDate(
    trendData: TrendDataPoint[],
    baseline: { baseline_avg_fee: number; std_dev: number }
): string {
    const threshold = baseline.baseline_avg_fee + baseline.std_dev * SIGNIFICANT_DEVIATION_MULTIPLIER;

    for (const point of trendData) {
        if (point.avg_fee > threshold) {
            return point.period;
        }
    }

    return trendData[0]?.period || new Date().toISOString();
}

/**
 * Calculate monthly volume
 */
function calculateMonthlyVolume(feeHistory: FeeHistoryPoint[]): number {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentFees = feeHistory.filter(f => new Date(f.date) >= thirtyDaysAgo);
    return recentFees.reduce((sum, f) => sum + (f.quantity_sold || 1), 0);
}

// ============================================================================
// Confidence & Severity
// ============================================================================

/**
 * Calculate confidence score
 */
function calculateDriftConfidence(
    baseline: { baseline_sample_count: number; std_dev: number },
    driftPercent: number,
    trendData: TrendDataPoint[],
    monthlyOvercharge: number
): DriftConfidenceFactors {
    let score = 0;

    // Sufficient history (+0.30)
    const sufficientHistory = baseline.baseline_sample_count >= 20 && trendData.length >= 6;
    if (sufficientHistory) score += 0.30;

    // Clear upward trend (+0.25)
    const upwardTrend = trendData.filter(t => t.change_percent > 0).length / trendData.length >= 0.7;
    if (upwardTrend) score += 0.25;

    // No product change (assume true, could check dimensions) (+0.20)
    const noProductChange = true;
    if (noProductChange) score += 0.20;

    // Significant amount (+0.15)
    const significantAmount = monthlyOvercharge >= 25;
    if (significantAmount) score += 0.15;

    // Consistent pattern (+0.10)
    const consistentPattern = baseline.std_dev / baseline.baseline_sample_count < 0.3;
    if (consistentPattern) score += 0.10;

    return {
        sufficient_history: sufficientHistory,
        clear_upward_trend: upwardTrend,
        no_product_change: noProductChange,
        significant_amount: significantAmount,
        consistent_pattern: consistentPattern,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Determine severity
 */
function determineSeverity(
    projectedAnnual: number,
    driftPercent: number,
    isAccelerating: boolean
): 'low' | 'medium' | 'high' | 'critical' {
    if (projectedAnnual >= 500 || (driftPercent >= 20 && isAccelerating)) {
        return 'critical';
    }
    if (projectedAnnual >= 200 || driftPercent >= 15) {
        return 'high';
    }
    if (projectedAnnual >= 50 || driftPercent >= 10) {
        return 'medium';
    }
    return 'low';
}

/**
 * Determine action
 */
function determineAction(
    confidence: number,
    severity: 'low' | 'medium' | 'high' | 'critical'
): FeeDriftResult['recommended_action'] {
    if (severity === 'critical' && confidence >= THRESHOLD_DISPUTE) {
        return 'file_claim';
    }
    if (confidence >= THRESHOLD_DISPUTE || severity === 'high') {
        return 'dispute';
    }
    if (severity === 'medium') {
        return 'investigate';
    }
    return 'monitor';
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group fees by SKU
 */
function groupFeesBySku(feeHistory: FeeHistoryPoint[]): Map<string, FeeHistoryPoint[]> {
    const map = new Map<string, FeeHistoryPoint[]>();

    for (const fee of feeHistory) {
        const existing = map.get(fee.sku) || [];
        existing.push(fee);
        map.set(fee.sku, existing);
    }

    return map;
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch fee history
 */
export async function fetchFeeHistoryForDrift(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<FeeHistoryPoint[]> {
    const lookbackDays = options.lookbackDays || 180; // 6 months default
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const feeHistory: FeeHistoryPoint[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('settlements')
            .select('*')
            .eq('user_id', sellerId)
            .in('transaction_type', ['FBA fees', 'FBAPerUnitFulfillmentFee', 'FBAStorageFee'])
            .gte('settlement_date', cutoffDate.toISOString())
            .order('settlement_date', { ascending: true });

        if (!error && data) {
            for (const row of data) {
                const amount = Math.abs(parseFloat(row.amount) || 0);
                const qty = row.quantity || 1;

                feeHistory.push({
                    date: row.settlement_date,
                    sku: row.sku,
                    asin: row.asin,
                    fulfillment_fee: amount * 0.6, // Estimate split
                    storage_fee: amount * 0.2,
                    referral_fee: amount * 0.2,
                    total_fee: amount,
                    unit_price: row.metadata?.unit_price,
                    quantity_sold: qty,
                    fee_per_unit: qty > 0 ? amount / qty : amount
                });
            }
        }

        logger.info('📈 [FEE-DRIFT] Fetched fee history', {
            sellerId,
            count: feeHistory.length
        });
    } catch (err: any) {
        logger.error('📈 [FEE-DRIFT] Error fetching fee history', { error: err.message });
    }

    return feeHistory;
}

/**
 * Store drift detection results
 */
export async function storeFeeDriftResults(
    results: FeeDriftResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'fee_drift_trend',
            severity: r.severity,
            estimated_value: r.projected_annual_impact,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                sku: r.sku,
                drift_type: r.drift_type,
                baseline_fee: r.baseline_fee,
                current_fee: r.current_fee,
                drift_percent: r.drift_percent,
                drift_duration_days: r.drift_duration_days,
                is_accelerating: r.is_accelerating,
                monthly_overcharge: r.monthly_overcharge,
                cumulative_overcharge: r.cumulative_overcharge,
                recommended_action: r.recommended_action,
                detection_reasons: r.evidence.detection_reasons,
                trend_data: r.evidence.trend_data
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('📈 [FEE-DRIFT] Error storing results', { error: error.message });
        } else {
            logger.info('📈 [FEE-DRIFT] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('📈 [FEE-DRIFT] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Exports
// ============================================================================

export {
    THRESHOLD_SHOW_TO_USER,
    THRESHOLD_DISPUTE,
    MIN_DRIFT_PERCENT,
    BASELINE_DAYS
};
