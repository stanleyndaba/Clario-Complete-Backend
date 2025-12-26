/**
 * Document Parsing Service
 * Wraps Python API document parsing endpoints with retry logic and error handling
 */

import axios, { AxiosError } from 'axios';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import { buildPythonServiceAuthHeader } from '../utils/pythonServiceAuth';

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

class DocumentParsingService {
  private pythonApiUrl: string;
  private maxRetries: number = 3;
  private baseDelay: number = 2000; // 2 seconds

  constructor() {
    // Get Python API URL from environment
    this.pythonApiUrl =
      process.env.PYTHON_API_URL ||
      process.env.API_URL ||
      'https://clario-complete-backend-7tgl.onrender.com';

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

      // Try multiple endpoint formats (Python API might use different paths)
      const endpoints = [
        `${this.pythonApiUrl}/api/v1/evidence/parse/${documentId}`,
        `${this.pythonApiUrl}/api/documents/${documentId}/parse`,
        `${this.pythonApiUrl}/api/v1/evidence/parse/${documentId}`
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
   */
  async getJobStatus(jobId: string, userId: string): Promise<ParsingJobStatus | null> {
    try {
      const endpoints = [
        `${this.pythonApiUrl}/api/v1/evidence/parse/jobs/${jobId}`,
        `${this.pythonApiUrl}/api/parse/jobs/${jobId}`
      ];

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
            return response.data.data;
          }
        } catch (error: any) {
          if (error.response?.status !== 404) {
            logger.debug('⚠️ [DOCUMENT PARSING] Status endpoint failed', {
              endpoint,
              error: error.message
            });
          }
        }
      }

      return null;
    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING] Failed to get job status', {
        jobId,
        userId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get parsed document data from Python API
   */
  async getParsedData(documentId: string, userId: string): Promise<ParsedDocumentData | null> {
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
            return response.data.data.parsed_metadata;
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

      return null;
    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING] Failed to get parsed data', {
        documentId,
        userId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Poll for parsing completion with retry logic
   */
  async waitForParsingCompletion(
    jobId: string,
    userId: string,
    maxWaitTime: number = 300000, // 5 minutes
    pollInterval: number = 5000 // 5 seconds
  ): Promise<ParsingJobStatus | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getJobStatus(jobId, userId);

