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
import { isRealDatabaseConfigured } from '../database/supabaseClient';
import { requireActiveTenant } from '../middleware/tenantMiddleware';
import capacityGovernanceService from '../services/capacityGovernanceService';
import operationalControlService from '../services/operationalControlService';
import runtimeCapacityService from '../services/runtimeCapacityService';

const router = Router();
const CSV_UPLOAD_BREAKER_BYPASS = ['filing-auto-dispatch'] as const;

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

router.post('/ingest', requireActiveTenant, upload.array('files', 10), async (req: Request, res: Response) => {
    try {
        if (!isRealDatabaseConfigured) {
            return res.status(503).json({
                success: false,
                error: 'CSV upload disabled: real database is not configured.',
            });
        }

        const userId = (req as any).userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authenticated app user is required for CSV ingestion.',
            });
        }

        if (!(await operationalControlService.isEnabled('new_ingestion', true))) {
            runtimeCapacityService.setCircuitBreaker('new-ingestion', 'open', 'operator_disabled');
            return res.status(503).json({
                success: false,
                error: 'New ingestion is temporarily paused by operator control.',
            });
        }
        runtimeCapacityService.setCircuitBreaker('new-ingestion', 'closed', null);

        const tenantId = (req as any).tenant?.tenantId as string | undefined;
        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Tenant context is required for CSV ingestion.',
            });
        }

        const admissionDecision = await capacityGovernanceService.getIntakeAdmissionDecision(tenantId, {
            ignoreCircuitBreakers: [...CSV_UPLOAD_BREAKER_BYPASS],
        });
        if (!admissionDecision.allowed) {
            runtimeCapacityService.setCircuitBreaker('new-ingestion', 'open', admissionDecision.reason || 'capacity_blocked');
            return res.status(429).json({
                success: false,
                error: 'CSV ingestion temporarily paused due to downstream backlog.',
                reason: admissionDecision.reason,
                metrics: admissionDecision.metrics,
            });
        }
        if (runtimeCapacityService.getSnapshot().circuitBreakers.some((breaker) => breaker.breakerName === 'filing-auto-dispatch' && breaker.state === 'open')) {
            logger.warn('⚠️ [CSV UPLOAD] Filing breaker is open, but manual CSV ingestion is proceeding for detection/dashboard proof.', {
                tenantId,
                userId,
                ignoredBreaker: 'filing-auto-dispatch',
            });
        }
        runtimeCapacityService.setCircuitBreaker('new-ingestion', 'closed', null);

        const files = (req.files || []) as { buffer: Buffer; originalname: string; size: number; mimetype: string }[];
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
            tenantId,
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

const VALID_TYPES: CSVType[] = ['orders', 'shipments', 'returns', 'settlements', 'inventory', 'financial_events', 'fees', 'transfers'];

router.post('/ingest/:type', requireActiveTenant, upload.array('files', 10), async (req: Request, res: Response) => {
    try {
        if (!isRealDatabaseConfigured) {
            return res.status(503).json({
                success: false,
                error: 'CSV upload disabled: real database is not configured.',
            });
        }

        const userId = (req as any).userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authenticated app user is required for CSV ingestion.',
            });
        }

        if (!(await operationalControlService.isEnabled('new_ingestion', true))) {
            runtimeCapacityService.setCircuitBreaker('new-ingestion', 'open', 'operator_disabled');
            return res.status(503).json({
                success: false,
                error: 'New ingestion is temporarily paused by operator control.',
            });
        }
        runtimeCapacityService.setCircuitBreaker('new-ingestion', 'closed', null);

        const tenantId = (req as any).tenant?.tenantId as string | undefined;
        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Tenant context is required for CSV ingestion.',
            });
        }

        const admissionDecision = await capacityGovernanceService.getIntakeAdmissionDecision(tenantId, {
            ignoreCircuitBreakers: [...CSV_UPLOAD_BREAKER_BYPASS],
        });
        if (!admissionDecision.allowed) {
            runtimeCapacityService.setCircuitBreaker('new-ingestion', 'open', admissionDecision.reason || 'capacity_blocked');
            return res.status(429).json({
                success: false,
                error: 'CSV ingestion temporarily paused due to downstream backlog.',
                reason: admissionDecision.reason,
                metrics: admissionDecision.metrics,
            });
        }
        if (runtimeCapacityService.getSnapshot().circuitBreakers.some((breaker) => breaker.breakerName === 'filing-auto-dispatch' && breaker.state === 'open')) {
            logger.warn('⚠️ [CSV UPLOAD] Filing breaker is open, but typed CSV ingestion is proceeding for detection/dashboard proof.', {
                tenantId,
                userId,
                ignoredBreaker: 'filing-auto-dispatch',
                csvType: req.params.type,
            });
        }
        runtimeCapacityService.setCircuitBreaker('new-ingestion', 'closed', null);

        const csvType = req.params.type as CSVType;
        if (!VALID_TYPES.includes(csvType)) {
            return res.status(400).json({
                success: false,
                error: `Invalid CSV type: "${csvType}". Valid types: ${VALID_TYPES.join(', ')}`,
            });
        }

        const files = (req.files || []) as { buffer: Buffer; originalname: string; size: number; mimetype: string }[];
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
            tenantId,
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
// GET /api/csv-upload/latest-run — Restore the latest CSV run for this tenant/user
// ============================================================================

router.get('/latest-run', requireActiveTenant, async (req: Request, res: Response) => {
    try {
        if (!isRealDatabaseConfigured) {
            return res.status(503).json({
                success: false,
                error: 'CSV upload refresh recovery is disabled: real database is not configured.',
            });
        }

        const userId = (req as any).userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authenticated app user is required for CSV refresh recovery.',
            });
        }

        const tenantId = (req as any).tenant?.tenantId as string | undefined;
        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Tenant context is required for CSV refresh recovery.',
            });
        }

        const run = await csvIngestionService.getLatestCsvUploadRun(userId, tenantId);

        return res.json({
            success: true,
            run,
        });
    } catch (error: any) {
        logger.error('❌ [CSV UPLOAD] Failed to restore latest CSV run', {
            error: error.message,
        });

        return res.status(500).json({
            success: false,
            error: 'CSV refresh recovery failed',
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
                example: 'curl -X POST /api/csv-upload/ingest -F "files=@orders.csv" -H "Authorization: Bearer <access-token>"',
            },
            explicitType: {
                method: 'POST',
                endpoint: '/api/csv-upload/ingest/:type',
                description: 'Upload CSV files with an explicit type',
                example: 'curl -X POST /api/csv-upload/ingest/orders -F "files=@orders.csv" -H "Authorization: Bearer <access-token>"',
            },
            options: {
                detect: 'Set query param ?detect=false to skip triggering detection after upload',
                storeId: 'Set X-Store-Id header to associate data with a specific store',
            },
        },
    });
});

export default router;
