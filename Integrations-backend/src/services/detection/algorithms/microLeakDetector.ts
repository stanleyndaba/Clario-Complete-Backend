/**
 * Micro-Leak Detector
 * 
 * Time-Series Pattern Analysis for Systemic Fee Leaks
 * 
 * Purpose:
 * Most tools check individual transactions. This detects PATTERNS:
 * - Small overcharges ($0.10-$1) that repeat across thousands of units
 * - Same fee type, same tier, same calculation error - every single time
 * - Aggregated = massive money left on table
 * 
 * Example:
 * - SKU "ABC123" is 15.1 oz but Amazon charges Large Standard tier (16+ oz)
 * - Overcharge: $0.35 per unit
 * - Units sold: 50,000/year
 * - Total leak: $17,500/year
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface MicroLeakPattern {
    pattern_id: string;
    seller_id: string;
    leak_type: 'weight_tier' | 'size_tier' | 'category_rate' | 'dimensional_weight' | 'storage_rate' | 'other';
    affected_skus: string[];
    affected_asins: string[];
    unit_overcharge: number;
    total_units_affected: number;
    total_leaked_value: number;
    currency: string;
    confidence_score: number;
    pattern_start_date: string;
    pattern_frequency: 'every_order' | 'daily' | 'weekly' | 'monthly';
    evidence: MicroLeakEvidence;
}

export interface MicroLeakEvidence {
    sample_transactions: Array<{
        event_id: string;
        date: string;
        charged_amount: number;
        expected_amount: number;
        overcharge: number;
    }>;
    affected_sku_count: number;
    time_range_days: number;
    calculation_method: string;
    pattern_description: string;
}

export interface MicroLeakDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: 'micro_leak_pattern';
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: MicroLeakEvidence;
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    pattern: MicroLeakPattern;
}

// ============================================================================
// Micro-Leak Detection Thresholds
// ============================================================================

const THRESHOLDS = {
    MIN_OVERCHARGE: 0.05,        // $0.05 minimum per-unit overcharge to track
    MAX_OVERCHARGE: 2.00,        // $2.00 maximum (above this, other detectors catch it)
    MIN_OCCURRENCES: 50,         // At least 50 occurrences to establish pattern
    MIN_TOTAL_VALUE: 25,         // $25 minimum total value to report
    LOOKBACK_DAYS: 90,           // Analyze last 90 days
};

// ============================================================================
// Helper Functions
// ============================================================================

function calculateDeadline(discoveryDate: Date): { deadline: Date; daysRemaining: number } {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);
    const daysRemaining = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { deadline, daysRemaining: Math.max(0, daysRemaining) };
}

function calculateSeverity(totalValue: number): 'low' | 'medium' | 'high' | 'critical' {
    if (totalValue >= 5000) return 'critical';
    if (totalValue >= 1000) return 'high';
    if (totalValue >= 250) return 'medium';
    return 'low';
}

function generatePatternId(sellerId: string, leakType: string, skus: string[]): string {
    const hash = skus.sort().join('').substring(0, 8);
    return `ml_${sellerId.substring(0, 8)}_${leakType}_${hash}`;
}

// ============================================================================
// Main Detection Functions
// ============================================================================

/**
 * Detect Weight/Size Tier Micro-Leaks
 * 
 * Finds products consistently charged at wrong size tier
 */
