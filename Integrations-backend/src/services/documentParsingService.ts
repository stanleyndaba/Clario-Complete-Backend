/**
 * Document Parsing Service
 * Wraps Python API document parsing endpoints with retry logic and error handling
 */

import axios, { AxiosError } from 'axios';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import { buildPythonServiceAuthHeader } from '../utils/pythonServiceAuth';
import mcdeService from './mcdeService';

export interface ParsedDocumentData {
  supplier_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  purchase_order_number?: string;
  document_date?: string;
  currency?: string;
  total_amount?: number;
  tax_amount?: number;
  shipping_amount?: number;
  payment_terms?: string;
  line_items?: Array<{
    sku?: string;
    description?: string;
    quantity?: number;
    unit_price?: number;
    total?: number;
  }>;
  raw_text?: string;
  extraction_method?: 'regex' | 'ocr' | 'ml';
  confidence_score?: number;
  // Extracted arrays for frontend display
  order_ids?: string[];
  asins?: string[];
  skus?: string[];
  tracking_numbers?: string[];
  invoice_numbers?: string[];
  amounts?: string[];
  dates?: string[];
}

export interface ParsingJobResponse {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  message?: string;
  estimated_completion?: string;
}

export interface ParsingJobStatus {
  id: string;
  document_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';
  started_at?: string;
  completed_at?: string;
  retry_count?: number;
  max_retries?: number;
  error_message?: string;
  confidence_score?: number;
}

export type ParsingStrategy = 'FULL' | 'PARTIAL' | 'FAILED_DURABLE';

export interface ParsingExplanation {
  reason: string;
  completed_steps: string[];
  failed_steps: string[];
  preserved_outputs: string[];
}

export interface DocumentParsingOutcome {
  parsing_strategy: ParsingStrategy;
  parsing_explanation: ParsingExplanation;
  parsed_data: ParsedDocumentData;
}

interface ParsingJobLookupResult {
  outcome: 'found' | 'dead_job' | 'unreachable';
  status?: ParsingJobStatus;
  reason: string;
}

interface ParsedDataLookupResult {
  outcome: 'parsed' | 'missing' | 'unreachable';
  parsedData?: ParsedDocumentData;
  reason: string;
}

interface ParsingWaitOutcome {
  outcome: 'completed' | 'failed' | 'dead_job' | 'timed_out' | 'unreachable';
  status?: ParsingJobStatus;
  reason: string;
}

interface LocalParseAttemptResult {
  outcome: 'parsed' | 'skipped' | 'failed';
  parsedData?: ParsedDocumentData;
  reason: string;
}

class DocumentParsingService {
  private pythonApiUrl: string;
  private maxRetries: number = 3;
  private baseDelay: number = 2000; // 2 seconds
  // Track job IDs that have returned 404 to avoid re-polling them
  private deadJobIds: Set<string> = new Set();
  private readonly MAX_DEAD_JOBS = 500; // Cap memory usage

  constructor() {
    // Get Python API URL from environment
    this.pythonApiUrl =
      process.env.PYTHON_API_URL ||
      process.env.API_URL ||
      'https://docker-api-13.onrender.com';

    logger.info('📄 [DOCUMENT PARSING] Service initialized', {
      pythonApiUrl: this.pythonApiUrl
    });
  }

  private buildServiceHeaders(
    userId: string,
    context: string,
    extraHeaders: Record<string, string> = {}
  ): Record<string, string> {
    return {
      ...extraHeaders,
      Authorization: buildPythonServiceAuthHeader({
        userId,
        metadata: { source: `document-parsing:${context}` }
      })
    };
  }

