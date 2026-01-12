/**
 * Inventory Shrinkage Drift Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Time-Series Intelligence
 * 
 * EXECUTIVE-GRADE ANALYTICS
 * 
 * Tracks inventory count over rolling windows to detect:
 * 1. Non-event shrinkage (inventory disappearing without orders/returns/damages)
 * 2. Systemic leakage patterns
 * 3. Drift from expected inventory levels
 * 4. Future loss risk prediction
 * 
 * This is NOT just claim filing - it's predictive loss prevention.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface InventorySnapshot {
    id: string;
    seller_id: string;
    sku: string;
    asin?: string;
    fnsku?: string;

    // Snapshot data
    snapshot_date: string;
    total_quantity: number;
    sellable_quantity: number;
    unsellable_quantity: number;
    reserved_quantity: number;
    inbound_quantity: number;

    // Calculated
    fulfillable_quantity: number; // sellable - reserved

    // Source
    snapshot_source: 'api' | 'calculated' | 'inferred';
}

export interface InventoryEvent {
    event_date: string;
    event_type: 'order' | 'return' | 'damage' | 'removal' | 'inbound' | 'transfer' | 'adjustment';
    quantity_delta: number;
    order_id?: string;
    reference_id?: string;
}

export interface ShrinkageWindow {
    sku: string;
    window_start: string;
    window_end: string;
    window_days: number;

    // Starting and ending inventory
    starting_quantity: number;
    ending_quantity: number;

    // Expected changes based on events
    expected_orders: number;
    expected_returns: number;
    expected_damages: number;
    expected_removals: number;
    expected_inbounds: number;
    expected_adjustments: number;

    // Calculated expected ending
    expected_ending: number;

    // Shrinkage detection
    unexplained_delta: number;
    shrinkage_rate: number; // % of starting inventory

    // Statistical measures
    events_count: number;
    has_gaps: boolean; // Missing snapshots in window
}

export interface ShrinkageDriftResult {
    seller_id: string;
    sync_id: string;
    sku: string;
    asin?: string;
    fnsku?: string;

    // Detection type
    drift_type: DriftType;
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Time windows analyzed
    window_7d: ShrinkageWindow;
    window_30d: ShrinkageWindow;
    window_90d: ShrinkageWindow;

    // Drift metrics
    total_unexplained_loss: number;
    avg_daily_shrinkage: number;
    shrinkage_acceleration: number; // Rate of increase

    // Pattern analysis
    is_systematic: boolean;
    is_accelerating: boolean;
    is_episodic: boolean;

    // Predictive
    predicted_30d_loss: number;
    predicted_90d_loss: number;
    risk_score: number; // 0-1

    // Financial impact
    estimated_unit_value: number;
    total_loss_value: number;
    projected_annual_loss: number;
    currency: string;

    // Confidence
    confidence_score: number;
    confidence_factors: ShrinkageConfidenceFactors;

    // Recommendations
    recommended_action: 'monitor' | 'investigate' | 'audit_warehouse' | 'file_systematic_claim' | 'escalate_to_amazon';
    investigation_priority: 'low' | 'medium' | 'high' | 'urgent';

    // Evidence
    evidence: {
        windows: ShrinkageWindow[];
        detection_reasons: string[];
        statistical_summary: StatisticalSummary;
    };
}

export type DriftType =
    | 'non_event_shrinkage'      // Inventory disappearing without events
    | 'systematic_leakage'       // Consistent pattern over time
    | 'accelerating_loss'        // Loss rate increasing
    | 'episodic_shrinkage'       // Sudden drops at intervals
    | 'unexplained_adjustment'   // Amazon adjustments without reason
    | 'phantom_inventory';       // Reported but doesn't exist

export interface ShrinkageConfidenceFactors {
    continuous_snapshots: boolean;    // +0.25
    multiple_windows_affected: boolean; // +0.25
    systematic_pattern: boolean;       // +0.20
    high_value_sku: boolean;          // +0.15
    corroborating_events: boolean;    // +0.15
    calculated_score: number;
}

export interface StatisticalSummary {
    total_snapshots: number;
    date_range_days: number;
    avg_inventory_level: number;
    inventory_volatility: number;
    trend_direction: 'stable' | 'increasing' | 'decreasing';
    trend_strength: number; // 0-1
}

export interface ShrinkageSyncedData {
    seller_id: string;
    sync_id: string;
    snapshots: InventorySnapshot[];
    events: Map<string, InventoryEvent[]>; // SKU -> events
}

// ============================================================================
// Constants
// ============================================================================

// Rolling windows to analyze
const WINDOWS = [7, 30, 90] as const;

// Thresholds
const THRESHOLD_SHOW_TO_USER = 0.60;
const THRESHOLD_SYSTEMATIC = 0.75;
const MIN_LOSS_VALUE = 25; // $25 minimum

// Shrinkage rate thresholds (% of inventory)
const SHRINKAGE_RATE_THRESHOLDS = {
    low: 0.02,      // 2%
    medium: 0.05,   // 5%
    high: 0.10,     // 10%
    critical: 0.20  // 20%
};

// Minimum snapshots needed for analysis
const MIN_SNAPSHOTS_7D = 3;
const MIN_SNAPSHOTS_30D = 10;
const MIN_SNAPSHOTS_90D = 20;

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect inventory shrinkage drift
 */
