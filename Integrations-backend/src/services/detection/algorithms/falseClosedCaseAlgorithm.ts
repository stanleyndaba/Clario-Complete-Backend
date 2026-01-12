/**
 * False Amazon Closed Case Detector
 * 
 * Agent 3: Discovery Agent - Amazon Decision Correctness Analysis
 * 
 * POWER FEATURE: Smarter than Amazon's internal review
 * 
 * When Amazon says "Resolved — no reimbursement owed" but evidence disagrees:
 * 1. Evaluate Amazon closure outcome
 * 2. Evaluate internal anomaly confidence
 * 3. Compute "Amazon decision correctness probability"
 * 4. Recommend refiling with stronger evidence packet
 * 
 * This positions the platform as smarter than Amazon, not just a filing assistant.
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ClosedCaseRecord {
    id: string;
    seller_id: string;
    case_id: string;

    // Case metadata
    case_type: CaseType;
    filed_date: string;
    closed_date: string;

    // Amazon's decision
    amazon_outcome: 'denied' | 'partial_reimbursement' | 'resolved_no_action';
    amazon_reason?: string;
    amazon_reimbursement_amount: number;

    // Original claim
    original_claim_amount: number;
    order_id?: string;
    sku?: string;
    asin?: string;
    fnsku?: string;
    quantity?: number;

    currency: string;
}

export type CaseType =
    | 'lost_inventory'
    | 'damaged_inventory'
    | 'customer_return_not_received'
    | 'refund_without_return'
    | 'fee_dispute'
    | 'inbound_shipment'
    | 'removal_order'
    | 'general';

export interface EvidenceStrength {
    type: 'inventory_ledger' | 'order_history' | 'shipment_tracking' | 'invoice' | 'policy_reference' | 'historical_pattern';
    strength: 'weak' | 'moderate' | 'strong' | 'conclusive';
    description: string;
    document_id?: string;
}

export interface FalseClosureDetectionResult {
    seller_id: string;
    sync_id: string;
    case_id: string;

    // Original case info
    case_type: CaseType;
    original_claim_amount: number;
    amazon_reimbursement_amount: number;
    shortfall: number;

    // Our analysis
    amazon_decision_correct: boolean;
    decision_correctness_probability: number; // 0-1, lower = more likely wrong
    our_confidence_score: number;             // 0-1, higher = we're confident they're wrong

    // Evidence assessment
    evidence_available: EvidenceStrength[];
    evidence_score: number;                   // 0-1
    evidence_gaps: string[];

    // Classification
    dispute_worthiness: 'not_worth_it' | 'marginal' | 'recommended' | 'strongly_recommended';
    severity: 'low' | 'medium' | 'high' | 'critical';

    // Actionable recommendations
    recommended_action: 'accept_decision' | 'gather_evidence' | 'refile_case' | 'escalate_to_specialist';
    refile_strategy?: RefileStrategy;

    // Evidence
    evidence: {
        closed_case: ClosedCaseRecord;
        supporting_anomalies: RelatedAnomaly[];
        detection_reasons: string[];
        refile_talking_points: string[];
    };

    currency: string;
}

export interface RefileStrategy {
    priority: 'normal' | 'high' | 'urgent';
    approach: 'standard_refile' | 'manager_escalation' | 'policy_citation' | 'evidence_packet';
    suggested_attachments: string[];
    key_arguments: string[];
    estimated_success_rate: number;
}

export interface RelatedAnomaly {
    id: string;
    anomaly_type: string;
    confidence_score: number;
    estimated_value: number;
    status: string;
}

export interface ClosedCaseSyncedData {
    seller_id: string;
    sync_id: string;
    closed_cases: ClosedCaseRecord[];
}

// ============================================================================
// Constants
// ============================================================================

// Thresholds for decision analysis
const THRESHOLD_LIKELY_WRONG = 0.65;       // If our confidence > 0.65, Amazon likely wrong
const THRESHOLD_STRONGLY_RECOMMEND = 0.80; // If confidence > 0.80, strongly recommend refile
const MIN_SHORTFALL_VALUE = 15;            // Minimum $ to consider refiling

// Evidence weights
const EVIDENCE_WEIGHTS: Record<string, number> = {
    'inventory_ledger': 0.30,
    'order_history': 0.20,
    'shipment_tracking': 0.15,
    'invoice': 0.15,
    'policy_reference': 0.10,
    'historical_pattern': 0.10,
};

// Amazon denial patterns (common reasons that are often wrong)
const DISPUTABLE_DENIAL_PATTERNS = [
    'unit not found',
    'no proof',
    'outside window',
    'already processed',
    'insufficient information',
    'case closed',
    'resolved previously'
];

// ============================================================================
// Core Detection Algorithm
// ============================================================================

/**
 * Main entry point: Detect falsely closed cases
 */
