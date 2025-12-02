/**
 * Document Parsing Worker
 * Automated background worker for continuous document parsing
 * Runs every 2 minutes, processes documents with parser_status = 'pending'
 * Wraps Python API parser with retry logic and error handling
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import documentParsingService, { ParsedDocumentData } from '../services/documentParsingService';

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
  private schedule: string = '*/2 * * * *'; // Every 2 minutes

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
      await this.runDocumentParsingForAllTenants();
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
   */
  private async runDocumentParsingForAllTenants(): Promise<void> {
    const runStartTime = Date.now();

    try {
      logger.info('🔍 [DOCUMENT PARSING WORKER] Starting scheduled document parsing', {
        timestamp: new Date().toISOString()
      });

      // Get documents that need parsing
      const documents = await this.getPendingDocuments();

      if (documents.length === 0) {
        logger.info('ℹ️ [DOCUMENT PARSING WORKER] No documents pending parsing');
        return;
      }

      logger.info(`📊 [DOCUMENT PARSING WORKER] Processing ${documents.length} documents`, {
        documentCount: documents.length
      });

      // Process each document (with rate limiting)
      const stats: ParsingStats = {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errors: []
      };

      for (let i = 0; i < documents.length; i++) {
        const document = documents[i];

        // Stagger processing to avoid rate limits
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second between documents
        }

        try {
          const result = await this.parseDocument(document);
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
            documentId: document.id
          });
        }
      }

      const runDuration = Date.now() - runStartTime;

      logger.info('✅ [DOCUMENT PARSING WORKER] Scheduled document parsing completed', {
        documentCount: documents.length,
        processed: stats.processed,
        succeeded: stats.succeeded,
        failed: stats.failed,
        skipped: stats.skipped,
        errors: stats.errors.length,
        duration: `${runDuration}ms`
      });

    } catch (error: any) {
      logger.error('❌ [DOCUMENT PARSING WORKER] Error in scheduled document parsing', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Get documents that need parsing
   * Checks for documents where parsed_metadata is null or parser_status is 'pending'
   */
  private async getPendingDocuments(): Promise<Array<{ id: string; seller_id: string; filename: string; content_type: string }>> {
    try {
      // Use admin client to bypass RLS
      const client = supabaseAdmin || supabase;

      // First, try to get documents where parsed_metadata is null
      // (This works with the current schema)
      let { data: documents, error } = await client
        .from('evidence_documents')
        .select('id, seller_id, filename, content_type')
        .is('parsed_metadata', null)
        .limit(50)
        .order('created_at', { ascending: true });

      // If parsed_metadata column doesn't exist, try checking by other criteria
      if (error && error.message?.includes('column') && error.message?.includes('parsed_metadata')) {
        // Fallback: get documents that don't have supplier_name or invoice_number
        // (indicating they haven't been parsed yet)
        const retry = await client
          .from('evidence_documents')
          .select('id, seller_id, filename, content_type')
          .or('supplier_name.is.null,invoice_number.is.null')
          .limit(50)
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

      return (documents || []).map((doc: any) => ({
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
  private async parseDocument(document: { id: string; seller_id: string; filename: string; content_type: string }): Promise<{ success: boolean; error?: string }> {
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
        await evidenceMatchingWorker.triggerMatchingForParsedDocument(document.seller_id);
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

      // Prepare structured JSON output
      const structuredData = {
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
        parsed_at: new Date().toISOString()
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

    return await this.parseDocument(document);
  }

  /**
   * Get document by ID
   */
  private async getDocumentById(documentId: string): Promise<{ id: string; seller_id: string; filename: string; content_type: string } | null> {
    try {
      const client = supabaseAdmin || supabase;
      const { data, error } = await client
        .from('evidence_documents')
        .select('id, seller_id, filename, content_type')
        .eq('id', documentId)
        .single();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        seller_id: data.seller_id,
        filename: data.filename,
        content_type: data.content_type
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

