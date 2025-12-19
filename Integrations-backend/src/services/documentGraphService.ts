/**
 * Document Graph Service
 * Manages document-to-claims relationships for evidence reuse
 * 
 * Key Features:
 * 1. getLinkedClaims(documentId) → List of claims using this document
 * 2. getDocumentsForSku(sku) → Documents available for products
 * 3. suggestDocumentsForClaim(claimId) → Smart reuse suggestions
 * 4. generateCompositePdf(claimId) → Bundle docs for Amazon's 1-doc rule
 */

import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface LinkedClaim {
    claimId: string;
    claimNumber?: string;
    claimType: string;
    amount: number;
    currency: string;
    linkDate: string;
    matchType: string;
    confidence: number;
}

export interface DocumentSummary {
    id: string;
    filename: string;
    supplier?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    totalAmount?: number;
    currency?: string;
    asins: string[];
    skus: string[];
    linkedClaimCount: number;
}

export interface ReuseSuggestion {
    documentId: string;
    filename: string;
    matchReason: string;
    linkedClaimCount: number;
    linkedClaims: LinkedClaim[];
    matchScore: number;
}

class DocumentGraphService {

    /**
     * Get all claims linked to a specific document
     */
    async getLinkedClaims(documentId: string): Promise<LinkedClaim[]> {
        try {
            logger.info('📊 [DOC GRAPH] Getting linked claims for document', { documentId });

            // Query dispute_evidence_links to get all linked claims
            const { data: links, error } = await supabaseAdmin
                .from('dispute_evidence_links')
                .select(`
          dispute_case_id,
          relevance_score,
          matched_context,
          created_at,
          dispute_cases!inner(
            id,
            claim_number,
            dispute_type,
            claim_amount,
            currency,
            status
          )
        `)
                .eq('evidence_document_id', documentId);

            if (error) {
                logger.warn('⚠️ [DOC GRAPH] Error querying links, trying fallback', { error: error.message });
                return this.getLinkedClaimsFromDetections(documentId);
            }

            if (!links || links.length === 0) {
                // Try fallback via detection_results
                return this.getLinkedClaimsFromDetections(documentId);
            }

            const linkedClaims: LinkedClaim[] = links.map((link: any) => {
                const dispute = link.dispute_cases;
                const context = typeof link.matched_context === 'string'
                    ? JSON.parse(link.matched_context)
                    : link.matched_context || {};

                return {
                    claimId: dispute?.id || link.dispute_case_id,
                    claimNumber: dispute?.claim_number,
                    claimType: dispute?.dispute_type || 'unknown',
                    amount: dispute?.claim_amount || 0,
                    currency: dispute?.currency || 'USD',
                    linkDate: link.created_at,
                    matchType: context.match_type || 'manual',
                    confidence: link.relevance_score || 0
                };
            });

            logger.info('📊 [DOC GRAPH] Found linked claims', {
                documentId,
                claimCount: linkedClaims.length
            });

            return linkedClaims;

        } catch (error: any) {
            logger.error('❌ [DOC GRAPH] Failed to get linked claims', {
                documentId,
                error: error.message
            });
            return [];
        }
    }

    /**
     * Fallback: Get linked claims from detection_results matched_documents field
     */
    private async getLinkedClaimsFromDetections(documentId: string): Promise<LinkedClaim[]> {
        try {
            // Search detection_results where this doc might be in evidence or matched_docs
            const { data: detections } = await supabaseAdmin
                .from('detection_results')
                .select('id, claim_number, anomaly_type, estimated_value, currency, created_at, match_confidence')
                .or(`matched_document_ids.cs.{${documentId}},evidence->>'document_id'.eq.${documentId}`);

            if (!detections || detections.length === 0) {
                return [];
            }

            return detections.map((d: any) => ({
                claimId: d.id,
                claimNumber: d.claim_number,
                claimType: d.anomaly_type || 'unknown',
                amount: d.estimated_value || 0,
                currency: d.currency || 'USD',
                linkDate: d.created_at,
                matchType: 'detection',
                confidence: d.match_confidence || 0.5
            }));

        } catch (error: any) {
            logger.warn('⚠️ [DOC GRAPH] Fallback query also failed', { error: error.message });
            return [];
        }
    }

