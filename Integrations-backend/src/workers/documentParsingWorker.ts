/**
 * Document Parsing Worker
 * Automated background worker for continuous document parsing
 * Runs every 2 minutes, processes documents with parser_status = 'pending'
 * Wraps Python API parser with retry logic and error handling
 * 
 * MULTI-TENANT: Uses tenant-scoped queries for data isolation
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import { createTenantScopedQueryById } from '../database/tenantScopedClient';
import documentParsingService, { DocumentParsingOutcome, ParsedDocumentData } from '../services/documentParsingService';
import sseHub from '../utils/sseHub';
import workerContinuationService from '../services/workerContinuationService';
import runtimeCapacityService from '../services/runtimeCapacityService';
import { buildOperationalDecision } from '../utils/operationalContinuity';

function isUuid(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

// Retry logic with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(`🔄 [DOCUMENT PARSING] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
          error: error.message,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export interface ParsingStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export class DocumentParsingWorker {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private isRunning: boolean = false;
  private isProcessingRun: boolean = false;
  private schedule: string = '*/2 * * * *'; // Every 2 minutes
  // Track documents that have already failed to prevent re-processing
  private failedDocIds: Set<string> = new Set();
  private readonly MAX_FAILED_CACHE = 1000;
  private readonly MAX_PROCESSING_AGE_MS = 15 * 60 * 1000;
  private readonly workerName = 'document-parsing';
  private static readonly BATCH_SIZE = Number(process.env.DOCUMENT_PARSING_BATCH_SIZE || '75');
  private tenantRotationOffset: number = 0;

  constructor() {
    // Initialize
  }

  private rotateTenants<T>(tenants: T[]): T[] {
    if (tenants.length <= 1) return tenants;
    const offset = this.tenantRotationOffset % tenants.length;
    this.tenantRotationOffset = (this.tenantRotationOffset + 1) % tenants.length;
    return [...tenants.slice(offset), ...tenants.slice(0, offset)];
  }

  /**
   * Start the document parsing worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Document parsing worker is already running');
      return;
    }

    logger.info('🚀 [DOCUMENT PARSING WORKER] Starting document parsing worker', {
      schedule: this.schedule
    });

    this.isRunning = true;

    // Schedule main parsing job
    const task = cron.schedule(this.schedule, async () => {
      if (this.isProcessingRun) {
        runtimeCapacityService.recordWorkerSkip(this.workerName, 'previous_document_parsing_run_still_in_progress');
        logger.debug('⏸️ [DOCUMENT PARSING WORKER] Previous run still in progress, skipping');
        return;
      }

      this.isProcessingRun = true;
      try {
        await this.runDocumentParsingForAllTenants();
      } finally {
        this.isProcessingRun = false;
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.set('document-parsing', task);

    logger.info('✅ [DOCUMENT PARSING WORKER] Document parsing worker started successfully', {
      schedule: this.schedule
    });
  }

  /**
   * Stop the document parsing worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Document parsing worker is not running');
      return;
    }

    logger.info('🛑 [DOCUMENT PARSING WORKER] Stopping document parsing worker');

    for (const [name, task] of this.jobs.entries()) {
      task.stop();
      logger.info(`Stopped document parsing job: ${name}`);
    }

    this.jobs.clear();
    this.isRunning = false;

    logger.info('✅ [DOCUMENT PARSING WORKER] Document parsing worker stopped');
  }

  /**
   * Run document parsing for all tenants
   * MULTI-TENANT: Iterates through each tenant first, then processes documents per tenant
   */
  private async runDocumentParsingForAllTenants(): Promise<void> {
    const runStartTime = Date.now();

    try {
      runtimeCapacityService.recordWorkerStart(this.workerName);
      logger.info('🔍 [DOCUMENT PARSING WORKER] Starting scheduled document parsing', {
        timestamp: new Date().toISOString()
      });

      // MULTI-TENANT: Get all active tenants first
      const { data: tenants, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('id, name, status')
        .in('status', ['active', 'trialing'])
        .is('deleted_at', null);

      if (tenantError) {
        logger.error('❌ [DOCUMENT PARSING WORKER] Failed to get active tenants', { error: tenantError.message });
        runtimeCapacityService.recordWorkerEnd(this.workerName, {
          failed: 1,
          lastError: tenantError.message
        });
        return;
      }

      if (!tenants || tenants.length === 0) {
        logger.info('ℹ️ [DOCUMENT PARSING WORKER] No active tenants found');
        runtimeCapacityService.recordWorkerEnd(this.workerName, {
          processed: 0,
          succeeded: 0,
          failed: 0
        });
        return;
      }

      logger.info(`📊 [DOCUMENT PARSING WORKER] Processing ${tenants.length} active tenants`);

      const totalStats: ParsingStats = {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errors: []
      };

      // MULTI-TENANT: Process each tenant in isolation
      const orderedTenants = this.rotateTenants((tenants || []) as Array<{ id: string; name?: string }>);
      for (const tenant of orderedTenants) {
        try {
          const tenantStats = await this.runParsingForTenant(tenant.id);
          totalStats.processed += tenantStats.processed;
          totalStats.succeeded += tenantStats.succeeded;
          totalStats.failed += tenantStats.failed;
          totalStats.skipped += tenantStats.skipped;
          totalStats.errors.push(...tenantStats.errors);
        } catch (error: any) {
          logger.error('❌ [DOCUMENT PARSING WORKER] Error processing tenant', {
            tenantId: tenant.id,
            tenantName: tenant.name,
            error: error.message
          });
          totalStats.errors.push(`Tenant ${tenant.id}: ${error.message}`);
        }
      }

      const runDuration = Date.now() - runStartTime;

      logger.info('✅ [DOCUMENT PARSING WORKER] Scheduled document parsing completed', {
        tenantCount: tenants.length,
        processed: totalStats.processed,
        succeeded: totalStats.succeeded,
        failed: totalStats.failed,
        skipped: totalStats.skipped,
        errors: totalStats.errors.length,
        duration: `${runDuration}ms`
      });
      runtimeCapacityService.recordWorkerEnd(this.workerName, {
        processed: totalStats.processed,
        succeeded: totalStats.succeeded,
        failed: totalStats.failed,
        metadata: { tenantCount: tenants.length, durationMs: runDuration }
      });

    } catch (error: any) {
      logger.error('❌ [DOCUMENT PARSING WORKER] Error in scheduled document parsing', {
        error: error.message,
        stack: error.stack
      });
      runtimeCapacityService.recordWorkerEnd(this.workerName, {
        lastError: error.message,
        failed: 1
      });
    }
  }

  /**
   * MULTI-TENANT: Run parsing for a specific tenant
   * All database queries are scoped to this tenant only
   */
  private async runParsingForTenant(tenantId: string): Promise<ParsingStats> {
    const stats: ParsingStats = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    const cursor = await workerContinuationService.getCursor(this.workerName, tenantId);
    const pendingState = await this.getPendingDocumentsForTenant(tenantId, cursor);
    const documents = pendingState.documents;
    runtimeCapacityService.updateBacklog(
      `${this.workerName}:${tenantId}`,
      pendingState.backlogDepth,
      pendingState.oldestItemAgeMs
    );

    if (documents.length === 0) {
      await workerContinuationService.clearCursor(this.workerName, tenantId);
      runtimeCapacityService.recordWorkerEnd(`${this.workerName}:${tenantId}`, {
        processed: 0,
        succeeded: 0,
        failed: 0,
        backlogDepth: pendingState.backlogDepth,
        oldestItemAgeMs: pendingState.oldestItemAgeMs
      });
      logger.debug('ℹ️ [DOCUMENT PARSING WORKER] No pending documents for tenant', { tenantId });
      return stats;
    }

    logger.info(`📊 [DOCUMENT PARSING WORKER] Processing ${documents.length} documents for tenant`, { tenantId, documentCount: documents.length });

    for (let i = 0; i < documents.length; i++) {
      const document = documents[i];

      // Stagger processing to avoid rate limits
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second between documents
      }

      try {
        const result = await this.parseDocument(document, tenantId);
        stats.processed++;

        if (result.success) {
          stats.succeeded++;
        } else {
          stats.failed++;
          if (result.error) {
            stats.errors.push(`Document ${document.id}: ${result.error}`);
          }
        }
      } catch (error: any) {
        stats.failed++;
        stats.errors.push(`Document ${document.id}: ${error.message}`);
        logger.error(`❌ [DOCUMENT PARSING WORKER] Failed to parse document ${document.id}`, {
          error: error.message,
          documentId: document.id,
          tenantId
        });
      }
    }

    if (pendingState.nextCursor) {
      await workerContinuationService.setCursor(this.workerName, tenantId, pendingState.nextCursor, {
        processed: stats.processed,
        backlogDepth: pendingState.backlogDepth
      });
    } else {
      await workerContinuationService.clearCursor(this.workerName, tenantId);
    }

    runtimeCapacityService.recordWorkerEnd(`${this.workerName}:${tenantId}`, {
      processed: stats.processed,
      succeeded: stats.succeeded,
      failed: stats.failed,
      backlogDepth: pendingState.backlogDepth,
      oldestItemAgeMs: pendingState.oldestItemAgeMs
    });

    return stats;
  }

  /**
   * MULTI-TENANT: Get pending documents for a specific tenant
   */
  private async getPendingDocumentsForTenant(
    tenantId: string,
    cursor: string | null
  ): Promise<{
    documents: Array<{ id: string; seller_id: string; filename: string; content_type: string }>;
    nextCursor: string | null;
    backlogDepth: number;
    oldestItemAgeMs: number | null;
  }> {
    try {
      await this.ensureParserJobsForPendingDocuments(tenantId);

      const [backlogResult, oldestResult] = await Promise.all([
        createTenantScopedQueryById(tenantId, 'parser_jobs')
          .select('*', { count: 'exact', head: true })
          .in('status', ['pending', 'processing', 'retrying']),
        createTenantScopedQueryById(tenantId, 'parser_jobs')
          .select('created_at')
          .in('status', ['pending', 'processing', 'retrying'])
          .order('created_at', { ascending: true })
          .limit(1)
      ]);

      let query = createTenantScopedQueryById(tenantId, 'parser_jobs')
        .select('id, document_id, status, started_at, completed_at, error, created_at')
        .in('status', ['pending', 'processing', 'retrying'])
        .order('document_id', { ascending: true })
        .limit(DocumentParsingWorker.BATCH_SIZE);

      if (cursor) {
        query = query.gt('document_id', cursor);
      }

      let { data: parserJobs, error } = await query;

      if ((!parserJobs || parserJobs.length === 0) && cursor) {
        const wrapped = await createTenantScopedQueryById(tenantId, 'parser_jobs')
          .select('id, document_id, status, started_at, completed_at, error, created_at')
          .in('status', ['pending', 'processing', 'retrying'])
          .order('document_id', { ascending: true })
          .limit(DocumentParsingWorker.BATCH_SIZE);
        parserJobs = wrapped.data;
        error = wrapped.error as any;
      }

      if (error) {
        logger.warn('❌ [DOCUMENT PARSING WORKER] Error fetching parser jobs for tenant', {
          tenantId,
          error: error.message
        });
        return {
          documents: [],
          nextCursor: null,
          backlogDepth: 0,
          oldestItemAgeMs: null
        };
      }

      const documentIds = Array.from(new Set((parserJobs || []).map((job: any) => job.document_id).filter(Boolean)));
      const { data: documents, error: documentsError } = documentIds.length
        ? await createTenantScopedQueryById(tenantId, 'evidence_documents')
            .select('id, seller_id, filename, content_type, storage_path, raw_text, extracted, metadata, parsed_metadata, supplier_name, invoice_number, total_amount, document_date, currency, parser_status, parser_started_at, parser_completed_at, parser_error, parser_job_id, created_at')
            .in('id', documentIds)
        : { data: [] as any[], error: null as any };

      if (documentsError) {
        logger.warn('❌ [DOCUMENT PARSING WORKER] Error fetching documents for parser jobs', {
          tenantId,
          error: documentsError.message
        });
        return {
          documents: [],
          nextCursor: null,
          backlogDepth: backlogResult.count || 0,
          oldestItemAgeMs: oldestResult.data?.[0]?.created_at
            ? Math.max(0, Date.now() - new Date(oldestResult.data[0].created_at).getTime())
            : null
        };
      }

      const documentById = new Map<string, any>();
      for (const document of documents || []) {
        documentById.set(document.id, document);
      }

      const parsableDocs: Array<{ id: string; seller_id: string; filename: string; content_type: string }> = [];

      const dedupedJobs = new Map<string, any>();
      for (const job of parserJobs || []) {
        if (!dedupedJobs.has(job.document_id)) {
          dedupedJobs.set(job.document_id, job);
        }
      }

      for (const job of dedupedJobs.values()) {
        const doc = documentById.get(job.document_id);
        if (!doc) continue;

        const normalizedStatus = await this.normalizeDocumentState({
          ...doc,
          job_status: job.status,
          job_started_at: job.started_at,
          job_completed_at: job.completed_at,
          job_error: job.error
        });
        if (normalizedStatus === 'pending') {
          parsableDocs.push({
            id: doc.id,
            seller_id: doc.seller_id,
            filename: doc.filename,
            content_type: doc.content_type
          });
        }
      }

      const filteredDocs = parsableDocs
        .filter((doc: any) => !this.failedDocIds.has(doc.id)) // Skip known failures
        .map((doc: any) => ({
          id: doc.id,
          seller_id: doc.seller_id,
          filename: doc.filename,
          content_type: doc.content_type
        }));
      const oldestCreatedAt = oldestResult.data?.[0]?.created_at as string | undefined;

      return {
        documents: filteredDocs,
        nextCursor: filteredDocs.length > 0 ? filteredDocs[filteredDocs.length - 1].id : null,
        backlogDepth: backlogResult.count || 0,
        oldestItemAgeMs: oldestCreatedAt ? Math.max(0, Date.now() - new Date(oldestCreatedAt).getTime()) : null
      };
    } catch (error: any) {
      logger.error('❌ [DOCUMENT PARSING WORKER] Error getting pending documents for tenant', {
        tenantId,
        error: error.message
      });
      return {
        documents: [],
        nextCursor: null,
        backlogDepth: 0,
        oldestItemAgeMs: null
      };
    }
  }

  private async ensureParserJobsForPendingDocuments(tenantId: string): Promise<void> {
    try {
      const { data: documents, error } = await createTenantScopedQueryById(tenantId, 'evidence_documents')
        .select('id, seller_id, parser_job_id, parser_status')
        .in('parser_status', ['pending', 'processing', 'retrying'])
        .limit(DocumentParsingWorker.BATCH_SIZE * 2);

      if (error || !documents?.length) {
        return;
      }

      for (const document of documents) {
        if (document.parser_job_id) continue;
        await this.syncParserJobState(document.id, normalizeText(document.parser_status) === 'processing' ? 'processing' : 'pending');
      }
    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to ensure parser jobs for pending documents', {
        tenantId,
        error: error.message
      });
    }
  }

  /**
   * Get documents that need parsing
   * Checks for documents where parsed_metadata is null or parser_status is 'pending'
   * Only returns PDF documents (PNG/images can't be parsed by pdfExtractor)
   */
  private async getPendingDocuments(): Promise<Array<{ id: string; seller_id: string; filename: string; content_type: string }>> {
    try {
      // Use admin client to bypass RLS
      const client = supabaseAdmin || supabase;

      // Get PDF documents where parsed_metadata is null
      // Filter for PDFs only - PNGs and images can't be parsed by pdfExtractor
      let { data: documents, error } = await client
        .from('evidence_documents')
        .select('id, seller_id, filename, content_type, storage_path, raw_text, extracted, metadata, parsed_metadata, supplier_name, invoice_number, total_amount, document_date, currency, parser_status, parser_started_at, parser_completed_at, parser_error')
        .in('parser_status', ['pending', 'processing'])
        .limit(100) // Increased from 50 to process more docs per run
        .order('created_at', { ascending: true });

      // If parsed_metadata column doesn't exist, try checking by other criteria
      if (error && error.message?.includes('column') && error.message?.includes('parsed_metadata')) {
        // Fallback: get documents that don't have supplier_name or invoice_number
        // (indicating they haven't been parsed yet)
        const retry = await client
          .from('evidence_documents')
          .select('id, seller_id, filename, content_type, storage_path, parsed_metadata, parser_status, parser_started_at, parser_completed_at, parser_error')
          .in('parser_status', ['pending', 'processing'])
          .limit(100)
          .order('created_at', { ascending: true });
        documents = retry.data;
        error = retry.error;
      }

      if (error) {
        logger.error('❌ [DOCUMENT PARSING WORKER] Error fetching pending documents', {
          error: error.message
        });
        return [];
      }

      const parsableDocs: Array<{ id: string; seller_id: string; filename: string; content_type: string }> = [];

      for (const doc of documents || []) {
        const normalizedStatus = await this.normalizeDocumentState(doc);
        if (normalizedStatus === 'pending') {
          parsableDocs.push({
            id: doc.id,
            seller_id: doc.seller_id,
            filename: doc.filename,
            content_type: doc.content_type
          });
        }
      }

      logger.info(`📄 [DOCUMENT PARSING WORKER] Found ${parsableDocs.length} documents to parse (out of ${documents?.length || 0} total pending)`, {
        totalPending: documents?.length || 0,
        parsableCount: parsableDocs.length
      });

      return parsableDocs
        .filter((doc: any) => !this.failedDocIds.has(doc.id)) // Skip known failures
        .map((doc: any) => ({
          id: doc.id,
          seller_id: doc.seller_id,
          filename: doc.filename,
          content_type: doc.content_type
        }));
    } catch (error: any) {
      logger.error('❌ [DOCUMENT PARSING WORKER] Error getting pending documents', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Parse a single document
   */
  private async parseDocument(document: { id: string; seller_id: string; filename: string; content_type: string }, tenantId: string): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info(`📄 [DOCUMENT PARSING WORKER] Parsing document: ${document.id}`, {
        documentId: document.id,
        filename: document.filename,
        sellerId: document.seller_id
      });

      await this.updateDocumentStatus(document.id, 'processing');

      const parsingOutcome = await documentParsingService.parseDocumentWithRetry(
        document.id,
        document.seller_id,
        3
      );

      if (parsingOutcome.parsing_strategy === 'FAILED_DURABLE') {
        await this.logError(document.id, document.seller_id, new Error(parsingOutcome.parsing_explanation.reason));
        await this.markDocumentFailed(document.id, parsingOutcome.parsing_explanation.reason, 'failed', parsingOutcome);
        return { success: false, error: parsingOutcome.parsing_explanation.reason };
      }

      await this.storeParsedData(document.id, document.seller_id, parsingOutcome);
      await this.updateDocumentStatus(document.id, 'completed', parsingOutcome.parsed_data.confidence_score);

      const parsingStatus = parsingOutcome.parsing_strategy === 'PARTIAL' ? 'partial' : 'completed';

      logger.info(`✅ [DOCUMENT PARSING WORKER] Successfully parsed document: ${document.id}`, {
        documentId: document.id,
        confidence: parsingOutcome.parsed_data.confidence_score,
        extractionMethod: parsingOutcome.parsed_data.extraction_method,
        parsingStrategy: parsingOutcome.parsing_strategy
      });

      try {
        sseHub.sendEvent(document.seller_id, 'message', {
          type: 'parsing',
          status: parsingStatus,
          document_id: document.id,
          filename: document.filename,
          confidence: parsingOutcome.parsed_data.confidence_score,
          extraction_method: parsingOutcome.parsed_data.extraction_method,
          parsing_strategy: parsingOutcome.parsing_strategy,
          parsing_explanation: parsingOutcome.parsing_explanation,
          message: `Document parsed (${parsingOutcome.parsing_strategy.toLowerCase()}): ${document.filename || document.id}`,
          timestamp: new Date().toISOString()
        });
      } catch (sseError: any) {
        logger.debug('SSE event failed (non-critical)', { error: sseError.message });
      }

      try {
        const agentEventLogger = (await import('../services/agentEventLogger')).default;
        const parsingStartTime = Date.now();
        await agentEventLogger.logDocumentParsing({
          userId: document.seller_id,
          documentId: document.id,
          success: true,
          confidence: parsingOutcome.parsed_data.confidence_score || 0,
          extractionMethod: parsingOutcome.parsed_data.extraction_method || 'unknown',
          duration: Date.now() - parsingStartTime
        });
      } catch (logError: any) {
        logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to log event', {
          error: logError.message
        });
      }

      try {
        const notificationHelper = (await import('../services/notificationHelper')).default;
        const { data: doc } = await supabaseAdmin
          .from('evidence_documents')
          .select('filename, source')
          .eq('id', document.id)
          .single();

        if (doc) {
          await notificationHelper.notifyEvidenceFound(document.seller_id, {
            tenantId,
            documentId: document.id,
            source: (doc.source || 'unknown') as 'gmail' | 'outlook' | 'drive' | 'dropbox',
            fileName: doc.filename || 'Unknown',
            parsed: true
          });
        }
      } catch (notifError: any) {
        logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to send notification', {
          error: notifError.message
        });
      }

      try {
        const sseHub = (await import('../utils/sseHub')).default;
        sseHub.sendEvent(document.seller_id, 'parsing', {
          type: 'parsing',
          status: parsingStatus,
          document_id: document.id,
          confidence: parsingOutcome.parsed_data.confidence_score || 0,
          extraction_method: parsingOutcome.parsed_data.extraction_method || 'unknown',
          parsing_strategy: parsingOutcome.parsing_strategy,
          parsing_explanation: parsingOutcome.parsing_explanation,
          timestamp: new Date().toISOString()
        });
        logger.debug('📡 [DOCUMENT PARSING WORKER] Sent SSE parsing completion event', {
          documentId: document.id,
          userId: document.seller_id
        });
      } catch (sseError: any) {
        logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to send SSE event', {
          error: sseError.message
        });
      }

      try {
        const evidenceMatchingWorker = (await import('./evidenceMatchingWorker')).default;
        await evidenceMatchingWorker.triggerMatchingForParsedDocument(document.seller_id, tenantId);
        logger.info(`🔄 [DOCUMENT PARSING WORKER] Triggered evidence matching for user: ${document.seller_id}`);
      } catch (error: any) {
        logger.debug('⚠️ [DOCUMENT PARSING WORKER] Failed to trigger evidence matching (non-critical)', {
          error: error.message,
          userId: document.seller_id
        });
      }

      return { success: true };
    } catch (error: any) {
      await this.logError(document.id, document.seller_id, error);
      await this.markDocumentFailed(
        document.id,
        error.message,
        'failed',
        this.buildFailedDurableOutcome(document, error.message)
      );

      if (this.failedDocIds.size >= this.MAX_FAILED_CACHE) {
        const first = this.failedDocIds.values().next().value;
        if (first) this.failedDocIds.delete(first);
      }
      this.failedDocIds.add(document.id);

      logger.error(`❌ [DOCUMENT PARSING WORKER] Failed to parse document: ${document.id}`, {
        error: error.message,
        documentId: document.id
      });

      try {
        const agentEventLogger = (await import('../services/agentEventLogger')).default;
        await agentEventLogger.logDocumentParsing({
          userId: document.seller_id,
          documentId: document.id,
          success: false,
          confidence: 0,
          extractionMethod: 'failed',
          duration: 0,
          error: error.message
        });
      } catch (logError: any) {
        logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to log event', {
          error: logError.message
        });
      }

      return { success: false, error: error.message };
    }
  }

  private async normalizeDocumentState(doc: any): Promise<'pending' | 'processing' | 'completed' | 'failed'> {
    const parsedMetadata = doc.parsed_metadata || null;
    const parserStatus = doc.job_status || doc.parser_status || 'pending';
    const contentType = doc.content_type?.toLowerCase() || '';
    const filename = doc.filename?.toLowerCase() || '';
    const parserStartedAt = doc.job_started_at || doc.parser_started_at;
    const isParsable =
      contentType.includes('pdf') ||
      filename.endsWith('.pdf') ||
      contentType.includes('text') ||
      filename.endsWith('.txt');

    if (parsedMetadata?.parsing_strategy === 'FAILED_DURABLE' || parsedMetadata?._parse_failed) {
      if (parserStatus !== 'failed') {
        await this.updateDocumentStatus(doc.id, 'failed', undefined, parsedMetadata?.parsing_explanation?.reason || parsedMetadata.error || 'Parsing failed');
      }
      return 'failed';
    }

    if (parsedMetadata && Object.keys(parsedMetadata).length > 0) {
      if (parserStatus !== 'completed') {
        await this.updateDocumentStatus(doc.id, 'completed', parsedMetadata.confidence_score);
      }
      return 'completed';
    }

    if (!isParsable) {
      await this.markDocumentFailed(doc.id, 'Unsupported document type for parser', 'not_parseable');
      return 'failed';
    }

    if (!doc.storage_path) {
      const partialOutcome = documentParsingService.createOutcomeFromPersistedHints(
        doc,
        'Raw file missing from storage; preserving degraded parser hints instead of dropping the document',
        ['ingestion_preserved_hints'],
        ['raw_file_missing']
      );

      if (partialOutcome) {
        await this.storeParsedData(doc.id, doc.seller_id, partialOutcome);
        await this.updateDocumentStatus(doc.id, 'completed', partialOutcome.parsed_data.confidence_score);
        return 'completed';
      }

      await this.markDocumentFailed(doc.id, 'Raw file missing from storage', 'not_parseable');
      return 'failed';
    }

    if (parserStatus === 'processing' && parserStartedAt) {
      const startedAtMs = Date.parse(parserStartedAt);
      if (!Number.isNaN(startedAtMs) && (Date.now() - startedAtMs) < this.MAX_PROCESSING_AGE_MS) {
        return 'processing';
      }
    }

    if (parserStatus === 'retrying') {
      await this.updateDocumentStatus(doc.id, 'pending');
      await this.syncParserJobState(doc.id, 'pending', {
        result: buildOperationalDecision('RETRY_SCHEDULED', {
          reason: 'Parser work was moved back to pending so the next worker pass can resume deterministically.',
          next_action: 'resume_parser_execution'
        })
      });
      return 'pending';
    }

    if (parserStatus !== 'pending') {
      await this.updateDocumentStatus(doc.id, 'pending');
    }

    return 'pending';
  }

  private async markDocumentFailed(
    documentId: string,
    errorMessage: string,
    parseState: 'failed' | 'not_parseable' = 'failed',
    outcome?: DocumentParsingOutcome
  ): Promise<void> {
    const client = supabaseAdmin || supabase;
    const now = new Date().toISOString();

    const { data: document } = await client
      .from('evidence_documents')
      .select('seller_id, raw_text, extracted, metadata, parsed_metadata, supplier_name, invoice_number, total_amount, document_date, currency')
      .eq('id', documentId)
      .maybeSingle();

    const failureOutcome = outcome || this.buildFailedDurableOutcome(document, errorMessage, parseState);
    const structuredData = this.buildStructuredParsedMetadata(failureOutcome, now);

    await client
      .from('evidence_documents')
      .update({
        parser_status: 'failed',
        parser_error: errorMessage,
        parser_completed_at: now,
        parsed_at: null,
        updated_at: now,
        parsed_metadata: {
          ...structuredData,
          _parse_failed: true,
          parser_status: 'failed',
          parse_state: parseState,
          error: errorMessage.substring(0, 500),
          failed_at: now,
          retry_eligible: false
        }
      })
      .eq('id', documentId);

    if (document?.seller_id) {
      await this.storeParserJobResult(documentId, document.seller_id, failureOutcome, structuredData);
    }

    await this.syncParserJobState(documentId, 'failed', {
      error: errorMessage.substring(0, 500),
      result: {
        ...structuredData,
        _parse_failed: true,
        parser_status: 'failed',
        parse_state: parseState
      }
    });
  }

  private buildFailedDurableOutcome(
    document: any,
    reason: string,
    parseState: 'failed' | 'not_parseable' = 'failed'
  ): DocumentParsingOutcome {
    const hintedOutcome = documentParsingService.createOutcomeFromPersistedHints(
      document,
      reason,
      [],
      [parseState]
    );

    if (hintedOutcome) {
      return {
        parsing_strategy: 'FAILED_DURABLE',
        parsing_explanation: {
          ...hintedOutcome.parsing_explanation,
          reason,
          failed_steps: Array.from(new Set([...(hintedOutcome.parsing_explanation.failed_steps || []), parseState]))
        },
        parsed_data: hintedOutcome.parsed_data
      };
    }

    return {
      parsing_strategy: 'FAILED_DURABLE',
      parsing_explanation: {
        reason,
        completed_steps: [],
        failed_steps: [parseState],
        preserved_outputs: []
      },
      parsed_data: {}
    };
  }

  private buildStructuredParsedMetadata(
    outcome: DocumentParsingOutcome,
    timestamp: string
  ): Record<string, any> {
    const parsedData = outcome.parsed_data || {};
    const parserStatus = outcome.parsing_strategy === 'FAILED_DURABLE'
      ? 'failed'
      : outcome.parsing_strategy === 'PARTIAL'
        ? 'partial'
        : 'completed';
    const operationalDecision = outcome.parsing_strategy === 'FAILED_DURABLE'
      ? buildOperationalDecision('FAILED_DURABLE', {
          reason: outcome.parsing_explanation.reason,
          blocking_guard: 'parser_runtime_terminal_failure',
          next_action: 'replace_or_reparse_document'
        })
      : outcome.parsing_strategy === 'PARTIAL'
        ? buildOperationalDecision('READY', {
            reason: 'Parsing preserved usable partial outputs for downstream matching.',
            next_action: 'continue_with_partial_parser_truth'
          })
        : buildOperationalDecision('READY', {
            reason: 'Parsing completed successfully.',
            next_action: 'continue_to_matching'
          });

    return {
      parser_status: parserStatus,
      parsing_strategy: outcome.parsing_strategy,
      parsing_explanation: outcome.parsing_explanation,
      operational_state: operationalDecision.operational_state,
      operational_explanation: operationalDecision.operational_explanation,
      supplier_name: parsedData.supplier_name,
      invoice_number: parsedData.invoice_number,
      invoice_date: parsedData.invoice_date || parsedData.document_date,
      purchase_order_number: parsedData.purchase_order_number,
      document_date: parsedData.document_date || parsedData.invoice_date,
      currency: parsedData.currency || 'USD',
      total_amount: parsedData.total_amount,
      tax_amount: parsedData.tax_amount,
      shipping_amount: parsedData.shipping_amount,
      payment_terms: parsedData.payment_terms,
      line_items: parsedData.line_items || [],
      raw_text: parsedData.raw_text,
      extraction_method: parsedData.extraction_method || 'regex',
      confidence_score: parsedData.confidence_score || 0.0,
      parsed_at: outcome.parsing_strategy === 'FAILED_DURABLE' ? null : timestamp,
      order_ids: parsedData.order_ids || [],
      asins: parsedData.asins || [],
      skus: parsedData.skus || [],
      tracking_numbers: parsedData.tracking_numbers || [],
      invoice_numbers: parsedData.invoice_numbers || [],
      amounts: parsedData.amounts || [],
      dates: parsedData.dates || []
    };
  }

  /**
   * Update document parsing status
   */
  private async updateDocumentStatus(
    documentId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    confidence?: number,
    error?: string
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;
      const now = new Date().toISOString();

      const updateData: any = {
        parser_status: status,
        updated_at: now
      };

      // Try to update parser_status if column exists
      // Also update parsed_metadata timestamp fields
      if (status === 'processing') {
        updateData.parser_started_at = now;
        updateData.parser_completed_at = null;
      } else if (status === 'completed' || status === 'failed') {
        updateData.parser_completed_at = now;
      }

      // Update confidence if provided
      if (confidence !== undefined) {
        updateData.parser_confidence = confidence;
      }

      // Update error if provided
      if (error) {
        updateData.parser_error = error;
      }

      // Try to update parser_status column (may not exist)
      const { error: updateError } = await client
        .from('evidence_documents')
        .update(updateData)
        .eq('id', documentId);

      if (updateError) {
        // If parser_status column doesn't exist, that's OK - we'll use parsed_metadata
        logger.debug('⚠️ [DOCUMENT PARSING WORKER] Could not update parser_status (column may not exist)', {
          documentId,
          error: updateError.message
        });
      }

      await this.syncParserJobState(documentId, status, {
        error: error ? error.substring(0, 500) : null
      });
    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING WORKER] Error updating document status', {
        documentId,
        error: error.message
      });
    }
  }

  /**
   * Store parsed data in evidence_documents table
   */
  private async storeParsedData(
    documentId: string,
    sellerId: string,
    outcome: DocumentParsingOutcome
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;
      const structuredData = this.buildStructuredParsedMetadata(outcome, new Date().toISOString());
      const parsedData = outcome.parsed_data;

      const updateData: any = {
        parsed_metadata: structuredData,
        parsed_at: structuredData.parsed_at,
        updated_at: new Date().toISOString()
      };

      if (parsedData.supplier_name) {
        updateData.supplier_name = parsedData.supplier_name;
      }
      if (parsedData.invoice_number) {
        updateData.invoice_number = parsedData.invoice_number;
      }
      if (parsedData.purchase_order_number) {
        updateData.purchase_order_number = parsedData.purchase_order_number;
      }
      if (parsedData.document_date || parsedData.invoice_date) {
        updateData.document_date = parsedData.document_date || parsedData.invoice_date;
      }
      if (parsedData.currency) {
        updateData.currency = parsedData.currency;
      }
      if (parsedData.total_amount !== undefined) {
        updateData.total_amount = parsedData.total_amount;
      }
      if (parsedData.raw_text) {
        updateData.raw_text = parsedData.raw_text;
      }
      if (parsedData.line_items && parsedData.line_items.length > 0) {
        updateData.extracted = {
          items: parsedData.line_items.map(item => ({
            sku: item.sku,
            quantity: item.quantity,
            unit_cost: item.unit_price || item.total,
            description: item.description
          }))
        };
      }

      const { error: updateError } = await client
        .from('evidence_documents')
        .update(updateData)
        .eq('id', documentId);

      if (updateError) {
        logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to store parsed data', {
          documentId,
          error: updateError.message
        });
      } else {
        logger.info('✅ [DOCUMENT PARSING WORKER] Stored parsed data', {
          documentId,
          supplierName: parsedData.supplier_name,
          invoiceNumber: parsedData.invoice_number,
          lineItemCount: parsedData.line_items?.length || 0,
          parsingStrategy: outcome.parsing_strategy
        });
      }

      try {
        await this.storeParserJobResult(documentId, sellerId, outcome, structuredData);
      } catch (resultError: any) {
        const persistenceError = new Error(`Parser result persistence failed: ${resultError.message}`);
        persistenceError.name = 'ParserResultPersistenceError';

        logger.error('❌ [DOCUMENT PARSING WORKER] Failed to persist parser result rail', {
          documentId,
          error: resultError.message
        });

        await this.logError(documentId, sellerId, persistenceError);
      }

      await this.syncParserJobState(documentId, 'completed', {
        result: structuredData,
        error: null
      });
    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING WORKER] Error storing parsed data', {
        documentId,
        error: error.message
      });
    }
  }

  /**
   * Store parsing result in the durable parser_job_results rail
   */
  private async storeParserJobResult(
    documentId: string,
    sellerId: string,
    outcome: DocumentParsingOutcome,
    structuredData: Record<string, any>
  ): Promise<void> {
    const client = supabaseAdmin || supabase;
    const { data: document, error: documentError } = await client
      .from('evidence_documents')
      .select('tenant_id, parser_job_id')
      .eq('id', documentId)
      .maybeSingle();

    if (documentError) {
      throw new Error(`Failed to load parser result context: ${documentError.message}`);
    }

    if (!document?.tenant_id) {
      throw new Error('Parser result persistence requires tenant_id on evidence document');
    }

    const safeUserId = isUuid(sellerId) ? sellerId : null;
    const parsedData = outcome.parsed_data || {};
    const parserJobStatus = outcome.parsing_strategy === 'FAILED_DURABLE' ? 'failed' : 'completed';

    const { error: upsertError } = await client
      .from('parser_job_results')
      .upsert({
        tenant_id: document.tenant_id,
        document_id: documentId,
        parser_job_id: document.parser_job_id || null,
        seller_id: sellerId,
        user_id: safeUserId,
        status: parserJobStatus,
        supplier_name: parsedData.supplier_name,
        invoice_number: parsedData.invoice_number,
        invoice_date: parsedData.invoice_date || parsedData.document_date,
        total_amount: parsedData.total_amount,
        currency: parsedData.currency || 'USD',
        tax_amount: parsedData.tax_amount,
        shipping_amount: parsedData.shipping_amount,
        payment_terms: parsedData.payment_terms,
        po_number: parsedData.purchase_order_number,
        raw_text: parsedData.raw_text,
        line_items: parsedData.line_items || [],
        structured_result: structuredData,
        extraction_method: parsedData.extraction_method || 'regex',
        confidence_score: parsedData.confidence_score || 0.0,
        processing_time_ms: 0,
        error_message: outcome.parsing_strategy === 'FAILED_DURABLE'
          ? outcome.parsing_explanation.reason
          : null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'document_id',
        ignoreDuplicates: false
      });

    if (upsertError) {
      throw new Error(`Failed to upsert parser result: ${upsertError.message}`);
    }

    logger.info('🧾 [DOCUMENT PARSING WORKER] Stored parser result rail', {
      documentId,
      parserJobId: document.parser_job_id || null,
      tenantId: document.tenant_id,
      parsingStrategy: outcome.parsing_strategy
    });
  }

  private async syncParserJobState(
    documentId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying',
    options?: {
      error?: string | null;
      result?: Record<string, any> | null;
    }
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;
      const now = new Date().toISOString();
      const { data: document } = await client
        .from('evidence_documents')
        .select('id, tenant_id, seller_id, parser_job_id')
        .eq('id', documentId)
        .maybeSingle();

      if (!document) {
        return;
      }

      const safeUserId = isUuid(document.seller_id) ? document.seller_id : null;
      const payload: Record<string, any> = {
        status,
        updated_at: now
      };

      if (document.tenant_id) payload.tenant_id = document.tenant_id;
      if (safeUserId) payload.user_id = safeUserId;

      if (status === 'processing') {
        payload.started_at = now;
        payload.completed_at = null;
      } else if (status === 'completed' || status === 'failed') {
        payload.completed_at = now;
      }

      if (options?.error !== undefined) {
        payload.error = options.error;
      }

      if (options?.result !== undefined) {
        payload.result = options.result;
      }

      let parserJobId = document.parser_job_id || null;

      if (parserJobId) {
        const { error: updateError } = await client
          .from('parser_jobs')
          .update(payload)
          .eq('id', parserJobId);

        if (!updateError) {
          return;
        }

        logger.debug('⚠️ [DOCUMENT PARSING WORKER] Failed to update parser job by parser_job_id, falling back to document lookup', {
          documentId,
          parserJobId,
          error: updateError.message
        });
      }

      const { data: existingJob } = await client
        .from('parser_jobs')
        .select('id')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingJob?.id) {
        parserJobId = existingJob.id;
        const { error: updateError } = await client
          .from('parser_jobs')
          .update(payload)
          .eq('id', parserJobId);

        if (updateError) {
          logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to update parser job state', {
            documentId,
            parserJobId,
            error: updateError.message
          });
          return;
        }
      } else {
        const { data: createdJob, error: createError } = await client
          .from('parser_jobs')
          .insert({
            document_id: documentId,
            parser_type: 'pdf',
            created_at: now,
            ...payload
          })
          .select('id')
          .single();

        if (createError || !createdJob?.id) {
          logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to create parser job state', {
            documentId,
            error: createError?.message || 'missing parser job id'
          });
          return;
        }

        parserJobId = createdJob.id;
      }

      if (parserJobId && parserJobId !== document.parser_job_id) {
        await client
          .from('evidence_documents')
          .update({
            parser_job_id: parserJobId,
            updated_at: now
          })
          .eq('id', documentId);
      }
    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to sync parser job state', {
        documentId,
        status,
        error: error.message
      });
    }
  }

  /**
   * Log parsing error
   */
  private async logError(
    documentId: string,
    sellerId: string,
    error: any,
    retryCount: number = 0
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;

      const { error: insertError } = await client
        .from('document_parsing_errors')
        .insert({
          document_id: documentId,
          seller_id: sellerId,
          error_type: error.name || 'ParsingError',
          error_message: error.message || String(error),
          error_stack: error.stack,
          retry_count: retryCount,
          max_retries: 3,
          metadata: {
            timestamp: new Date().toISOString(),
            document_id: documentId,
            seller_id: sellerId
          }
        });

      if (insertError) {
        logger.error('❌ [DOCUMENT PARSING WORKER] Failed to log parsing error', {
          documentId,
          error: insertError.message
        });
      } else {
        logger.info('📝 [DOCUMENT PARSING WORKER] Logged parsing error', {
          documentId,
          sellerId,
          errorType: error.name || 'ParsingError',
          retryCount
        });
      }
    } catch (logError: any) {
      logger.error('❌ [DOCUMENT PARSING WORKER] Error logging parsing error', {
        documentId,
        error: logError.message
      });
    }
  }

  /**
   * Get worker status
   */
  getStatus(): { running: boolean; schedule: string } {
    return {
      running: this.isRunning,
      schedule: this.schedule
    };
  }

  /**
   * Manually trigger parsing for a document (for testing)
   */
  async triggerManualParsing(documentId: string, sellerId: string): Promise<{ success: boolean; error?: string }> {
    logger.info(`🔧 [DOCUMENT PARSING WORKER] Manual parsing triggered for document: ${documentId}`);

    const document = await this.getDocumentById(documentId);
    if (!document) {
      return { success: false, error: 'Document not found' };
    }

    return await this.parseDocument(document, (document as any).tenant_id || '');
  }

  /**
   * Get document by ID
   */
  public async getDocumentById(documentId: string): Promise<{ id: string; seller_id: string; filename: string; content_type: string; tenant_id?: string } | null> {
    try {
      const client = supabaseAdmin || supabase;
      const { data, error } = await client
        .from('evidence_documents')
        .select('id, seller_id, filename, content_type, tenant_id')
        .eq('id', documentId)
        .single();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        seller_id: data.seller_id,
        filename: data.filename,
        content_type: data.content_type,
        tenant_id: data.tenant_id
      };
    } catch (error: any) {
      logger.error('Error getting document by ID', { documentId, error: error.message });
      return null;
    }
  }
}

// Singleton instance
const documentParsingWorker = new DocumentParsingWorker();

export default documentParsingWorker;