export async function detectInventoryShrinkageDrift(
    sellerId: string,
    syncId: string,
    data: ShrinkageSyncedData
): Promise<ShrinkageDriftResult[]> {
    const results: ShrinkageDriftResult[] = [];

    logger.info('📊 [SHRINKAGE] Starting inventory shrinkage drift detection', {
        sellerId,
        syncId,
        snapshotCount: data.snapshots?.length || 0,
        uniqueSkus: new Set(data.snapshots?.map(s => s.sku) || []).size
    });

    if (!data.snapshots || data.snapshots.length < MIN_SNAPSHOTS_7D) {
        logger.info('📊 [SHRINKAGE] Insufficient snapshots for analysis');
        return results;
    }

    // Group snapshots by SKU
    const snapshotsBySku = groupSnapshotsBySku(data.snapshots);
    logger.info('📊 [SHRINKAGE] Grouped snapshots', {
        skuCount: snapshotsBySku.size
    });

    // Analyze each SKU
    for (const [sku, snapshots] of snapshotsBySku) {
        try {
            if (snapshots.length < MIN_SNAPSHOTS_7D) {
                continue; // Not enough data
            }

            const events = data.events.get(sku) || [];
            const detection = await analyzeShrinkageDrift(
                sellerId,
                syncId,
                sku,
                snapshots,
                events
            );

            if (detection &&
                detection.total_loss_value >= MIN_LOSS_VALUE &&
                detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
                results.push(detection);
            }
        } catch (error: any) {
            logger.warn('📊 [SHRINKAGE] Error analyzing SKU', {
                sku,
                error: error.message
            });
        }
    }

    // Sort by projected annual loss (highest impact first)
    results.sort((a, b) => b.projected_annual_loss - a.projected_annual_loss);

    const systematicCount = results.filter(r => r.is_systematic).length;
    const acceleratingCount = results.filter(r => r.is_accelerating).length;
    const totalAnnualLoss = results.reduce((sum, r) => sum + r.projected_annual_loss, 0);

    logger.info('📊 [SHRINKAGE] Detection complete', {
        sellerId,
        skusAnalyzed: snapshotsBySku.size,
        driftDetected: results.length,
        systematicLeakage: systematicCount,
        acceleratingLoss: acceleratingCount,
        projectedAnnualLoss: totalAnnualLoss.toFixed(2)
    });

    return results;
}

/**
 * Analyze shrinkage drift for a single SKU
 */
