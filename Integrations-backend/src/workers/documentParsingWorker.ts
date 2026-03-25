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
import documentParsingService, { ParsedDocumentData } from '../services/documentParsingService';
import sseHub from '../utils/sseHub';
import workerContinuationService from '../services/workerContinuationService';
import runtimeCapacityService from '../services/runtimeCapacityService';

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

  constructor() {
    // Initialize
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
      for (const tenant of tenants) {
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
      const backlogQuery = createTenantScopedQueryById(tenantId, 'evidence_documents');
      const oldestQuery = createTenantScopedQueryById(tenantId, 'evidence_documents');
      const tenantQuery = createTenantScopedQueryById(tenantId, 'evidence_documents');

      const [backlogResult, oldestResult] = await Promise.all([
        backlogQuery
          .select('*', { count: 'exact', head: true })
          .in('parser_status', ['pending', 'processing']),
        oldestQuery
          .select('created_at')
          .in('parser_status', ['pending', 'processing'])
          .order('created_at', { ascending: true })
          .limit(1)
      ]);

      let query = tenantQuery
        .select('id, seller_id, filename, content_type, storage_path, parsed_metadata, parser_status, parser_started_at, parser_completed_at, parser_error')
        .in('parser_status', ['pending', 'processing'])
        .order('id', { ascending: true })
        .limit(DocumentParsingWorker.BATCH_SIZE);

      if (cursor) {
        query = query.gt('id', cursor);
      }

      let { data: documents, error } = await query;

      if ((!documents || documents.length === 0) && cursor) {
        const wrapped = await createTenantScopedQueryById(tenantId, 'evidence_documents')
          .select('id, seller_id, filename, content_type, storage_path, parsed_metadata, parser_status, parser_started_at, parser_completed_at, parser_error')
          .in('parser_status', ['pending', 'processing'])
          .order('id', { ascending: true })
          .limit(DocumentParsingWorker.BATCH_SIZE);
        documents = wrapped.data;
        error = wrapped.error as any;
      }

      if (error) {
        logger.warn('❌ [DOCUMENT PARSING WORKER] Error fetching pending documents for tenant', {
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
        .select('id, seller_id, filename, content_type, storage_path, parsed_metadata, parser_status, parser_started_at, parser_completed_at, parser_error')
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

      // Update document status to processing
      await this.updateDocumentStatus(document.id, 'processing');

      // Parse document with retry logic
      const parsedData = await retryWithBackoff(async () => {
        return await documentParsingService.parseDocumentWithRetry(
          document.id,
          document.seller_id,
          3 // max retries
        );
      }, 2, 2000); // 2 additional retries at worker level

      if (!parsedData) {
        throw new Error('Parsing returned no data');
      }

      // Store parsed data
      await this.storeParsedData(document.id, document.seller_id, parsedData);

      // Update document status to completed
      await this.updateDocumentStatus(document.id, 'completed', parsedData.confidence_score);

      logger.info(`✅ [DOCUMENT PARSING WORKER] Successfully parsed document: ${document.id}`, {
        documentId: document.id,
        confidence: parsedData.confidence_score,
        extractionMethod: parsedData.extraction_method
      });

      // 🎯 SEND SSE EVENT FOR FRONTEND REAL-TIME LOG
      try {
        sseHub.sendEvent(document.seller_id, 'message', {
          type: 'parsing',
          status: 'completed',
          document_id: document.id,
          filename: document.filename,
          confidence: parsedData.confidence_score,
          extraction_method: parsedData.extraction_method,
          message: `Document parsed: ${document.filename || document.id}`,
          timestamp: new Date().toISOString()
        });
      } catch (sseError: any) {
        logger.debug('SSE event failed (non-critical)', { error: sseError.message });
      }

      // 🎯 AGENT 11 INTEGRATION: Log parsing event
      try {
        const agentEventLogger = (await import('../services/agentEventLogger')).default;
        const parsingStartTime = Date.now();
        await agentEventLogger.logDocumentParsing({
          userId: document.seller_id,
          documentId: document.id,
          success: true,
          confidence: parsedData.confidence_score || 0,
          extractionMethod: parsedData.extraction_method || 'unknown',
          duration: Date.now() - parsingStartTime
        });
      } catch (logError: any) {
        logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to log event', {
          error: logError.message
        });
      }

      // 🎯 AGENT 10 INTEGRATION: Notify when evidence is parsed
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

      // 🎯 SSE: Send real-time event to frontend
      try {
        const sseHub = (await import('../utils/sseHub')).default;
        sseHub.sendEvent(document.seller_id, 'parsing', {
          type: 'parsing',
          status: 'completed',
          document_id: document.id,
          confidence: parsedData?.confidence_score || 0,
          extraction_method: parsedData?.extraction_method || 'unknown',
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

      // 🎯 TRIGGER AGENT 6: Evidence Matching
      // Trigger matching for this user when document parsing completes
      try {
        const evidenceMatchingWorker = (await import('./evidenceMatchingWorker')).default;
        await evidenceMatchingWorker.triggerMatchingForParsedDocument(document.seller_id, tenantId);
        logger.info(`🔄 [DOCUMENT PARSING WORKER] Triggered evidence matching for user: ${document.seller_id}`);
      } catch (error: any) {
        // Non-blocking - matching can be triggered by scheduled worker
        logger.debug('⚠️ [DOCUMENT PARSING WORKER] Failed to trigger evidence matching (non-critical)', {
          error: error.message,
          userId: document.seller_id
        });
      }

      return { success: true };

    } catch (error: any) {
      // Log error
      await this.logError(document.id, document.seller_id, error);

      // Update document status to failed
      await this.updateDocumentStatus(document.id, 'failed', undefined, error.message);

      // Set parsed_metadata to a failure sentinel so the document isn't re-picked
      // (getPendingDocuments queries for parsed_metadata IS NULL)
      try {
        const client = supabaseAdmin || supabase;
        await client
          .from('evidence_documents')
          .update({
            parsed_metadata: {
              _parse_failed: true,
              parser_status: 'failed',
              parse_state: 'failed',
              error: (error.message || 'Unknown error').substring(0, 500),
              failed_at: new Date().toISOString(),
              retry_eligible: false
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', document.id);
      } catch (metaErr: any) {
        logger.debug('Could not set failure sentinel on parsed_metadata', { error: metaErr.message });
      }

      // Also track in memory to prevent re-processing in same process
      if (this.failedDocIds.size >= this.MAX_FAILED_CACHE) {
        const first = this.failedDocIds.values().next().value;
        if (first) this.failedDocIds.delete(first);
      }
      this.failedDocIds.add(document.id);

      logger.error(`❌ [DOCUMENT PARSING WORKER] Failed to parse document: ${document.id}`, {
        error: error.message,
        documentId: document.id
      });

      // 🎯 AGENT 11 INTEGRATION: Log parsing failure
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
    const parserStatus = doc.parser_status || 'pending';
    const contentType = doc.content_type?.toLowerCase() || '';
    const filename = doc.filename?.toLowerCase() || '';
    const isParsable =
      contentType.includes('pdf') ||
      filename.endsWith('.pdf') ||
      contentType.includes('text') ||
      filename.endsWith('.txt');

    if (parsedMetadata && !parsedMetadata._parse_failed) {
      if (parserStatus !== 'completed') {
        await this.updateDocumentStatus(doc.id, 'completed', parsedMetadata.confidence_score);
      }
      return 'completed';
    }

    if (parsedMetadata?._parse_failed) {
      if (parserStatus !== 'failed') {
        await this.updateDocumentStatus(doc.id, 'failed', undefined, parsedMetadata.error || 'Parsing failed');
      }
      return 'failed';
    }

    if (!isParsable) {
      await this.markDocumentFailed(doc.id, 'Unsupported document type for parser', 'not_parseable');
      return 'failed';
    }

    if (!doc.storage_path) {
      await this.markDocumentFailed(doc.id, 'Raw file missing from storage', 'not_parseable');
      return 'failed';
    }

    if (parserStatus === 'processing' && doc.parser_started_at) {
      const startedAtMs = Date.parse(doc.parser_started_at);
      if (!Number.isNaN(startedAtMs) && (Date.now() - startedAtMs) < this.MAX_PROCESSING_AGE_MS) {
        return 'processing';
      }
    }

    if (parserStatus !== 'pending') {
      await this.updateDocumentStatus(doc.id, 'pending');
    }

    return 'pending';
  }

  private async markDocumentFailed(
    documentId: string,
    errorMessage: string,
    parseState: 'failed' | 'not_parseable' = 'failed'
  ): Promise<void> {
    const client = supabaseAdmin || supabase;
    const now = new Date().toISOString();

    await client
      .from('evidence_documents')
      .update({
        parser_status: 'failed',
        parser_error: errorMessage,
        parser_completed_at: now,
        updated_at: now,
        parsed_metadata: {
          _parse_failed: true,
          parser_status: 'failed',
          parse_state: parseState,
          error: errorMessage.substring(0, 500),
          failed_at: now,
          retry_eligible: false
        }
      })
      .eq('id', documentId);
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
    parsedData: ParsedDocumentData
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;

      // Prepare structured JSON output including extracted arrays for frontend
      const structuredData = {
        parser_status: 'completed',
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
        parsed_at: new Date().toISOString(),
        // Extracted arrays for frontend display
        order_ids: parsedData.order_ids || [],
        asins: parsedData.asins || [],
        skus: parsedData.skus || [],
        tracking_numbers: parsedData.tracking_numbers || [],
        invoice_numbers: parsedData.invoice_numbers || [],
        amounts: parsedData.amounts || [],
        dates: parsedData.dates || []
      };

      // Update document with parsed metadata
      const updateData: any = {
        parsed_metadata: structuredData,
        updated_at: new Date().toISOString()
      };

      // Also update individual fields if they exist and are null
      if (parsedData.supplier_name && !structuredData.supplier_name) {
        updateData.supplier_name = parsedData.supplier_name;
      }
      if (parsedData.invoice_number && !structuredData.invoice_number) {
        updateData.invoice_number = parsedData.invoice_number;
      }
      if (parsedData.purchase_order_number && !structuredData.purchase_order_number) {
        updateData.purchase_order_number = parsedData.purchase_order_number;
      }
      if (parsedData.document_date || parsedData.invoice_date) {
        const dateStr = parsedData.document_date || parsedData.invoice_date;
        if (dateStr) {
          updateData.document_date = dateStr;
        }
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

      // Update extracted field with line items
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
          lineItemCount: parsedData.line_items?.length || 0
        });
      }

      // Also store in parser_job_results if table exists
      await this.storeParserJobResult(documentId, sellerId, structuredData, parsedData);

    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING WORKER] Error storing parsed data', {
        documentId,
        error: error.message
      });
    }
  }

  /**
   * Store parsing result in parser_job_results table (if exists)
   */
  private async storeParserJobResult(
    documentId: string,
    sellerId: string,
    structuredData: any,
    parsedData: ParsedDocumentData
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;

      // Check if parser_job_results table exists by trying to insert
      const { error: insertError } = await client
        .from('parser_job_results')
        .insert({
          document_id: documentId,
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
          extraction_method: parsedData.extraction_method || 'regex',
          confidence_score: parsedData.confidence_score || 0.0,
          processing_time_ms: 0 // Will be updated if available
        });

      if (insertError) {
        // Table might not exist - that's OK
        logger.debug('⚠️ [DOCUMENT PARSING WORKER] parser_job_results table may not exist', {
          documentId,
          error: insertError.message
        });
      }
    } catch (error: any) {
      // Non-critical - table may not exist
      logger.debug('⚠️ [DOCUMENT PARSING WORKER] Could not store parser job result', {
        documentId,
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

      // Try to insert into document_parsing_errors table
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
        // Table might not exist - log warning
        logger.warn('⚠️ [DOCUMENT PARSING WORKER] Failed to log error (table may not exist)', {
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
      logger.warn('⚠️ [DOCUMENT PARSING WORKER] Error logging error (non-critical)', {
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