    /**
     * Get all documents that could support a given SKU/ASIN
     */
    async getDocumentsForProduct(
        userId: string,
        sku?: string,
        asin?: string
    ): Promise<DocumentSummary[]> {
        try {
            logger.info('📋 [DOC GRAPH] Getting documents for product', { userId, sku, asin });

            // Get all parsed documents for this user
            const { data: documents, error } = await supabaseAdmin
                .from('evidence_documents')
                .select('id, filename, supplier, invoice_number, parsed_metadata, parser_status')
                .eq('seller_id', userId)
                .eq('parser_status', 'completed');

            if (error || !documents) {
                logger.warn('⚠️ [DOC GRAPH] Failed to fetch documents', { error: error?.message });
                return [];
            }

            const matchingDocs: DocumentSummary[] = [];

            for (const doc of documents) {
                const meta = typeof doc.parsed_metadata === 'string'
                    ? JSON.parse(doc.parsed_metadata)
                    : doc.parsed_metadata || {};

                const docAsins = meta.asins || [];
                const docSkus = meta.skus || [];

                // Check if this doc matches the product
                const asinMatch = asin && docAsins.includes(asin);
                const skuMatch = sku && docSkus.includes(sku);

                if (asinMatch || skuMatch) {
                    // Get linked claim count
                    const linkedClaims = await this.getLinkedClaims(doc.id);

                    matchingDocs.push({
                        id: doc.id,
                        filename: doc.filename,
                        supplier: doc.supplier || meta.supplier_name,
                        invoiceNumber: doc.invoice_number || meta.invoice_number,
                        invoiceDate: meta.invoice_date,
                        totalAmount: meta.total_amount,
                        currency: meta.currency,
                        asins: docAsins,
                        skus: docSkus,
                        linkedClaimCount: linkedClaims.length
                    });
                }
            }

            logger.info('📋 [DOC GRAPH] Found matching documents', {
                count: matchingDocs.length,
                sku,
                asin
            });

            return matchingDocs;

        } catch (error: any) {
            logger.error('❌ [DOC GRAPH] Failed to get documents for product', { error: error.message });
            return [];
        }
    }

    /**
     * Suggest documents that could be reused for a claim
     * Returns suggestions with "This invoice already supports X other claims" messaging
     */
    async suggestDocumentsForClaim(
        userId: string,
        claimId: string
    ): Promise<ReuseSuggestion[]> {
        try {
            logger.info('💡 [DOC GRAPH] Generating reuse suggestions for claim', { userId, claimId });

            // Get claim details (SKU, ASIN)
            const { data: claim } = await supabaseAdmin
                .from('detection_results')
                .select('id, anomaly_type, evidence, sku, asin')
                .eq('id', claimId)
                .single();

            if (!claim) {
                // Try dispute_cases
                const { data: dispute } = await supabaseAdmin
                    .from('dispute_cases')
                    .select('id, dispute_type, sku, asin')
                    .eq('id', claimId)
                    .single();

                if (!dispute) {
                    logger.warn('⚠️ [DOC GRAPH] Claim not found', { claimId });
                    return [];
                }

                return this.findReusableDocs(userId, dispute.sku, dispute.asin);
            }

            const evidence = typeof claim.evidence === 'string'
                ? JSON.parse(claim.evidence)
                : claim.evidence || {};

            const sku = claim.sku || evidence.sku;
            const asin = claim.asin || evidence.asin;

            return this.findReusableDocs(userId, sku, asin);

        } catch (error: any) {
            logger.error('❌ [DOC GRAPH] Failed to generate suggestions', { error: error.message });
            return [];
        }
    }