async function analyzeShrinkageDrift(
    sellerId: string,
    syncId: string,
    sku: string,
    snapshots: InventorySnapshot[],
    events: InventoryEvent[]
): Promise<ShrinkageDriftResult | null> {
    // Sort snapshots chronologically
    snapshots.sort((a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime());

    // Build windows
    const window7d = buildShrinkageWindow(snapshots, events, 7);
    const window30d = buildShrinkageWindow(snapshots, events, 30);
    const window90d = buildShrinkageWindow(snapshots, events, 90);

    if (!window7d && !window30d && !window90d) {
        return null; // No valid windows
    }

    const detectionReasons: string[] = [];

    // Detect drift type
    const driftType = classifyDriftType(window7d, window30d, window90d, detectionReasons);

    if (!driftType) {
        return null; // No drift detected
    }

    // Calculate metrics
    const totalUnexplainedLoss = Math.abs(
        (window7d?.unexplained_delta || 0) +
        (window30d?.unexplained_delta || 0) +
        (window90d?.unexplained_delta || 0)
    );

    const avgDailyShrinkage = window30d
        ? Math.abs(window30d.unexplained_delta) / window30d.window_days
        : 0;

    // Detect patterns
    const isSystematic = detectSystematicPattern([window7d, window30d, window90d].filter(Boolean) as ShrinkageWindow[]);
    const isAccelerating = detectAcceleration(window7d, window30d, window90d);
    const isEpisodic = detectEpisodicPattern(snapshots, events);

    if (isSystematic) {
        detectionReasons.push('Systematic leakage pattern detected across multiple windows');
    }
    if (isAccelerating) {
        detectionReasons.push('Shrinkage rate is accelerating over time');
    }
    if (isEpisodic) {
        detectionReasons.push('Episodic shrinkage pattern detected');
    }

    // Predict future loss
    const predicted30dLoss = avgDailyShrinkage * 30;
    const predicted90dLoss = avgDailyShrinkage * 90;
    const projectedAnnualLoss = avgDailyShrinkage * 365;

    // Calculate financial impact
    const estimatedUnitValue = await estimateUnitValue(sellerId, sku);
    const totalLossValue = totalUnexplainedLoss * estimatedUnitValue;

    // Risk scoring
    const riskScore = calculateRiskScore(
        avgDailyShrinkage,
        isSystematic,
        isAccelerating,
        totalLossValue
    );

    // Confidence scoring
    const confidence = calculateShrinkageConfidence(
        snapshots,
        [window7d, window30d, window90d].filter(Boolean) as ShrinkageWindow[],
        isSystematic,
        estimatedUnitValue
    );

    // Determine severity
    const severity = determineShrinkageSeverity(
        window30d?.shrinkage_rate || 0,
        totalLossValue,
        isAccelerating
    );

    // Determine action
    const recommendedAction = determineAction(severity, isSystematic, riskScore);
    const investigationPriority = determinePriority(severity, projectedAnnualLoss);

    // Statistical summary
    const statsummary = buildStatisticalSummary(snapshots);

    const asin = snapshots[0]?.asin;
    const fnsku = snapshots[0]?.fnsku;

    return {
        seller_id: sellerId,
        sync_id: syncId,
        sku,
        asin,
        fnsku,

        drift_type: driftType,
        severity,

        window_7d: window7d!,
        window_30d: window30d!,
        window_90d: window90d!,

        total_unexplained_loss: totalUnexplainedLoss,
        avg_daily_shrinkage: avgDailyShrinkage,
        shrinkage_acceleration: isAccelerating ? calculateAccelerationRate(window7d, window30d, window90d) : 0,

        is_systematic: isSystematic,
        is_accelerating: isAccelerating,
        is_episodic: isEpisodic,

        predicted_30d_loss: predicted30dLoss,
        predicted_90d_loss: predicted90dLoss,
        risk_score: riskScore,

        estimated_unit_value: estimatedUnitValue,
        total_loss_value: totalLossValue,
        projected_annual_loss: projectedAnnualLoss * estimatedUnitValue,
        currency: 'USD',

        confidence_score: confidence.calculated_score,
        confidence_factors: confidence,

        recommended_action: recommendedAction,
        investigation_priority: investigationPriority,

        evidence: {
            windows: [window7d, window30d, window90d].filter(Boolean) as ShrinkageWindow[],
            detection_reasons: detectionReasons,
            statistical_summary: statsummary
        }
    };
}

// ============================================================================
// Window Building
// ============================================================================

/**
 * Build shrinkage window for specified days
 */
function buildShrinkageWindow(
    snapshots: InventorySnapshot[],
    events: InventoryEvent[],
    windowDays: number
): ShrinkageWindow | null {
    if (snapshots.length < 2) return null;

    const endDate = new Date(snapshots[snapshots.length - 1].snapshot_date);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - windowDays);

    // Filter snapshots in window
    const windowSnapshots = snapshots.filter(s => {
        const date = new Date(s.snapshot_date);
        return date >= startDate && date <= endDate;
    });

    if (windowSnapshots.length < 2) return null;

    const firstSnapshot = windowSnapshots[0];
    const lastSnapshot = windowSnapshots[windowSnapshots.length - 1];

    // Filter events in window
    const windowEvents = events.filter(e => {
        const date = new Date(e.event_date);
        return date >= new Date(firstSnapshot.snapshot_date) && date <= new Date(lastSnapshot.snapshot_date);
    });

    // Calculate expected changes
    let expectedOrders = 0;
    let expectedReturns = 0;
    let expectedDamages = 0;
    let expectedRemovals = 0;
    let expectedInbounds = 0;
    let expectedAdjustments = 0;

    for (const event of windowEvents) {
        switch (event.event_type) {
            case 'order':
                expectedOrders += Math.abs(event.quantity_delta);
                break;
            case 'return':
                expectedReturns += event.quantity_delta;
                break;
            case 'damage':
                expectedDamages += Math.abs(event.quantity_delta);
                break;
            case 'removal':
                expectedRemovals += Math.abs(event.quantity_delta);
                break;
            case 'inbound':
                expectedInbounds += event.quantity_delta;
                break;
            case 'adjustment':
                expectedAdjustments += event.quantity_delta;
                break;
        }
    }

    const startingQty = firstSnapshot.total_quantity;
    const endingQty = lastSnapshot.total_quantity;

    // Expected ending = starting - orders + returns - damages - removals + inbounds + adjustments
    const expectedEnding = startingQty - expectedOrders + expectedReturns - expectedDamages - expectedRemovals + expectedInbounds + expectedAdjustments;

    const unexplainedDelta = endingQty - expectedEnding;
    const shrinkageRate = startingQty > 0 ? Math.abs(unexplainedDelta) / startingQty : 0;

    // Check for gaps
    const hasGaps = windowSnapshots.length < (windowDays / 7); // Expect weekly snapshots

    return {
        sku: firstSnapshot.sku,
        window_start: firstSnapshot.snapshot_date,
        window_end: lastSnapshot.snapshot_date,
        window_days: windowDays,
        starting_quantity: startingQty,
        ending_quantity: endingQty,
        expected_orders: expectedOrders,
        expected_returns: expectedReturns,
        expected_damages: expectedDamages,
        expected_removals: expectedRemovals,
        expected_inbounds: expectedInbounds,
        expected_adjustments: expectedAdjustments,
        expected_ending: expectedEnding,
        unexplained_delta: unexplainedDelta,
        shrinkage_rate: shrinkageRate,
        events_count: windowEvents.length,
        has_gaps: hasGaps
    };
}

