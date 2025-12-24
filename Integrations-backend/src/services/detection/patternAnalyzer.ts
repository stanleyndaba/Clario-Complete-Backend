/**
 * Pattern Analyzer Service
 * 
 * Phase 3: ML & Pattern Recognition
 * 
 * Identifies recurring issues and generates actionable insights:
 * - Seller-level patterns (what issues does this seller repeatedly have?)
 * - Warehouse hotspots (which FCs have the most problems?)
 * - SKU vulnerability analysis (which products are most affected?)
 * - Trend detection (are issues increasing or decreasing?)
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface SellerPattern {
    seller_id: string;
    total_detections: number;
    total_recovery: number;
    most_common_anomaly: string;
    recurring_issues: Array<{
        anomaly_type: string;
        count: number;
        total_value: number;
        avg_confidence: number;
    }>;
    risk_score: number;  // 0-100, higher = more issues
    trend: 'improving' | 'stable' | 'worsening';
}

export interface WarehouseHotspot {
    warehouse_id: string;
    warehouse_name?: string;
    issue_count: number;
    total_value: number;
    primary_issue_type: string;
    affected_sellers: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SKUVulnerability {
    sku: string;
    asin?: string;
    product_name?: string;
    issue_count: number;
    total_value_at_risk: number;
    primary_issue_type: string;
    affected_shipments: number;
}

export interface TrendAnalysis {
    period: 'daily' | 'weekly' | 'monthly';
    data_points: Array<{
        date: string;
        detection_count: number;
        total_value: number;
        approval_rate: number;
    }>;
    trend_direction: 'up' | 'down' | 'flat';
    percent_change: number;
}

export interface PatternInsight {
    insight_type: 'warning' | 'opportunity' | 'info';
    title: string;
    description: string;
    recommended_action: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    related_data: any;
}

// ============================================================================
// Seller Pattern Analysis
// ============================================================================

/**
 * Analyze patterns for a specific seller
 */
export async function analyzeSellerPatterns(sellerId: string): Promise<SellerPattern | null> {
    logger.info('📊 [PATTERNS] Analyzing seller patterns', { sellerId });

    try {
        // Get all detections for this seller
        const { data: detections, error: detError } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .eq('seller_id', sellerId)
            .order('created_at', { ascending: false })
            .limit(500);

        if (detError || !detections || detections.length === 0) {
            return null;
        }

        // Get outcomes for this seller
        const { data: outcomes } = await supabaseAdmin
            .from('detection_outcomes')
            .select('*')
            .eq('seller_id', sellerId);

        // Group by anomaly type
        const byType = new Map<string, { count: number; value: number; confidences: number[] }>();
        for (const det of detections) {
            const existing = byType.get(det.anomaly_type) || { count: 0, value: 0, confidences: [] };
            existing.count++;
            existing.value += det.estimated_value || 0;
            existing.confidences.push(det.confidence_score || 0);
            byType.set(det.anomaly_type, existing);
        }

        // Convert to array and sort
        const recurringIssues = Array.from(byType.entries())
            .map(([anomaly_type, data]) => ({
                anomaly_type,
                count: data.count,
                total_value: data.value,
                avg_confidence: data.confidences.reduce((s, c) => s + c, 0) / data.confidences.length
            }))
            .sort((a, b) => b.count - a.count);

        // Calculate risk score based on issue frequency and value
        const totalValue = recurringIssues.reduce((s, i) => s + i.total_value, 0);
        const issueFrequency = detections.length;
        const riskScore = Math.min(100, Math.round((issueFrequency * 2) + (totalValue / 100)));

        // Determine trend (comparing last 30 days to previous 30 days)
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000);

        const recentCount = detections.filter(d => new Date(d.created_at) >= thirtyDaysAgo).length;
        const previousCount = detections.filter(d => {
            const date = new Date(d.created_at);
            return date >= sixtyDaysAgo && date < thirtyDaysAgo;
        }).length;

        let trend: 'improving' | 'stable' | 'worsening';
        if (recentCount < previousCount * 0.8) {
            trend = 'improving';
        } else if (recentCount > previousCount * 1.2) {
            trend = 'worsening';
        } else {
            trend = 'stable';
        }

        return {
            seller_id: sellerId,
            total_detections: detections.length,
            total_recovery: outcomes?.reduce((s, o) => s + (o.recovery_amount || 0), 0) || 0,
            most_common_anomaly: recurringIssues[0]?.anomaly_type || 'none',
            recurring_issues: recurringIssues.slice(0, 10),
            risk_score: riskScore,
            trend
        };
    } catch (err: any) {
        logger.error('📊 [PATTERNS] Error analyzing seller', { sellerId, error: err.message });
        return null;
    }
}

