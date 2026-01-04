/**
 * Smart Evidence Matcher
 * 
 * Agent 6 Enhancement: Pairs anomalies with the RIGHT evidence documents
 * 
 * Document Types:
 * - Invoice: Original purchase proof
 * - BOL (Bill of Lading): Shipping proof for inbound
 * - POD (Proof of Delivery): Carrier delivery confirmation
 * - Return Docs: Return authorization and received confirmation
 * - Packing Slips: Unit count verification
 * - Weight Tickets: Weight dispute evidence
 * - Photos: Damage documentation
 * 
 * Goal: Every claim has perfect evidence package → higher approval rate
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type DocumentType =
    | 'invoice'
    | 'bol'                    // Bill of Lading
    | 'pod'                    // Proof of Delivery
    | 'packing_slip'
    | 'return_authorization'
    | 'return_receipt'
    | 'weight_ticket'
    | 'dimension_certificate'
    | 'product_photo'
    | 'damage_photo'
    | 'screenshot'
    | 'email_correspondence'
    | 'carrier_claim'
    | 'customs_docs'
    | 'fba_label'
    | 'unknown';

export type AnomalyCategory =
    | 'lost_inventory'
    | 'damaged_inventory'
    | 'inbound_shipment'
    | 'fee_overcharge'
    | 'customer_return'
    | 'chargeback';

export interface EvidenceDocument {
    id: string;
    seller_id: string;
    file_name: string;
    file_path: string;
    document_type: DocumentType;
    extracted_data: {
        order_id?: string;
        shipment_id?: string;
        tracking_number?: string;
        sku?: string;
        asin?: string;
        invoice_number?: string;
        invoice_date?: string;
        vendor?: string;
        quantity?: number;
        unit_cost?: number;
        total_amount?: number;
        weight?: number;
        dimensions?: { l: number; w: number; h: number };
        delivery_date?: string;
        signature?: string;
    };
    confidence_score: number;
    created_at: string;
}

export interface EvidenceMatch {
    document_id: string;
    document_type: DocumentType;
    match_type: 'order_id' | 'sku' | 'shipment_id' | 'date_range' | 'tracking';
    match_confidence: number;
    relevance_score: number;  // How useful is this for the claim type
    match_details: string;
}

export interface EvidencePackage {
    anomaly_id: string;
    anomaly_type: string;
    anomaly_category: AnomalyCategory;

    // Required documents for this claim type
    required_docs: DocumentType[];
    optional_docs: DocumentType[];

    // Matched documents
    matched_documents: EvidenceMatch[];

    // Completeness
    completeness_score: number;  // 0-1, how complete is the evidence
    missing_required: DocumentType[];
    recommendation: string;
}

// ============================================================================
// Evidence Requirements by Claim Type
// ============================================================================

const EVIDENCE_REQUIREMENTS: Record<AnomalyCategory, {
    required: DocumentType[];
    optional: DocumentType[];
    priority_order: DocumentType[];
}> = {
    'lost_inventory': {
        required: ['invoice'],
        optional: ['packing_slip', 'bol', 'fba_label', 'product_photo'],
        priority_order: ['invoice', 'bol', 'packing_slip', 'fba_label']
    },
    'damaged_inventory': {
        required: ['invoice', 'damage_photo'],
        optional: ['packing_slip', 'product_photo'],
        priority_order: ['invoice', 'damage_photo', 'packing_slip', 'product_photo']
    },
    'inbound_shipment': {
        required: ['bol', 'packing_slip'],
        optional: ['invoice', 'pod', 'fba_label', 'weight_ticket'],
        priority_order: ['bol', 'packing_slip', 'pod', 'invoice', 'fba_label']
    },
    'fee_overcharge': {
        required: ['dimension_certificate'],
        optional: ['invoice', 'weight_ticket', 'product_photo', 'screenshot'],
        priority_order: ['dimension_certificate', 'weight_ticket', 'invoice', 'screenshot']
    },
    'customer_return': {
        required: ['return_receipt'],
        optional: ['return_authorization', 'email_correspondence', 'packing_slip'],
        priority_order: ['return_receipt', 'return_authorization', 'packing_slip']
    },
    'chargeback': {
        required: ['pod', 'invoice'],
        optional: ['carrier_claim', 'email_correspondence', 'screenshot'],
        priority_order: ['pod', 'invoice', 'carrier_claim', 'email_correspondence']
    }
};

// ============================================================================
// Document Type Detection
// ============================================================================

/**
 * Detect document type from filename and content
 */