  /**
   * Trigger parsing for a document via Python API
   */
  async triggerParsing(documentId: string, userId: string): Promise<ParsingJobResponse> {
    try {
      logger.info('🔄 [DOCUMENT PARSING] Triggering parsing', {
        documentId,
        userId
      });

      // Try endpoint formats (Python API might use different paths)
      const endpoints = [
        `${this.pythonApiUrl}/api/v1/evidence/parse/${documentId}`,
        `${this.pythonApiUrl}/api/documents/${documentId}/parse`
      ];

      let lastError: any;

      for (const endpoint of endpoints) {
        try {
          const response = await axios.post<ParsingJobResponse>(
            endpoint,
            {},
            {
              headers: this.buildServiceHeaders(userId, 'trigger', {
                'X-User-Id': userId,
                'Content-Type': 'application/json'
              }),
              timeout: 120000 // 120 seconds (increased for cold starts)
            }
          );

          if (response.status === 200 || response.status === 201) {
            logger.info('✅ [DOCUMENT PARSING] Parsing job created', {
              documentId,
              userId,
              jobId: response.data.job_id,
              endpoint
            });
            return response.data;
          }
        } catch (error: any) {
          lastError = error;
          // If 404, try next endpoint
          if (error.response?.status === 404) {
            continue;
          }
          // If other error, log and try next
          logger.debug('⚠️ [DOCUMENT PARSING] Endpoint failed, trying next', {
            endpoint,
            error: error.message
          });
        }
      }

      // All endpoints failed
      throw lastError || new Error('All parsing endpoints failed');

    } catch (error: any) {
      logger.error('❌ [DOCUMENT PARSING] Failed to trigger parsing', {
        documentId,
        userId,
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText
      });
      throw error;
    }
  }

