import { Router, Request, Response } from 'express';
import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { evidenceAuditService } from '../services/evidenceAuditService';

const router = Router();

const DOCUMENT_BUCKET_NAME = 'evidence-documents';

function getStoredOriginalFilename(doc: any): string | null {
    const explicitOriginalFilename = typeof doc?.original_filename === 'string'
        ? doc.original_filename.trim()
        : '';
    if (explicitOriginalFilename) {
        return explicitOriginalFilename;
    }

    const metadataOriginalFilename = typeof doc?.metadata?.original_filename === 'string'
        ? doc.metadata.original_filename.trim()
        : '';
    if (metadataOriginalFilename) {
        return metadataOriginalFilename;
    }

    const canonicalFilename = typeof doc?.filename === 'string'
        ? doc.filename.trim()
        : '';
    return canonicalFilename || null;
}

function getDocumentDisplayName(doc: any, fallback = 'Untitled document'): string {
    return getStoredOriginalFilename(doc) || fallback;
}

function buildSafeStorageFilename(originalFilename: string): string {
    const trimmed = String(originalFilename || 'document').trim();
    const normalized = trimmed.normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
    const extensionIndex = normalized.lastIndexOf('.');
    const hasExtension = extensionIndex > 0 && extensionIndex < normalized.length - 1;
    const baseName = hasExtension ? normalized.slice(0, extensionIndex) : normalized;
    const extension = hasExtension ? normalized.slice(extensionIndex).toLowerCase() : '';

    const sanitizedBase = baseName
        .replace(/[\/\\]/g, '-')
        .replace(/[^a-zA-Z0-9._ -]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/ /g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+/, '')
        .replace(/[. ]+$/, '');

    const fallbackBase = sanitizedBase || 'document';
    const safeExtension = extension.replace(/[^a-z0-9.]/g, '') || '';

    return `${fallbackBase}${safeExtension}`;
}

async function ensureEvidenceDocumentsBucket(): Promise<void> {
    const storageClient = supabaseAdmin || supabase;

    try {
        const { data: buckets, error: listError } = await storageClient.storage.listBuckets();

        if (listError) {
            logger.warn('⚠️ [DOCUMENTS] Could not verify evidence storage bucket before upload', {
                error: listError.message,
                bucket: DOCUMENT_BUCKET_NAME
            });
            return;
        }

        const bucketExists = buckets?.some(bucket => bucket.name === DOCUMENT_BUCKET_NAME);
        if (bucketExists) {
            return;
        }

        const { error: createError } = await storageClient.storage.createBucket(DOCUMENT_BUCKET_NAME, {
            public: false,
            fileSizeLimit: 52428800,
            allowedMimeTypes: [
                'application/pdf',
                'image/jpeg',
                'image/png',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-excel',
                'text/csv'
            ]
        });

        if (createError && !/already exists/i.test(createError.message || '')) {
            logger.warn('⚠️ [DOCUMENTS] Could not create evidence storage bucket before upload', {
                error: createError.message,
                bucket: DOCUMENT_BUCKET_NAME
            });
            return;
        }

        logger.info('✅ [DOCUMENTS] Evidence storage bucket is ready for manual upload', {
            bucket: DOCUMENT_BUCKET_NAME
        });
    } catch (error: any) {
        logger.warn('⚠️ [DOCUMENTS] Evidence storage bucket check failed before upload', {
            error: error?.message || String(error),
            bucket: DOCUMENT_BUCKET_NAME
        });
    }
}

function isProductDocument(doc: any) {
    return doc?.metadata?.ingestion_method !== 'demo_seed';
}

function getAuthoritativeParserStatus(doc: any) {
    const parsedMetadata = doc?.parsed_metadata || {};
    const metadata = doc?.metadata || {};

    if (parsedMetadata?._parse_failed || parsedMetadata?.parsing_strategy === 'FAILED_DURABLE') return 'failed';
    if (parsedMetadata?.parsing_strategy === 'PARTIAL') return 'partial';
    if (parsedMetadata && Object.keys(parsedMetadata).length > 0) {
        return parsedMetadata.parser_status || 'completed';
    }

    return doc?.parser_status || metadata?.parser_status || 'pending';
}