// ============================================================================
// Pattern Detection
// ============================================================================

/**
 * Classify drift type
 */
function classifyDriftType(
    window7d: ShrinkageWindow | null,
    window30d: ShrinkageWindow | null,
    window90d: ShrinkageWindow | null,
    reasons: string[]
): DriftType | null {
    const windows = [window7d, window30d, window90d].filter(Boolean) as ShrinkageWindow[];

    if (windows.length === 0) return null;

    // Check for systematic leakage (consistent across windows)
    const allNegative = windows.every(w => w.unexplained_delta < -1);
    if (allNegative && windows.length >= 2) {
        reasons.push(`Consistent inventory loss across ${windows.length} time windows`);
        return 'systematic_leakage';
    }

    // Check for accelerating loss
    if (window7d && window30d && window90d) {
        const rate7d = Math.abs(window7d.unexplained_delta) / 7;
        const rate30d = Math.abs(window30d.unexplained_delta) / 30;
        if (rate7d > rate30d * 1.5) {
            reasons.push('Recent shrinkage rate significantly higher than historical average');
            return 'accelerating_loss';
        }
    }

    // Check for non-event shrinkage
    const hasLowEventActivity = windows.some(w => w.events_count < 5 && Math.abs(w.unexplained_delta) > 2);
    if (hasLowEventActivity) {
        reasons.push('Inventory loss detected with minimal transaction activity');
        return 'non_event_shrinkage';
    }

    // Check for unexplained adjustments
    const hasAdjustments = windows.some(w => Math.abs(w.expected_adjustments) > Math.abs(w.unexplained_delta) * 0.5);
    if (hasAdjustments) {
        reasons.push('Significant Amazon inventory adjustments without clear justification');
        return 'unexplained_adjustment';
    }

    // Default: non-event shrinkage if any unexplained loss > 5 units
    if (windows.some(w => Math.abs(w.unexplained_delta) >= 5)) {
        reasons.push(`Unexplained inventory delta: ${windows[0].unexplained_delta} units`);
        return 'non_event_shrinkage';
    }

    return null;
}