// ============================================================================
// Warehouse Hotspot Analysis
// ============================================================================

/**
 * Identify problem warehouses
 */
export async function detectWarehouseHotspots(): Promise<WarehouseHotspot[]> {
    logger.info('📊 [PATTERNS] Detecting warehouse hotspots');

    try {
        // Query detections that have warehouse/FC info in evidence
        const { data: detections } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString())
            .limit(1000);

        if (!detections || detections.length === 0) {
            return [];
        }

        // Extract warehouse IDs from evidence
        const byWarehouse = new Map<string, {
            count: number;
            value: number;
            types: Map<string, number>;
            sellers: Set<string>;
        }>();

        for (const det of detections) {
            const evidence = det.evidence || {};
            const warehouseId = evidence.fulfillment_center || evidence.warehouse_id || evidence.fc_id;

            if (!warehouseId) continue;

            const existing = byWarehouse.get(warehouseId) || {
                count: 0,
                value: 0,
                types: new Map(),
                sellers: new Set()
            };

            existing.count++;
            existing.value += det.estimated_value || 0;
            existing.types.set(det.anomaly_type, (existing.types.get(det.anomaly_type) || 0) + 1);
            existing.sellers.add(det.seller_id);
            byWarehouse.set(warehouseId, existing);
        }

        // Convert to hotspots
        const hotspots: WarehouseHotspot[] = [];
        for (const [warehouseId, data] of byWarehouse) {
            // Find primary issue type
            let primaryType = '';
            let maxCount = 0;
            for (const [type, count] of data.types) {
                if (count > maxCount) {
                    maxCount = count;
                    primaryType = type;
                }
            }

            // Determine severity
            let severity: WarehouseHotspot['severity'];
            if (data.count >= 50 || data.value >= 10000) {
                severity = 'critical';
            } else if (data.count >= 20 || data.value >= 5000) {
                severity = 'high';
            } else if (data.count >= 10 || data.value >= 1000) {
                severity = 'medium';
            } else {
                severity = 'low';
            }

            hotspots.push({
                warehouse_id: warehouseId,
                issue_count: data.count,
                total_value: data.value,
                primary_issue_type: primaryType,
                affected_sellers: data.sellers.size,
                severity
            });
        }

        return hotspots.sort((a, b) => b.total_value - a.total_value);
    } catch (err: any) {
        logger.error('📊 [PATTERNS] Error detecting hotspots', { error: err.message });
        return [];
    }
}

// ============================================================================
// Trend Analysis
// ============================================================================

/**
 * Analyze detection trends over time
 */
