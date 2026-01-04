/**
 * Closed Case Re-Auditor
 * 
 * Re-audit "closed" and "auto-resolved" Amazon cases for:
 * - Underpayments (reimbursed less than claimed)
 * - Missing follow-through (case closed but no payment)
 * - Partial approvals that should be escalated
 * 
 * Why this matters:
 * Amazon often "closes" cases with:
 * - $0 payment ("We determined no reimbursement is due")
 * - Partial payment (50% of claim value)
 * - Auto-resolution that missed items
 * 
 * This auditor catches money left behind.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ClosedCaseAuditResult {
    case_id: string;
    seller_id: string;
    audit_type:
    | 'underpayment'           // Reimbursed < claimed
    | 'zero_resolution'        // Closed with $0 when money was owed
    | 'partial_approval'       // Approved but < 80% of claim
    | 'missing_followthrough'  // Case closed but no payment recorded
    | 're_audit_opportunity';  // Old case worth reopening

    original_claim_amount: number;
    actual_reimbursement: number;
    gap_amount: number;
    currency: string;
    case_status: string;
    closed_date: string;
    reopen_recommended: boolean;
    confidence_score: number;
    evidence: ClosedCaseEvidence;
}

export interface ClosedCaseEvidence {
    case_details: any;
    reimbursement_history: any[];
    gap_percentage: number;
    days_since_closed: number;
    reopen_deadline_days: number;
    audit_notes: string;
}

export interface ClosedCaseDetectionResult {
    seller_id: string;
    sync_id: string;
    anomaly_type: 'closed_case_underpayment';
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number;
    currency: string;
    confidence_score: number;
    evidence: ClosedCaseEvidence;
    related_event_ids: string[];
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    audit_result: ClosedCaseAuditResult;
}

// ============================================================================
// Audit Configuration
// ============================================================================

const AUDIT_CONFIG = {
    LOOKBACK_DAYS: 180,              // Audit cases closed in last 180 days
    MIN_GAP_PERCENTAGE: 20,          // Flag if gap >= 20% of claim
    MIN_GAP_AMOUNT: 10,              // Minimum $10 gap to report
    REOPEN_WINDOW_DAYS: 90,          // Amazon allows reopening within 90 days typically
    ZERO_PAYMENT_MIN_CLAIM: 25,      // Flag $0 resolutions on claims >= $25
};

// ============================================================================
// Helper Functions
// ============================================================================

function calculateDeadline(closedDate: Date): { deadline: Date; daysRemaining: number } {
    const deadline = new Date(closedDate);
    deadline.setDate(deadline.getDate() + AUDIT_CONFIG.REOPEN_WINDOW_DAYS);
    const daysRemaining = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { deadline, daysRemaining: Math.max(0, daysRemaining) };
}

function calculateSeverity(gapAmount: number, gapPercentage: number): 'low' | 'medium' | 'high' | 'critical' {
    if (gapAmount >= 500 || gapPercentage >= 80) return 'critical';
    if (gapAmount >= 100 || gapPercentage >= 50) return 'high';
    if (gapAmount >= 25 || gapPercentage >= 30) return 'medium';
    return 'low';
}

// ============================================================================
// Audit Algorithms
// ============================================================================

/**
 * Audit for Underpayments
 * 
 * Find closed cases where reimbursement < claim amount
 */
