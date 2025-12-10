import { Router, Request, Response } from 'express';
import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

/**
 * POST /api/documents/upload
 * Upload documents to Evidence Locker - stores to Supabase Storage
 */
router.post('/upload', upload.any(), async (req: Request, res: Response) => {
    try {
        // Extract user ID
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
        const finalUserId = convertUserIdToUuid(userId);

        const files = (req as any).files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files provided'
            });
        }

        logger.info('📤 [DOCUMENTS] Upload request received', {
            userId,
            finalUserId,
            fileCount: files.length,
            filenames: files.map(f => f.originalname)
        });

        const uploadedDocuments: any[] = [];

        for (const file of files) {
            const docId = uuidv4();
            const timestamp = Date.now();
            const storagePath = `${finalUserId}/${timestamp}/${file.originalname}`;

            // Upload to Supabase Storage
            const { data: storageData, error: storageError } = await supabaseAdmin
                .storage
                .from('evidence-documents')
                .upload(storagePath, file.buffer, {
                    contentType: file.mimetype,
                    upsert: false
                });

            if (storageError) {
                logger.error('❌ [DOCUMENTS] Storage upload failed', {
                    filename: file.originalname,
                    error: storageError.message
                });
                // Continue with other files
                continue;
            }

            // Create database record
            const { data: docRecord, error: dbError } = await supabaseAdmin
                .from('evidence_documents')
                .insert({
                    id: docId,
                    user_id: finalUserId,
                    seller_id: finalUserId,
                    filename: file.originalname,
                    original_filename: file.originalname,
                    content_type: file.mimetype,
                    mime_type: file.mimetype,
                    size_bytes: file.size,
                    storage_path: storagePath,
                    status: 'uploaded',
                    parser_status: 'pending',
                    source: 'upload',
                    provider: 'upload',
                    metadata: {
                        uploaded_at: new Date().toISOString(),
                        upload_method: 'drag_drop'
                    }
                })
                .select()
                .single();

            if (dbError) {
                logger.error('❌ [DOCUMENTS] Database insert failed', {
                    filename: file.originalname,
                    error: dbError.message
                });
                // Try to clean up storage
                await supabaseAdmin.storage.from('evidence-documents').remove([storagePath]);
                continue;
            }

            uploadedDocuments.push({
                id: docId,
                filename: file.originalname,
                size: file.size,
                type: file.mimetype,
                status: 'uploaded',
                parser_status: 'pending'
            });

            logger.info('✅ [DOCUMENTS] Document uploaded successfully', {
                docId,
                filename: file.originalname,
                storagePath
            });
        }

        // Send SSE event for real-time update
        try {
            const sseHub = (await import('../utils/sseHub')).default;
            sseHub.sendEvent(finalUserId, 'evidence_upload_completed', {
                userId: finalUserId,
                documentIds: uploadedDocuments.map(d => d.id),
                count: uploadedDocuments.length,
                message: `${uploadedDocuments.length} document(s) uploaded successfully`,
                timestamp: new Date().toISOString()
            });
        } catch (sseError) {
            logger.debug('SSE event failed (non-critical)', { error: sseError });
        }

        res.json({
            success: true,
            message: `${uploadedDocuments.length} document(s) uploaded successfully`,
            documents: uploadedDocuments,
            document_ids: uploadedDocuments.map(d => d.id),
            file_count: uploadedDocuments.length
        });
    } catch (error: any) {
        logger.error('❌ [DOCUMENTS] Upload error', {
            error: error?.message || String(error),
            stack: error?.stack
        });

        res.status(500).json({
            success: false,
            error: 'Failed to upload documents',
            message: error?.message || String(error)
        });
    }
});

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

        // Transform to match frontend expected format (same as list endpoint)
        const parsedMetadata = doc.parsed_metadata || {};
        const metadata = doc.metadata || {};
        const nestedParsedData = metadata.parsed_data || metadata.parsed_metadata || {};

        // Extract all relevant data
        const extracted = {
            order_ids: parsedMetadata.order_ids || nestedParsedData.order_ids || [],
            asins: parsedMetadata.asins || nestedParsedData.asins || [],
            skus: parsedMetadata.skus || nestedParsedData.skus || [],
            tracking_numbers: parsedMetadata.tracking_numbers || nestedParsedData.tracking_numbers || [],
            invoice_numbers: parsedMetadata.invoice_numbers || nestedParsedData.invoice_numbers || [],
            amounts: parsedMetadata.amounts || nestedParsedData.amounts || [],
            dates: parsedMetadata.dates || nestedParsedData.dates || []
        };

        res.json({
            id: doc.id,
            name: doc.filename || doc.original_filename,
            filename: doc.filename || doc.original_filename,
            original_filename: doc.original_filename,
            uploadDate: doc.created_at,
            created_at: doc.created_at,
            status: doc.status || 'uploaded',
            size: doc.size_bytes,
            file_size: doc.size_bytes,
            type: doc.content_type,
            content_type: doc.content_type,
            source: doc.source || doc.provider || 'upload',
            provider: doc.provider,
            storage_path: doc.storage_path,
            // Parsed data
            supplier: parsedMetadata.supplier_name || doc.supplier_name || nestedParsedData.supplier_name || null,
            invoice: parsedMetadata.invoice_number || doc.invoice_number || nestedParsedData.invoice_number || null,
            amount: parsedMetadata.total_amount || doc.total_amount || nestedParsedData.total_amount || null,
            // Parser status
            parser_status: parsedMetadata.parser_status || doc.parser_status || metadata.parser_status || 'pending',
            parser_confidence: parsedMetadata.confidence_score || doc.parser_confidence || nestedParsedData.confidence_score || null,
            parsedVia: parsedMetadata.extraction_method || nestedParsedData.extraction_method || metadata.parser_type || null,
            // Extracted entities
            extracted: extracted,
            raw_text_preview: parsedMetadata.raw_text?.substring(0, 500) || nestedParsedData.raw_text?.substring(0, 500) || null,
            // Raw metadata for debugging
            metadata: doc.metadata,
            parsed_metadata: doc.parsed_metadata
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

/**
 * GET /api/documents/:id/generate-pdf
 * Generate a PDF invoice from parsed document data
 */
router.get('/:id/generate-pdf', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
        const docId = req.params.id;

        logger.info('📄 [DOCUMENTS] Generating PDF for document', { docId, userId });

        // Get document with parsed data
        const { data: doc, error: dbError } = await supabaseAdmin
            .from('evidence_documents')
            .select('*')
            .eq('id', docId)
            .single();

        if (dbError || !doc) {
            return res.status(404).json({
                success: false,
                error: 'Document not found'
            });
        }

        // Extract parsed metadata
        const parsedMetadata = doc.parsed_metadata || {};
        const metadata = doc.metadata || {};
        const nestedParsed = metadata.parsed_data || metadata.parsed_metadata || {};

        // Build invoice data from parsed document
        const invoiceData = {
            id: docId,
            title: `Invoice - ${parsedMetadata.invoice_number || doc.invoice_number || doc.filename || 'Document'}`,
            content: {
                sections: [
                    {
                        title: 'Invoice Details',
                        content: {
                            'Invoice Number': parsedMetadata.invoice_number || doc.invoice_number || nestedParsed.invoice_number || 'N/A',
                            'Date': parsedMetadata.invoice_date || doc.document_date || nestedParsed.invoice_date || new Date().toLocaleDateString(),
                            'Supplier': parsedMetadata.supplier_name || doc.supplier_name || nestedParsed.supplier_name || 'N/A',
                            'Currency': parsedMetadata.currency || doc.currency || nestedParsed.currency || 'USD',
                            'Total Amount': `$${(parsedMetadata.total_amount || doc.total_amount || nestedParsed.total_amount || 0).toFixed(2)}`
                        }
                    }
                ]
            },
            metadata: {
                created_at: doc.created_at,
                seller_id: doc.seller_id || doc.user_id,
                document_id: docId
            }
        };

        // Add line items if available
        const lineItems = parsedMetadata.line_items || nestedParsed.line_items || [];
        if (lineItems.length > 0) {
            invoiceData.content.sections.push({
                title: 'Line Items',
                content: {
                    table: lineItems.map((item: any, idx: number) => ({
                        '#': idx + 1,
                        'Description': item.description || item.sku || `Item ${idx + 1}`,
                        'Quantity': item.quantity || 1,
                        'Unit Price': `$${(item.unit_price || item.price || 0).toFixed(2)}`,
                        'Total': `$${(item.total || (item.quantity || 1) * (item.unit_price || 0)).toFixed(2)}`
                    }))
                }
            } as any);
        }

        // Import and use PDF service
        const { pdfGenerationService } = await import('../services/pdfGenerationService');

        const pdfBuffer = await pdfGenerationService.generatePDFFromDocument(invoiceData);

        // Set headers for PDF download
        const filename = `invoice-${parsedMetadata.invoice_number || docId}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        logger.info('✅ [DOCUMENTS] PDF generated successfully', { docId, filename });

        res.send(pdfBuffer);
    } catch (error: any) {
        logger.error('❌ [DOCUMENTS] Error generating PDF', {
            docId: req.params.id,
            error: error?.message || String(error)
        });

        res.status(500).json({
            success: false,
            error: 'Failed to generate PDF',
            message: error?.message || String(error)
        });
    }
});

/**
 * DELETE /api/documents/:id
 * Delete a document from storage and database
 */
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
        const docId = req.params.id;
        const finalUserId = convertUserIdToUuid(userId);

        logger.info('🗑️ [DOCUMENTS] Delete request', { docId, userId, finalUserId });

        // Get document to find storage path
        const { data: doc, error: fetchError } = await supabaseAdmin
            .from('evidence_documents')
            .select('id, storage_path, filename, user_id')
            .eq('id', docId)
            .single();

        if (fetchError || !doc) {
            return res.status(404).json({
                success: false,
                error: 'Document not found'
            });
        }

        // Delete from Supabase Storage if storage_path exists
        if (doc.storage_path) {
            const { error: storageError } = await supabaseAdmin
                .storage
                .from('evidence-documents')
                .remove([doc.storage_path]);

            if (storageError) {
                logger.warn('⚠️ [DOCUMENTS] Could not delete from storage', {
                    docId,
                    storagePath: doc.storage_path,
                    error: storageError.message
                });
                // Continue anyway - we still want to delete the DB record
            } else {
                logger.info('✅ [DOCUMENTS] Deleted from storage', { storagePath: doc.storage_path });
            }
        }

        // Delete from database
        const { error: deleteError } = await supabaseAdmin
            .from('evidence_documents')
            .delete()
            .eq('id', docId);

        if (deleteError) {
            logger.error('❌ [DOCUMENTS] Failed to delete from database', {
                docId,
                error: deleteError.message
            });
            throw deleteError;
        }

        logger.info('✅ [DOCUMENTS] Document deleted successfully', { docId, filename: doc.filename });

        res.json({
            success: true,
            message: 'Document deleted successfully',
            documentId: docId
        });
    } catch (error: any) {
        logger.error('❌ [DOCUMENTS] Delete error', {
            docId: req.params.id,
            error: error?.message || String(error)
        });

        res.status(500).json({
            success: false,
            error: 'Failed to delete document',
            message: error?.message || String(error)
        });
    }
});

/**
 * POST /api/documents/:id/reparse
 * Trigger re-parsing for a document
 */
router.post('/:id/reparse', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
        const docId = req.params.id;
        const finalUserId = convertUserIdToUuid(userId);

        logger.info('🔄 [DOCUMENTS] Re-parse request', { docId, userId });

        // Reset parser_status to pending
        const { error: updateError } = await supabaseAdmin
            .from('evidence_documents')
            .update({
                parser_status: 'pending',
                parsed_metadata: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', docId);

        if (updateError) {
            throw updateError;
        }

        logger.info('✅ [DOCUMENTS] Document queued for re-parsing', { docId });

        // Send SSE event for parsing started
        try {
            const sseHub = (await import('../utils/sseHub')).default;
            sseHub.sendEvent(finalUserId, 'parsing_started', {
                type: 'parsing',
                status: 'started',
                document_id: docId,
                message: 'Document parsing has started',
                timestamp: new Date().toISOString()
            });
        } catch (sseError) {
            logger.debug('SSE event failed (non-critical)', { error: sseError });
        }

        // Try to trigger actual parsing if pdfExtractor is available
        try {
            // Get document from storage
            const { data: doc } = await supabaseAdmin
                .from('evidence_documents')
                .select('storage_path, content_type')
                .eq('id', docId)
                .single();

            if (doc?.storage_path && doc.content_type?.includes('pdf')) {
                // Download file from Supabase Storage
                const { data: fileData, error: downloadError } = await supabaseAdmin
                    .storage
                    .from('evidence-documents')
                    .download(doc.storage_path);

                if (!downloadError && fileData) {
                    const buffer = Buffer.from(await fileData.arrayBuffer());
                    const pdfExtractor = (await import('../utils/pdfExtractor')).default;

                    // Extract text and key fields
                    const extractionResult = await pdfExtractor.extractTextFromPdf(buffer);

                    if (extractionResult.success) {
                        const keyFields = pdfExtractor.extractKeyFieldsFromText(extractionResult.text);

                        // Update document with parsed data
                        await supabaseAdmin
                            .from('evidence_documents')
                            .update({
                                parser_status: 'completed',
                                parsed_metadata: {
                                    raw_text: extractionResult.text,
                                    page_count: extractionResult.pageCount,
                                    order_ids: keyFields.orderIds,
                                    asins: keyFields.asins,
                                    skus: keyFields.skus,
                                    tracking_numbers: keyFields.trackingNumbers,
                                    amounts: keyFields.amounts,
                                    invoice_numbers: keyFields.invoiceNumbers,
                                    dates: keyFields.dates,
                                    extraction_method: 'pdf-parse',
                                    confidence_score: 0.85,
                                    parsed_at: new Date().toISOString()
                                },
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', docId);

                        logger.info('✅ [DOCUMENTS] Document parsed successfully', {
                            docId,
                            orderIds: keyFields.orderIds.length,
                            asins: keyFields.asins.length,
                            trackingNumbers: keyFields.trackingNumbers.length
                        });

                        // Send SSE event for parsing completed
                        const sseHub = (await import('../utils/sseHub')).default;
                        sseHub.sendEvent(finalUserId, 'parsing_completed', {
                            type: 'parsing',
                            status: 'completed',
                            document_id: docId,
                            message: 'Document parsing completed',
                            extracted: {
                                order_ids: keyFields.orderIds.length,
                                asins: keyFields.asins.length,
                                tracking_numbers: keyFields.trackingNumbers.length,
                                amounts: keyFields.amounts.length
                            },
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            }
        } catch (parseError: any) {
            logger.warn('Could not parse document immediately, will be processed by worker', {
                docId,
                error: parseError?.message
            });
        }

        res.json({
            success: true,
            message: 'Document queued for re-parsing. It will be processed by the parsing worker.',
            documentId: docId
        });
    } catch (error: any) {
        logger.error('❌ [DOCUMENTS] Re-parse error', {
            docId: req.params.id,
            error: error?.message || String(error)
        });

        res.status(500).json({
            success: false,
            error: 'Failed to queue document for re-parsing',
            message: error?.message || String(error)
        });
    }
});

export default router;