export async function detectFalseClosedCases(
    sellerId: string,
    syncId: string,
    data: ClosedCaseSyncedData
): Promise<FalseClosureDetectionResult[]> {
    const results: FalseClosureDetectionResult[] = [];

    logger.info('⚖️ [CLOSED-CASE] Starting false closure detection', {
        sellerId,
        syncId,
        closedCaseCount: data.closed_cases?.length || 0
    });

    if (!data.closed_cases || data.closed_cases.length === 0) {
        logger.info('⚖️ [CLOSED-CASE] No closed cases to analyze');
        return results;
    }

    // Fetch related anomalies for correlation
    const anomalyMap = await fetchRelatedAnomalies(sellerId);
    logger.info('⚖️ [CLOSED-CASE] Loaded related anomalies', { count: anomalyMap.size });

    // Fetch available evidence
    const evidenceMap = await fetchAvailableEvidence(sellerId);
    logger.info('⚖️ [CLOSED-CASE] Loaded evidence inventory', { count: evidenceMap.size });

    // Analyze each closed case
    for (const closedCase of data.closed_cases) {
        try {
            // Only analyze denied or partial cases with significant shortfall
            const shortfall = closedCase.original_claim_amount - closedCase.amazon_reimbursement_amount;

            if (shortfall < MIN_SHORTFALL_VALUE) {
                continue; // Not worth analyzing
            }

            const detection = await analyzeClosedCase(
                sellerId,
                syncId,
                closedCase,
                anomalyMap,
                evidenceMap
            );

            if (detection && detection.our_confidence_score >= 0.50) {
                results.push(detection);
            }
        } catch (error: any) {
            logger.warn('⚖️ [CLOSED-CASE] Error analyzing case', {
                caseId: closedCase.case_id,
                error: error.message
            });
        }
    }

    // Sort by confidence (most confident Amazon is wrong first)
    results.sort((a, b) => b.our_confidence_score - a.our_confidence_score);

    const stronglyRecommended = results.filter(r => r.dispute_worthiness === 'strongly_recommended').length;
    const totalRecovery = results.reduce((sum, r) => sum + r.shortfall, 0);

    logger.info('⚖️ [CLOSED-CASE] Detection complete', {
        sellerId,
        analyzedCases: data.closed_cases.length,
        falseClosuresDetected: results.length,
        stronglyRecommendedRefiling: stronglyRecommended,
        totalRecoveryPotential: totalRecovery.toFixed(2)
    });

    return results;
}

/**
 * Analyze a single closed case for false closure
 */