export function detectDocumentType(
    fileName: string,
    extractedData?: any
): DocumentType {
    const lowerName = fileName.toLowerCase();

    // Check filename patterns
    if (lowerName.includes('invoice') || lowerName.includes('inv_')) return 'invoice';
    if (lowerName.includes('bol') || lowerName.includes('bill_of_lading')) return 'bol';
    if (lowerName.includes('pod') || lowerName.includes('proof_of_delivery')) return 'pod';
    if (lowerName.includes('packing') || lowerName.includes('pslip')) return 'packing_slip';
    if (lowerName.includes('return') && lowerName.includes('auth')) return 'return_authorization';
    if (lowerName.includes('return') && lowerName.includes('receipt')) return 'return_receipt';
    if (lowerName.includes('weight') || lowerName.includes('scale')) return 'weight_ticket';
    if (lowerName.includes('dimension') || lowerName.includes('size')) return 'dimension_certificate';
    if (lowerName.includes('photo') || lowerName.includes('img') || lowerName.includes('.jpg') || lowerName.includes('.png')) {
        if (lowerName.includes('damage') || lowerName.includes('broken')) return 'damage_photo';
        return 'product_photo';
    }
    if (lowerName.includes('screenshot') || lowerName.includes('screen')) return 'screenshot';
    if (lowerName.includes('email') || lowerName.includes('correspondence')) return 'email_correspondence';
    if (lowerName.includes('carrier') || lowerName.includes('claim')) return 'carrier_claim';
    if (lowerName.includes('customs') || lowerName.includes('import')) return 'customs_docs';
    if (lowerName.includes('fnsku') || lowerName.includes('fba_label')) return 'fba_label';

    // Check extracted content
    if (extractedData) {
        if (extractedData.invoice_number) return 'invoice';
        if (extractedData.tracking_number && extractedData.delivery_date) return 'pod';
        if (extractedData.weight && !extractedData.invoice_number) return 'weight_ticket';
    }

    return 'unknown';
}

// ============================================================================
// Evidence Matching
// ============================================================================

/**
 * Find matching evidence documents for an anomaly
 */
export async function findMatchingEvidence(
    sellerId: string,
    anomaly: {
        id: string;
        anomaly_type: string;
        order_id?: string;
        sku?: string;
        asin?: string;
        shipment_id?: string;
        event_date: string;
        tracking_number?: string;
    }
): Promise<EvidenceMatch[]> {
    const matches: EvidenceMatch[] = [];

    try {
        // Get all evidence documents for this seller
        const { data: documents, error } = await supabaseAdmin
            .from('evidence_documents')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('parser_status', 'completed')
            .limit(500);

        if (error || !documents?.length) {
            return matches;
        }

        for (const doc of documents) {
            const extracted = doc.parsed_metadata || doc.extracted || {};
            const documentType = detectDocumentType(doc.file_name, extracted);

            let matchType: EvidenceMatch['match_type'] | null = null;
            let matchConfidence = 0;
            let matchDetails = '';

            // Match by Order ID
            if (anomaly.order_id && extracted.order_id === anomaly.order_id) {
                matchType = 'order_id';
                matchConfidence = 0.95;
                matchDetails = `Order ID match: ${anomaly.order_id}`;
            }

            // Match by SKU/ASIN
            else if (anomaly.sku && extracted.sku === anomaly.sku) {
                matchType = 'sku';
                matchConfidence = 0.85;
                matchDetails = `SKU match: ${anomaly.sku}`;
            }
            else if (anomaly.asin && extracted.asin === anomaly.asin) {
                matchType = 'sku';
                matchConfidence = 0.80;
                matchDetails = `ASIN match: ${anomaly.asin}`;
            }

            // Match by Shipment ID
            else if (anomaly.shipment_id && extracted.shipment_id === anomaly.shipment_id) {
                matchType = 'shipment_id';
                matchConfidence = 0.90;
                matchDetails = `Shipment ID match: ${anomaly.shipment_id}`;
            }

            // Match by Tracking Number
            else if (anomaly.tracking_number && extracted.tracking_number === anomaly.tracking_number) {
                matchType = 'tracking';
                matchConfidence = 0.92;
                matchDetails = `Tracking match: ${anomaly.tracking_number}`;
            }

            // Match by Date Range (within 7 days)
            else if (extracted.invoice_date || extracted.delivery_date) {
                const docDate = new Date(extracted.invoice_date || extracted.delivery_date);
                const eventDate = new Date(anomaly.event_date);
                const daysDiff = Math.abs((docDate.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));

                if (daysDiff <= 7 && (anomaly.sku && extracted.items?.some((i: any) => i.sku === anomaly.sku))) {
                    matchType = 'date_range';
                    matchConfidence = 0.6 - (daysDiff * 0.05);
                    matchDetails = `Date range match: ${daysDiff.toFixed(0)} days apart`;
                }
            }

            if (matchType) {
                // Calculate relevance based on document type for this anomaly
                const category = mapAnomalyToCategory(anomaly.anomaly_type);
                const requirements = EVIDENCE_REQUIREMENTS[category];

                let relevanceScore = 0.5;
                if (requirements.required.includes(documentType)) {
                    relevanceScore = 1.0;
                } else if (requirements.optional.includes(documentType)) {
                    relevanceScore = 0.7;
                }

                matches.push({
                    document_id: doc.id,
                    document_type: documentType,
                    match_type: matchType,
                    match_confidence: matchConfidence,
                    relevance_score: relevanceScore,
                    match_details: matchDetails
                });
            }
        }

        // Sort by combined score
        matches.sort((a, b) =>
            (b.match_confidence * b.relevance_score) - (a.match_confidence * a.relevance_score)
        );

    } catch (error: any) {
        logger.error('[EVIDENCE MATCHER] Error finding matches', { anomalyId: anomaly.id, error: error.message });
    }

    return matches;
}

