import { Router } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import enhancedDetectionService from '../services/enhancedDetectionService';
import detectionService from '../services/detectionService';
import csvIngestionService, { CsvUploadRunSnapshot } from '../services/csvIngestionService';
import { timelineService } from '../services/timelineService';
import { enrichDetectionFinding } from '../services/detectionFindingTruthService';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const router = Router();

const getDetectionRollupValue = (row: any): number => {
  const countedValue = row?.evidence?.economic_rollup?.counted_value;
  return typeof countedValue === 'number' && Number.isFinite(countedValue)
    ? countedValue
    : Number(row?.estimated_value || 0);
};

type DetectionQueueStatusRow = {
  id?: string | null;
  sync_id?: string | null;
  status?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
  error_message?: string | null;
  payload?: Record<string, any> | null;
};

const getDetectionQueueSandboxFlag = (row: DetectionQueueStatusRow | null): boolean => {
  if (!row?.payload || typeof row.payload !== 'object') {
    return false;
  }

  return !!(row.payload.is_sandbox ?? row.payload.isSandbox);
};

const statusPriority = (status?: string | null): number => {
  switch (status) {
    case 'failed':
      return 4;
    case 'completed':
      return 3;
    case 'processing':
      return 2;
    case 'pending':
      return 1;
    default:
      return 0;
  }
};

const compareIsoDesc = (left?: string | null, right?: string | null): number => {
  const leftMs = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightMs = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;

  if (Number.isNaN(leftMs) && Number.isNaN(rightMs)) return 0;
  if (Number.isNaN(leftMs)) return 1;
  if (Number.isNaN(rightMs)) return -1;
  return rightMs - leftMs;
};

const selectAuthoritativeQueueRow = (
  rows: DetectionQueueStatusRow[] | null | undefined
): DetectionQueueStatusRow | null => {
  if (!rows?.length) return null;

  return [...rows].sort((left, right) => {
    const terminalDiff = statusPriority(right.status) - statusPriority(left.status);
    if (terminalDiff !== 0) return terminalDiff;

    const processedDiff = compareIsoDesc(left.processed_at, right.processed_at);
    if (processedDiff !== 0) return processedDiff;

    const createdDiff = compareIsoDesc(left.created_at, right.created_at);
    if (createdDiff !== 0) return createdDiff;

    const leftId = left.id || '';
    const rightId = right.id || '';
    return rightId.localeCompare(leftId);
  })[0];
};

const mapCsvRunStatusToDetectionStatus = (
  status?: CsvUploadRunSnapshot['status']
): 'pending' | 'processing' | 'completed' | 'failed' => {
  switch (status) {
    case 'failed':
      return 'failed';
    case 'detection_processing':
      return 'processing';
    case 'completed':
    case 'partial':
      return 'completed';
    case 'started':
    default:
      return 'pending';
  }
};

const buildCsvRunDetectionMeta = (run: CsvUploadRunSnapshot | null) => {
  if (!run) return null;

  return {
    status: mapCsvRunStatusToDetectionStatus(run.status),
    processedAt: run.completedAt || run.detection?.processedAt || null,
    errorMessage: run.error || run.detection?.errorMessage || null,
    isSandbox: run.isSandbox || run.detection?.isSandbox || false,
  };
};

const shouldPreferCsvRunMeta = (
  queueRow: DetectionQueueStatusRow | null,
  csvMeta: ReturnType<typeof buildCsvRunDetectionMeta>
): boolean => {
  if (!csvMeta) return false;
  if (!queueRow) return true;

  if (statusPriority(csvMeta.status) > statusPriority(queueRow.status)) {
    return true;
  }

  if ((queueRow.status === 'pending' || queueRow.status === 'processing') && csvMeta.status === 'completed') {
    return true;
  }

  if (!queueRow.processed_at && !!csvMeta.processedAt) {
    return true;
  }

  if (queueRow.status !== 'failed' && csvMeta.status === 'failed') {
    return true;
  }

  return false;
};