async function analyzeClosedCase(
    sellerId: string,
    syncId: string,
    closedCase: ClosedCaseRecord,
    anomalyMap: Map<string, RelatedAnomaly[]>,
    evidenceMap: Map<string, EvidenceStrength[]>
): Promise<FalseClosureDetectionResult | null> {
    const detectionReasons: string[] = [];
    const talkingPoints: string[] = [];
    const evidenceGaps: string[] = [];

    const shortfall = closedCase.original_claim_amount - closedCase.amazon_reimbursement_amount;

    // Step 1: Evaluate Amazon's denial reason
    const denialAnalysis = analyzeDenialReason(closedCase.amazon_reason);
    if (denialAnalysis.isDisputable) {
        detectionReasons.push(`Amazon denial reason "${closedCase.amazon_reason}" is commonly disputable`);
        talkingPoints.push(denialAnalysis.counterArgument);
    }

    // Step 2: Check for related anomalies that support our position
    const relatedAnomalies = findRelatedAnomalies(closedCase, anomalyMap);
    if (relatedAnomalies.length > 0) {
        const avgConfidence = relatedAnomalies.reduce((s, a) => s + a.confidence_score, 0) / relatedAnomalies.length;
        detectionReasons.push(`${relatedAnomalies.length} related anomaly detection(s) support this claim (avg confidence: ${(avgConfidence * 100).toFixed(0)}%)`);

        for (const anomaly of relatedAnomalies) {
            if (anomaly.confidence_score >= 0.70) {
                talkingPoints.push(`System detected ${anomaly.anomaly_type} with ${(anomaly.confidence_score * 100).toFixed(0)}% confidence`);
            }
        }
    }

    // Step 3: Assess available evidence
    const evidenceAvailable = assessEvidence(closedCase, evidenceMap);
    const evidenceScore = calculateEvidenceScore(evidenceAvailable);

    if (evidenceScore >= 0.60) {
        detectionReasons.push(`Strong supporting evidence available (score: ${(evidenceScore * 100).toFixed(0)}%)`);
    }

    // Identify evidence gaps
    const neededEvidence = getNeededEvidence(closedCase.case_type);
    for (const needed of neededEvidence) {
        if (!evidenceAvailable.find(e => e.type === needed)) {
            evidenceGaps.push(`Missing ${needed.replace('_', ' ')}`);
        }
    }

    // Step 4: Calculate our confidence that Amazon is wrong
    const ourConfidence = calculateOurConfidence(
        denialAnalysis,
        relatedAnomalies,
        evidenceScore,
        shortfall
    );

    // Step 5: Calculate Amazon decision correctness probability (inverse of our confidence)
    const amazonCorrectProb = 1 - ourConfidence;

    // Step 6: Determine if worth disputing
    const disputeWorthiness = determineDisputeWorthiness(ourConfidence, shortfall, evidenceScore);
    const severity = determineSeverity(shortfall, ourConfidence);
    const recommendedAction = determineAction(disputeWorthiness, evidenceGaps);

    // Step 7: Build refile strategy if recommended
    let refileStrategy: RefileStrategy | undefined;
    if (recommendedAction === 'refile_case' || recommendedAction === 'escalate_to_specialist') {
        refileStrategy = buildRefileStrategy(closedCase, evidenceAvailable, ourConfidence, talkingPoints);
    }

    // Build final talking points
    if (shortfall > 100) {
        talkingPoints.push(`Original claim: $${closedCase.original_claim_amount.toFixed(2)}, received: $${closedCase.amazon_reimbursement_amount.toFixed(2)}, underpaid by: $${shortfall.toFixed(2)}`);
    }

    // Only return if we have meaningful confidence
    if (ourConfidence < 0.50 && detectionReasons.length === 0) {
        return null;
    }

    return {
        seller_id: sellerId,
        sync_id: syncId,
        case_id: closedCase.case_id,

        case_type: closedCase.case_type,
        original_claim_amount: closedCase.original_claim_amount,
        amazon_reimbursement_amount: closedCase.amazon_reimbursement_amount,
        shortfall,

        amazon_decision_correct: amazonCorrectProb > 0.60,
        decision_correctness_probability: amazonCorrectProb,
        our_confidence_score: ourConfidence,

        evidence_available: evidenceAvailable,
        evidence_score: evidenceScore,
        evidence_gaps: evidenceGaps,

        dispute_worthiness: disputeWorthiness,
        severity,
        recommended_action: recommendedAction,
        refile_strategy: refileStrategy,

        evidence: {
            closed_case: closedCase,
            supporting_anomalies: relatedAnomalies,
            detection_reasons: detectionReasons,
            refile_talking_points: talkingPoints
        },

        currency: closedCase.currency || 'USD'
    };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Analyze Amazon's denial reason
 */
function analyzeDenialReason(reason?: string): { isDisputable: boolean; counterArgument: string } {
    if (!reason) {
        return { isDisputable: true, counterArgument: 'Amazon provided no specific denial reason' };
    }

    const reasonLower = reason.toLowerCase();

    for (const pattern of DISPUTABLE_DENIAL_PATTERNS) {
        if (reasonLower.includes(pattern)) {
            const counterArgs: Record<string, string> = {
                'unit not found': 'Inventory ledger shows the unit was received and tracked in your fulfillment center',
                'no proof': 'Attached evidence documents support this claim',
                'outside window': 'Per Amazon policy, claims can be filed within 18 months for inventory discrepancies',
                'already processed': 'No reimbursement matching this claim appears in settlement reports',
                'insufficient information': 'Complete transaction records are attached for verification',
                'case closed': 'Reopening based on new evidence that was not previously considered',
                'resolved previously': 'Previous resolution did not address the full claim amount'
            };

            return {
                isDisputable: true,
                counterArgument: counterArgs[pattern] || `Denial reason "${reason}" is commonly disputed successfully`
            };
        }
    }

    return { isDisputable: false, counterArgument: '' };
}

/**
 * Find anomalies related to this closed case
 */
function findRelatedAnomalies(
    closedCase: ClosedCaseRecord,
    anomalyMap: Map<string, RelatedAnomaly[]>
): RelatedAnomaly[] {
    const related: RelatedAnomaly[] = [];

    // Match by SKU
    if (closedCase.sku && anomalyMap.has(closedCase.sku)) {
        related.push(...anomalyMap.get(closedCase.sku)!);
    }

    // Match by FNSKU
    if (closedCase.fnsku && anomalyMap.has(closedCase.fnsku)) {
        related.push(...anomalyMap.get(closedCase.fnsku)!);
    }

    // Match by Order ID
    if (closedCase.order_id && anomalyMap.has(closedCase.order_id)) {
        related.push(...anomalyMap.get(closedCase.order_id)!);
    }

    // Dedupe by ID
    const seen = new Set<string>();
    return related.filter(a => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
    });
}