async function auditUnderpayments(sellerId: string): Promise<ClosedCaseAuditResult[]> {
    const results: ClosedCaseAuditResult[] = [];
    const lookbackDate = new Date(Date.now() - AUDIT_CONFIG.LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    try {
        // Get closed cases with both claim and reimbursement data
        const { data: closedCases, error } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('seller_id', sellerId)
            .in('status', ['closed', 'resolved', 'approved', 'auto_resolved', 'denied'])
            .gte('updated_at', lookbackDate)
            .not('estimated_value', 'is', null)
            .limit(500);

        if (error || !closedCases?.length) return results;

        // Get reimbursement events for comparison
        const { data: reimbursements, error: reimbError } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('event_type', 'reimbursement')
            .gte('event_date', lookbackDate)
            .limit(2000);

        const reimbursementMap = new Map<string, number>();
        for (const r of (reimbursements || [])) {
            const key = r.amazon_order_id || r.id;
            reimbursementMap.set(key, (reimbursementMap.get(key) || 0) + Math.abs(r.amount || 0));
        }

        for (const caseData of closedCases) {
            const claimAmount = caseData.estimated_value || 0;
            if (claimAmount < AUDIT_CONFIG.MIN_GAP_AMOUNT) continue;

            // Find matching reimbursement
            const orderId = caseData.evidence?.order_id || caseData.amazon_order_id;
            const actualReimbursement = reimbursementMap.get(orderId) ||
                reimbursementMap.get(caseData.id) ||
                caseData.approved_amount || 0;

            const gap = claimAmount - actualReimbursement;
            const gapPercentage = claimAmount > 0 ? (gap / claimAmount) * 100 : 0;

            // Check for underpayment
            if (gap >= AUDIT_CONFIG.MIN_GAP_AMOUNT && gapPercentage >= AUDIT_CONFIG.MIN_GAP_PERCENTAGE) {
                const closedDate = new Date(caseData.updated_at);
                const { deadline, daysRemaining } = calculateDeadline(closedDate);

                results.push({
                    case_id: caseData.id,
                    seller_id: sellerId,
                    audit_type: 'underpayment',
                    original_claim_amount: claimAmount,
                    actual_reimbursement: actualReimbursement,
                    gap_amount: gap,
                    currency: caseData.currency || 'USD',
                    case_status: caseData.status,
                    closed_date: caseData.updated_at,
                    reopen_recommended: daysRemaining > 0,
                    confidence_score: 0.85,
                    evidence: {
                        case_details: caseData,
                        reimbursement_history: [],
                        gap_percentage: gapPercentage,
                        days_since_closed: Math.ceil((Date.now() - closedDate.getTime()) / (1000 * 60 * 60 * 24)),
                        reopen_deadline_days: daysRemaining,
                        audit_notes: `Case closed with $${actualReimbursement.toFixed(2)} but claim was $${claimAmount.toFixed(2)} (${gapPercentage.toFixed(1)}% underpayment)`
                    }
                });
            }
        }

        logger.info('[CLOSED CASE AUDIT] Underpayment audit complete', {
            sellerId,
            casesChecked: closedCases.length,
            underpayments: results.length
        });

    } catch (error: any) {
        logger.error('[CLOSED CASE AUDIT] Error in underpayment audit', { sellerId, error: error.message });
    }

    return results;
}

/**
 * Audit for Zero-Dollar Resolutions
 * 
 * Find cases closed with $0 payment where claim had value
 */
async function auditZeroResolutions(sellerId: string): Promise<ClosedCaseAuditResult[]> {
    const results: ClosedCaseAuditResult[] = [];
    const lookbackDate = new Date(Date.now() - AUDIT_CONFIG.LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    try {
        // Get cases denied or closed with no payment
        const { data: deniedCases, error } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('seller_id', sellerId)
            .in('status', ['denied', 'rejected', 'closed'])
            .gte('updated_at', lookbackDate)
            .gte('estimated_value', AUDIT_CONFIG.ZERO_PAYMENT_MIN_CLAIM)
            .limit(300);

        if (error || !deniedCases?.length) return results;

        for (const caseData of deniedCases) {
            const claimAmount = caseData.estimated_value || 0;
            const approvedAmount = caseData.approved_amount || 0;

            // Only flag if truly $0 resolution
            if (approvedAmount === 0 && claimAmount >= AUDIT_CONFIG.ZERO_PAYMENT_MIN_CLAIM) {
                const closedDate = new Date(caseData.updated_at);
                const { deadline, daysRemaining } = calculateDeadline(closedDate);

                results.push({
                    case_id: caseData.id,
                    seller_id: sellerId,
                    audit_type: 'zero_resolution',
                    original_claim_amount: claimAmount,
                    actual_reimbursement: 0,
                    gap_amount: claimAmount,
                    currency: caseData.currency || 'USD',
                    case_status: caseData.status,
                    closed_date: caseData.updated_at,
                    reopen_recommended: daysRemaining > 0 && claimAmount >= 50,
                    confidence_score: 0.75,
                    evidence: {
                        case_details: caseData,
                        reimbursement_history: [],
                        gap_percentage: 100,
                        days_since_closed: Math.ceil((Date.now() - closedDate.getTime()) / (1000 * 60 * 60 * 24)),
                        reopen_deadline_days: daysRemaining,
                        audit_notes: `Case denied with $0 payment but original claim was $${claimAmount.toFixed(2)} - may be worth re-filing with stronger evidence`
                    }
                });
            }
        }

        logger.info('[CLOSED CASE AUDIT] Zero-resolution audit complete', {
            sellerId,
            casesChecked: deniedCases.length,
            zeroResolutions: results.length
        });

    } catch (error: any) {
        logger.error('[CLOSED CASE AUDIT] Error in zero-resolution audit', { sellerId, error: error.message });
    }

    return results;
}

/**
 * Audit for Missing Follow-Through
 * 
 * Cases marked "approved" but no corresponding reimbursement payment
 */
async function auditMissingFollowthrough(sellerId: string): Promise<ClosedCaseAuditResult[]> {
    const results: ClosedCaseAuditResult[] = [];
    const lookbackDate = new Date(Date.now() - AUDIT_CONFIG.LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    try {
        // Get approved cases
        const { data: approvedCases, error } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('seller_id', sellerId)
            .in('status', ['approved', 'pending_payment'])
            .gte('updated_at', lookbackDate)
            .limit(300);

        if (error || !approvedCases?.length) return results;

        // Get all reimbursements
        const { data: reimbursements, error: reimbError } = await supabaseAdmin
            .from('financial_events')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('event_type', 'reimbursement')
            .gte('event_date', lookbackDate)
            .limit(2000);

        const reimbursedOrderIds = new Set((reimbursements || []).map(r => r.amazon_order_id).filter(Boolean));
        const reimbursedCaseIds = new Set((reimbursements || []).map(r => r.case_id).filter(Boolean));

        for (const caseData of approvedCases) {
            const orderId = caseData.evidence?.order_id || caseData.amazon_order_id;
            const hasPayment = reimbursedOrderIds.has(orderId) || reimbursedCaseIds.has(caseData.id);

            if (!hasPayment && caseData.estimated_value >= AUDIT_CONFIG.MIN_GAP_AMOUNT) {
                const closedDate = new Date(caseData.updated_at);
                const daysSinceClosed = Math.ceil((Date.now() - closedDate.getTime()) / (1000 * 60 * 60 * 24));

                // Only flag if approved > 14 days ago (give time for payment)
                if (daysSinceClosed >= 14) {
                    const { deadline, daysRemaining } = calculateDeadline(closedDate);

                    results.push({
                        case_id: caseData.id,
                        seller_id: sellerId,
                        audit_type: 'missing_followthrough',
                        original_claim_amount: caseData.estimated_value,
                        actual_reimbursement: 0,
                        gap_amount: caseData.estimated_value,
                        currency: caseData.currency || 'USD',
                        case_status: caseData.status,
                        closed_date: caseData.updated_at,
                        reopen_recommended: true,
                        confidence_score: 0.90,
                        evidence: {
                            case_details: caseData,
                            reimbursement_history: [],
                            gap_percentage: 100,
                            days_since_closed: daysSinceClosed,
                            reopen_deadline_days: daysRemaining,
                            audit_notes: `Case approved ${daysSinceClosed} days ago for $${caseData.estimated_value.toFixed(2)} but no payment received - follow up required`
                        }
                    });
                }
            }
        }

        logger.info('[CLOSED CASE AUDIT] Missing follow-through audit complete', {
            sellerId,
            casesChecked: approvedCases.length,
            missingPayments: results.length
        });

    } catch (error: any) {
        logger.error('[CLOSED CASE AUDIT] Error in follow-through audit', { sellerId, error: error.message });
    }

    return results;
}

// ============================================================================
// Main Audit Runner
// ============================================================================

/**
 * Run all closed case audits
 */
export async function runClosedCaseAudit(
    sellerId: string,
    syncId: string
): Promise<ClosedCaseDetectionResult[]> {
    logger.info('[CLOSED CASE AUDIT] Starting closed case audit', { sellerId, syncId });

    const [underpayments, zeroResolutions, missingFollowthrough] = await Promise.all([
        auditUnderpayments(sellerId),
        auditZeroResolutions(sellerId),
        auditMissingFollowthrough(sellerId)
    ]);

    const allAudits = [...underpayments, ...zeroResolutions, ...missingFollowthrough];

    // Convert to detection results
    const results: ClosedCaseDetectionResult[] = allAudits.map(audit => {
        const closedDate = new Date(audit.closed_date);
        const { deadline, daysRemaining } = calculateDeadline(closedDate);

        return {
            seller_id: audit.seller_id,
            sync_id: syncId,
            anomaly_type: 'closed_case_underpayment' as const,
            severity: calculateSeverity(audit.gap_amount, audit.evidence.gap_percentage),
            estimated_value: audit.gap_amount,
            currency: audit.currency,
            confidence_score: audit.confidence_score,
            evidence: audit.evidence,
            related_event_ids: [audit.case_id],
            discovery_date: new Date(),
            deadline_date: deadline,
            days_remaining: daysRemaining,
            audit_result: audit
        };
    });

    logger.info('[CLOSED CASE AUDIT] Audit complete', {
        sellerId,
        syncId,
        totalFindings: results.length,
        totalValue: results.reduce((s, r) => s + r.estimated_value, 0),
        byType: {
            underpayments: underpayments.length,
            zeroResolutions: zeroResolutions.length,
            missingFollowthrough: missingFollowthrough.length
        }
    });

    return results;
}

/**
 * Store closed case audit results
 */
export async function storeClosedCaseAuditResults(results: ClosedCaseDetectionResult[]): Promise<void> {
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
            logger.error('[CLOSED CASE AUDIT] Failed to store results', { error: error.message });
        } else {
            logger.info('[CLOSED CASE AUDIT] Results stored', { count: records.length });
        }

    } catch (error: any) {
        logger.error('[CLOSED CASE AUDIT] Error storing results', { error: error.message });
    }
}

export default {
    runClosedCaseAudit,
    storeClosedCaseAuditResults,
    auditUnderpayments,
    auditZeroResolutions,
    auditMissingFollowthrough
};