      if (!status) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }

      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }

      // Still processing, wait and poll again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    logger.warn('⏱️ [DOCUMENT PARSING] Parsing timeout', {
      jobId,
      userId,
      maxWaitTime
    });
    return null;
  }

  /**
   * Parse document with retry logic and exponential backoff
   * Uses local pdfExtractor for PDFs (fast, no rate limits)
   * Falls back to Python API for other formats or if local parsing fails
   */
  async parseDocumentWithRetry(
    documentId: string,
    userId: string,
    maxRetries: number = 3
  ): Promise<ParsedDocumentData | null> {
    // First, try local PDF parsing (no rate limits, faster)
    try {
      const localResult = await this.parseDocumentLocally(documentId, userId);
      if (localResult) {
        logger.info('✅ [DOCUMENT PARSING] Parsed locally using pdfExtractor', {
          documentId,
          userId,
          confidence: localResult.confidence_score
        });
        return localResult;
      }
    } catch (localError: any) {
      logger.warn('⚠️ [DOCUMENT PARSING] Local parsing failed, will try Python API', {
        documentId,
        error: localError.message
      });
    }

    // Fallback to Python API (with retry logic)
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Trigger parsing
        const jobResponse = await this.triggerParsing(documentId, userId);

        if (!jobResponse.job_id) {
          throw new Error('No job ID returned from parsing API');
        }

        // Wait for completion
        const jobStatus = await this.waitForParsingCompletion(
          jobResponse.job_id,
          userId,
          300000, // 5 minutes max wait
          5000 // Poll every 5 seconds
        );

        if (!jobStatus) {
          throw new Error('Parsing job status not available');
        }

        if (jobStatus.status === 'failed') {
          throw new Error(jobStatus.error_message || 'Parsing failed');
        }

        if (jobStatus.status === 'completed') {
          // Get parsed data
          const parsedData = await this.getParsedData(documentId, userId);
          return parsedData;
        }

        // Still processing (shouldn't happen after waitForParsingCompletion)
        throw new Error('Parsing still in progress after timeout');

      } catch (error: any) {
        lastError = error;

        // If rate limited (429), don't retry API - just use local fallback result if any
        if (error.response?.status === 429) {
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
    throw lastError;
  }

  /**
   * Parse document locally using pdfExtractor
   * No external API calls - fast and no rate limits
   */
  private async parseDocumentLocally(
    documentId: string,
    userId: string
  ): Promise<ParsedDocumentData | null> {
    try {
      const client = supabaseAdmin || supabase;

      // Get document info
      const { data: doc, error: docError } = await client
        .from('evidence_documents')
        .select('id, storage_path, content_type, filename')
        .eq('id', documentId)
        .single();

      if (docError || !doc) {
        throw new Error(`Document not found: ${documentId}`);
      }

      // Check if document is parsable (PDF or TXT)
      const isPdf = doc.content_type?.includes('pdf') || doc.filename?.toLowerCase().endsWith('.pdf');
      const isTxt = doc.content_type?.includes('text') || doc.filename?.toLowerCase().endsWith('.txt');

      if (!isPdf && !isTxt) {
        logger.info('⏭️ [DOCUMENT PARSING] Not a parsable format (PDF/TXT), skipping local parsing', {
          documentId,
          contentType: doc.content_type,
          filename: doc.filename
        });
        return null;
      }

      if (!doc.storage_path) {
        logger.info('⏭️ [DOCUMENT PARSING] No storage path, skipping local parsing', {
          documentId
        });
        return null;
      }

      // Download file from Supabase Storage
      const { data: fileData, error: downloadError } = await client
        .storage
        .from('evidence-documents')
        .download(doc.storage_path);

      if (downloadError || !fileData) {
        throw new Error(`Failed to download document: ${downloadError?.message}`);
      }

      // Convert to Buffer
      const buffer = Buffer.from(await fileData.arrayBuffer());

      let rawText: string;

      if (isTxt) {
        // For text files, just read the content directly
        rawText = buffer.toString('utf8');
        logger.info('📄 [DOCUMENT PARSING] Extracted text from TXT file', {
          documentId,
          textLength: rawText.length
        });
      } else {
        // Use pdfExtractor for PDFs
        const pdfExtractor = (await import('../utils/pdfExtractor')).default;
        const extractionResult = await pdfExtractor.extractTextFromPdf(buffer);

        if (!extractionResult.success || !extractionResult.text) {
          throw new Error('PDF extraction failed');
        }
        rawText = extractionResult.text;
      }

      // Extract key fields using regex patterns
      const pdfExtractor = (await import('../utils/pdfExtractor')).default;
      const keyFields = pdfExtractor.extractKeyFieldsFromText(rawText);

      // Build parsed data including extracted arrays for frontend
      const parsedData: ParsedDocumentData = {
        raw_text: rawText.substring(0, 5000), // Limit stored text
        extraction_method: 'regex',
        confidence_score: 0.85, // Local extraction confidence
        // Supplier info (try to extract from text)
        supplier_name: this.extractSupplierName(rawText),
        invoice_number: keyFields.invoiceNumbers[0] || undefined,
        invoice_date: keyFields.dates[0] || undefined,
        total_amount: keyFields.amounts[0] ? parseFloat(keyFields.amounts[0].replace(/[^0-9.]/g, '')) : undefined,
        line_items: keyFields.orderIds.map((orderId, i) => ({
          sku: keyFields.skus[i] || keyFields.asins[i] || undefined,
          description: `Order: ${orderId}`,
          quantity: 1
        })).slice(0, 20), // Limit to 20 items
        // Extracted arrays for frontend display
        order_ids: keyFields.orderIds,
        asins: keyFields.asins,
        skus: keyFields.skus,
        tracking_numbers: keyFields.trackingNumbers,
        invoice_numbers: keyFields.invoiceNumbers,
        amounts: keyFields.amounts,
        dates: keyFields.dates
      };

      return parsedData;

    } catch (error: any) {
      logger.warn('⚠️ [DOCUMENT PARSING] Local parsing error', {
        documentId,
        error: error.message
      });
      throw error;
    }
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