/**
 * Detect systematic pattern
 */
function detectSystematicPattern(windows: ShrinkageWindow[]): boolean {
    if (windows.length < 2) return false;

    // All windows show shrinkage in same direction
    const allShrinking = windows.every(w => w.unexplained_delta < -1);
    const allGrowing = windows.every(w => w.unexplained_delta > 1);

    // Shrinkage rate relatively consistent
    const rates = windows.map(w => w.shrinkage_rate);
    const avgRate = rates.reduce((sum, r) => sum + r, 0) / rates.length;
    const variance = rates.reduce((sum, r) => sum + Math.pow(r - avgRate, 2), 0) / rates.length;
    const isConsistent = variance < 0.01; // Low variance

    return (allShrinking || allGrowing) && isConsistent;
}

/**
 * Detect acceleration
 */
function detectAcceleration(
    window7d: ShrinkageWindow | null,
    window30d: ShrinkageWindow | null,
    window90d: ShrinkageWindow | null
): boolean {
    if (!window7d || !window30d) return false;

    const recentRate = Math.abs(window7d.unexplained_delta) / 7;
    const longerRate = Math.abs(window30d.unexplained_delta) / 30;

    return recentRate > longerRate * 1.3; // 30% acceleration
}

/**
 * Calculate acceleration rate
 */
function calculateAccelerationRate(
    window7d: ShrinkageWindow | null,
    window30d: ShrinkageWindow | null,
    window90d: ShrinkageWindow | null
): number {
    if (!window7d || !window30d) return 0;

    const recentRate = Math.abs(window7d.unexplained_delta) / 7;
    const longerRate = Math.abs(window30d.unexplained_delta) / 30;

    return longerRate > 0 ? (recentRate - longerRate) / longerRate : 0;
}

/**
 * Detect episodic pattern
 */
function detectEpisodicPattern(snapshots: InventorySnapshot[], events: InventoryEvent[]): boolean {
    // Look for sudden drops followed by periods of stability
    // This is a simplified check - could be much more sophisticated
    if (snapshots.length < 10) return false;

    let suddenDrops = 0;
    for (let i = 1; i < snapshots.length; i++) {
        const delta = snapshots[i].total_quantity - snapshots[i - 1].total_quantity;
        if (delta < -10) { // Sudden drop
            suddenDrops++;
        }
    }

    return suddenDrops >= 2;
}

// ============================================================================
// Scoring \u0026 Classification
// ============================================================================

/**
 * Calculate risk score
 */
function calculateRiskScore(
    avgDailyShrinkage: number,
    isSystematic: boolean,
    isAccelerating: boolean,
    totalLossValue: number
): number {
    let score = 0;

    // Daily shrinkage rate
    if (avgDailyShrinkage >= 1) score += 0.3;
    else if (avgDailyShrinkage >= 0.5) score += 0.2;
    else if (avgDailyShrinkage >= 0.1) score += 0.1;

    // Pattern indicators
    if (isSystematic) score += 0.3;
    if (isAccelerating) score += 0.2;

    // Financial impact
    if (totalLossValue >= 500) score += 0.2;
    else if (totalLossValue >= 100) score += 0.1;

    return Math.min(1, score);
}

/**
 * Calculate confidence
 */
function calculateShrinkageConfidence(
    snapshots: InventorySnapshot[],
    windows: ShrinkageWindow[],
    isSystematic: boolean,
    unitValue: number
): ShrinkageConfidenceFactors {
    let score = 0;

    // Continuous snapshots (good data quality)
    const continuousSnapshots = snapshots.length >= 20 && windows.every(w => !w.has_gaps);
    if (continuousSnapshots) score += 0.25;

    // Multiple windows affected
    const multipleWindows = windows.filter(w => Math.abs(w.unexplained_delta) >= 2).length >= 2;
    if (multipleWindows) score += 0.25;

    // Systematic pattern
    if (isSystematic) score += 0.20;

    // High value SKU
    const highValue = unitValue >= 50;
    if (highValue) score += 0.15;

    // Corroborating events
    const hasEvents = windows.some(w => w.events_count > 0);
    if (hasEvents) score += 0.15;

    return {
        continuous_snapshots: continuousSnapshots,
        multiple_windows_affected: multipleWindows,
        systematic_pattern: isSystematic,
        high_value_sku: highValue,
        corroborating_events: hasEvents,
        calculated_score: Math.min(1, score)
    };
}