    /**
     * Find reusable documents for a SKU/ASIN
     */
    private async findReusableDocs(
        userId: string,
        sku?: string,
        asin?: string
    ): Promise<ReuseSuggestion[]> {
        const suggestions: ReuseSuggestion[] = [];

        if (!sku && !asin) {
            return suggestions;
        }

        // Get documents matching this product
        const docs = await this.getDocumentsForProduct(userId, sku, asin);

        for (const doc of docs) {
            const linkedClaims = await this.getLinkedClaims(doc.id);

            let matchReason = '';
            let matchScore = 0.7;

            if (asin && doc.asins.includes(asin)) {
                matchReason = `ASIN ${asin} match`;
                matchScore = 0.9;
            } else if (sku && doc.skus.includes(sku)) {
                matchReason = `SKU ${sku} match`;
                matchScore = 0.85;
            }

            // Boost score if already successfully used
            if (linkedClaims.length > 0) {
                matchScore = Math.min(1.0, matchScore + 0.05 * linkedClaims.length);
                matchReason = matchReason + ` — already used for ${linkedClaims.length} other claim${linkedClaims.length > 1 ? 's' : ''}`;
            }

            suggestions.push({
                documentId: doc.id,
                filename: doc.filename,
                matchReason,
                linkedClaimCount: linkedClaims.length,
                linkedClaims,
                matchScore
            });
        }

        // Sort by match score (highest first)
        suggestions.sort((a, b) => b.matchScore - a.matchScore);

        logger.info('💡 [DOC GRAPH] Generated reuse suggestions', {
            count: suggestions.length,
            sku,
            asin
        });

        return suggestions;
    }

    /**
     * Link a document to a claim
     */
    async linkDocumentToClaim(
        documentId: string,
        claimId: string,
        matchType: string = 'manual',
        confidence: number = 1.0
    ): Promise<boolean> {
        try {
            logger.info('🔗 [DOC GRAPH] Linking document to claim', { documentId, claimId });

            const { error } = await supabaseAdmin
                .from('dispute_evidence_links')
                .upsert({
                    dispute_case_id: claimId,
                    evidence_document_id: documentId,
                    relevance_score: confidence,
                    matched_context: {
                        match_type: matchType,
                        linked_at: new Date().toISOString()
                    }
                }, {
                    onConflict: 'dispute_case_id,evidence_document_id'
                });

            if (error) {
                logger.error('❌ [DOC GRAPH] Failed to link document', { error: error.message });
                return false;
            }

            logger.info('✅ [DOC GRAPH] Document linked successfully', { documentId, claimId });
            return true;

        } catch (error: any) {
            logger.error('❌ [DOC GRAPH] Link operation failed', { error: error.message });
            return false;
        }
    }

    /**
     * Get document reuse statistics for a user
     */
    async getDocumentReuseStats(userId: string): Promise<{
        totalDocuments: number;
        documentsWithMultipleClaims: number;
        averageClaimsPerDocument: number;
        topReusedDocuments: Array<{ filename: string; claimCount: number }>;
    }> {
        try {
            // Get all documents with their linked claim counts
            const { data: documents } = await supabaseAdmin
                .from('evidence_documents')
                .select('id, filename')
                .eq('seller_id', userId)
                .eq('parser_status', 'completed');

            if (!documents || documents.length === 0) {
                return {
                    totalDocuments: 0,
                    documentsWithMultipleClaims: 0,
                    averageClaimsPerDocument: 0,
                    topReusedDocuments: []
                };
            }

            const docStats: Array<{ filename: string; claimCount: number }> = [];
            let totalClaims = 0;

            for (const doc of documents) {
                const linkedClaims = await this.getLinkedClaims(doc.id);
                docStats.push({
                    filename: doc.filename,
                    claimCount: linkedClaims.length
                });
                totalClaims += linkedClaims.length;
            }

            const documentsWithMultipleClaims = docStats.filter(d => d.claimCount > 1).length;
            const averageClaimsPerDocument = documents.length > 0
                ? totalClaims / documents.length
                : 0;

            // Top 5 most reused documents
            const topReusedDocuments = docStats
                .filter(d => d.claimCount > 0)
                .sort((a, b) => b.claimCount - a.claimCount)
                .slice(0, 5);

            return {
                totalDocuments: documents.length,
                documentsWithMultipleClaims,
                averageClaimsPerDocument: Math.round(averageClaimsPerDocument * 100) / 100,
                topReusedDocuments
            };

        } catch (error: any) {
            logger.error('❌ [DOC GRAPH] Failed to get reuse stats', { error: error.message });
            return {
                totalDocuments: 0,
                documentsWithMultipleClaims: 0,
                averageClaimsPerDocument: 0,
                topReusedDocuments: []
            };
        }
    }
}

export const documentGraphService = new DocumentGraphService();
export default documentGraphService;