const hasExplicitTenantSignal = (req: AuthenticatedRequest): boolean => {
  const requestLike = req as any;
  const headerTenantId = requestLike.headers?.['x-tenant-id'];
  const queryTenantSlug = requestLike.query?.tenantSlug;
  const fullPath = requestLike.originalUrl?.split('?')[0] || requestLike.path;
  const pathTenantMatch = /^\/app\/[^/]+/.test(fullPath);

  return Boolean(
    (typeof headerTenantId === 'string' && headerTenantId.trim()) ||
    (typeof queryTenantSlug === 'string' && queryTenantSlug.trim()) ||
    pathTenantMatch
  );
};

// Auth middleware - allows both JWT tokens, service role key, and userIdMiddleware
router.use(async (req, res, next) => {
  try {
    // Try userIdMiddleware first (for testing and frontend compatibility)
    const { userIdMiddleware } = await import('../middleware/userIdMiddleware');
    userIdMiddleware(req as any, res as any, () => {
      // If userIdMiddleware set userId, continue; otherwise try auth
      if ((req as any).userId) {
        return next();
      }
      // Fallback to JWT auth
      authenticateToken(req as any, res as any, next).catch(() => {
        // If both fail, still continue (userIdMiddleware sets demo-user)
        next();
      });
    });
  } catch (error) {
    // If all fails, continue anyway (userIdMiddleware should have set demo-user)
    next();
  }
});