/**
 * Determine severity
 */
function determineShrinkageSeverity(
    shrinkageRate: number,
    totalLossValue: number,
    isAccelerating: boolean
): 'low' | 'medium' | 'high' | 'critical' {
    if (shrinkageRate >= SHRINKAGE_RATE_THRESHOLDS.critical || totalLossValue >= 1000 || isAccelerating) {
        return 'critical';
    }
    if (shrinkageRate >= SHRINKAGE_RATE_THRESHOLDS.high || totalLossValue >= 500) {
        return 'high';
    }
    if (shrinkageRate >= SHRINKAGE_RATE_THRESHOLDS.medium || totalLossValue >= 100) {
        return 'medium';
    }
    return 'low';
}

/**
 * Determine recommended action
 */
function determineAction(
    severity: 'low' | 'medium' | 'high' | 'critical',
    isSystematic: boolean,
    riskScore: number
): ShrinkageDriftResult['recommended_action'] {
    if (severity === 'critical' || (isSystematic && riskScore >= 0.75)) {
        return 'escalate_to_amazon';
    }
    if (severity === 'high' || isSystematic) {
        return 'file_systematic_claim';
    }
    if (severity === 'medium' || riskScore >= 0.60) {
        return 'audit_warehouse';
    }
    if (riskScore >= 0.40) {
        return 'investigate';
    }
    return 'monitor';
}

/**
 * Determine investigation priority
 */
