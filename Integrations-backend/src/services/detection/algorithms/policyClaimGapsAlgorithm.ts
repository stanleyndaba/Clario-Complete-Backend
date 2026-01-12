/**
 * Policy / Claim Workflow Gaps Detection Algorithm
 * 
 * Agent 3: Discovery Agent - Claims Process Intelligence
 * 
 * Problem: Gaps in how Amazon processes claims:
 * 1. Partial reimbursements vs full loss
 * 2. Auto-closed or "no additional info" cases  
 * 3. Expired but still fixable errors
 * 
 * This finds money left on the table in claim processing.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ClaimRecord {
    id: string;
    seller_id: string;
    case_id: string;
    claim_type: ClaimType;
    claim_date: string;

    // Amounts
    claimed_units: number;
    claimed_amount: number;
    reimbursed_units: number;
    reimbursed_amount: number;
    currency: string;

    // Status
    status: ClaimStatus;
    resolution_reason?: string;
    closed_date?: string;

    // Reference
    shipment_id?: string;
    order_id?: string;
    sku?: string;
    asin?: string;

    // Evidence
    has_pod: boolean;
    has_invoice: boolean;
    has_photos: boolean;

    // Timing
    days_since_event: number;
    days_since_closed?: number;
}

export type ClaimType =
    | 'lost_inbound'
    | 'lost_warehouse'
    | 'damaged_inbound'
    | 'damaged_warehouse'
    | 'customer_return'
    | 'removal_issue'
    | 'fee_dispute'
    | 'other';

export type ClaimStatus =
    | 'open'
    | 'pending'
    | 'resolved'
    | 'closed_denied'
    | 'closed_partial'
    | 'auto_closed'
    | 'expired';

export interface ClaimGapResult {
    seller_id: string;
    sync_id: string;

    // Claim info
    case_id: string;
    claim_type: ClaimType;

    // Gap classification
    gap_type: ClaimGapType;
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Recovery opportunity
    units_shortfall: number;
    amount_shortfall: number;
    recovery_probability: number;  // 0-1
    expected_recovery: number;
    currency: string;

    // Gap details
    gap_reason: string;
    gap_details: GapDetails;

    // Action
    recommended_action: RecommendedAction;
    action_priority: 'low' | 'medium' | 'high' | 'urgent';
    action_steps: string[];

    // Evidence status
    evidence_available: boolean;
    evidence_types: string[];
    new_evidence_needed: string[];

    // Timing
    days_remaining?: number;  // Before expiration
    is_time_sensitive: boolean;

    // Confidence
    confidence_score: number;

    evidence: {
        claim_record: ClaimRecord;
        detection_reasons: string[];
    };
}

export type ClaimGapType =
    | 'partial_reimbursement'     // Only part reimbursed
    | 'auto_closed_reopenable'    // Generic close, can reopen
    | 'denied_with_evidence'      // Denied but have proof
    | 'expired_with_exception'    // Outside window but fixable
    | 'missing_follow_up'         // Case needs response
    | 'calculation_error';        // Amazon math wrong

export type RecommendedAction =
    | 'reopen_case'
    | 'file_appeal'
    | 'submit_evidence'
    | 'escalate_to_manager'
    | 'refile_new_claim'
    | 'document_for_future'
    | 'monitor';

export interface GapDetails {
    original_claim: number;
    received_amount: number;
    shortfall: number;
    shortfall_percent: number;
    closure_reason?: string;
    exception_applicable?: string;
}

// ============================================================================
// Constants
// ============================================================================

const THRESHOLD_SHOW = 0.55;
const MIN_SHORTFALL = 10; // $10 minimum

// Standard claim windows (days)
const STANDARD_WINDOWS = {
    lost_inbound: 9 * 30,      // 9 months
    lost_warehouse: 18 * 30,   // 18 months
    damaged_inbound: 9 * 30,
    damaged_warehouse: 18 * 30,
    customer_return: 45,
    removal_issue: 6 * 30,
    fee_dispute: 90
};

// Extension windows for exceptions
const EXCEPTION_EXTENSIONS = {
    carrier_delay: 60,
    amazon_delay: 90,
    system_error: 120,
    pandemic: 180
};

// Auto-close reasons that are reopenable
const REOPENABLE_REASONS = [
    'no additional information',
    'not enough evidence',
    'please provide more details',
    'case auto-resolved',
    'no response received',
    'insufficient documentation',
    'generic_auto_close'
];

// ============================================================================
// Core Detection
// ============================================================================

export async function detectClaimWorkflowGaps(
    sellerId: string,
    syncId: string,
    claims: ClaimRecord[]
): Promise<ClaimGapResult[]> {
    const results: ClaimGapResult[] = [];

    logger.info('📋 [CLAIM-GAPS] Starting policy/claim workflow gap detection', {
        sellerId, syncId, claimCount: claims.length
    });

    for (const claim of claims) {
        const gaps = analyzeClaimForGaps(sellerId, syncId, claim);
        results.push(...gaps.filter(g =>
            g.confidence_score >= THRESHOLD_SHOW &&
            g.amount_shortfall >= MIN_SHORTFALL
        ));
    }

    results.sort((a, b) => b.expected_recovery - a.expected_recovery);

    const totalRecovery = results.reduce((sum, r) => sum + r.expected_recovery, 0);
    const urgentCount = results.filter(r => r.action_priority === 'urgent').length;

    logger.info('📋 [CLAIM-GAPS] Detection complete', {
        sellerId,
        gapsFound: results.length,
        urgentGaps: urgentCount,
        totalRecoveryOpportunity: totalRecovery.toFixed(2)
    });

    return results;
}

function analyzeClaimForGaps(
    sellerId: string,
    syncId: string,
    claim: ClaimRecord
): ClaimGapResult[] {
    const gaps: ClaimGapResult[] = [];
    const detectionReasons: string[] = [];

    // GAP 1: Partial Reimbursement
    if (claim.reimbursed_amount < claim.claimed_amount && claim.reimbursed_amount > 0) {
        const shortfall = claim.claimed_amount - claim.reimbursed_amount;
        const shortfallPercent = (shortfall / claim.claimed_amount) * 100;

        if (shortfall >= MIN_SHORTFALL && shortfallPercent >= 10) {
            detectionReasons.push(
                `Claimed $${claim.claimed_amount.toFixed(2)}, received $${claim.reimbursed_amount.toFixed(2)}`,
                `Shortfall: $${shortfall.toFixed(2)} (${shortfallPercent.toFixed(0)}%)`
            );

            gaps.push(createGapResult(
                sellerId, syncId, claim,
                'partial_reimbursement',
                shortfall,
                claim.claimed_units - claim.reimbursed_units,
                `Only ${(100 - shortfallPercent).toFixed(0)}% reimbursed`,
                {
                    original_claim: claim.claimed_amount,
                    received_amount: claim.reimbursed_amount,
                    shortfall,
                    shortfall_percent: shortfallPercent
                },
                'reopen_case',
                calculatePartialRecoveryProbability(claim, shortfallPercent),
                detectionReasons,
                claim.has_pod || claim.has_invoice
            ));
        }
    }

    // GAP 2: Auto-Closed Reopenable Cases
    if ((claim.status === 'auto_closed' || claim.status === 'closed_denied') &&
        isReopenable(claim.resolution_reason)) {
        const shortfall = claim.claimed_amount - claim.reimbursed_amount;

        if (shortfall >= MIN_SHORTFALL) {
            const hasNewEvidence = claim.has_pod || claim.has_invoice || claim.has_photos;

            gaps.push(createGapResult(
                sellerId, syncId, claim,
                'auto_closed_reopenable',
                shortfall,
                claim.claimed_units - claim.reimbursed_units,
                `Case closed with generic reason: "${claim.resolution_reason}"`,
                {
                    original_claim: claim.claimed_amount,
                    received_amount: claim.reimbursed_amount,
                    shortfall,
                    shortfall_percent: (shortfall / claim.claimed_amount) * 100,
                    closure_reason: claim.resolution_reason
                },
                hasNewEvidence ? 'submit_evidence' : 'reopen_case',
                hasNewEvidence ? 0.65 : 0.45,
                [`Auto-closed case with recovery opportunity`,
                    `Reason: ${claim.resolution_reason}`,
                    hasNewEvidence ? 'New evidence available' : 'Needs evidence gathering'],
                hasNewEvidence
            ));
        }
    }

    // GAP 3: Denied with Evidence
    if (claim.status === 'closed_denied' &&
        (claim.has_pod || claim.has_invoice) &&
        !isReopenable(claim.resolution_reason)) {
        const shortfall = claim.claimed_amount;

        if (shortfall >= MIN_SHORTFALL) {
            gaps.push(createGapResult(
                sellerId, syncId, claim,
                'denied_with_evidence',
                shortfall,
                claim.claimed_units,
                `Claim denied but seller has supporting evidence`,
                {
                    original_claim: claim.claimed_amount,
                    received_amount: 0,
                    shortfall,
                    shortfall_percent: 100,
                    closure_reason: claim.resolution_reason
                },
                'file_appeal',
                0.55,
                [`Denied case with available evidence`,
                    `POD: ${claim.has_pod ? 'Yes' : 'No'}, Invoice: ${claim.has_invoice ? 'Yes' : 'No'}`],
                true
            ));
        }
    }

    // GAP 4: Expired but with Exception
    if (claim.status === 'expired' || hasExpiredStandard(claim)) {
        const exception = findApplicableException(claim);

        if (exception) {
            const shortfall = claim.claimed_amount - claim.reimbursed_amount;
            const daysRemaining = calculateDaysRemaining(claim, exception);

            if (shortfall >= MIN_SHORTFALL && daysRemaining > 0) {
                gaps.push(createGapResult(
                    sellerId, syncId, claim,
                    'expired_with_exception',
                    shortfall,
                    claim.claimed_units - claim.reimbursed_units,
                    `Outside standard window but ${exception} exception applies`,
                    {
                        original_claim: claim.claimed_amount,
                        received_amount: claim.reimbursed_amount,
                        shortfall,
                        shortfall_percent: (shortfall / claim.claimed_amount) * 100,
                        exception_applicable: exception
                    },
                    'refile_new_claim',
                    0.50,
                    [`Standard window expired but exception applies`,
                        `Exception: ${exception}`,
                        `Days remaining with exception: ${daysRemaining}`],
                    claim.has_pod || claim.has_invoice,
                    daysRemaining,
                    true
                ));
            }
        }
    }

    // GAP 5: Missing Follow-Up
    if (claim.status === 'pending' && claim.days_since_closed && claim.days_since_closed >= 7) {
        const shortfall = claim.claimed_amount - claim.reimbursed_amount;

        if (shortfall >= MIN_SHORTFALL) {
            gaps.push(createGapResult(
                sellerId, syncId, claim,
                'missing_follow_up',
                shortfall,
                claim.claimed_units - claim.reimbursed_units,
                `Case pending response for ${claim.days_since_closed} days`,
                {
                    original_claim: claim.claimed_amount,
                    received_amount: claim.reimbursed_amount,
                    shortfall,
                    shortfall_percent: (shortfall / claim.claimed_amount) * 100
                },
                'submit_evidence',
                0.70,
                [`Case awaiting seller response for ${claim.days_since_closed} days`,
                    'Risk of auto-closure if not responded'],
                claim.has_pod || claim.has_invoice,
                14 - (claim.days_since_closed || 0),
                true
            ));
        }
    }

    return gaps;
}

// ============================================================================
// Helper Functions
// ============================================================================

function createGapResult(
    sellerId: string,
    syncId: string,
    claim: ClaimRecord,
    gapType: ClaimGapType,
    shortfall: number,
    unitsShortfall: number,
    gapReason: string,
    gapDetails: GapDetails,
    action: RecommendedAction,
    probability: number,
    reasons: string[],
    hasEvidence: boolean,
    daysRemaining?: number,
    isTimeSensitive: boolean = false
): ClaimGapResult {
    const expectedRecovery = shortfall * probability;
    const severity = determineSeverity(shortfall, isTimeSensitive);
    const priority = determinePriority(severity, isTimeSensitive, probability);

    return {
        seller_id: sellerId,
        sync_id: syncId,
        case_id: claim.case_id,
        claim_type: claim.claim_type,
        gap_type: gapType,
        severity,
        units_shortfall: unitsShortfall,
        amount_shortfall: shortfall,
        recovery_probability: probability,
        expected_recovery: expectedRecovery,
        currency: claim.currency,
        gap_reason: gapReason,
        gap_details: gapDetails,
        recommended_action: action,
        action_priority: priority,
        action_steps: getActionSteps(action, gapType),
        evidence_available: hasEvidence,
        evidence_types: getEvidenceTypes(claim),
        new_evidence_needed: hasEvidence ? [] : getNeededEvidence(claim.claim_type),
        days_remaining: daysRemaining,
        is_time_sensitive: isTimeSensitive,
        confidence_score: calculateConfidence(claim, gapType, hasEvidence),
        evidence: {
            claim_record: claim,
            detection_reasons: reasons
        }
    };
}

function isReopenable(reason?: string): boolean {
    if (!reason) return true;
    const reasonLower = reason.toLowerCase();
    return REOPENABLE_REASONS.some(r => reasonLower.includes(r));
}

function hasExpiredStandard(claim: ClaimRecord): boolean {
    const standardWindow = STANDARD_WINDOWS[claim.claim_type] || 180;
    return claim.days_since_event > standardWindow;
}

function findApplicableException(claim: ClaimRecord): string | null {
    // Check for carrier delay
    if (claim.claim_type.includes('inbound') && claim.days_since_event <=
        STANDARD_WINDOWS[claim.claim_type] + EXCEPTION_EXTENSIONS.carrier_delay) {
        return 'carrier_delay';
    }
    // Check for Amazon delay  
    if (claim.days_since_event <=
        STANDARD_WINDOWS[claim.claim_type as keyof typeof STANDARD_WINDOWS] + EXCEPTION_EXTENSIONS.amazon_delay) {
        return 'amazon_delay';
    }
    return null;
}

function calculateDaysRemaining(claim: ClaimRecord, exception: string): number {
    const standardWindow = STANDARD_WINDOWS[claim.claim_type as keyof typeof STANDARD_WINDOWS] || 180;
    const extension = EXCEPTION_EXTENSIONS[exception as keyof typeof EXCEPTION_EXTENSIONS] || 0;
    return (standardWindow + extension) - claim.days_since_event;
}

function calculatePartialRecoveryProbability(claim: ClaimRecord, shortfallPercent: number): number {
    let probability = 0.50;

    if (shortfallPercent >= 50) probability += 0.15; // Large shortfall = more likely error
    if (claim.has_pod) probability += 0.15;
    if (claim.has_invoice) probability += 0.10;
    if (shortfallPercent < 30) probability -= 0.10; // Small shortfall = less compelling

    return Math.min(0.85, Math.max(0.30, probability));
}

function calculateConfidence(claim: ClaimRecord, gapType: ClaimGapType, hasEvidence: boolean): number {
    let score = 0.50;

    if (hasEvidence) score += 0.20;
    if (gapType === 'partial_reimbursement') score += 0.15;
    if (gapType === 'auto_closed_reopenable') score += 0.10;
    if (claim.claimed_amount >= 50) score += 0.10;

    return Math.min(1, score);
}

function determineSeverity(shortfall: number, timeSensitive: boolean): 'low' | 'medium' | 'high' | 'critical' {
    if (shortfall >= 200 || (shortfall >= 100 && timeSensitive)) return 'critical';
    if (shortfall >= 100 || timeSensitive) return 'high';
    if (shortfall >= 50) return 'medium';
    return 'low';
}

function determinePriority(
    severity: string,
    timeSensitive: boolean,
    probability: number
): 'low' | 'medium' | 'high' | 'urgent' {
    if (severity === 'critical' || (timeSensitive && probability >= 0.6)) return 'urgent';
    if (severity === 'high' || probability >= 0.65) return 'high';
    if (severity === 'medium') return 'medium';
    return 'low';
}

function getActionSteps(action: RecommendedAction, gapType: ClaimGapType): string[] {
    const steps: Record<RecommendedAction, string[]> = {
        reopen_case: [
            'Go to Seller Central > Case Log',
            'Find the closed case by case ID',
            'Click "Reopen Case"',
            'Reference the original claim and shortfall',
            'Attach any new evidence'
        ],
        file_appeal: [
            'Document the original denial reason',
            'Gather contradicting evidence (POD, invoice, photos)',
            'File formal appeal via Case Log',
            'Reference Amazon policy supporting your claim'
        ],
        submit_evidence: [
            'Collect required evidence (POD, invoice, receipts)',
            'Upload to the pending case',
            'Add clear explanation connecting evidence to claim'
        ],
        escalate_to_manager: [
            'Request case escalation to manager',
            'Prepare summary of case history',
            'Include all previous correspondence'
        ],
        refile_new_claim: [
            'Document the exception that applies',
            'Gather fresh evidence',
            'File new claim referencing exception policy',
            'Include timeline showing exception validity'
        ],
        document_for_future: [
            'Save all evidence and correspondence',
            'Note the case outcome for pattern analysis',
            'Use for future dispute support'
        ],
        monitor: ['Track case status', 'Set reminder to check in 7 days']
    };

    return steps[action] || ['Review case details'];
}

function getEvidenceTypes(claim: ClaimRecord): string[] {
    const types: string[] = [];
    if (claim.has_pod) types.push('Proof of Delivery');
    if (claim.has_invoice) types.push('Invoice/Receipt');
    if (claim.has_photos) types.push('Photo evidence');
    return types;
}

function getNeededEvidence(claimType: ClaimType): string[] {
    const needed: Record<ClaimType, string[]> = {
        lost_inbound: ['BOL/POD', 'Shipment Invoice', 'Carrier confirmation'],
        lost_warehouse: ['Historical inventory report', 'Prior Amazon confirmations'],
        damaged_inbound: ['Photos of packaging', 'Carrier damage claim'],
        damaged_warehouse: ['Prior condition documentation'],
        customer_return: ['Return tracking', 'Condition photos'],
        removal_issue: ['Removal order confirmation', 'Receiving records'],
        fee_dispute: ['Fee breakdown', 'Dimension/weight proof'],
        other: ['Supporting documentation']
    };

    return needed[claimType] || ['Supporting documentation'];
}

// ============================================================================
// Database Functions
// ============================================================================

export async function fetchClaimRecords(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<ClaimRecord[]> {
    const lookbackDays = options.lookbackDays || 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const claims: ClaimRecord[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('claims')
            .select('*')
            .eq('seller_id', sellerId)
            .gte('claim_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                const claimDate = new Date(row.claim_date);
                const closedDate = row.closed_date ? new Date(row.closed_date) : null;

                claims.push({
                    id: row.id,
                    seller_id: sellerId,
                    case_id: row.case_id,
                    claim_type: row.claim_type || 'other',
                    claim_date: row.claim_date,
                    claimed_units: row.claimed_units || 0,
                    claimed_amount: parseFloat(row.claimed_amount) || 0,
                    reimbursed_units: row.reimbursed_units || 0,
                    reimbursed_amount: parseFloat(row.reimbursed_amount) || 0,
                    currency: row.currency || 'USD',
                    status: row.status || 'open',
                    resolution_reason: row.resolution_reason,
                    closed_date: row.closed_date,
                    shipment_id: row.shipment_id,
                    order_id: row.order_id,
                    sku: row.sku,
                    asin: row.asin,
                    has_pod: row.has_pod || false,
                    has_invoice: row.has_invoice || false,
                    has_photos: row.has_photos || false,
                    days_since_event: Math.floor((Date.now() - claimDate.getTime()) / (1000 * 60 * 60 * 24)),
                    days_since_closed: closedDate ?
                        Math.floor((Date.now() - closedDate.getTime()) / (1000 * 60 * 60 * 24)) : undefined
                });
            }
        }

        logger.info('📋 [CLAIM-GAPS] Fetched claims', { sellerId, count: claims.length });
    } catch (err: any) {
        logger.error('📋 [CLAIM-GAPS] Error fetching claims', { error: err.message });
    }

    return claims;
}

export async function storeClaimGapResults(results: ClaimGapResult[]): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'claim_workflow_gap',
            severity: r.severity,
            estimated_value: r.expected_recovery,
            currency: r.currency,
            confidence_score: r.confidence_score,
            evidence: {
                case_id: r.case_id,
                claim_type: r.claim_type,
                gap_type: r.gap_type,
                amount_shortfall: r.amount_shortfall,
                recovery_probability: r.recovery_probability,
                gap_reason: r.gap_reason,
                gap_details: r.gap_details,
                recommended_action: r.recommended_action,
                action_steps: r.action_steps,
                is_time_sensitive: r.is_time_sensitive,
                days_remaining: r.days_remaining,
                evidence_available: r.evidence_available,
                detection_reasons: r.evidence.detection_reasons
            },
            status: 'pending'
        }));

        await supabaseAdmin.from('detection_results').insert(records);
        logger.info('📋 [CLAIM-GAPS] Stored results', { count: records.length });
    } catch (err: any) {
        logger.error('📋 [CLAIM-GAPS] Error storing results', { error: err.message });
    }
}

export { THRESHOLD_SHOW, MIN_SHORTFALL, STANDARD_WINDOWS, REOPENABLE_REASONS };