async function detectTierMicroLeaks(sellerId: string): Promise<MicroLeakPattern[]> {
    const patterns: MicroLeakPattern[] = [];

    try {
        // Query fee events with product data
        const { data: feeEvents, error } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .in('event_type', ['fba_fee', 'fulfillment_fee', 'service_fee'])
            .gte('event_date', new Date(Date.now() - THRESHOLDS.LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString())
            .order('event_date', { ascending: false })
            .limit(10000);

        if (error || !feeEvents?.length) {
            return patterns;
        }

        // Group by SKU to find patterns
        const skuGroups = new Map<string, any[]>();
        for (const event of feeEvents) {
            const sku = event.amazon_sku || event.sku || 'unknown';
            if (!skuGroups.has(sku)) {
                skuGroups.set(sku, []);
            }
            skuGroups.get(sku)!.push(event);
        }

        // Analyze each SKU for consistent overcharges
        for (const [sku, events] of skuGroups) {
            if (events.length < THRESHOLDS.MIN_OCCURRENCES) continue;

            // Check for consistent small overcharges
            const overcharges = events
                .filter(e => e.expected_amount && e.amount)
                .map(e => ({
                    event_id: e.id,
                    date: e.event_date,
                    charged: Math.abs(e.amount),
                    expected: Math.abs(e.expected_amount || e.amount),
                    overcharge: Math.abs(e.amount) - Math.abs(e.expected_amount || e.amount)
                }))
                .filter(o => o.overcharge >= THRESHOLDS.MIN_OVERCHARGE && o.overcharge <= THRESHOLDS.MAX_OVERCHARGE);

            if (overcharges.length < THRESHOLDS.MIN_OCCURRENCES) continue;

            // Calculate average overcharge
            const avgOvercharge = overcharges.reduce((sum, o) => sum + o.overcharge, 0) / overcharges.length;
            const totalValue = avgOvercharge * overcharges.length;

            if (totalValue < THRESHOLDS.MIN_TOTAL_VALUE) continue;

            // This is a micro-leak pattern!
            const pattern: MicroLeakPattern = {
                pattern_id: generatePatternId(sellerId, 'size_tier', [sku]),
                seller_id: sellerId,
                leak_type: 'size_tier',
                affected_skus: [sku],
                affected_asins: [...new Set(events.map(e => e.asin).filter(Boolean))],
                unit_overcharge: avgOvercharge,
                total_units_affected: overcharges.length,
                total_leaked_value: totalValue,
                currency: events[0].currency || 'USD',
                confidence_score: Math.min(0.95, 0.6 + (overcharges.length / 1000) * 0.35),
                pattern_start_date: overcharges[overcharges.length - 1].date,
                pattern_frequency: 'every_order',
                evidence: {
                    sample_transactions: overcharges.slice(0, 10).map(o => ({
                        event_id: o.event_id,
                        date: o.date,
                        charged_amount: o.charged,
                        expected_amount: o.expected,
                        overcharge: o.overcharge
                    })),
                    affected_sku_count: 1,
                    time_range_days: THRESHOLDS.LOOKBACK_DAYS,
                    calculation_method: 'Consistent per-unit overcharge across all orders',
                    pattern_description: `SKU ${sku} is consistently overcharged by $${avgOvercharge.toFixed(2)} per unit across ${overcharges.length} transactions`
                }
            };

            patterns.push(pattern);
        }

        logger.info('[MICRO-LEAK] Tier pattern analysis complete', {
            sellerId,
            patternsFound: patterns.length,
            totalValue: patterns.reduce((s, p) => s + p.total_leaked_value, 0)
        });

    } catch (error: any) {
        logger.error('[MICRO-LEAK] Error detecting tier leaks', { sellerId, error: error.message });
    }

    return patterns;
}

/**
 * Detect Dimensional Weight Micro-Leaks
 * 
 * Finds products where dimensional weight is consistently miscalculated
 */
async function detectDimensionalWeightLeaks(sellerId: string): Promise<MicroLeakPattern[]> {
    const patterns: MicroLeakPattern[] = [];

    try {
        // Query fee events with dimensional weight data
        const { data: feeEvents, error } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('event_type', 'fba_fee')
            .not('dimensional_weight', 'is', null)
            .gte('event_date', new Date(Date.now() - THRESHOLDS.LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString())
            .limit(5000);

        if (error || !feeEvents?.length) {
            return patterns;
        }

        // Group by SKU
        const skuGroups = new Map<string, any[]>();
        for (const event of feeEvents) {
            const sku = event.amazon_sku || event.sku || 'unknown';
            if (!skuGroups.has(sku)) {
                skuGroups.set(sku, []);
            }
            skuGroups.get(sku)!.push(event);
        }

        for (const [sku, events] of skuGroups) {
            if (events.length < 20) continue;

            // Check for consistent dimensional weight variance
            const dimWeightVariances = events
                .filter(e => e.dimensional_weight && e.actual_weight)
                .map(e => ({
                    event_id: e.id,
                    date: e.event_date,
                    charged_dim_weight: e.dimensional_weight,
                    actual_weight: e.actual_weight,
                    variance: e.dimensional_weight - e.actual_weight,
                    overcharge: e.amount - (e.expected_amount || e.amount)
                }))
                .filter(v => v.variance > 2 && v.overcharge > 0); // At least 2 oz variance

            if (dimWeightVariances.length < 20) continue;

            const avgOvercharge = dimWeightVariances.reduce((s, v) => s + v.overcharge, 0) / dimWeightVariances.length;
            const totalValue = avgOvercharge * dimWeightVariances.length;

            if (totalValue < THRESHOLDS.MIN_TOTAL_VALUE) continue;

            patterns.push({
                pattern_id: generatePatternId(sellerId, 'dimensional_weight', [sku]),
                seller_id: sellerId,
                leak_type: 'dimensional_weight',
                affected_skus: [sku],
                affected_asins: [...new Set(events.map(e => e.asin).filter(Boolean))],
                unit_overcharge: avgOvercharge,
                total_units_affected: dimWeightVariances.length,
                total_leaked_value: totalValue,
                currency: events[0].currency || 'USD',
                confidence_score: 0.85,
                pattern_start_date: dimWeightVariances[dimWeightVariances.length - 1].date,
                pattern_frequency: 'every_order',
                evidence: {
                    sample_transactions: dimWeightVariances.slice(0, 10).map(v => ({
                        event_id: v.event_id,
                        date: v.date,
                        charged_amount: v.charged_dim_weight,
                        expected_amount: v.actual_weight,
                        overcharge: v.overcharge
                    })),
                    affected_sku_count: 1,
                    time_range_days: THRESHOLDS.LOOKBACK_DAYS,
                    calculation_method: 'Dimensional weight variance analysis',
                    pattern_description: `SKU ${sku} has consistent dimensional weight miscalculation averaging $${avgOvercharge.toFixed(2)} overcharge per unit`
                }
            });
        }

    } catch (error: any) {
        logger.error('[MICRO-LEAK] Error detecting dimensional weight leaks', { sellerId, error: error.message });
    }

    return patterns;
}

/**
 * Run all micro-leak detection algorithms
 */
export async function detectAllMicroLeaks(
    sellerId: string,
    syncId: string
): Promise<MicroLeakDetectionResult[]> {
    logger.info('[MICRO-LEAK] Starting micro-leak detection', { sellerId, syncId });

    const [tierPatterns, dimWeightPatterns] = await Promise.all([
        detectTierMicroLeaks(sellerId),
        detectDimensionalWeightLeaks(sellerId)
    ]);

    const allPatterns = [...tierPatterns, ...dimWeightPatterns];

    // Convert patterns to detection results
    const results: MicroLeakDetectionResult[] = allPatterns.map(pattern => {
        const discoveryDate = new Date();
        const { deadline, daysRemaining } = calculateDeadline(discoveryDate);

        return {
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: 'micro_leak_pattern' as const,
            severity: calculateSeverity(pattern.total_leaked_value),
            estimated_value: pattern.total_leaked_value,
            currency: pattern.currency,
            confidence_score: pattern.confidence_score,
            evidence: pattern.evidence,
            related_event_ids: pattern.evidence.sample_transactions.map(t => t.event_id),
            discovery_date: discoveryDate,
            deadline_date: deadline,
            days_remaining: daysRemaining,
            pattern
        };
    });

    logger.info('[MICRO-LEAK] Detection complete', {
        sellerId,
        syncId,
        patternsFound: results.length,
        totalValue: results.reduce((s, r) => s + r.estimated_value, 0)
    });

    return results;
}

/**
 * Store micro-leak detection results
 */
export async function storeMicroLeakResults(results: MicroLeakDetectionResult[]): Promise<void> {
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
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('[MICRO-LEAK] Failed to store results', { error: error.message });
        } else {
            logger.info('[MICRO-LEAK] Results stored', { count: records.length });
        }

    } catch (error: any) {
        logger.error('[MICRO-LEAK] Error storing results', { error: error.message });
    }
}

export default {
    detectAllMicroLeaks,
    storeMicroLeakResults,
    detectTierMicroLeaks,
    detectDimensionalWeightLeaks
};