function getNormalizedParsedMetadata(doc: any) {
    const parsedMetadata = doc?.parsed_metadata || {};
    const metadata = doc?.metadata || {};
    const nestedParsedData = metadata?.parsed_data || metadata?.parsed_metadata || {};

    return {
        parsedMetadata,
        metadata,
        nestedParsedData,
        supplier: parsedMetadata.supplier_name || doc?.supplier_name || nestedParsedData.supplier_name || nestedParsedData.supplier || metadata.supplier_name || null,
        invoice: parsedMetadata.invoice_number || doc?.invoice_number || nestedParsedData.invoice_number || nestedParsedData.invoice_no || metadata.invoice_number || null,
        amount: parsedMetadata.total_amount || doc?.total_amount || nestedParsedData.total_amount || nestedParsedData.total || nestedParsedData.amount || metadata.total_amount || null,
        lineItems: parsedMetadata.line_items || nestedParsedData.line_items || nestedParsedData.items || [],
        confidence: parsedMetadata.confidence_score || doc?.parser_confidence || nestedParsedData.confidence_score || metadata.parser_confidence || null,
        extractionMethod: parsedMetadata.extraction_method || nestedParsedData.extraction_method || metadata.parser_type || metadata.parsedVia || null
    };
}

function getSourceDisplay(doc: any) {
    return doc?.provider || doc?.source || (doc?.source_id ? 'connected_source' : 'upload') || 'unknown';
}

function getExtractionSignalCount(doc: any, normalized: ReturnType<typeof getNormalizedParsedMetadata>) {
    const extracted = doc?.extracted || {};
    let signals = 0;

    if (normalized.supplier) signals += 1;
    if (normalized.invoice) signals += 1;
    if (typeof normalized.amount === 'number') signals += 1;
    if ((normalized.lineItems || []).length > 0) signals += 1;
    if ((extracted.order_ids || []).length > 0) signals += 1;
    if ((extracted.asins || []).length > 0) signals += 1;
    if ((extracted.skus || []).length > 0) signals += 1;
    if ((extracted.invoice_numbers || []).length > 0) signals += 1;
    if ((extracted.tracking_numbers || []).length > 0) signals += 1;

    return signals;
}

