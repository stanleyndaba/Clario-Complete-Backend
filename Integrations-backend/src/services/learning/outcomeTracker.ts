/**
 * Agent 11: Outcome Tracker
 * 
 * Tracks claim outcomes and builds intelligence over time.
 * 
 * Tracks:
 * - Approval/Denial rates by claim type
 * - Approval rates by marketplace
 * - Approval rates by claim age
 * - Approval rates by evidence completeness
 * - Recovery rates vs estimated values
 * 
 * Goal: Learn what works and feed back into detection
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ClaimOutcome {
    id: string;
    seller_id: string;
    detection_id: string;
    case_id?: string;

    // Claim details
    anomaly_type: string;
    claim_category: string;
    marketplace: string;

    // Amounts
    estimated_value: number;
    claimed_amount: number;
    approved_amount: number;
    currency: string;

    // Timing
    claim_age_days: number;
    time_to_resolution_days: number;

    // Evidence
    evidence_completeness: number;  // 0-1
    evidence_document_count: number;
    evidence_types: string[];

    // Outcome
    outcome: 'approved' | 'partial' | 'denied' | 'pending' | 'expired';
    denial_reason?: string;

    // Metadata
    created_at: Date;
    resolved_at?: Date;
}

export interface OutcomeStats {
    total_claims: number;
    approved: number;
    partial: number;
    denied: number;
    pending: number;
    expired: number;

    approval_rate: number;
    partial_rate: number;
    denial_rate: number;

    total_estimated: number;
    total_claimed: number;
    total_approved: number;
    recovery_rate: number;

    avg_time_to_resolution: number;
}

export interface OutcomesByDimension {
    by_claim_type: Record<string, OutcomeStats>;
    by_marketplace: Record<string, OutcomeStats>;
    by_claim_age: Record<string, OutcomeStats>;  // "0-7d", "8-30d", "31-60d"
    by_evidence_quality: Record<string, OutcomeStats>;  // "low", "medium", "high"
}

// ============================================================================
// Outcome Recording
// ============================================================================

/**
 * Record a claim outcome for learning
 */
export async function recordOutcome(outcome: ClaimOutcome): Promise<boolean> {
    try {
        const { error } = await supabaseAdmin
            .from('claim_outcomes')
            .upsert({
                id: outcome.id,
                seller_id: outcome.seller_id,
                detection_id: outcome.detection_id,
                case_id: outcome.case_id,
                anomaly_type: outcome.anomaly_type,
                claim_category: outcome.claim_category,
                marketplace: outcome.marketplace,
                estimated_value: outcome.estimated_value,
                claimed_amount: outcome.claimed_amount,
                approved_amount: outcome.approved_amount,
                currency: outcome.currency,
                claim_age_days: outcome.claim_age_days,
                time_to_resolution_days: outcome.time_to_resolution_days,
                evidence_completeness: outcome.evidence_completeness,
                evidence_document_count: outcome.evidence_document_count,
                evidence_types: outcome.evidence_types,
                outcome: outcome.outcome,
                denial_reason: outcome.denial_reason,
                created_at: outcome.created_at.toISOString(),
                resolved_at: outcome.resolved_at?.toISOString()
            }, { onConflict: 'id' });

        if (error) {
            logger.error('[OUTCOME TRACKER] Failed to record outcome', { error: error.message });
            return false;
        }

        logger.info('[OUTCOME TRACKER] Outcome recorded', {
            outcomeId: outcome.id,
            anomalyType: outcome.anomaly_type,
            outcome: outcome.outcome,
            approvedAmount: outcome.approved_amount
        });

        return true;
    } catch (error: any) {
        logger.error('[OUTCOME TRACKER] Error recording outcome', { error: error.message });
        return false;
    }
}

/**
 * Bulk record outcomes from dispute case updates
 */
