/**
 * Proof Checklist Service
 * Tracks Amazon's proof requirements for FBA claims
 * 
 * Categories:
 * 1. Proof of Ownership - Invoice, fapiao, manufacturer receipt
 * 2. Proof of Value - Unit cost, currency, buyer/seller identities
 * 3. Proof of Delivery - POD, BOL, tracking with delivery timestamp
 * 4. Inventory Trail - Ledger, adjustments, disposition records
 */

import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface ProofStatus {
    category: 'ownership' | 'value' | 'delivery' | 'inventory';
    status: 'complete' | 'partial' | 'missing';
    documentIds: string[];
    fields: {
        name: string;
        found: boolean;
        value?: string;
        source?: string;
    }[];
    message: string;
    actionRequired?: string;
}

export interface ClaimProofChecklist {
    claimId: string;
    sku?: string;
    asin?: string;
    ownership: ProofStatus;
    value: ProofStatus;
    delivery: ProofStatus;
    inventory: ProofStatus;
    overallScore: number; // 0-100
    overallStatus: 'complete' | 'partial' | 'missing';
    recommendations: string[];
}

// Fields that satisfy each proof category
const PROOF_REQUIREMENTS = {
    ownership: {
        required: ['invoice_number', 'supplier_name'],
        optional: ['buyer_name', 'invoice_date', 'po_number', 'manufacturer', 'fapiao_number'],
        description: 'Proof of Ownership',
        examples: 'supplier invoice, fapiao, manufacturer receipt'
    },
    value: {
        required: ['unit_price', 'currency'],
        optional: ['total_amount', 'quantity', 'tax_amount', 'vat_id'],
        description: 'Proof of Value',
        examples: 'invoice with unit cost, purchase order'
    },
    delivery: {
        required: ['tracking_number'],
        optional: ['pod', 'bol', 'delivery_date', 'carrier', 'signed_by', 'shipment_id'],
        description: 'Proof of Delivery',
        examples: 'POD, BOL, tracking screenshot with delivery confirmation'
    },
    inventory: {
        required: ['shipment_id'],
        optional: ['inventory_ledger', 'adjustment_id', 'disposition_record', 'reconciliation_id', 'fnsku'],
        description: 'Inventory Trail',
        examples: 'FBA inventory ledger, adjustment records'
    }
};

class ProofChecklistService {