/**
 * Assess available evidence for this case
 */
function assessEvidence(
    closedCase: ClosedCaseRecord,
    evidenceMap: Map<string, EvidenceStrength[]>
): EvidenceStrength[] {
    const evidence: EvidenceStrength[] = [];
    const key = closedCase.sku || closedCase.fnsku || closedCase.order_id || closedCase.case_id;

    if (key && evidenceMap.has(key)) {
        evidence.push(...evidenceMap.get(key)!);
    }

    // Add default evidence based on case type
    switch (closedCase.case_type) {
        case 'lost_inventory':
        case 'damaged_inventory':
            if (!evidence.find(e => e.type === 'inventory_ledger')) {
                evidence.push({
                    type: 'inventory_ledger',
                    strength: 'moderate',
                    description: 'Inventory ledger data available for cross-reference'
                });
            }
            break;
        case 'customer_return_not_received':
        case 'refund_without_return':
            if (!evidence.find(e => e.type === 'order_history')) {
                evidence.push({
                    type: 'order_history',
                    strength: 'moderate',
                    description: 'Order history shows refund issued without return'
                });
            }
            break;
    }

    return evidence;
}

/**
 * Calculate evidence score
 */
function calculateEvidenceScore(evidence: EvidenceStrength[]): number {
    if (evidence.length === 0) return 0.20; // Base score

    const strengthScores: Record<string, number> = {
        'weak': 0.3,
        'moderate': 0.6,
        'strong': 0.85,
        'conclusive': 1.0
    };

    let totalWeight = 0;
    let weightedScore = 0;

    for (const e of evidence) {
        const typeWeight = EVIDENCE_WEIGHTS[e.type] || 0.10;
        const strengthScore = strengthScores[e.strength] || 0.5;

        weightedScore += typeWeight * strengthScore;
        totalWeight += typeWeight;
    }

    return totalWeight > 0 ? Math.min(1, weightedScore / totalWeight) : 0.20;
}

/**
 * Get needed evidence for case type
 */
