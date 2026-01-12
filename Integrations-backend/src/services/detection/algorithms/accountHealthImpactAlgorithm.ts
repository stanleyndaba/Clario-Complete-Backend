/**
 * Account Health Impact Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Account Risk Intelligence
 * 
 * Problem: Amazon account health issues can cause:
 * - Suppressed listings = lost sales
 * - Stranded inventory = tied capital
 * - Policy warnings = future risk
 * 
 * Quantifies the FINANCIAL IMPACT of account health problems.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface AccountHealthIssue {
    id: string;
    seller_id: string;
    issue_type: HealthIssueType;
    issue_date: string;
    resolved_date?: string;

    // Affected items
    affected_skus: string[];
    affected_asins: string[];
    affected_quantity: number;

    // Status
    is_resolved: boolean;
    days_active: number;

    // Context
    reason_code?: string;
    category?: string;
}

export type HealthIssueType =
    | 'listing_suppressed'
    | 'stranded_inventory'
    | 'policy_warning'
    | 'ip_complaint'
    | 'authenticity_concern'
    | 'product_safety'
    | 'price_alert'
    | 'inactive_listing';

export interface AccountHealthImpactResult {
    seller_id: string;
    sync_id: string;

    // Issue identification
    issue_id: string;
    issue_type: HealthIssueType;

    // Impact assessment
    severity: 'low' | 'medium' | 'high' | 'critical';
    impact_type: 'lost_sales' | 'tied_capital' | 'future_risk' | 'reputational';

    // Financial impact
    daily_revenue_loss: number;
    total_revenue_loss: number;
    at_risk_inventory_value: number;
    total_financial_impact: number;
    currency: string;

    // Duration
    days_active: number;
    is_ongoing: boolean;

    // Affected items
    affected_sku_count: number;
    affected_quantity: number;

    // Confidence
    confidence_score: number;

    // Action
    recommended_action: 'monitor' | 'address_urgently' | 'escalate';
    urgency_level: 'low' | 'medium' | 'high' | 'critical';

    evidence: {
        issue: AccountHealthIssue;
        detection_reasons: string[];
    };
}

// ============================================================================
// Constants
// ============================================================================

const THRESHOLD_SHOW = 0.55;
const MIN_IMPACT = 25;

// Daily revenue estimates by issue type
const DAILY_IMPACT_ESTIMATES: Record<HealthIssueType, number> = {
    listing_suppressed: 50,
    stranded_inventory: 20,
    policy_warning: 10,
    ip_complaint: 100,
    authenticity_concern: 150,
    product_safety: 200,
    price_alert: 25,
    inactive_listing: 15
};

// ============================================================================
// Core Detection
// ============================================================================

export async function detectAccountHealthImpact(
    sellerId: string,
    syncId: string,
    issues: AccountHealthIssue[],
    inventoryValues: Map<string, number>
): Promise<AccountHealthImpactResult[]> {
    const results: AccountHealthImpactResult[] = [];

    logger.info('⚠️ [HEALTH-IMPACT] Starting account health impact detection', {
        sellerId, syncId, issueCount: issues.length
    });

    for (const issue of issues) {
        // Calculate daily revenue loss
        const dailyRate = DAILY_IMPACT_ESTIMATES[issue.issue_type] || 20;
        const dailyLoss = dailyRate * Math.max(1, issue.affected_skus.length);
        const totalLoss = dailyLoss * issue.days_active;

        // Calculate at-risk inventory value
        let atRiskValue = 0;
        for (const sku of issue.affected_skus) {
            atRiskValue += inventoryValues.get(sku) || 0;
        }
        if (atRiskValue === 0) {
            atRiskValue = issue.affected_quantity * 15; // Default $15/unit
        }

        const totalImpact = totalLoss + (issue.is_resolved ? 0 : atRiskValue * 0.1);

        if (totalImpact >= MIN_IMPACT) {
            const severity = determineSeverity(issue, totalImpact);

            results.push({
                seller_id: sellerId,
                sync_id: syncId,
                issue_id: issue.id,
                issue_type: issue.issue_type,
                severity,
                impact_type: getImpactType(issue.issue_type),
                daily_revenue_loss: dailyLoss,
                total_revenue_loss: totalLoss,
                at_risk_inventory_value: atRiskValue,
                total_financial_impact: totalImpact,
                currency: 'USD',
                days_active: issue.days_active,
                is_ongoing: !issue.is_resolved,
                affected_sku_count: issue.affected_skus.length,
                affected_quantity: issue.affected_quantity,
                confidence_score: 0.70,
                recommended_action: severity === 'critical' ? 'escalate' :
                    severity === 'high' ? 'address_urgently' : 'monitor',
                urgency_level: severity,
                evidence: {
                    issue,
                    detection_reasons: [
                        `${issue.issue_type.replace(/_/g, ' ')}: ${issue.days_active} days active`,
                        `Estimated daily loss: $${dailyLoss.toFixed(2)}`,
                        `Total revenue loss: $${totalLoss.toFixed(2)}`,
                        `Affected SKUs: ${issue.affected_skus.length}`
                    ]
                }
            });
        }
    }

    results.sort((a, b) => b.total_financial_impact - a.total_financial_impact);

    logger.info('⚠️ [HEALTH-IMPACT] Detection complete', {
        sellerId, impactsFound: results.length,
        totalImpact: results.reduce((sum, r) => sum + r.total_financial_impact, 0).toFixed(2),
        ongoingIssues: results.filter(r => r.is_ongoing).length
    });

    return results;
}

function determineSeverity(
    issue: AccountHealthIssue,
    totalImpact: number
): 'low' | 'medium' | 'high' | 'critical' {
    // Critical issues
    if (['authenticity_concern', 'product_safety', 'ip_complaint'].includes(issue.issue_type)) {
        return issue.days_active > 3 ? 'critical' : 'high';
    }

    if (totalImpact >= 500 || issue.days_active >= 14) return 'critical';
    if (totalImpact >= 200 || issue.days_active >= 7) return 'high';
    if (totalImpact >= 50) return 'medium';
    return 'low';
}

function getImpactType(issueType: HealthIssueType): AccountHealthImpactResult['impact_type'] {
    switch (issueType) {
        case 'listing_suppressed':
        case 'inactive_listing':
            return 'lost_sales';
        case 'stranded_inventory':
            return 'tied_capital';
        case 'ip_complaint':
        case 'authenticity_concern':
            return 'reputational';
        default:
            return 'future_risk';
    }
}

// ============================================================================
// Database Functions
// ============================================================================

export async function fetchAccountHealthIssues(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<AccountHealthIssue[]> {
    const lookbackDays = options.lookbackDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const issues: AccountHealthIssue[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('account_health_issues')
            .select('*')
            .eq('seller_id', sellerId)
            .gte('issue_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                const issueDate = new Date(row.issue_date);
                const endDate = row.resolved_date ? new Date(row.resolved_date) : new Date();
                const daysActive = Math.floor((endDate.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24));

                issues.push({
                    id: row.id,
                    seller_id: sellerId,
                    issue_type: row.issue_type || 'policy_warning',
                    issue_date: row.issue_date,
                    resolved_date: row.resolved_date,
                    affected_skus: row.affected_skus || [],
                    affected_asins: row.affected_asins || [],
                    affected_quantity: row.affected_quantity || 0,
                    is_resolved: !!row.resolved_date,
                    days_active: Math.max(1, daysActive),
                    reason_code: row.reason_code,
                    category: row.category
                });
            }
        }

        logger.info('⚠️ [HEALTH-IMPACT] Fetched issues', { sellerId, count: issues.length });
    } catch (err: any) {
        logger.error('⚠️ [HEALTH-IMPACT] Error fetching issues', { error: err.message });
    }

    return issues;
}

export async function fetchInventoryValues(sellerId: string): Promise<Map<string, number>> {
    const values = new Map<string, number>();

    try {
        const { data, error } = await supabaseAdmin
            .from('inventory')
            .select('sku, quantity, unit_value')
            .eq('seller_id', sellerId);

        if (!error && data) {
            for (const row of data) {
                const qty = row.quantity || 0;
                const unitVal = parseFloat(row.unit_value) || 15;
                values.set(row.sku, qty * unitVal);
            }
        }
    } catch (err: any) {
        logger.error('⚠️ [HEALTH-IMPACT] Error fetching inventory values', { error: err.message });
    }

    return values;
}

export async function storeAccountHealthImpactResults(results: AccountHealthImpactResult[]): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'account_health_impact',
            severity: r.severity,
            estimated_value: r.total_financial_impact,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                issue_id: r.issue_id,
                issue_type: r.issue_type,
                impact_type: r.impact_type,
                daily_revenue_loss: r.daily_revenue_loss,
                total_revenue_loss: r.total_revenue_loss,
                at_risk_inventory_value: r.at_risk_inventory_value,
                days_active: r.days_active,
                is_ongoing: r.is_ongoing,
                affected_sku_count: r.affected_sku_count,
                urgency_level: r.urgency_level,
                detection_reasons: r.evidence.detection_reasons
            },
            status: 'pending'
        }));

        await supabaseAdmin.from('detection_results').insert(records);
        logger.info('⚠️ [HEALTH-IMPACT] Stored results', { count: records.length });
    } catch (err: any) {
        logger.error('⚠️ [HEALTH-IMPACT] Error storing results', { error: err.message });
    }
}

export { THRESHOLD_SHOW, MIN_IMPACT, DAILY_IMPACT_ESTIMATES };