    /**
     * Get proof checklist for a claim
     */
    async getClaimProofChecklist(
        claimId: string,
        userId: string
    ): Promise<ClaimProofChecklist | null> {
        try {
            logger.info('📋 [PROOF] Getting proof checklist for claim', { claimId, userId });

            // Get claim details
            const claim = await this.getClaimDetails(claimId);
            if (!claim) {
                logger.warn('⚠️ [PROOF] Claim not found', { claimId });
                return null;
            }

            // Get linked documents
            const documents = await this.getLinkedDocuments(claimId, userId, claim.sku, claim.asin);

            // Analyze each proof category
            const ownership = this.analyzeProofCategory('ownership', documents, claim);
            const value = this.analyzeProofCategory('value', documents, claim);
            const delivery = this.analyzeProofCategory('delivery', documents, claim);
            const inventory = this.analyzeProofCategory('inventory', documents, claim);

            // Calculate overall score
            const scores = [ownership, value, delivery, inventory].map(p => {
                if (p.status === 'complete') return 100;
                if (p.status === 'partial') return 50;
                return 0;
            });
            const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / 4);

            // Determine overall status
            let overallStatus: 'complete' | 'partial' | 'missing' = 'complete';
            if (scores.some(s => s === 0)) overallStatus = 'partial';
            if (scores.every(s => s === 0)) overallStatus = 'missing';
            if (scores.every(s => s === 100)) overallStatus = 'complete';

            // Generate recommendations
            const recommendations = this.generateRecommendations(
                { ownership, value, delivery, inventory },
                claim.sku,
                claim.asin
            );

            logger.info('📋 [PROOF] Proof checklist generated', {
                claimId,
                overallScore,
                overallStatus,
                recommendationCount: recommendations.length
            });

            return {
                claimId,
                sku: claim.sku,
                asin: claim.asin,
                ownership,
                value,
                delivery,
                inventory,
                overallScore,
                overallStatus,
                recommendations
            };

        } catch (error: any) {
            logger.error('❌ [PROOF] Failed to get proof checklist', { claimId, error: error.message });
            return null;
        }
    }

    /**
     * Get claim details
     */
    private async getClaimDetails(claimId: string): Promise<{
        sku?: string;
        asin?: string;
        claimType?: string;
    } | null> {
        // Try detection_results
        const { data: detection } = await supabaseAdmin
            .from('detection_results')
            .select('sku, asin, anomaly_type, evidence')
            .eq('id', claimId)
            .single();

        if (detection) {
            const evidence = typeof detection.evidence === 'string'
                ? JSON.parse(detection.evidence)
                : detection.evidence || {};
            return {
                sku: detection.sku || evidence.sku,
                asin: detection.asin || evidence.asin,
                claimType: detection.anomaly_type
            };
        }

        // Try dispute_cases
        const { data: dispute } = await supabaseAdmin
            .from('dispute_cases')
            .select('sku, asin, dispute_type')
            .eq('id', claimId)
            .single();

        if (dispute) {
            return {
                sku: dispute.sku,
                asin: dispute.asin,
                claimType: dispute.dispute_type
            };
        }

        return null;
    }

    /**
     * Get linked documents with parsed metadata
     */
    private async getLinkedDocuments(
        claimId: string,
        userId: string,
        sku?: string,
        asin?: string
    ): Promise<any[]> {
        const documents: any[] = [];

        // Get from dispute_evidence_links
        const { data: links } = await supabaseAdmin
            .from('dispute_evidence_links')
            .select(`
        evidence_document_id,
        evidence_documents!inner(
          id, filename, doc_type, parsed_metadata, match_confidence
        )
      `)
            .eq('dispute_case_id', claimId);

        if (links) {
            for (const link of links) {
                const doc = (link as any).evidence_documents;
                if (doc) {
                    const meta = typeof doc.parsed_metadata === 'string'
                        ? JSON.parse(doc.parsed_metadata)
                        : doc.parsed_metadata || {};
                    documents.push({
                        id: doc.id,
                        filename: doc.filename,
                        type: doc.doc_type,
                        ...meta
                    });
                }
            }
        }

        // If no linked docs, try to find by SKU/ASIN match
        if (documents.length === 0 && (sku || asin)) {
            const { data: matchedDocs } = await supabaseAdmin
                .from('evidence_documents')
                .select('id, filename, doc_type, parsed_metadata')
                .eq('seller_id', userId)
                .eq('parser_status', 'completed')
                .limit(10);

            if (matchedDocs) {
                for (const doc of matchedDocs) {
                    const meta = typeof doc.parsed_metadata === 'string'
                        ? JSON.parse(doc.parsed_metadata)
                        : doc.parsed_metadata || {};

                    const docAsins = meta.asins || [];
                    const docSkus = meta.skus || [];

                    if ((asin && docAsins.includes(asin)) || (sku && docSkus.includes(sku))) {
                        documents.push({
                            id: doc.id,
                            filename: doc.filename,
                            type: doc.doc_type,
                            ...meta
                        });
                    }
                }
            }
        }

        return documents;
    }

    /**
     * Analyze documents for a specific proof category
     */
    private analyzeProofCategory(
        category: 'ownership' | 'value' | 'delivery' | 'inventory',
        documents: any[],
        claim: { sku?: string; asin?: string; claimType?: string }
    ): ProofStatus {
        const requirements = PROOF_REQUIREMENTS[category];
        const foundFields: ProofStatus['fields'] = [];
        const documentIds: string[] = [];

        // Check each document for required and optional fields
        for (const doc of documents) {
            let hasRelevantField = false;

            // Check required fields
            for (const field of requirements.required) {
                const value = this.extractField(doc, field);
                if (value) {
                    foundFields.push({
                        name: field,
                        found: true,
                        value: String(value).slice(0, 50),
                        source: doc.filename
                    });
                    hasRelevantField = true;
                }
            }

            // Check optional fields
            for (const field of requirements.optional) {
                const value = this.extractField(doc, field);
                if (value) {
                    foundFields.push({
                        name: field,
                        found: true,
                        value: String(value).slice(0, 50),
                        source: doc.filename
                    });
                    hasRelevantField = true;
                }
            }

            if (hasRelevantField) {
                documentIds.push(doc.id);
            }
        }

        // Dedupe fields
        const uniqueFields = this.dedupeFields(foundFields);

        // Determine status
        const requiredFound = requirements.required.filter(f =>
            uniqueFields.some(uf => uf.name === f && uf.found)
        );
        const hasAllRequired = requiredFound.length === requirements.required.length;
        const hasAnyRequired = requiredFound.length > 0;

        let status: 'complete' | 'partial' | 'missing' = 'missing';
        if (hasAllRequired) status = 'complete';
        else if (hasAnyRequired) status = 'partial';

        // Generate message
        const message = this.generateCategoryMessage(category, status, requirements, requiredFound, claim);
        const actionRequired = status !== 'complete'
            ? this.generateActionRequired(category, requirements, requiredFound, claim)
            : undefined;

        return {
            category,
            status,
            documentIds,
            fields: uniqueFields,
            message,
            actionRequired
        };
    }

    /**
     * Extract a field value from document metadata
     */
    private extractField(doc: any, fieldName: string): any {
        // Direct field
        if (doc[fieldName] !== undefined) return doc[fieldName];

        // Common aliases
        const aliases: Record<string, string[]> = {
            'invoice_number': ['invoice_no', 'inv_number', 'invoice_id'],
            'supplier_name': ['vendor', 'seller_name', 'supplier'],
            'buyer_name': ['buyer', 'purchaser', 'company_name'],
            'unit_price': ['price', 'cost', 'unit_cost'],
            'total_amount': ['total', 'amount', 'invoice_total'],
            'tracking_number': ['tracking', 'tracking_no', 'shipment_tracking'],
            'pod': ['proof_of_delivery', 'delivery_proof'],
            'bol': ['bill_of_lading', 'lading'],
            'delivery_date': ['delivered_at', 'delivered_date'],
            'shipment_id': ['fba_shipment_id', 'amazon_shipment_id'],
            'fapiao_number': ['fapiao', 'tax_invoice_number']
        };

        for (const alias of (aliases[fieldName] || [])) {
            if (doc[alias] !== undefined) return doc[alias];
        }

        // Nested in line_items
        if (doc.line_items && Array.isArray(doc.line_items)) {
            for (const item of doc.line_items) {
                if (item[fieldName] !== undefined) return item[fieldName];
            }
        }

        return null;
    }

    /**
     * Deduplicate fields by name
     */
    private dedupeFields(fields: ProofStatus['fields']): ProofStatus['fields'] {
        const seen = new Map<string, ProofStatus['fields'][0]>();
        for (const field of fields) {
            if (!seen.has(field.name) || field.found) {
                seen.set(field.name, field);
            }
        }
        return Array.from(seen.values());
    }

    /**
     * Generate human-readable message for a proof category
     */
    private generateCategoryMessage(
        category: string,
        status: string,
        requirements: typeof PROOF_REQUIREMENTS.ownership,
        foundRequired: string[],
        claim: { sku?: string; asin?: string }
    ): string {
        const desc = requirements.description;

        if (status === 'complete') {
            return `${desc}: Complete ✓`;
        } else if (status === 'partial') {
            const missing = requirements.required.filter(r => !foundRequired.includes(r));
            return `${desc}: Partial — missing ${missing.join(', ')}`;
        } else {
            return `${desc}: Not found — need ${requirements.examples}`;
        }
    }

    /**
     * Generate actionable message for missing proof
     */
    private generateActionRequired(
        category: string,
        requirements: typeof PROOF_REQUIREMENTS.ownership,
        foundRequired: string[],
        claim: { sku?: string; asin?: string }
    ): string {
        const missing = requirements.required.filter(r => !foundRequired.includes(r));
        const identifier = claim.asin ? `ASIN ${claim.asin}` : claim.sku ? `SKU ${claim.sku}` : 'this product';

        switch (category) {
            case 'ownership':
                if (missing.includes('invoice_number') || missing.includes('supplier_name')) {
                    return `Please upload 1 supplier invoice or fapiao for ${identifier} to prove ownership`;
                }
                break;
            case 'value':
                if (missing.includes('unit_price')) {
                    return `Missing proof of value for ${identifier} — upload invoice showing unit cost`;
                }
                break;
            case 'delivery':
                if (missing.includes('tracking_number')) {
                    return `Missing proof of delivery for ${identifier} — upload POD, BOL, or tracking screenshot`;
                }
                break;
            case 'inventory':
                if (missing.includes('shipment_id')) {
                    return `Missing inventory trail — provide FBA shipment ID or inventory adjustment record`;
                }
                break;
        }

        return `Still searching your docs for ${requirements.description.toLowerCase()}`;
    }

    /**
     * Generate overall recommendations
     */
    private generateRecommendations(
        proofs: {
            ownership: ProofStatus;
            value: ProofStatus;
            delivery: ProofStatus;
            inventory: ProofStatus;
        },
        sku?: string,
        asin?: string
    ): string[] {
        const recommendations: string[] = [];
        const identifier = asin ? `ASIN ${asin}` : sku ? `SKU ${sku}` : 'this claim';

        // Priority order: ownership > value > delivery > inventory
        if (proofs.ownership.status === 'missing') {
            recommendations.push(`Upload supplier invoice or fapiao for ${identifier} to maximize approval odds`);
        }

        if (proofs.value.status === 'missing') {
            recommendations.push(`Missing proof of value — Amazon may use their estimate (usually lower)`);
        } else if (proofs.value.status === 'partial') {
            recommendations.push(`Add unit cost to strengthen value proof`);
        }

        if (proofs.delivery.status === 'missing') {
            recommendations.push(`Upload POD or tracking confirmation for ${identifier}`);
        }

        if (proofs.inventory.status === 'missing' && proofs.ownership.status !== 'missing') {
            recommendations.push(`FBA shipment ID not found — we're searching your records`);
        }

        if (recommendations.length === 0) {
            recommendations.push(`All proof requirements satisfied for ${identifier}`);
        }

        return recommendations;
    }
}

export const proofChecklistService = new ProofChecklistService();
export default proofChecklistService;