export async function syncOutcomesFromCases(sellerId: string): Promise<number> {
    let recorded = 0;

    try {
        // Get all resolved cases
        const { data: cases, error } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('seller_id', sellerId)
            .in('status', ['approved', 'denied', 'closed', 'partial'])
            .is('outcome_recorded', null)
            .limit(500);

        if (error || !cases?.length) return 0;

        for (const caseData of cases) {
            const outcome: ClaimOutcome = {
                id: `outcome_${caseData.id}`,
                seller_id: sellerId,
                detection_id: caseData.detection_id || caseData.id,
                case_id: caseData.id,
                anomaly_type: caseData.evidence?.anomaly_type || caseData.case_type || 'unknown',
                claim_category: caseData.case_type || 'general',
                marketplace: caseData.marketplace || 'US',
                estimated_value: caseData.estimated_value || 0,
                claimed_amount: caseData.claimed_amount || caseData.estimated_value || 0,
                approved_amount: caseData.approved_amount || 0,
                currency: caseData.currency || 'USD',
                claim_age_days: calculateClaimAge(caseData.discovery_date || caseData.created_at, caseData.updated_at),
                time_to_resolution_days: calculateDaysBetween(caseData.created_at, caseData.updated_at),
                evidence_completeness: caseData.evidence_completeness || 0.5,
                evidence_document_count: (caseData.evidence_document_ids || []).length,
                evidence_types: caseData.evidence_types || [],
                outcome: mapCaseStatusToOutcome(caseData.status),
                denial_reason: caseData.denial_reason,
                created_at: new Date(caseData.created_at),
                resolved_at: new Date(caseData.updated_at)
            };

            if (await recordOutcome(outcome)) {
                // Mark as recorded
                await supabaseAdmin
                    .from('dispute_cases')
                    .update({ outcome_recorded: true })
                    .eq('id', caseData.id);
                recorded++;
            }
        }

        logger.info('[OUTCOME TRACKER] Synced outcomes from cases', { sellerId, recorded });

    } catch (error: any) {
        logger.error('[OUTCOME TRACKER] Error syncing outcomes', { error: error.message });
    }

    return recorded;
}

function calculateClaimAge(discoveryDate: string, resolutionDate: string): number {
    const discovery = new Date(discoveryDate);
    const resolution = new Date(resolutionDate);
    return Math.ceil((resolution.getTime() - discovery.getTime()) / (1000 * 60 * 60 * 24));
}

function calculateDaysBetween(start: string, end: string): number {
    const startDate = new Date(start);
    const endDate = new Date(end);
    return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
}

function mapCaseStatusToOutcome(status: string): ClaimOutcome['outcome'] {
    const mapping: Record<string, ClaimOutcome['outcome']> = {
        'approved': 'approved',
        'partial': 'partial',
        'denied': 'denied',
        'rejected': 'denied',
        'closed': 'denied',  // Closed without approval usually means denied
        'pending': 'pending',
        'expired': 'expired'
    };
    return mapping[status] || 'pending';
}

// ============================================================================
// Outcome Analytics
// ============================================================================

/**
 * Get outcome statistics by various dimensions
 */
export async function getOutcomeStats(
    sellerId?: string,
    startDate?: string,
    endDate?: string
): Promise<OutcomesByDimension> {
    const results: OutcomesByDimension = {
        by_claim_type: {},
        by_marketplace: {},
        by_claim_age: {},
        by_evidence_quality: {}
    };

    try {
        let query = supabaseAdmin
            .from('claim_outcomes')
            .select('*');

        if (sellerId) {
            query = query.eq('seller_id', sellerId);
        }
        if (startDate) {
            query = query.gte('created_at', startDate);
        }
        if (endDate) {
            query = query.lte('created_at', endDate);
        }

        const { data: outcomes, error } = await query.limit(10000);

        if (error || !outcomes?.length) {
            return results;
        }

        // Group by claim type
        results.by_claim_type = groupAndCalculateStats(outcomes, 'anomaly_type');

        // Group by marketplace
        results.by_marketplace = groupAndCalculateStats(outcomes, 'marketplace');

        // Group by claim age bucket
        const withAgeBucket = outcomes.map(o => ({
            ...o,
            age_bucket: getAgeBucket(o.claim_age_days)
        }));
        results.by_claim_age = groupAndCalculateStats(withAgeBucket, 'age_bucket');

        // Group by evidence quality
        const withQuality = outcomes.map(o => ({
            ...o,
            evidence_quality: getEvidenceQuality(o.evidence_completeness)
        }));
        results.by_evidence_quality = groupAndCalculateStats(withQuality, 'evidence_quality');

        logger.info('[OUTCOME TRACKER] Stats calculated', {
            totalOutcomes: outcomes.length,
            claimTypes: Object.keys(results.by_claim_type).length,
            marketplaces: Object.keys(results.by_marketplace).length
        });

    } catch (error: any) {
        logger.error('[OUTCOME TRACKER] Error calculating stats', { error: error.message });
    }

    return results;
}

