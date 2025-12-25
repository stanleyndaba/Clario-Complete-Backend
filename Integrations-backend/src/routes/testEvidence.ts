/**
 * Test Evidence Generator
 * Creates mock evidence documents that match existing claims
 * Used for E2E testing of evidence matching in the UI
 */

import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

interface ClaimInfo {
    id: string;
    order_id?: string;
    sku?: string;
    asin?: string;
    amount?: number;
    estimated_value?: number;
    claim_type?: string;
    detection_type?: string;
    seller_id?: string;
}

/**
 * Generate 5 evidence documents that match existing claims
 * POST /api/test/generate-matching-evidence
 */
router.post('/generate-matching-evidence', async (req: Request, res: Response) => {
    try {
        const userId = req.body.userId || 'demo-user';
        const count = Math.min(req.body.count || 5, 10); // Max 10

        logger.info('🧪 [TEST EVIDENCE] Generating matching evidence documents', { userId, count });

        // 1. Fetch existing claims from detection_results
        const { data: claims, error: claimsError } = await supabaseAdmin
            .from('detection_results')
            .select('id, order_id, asin, sku, estimated_value, detection_type, seller_id, claim_type')
            .eq('seller_id', userId)
            .order('created_at', { ascending: false })
            .limit(count);

        if (claimsError || !claims || claims.length === 0) {
            logger.warn('⚠️ [TEST EVIDENCE] No claims found for user', { userId, error: claimsError });
            return res.status(404).json({
                success: false,
                message: 'No claims found for this user. Run a sync first to generate claims.',
                claimsCount: 0
            });
        }

        logger.info(`📋 [TEST EVIDENCE] Found ${claims.length} claims to match`, { userId });

        // 2. Create or get evidence source for test documents
        let sourceId: string;
        const { data: existingSource } = await supabaseAdmin
            .from('evidence_sources')
            .select('id')
            .eq('seller_id', userId)
            .eq('provider', 'test_generator')
            .maybeSingle();

        if (existingSource) {
            sourceId = existingSource.id;
        } else {
            const { data: newSource, error: sourceError } = await supabaseAdmin
                .from('evidence_sources')
                .insert({
                    user_id: userId,
                    seller_id: userId,
                    provider: 'test_generator',
                    account_email: 'test@opside.ai',
                    status: 'connected',
                    encrypted_access_token: 'test-token',
                    encrypted_refresh_token: 'test-refresh',
                    metadata: {
                        purpose: 'E2E testing of evidence matching',
                        created_at: new Date().toISOString()
                    }
                })
                .select('id')
                .single();

            if (sourceError || !newSource) {
                throw new Error(`Failed to create test evidence source: ${sourceError?.message}`);
            }
            sourceId = newSource.id;
        }

        // 3. Generate matching evidence documents
        const generatedDocs: any[] = [];
        const documentTypes = ['invoice', 'shipping', 'po', 'other'];

        for (let i = 0; i < claims.length; i++) {
            const claim = claims[i];
            const docType = documentTypes[i % documentTypes.length];
            const documentId = uuidv4();

            // Create realistic filenames based on claim type
            const filename = generateFilename(claim, docType, i);

            // Build extracted data that will match the claim
            const extracted = {
                order_ids: claim.order_id ? [claim.order_id] : [],
                asins: claim.asin ? [claim.asin] : [],
                skus: claim.sku ? [claim.sku] : [],
                amounts: claim.estimated_value ? [claim.estimated_value] : [],
                invoice_numbers: [`INV-${Date.now()}-${i}`],
                dates: [new Date().toISOString().split('T')[0]],
                extraction_method: 'test_generator',
                extracted_at: new Date().toISOString(),
                matched_claim_id: claim.id // For verification
            };

            // Build realistic raw text that contains the identifiers
            const rawText = generateRawText(claim, extracted);

            const documentData = {
                id: documentId,
                source_id: sourceId,
                user_id: userId,
                seller_id: userId,
                provider: 'test_generator',
                doc_type: docType,
                external_id: `test_${claim.id}_${Date.now()}`,
                filename: filename,
                size_bytes: Math.floor(Math.random() * 500000) + 50000, // 50KB - 500KB
                content_type: 'application/pdf',
                created_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                sender: 'amazon-fba@amazon.com',
                subject: `Amazon FBA - ${claim.detection_type || claim.claim_type || 'Notice'} - ${claim.order_id || 'Multiple Orders'}`,
                raw_text: rawText,
                extracted: extracted,
                metadata: {
                    test_document: true,
                    matched_claim_id: claim.id,
                    generated_at: new Date().toISOString(),
                    purpose: 'E2E evidence matching test'
                },
                processing_status: 'completed',
                parser_status: 'extracted',
                parser_confidence: 0.95,
                ingested_at: new Date().toISOString()
            };

            const { data: doc, error: docError } = await supabaseAdmin
                .from('evidence_documents')
                .insert(documentData)
                .select('id, filename, extracted')
                .single();

            if (docError) {
                logger.error('❌ [TEST EVIDENCE] Failed to insert document', {
                    error: docError.message,
                    claim_id: claim.id
                });
                continue;
            }

            generatedDocs.push({
                documentId: doc.id,
                filename: doc.filename,
                matchedClaimId: claim.id,
                matchedOrderId: claim.order_id,
                matchedAsin: claim.asin,
                matchedValue: claim.estimated_value
            });

            logger.info('✅ [TEST EVIDENCE] Generated matching document', {
                documentId: doc.id,
                claimId: claim.id,
                orderId: claim.order_id
            });
        }

        // 4. Trigger evidence matching for these documents
        // The matching worker should pick them up automatically, but log for visibility
        logger.info('🔗 [TEST EVIDENCE] Documents ready for matching', {
            userId,
            documentsCreated: generatedDocs.length,
            message: 'Evidence matching worker will automatically process these'
        });

        return res.json({
            success: true,
            message: `Generated ${generatedDocs.length} evidence documents matching existing claims`,
            documentsCreated: generatedDocs.length,
            documents: generatedDocs,
            nextStep: 'Navigate to Recoveries page to see matching in action'
        });

    } catch (error: any) {
        logger.error('❌ [TEST EVIDENCE] Error generating test evidence', {
            error: error.message,
            stack: error.stack
        });
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Generate realistic filename based on claim type
 */
function generateFilename(claim: ClaimInfo, docType: string, index: number): string {
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const detectionType = (claim.detection_type || claim.claim_type || 'notice').toLowerCase().replace(/\s+/g, '_');

    const templates = [
        `Amazon_FBA_${detectionType}_${date}.pdf`,
        `Invoice_${claim.order_id || 'batch'}_${date}.pdf`,
        `Shipment_Report_${claim.asin || 'multi'}_${date}.pdf`,
        `Reimbursement_Notice_${date}_${index}.pdf`,
        `FBA_Inventory_Adjustment_${date}.pdf`
    ];

    return templates[index % templates.length];
}

/**
 * Generate realistic raw text that will match the claim
 */
function generateRawText(claim: ClaimInfo, extracted: any): string {
    const sections = [
        '=== AMAZON FBA DOCUMENT ===',
        '',
        'Document Type: Evidence for Reimbursement Claim',
        `Generated: ${new Date().toISOString()}`,
        ''
    ];

    if (claim.order_id) {
        sections.push(`Order ID: ${claim.order_id}`);
    }
    if (claim.asin) {
        sections.push(`ASIN: ${claim.asin}`);
    }
    if (claim.sku) {
        sections.push(`SKU: ${claim.sku}`);
    }
    if (claim.estimated_value) {
        sections.push(`Amount: $${claim.estimated_value.toFixed(2)}`);
    }
    if (claim.detection_type || claim.claim_type) {
        sections.push(`Issue Type: ${claim.detection_type || claim.claim_type}`);
    }

    sections.push('');
    sections.push('This document serves as evidence for the above referenced order.');
    sections.push('Please retain for your records.');
    sections.push('');
    sections.push('=== END OF DOCUMENT ===');

    return sections.join('\n');
}

/**
 * Clean up test evidence documents
 * DELETE /api/test/cleanup-test-evidence
 */
router.delete('/cleanup-test-evidence', async (req: Request, res: Response) => {
    try {
        const userId = req.body.userId || req.query.userId || 'demo-user';

        const { data: deleted, error } = await supabaseAdmin
            .from('evidence_documents')
            .delete()
            .eq('seller_id', userId)
            .eq('provider', 'test_generator')
            .select('id');

        if (error) {
            throw error;
        }

        logger.info('🧹 [TEST EVIDENCE] Cleaned up test documents', {
            userId,
            deletedCount: deleted?.length || 0
        });

        return res.json({
            success: true,
            deletedCount: deleted?.length || 0
        });

    } catch (error: any) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