function getNeededEvidence(caseType: CaseType): string[] {
    const neededByType: Record<CaseType, string[]> = {
        'lost_inventory': ['inventory_ledger', 'shipment_tracking'],
        'damaged_inventory': ['inventory_ledger', 'invoice'],
        'customer_return_not_received': ['order_history', 'shipment_tracking'],
        'refund_without_return': ['order_history', 'policy_reference'],
        'fee_dispute': ['invoice', 'policy_reference'],
        'inbound_shipment': ['shipment_tracking', 'inventory_ledger'],
        'removal_order': ['shipment_tracking', 'inventory_ledger'],
        'general': ['order_history', 'policy_reference']
    };
    return neededByType[caseType] || neededByType['general'];
}

/**
 * Calculate our confidence that Amazon is wrong
 */
function calculateOurConfidence(
    denialAnalysis: { isDisputable: boolean },
    relatedAnomalies: RelatedAnomaly[],
    evidenceScore: number,
    shortfall: number
): number {
    let score = 0;

    // Disputable denial reason: +0.25
    if (denialAnalysis.isDisputable) {
        score += 0.25;
    }

    // Related anomalies with high confidence: up to +0.35
    if (relatedAnomalies.length > 0) {
        const avgConf = relatedAnomalies.reduce((s, a) => s + a.confidence_score, 0) / relatedAnomalies.length;
        score += 0.35 * avgConf;
    }

    // Evidence score: up to +0.25
    score += 0.25 * evidenceScore;

    // Significant shortfall booster: up to +0.15
    if (shortfall >= 100) {
        score += 0.15;
    } else if (shortfall >= 50) {
        score += 0.10;
    } else if (shortfall >= 25) {
        score += 0.05;
    }

    return Math.min(1, score);
}

/**
 * Determine if case is worth disputing
 */
function determineDisputeWorthiness(
    confidence: number,
    shortfall: number,
    evidenceScore: number
): 'not_worth_it' | 'marginal' | 'recommended' | 'strongly_recommended' {
    // High confidence + good evidence + significant value
    if (confidence >= THRESHOLD_STRONGLY_RECOMMEND && evidenceScore >= 0.60 && shortfall >= 50) {
        return 'strongly_recommended';
    }

    // Good confidence with decent evidence
    if (confidence >= THRESHOLD_LIKELY_WRONG && evidenceScore >= 0.50) {
        return 'recommended';
    }

    // Some potential but marginal
    if (confidence >= 0.50 || shortfall >= 100) {
        return 'marginal';
    }

    return 'not_worth_it';
}

/**
 * Determine severity
 */
function determineSeverity(shortfall: number, confidence: number): 'low' | 'medium' | 'high' | 'critical' {
    if (shortfall >= 500 || (shortfall >= 200 && confidence >= 0.80)) {
        return 'critical';
    }
    if (shortfall >= 100 || confidence >= 0.75) {
        return 'high';
    }
    if (shortfall >= 50 || confidence >= 0.60) {
        return 'medium';
    }
    return 'low';
}

/**
 * Determine recommended action
 */
function determineAction(
    worthiness: 'not_worth_it' | 'marginal' | 'recommended' | 'strongly_recommended',
    evidenceGaps: string[]
): 'accept_decision' | 'gather_evidence' | 'refile_case' | 'escalate_to_specialist' {
    if (worthiness === 'not_worth_it') {
        return 'accept_decision';
    }

    if (worthiness === 'marginal' && evidenceGaps.length > 1) {
        return 'gather_evidence';
    }

    if (worthiness === 'strongly_recommended') {
        return 'escalate_to_specialist';
    }

    return 'refile_case';
}

/**
 * Build refile strategy
 */