export async function analyzeTrends(
    sellerId?: string,
    period: 'daily' | 'weekly' | 'monthly' = 'weekly'
): Promise<TrendAnalysis> {
    logger.info('📊 [PATTERNS] Analyzing trends', { sellerId, period });

    try {
        let query = supabaseAdmin
            .from('detection_results')
            .select('created_at, estimated_value')
            .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString())
            .order('created_at', { ascending: true });

        if (sellerId) {
            query = query.eq('seller_id', sellerId);
        }

        const { data: detections } = await query;

        if (!detections || detections.length === 0) {
            return {
                period,
                data_points: [],
                trend_direction: 'flat',
                percent_change: 0
            };
        }

        // Group by period
        const periodMs = period === 'daily' ? 86400000 : period === 'weekly' ? 7 * 86400000 : 30 * 86400000;
        const grouped = new Map<string, { count: number; value: number }>();

        for (const det of detections) {
            const date = new Date(det.created_at);
            const periodStart = new Date(Math.floor(date.getTime() / periodMs) * periodMs);
            const key = periodStart.toISOString().split('T')[0];

            const existing = grouped.get(key) || { count: 0, value: 0 };
            existing.count++;
            existing.value += det.estimated_value || 0;
            grouped.set(key, existing);
        }

        // Convert to data points
        const dataPoints = Array.from(grouped.entries())
            .map(([date, data]) => ({
                date,
                detection_count: data.count,
                total_value: data.value,
                approval_rate: 0 // Would need outcome data to calculate
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // Calculate trend
        let trendDirection: 'up' | 'down' | 'flat' = 'flat';
        let percentChange = 0;

        if (dataPoints.length >= 2) {
            const firstHalf = dataPoints.slice(0, Math.floor(dataPoints.length / 2));
            const secondHalf = dataPoints.slice(Math.floor(dataPoints.length / 2));

            const firstAvg = firstHalf.reduce((s, p) => s + p.detection_count, 0) / firstHalf.length;
            const secondAvg = secondHalf.reduce((s, p) => s + p.detection_count, 0) / secondHalf.length;

            if (firstAvg > 0) {
                percentChange = ((secondAvg - firstAvg) / firstAvg) * 100;
                if (percentChange > 10) trendDirection = 'up';
                else if (percentChange < -10) trendDirection = 'down';
            }
        }

        return {
            period,
            data_points: dataPoints,
            trend_direction: trendDirection,
            percent_change: Math.round(percentChange)
        };
    } catch (err: any) {
        logger.error('📊 [PATTERNS] Error analyzing trends', { error: err.message });
        return {
            period,
            data_points: [],
            trend_direction: 'flat',
            percent_change: 0
        };
    }
}

// ============================================================================
// Insight Generation
// ============================================================================

/**
 * Generate actionable insights for a seller
 */
export async function generateInsights(sellerId: string): Promise<PatternInsight[]> {
    logger.info('📊 [PATTERNS] Generating insights', { sellerId });

    const insights: PatternInsight[] = [];

    try {
        const patterns = await analyzeSellerPatterns(sellerId);
        const trends = await analyzeTrends(sellerId, 'weekly');
        const hotspots = await detectWarehouseHotspots();

        if (!patterns) {
            return [];
        }

        // Insight: High-frequency issue type
        if (patterns.recurring_issues.length > 0) {
            const top = patterns.recurring_issues[0];
            if (top.count >= 5) {
                insights.push({
                    insight_type: 'warning',
                    title: `Recurring ${top.anomaly_type.replace(/_/g, ' ')} issues`,
                    description: `You have ${top.count} ${top.anomaly_type} detections with $${top.total_value.toFixed(2)} at stake.`,
                    recommended_action: 'Review your processes related to this issue type to prevent future occurrences.',
                    priority: top.count >= 10 ? 'high' : 'medium',
                    related_data: top
                });
            }
        }

        // Insight: Trend warning
        if (trends.trend_direction === 'up' && trends.percent_change > 20) {
            insights.push({
                insight_type: 'warning',
                title: 'Detection rate increasing',
                description: `Your detection rate has increased by ${trends.percent_change}% recently.`,
                recommended_action: 'Investigate recent changes in your supply chain or FBA processes.',
                priority: 'high',
                related_data: trends
            });
        }

        // Insight: Trend opportunity
        if (trends.trend_direction === 'down' && trends.percent_change < -20) {
            insights.push({
                insight_type: 'opportunity',
                title: 'Issues are decreasing',
                description: `Great news! Your detection rate has decreased by ${Math.abs(trends.percent_change)}%.`,
                recommended_action: 'Continue current practices. Consider documenting what changed.',
                priority: 'low',
                related_data: trends
            });
        }

        // Insight: Warehouse hotspot
        const sellerHotspots = hotspots.filter(h => h.severity === 'high' || h.severity === 'critical');
        if (sellerHotspots.length > 0) {
            const worst = sellerHotspots[0];
            insights.push({
                insight_type: 'warning',
                title: `Warehouse ${worst.warehouse_id} has high issue rate`,
                description: `${worst.issue_count} issues detected at this FC, primarily ${worst.primary_issue_type}.`,
                recommended_action: 'Consider routing inventory through different fulfillment centers.',
                priority: worst.severity === 'critical' ? 'urgent' : 'high',
                related_data: worst
            });
        }

        // Insight: Risk score
        if (patterns.risk_score >= 70) {
            insights.push({
                insight_type: 'warning',
                title: 'High risk score',
                description: `Your account has a risk score of ${patterns.risk_score}/100 based on issue frequency and value.`,
                recommended_action: 'Focus on resolving pending claims and addressing root causes.',
                priority: 'urgent',
                related_data: { risk_score: patterns.risk_score }
            });
        }

        return insights.sort((a, b) => {
            const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
    } catch (err: any) {
        logger.error('📊 [PATTERNS] Error generating insights', { error: err.message });
        return [];
    }
}

// ============================================================================
// Exports
// ============================================================================

export default {
    analyzeSellerPatterns,
    detectWarehouseHotspots,
    analyzeTrends,
    generateInsights
};
