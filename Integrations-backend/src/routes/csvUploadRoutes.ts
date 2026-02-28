/**
 * CSV Upload Routes
 * 
 * API endpoints for uploading CSV files to ingest seller data into the system.
 * This is the "things that don't scale" approach — manual CSV upload as data source
 * until SP-API access is granted.
 * 
 * Endpoints:
 *   POST /api/csv-upload/ingest           — Upload CSV files (auto-detect type)
 *   POST /api/csv-upload/ingest/:type     — Upload CSV files (explicit type)
 *   GET  /api/csv-upload/supported-types  — List supported CSV types + expected headers
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import logger from '../utils/logger';
import { csvIngestionService, CSVType } from '../services/csvIngestionService';

const router = Router();

// Multer config: memory storage, 50MB limit, CSV files only
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB per file
        files: 10, // Max 10 files per upload
    },
    fileFilter: (_req, file, cb) => {
        const allowedMimes = ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'];
        const allowedExtensions = ['.csv', '.txt', '.tsv'];
        const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

        if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype} (${file.originalname}). Only CSV files are accepted.`));
        }
    },
});

// ============================================================================
// POST /api/csv-upload/ingest — Upload and ingest CSV files (auto-detect type)
// ============================================================================

router.post('/ingest', upload.array('files', 10), async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID is required. Include X-User-Id header or authenticate via session.',
            });
        }

        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded. Send one or more CSV files using the "files" field.',
                hint: 'Use multipart/form-data with field name "files"',
            });
        }

        logger.info('📤 [CSV UPLOAD] Received upload request', {
            userId,
            fileCount: files.length,
            fileNames: files.map(f => f.originalname),
            fileSizes: files.map(f => `${(f.size / 1024).toFixed(1)}KB`),
        });

        const triggerDetection = req.query.detect !== 'false' && req.body?.detect !== 'false';
        const storeId = req.headers['x-store-id'] as string | undefined;

        const result = await csvIngestionService.ingestFiles(userId, files, {
            triggerDetection,
            storeId,
        });

        const statusCode = result.success ? 200 : 207; // 207 Multi-Status if partial
        return res.status(statusCode).json(result);
    } catch (error: any) {
        logger.error('❌ [CSV UPLOAD] Upload request failed', { error: error.message });

        if (error.message?.includes('Unsupported file type')) {
            return res.status(400).json({ success: false, error: error.message });
        }

        return res.status(500).json({
            success: false,
            error: 'CSV upload failed',
            details: error.message,
        });
    }
});

// ============================================================================
// POST /api/csv-upload/ingest/:type — Upload CSV with explicit type
// ============================================================================

const VALID_TYPES: CSVType[] = ['orders', 'shipments', 'returns', 'settlements', 'inventory', 'financial_events', 'fees'];

router.post('/ingest/:type', upload.array('files', 10), async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID is required. Include X-User-Id header or authenticate via session.',
            });
        }

        const csvType = req.params.type as CSVType;
        if (!VALID_TYPES.includes(csvType)) {
            return res.status(400).json({
                success: false,
                error: `Invalid CSV type: "${csvType}". Valid types: ${VALID_TYPES.join(', ')}`,
            });
        }

        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded. Send one or more CSV files using the "files" field.',
            });
        }

        logger.info('📤 [CSV UPLOAD] Received typed upload request', {
            userId,
            csvType,
            fileCount: files.length,
            fileNames: files.map(f => f.originalname),
        });

        const triggerDetection = req.query.detect !== 'false' && req.body?.detect !== 'false';
        const storeId = req.headers['x-store-id'] as string | undefined;

        const result = await csvIngestionService.ingestFiles(userId, files, {
            explicitType: csvType,
            triggerDetection,
            storeId,
        });

        const statusCode = result.success ? 200 : 207;
        return res.status(statusCode).json(result);
    } catch (error: any) {
        logger.error('❌ [CSV UPLOAD] Typed upload request failed', {
            error: error.message,
            type: req.params.type,
        });

        return res.status(500).json({
            success: false,
            error: 'CSV upload failed',
            details: error.message,
        });
    }
});

// ============================================================================
// GET /api/csv-upload/supported-types — List supported CSV formats
// ============================================================================

router.get('/supported-types', (_req: Request, res: Response) => {
    const types = csvIngestionService.getSupportedTypes();

    return res.json({
        success: true,
        supportedTypes: types,
        usage: {
            autoDetect: {
                method: 'POST',
                endpoint: '/api/csv-upload/ingest',
                description: 'Upload CSV files and let the system auto-detect the type from column headers',
                example: 'curl -X POST /api/csv-upload/ingest -F "files=@orders.csv" -H "X-User-Id: your-user-id"',
            },
            explicitType: {
                method: 'POST',
                endpoint: '/api/csv-upload/ingest/:type',
                description: 'Upload CSV files with an explicit type',
                example: 'curl -X POST /api/csv-upload/ingest/orders -F "files=@orders.csv" -H "X-User-Id: your-user-id"',
            },
            options: {
                detect: 'Set query param ?detect=false to skip triggering detection after upload',
                storeId: 'Set X-Store-Id header to associate data with a specific store',
            },
        },
    });
});

export default router;