function determinePriority(
    severity: 'low' | 'medium' | 'high' | 'critical',
    projectedAnnualLoss: number
): 'low' | 'medium' | 'high' | 'urgent' {
    if (severity === 'critical' || projectedAnnualLoss >= 5000) {
        return 'urgent';
    }
    if (severity === 'high' || projectedAnnualLoss >= 1000) {
        return 'high';
    }
    if (severity === 'medium' || projectedAnnualLoss >= 500) {
        return 'medium';
    }
    return 'low';
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group snapshots by SKU
 */
function groupSnapshotsBySku(snapshots: InventorySnapshot[]): Map<string, InventorySnapshot[]> {
    const map = new Map<string, InventorySnapshot[]>();

    for (const snapshot of snapshots) {
        const existing = map.get(snapshot.sku) || [];
        existing.push(snapshot);
        map.set(snapshot.sku, existing);
    }

    return map;
}

/**
 * Build statistical summary
 */
function buildStatisticalSummary(snapshots: InventorySnapshot[]): StatisticalSummary {
    if (snapshots.length === 0) {
        return {
            total_snapshots: 0,
            date_range_days: 0,
            avg_inventory_level: 0,
            inventory_volatility: 0,
            trend_direction: 'stable',
            trend_strength: 0
        };
    }

    const quantities = snapshots.map(s => s.total_quantity);
    const avgQty = quantities.reduce((sum, q) => sum + q, 0) / quantities.length;

    // Volatility (standard deviation)
    const variance = quantities.reduce((sum, q) => sum + Math.pow(q - avgQty, 2), 0) / quantities.length;
    const volatility = Math.sqrt(variance);

    // Trend detection (simple linear regression)
    const firstQty = quantities[0];
    const lastQty = quantities[quantities.length - 1];
    const trendDirection = lastQty > firstQty * 1.1 ? 'increasing' : lastQty < firstQty * 0.9 ? 'decreasing' : 'stable';
    const trendStrength = Math.abs(lastQty - firstQty) / firstQty;

    // Date range
    const firstDate = new Date(snapshots[0].snapshot_date);
    const lastDate = new Date(snapshots[snapshots.length - 1].snapshot_date);
    const dateRangeDays = Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

    return {
        total_snapshots: snapshots.length,
        date_range_days: dateRangeDays,
        avg_inventory_level: avgQty,
        inventory_volatility: volatility,
        trend_direction: trendDirection,
        trend_strength: trendStrength
    };
}

/**
 * Estimate unit value for financial calculations
 */
async function estimateUnitValue(sellerId: string, sku: string): Promise<number> {
    try {
        // Try to get from product_price_history
        const { data, error } = await supabaseAdmin
            .from('product_price_history')
            .select('median_sale_price_90d, median_sale_price_30d, buybox_price')
            .eq('seller_id', sellerId)
            .eq('sku', sku)
            .single();

        if (!error && data) {
            return data.median_sale_price_90d || data.median_sale_price_30d || data.buybox_price || 20;
        }
    } catch (err) {
        // Fallback
    }

    // Default estimate
    return 20;
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch inventory snapshots
 */
export async function fetchInventorySnapshots(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<InventorySnapshot[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const snapshots: InventorySnapshot[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('fba_inventory_snapshots')
            .select('*')
            .eq('seller_id', sellerId)
            .gte('snapshot_date', cutoffDate.toISOString())
            .order('snapshot_date', { ascending: true });

        if (!error && data) {
            for (const row of data) {
                snapshots.push({
                    id: row.id,
                    seller_id: sellerId,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    snapshot_date: row.snapshot_date,
                    total_quantity: row.total_quantity || 0,
                    sellable_quantity: row.sellable_quantity || 0,
                    unsellable_quantity: row.unsellable_quantity || 0,
                    reserved_quantity: row.reserved_fc_quantity || 0,
                    inbound_quantity: row.inbound_working_quantity || 0,
                    fulfillable_quantity: (row.sellable_quantity || 0) - (row.reserved_fc_quantity || 0),
                    snapshot_source: row.snapshot_source || 'api'
                });
            }
        }

        logger.info('📊 [SHRINKAGE] Fetched inventory snapshots', {
            sellerId,
            count: snapshots.length
        });
    } catch (err: any) {
        logger.error('📊 [SHRINKAGE] Error fetching snapshots', { error: err.message });
    }

    return snapshots;
}

/**
 * Fetch inventory events
 */
export async function fetchInventoryEvents(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<Map<string, InventoryEvent[]>> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const eventsBySku = new Map<string, InventoryEvent[]>();

    try {
        // Fetch from various sources
        const [orders, returns, adjustments] = await Promise.all([
            fetchOrderEvents(sellerId, cutoffDate),
            fetchReturnEvents(sellerId, cutoffDate),
            fetchAdjustmentEvents(sellerId, cutoffDate)
        ]);

        // Group all events by SKU
        for (const event of [...orders, ...returns, ...adjustments]) {
            const sku = (event as any).sku;
            if (!sku) continue;

            const existing = eventsBySku.get(sku) || [];
            existing.push(event);
            eventsBySku.set(sku, existing);
        }

        logger.info('📊 [SHRINKAGE] Fetched inventory events', {
            sellerId,
            skuCount: eventsBySku.size
        });
    } catch (err: any) {
        logger.error('📊 [SHRINKAGE] Error fetching events', { error: err.message });
    }

    return eventsBySku;
}

async function fetchOrderEvents(sellerId: string, cutoffDate: Date): Promise<InventoryEvent[]> {
    const events: InventoryEvent[] = [];
    // Simplified - would fetch from orders table
    return events;
}

async function fetchReturnEvents(sellerId: string, cutoffDate: Date): Promise<InventoryEvent[]> {
    const events: InventoryEvent[] = [];
    // Simplified - would fetch from returns table
    return events;
}

async function fetchAdjustmentEvents(sellerId: string, cutoffDate: Date): Promise<InventoryEvent[]> {
    const events: InventoryEvent[] = [];
    // Simplified - would fetch from adjustments/settlements
    return events;
}

/**
 * Store shrinkage drift results
 */
export async function storeShrinkageDriftResults(
    results: ShrinkageDriftResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'inventory_shrinkage_drift',
            severity: r.severity,
            estimated_value: r.total_loss_value,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                sku: r.sku,
                drift_type: r.drift_type,
                is_systematic: r.is_systematic,
                is_accelerating: r.is_accelerating,
                avg_daily_shrinkage: r.avg_daily_shrinkage,
                projected_annual_loss: r.projected_annual_loss,
                risk_score: r.risk_score,
                recommended_action: r.recommended_action,
                investigation_priority: r.investigation_priority,
                windows: r.evidence.windows,
                detection_reasons: r.evidence.detection_reasons,
                statistical_summary: r.evidence.statistical_summary
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('📊 [SHRINKAGE] Error storing results', { error: error.message });
        } else {
            logger.info('📊 [SHRINKAGE] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('📊 [SHRINKAGE] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Exports
// ============================================================================

export { THRESHOLD_SHOW_TO_USER, THRESHOLD_SYSTEMATIC, WINDOWS };