function buildRefileStrategy(
    closedCase: ClosedCaseRecord,
    evidence: EvidenceStrength[],
    confidence: number,
    talkingPoints: string[]
): RefileStrategy {
    const priority = confidence >= 0.80 ? 'urgent' : confidence >= 0.65 ? 'high' : 'normal';

    let approach: RefileStrategy['approach'] = 'standard_refile';
    if (confidence >= 0.85) {
        approach = 'manager_escalation';
    } else if (evidence.find(e => e.type === 'policy_reference')) {
        approach = 'policy_citation';
    } else if (evidence.length >= 3) {
        approach = 'evidence_packet';
    }

    const suggestedAttachments = evidence
        .filter(e => e.document_id)
        .map(e => e.document_id!);

    // Add specific attachments based on case type
    if (closedCase.case_type === 'lost_inventory') {
        suggestedAttachments.push('Inventory Adjustment Report', 'Inventory Ledger Export');
    } else if (closedCase.case_type === 'refund_without_return') {
        suggestedAttachments.push('Order Details', 'Return Report showing no return received');
    }

    const keyArguments = [
        ...talkingPoints,
        `Case ID: ${closedCase.case_id}`,
        `SKU: ${closedCase.sku || 'N/A'}, Order: ${closedCase.order_id || 'N/A'}`,
    ];

    // Estimate success rate based on confidence and evidence
    const successRate = Math.min(0.85, confidence * 0.7 + (evidence.length / 10) * 0.2);

    return {
        priority,
        approach,
        suggested_attachments: suggestedAttachments,
        key_arguments: keyArguments,
        estimated_success_rate: successRate
    };
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch related anomalies grouped by SKU/order
 */
async function fetchRelatedAnomalies(sellerId: string): Promise<Map<string, RelatedAnomaly[]>> {
    const map = new Map<string, RelatedAnomaly[]>();

    try {
        const { data, error } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .eq('seller_id', sellerId)
            .gte('confidence_score', 0.50);

        if (!error && data) {
            for (const row of data) {
                const anomaly: RelatedAnomaly = {
                    id: row.id,
                    anomaly_type: row.anomaly_type,
                    confidence_score: row.confidence_score,
                    estimated_value: row.estimated_value || 0,
                    status: row.status
                };

                // Index by SKU
                const sku = row.evidence?.sku;
                if (sku) {
                    const existing = map.get(sku) || [];
                    existing.push(anomaly);
                    map.set(sku, existing);
                }

                // Index by order
                const orderId = row.evidence?.order_id;
                if (orderId) {
                    const existing = map.get(orderId) || [];
                    existing.push(anomaly);
                    map.set(orderId, existing);
                }
            }
        }
    } catch (err: any) {
        logger.error('⚖️ [CLOSED-CASE] Error fetching anomalies', { error: err.message });
    }

    return map;
}

/**
 * Fetch available evidence documents
 */
async function fetchAvailableEvidence(sellerId: string): Promise<Map<string, EvidenceStrength[]>> {
    const map = new Map<string, EvidenceStrength[]>();

    try {
        const { data, error } = await supabaseAdmin
            .from('evidence_documents')
            .select('*')
            .eq('user_id', sellerId)
            .eq('status', 'processed');

        if (!error && data) {
            for (const doc of data) {
                const strength: EvidenceStrength = {
                    type: mapDocumentType(doc.document_type),
                    strength: mapConfidenceToStrength(doc.confidence_score),
                    description: doc.summary || doc.filename,
                    document_id: doc.id
                };

                // Index by associated SKU/order
                const key = doc.metadata?.sku || doc.metadata?.order_id || doc.id;
                const existing = map.get(key) || [];
                existing.push(strength);
                map.set(key, existing);
            }
        }
    } catch (err: any) {
        logger.error('⚖️ [CLOSED-CASE] Error fetching evidence', { error: err.message });
    }

    return map;
}

/**
 * Map document type to evidence type
 */
function mapDocumentType(docType: string): EvidenceStrength['type'] {
    const typeMap: Record<string, EvidenceStrength['type']> = {
        'invoice': 'invoice',
        'shipping_label': 'shipment_tracking',
        'tracking_info': 'shipment_tracking',
        'order_confirmation': 'order_history',
        'inventory_report': 'inventory_ledger',
        'policy_document': 'policy_reference'
    };
    return typeMap[docType?.toLowerCase()] || 'order_history';
}

/**
 * Map confidence to strength
 */
function mapConfidenceToStrength(confidence: number): EvidenceStrength['strength'] {
    if (confidence >= 0.90) return 'conclusive';
    if (confidence >= 0.70) return 'strong';
    if (confidence >= 0.50) return 'moderate';
    return 'weak';
}

/**
 * Fetch closed cases for analysis
 */
export async function fetchClosedCases(
    sellerId: string,
    options: { lookbackDays?: number } = {}
): Promise<ClosedCaseRecord[]> {
    const lookbackDays = options.lookbackDays || 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const cases: ClosedCaseRecord[] = [];

    try {
        const { data, error } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('user_id', sellerId)
            .in('status', ['closed', 'denied', 'resolved'])
            .gte('resolved_date', cutoffDate.toISOString());

        if (!error && data) {
            for (const row of data) {
                cases.push({
                    id: row.id,
                    seller_id: sellerId,
                    case_id: row.case_id || row.id,
                    case_type: mapCaseType(row.case_type),
                    filed_date: row.created_at,
                    closed_date: row.resolved_date || row.updated_at,
                    amazon_outcome: mapOutcome(row.status, row.reimbursement_amount, row.amount),
                    amazon_reason: row.resolution_reason || row.notes,
                    amazon_reimbursement_amount: row.reimbursement_amount || 0,
                    original_claim_amount: row.amount || 0,
                    order_id: row.order_id,
                    sku: row.sku,
                    asin: row.asin,
                    fnsku: row.fnsku,
                    quantity: row.quantity,
                    currency: row.currency || 'USD'
                });
            }
        }

        logger.info('⚖️ [CLOSED-CASE] Fetched closed cases', {
            sellerId,
            count: cases.length
        });
    } catch (err: any) {
        logger.error('⚖️ [CLOSED-CASE] Error fetching closed cases', { error: err.message });
    }

    return cases;
}

/**
 * Map case type string
 */
function mapCaseType(caseType: string): CaseType {
    const mapping: Record<string, CaseType> = {
        'lost_inventory': 'lost_inventory',
        'damaged_inventory': 'damaged_inventory',
        'customer_return': 'customer_return_not_received',
        'refund_without_return': 'refund_without_return',
        'fee_dispute': 'fee_dispute',
        'fee_error': 'fee_dispute',
        'inbound': 'inbound_shipment',
        'removal': 'removal_order'
    };
    return mapping[caseType?.toLowerCase()] || 'general';
}

/**
 * Map outcome based on status and amounts
 */
function mapOutcome(
    status: string,
    reimbAmount: number,
    claimAmount: number
): ClosedCaseRecord['amazon_outcome'] {
    if (status === 'denied') return 'denied';
    if (reimbAmount && reimbAmount < claimAmount * 0.9) return 'partial_reimbursement';
    return 'resolved_no_action';
}

/**
 * Store detection results
 */
export async function storeClosedCaseResults(
    results: FalseClosureDetectionResult[]
): Promise<void> {
    if (results.length === 0) return;

    try {
        const records = results.map(r => ({
            seller_id: r.seller_id,
            sync_id: r.sync_id,
            anomaly_type: 'closed_case_false_denial',
            severity: r.severity,
            estimated_value: r.shortfall,
            currency: r.currency,
            confidence_score: r.our_confidence_score,
            evidence: {
                case_id: r.case_id,
                case_type: r.case_type,
                amazon_decision_correct_prob: r.decision_correctness_probability,
                dispute_worthiness: r.dispute_worthiness,
                recommended_action: r.recommended_action,
                refile_strategy: r.refile_strategy,
                evidence_score: r.evidence_score,
                evidence_gaps: r.evidence_gaps,
                supporting_anomalies_count: r.evidence.supporting_anomalies.length,
                detection_reasons: r.evidence.detection_reasons,
                refile_talking_points: r.evidence.refile_talking_points
            },
            status: 'pending'
        }));

        const { error } = await supabaseAdmin
            .from('detection_results')
            .insert(records);

        if (error) {
            logger.error('⚖️ [CLOSED-CASE] Error storing results', { error: error.message });
        } else {
            logger.info('⚖️ [CLOSED-CASE] Stored detection results', { count: records.length });
        }
    } catch (err: any) {
        logger.error('⚖️ [CLOSED-CASE] Exception storing results', { error: err.message });
    }
}

// ============================================================================
// Exports
// ============================================================================

export { THRESHOLD_LIKELY_WRONG, THRESHOLD_STRONGLY_RECOMMEND };