function buildLockerState(doc: any, linkedClaimCount: number, strongestMatchConfidence: number | null, extractionSignalCount: number) {
    const parserStatus = getAuthoritativeParserStatus(doc);

    if (parserStatus === 'failed') {
        return {
            evidence_state: 'Parsing Failed',
            usable_as_evidence: false,
            usability_reason: 'Parsing failed. Reparse or replace the file before it can support a case.',
            needs_review: true
        };
    }

    if (parserStatus === 'pending' || parserStatus === 'processing') {
        return {
            evidence_state: 'Not Parsed',
            usable_as_evidence: false,
            usability_reason: 'Parsing has not completed yet.',
            needs_review: false
        };
    }

    if (extractionSignalCount < 2) {
        return {
            evidence_state: 'Parsing Partial',
            usable_as_evidence: false,
            usability_reason: 'Parsing completed, but key fields are still missing.',
            needs_review: true
        };
    }

    if (linkedClaimCount === 0) {
        return {
            evidence_state: 'Unmatched',
            usable_as_evidence: false,
            usability_reason: 'No authoritative case linkage exists yet.',
            needs_review: true
        };
    }

    if (strongestMatchConfidence == null) {
        return {
            evidence_state: 'Linked Weakly',
            usable_as_evidence: false,
            usability_reason: 'The document is linked to a case, but linkage confidence is unavailable.',
            needs_review: true
        };
    }

    if (strongestMatchConfidence >= 0.85) {
        return {
            evidence_state: 'Usable',
            usable_as_evidence: true,
            usability_reason: 'Parsed successfully and strongly linked to at least one case.',
            needs_review: false
        };
    }

    if (strongestMatchConfidence >= 0.5) {
        return {
            evidence_state: 'Linked Strongly',
            usable_as_evidence: false,
            usability_reason: 'Linked to a case, but still below automatic-use confidence.',
            needs_review: true
        };
    }

    return {
        evidence_state: 'Linked Weakly',
        usable_as_evidence: false,
        usability_reason: 'Linked to a case with weak confidence.',
        needs_review: true
    };
}

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

        const files = (req as any).files as any[];

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

        await ensureEvidenceDocumentsBucket();

        // Extract tenant ID
        const tenantId = (req as any).tenant?.tenantId;

        if (!tenantId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized: Tenant context missing'
            });
        }

        const uploadedDocuments: any[] = [];
        const failedDocuments: Array<{ filename: string; reason: string }> = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const docId = uuidv4();
            const safeStorageFilename = buildSafeStorageFilename(file.originalname);
            // Use index to ensure unique paths even for files with same name
            const storagePath = `${tenantId}/${docId}/${safeStorageFilename}`;

            // Upload to Supabase Storage
            const { error: storageError } = await supabaseAdmin
                .storage
                .from(DOCUMENT_BUCKET_NAME)
                .upload(storagePath, file.buffer, {
                    contentType: file.mimetype,
                    upsert: false
                });

            if (storageError) {
                logger.error('❌ [DOCUMENTS] Storage upload failed', {
                    filename: file.originalname,
                    safeStorageFilename,
                    error: storageError.message
                });
                failedDocuments.push({
                    filename: file.originalname,
                    reason: `Storage upload failed: ${storageError.message}`
                });
                // Continue with other files
                continue;
            }

            // Create database record
            const { error: dbError } = await supabaseAdmin
                .from('evidence_documents')
                .insert({
                    id: docId,
                    user_id: finalUserId,
                    tenant_id: tenantId,
                    seller_id: tenantId, // Use tenantId as seller_id in multi-tenant mode
                    doc_type: 'other',
                    filename: file.originalname,
                    content_type: file.mimetype,
                    mime_type: file.mimetype,
                    size_bytes: file.size,
                    storage_path: storagePath,
                    processing_status: 'pending',
                    parser_status: 'pending',
                    provider: 'other',
                    ingested_at: new Date().toISOString(),
                    metadata: {
                        uploaded_at: new Date().toISOString(),
                        upload_method: 'drag_drop',
                        source: 'upload',
                        provider_label: 'upload',
                        original_filename: file.originalname,
                        safe_storage_filename: safeStorageFilename
                    }
                })
                .select()
                .single();

            if (dbError) {
                logger.error('❌ [DOCUMENTS] Database insert failed', {
                    filename: file.originalname,
                    error: dbError.message
                });
                failedDocuments.push({
                    filename: file.originalname,
                    reason: `Database insert failed: ${dbError.message}`
                });
                // Try to clean up storage
                await supabaseAdmin.storage.from(DOCUMENT_BUCKET_NAME).remove([storagePath]);
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
                safeStorageFilename,
                storagePath
            });
        }

        if (uploadedDocuments.length === 0) {
            logger.warn('⚠️ [DOCUMENTS] Upload completed with zero saved documents', {
                userId,
                tenantId,
                requestedFileCount: files.length,
                failedCount: failedDocuments.length,
                failedDocuments
            });

            return res.status(500).json({
                success: false,
                error: 'No documents were saved',
                message: 'Upload failed before any documents could be stored.',
                documents: [],
                document_ids: [],
                file_count: 0,
                requested_file_count: files.length,
                failed_files: failedDocuments
            });
        }

        const partial = failedDocuments.length > 0;
        const successMessage = partial
            ? `${uploadedDocuments.length} of ${files.length} document(s) uploaded successfully`
            : `${uploadedDocuments.length} document(s) uploaded successfully`;

        // Send SSE event for real-time update
        try {
            const sseHub = (await import('../utils/sseHub')).default;
            sseHub.sendEvent(finalUserId, 'evidence_upload_completed', {
                userId: finalUserId,
                documentIds: uploadedDocuments.map(d => d.id),
                count: uploadedDocuments.length,
                message: successMessage,
                timestamp: new Date().toISOString()
            });
        } catch (sseError) {
            logger.debug('SSE event failed (non-critical)', { error: sseError });
        }

        res.status(partial ? 207 : 200).json({
            success: true,
            partial,
            message: successMessage,
            documents: uploadedDocuments,
            document_ids: uploadedDocuments.map(d => d.id),
            file_count: uploadedDocuments.length,
            requested_file_count: files.length,
            failed_files: failedDocuments
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
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
        const tenantId = (req as any).tenant?.tenantId;

        if (!userId || !tenantId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        // Convert to UUID if needed (handles 'demo-user' -> deterministic UUID)
        const finalUserId = convertUserIdToUuid(userId);

        logger.info('📂 [DOCUMENTS] Fetching documents', { userId, finalUserId, tenantId });

        // Fetch documents from Supabase - scope by tenant_id and current user/seller
        const { data: documents, error } = await supabaseAdmin
            .from('evidence_documents')
            .select('*')
            .eq('tenant_id', tenantId)
            .or(`user_id.eq.${finalUserId},seller_id.eq.${finalUserId},seller_id.eq.${userId}`)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('❌ [DOCUMENTS] Database error fetching documents', { error });
            throw error;
        }

        // Transform to match expected frontend format
        // The frontend expects: id, name, uploadDate, status, supplier, invoice, amount, parsedVia, etc.
        // Worker stores parsed data in: parsed_metadata column (primary) or metadata column (fallback)
        // Also check direct columns (supplier_name, invoice_number, total_amount) for legacy compatibility
        const formattedDocuments = (documents || []).filter(isProductDocument).map(doc => {
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
                name: getDocumentDisplayName(doc),
                uploadDate: doc.created_at,
                status: doc.status || 'uploaded',
                size: doc.size_bytes,
                type: doc.content_type,
                source: doc.provider || (doc.source_id ? 'connected_source' : 'upload'),
                // Parsed fields for table display
                supplier: supplier,
                invoice: invoice,
                amount: amount,
                parsedVia: extractionMethod,
                parser_status: getAuthoritativeParserStatus(doc),
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
 * GET /api/documents/inventory
 * Authoritative Evidence Locker inventory payload
 */
router.get('/inventory', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
        const tenantId = (req as any).tenant?.tenantId;

        if (!userId || !tenantId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        const finalUserId = convertUserIdToUuid(userId);
        const q = String(req.query.q || '').trim().toLowerCase();
        const parserStatus = String(req.query.parserStatus || '').trim().toLowerCase();
        const providerFilter = String(req.query.provider || '').trim().toLowerCase();
        const linkedFilter = String(req.query.linked || '').trim().toLowerCase();
        const sortBy = String(req.query.sortBy || 'created_at');
        const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '10'), 10) || 10));

        logger.info('📚 [DOCUMENTS] Fetching authoritative locker inventory', {
            userId,
            tenantId,
            q,
            parserStatus,
            providerFilter,
            linkedFilter,
            sortBy,
            sortDir,
            page,
            pageSize
        });

        const { data: documents, error } = await supabaseAdmin
            .from('evidence_documents')
            .select('*')
            .eq('tenant_id', tenantId)
            .or(`user_id.eq.${finalUserId},seller_id.eq.${finalUserId},seller_id.eq.${userId}`);

        if (error) {
            throw error;
        }

        const productDocuments = (documents || []).filter(isProductDocument);
        const documentIds = productDocuments.map(doc => doc.id);

        let linksByDocument = new Map<string, any[]>();

        if (documentIds.length > 0) {
            const { data: links, error: linksError } = await supabaseAdmin
                .from('dispute_evidence_links')
                .select(`
                    evidence_document_id,
                    dispute_case_id,
                    relevance_score,
                    matched_context,
                    created_at,
                    dispute_cases!inner(
                        id,
                        case_number,
                        claim_number,
                        tenant_id
                    )
                `)
                .in('evidence_document_id', documentIds);

            if (linksError) {
                logger.warn('⚠️ [DOCUMENTS] Failed to fetch locker linkage data', {
                    tenantId,
                    error: linksError.message
                });
            } else {
                for (const link of links || []) {
                    const disputeCase = (link as any).dispute_cases;
                    if (disputeCase?.tenant_id && disputeCase.tenant_id !== tenantId) {
                        continue;
                    }

                    const documentLinks = linksByDocument.get(link.evidence_document_id) || [];
                    documentLinks.push(link);
                    linksByDocument.set(link.evidence_document_id, documentLinks);
                }
            }
        }

        const allRows = productDocuments.map(doc => {
            const normalized = getNormalizedParsedMetadata(doc);
            const parsingStrategy = normalized.parsedMetadata?.parsing_strategy || null;
            const parsingExplanation = normalized.parsedMetadata?.parsing_explanation || null;
            const ingestionStrategy = normalized.metadata?.ingestion_strategy || null;
            const ingestionExplanation = normalized.metadata?.ingestion_explanation || null;
            const documentLinks = linksByDocument.get(doc.id) || [];
            const strongestMatchConfidence = documentLinks.length > 0
                ? Math.max(...documentLinks.map((link: any) => Number(link.relevance_score || 0)))
                : null;
            const strongestMatchType = documentLinks.length > 0
                ? (() => {
                    const strongest = documentLinks.reduce((best: any, current: any) =>
                        Number(current.relevance_score || 0) > Number(best?.relevance_score || 0) ? current : best,
                        null
                    );
                    let matchedContext = strongest?.matched_context || {};
                    if (typeof matchedContext === 'string') {
                        try {
                            matchedContext = JSON.parse(matchedContext);
                        } catch {
                            matchedContext = {};
                        }
                    }
                    return matchedContext.match_type || null;
                })()
                : null;
            const extractionSignalCount = getExtractionSignalCount(doc, normalized);
            const lockerState = buildLockerState(doc, documentLinks.length, strongestMatchConfidence, extractionSignalCount);
            const sourceDisplay = getSourceDisplay(doc);

            return {
                id: doc.id,
                name: getDocumentDisplayName(doc),
                filename: getDocumentDisplayName(doc),
                original_filename: getStoredOriginalFilename(doc),
                created_at: doc.created_at,
                updated_at: doc.updated_at,
                uploadDate: doc.created_at,
                status: doc.status || 'uploaded',
                processing_status: doc.processing_status || doc.status || 'uploaded',
                parser_status: getAuthoritativeParserStatus(doc),
                parser_confidence: normalized.confidence,
                parser_error: doc.parser_error || null,
                parsing_strategy: parsingStrategy,
                parsing_explanation: parsingExplanation,
                ingestion_strategy: ingestionStrategy,
                ingestion_explanation: ingestionExplanation,
                extraction_signal_count: extractionSignalCount,
                source: doc.source || null,
                provider: doc.provider || null,
                source_display: sourceDisplay,
                content_type: doc.content_type || null,
                size_bytes: doc.size_bytes || null,
                supplier: normalized.supplier,
                invoice: normalized.invoice,
                amount: normalized.amount,
                parsedVia: normalized.extractionMethod,
                parsed_metadata: doc.parsed_metadata || null,
                extracted: doc.extracted || null,
                linked_case_count: documentLinks.length,
                linked_case_ids: documentLinks.map((link: any) => link.dispute_case_id),
                linked_case_refs: documentLinks.map((link: any) => {
                    const disputeCase = (link as any).dispute_cases;
                    return disputeCase?.case_number || disputeCase?.claim_number || link.dispute_case_id;
                }),
                strongest_match_confidence: strongestMatchConfidence,
                strongest_match_type: strongestMatchType,
                linkage_strength: documentLinks.length === 0
                    ? 'none'
                    : (strongestMatchConfidence != null && strongestMatchConfidence >= 0.85 ? 'strong' : 'weak'),
                evidence_state: lockerState.evidence_state,
                usable_as_evidence: lockerState.usable_as_evidence,
                usability_reason: lockerState.usability_reason,
                needs_review: lockerState.needs_review
            };
        });

        let filteredRows = allRows.filter(row => {
            if (parserStatus && row.parser_status?.toLowerCase() !== parserStatus) {
                return false;
            }

            if (providerFilter) {
                const providerCandidate = (row.provider || row.source || row.source_display || '').toLowerCase();
                if (providerCandidate !== providerFilter) {
                    return false;
                }
            }

            if (linkedFilter === 'linked' && row.linked_case_count === 0) {
                return false;
            }

            if (linkedFilter === 'unlinked' && row.linked_case_count > 0) {
                return false;
            }

            if (q) {
                const extracted = row.extracted || {};
                const searchBlob = [
                    row.name,
                    row.original_filename,
                    row.supplier,
                    row.invoice,
                    row.source_display,
                    row.content_type,
                    ...(extracted.order_ids || []),
                    ...(extracted.asins || []),
                    ...(extracted.skus || []),
                    ...(extracted.invoice_numbers || []),
                    ...(extracted.tracking_numbers || []),
                    ...(row.linked_case_refs || [])
                ].filter(Boolean).join(' ').toLowerCase();

                if (!searchBlob.includes(q)) {
                    return false;
                }
            }

            return true;
        });

        const sorter = (a: any, b: any) => {
            let comparison = 0;

            switch (sortBy) {
                case 'name':
                    comparison = String(a.name || '').localeCompare(String(b.name || ''));
                    break;
                case 'parser_status':
                    comparison = String(a.parser_status || '').localeCompare(String(b.parser_status || ''));
                    break;
                case 'linked_case_count':
                    comparison = Number(a.linked_case_count || 0) - Number(b.linked_case_count || 0);
                    break;
                case 'strongest_match_confidence':
                    comparison = Number(a.strongest_match_confidence || 0) - Number(b.strongest_match_confidence || 0);
                    break;
                case 'updated_at':
                    comparison = new Date(a.updated_at || a.created_at).getTime() - new Date(b.updated_at || b.created_at).getTime();
                    break;
                case 'created_at':
                default:
                    comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                    break;
            }

            return sortDir === 'asc' ? comparison : -comparison;
        };

        filteredRows = [...filteredRows].sort(sorter);

        const totalDocuments = allRows.length;
        const filteredResults = filteredRows.length;
        const totalPages = Math.max(1, Math.ceil(filteredResults / pageSize));
        const safePage = Math.min(page, totalPages);
        const pageStart = (safePage - 1) * pageSize;
        const pageRows = filteredRows.slice(pageStart, pageStart + pageSize);

        const recentAuditDocIds = filteredRows.slice(0, Math.min(filteredRows.length, 25)).map(row => row.id);
        const auditTrails = await Promise.all(
            recentAuditDocIds.map(documentId => evidenceAuditService.getDocumentAuditTrail(documentId, tenantId))
        );
        const recentEvents = auditTrails
            .filter(Boolean)
            .flatMap((trail: any) => trail.events.map((event: any) => ({
                id: event.id,
                documentId: trail.documentId,
                filename: trail.filename,
                eventType: event.eventType,
                timestamp: event.timestamp,
                narrative: event.narrative
            })))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 50);

        res.json({
            success: true,
            documents: pageRows,
            metrics: {
                totalDocuments,
                filteredResults,
                parsed: filteredRows.filter(row => ['completed', 'partial'].includes(String(row.parser_status || '').toLowerCase())).length,
                matched: filteredRows.filter(row => row.linked_case_count > 0).length,
                failed: filteredRows.filter(row => row.parser_status === 'failed').length,
                needsReview: filteredRows.filter(row => row.needs_review).length
            },
            pagination: {
                page: safePage,
                pageSize,
                totalPages,
                totalResults: filteredResults
            },
            recentEvents
        });
    } catch (error: any) {
        logger.error('❌ [DOCUMENTS] Error fetching locker inventory', {
            error: error?.message || String(error),
            stack: error?.stack
        });

        res.status(500).json({
            success: false,
            error: 'Failed to fetch document inventory',
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
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
        const tenantId = (req as any).tenant?.tenantId;
        const docId = req.params.id;

        if (!userId || !tenantId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        const { data: doc, error } = await supabaseAdmin
            .from('evidence_documents')
            .select('*')
            .eq('id', docId)
            .eq('tenant_id', tenantId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // Log unauthorized access attempt
                const { data: otherDoc } = await supabaseAdmin
                    .from('evidence_documents')
                    .select('id, tenant_id')
                    .eq('id', docId)
                    .single();

                if (otherDoc) {
                    logger.warn('⚠️ [SECURITY] Unauthorized document detail access attempt', {
                        docId,
                        requestingTenantId: tenantId,
                        ownerTenantId: otherDoc.tenant_id,
                        userId
                    });
                }
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
            name: getDocumentDisplayName(doc),
            filename: getDocumentDisplayName(doc),
            original_filename: getStoredOriginalFilename(doc),
            uploadDate: doc.created_at,
            created_at: doc.created_at,
            updated_at: doc.updated_at,
            status: doc.status || 'uploaded',
            processing_status: doc.processing_status || doc.status || 'uploaded',
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
            parser_status: getAuthoritativeParserStatus(doc),
            parser_confidence: parsedMetadata.confidence_score || doc.parser_confidence || nestedParsedData.confidence_score || null,
            parser_error: doc.parser_error || null,
            parsing_strategy: parsedMetadata.parsing_strategy || nestedParsedData.parsing_strategy || null,
            parsing_explanation: parsedMetadata.parsing_explanation || nestedParsedData.parsing_explanation || null,
            ingestion_strategy: metadata.ingestion_strategy || null,
            ingestion_explanation: metadata.ingestion_explanation || null,
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
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
        const tenantId = (req as any).tenant?.tenantId;
        const docId = req.params.id;

        if (!userId || !tenantId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        // Get document metadata first to get storage path
        const { data: doc, error: dbError } = await supabaseAdmin
            .from('evidence_documents')
            .select('storage_path, filename, tenant_id')
            .eq('id', docId)
            .eq('tenant_id', tenantId)
            .single();

        if (dbError || !doc) {
            if (dbError?.code === 'PGRST116') {
                // Log unauthorized download attempt
                const { data: otherDoc } = await supabaseAdmin
                    .from('evidence_documents')
                    .select('id, tenant_id')
                    .eq('id', docId)
                    .single();

                if (otherDoc) {
                    logger.warn('⚠️ [SECURITY] Unauthorized document download attempt', {
                        docId,
                        requestingTenantId: tenantId,
                        ownerTenantId: otherDoc.tenant_id,
                        userId
                    });
                }
            }
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
        const tenantId = (req as any).tenant?.tenantId;
        const docId = req.params.id;
        const finalUserId = convertUserIdToUuid(userId);

        if (!tenantId) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        logger.info('🔄 [DOCUMENTS] Re-parse request', { docId, userId, tenantId });

        const { data: existingDoc, error: existingDocError } = await supabaseAdmin
            .from('evidence_documents')
            .select('id, storage_path, content_type')
            .eq('id', docId)
            .eq('tenant_id', tenantId)
            .single();

        if (existingDocError || !existingDoc) {
            return res.status(404).json({
                success: false,
                error: 'Document not found'
            });
        }

        // Reset parser_status to pending
        const { error: updateError } = await supabaseAdmin
            .from('evidence_documents')
            .update({
                parser_status: 'pending',
                parser_error: null,
                parser_started_at: null,
                parser_completed_at: null,
                parsed_metadata: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', docId)
            .eq('tenant_id', tenantId);

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
            if (existingDoc.storage_path && existingDoc.content_type?.includes('pdf')) {
                // Download file from Supabase Storage
                const { data: fileData, error: downloadError } = await supabaseAdmin
                    .storage
                    .from('evidence-documents')
                    .download(existingDoc.storage_path);

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
