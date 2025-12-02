import { Router, Request, Response } from 'express';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
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

        // Allow demo-user for development
        const finalUserId = userId === 'demo-user' ? 'demo-user' : userId;

        logger.info('📂 [DOCUMENTS] Fetching documents', { userId: finalUserId });

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

        // Transform to match expected frontend format if needed
        // The frontend expects: id, name, uploadDate, status, etc.
        const formattedDocuments = documents.map(doc => ({
            id: doc.id,
            name: doc.filename,
            uploadDate: doc.created_at,
            status: doc.status || 'uploaded',
            size: doc.size_bytes,
            type: doc.content_type,
            source: doc.source_id ? 'gmail' : 'upload', // Simplified source detection
            metadata: doc.metadata
        }));

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
            .eq('user_id', userId)
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
            .eq('user_id', userId)
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