// ============================================================================
// Evidence Package Assembly
// ============================================================================

/**
 * Assemble a complete evidence package for a claim
 */
export async function assembleEvidencePackage(
    sellerId: string,
    anomaly: {
        id: string;
        anomaly_type: string;
        order_id?: string;
        sku?: string;
        asin?: string;
        shipment_id?: string;
        event_date: string;
    }
): Promise<EvidencePackage> {
    const category = mapAnomalyToCategory(anomaly.anomaly_type);
    const requirements = EVIDENCE_REQUIREMENTS[category];

    // Find matching documents
    const matches = await findMatchingEvidence(sellerId, anomaly);

    // Check which required docs are present
    const matchedTypes = new Set(matches.map(m => m.document_type));
    const missingRequired = requirements.required.filter(r => !matchedTypes.has(r));

    // Calculate completeness
    const requiredHits = requirements.required.filter(r => matchedTypes.has(r)).length;
    const optionalHits = requirements.optional.filter(o => matchedTypes.has(o)).length;

    const requiredWeight = 0.7;
    const optionalWeight = 0.3;

    const requiredScore = requirements.required.length > 0
        ? requiredHits / requirements.required.length
        : 1;
    const optionalScore = requirements.optional.length > 0
        ? optionalHits / requirements.optional.length
        : 0;

    const completenessScore = (requiredScore * requiredWeight) + (optionalScore * optionalWeight);

    // Generate recommendation
    let recommendation: string;
    if (completenessScore >= 0.9) {
        recommendation = 'Evidence package is complete. Ready to file.';
    } else if (completenessScore >= 0.7) {
        recommendation = `Good evidence coverage. Consider adding: ${missingRequired.join(', ') || 'optional documents'}`;
    } else if (completenessScore >= 0.5) {
        recommendation = `Missing key evidence. Required: ${missingRequired.join(', ')}`;
    } else {
        recommendation = `Insufficient evidence. Need: ${missingRequired.join(', ')}. Request from seller.`;
    }

    const evidencePackage: EvidencePackage = {
        anomaly_id: anomaly.id,
        anomaly_type: anomaly.anomaly_type,
        anomaly_category: category,
        required_docs: requirements.required,
        optional_docs: requirements.optional,
        matched_documents: matches,
        completeness_score: completenessScore,
        missing_required: missingRequired,
        recommendation
    };

    logger.info('[EVIDENCE MATCHER] Package assembled', {
        anomalyId: anomaly.id,
        category,
        matchedDocs: matches.length,
        completeness: (completenessScore * 100).toFixed(0) + '%'
    });

    return evidencePackage;
}

function mapAnomalyToCategory(anomalyType: string): AnomalyCategory {
    const mapping: Record<string, AnomalyCategory> = {
        'lost_warehouse': 'lost_inventory',
        'lost_inbound': 'inbound_shipment',
        'missing_unit': 'lost_inventory',
        'damaged_warehouse': 'damaged_inventory',
        'damaged_inbound': 'damaged_inventory',
        'damaged_stock': 'damaged_inventory',
        'weight_fee_overcharge': 'fee_overcharge',
        'fulfillment_fee_error': 'fee_overcharge',
        'storage_overcharge': 'fee_overcharge',
        'commission_overcharge': 'fee_overcharge',
        'refund_no_return': 'customer_return',
        'return_not_restocked': 'customer_return',
        'customer_return': 'customer_return',
        'chargeback': 'chargeback',
        'atoz_claim': 'chargeback',
    };

    return mapping[anomalyType] || 'lost_inventory';
}

/**
 * Get best evidence document IDs for a claim
 */
export async function getBestEvidenceForClaim(
    sellerId: string,
    anomaly: any,
    maxDocuments: number = 5
): Promise<string[]> {
    const evidencePackage = await assembleEvidencePackage(sellerId, anomaly);

    // Sort by priority order for this category
    const requirements = EVIDENCE_REQUIREMENTS[evidencePackage.anomaly_category];
    const sortedMatches = [...evidencePackage.matched_documents].sort((a, b) => {
        const aIndex = requirements.priority_order.indexOf(a.document_type);
        const bIndex = requirements.priority_order.indexOf(b.document_type);
        const aPriority = aIndex === -1 ? 999 : aIndex;
        const bPriority = bIndex === -1 ? 999 : bIndex;
        return aPriority - bPriority;
    });

    return sortedMatches.slice(0, maxDocuments).map(m => m.document_id);
}

export default {
    findMatchingEvidence,
    assembleEvidencePackage,
    getBestEvidenceForClaim,
    detectDocumentType,
    EVIDENCE_REQUIREMENTS
};