function getAgeBucket(days: number): string {
    if (days <= 7) return '0-7d';
    if (days <= 30) return '8-30d';
    if (days <= 60) return '31-60d';
    return '60+d';
}

function getEvidenceQuality(completeness: number): string {
    if (completeness >= 0.8) return 'high';
    if (completeness >= 0.5) return 'medium';
    return 'low';
}

function groupAndCalculateStats(
    outcomes: any[],
    groupKey: string
): Record<string, OutcomeStats> {
    const groups = new Map<string, any[]>();

    for (const outcome of outcomes) {
        const key = outcome[groupKey] || 'unknown';
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(outcome);
    }

    const result: Record<string, OutcomeStats> = {};

    for (const [key, group] of groups) {
        const total = group.length;
        const approved = group.filter(o => o.outcome === 'approved').length;
        const partial = group.filter(o => o.outcome === 'partial').length;
        const denied = group.filter(o => o.outcome === 'denied').length;
        const pending = group.filter(o => o.outcome === 'pending').length;
        const expired = group.filter(o => o.outcome === 'expired').length;

        const totalEstimated = group.reduce((s, o) => s + (o.estimated_value || 0), 0);
        const totalClaimed = group.reduce((s, o) => s + (o.claimed_amount || 0), 0);
        const totalApproved = group.reduce((s, o) => s + (o.approved_amount || 0), 0);

        const resolutionTimes = group
            .filter(o => o.time_to_resolution_days > 0)
            .map(o => o.time_to_resolution_days);
        const avgTimeToResolution = resolutionTimes.length > 0
            ? resolutionTimes.reduce((s, t) => s + t, 0) / resolutionTimes.length
            : 0;

        result[key] = {
            total_claims: total,
            approved,
            partial,
            denied,
            pending,
            expired,
            approval_rate: total > 0 ? (approved + partial * 0.5) / total : 0,
            partial_rate: total > 0 ? partial / total : 0,
            denial_rate: total > 0 ? denied / total : 0,
            total_estimated: totalEstimated,
            total_claimed: totalClaimed,
            total_approved: totalApproved,
            recovery_rate: totalClaimed > 0 ? totalApproved / totalClaimed : 0,
            avg_time_to_resolution: avgTimeToResolution
        };
    }

    return result;
}

/**
 * Get denial reasons analysis
 */
export async function getDenialReasonAnalysis(sellerId?: string): Promise<Record<string, number>> {
    const reasons: Record<string, number> = {};

    try {
        let query = supabaseAdmin
            .from('claim_outcomes')
            .select('denial_reason')
            .eq('outcome', 'denied')
            .not('denial_reason', 'is', null);

        if (sellerId) {
            query = query.eq('seller_id', sellerId);
        }

        const { data, error } = await query.limit(5000);

        if (error || !data?.length) return reasons;

        for (const row of data) {
            const reason = normalizeReason(row.denial_reason);
            reasons[reason] = (reasons[reason] || 0) + 1;
        }

    } catch (error: any) {
        logger.error('[OUTCOME TRACKER] Error analyzing denial reasons', { error: error.message });
    }

    return reasons;
}

function normalizeReason(reason: string): string {
    const lower = reason.toLowerCase();

    if (lower.includes('insufficient') || lower.includes('evidence')) return 'insufficient_evidence';
    if (lower.includes('policy') || lower.includes('policy')) return 'policy_violation';
    if (lower.includes('expired') || lower.includes('deadline')) return 'past_deadline';
    if (lower.includes('already') || lower.includes('reimbursed')) return 'already_reimbursed';
    if (lower.includes('investigation') || lower.includes('determined')) return 'investigation_inconclusive';
    if (lower.includes('duplicate')) return 'duplicate_claim';

    return 'other';
}

export default {
    recordOutcome,
    syncOutcomesFromCases,
    getOutcomeStats,
    getDenialReasonAnalysis
};
