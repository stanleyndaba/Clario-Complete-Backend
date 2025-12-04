import { Router, Request, Response } from 'express';
import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/documents
 * List all evidence documents for the user
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        // Convert to UUID if needed (handles 'demo-user' -> deterministic UUID)
        const finalUserId = convertUserIdToUuid(userId);

        logger.info('📂 [DOCUMENTS] Fetching documents', { userId, finalUserId });

        // Fetch documents from Supabase
        const { data: documents, error } = await supabase
            .from('evidence_documents')
            .select('*')
            .eq('user_id', finalUserId)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('❌ [DOCUMENTS] Database error fetching documents', { error });
            throw error;
        }

        // Transform to match expected frontend format
        // The frontend expects: id, name, uploadDate, status, supplier, invoice, amount, parsedVia, etc.
        // Worker stores parsed data in: parsed_metadata column (primary) or metadata column (fallback)
        // Also check direct columns (supplier_name, invoice_number, total_amount) for legacy compatibility
        const formattedDocuments = documents.map(doc => {
            // Primary: parsed_metadata (where documentParsingWorker stores data)
            const parsedMetadata = doc.parsed_metadata || {};
            // Fallback: metadata column (may contain parsed_data or parsed_metadata nested)
            const metadata = doc.metadata || {};
            const nestedParsedData = metadata.parsed_data || metadata.parsed_metadata || {};

            // Merge all sources: parsed_metadata > direct columns > metadata.parsed_data > metadata
            const supplier = parsedMetadata.supplier_name || doc.supplier_name || nestedParsedData.supplier_name || nestedParsedData.supplier || metadata.supplier_name || null;
            const invoice = parsedMetadata.invoice_number || doc.invoice_number || nestedParsedData.invoice_number || nestedParsedData.invoice_no || metadata.invoice_number || null;
            const amount = parsedMetadata.total_amount || doc.total_amount || nestedParsedData.total_amount || nestedParsedData.total || nestedParsedData.amount || metadata.total_amount || null;
            const lineItems = parsedMetadata.line_items || nestedParsedData.line_items || nestedParsedData.items || [];
            const confidence = parsedMetadata.confidence_score || doc.parser_confidence || nestedParsedData.confidence_score || metadata.parser_confidence || null;
            const extractionMethod = parsedMetadata.extraction_method || nestedParsedData.extraction_method || metadata.parser_type || metadata.parsedVia || null;

            return {
                id: doc.id,
                name: doc.filename || doc.original_filename,
                uploadDate: doc.created_at,
                status: doc.status || 'uploaded',
                size: doc.size_bytes,
                type: doc.content_type,
                source: doc.source_id ? 'gmail' : 'upload',
                // Parsed fields for table display
                supplier: supplier,
                invoice: invoice,
                amount: amount,
                parsedVia: extractionMethod,
                parser_status: parsedMetadata.parser_status || doc.parser_status || metadata.parser_status || 'pending',
                parser_confidence: confidence,
                linkedSKUs: lineItems.length || 0,
                // Include raw data for debugging
                metadata: doc.metadata,
                parsed_metadata: doc.parsed_metadata
            };
        });

        res.json(formattedDocuments);
    } catch (error: any) {
        logger.error('❌ [DOCUMENTS] Error fetching documents', {
            error: error?.message || String(error),
            stack: error?.stack
        });

        res.status(500).json({
            success: false,
            error: 'Failed to fetch documents',
            message: error?.message || String(error)
        });
    }
});

/**
 * GET /api/documents/:id
 * Get a single document details
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
        const docId = req.params.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        const { data: doc, error } = await supabase
            .from('evidence_documents')
            .select('*')
            .eq('id', docId)
            .eq('user_id', convertUserIdToUuid(userId))
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: 'Document not found'
                });
            }
            throw error;
        }

        res.json({
            id: doc.id,
            name: doc.filename,
            uploadDate: doc.created_at,
            status: doc.status,
            size: doc.size_bytes,
            type: doc.content_type,
            metadata: doc.metadata
        });
    } catch (error: any) {
        logger.error('❌ [DOCUMENTS] Error fetching document details', {
            docId: req.params.id,
            error: error?.message || String(error)
        });

        res.status(500).json({
            success: false,
            error: 'Failed to fetch document details'
        });
    }
});

/**
 * GET /api/documents/:id/download
 * Get a download URL for the document
 */
router.get('/:id/download', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
        const docId = req.params.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        // Get document metadata first to get storage path
        const { data: doc, error: dbError } = await supabase
            .from('evidence_documents')
            .select('storage_path, filename')
            .eq('id', docId)
            .eq('user_id', convertUserIdToUuid(userId))
            .single();

        if (dbError || !doc) {
            return res.status(404).json({
                success: false,
                error: 'Document not found'
            });
        }

        // Generate signed URL
        const { data, error: storageError } = await supabaseAdmin
            .storage
            .from('evidence-documents')
            .createSignedUrl(doc.storage_path, 3600); // 1 hour expiry

        if (storageError) {
            logger.error('❌ [DOCUMENTS] Storage error generating signed URL', { error: storageError });
            throw storageError;
        }

        res.json({
            success: true,
            url: data.signedUrl,
            filename: doc.filename
        });
    } catch (error: any) {
        logger.error('❌ [DOCUMENTS] Error generating download URL', {
            docId: req.params.id,
            error: error?.message || String(error)
        });

        res.status(500).json({
            success: false,
            error: 'Failed to generate download URL'
        });
    }
});

export default router;