  /**
   * Get parsing job status from Python API
   * Returns null immediately for job IDs already known to be dead (404).
   */
  async getJobStatus(jobId: string, userId: string): Promise<ParsingJobLookupResult> {
    if (this.deadJobIds.has(jobId)) {
      return {
        outcome: 'dead_job',
        reason: 'Job previously marked dead after repeated 404 polling'
      };
    }

    try {
      const endpoints = [
        `${this.pythonApiUrl}/api/v1/evidence/parse/jobs/${jobId}`,
        `${this.pythonApiUrl}/api/parse/jobs/${jobId}`
      ];

      let all404 = true;

      for (const endpoint of endpoints) {
        try {
          const response = await axios.get<{ ok: boolean; data: ParsingJobStatus }>(
            endpoint,
            {
              headers: this.buildServiceHeaders(userId, 'status', {
                'X-User-Id': userId
              }),
              timeout: 10000
            }
          );

          if (response.data?.ok && response.data.data) {
            return {
              outcome: 'found',
              status: response.data.data,
              reason: 'Remote parser job status fetched successfully'
            };
          }
          all404 = false;
        } catch (error: any) {
          if (error.response?.status === 404) {
            continue;
          }

          all404 = false;
          logger.debug('⚠️ [DOCUMENT PARSING] Status endpoint failed', {
            endpoint,
            error: error.message
          });
        }
      }

      if (all404) {
        this.markJobDead(jobId);
        return {
          outcome: 'dead_job',
          reason: 'All remote parser status endpoints returned 404'
        };
      }

      return {
        outcome: 'unreachable',
        reason: 'Remote parser status endpoints were unreachable or returned invalid payloads'
      };
    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING] Failed to get job status', {
        jobId,
        userId,
        error: error.message
      });
      return {
        outcome: 'unreachable',
        reason: error.message || 'Failed to get remote parser job status'
      };
    }
  }

  /**
   * Mark a job ID as dead to prevent further polling
   */
  private markJobDead(jobId: string): void {
    // Evict oldest entries if the set is too large
    if (this.deadJobIds.size >= this.MAX_DEAD_JOBS) {
      const first = this.deadJobIds.values().next().value;
      if (first) this.deadJobIds.delete(first);
    }
    this.deadJobIds.add(jobId);
  }

  /**
   * Get parsed document data from Python API
   */
  async getParsedData(documentId: string, userId: string): Promise<ParsedDataLookupResult> {
    try {
      const endpoints = [
        `${this.pythonApiUrl}/api/v1/evidence/documents/${documentId}`,
        `${this.pythonApiUrl}/api/documents/${documentId}`
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await axios.get<{ ok: boolean; data: { parsed_metadata?: ParsedDocumentData } }>(
            endpoint,
            {
              headers: this.buildServiceHeaders(userId, 'get-doc', {
                'X-User-Id': userId
              }),
              timeout: 10000
            }
          );

          if (response.data?.ok && response.data.data?.parsed_metadata) {
            return {
              outcome: 'parsed',
              parsedData: response.data.data.parsed_metadata,
              reason: 'Remote parser document payload loaded successfully'
            };
          }
        } catch (error: any) {
          if (error.response?.status !== 404) {
            logger.debug('⚠️ [DOCUMENT PARSING] Get document endpoint failed', {
              endpoint,
              error: error.message
            });
          }
        }
      }

      return {
        outcome: 'missing',
        reason: 'Remote parser reported completion but no parsed payload was available'
      };
    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING] Failed to get parsed data', {
        documentId,
        userId,
        error: error.message
      });
      return {
        outcome: 'unreachable',
        reason: error.message || 'Failed to fetch parsed document data'
      };
    }
  }

  /**
   * Poll for parsing completion with retry logic.
   * Bails out early after MAX_CONSECUTIVE_NULLS polls that all return null (404).
   * Uses exponential backoff on the poll interval.
   */
  async waitForParsingCompletion(
    jobId: string,
    userId: string,
    maxWaitTime: number = 120000,
    pollInterval: number = 5000
  ): Promise<ParsingWaitOutcome> {
    const startTime = Date.now();
    const MAX_CONSECUTIVE_FAILURES = 5;
    let consecutiveFailures = 0;
    let currentInterval = pollInterval;

    while (Date.now() - startTime < maxWaitTime) {
      const statusLookup = await this.getJobStatus(jobId, userId);

      if (statusLookup.outcome === 'dead_job') {
        logger.warn('⏹️ [DOCUMENT PARSING] Bailing out — remote parser job is dead', {
          jobId,
          userId,
          reason: statusLookup.reason
        });
        return {
          outcome: 'dead_job',
          reason: statusLookup.reason
        };
      }

      if (statusLookup.outcome === 'unreachable') {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.warn('⏹️ [DOCUMENT PARSING] Bailing out — job status endpoint unreachable', {
            jobId,
            userId,
            consecutiveFailures,
            reason: statusLookup.reason
          });
          this.markJobDead(jobId);
          return {
            outcome: 'unreachable',
            reason: `Remote parser polling exceeded failure limit: ${statusLookup.reason}`
          };
        }

        await new Promise(resolve => setTimeout(resolve, currentInterval));
        currentInterval = Math.min(currentInterval * 2, 60000);
        continue;
      }

      const status = statusLookup.status;
      consecutiveFailures = 0;

      if (!status) {
        return {
          outcome: 'unreachable',
          reason: 'Remote parser returned an empty status payload'
        };
      }

      if (status.status === 'completed') {
        return {
          outcome: 'completed',
          status,
          reason: 'Remote parser job completed'
        };
      }

      if (status.status === 'failed') {
        return {
          outcome: 'failed',
          status,
          reason: status.error_message || 'Remote parser job failed'
        };
      }

      await new Promise(resolve => setTimeout(resolve, currentInterval));
    }

    logger.warn('⏱️ [DOCUMENT PARSING] Parsing timeout', {
      jobId,
      userId,
      maxWaitTime
    });
    return {
      outcome: 'timed_out',
      reason: `Remote parser polling exceeded ${maxWaitTime}ms`
    };
  }

  /**
   * Parse document with retry logic and exponential backoff
   * Uses local pdfExtractor for PDFs (fast, no rate limits)
   * Uses MCDE for images and scanned PDFs (OCR, Chinese support)
   * Falls back to Python API for other formats or if local parsing fails
   */
  async parseDocumentWithRetry(
    documentId: string,
    userId: string,
    maxRetries: number = 3
  ): Promise<DocumentParsingOutcome> {
    const client = supabaseAdmin || supabase;
    const completedSteps: string[] = ['load_document_context'];
    const failedSteps: string[] = [];

    const { data: doc } = await client
      .from('evidence_documents')
      .select('id, storage_path, content_type, filename, raw_text, extracted, metadata, parsed_metadata, supplier_name, invoice_number, total_amount, document_date, currency')
      .eq('id', documentId)
      .single();

    if (!doc) {
      return this.buildOutcome(
        'FAILED_DURABLE',
        {},
        'Document record was missing when parsing started',
        completedSteps,
        ['load_document_context']
      );
    }

    let bestPartialOutcome = this.createOutcomeFromPersistedHints(
      doc,
      'Using previously preserved evidence hints because parsing could not complete fully',
      completedSteps,
      []
    );

    const localResult = await this.parseDocumentLocally(documentId, userId);
    if (localResult.outcome === 'parsed' && localResult.parsedData) {
      const localStrategy = this.inferParsingStrategy(localResult.parsedData);
      const localOutcome = this.buildOutcome(
        localStrategy,
        localResult.parsedData,
        localStrategy === 'FULL'
          ? 'Local parser completed successfully'
          : 'Local parser completed with partial structured extraction',
        [...completedSteps, 'local_parse'],
        failedSteps
      );
      logger.info('[DOCUMENT PARSING] Parsed locally using pdfExtractor', {
        documentId,
        userId,
        confidence: localResult.parsedData.confidence_score,
        parsingStrategy: localOutcome.parsing_strategy
      });

      if (localOutcome.parsing_strategy === 'FULL') {
        return localOutcome;
      }

      bestPartialOutcome = this.preferPartialOutcome(bestPartialOutcome, localOutcome);
    } else if (localResult.outcome === 'failed') {
      failedSteps.push('local_parse');
      logger.warn('[DOCUMENT PARSING] Local parsing failed, will try MCDE/Python API', {
        documentId,
        error: localResult.reason
      });
    }

    if (mcdeService.isEnabled() && doc.filename) {
      const needsOCR = mcdeService.needsOCR(doc.filename, doc.content_type);

      if (needsOCR || doc.content_type?.includes('image')) {
        try {
          logger.info('[DOCUMENT PARSING] Trying MCDE OCR for image/scanned document', {
            documentId,
            filename: doc.filename
          });

          if (doc.storage_path) {
            const { data: fileData } = await client
              .storage
              .from('evidence-documents')
              .download(doc.storage_path);

            if (fileData) {
              const buffer = Buffer.from(await fileData.arrayBuffer());
              const uploadResult = await mcdeService.uploadDocument(
                buffer,
                doc.filename,
                userId,
                'invoice'
              );

              if (uploadResult?.document_id) {
                const ocrResult = await mcdeService.extractWithOCR(
                  uploadResult.document_id,
                  userId
                );

                if (ocrResult && ocrResult.text) {
                  logger.info('[DOCUMENT PARSING] MCDE OCR extraction successful', {
                    documentId,
                    confidence: ocrResult.confidence,
                    hasCostComponents: !!ocrResult.cost_components
                  });

                  const parsedData: ParsedDocumentData & { cost_components?: any; unit_manufacturing_cost?: number } = {
                    raw_text: ocrResult.text.substring(0, 5000),
                    extraction_method: 'ocr',
                    confidence_score: ocrResult.confidence,
                    supplier_name: ocrResult.supplier_name,
                    invoice_number: ocrResult.invoice_number,
                    invoice_date: ocrResult.invoice_date,
                    total_amount: ocrResult.total_amount,
                    currency: ocrResult.currency,
                    line_items: ocrResult.line_items,
                  };

                  if (ocrResult.cost_components) {
                    parsedData.cost_components = ocrResult.cost_components;
                    parsedData.unit_manufacturing_cost =
                      ocrResult.cost_components.unit_manufacturing_cost;
                  }

                  const mcdeStrategy = this.inferParsingStrategy(parsedData);
                  const mcdeOutcome = this.buildOutcome(
                    mcdeStrategy,
                    parsedData,
                    mcdeStrategy === 'FULL'
                      ? 'MCDE OCR completed successfully'
                      : 'MCDE OCR preserved partial extraction outputs',
                    [...completedSteps, 'mcde_ocr'],
                    failedSteps
                  );

                  if (mcdeOutcome.parsing_strategy === 'FULL') {
                    return mcdeOutcome;
                  }

                  bestPartialOutcome = this.preferPartialOutcome(bestPartialOutcome, mcdeOutcome);
                }
              }
            }
          }
        } catch (mcdeError) {
          failedSteps.push('mcde_ocr');
          logger.warn('[DOCUMENT PARSING] MCDE OCR failed, falling back to Python API', {
            documentId,
            error: mcdeError.message
          });
        }
      }
    }

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const jobResponse = await this.triggerParsing(documentId, userId);

        if (!jobResponse.job_id) {
          throw new Error('No job ID returned from parsing API');
        }

        const jobStatus = await this.waitForParsingCompletion(
          jobResponse.job_id,
          userId,
          300000,
          5000
        );

        if (jobStatus.outcome === 'failed') {
          failedSteps.push('remote_job_failed');
          throw new Error(jobStatus.reason);
        }

        if (jobStatus.outcome === 'completed') {
          const parsedDataLookup = await this.getParsedData(documentId, userId);

          if (parsedDataLookup.outcome === 'parsed' && parsedDataLookup.parsedData) {
            const remoteStrategy = this.inferParsingStrategy(parsedDataLookup.parsedData);
            const remoteOutcome = this.buildOutcome(
              remoteStrategy,
              parsedDataLookup.parsedData,
              remoteStrategy === 'FULL'
                ? 'Remote parser completed successfully'
                : 'Remote parser completed with partial extraction outputs',
              [...completedSteps, 'remote_trigger', 'remote_polling', 'remote_payload_fetch'],
              failedSteps
            );

            if (remoteOutcome.parsing_strategy === 'FULL') {
              return remoteOutcome;
            }

            bestPartialOutcome = this.preferPartialOutcome(bestPartialOutcome, remoteOutcome);
            return remoteOutcome;
          }

          failedSteps.push('remote_payload_fetch');
          throw new Error(parsedDataLookup.reason);
        }

        failedSteps.push('remote_polling');
        throw new Error(jobStatus.reason);
      } catch (error: any) {
        lastError = error;

        if (error.response?.status === 429) {
          failedSteps.push('remote_rate_limited');
          logger.warn('🚫 [DOCUMENT PARSING] Rate limited by Python API, skipping retries', {
            documentId,
            userId
          });
          break;
        }

        if (attempt < maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt);
          logger.warn(`🔄 [DOCUMENT PARSING] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
            documentId,
            userId,
            error: error.message,
            delay
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logger.error('❌ [DOCUMENT PARSING] All retry attempts exhausted', {
      documentId,
      userId,
      error: lastError?.message
    });

    if (bestPartialOutcome) {
      return this.buildOutcome(
        'PARTIAL',
        bestPartialOutcome.parsed_data,
        bestPartialOutcome.parsing_explanation.reason,
        [...completedSteps, ...bestPartialOutcome.parsing_explanation.completed_steps],
        [...failedSteps, ...bestPartialOutcome.parsing_explanation.failed_steps]
      );
    }

    return this.buildOutcome(
      'FAILED_DURABLE',
      {},
      lastError?.message || 'All parser strategies failed without preserving usable outputs',
      completedSteps,
      failedSteps.length > 0 ? failedSteps : ['parsing_runtime']
    );
  }

  /**
   * Parse document locally using pdfExtractor
   * No external API calls - fast and no rate limits
   */
  private async parseDocumentLocally(
    documentId: string,
    userId: string
  ): Promise<LocalParseAttemptResult> {
    try {
      const client = supabaseAdmin || supabase;

      const { data: doc, error: docError } = await client
        .from('evidence_documents')
        .select('id, storage_path, content_type, filename')
        .eq('id', documentId)
        .single();

      if (docError || !doc) {
        return {
          outcome: 'failed',
          reason: `Document not found: ${documentId}`
        };
      }

      const isPdf = doc.content_type?.includes('pdf') || doc.filename?.toLowerCase().endsWith('.pdf');
      const isTxt = doc.content_type?.includes('text') || doc.filename?.toLowerCase().endsWith('.txt');

      if (!isPdf && !isTxt) {
        logger.info('⏭️ [DOCUMENT PARSING] Not a parsable format (PDF/TXT), skipping local parsing', {
          documentId,
          contentType: doc.content_type,
          filename: doc.filename
        });
        return {
          outcome: 'skipped',
          reason: 'Local parser only supports PDF and TXT documents'
        };
      }

      if (!doc.storage_path) {
        logger.info('⏭️ [DOCUMENT PARSING] No storage path, skipping local parsing', {
          documentId
        });
        return {
          outcome: 'skipped',
          reason: 'Raw file is unavailable in storage for local parsing'
        };
      }

      const { data: fileData, error: downloadError } = await client
        .storage
        .from('evidence-documents')
        .download(doc.storage_path);

      if (downloadError || !fileData) {
        throw new Error(`Failed to download document: ${downloadError?.message}`);
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      let rawText: string;

      if (isTxt) {
        rawText = buffer.toString('utf8');
        logger.info('📄 [DOCUMENT PARSING] Extracted text from TXT file', {
          documentId,
          textLength: rawText.length
        });
      } else {
        const pdfExtractor = (await import('../utils/pdfExtractor')).default;
        const extractionResult = await pdfExtractor.extractTextFromPdf(buffer);

        if (!extractionResult.success || !extractionResult.text) {
          throw new Error('PDF extraction failed');
        }
        rawText = extractionResult.text;
      }

      const pdfExtractor = (await import('../utils/pdfExtractor')).default;
      const keyFields = pdfExtractor.extractKeyFieldsFromText(rawText);

      const parsedData: ParsedDocumentData = {
        raw_text: rawText.substring(0, 5000),
        extraction_method: 'regex',
        confidence_score: 0.85,
        supplier_name: this.extractSupplierName(rawText),
        invoice_number: keyFields.invoiceNumbers[0] || undefined,
        invoice_date: keyFields.dates[0] || undefined,
        total_amount: keyFields.amounts[0] ? parseFloat(keyFields.amounts[0].replace(/[^0-9.]/g, '')) : undefined,
        line_items: keyFields.orderIds.map((orderId, i) => ({
          sku: keyFields.skus[i] || keyFields.asins[i] || undefined,
          description: `Order: ${orderId}`,
          quantity: 1
        })).slice(0, 20),
        order_ids: keyFields.orderIds,
        asins: keyFields.asins,
        skus: keyFields.skus,
        tracking_numbers: keyFields.trackingNumbers,
        invoice_numbers: keyFields.invoiceNumbers,
        amounts: keyFields.amounts,
        dates: keyFields.dates
      };

      return {
        outcome: 'parsed',
        parsedData,
        reason: 'Local parser produced a deterministic extraction payload'
      };
    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING] Local parsing error', {
        documentId,
        error: error.message
      });
      return {
        outcome: 'failed',
        reason: error.message || 'Local parsing failed'
      };
    }
  }

  public createOutcomeFromPersistedHints(
    document: any,
    reason: string,
    completedSteps: string[] = [],
    failedSteps: string[] = []
  ): DocumentParsingOutcome | null {
    const parsedData = this.buildParsedDataFromDocument(document);
    if (!this.hasUsableParsedData(parsedData)) {
      return null;
    }

    return this.buildOutcome('PARTIAL', parsedData, reason, completedSteps, failedSteps);
  }

  private buildParsedDataFromDocument(document: any): ParsedDocumentData {
    const parsedMetadata = document?.parsed_metadata || {};
    const metadata = document?.metadata || {};
    const nestedParsedData = metadata?.parsed_data || metadata?.parsed_metadata || {};
    const extracted = document?.extracted || {};

    const normalizeArray = (value: any): string[] => Array.isArray(value)
      ? value.map((item: any) => String(item)).filter(Boolean)
      : [];

    return {
      supplier_name: parsedMetadata.supplier_name || document?.supplier_name || nestedParsedData.supplier_name || nestedParsedData.supplier,
      invoice_number: parsedMetadata.invoice_number || document?.invoice_number || nestedParsedData.invoice_number || nestedParsedData.invoice_no,
      invoice_date: parsedMetadata.invoice_date || document?.document_date || nestedParsedData.invoice_date,
      document_date: parsedMetadata.document_date || document?.document_date || nestedParsedData.document_date,
      currency: parsedMetadata.currency || document?.currency || nestedParsedData.currency,
      total_amount: parsedMetadata.total_amount ?? document?.total_amount ?? nestedParsedData.total_amount ?? nestedParsedData.total ?? nestedParsedData.amount,
      payment_terms: parsedMetadata.payment_terms || nestedParsedData.payment_terms,
      line_items: parsedMetadata.line_items || nestedParsedData.line_items || nestedParsedData.items || extracted.items || [],
      raw_text: parsedMetadata.raw_text || document?.raw_text || nestedParsedData.raw_text || metadata?.text_excerpt,
      extraction_method: parsedMetadata.extraction_method || nestedParsedData.extraction_method || metadata?.parser_type || metadata?.parsedVia,
      confidence_score: parsedMetadata.confidence_score || nestedParsedData.confidence_score,
      order_ids: normalizeArray(parsedMetadata.order_ids || extracted.order_ids || nestedParsedData.order_ids),
      asins: normalizeArray(parsedMetadata.asins || extracted.asins || nestedParsedData.asins),
      skus: normalizeArray(parsedMetadata.skus || extracted.skus || nestedParsedData.skus),
      tracking_numbers: normalizeArray(parsedMetadata.tracking_numbers || extracted.tracking_numbers || nestedParsedData.tracking_numbers),
      invoice_numbers: normalizeArray(parsedMetadata.invoice_numbers || extracted.invoice_numbers || nestedParsedData.invoice_numbers),
      amounts: normalizeArray(parsedMetadata.amounts || extracted.amounts || nestedParsedData.amounts),
      dates: normalizeArray(parsedMetadata.dates || extracted.dates || nestedParsedData.dates)
    };
  }

  private buildOutcome(
    strategy: ParsingStrategy,
    parsedData: ParsedDocumentData,
    reason: string,
    completedSteps: string[],
    failedSteps: string[]
  ): DocumentParsingOutcome {
    return {
      parsing_strategy: strategy,
      parsing_explanation: {
        reason,
        completed_steps: Array.from(new Set(completedSteps.filter(Boolean))),
        failed_steps: Array.from(new Set(failedSteps.filter(Boolean))),
        preserved_outputs: this.listPreservedOutputs(parsedData)
      },
      parsed_data: parsedData
    };
  }

  private inferParsingStrategy(parsedData: ParsedDocumentData): ParsingStrategy {
    const structuredSignals = this.countStructuredSignals(parsedData);
    const preservedOutputs = this.listPreservedOutputs(parsedData);

    if (structuredSignals >= 3 || (structuredSignals >= 2 && preservedOutputs.length >= 4)) {
      return 'FULL';
    }

    return 'PARTIAL';
  }

  private preferPartialOutcome(
    current: DocumentParsingOutcome | null,
    candidate: DocumentParsingOutcome | null
  ): DocumentParsingOutcome | null {
    if (!candidate) return current;
    if (!current) return candidate;

    const currentScore = this.scoreOutcome(current);
    const candidateScore = this.scoreOutcome(candidate);
    return candidateScore >= currentScore ? candidate : current;
  }

  private scoreOutcome(outcome: DocumentParsingOutcome): number {
    const preservedOutputCount = outcome.parsing_explanation.preserved_outputs.length;
    const confidence = outcome.parsed_data.confidence_score || 0;
    return preservedOutputCount + confidence;
  }

  private countStructuredSignals(parsedData: ParsedDocumentData): number {
    let signals = 0;
    if (parsedData.supplier_name) signals += 1;
    if (parsedData.invoice_number) signals += 1;
    if (parsedData.invoice_date || parsedData.document_date) signals += 1;
    if (typeof parsedData.total_amount === 'number') signals += 1;
    if ((parsedData.line_items || []).length > 0) signals += 1;
    if ((parsedData.order_ids || []).length > 0) signals += 1;
    if ((parsedData.asins || []).length > 0) signals += 1;
    if ((parsedData.skus || []).length > 0) signals += 1;
    if ((parsedData.tracking_numbers || []).length > 0) signals += 1;
    if ((parsedData.invoice_numbers || []).length > 0) signals += 1;
    if ((parsedData.amounts || []).length > 0) signals += 1;
    if ((parsedData.dates || []).length > 0) signals += 1;
    return signals;
  }

  private hasUsableParsedData(parsedData: ParsedDocumentData): boolean {
    return this.listPreservedOutputs(parsedData).length > 0;
  }

  private listPreservedOutputs(parsedData: ParsedDocumentData): string[] {
    const preserved: string[] = [];
    if (parsedData.raw_text) preserved.push('raw_text');
    if (parsedData.supplier_name) preserved.push('supplier_name');
    if (parsedData.invoice_number) preserved.push('invoice_number');
    if (parsedData.invoice_date || parsedData.document_date) preserved.push('document_date');
    if (typeof parsedData.total_amount === 'number') preserved.push('total_amount');
    if (parsedData.currency) preserved.push('currency');
    if ((parsedData.line_items || []).length > 0) preserved.push('line_items');
    if ((parsedData.order_ids || []).length > 0) preserved.push('order_ids');
    if ((parsedData.asins || []).length > 0) preserved.push('asins');
    if ((parsedData.skus || []).length > 0) preserved.push('skus');
    if ((parsedData.tracking_numbers || []).length > 0) preserved.push('tracking_numbers');
    if ((parsedData.invoice_numbers || []).length > 0) preserved.push('invoice_numbers');
    if ((parsedData.amounts || []).length > 0) preserved.push('amounts');
    if ((parsedData.dates || []).length > 0) preserved.push('dates');
    return preserved;
  }

  /**
   * Try to extract supplier name from text
   */
  private extractSupplierName(text: string): string | undefined {
    // Common patterns for supplier/company names
    const patterns = [
      /(?:from|seller|vendor|supplier)[:\s]+([A-Z][A-Za-z\s&.,]+?)(?:\n|$)/i,
      /(?:invoice from|bill from)[:\s]+([A-Z][A-Za-z\s&.,]+?)(?:\n|$)/i,
      /^([A-Z][A-Za-z\s&.,]{3,30})\n/m, // First line that looks like a company name
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        if (name.length >= 3 && name.length <= 50) {
          return name;
        }
      }
    }

    return undefined;
  }
}

export const documentParsingService = new DocumentParsingService();
export default documentParsingService;