// POST /api/v1/integrations/detections/run
router.post('/run', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const { syncId, triggerType = 'inventory', metadata } = ((req as any).body || {}) as any;
    if (!syncId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'syncId is required' } });
    }
    await enhancedDetectionService.triggerDetectionPipeline(userId, syncId, triggerType, metadata);
    return res.json({ success: true, job: { sync_id: syncId, trigger_type: triggerType } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/detections/results
// Get all detection results for the authenticated user
router.get('/results', async (req: AuthenticatedRequest, res) => {
  try {
    // Support both authenticated user and userIdMiddleware
    const userId = (req as any).userId || req.user?.id as string;
    const tenantId = (req as any).tenant?.tenantId as string | undefined;
    if (!userId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User ID is required' } });
    }
    if (!tenantId) {
      return res.status(400).json({ success: false, error: { code: 'TENANT_REQUIRED', message: 'Tenant context is required for detection results.' } });
    }
    if (!hasExplicitTenantSignal(req)) {
      return res.status(400).json({ success: false, error: { code: 'TENANT_REQUIRED', message: 'Explicit tenant context is required for detection results.' } });
    }
    const { status, syncId, sourceType, limit = 100, offset = 0 } = (req as any).query;
    const filteredSyncId = typeof syncId === 'string' && syncId.trim() ? syncId.trim() : undefined;
    const filteredSourceType = typeof sourceType === 'string' && ['sp_api', 'csv_upload', 'unknown'].includes(sourceType)
      ? (sourceType as 'sp_api' | 'csv_upload' | 'unknown')
      : undefined;
    const results = await detectionService.getDetectionResults(
      userId,
      filteredSyncId,
      status,
      filteredSourceType,
      parseInt(limit as string, 10),
      parseInt(offset as string, 10),
      tenantId
    );
    const total = await detectionService.getDetectionResultsTotal(
      userId,
      filteredSyncId,
      status,
      filteredSourceType,
      tenantId
    );

    // Enhance results with durable document counts, filing movement, and seller-facing truth.
    const { supabase, supabaseAdmin } = await import('../database/supabaseClient');
    const detectionIds = results.map((r: any) => r.id);
    let linkedCaseByDetectionId = new Map<string, any>();

    if (detectionIds.length > 0) {
      // Get document counts for all detections in one query
      const { data: links } = await supabase
        .from('dispute_evidence_links')
        .select('claim_id, document_id')
        .in('claim_id', detectionIds);

      // Count documents per claim
      const docCounts: Record<string, number> = {};
      (links || []).forEach((link: any) => {
        docCounts[link.claim_id] = (docCounts[link.claim_id] || 0) + 1;
      });

      // Add counts to results
      results.forEach((r: any) => {
        r.matched_document_ids = r.matched_document_ids || [];
        r.matched_document_count = docCounts[r.id] || r.matched_document_ids?.length || 0;
      });

      const { data: linkedCases, error: linkedCasesError } = await supabaseAdmin
        .from('dispute_cases')
        .select('id, detection_result_id, case_number, status, filing_status, case_state, eligibility_status, block_reasons, amazon_case_id, provider_case_id, recovery_status, submission_date, approved_amount, resolution_amount, updated_at, created_at')
        .eq('tenant_id', tenantId)
        .in('detection_result_id', detectionIds)
        .order('updated_at', { ascending: false });

      if (linkedCasesError) {
        console.warn('[DETECTIONS] Failed to load linked filing movement truth', {
          tenantId,
          error: linkedCasesError.message
        });
      } else {
        linkedCaseByDetectionId = new Map<string, any>();
        for (const linkedCase of linkedCases || []) {
          const detectionId = linkedCase?.detection_result_id;
          if (detectionId && !linkedCaseByDetectionId.has(detectionId)) {
            linkedCaseByDetectionId.set(detectionId, linkedCase);
          }
        }
      }
    }

    let meta: any = undefined;
    if (filteredSyncId) {
      const { supabaseAdmin } = await import('../database/supabaseClient');
      const { data: queueRows } = await supabaseAdmin
        .from('detection_queue')
        .select('id, sync_id, status, processed_at, created_at, error_message, payload')
        .eq('seller_id', userId)
        .eq('sync_id', filteredSyncId)
        .order('created_at', { ascending: false })
        .limit(10);

      const queueRow = selectAuthoritativeQueueRow(queueRows as DetectionQueueStatusRow[] | null | undefined);
      const csvRun = filteredSyncId.startsWith('csv_')
        ? await csvIngestionService.getCsvUploadRunBySyncId(userId, tenantId, filteredSyncId)
        : null;
      const csvMeta = buildCsvRunDetectionMeta(csvRun);
      const preferredCsvMeta = shouldPreferCsvRunMeta(queueRow, csvMeta) ? csvMeta : null;

      meta = {
        syncId: filteredSyncId,
        status: preferredCsvMeta?.status || queueRow?.status || (total > 0 ? 'completed' : 'pending'),
        processedAt: preferredCsvMeta?.processedAt || queueRow?.processed_at || null,
        errorMessage: preferredCsvMeta?.errorMessage || queueRow?.error_message || null,
        isSandbox: preferredCsvMeta?.isSandbox || getDetectionQueueSandboxFlag(queueRow),
      };
    }

    const enrichedResults = results.map((row: any) =>
      enrichDetectionFinding(row, linkedCaseByDetectionId.get(row.id))
    );

    return res.json({ success: true, results: enrichedResults, total, meta });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/detections/status/:syncId
router.get('/status/:syncId', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = (req as any).userId || req.user?.id as string;
    const tenantId = (req as any).tenant?.tenantId as string | undefined;
    const { syncId } = (req as any).params;
    if (!userId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User ID is required' } });
    }
    if (!tenantId) {
      return res.status(400).json({ success: false, error: { code: 'TENANT_REQUIRED', message: 'Tenant context is required for detection status.' } });
    }
    if (!hasExplicitTenantSignal(req)) {
      return res.status(400).json({ success: false, error: { code: 'TENANT_REQUIRED', message: 'Explicit tenant context is required for detection status.' } });
    }

    const { supabaseAdmin } = await import('../database/supabaseClient');
    const { data: queueRows } = await supabaseAdmin
      .from('detection_queue')
      .select('id, sync_id, status, processed_at, created_at, error_message, payload')
      .eq('seller_id', userId)
      .eq('sync_id', syncId)
      .order('created_at', { ascending: false })
      .limit(10);

    const queueRow = selectAuthoritativeQueueRow(queueRows as DetectionQueueStatusRow[] | null | undefined);
    const csvRun = syncId.startsWith('csv_')
      ? await csvIngestionService.getCsvUploadRunBySyncId(userId, tenantId, syncId)
      : null;
    const csvMeta = buildCsvRunDetectionMeta(csvRun);
    const preferredCsvMeta = shouldPreferCsvRunMeta(queueRow, csvMeta) ? csvMeta : null;

    const claimsFound = await detectionService.getDetectionResultsTotal(userId, syncId, undefined, undefined, tenantId);
    const results = claimsFound > 0
      ? await detectionService.getDetectionResults(userId, syncId, undefined, undefined, 500, 0, tenantId)
      : [];
    const estimatedRecovery = results.reduce((sum: number, row: any) => sum + getDetectionRollupValue(row), 0);

    return res.json({
      success: true,
      sync_id: syncId,
      status: preferredCsvMeta?.status || queueRow?.status || (claimsFound > 0 ? 'completed' : 'pending'),
      processed_at: preferredCsvMeta?.processedAt || queueRow?.processed_at || null,
      error_message: preferredCsvMeta?.errorMessage || queueRow?.error_message || null,
      is_sandbox: preferredCsvMeta?.isSandbox || getDetectionQueueSandboxFlag(queueRow),
      results: {
        claimsFound,
        estimatedRecovery,
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/detections/deadlines
// Get claims approaching deadline (Discovery Agent - 60-day deadline tracking)
router.get('/deadlines', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const daysThreshold = parseInt((req as any).query.days || '7', 10);
    const claims = await detectionService.getClaimsApproachingDeadline(userId, daysThreshold);
    return res.json({
      success: true,
      claims,
      count: claims.length,
      threshold_days: daysThreshold
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/detections/statistics
// Get detection statistics including confidence distribution and recovery rates
router.get('/statistics', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = (req as any).userId || req.user?.id as string;
    const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;
    const stats = await detectionService.getDetectionStatistics(userId, tenantId);
    return res.json({ success: true, statistics: stats });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/detections/confidence-distribution
// Get confidence score distribution for monitoring and calibration
router.get('/confidence-distribution', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = (req as any).userId || req.user?.id as string;
    const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;
    const distribution = await detectionService.getConfidenceDistribution(userId, tenantId);
    return res.json({ success: true, distribution });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// PUT /api/v1/integrations/detections/:id/resolve
// Resolve a detection result (mark as resolved)
router.put('/:id/resolve', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = (req as any).userId || req.user?.id as string;
    const { id } = (req as any).params;
    const { notes, resolution_amount } = (req as any).body || {};

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Detection result ID is required' }
      });
    }

    const result = await detectionService.resolveDetectionResult(userId, id, notes, resolution_amount);

    // Log resolution event to timeline
    await timelineService.logResolution(id, resolution_amount, notes, 'detection_results');

    return res.json({
      success: true,
      message: 'Detection result resolved successfully',
      detection: result
    });
  } catch (error: any) {
    if (error.message === 'Detection result not found') {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message }
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' }
    });
  }
});

// PUT /api/v1/integrations/detections/:id/status
// Update detection result status (generic status update)
router.put('/:id/status', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = (req as any).userId || req.user?.id as string;
    const { id } = (req as any).params;
    const { status, notes } = (req as any).body || {};

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Detection result ID is required' }
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Status is required' }
      });
    }

    const validStatuses = ['pending', 'reviewed', 'disputed', 'resolved'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Status must be one of: ${validStatuses.join(', ')}` }
      });
    }

    const result = await detectionService.updateDetectionResultStatus(userId, id, status, notes);

    // Log status change event to timeline
    await timelineService.logStatusChange(id, 'previous', status, notes, 'detection_results');

    return res.json({
      success: true,
      message: 'Detection result status updated successfully',
      detection: result
    });
  } catch (error: any) {
    if (error.message === 'Detection result not found') {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message }
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' }
    });
  }
});

export default router;


