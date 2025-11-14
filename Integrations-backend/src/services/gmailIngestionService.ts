/**
 * Gmail Ingestion Service
 * Handles ingestion of evidence documents from Gmail
 * Integrates with evidence ingestion pipeline
 */

import logger from '../utils/logger';
import { GmailService } from './gmailService';
import { supabase } from '../database/supabaseClient';
import axios from 'axios';

export interface GmailIngestionResult {
  success: boolean;
  documentsIngested: number;
  emailsProcessed: number;
  errors: string[];
  jobId?: string;
}

export interface GmailDocument {
  id: string;
  emailId: string;
  subject: string;
  from: string;
  date: string;
  filename: string;
  contentType: string;
  size: number;
  downloadUrl?: string;
  content?: Buffer;
}

export class GmailIngestionService {
  private gmailService: GmailService;

  constructor() {
    this.gmailService = new GmailService();
  }

  /**
   * Ingest evidence documents from Gmail
   * Searches for invoice/receipt emails and extracts attachments
   */
  async ingestEvidenceFromGmail(
    userId: string,
    options: {
      query?: string;
      maxResults?: number;
      autoParse?: boolean;
    } = {}
  ): Promise<GmailIngestionResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let documentsIngested = 0;
    let emailsProcessed = 0;

    try {
      logger.info('🔍 [GMAIL INGESTION] Starting evidence ingestion from Gmail', {
        userId,
        query: options.query,
        maxResults: options.maxResults || 50
      });

      // Default query: search for invoices, receipts, FBA reports
      const defaultQuery = options.query || 
        'from:amazon.com OR from:amazon.co.uk OR subject:(invoice OR receipt OR "FBA" OR "reimbursement" OR "refund") has:attachment';

      // Fetch emails from Gmail
      const emails = await this.gmailService.fetchEmails(
        userId,
        defaultQuery,
        options.maxResults || 50
      );

      logger.info(`✅ [GMAIL INGESTION] Fetched ${emails.length} emails from Gmail`, {
        userId,
        emailCount: emails.length
      });

      emailsProcessed = emails.length;

      // Process each email
      for (const email of emails) {
        try {
          if (!email.hasAttachments) {
            logger.debug('⏭️ [GMAIL INGESTION] Email has no attachments, skipping', {
              emailId: email.id,
              subject: email.subject
            });
            continue;
          }

          // Extract attachments from email
          const attachments = await this.extractAttachmentsFromEmail(userId, email.id);

          if (attachments.length === 0) {
            logger.debug('⏭️ [GMAIL INGESTION] No attachments found in email', {
              emailId: email.id,
              subject: email.subject
            });
            continue;
          }

          logger.info(`📎 [GMAIL INGESTION] Found ${attachments.length} attachments in email`, {
            emailId: email.id,
            subject: email.subject,
            attachmentCount: attachments.length
          });

          // Store each attachment as evidence document
          for (const attachment of attachments) {
            try {
              const documentId = await this.storeEvidenceDocument(userId, email, attachment);
              
              if (documentId) {
                documentsIngested++;
                logger.info('✅ [GMAIL INGESTION] Stored evidence document', {
                  documentId,
                  emailId: email.id,
                  filename: attachment.filename,
                  userId
                });

                // If auto-parse is enabled, trigger parsing pipeline
                if (options.autoParse) {
                  await this.triggerParsingPipeline(documentId, userId);
                }
              }
            } catch (error: any) {
              const errorMsg = `Failed to store attachment ${attachment.filename}: ${error?.message || String(error)}`;
              errors.push(errorMsg);
              logger.error('❌ [GMAIL INGESTION] Error storing attachment', {
                error: errorMsg,
                emailId: email.id,
                filename: attachment.filename,
                userId
              });
            }
          }
        } catch (error: any) {
          const errorMsg = `Failed to process email ${email.id}: ${error?.message || String(error)}`;
          errors.push(errorMsg);
          logger.error('❌ [GMAIL INGESTION] Error processing email', {
            error: errorMsg,
            emailId: email.id,
            userId
          });
        }
      }

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('✅ [GMAIL INGESTION] Evidence ingestion completed', {
        userId,
        documentsIngested,
        emailsProcessed,
        errors: errors.length,
        elapsedTime: `${elapsedTime}s`
      });

      return {
        success: errors.length === 0,
        documentsIngested,
        emailsProcessed,
        errors
      };
    } catch (error: any) {
      logger.error('❌ [GMAIL INGESTION] Critical error in evidence ingestion', {
        error: error?.message || String(error),
        stack: error?.stack,
        userId
      });

      return {
        success: false,
        documentsIngested,
        emailsProcessed,
        errors: [error?.message || String(error)]
      };
    }
  }

  /**
   * Extract attachments from a Gmail email
   */
  private async extractAttachmentsFromEmail(
    userId: string,
    emailId: string
  ): Promise<GmailDocument[]> {
    try {
      const accessToken = await this.gmailService.getValidAccessToken(userId);
      const baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me';

      // Get full email message
      const messageResponse = await axios.get(`${baseUrl}/messages/${emailId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { format: 'full' }
      });

      const message = messageResponse.data;
      const attachments: GmailDocument[] = [];

      // Recursively extract attachments from message parts
      const extractParts = (parts: any[], emailData: any) => {
        for (const part of parts) {
          if (part.filename && part.body?.attachmentId) {
            attachments.push({
              id: part.body.attachmentId,
              emailId: emailId,
              subject: emailData.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || 'No Subject',
              from: emailData.payload?.headers?.find((h: any) => h.name === 'From')?.value || 'Unknown',
              date: new Date(parseInt(emailData.internalDate)).toISOString(),
              filename: part.filename,
              contentType: part.mimeType || 'application/octet-stream',
              size: part.body.size || 0
            });
          }

          if (part.parts) {
            extractParts(part.parts, emailData);
          }
        }
      };

      if (message.payload?.parts) {
        extractParts(message.payload.parts, message);
      } else if (message.payload?.filename && message.payload?.body?.attachmentId) {
        // Single attachment
        attachments.push({
          id: message.payload.body.attachmentId,
          emailId: emailId,
          subject: message.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || 'No Subject',
          from: message.payload?.headers?.find((h: any) => h.name === 'From')?.value || 'Unknown',
          date: new Date(parseInt(message.internalDate)).toISOString(),
          filename: message.payload.filename,
          contentType: message.payload.mimeType || 'application/octet-stream',
          size: message.payload.body.size || 0
        });
      }

      // Download attachment content for each attachment
      for (const attachment of attachments) {
        try {
          const attachmentResponse = await axios.get(
            `${baseUrl}/messages/${emailId}/attachments/${attachment.id}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` }
            }
          );

          // Gmail API returns base64-encoded data in response.data.data
          const base64Data = attachmentResponse.data.data;
          if (base64Data) {
            // Decode base64 to buffer
            attachment.content = Buffer.from(base64Data, 'base64');
            attachment.downloadUrl = `data:${attachment.contentType};base64,${base64Data}`;
          }
        } catch (error: any) {
          logger.warn('⚠️ [GMAIL INGESTION] Failed to download attachment content', {
            error: error?.message,
            attachmentId: attachment.id,
            emailId
          });
        }
      }

      return attachments;
    } catch (error: any) {
      logger.error('❌ [GMAIL INGESTION] Error extracting attachments', {
        error: error?.message || String(error),
        emailId,
        userId
      });
      return [];
    }
  }

  /**
   * Store evidence document in database
   */
  private async storeEvidenceDocument(
    userId: string,
    email: any,
    attachment: GmailDocument
  ): Promise<string | null> {
    try {
      // Check if document already exists
      const { data: existingDoc } = await supabase
        .from('evidence_documents')
        .select('id')
        .eq('user_id', userId)
        .eq('external_id', attachment.emailId)
        .eq('filename', attachment.filename)
        .maybeSingle();

      if (existingDoc) {
        logger.debug('⏭️ [GMAIL INGESTION] Document already exists, skipping', {
          documentId: existingDoc.id,
          filename: attachment.filename
        });
        return existingDoc.id;
      }

      // Get or create evidence source (Gmail)
      let sourceId: string;
      const { data: existingSource } = await supabase
        .from('evidence_sources')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'gmail')
        .maybeSingle();

      if (existingSource) {
        sourceId = existingSource.id;
      } else {
        // Create evidence source
        const { data: newSource, error: sourceError } = await supabase
          .from('evidence_sources')
          .insert({
            user_id: userId,
            provider: 'gmail',
            account_email: email.from,
            status: 'connected',
            metadata: {
              connected_at: new Date().toISOString(),
              source: 'gmail_api'
            }
          })
          .select('id')
          .single();

        if (sourceError || !newSource) {
          logger.error('❌ [GMAIL INGESTION] Failed to create evidence source', {
            error: sourceError,
            userId
          });
          return null;
        }

        sourceId = newSource.id;
      }

      // Store document metadata (metadata-first ingestion)
      const documentData = {
        source_id: sourceId,
        user_id: userId,
        provider: 'gmail',
        external_id: `${email.id}_${attachment.id}`,
        filename: attachment.filename,
        size_bytes: attachment.size,
        content_type: attachment.contentType,
        created_at: attachment.date,
        modified_at: attachment.date,
        sender: email.from,
        subject: email.subject,
        message_id: email.id,
        metadata: {
          email_id: email.id,
          email_date: email.date,
          email_from: email.from,
          email_subject: email.subject,
          attachment_id: attachment.id,
          ingestion_method: 'gmail_api',
          ingestion_timestamp: new Date().toISOString()
        },
        processing_status: 'pending',
        ingested_at: new Date().toISOString()
      };

      const { data: document, error: docError } = await supabase
        .from('evidence_documents')
        .insert(documentData)
        .select('id')
        .single();

      if (docError || !document) {
        logger.error('❌ [GMAIL INGESTION] Failed to store document', {
          error: docError,
          filename: attachment.filename,
          userId
        });
        return null;
      }

      // Store document content in Supabase Storage (if content is available)
      if (attachment.content) {
        try {
          const bucketName = 'evidence-documents';
          const filePath = `${userId}/${document.id}/${attachment.filename}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, attachment.content, {
              contentType: attachment.contentType,
              upsert: false
            });

          if (uploadError) {
            // If bucket doesn't exist, log warning but continue
            if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('not found')) {
              logger.warn('⚠️ [GMAIL INGESTION] Storage bucket not found - file not stored', {
                bucket: bucketName,
                documentId: document.id,
                note: 'Bucket must be created manually in Supabase dashboard'
              });
            } else {
              logger.warn('⚠️ [GMAIL INGESTION] Failed to upload file to storage', {
                error: uploadError.message,
                documentId: document.id,
                filename: attachment.filename
              });
            }
          } else {
            // Get storage URL
            const { data: urlData } = supabase.storage
              .from(bucketName)
              .getPublicUrl(filePath);

            // Update document with storage path
            await supabase
              .from('evidence_documents')
              .update({
                file_url: urlData?.publicUrl || filePath,
                storage_path: filePath,
                metadata: {
                  ...documentData.metadata,
                  has_content: true,
                  content_size: attachment.content.length,
                  storage_path: filePath,
                  storage_bucket: bucketName
                }
              })
              .eq('id', document.id);

            logger.info('✅ [GMAIL INGESTION] File stored in Supabase Storage', {
              documentId: document.id,
              filename: attachment.filename,
              path: filePath,
              size: attachment.content.length
            });
          }
        } catch (storageError: any) {
          logger.warn('⚠️ [GMAIL INGESTION] Error storing file content', {
            error: storageError?.message,
            documentId: document.id
          });
        }
      }

      return document.id;
    } catch (error: any) {
      logger.error('❌ [GMAIL INGESTION] Error storing evidence document', {
        error: error?.message || String(error),
        filename: attachment.filename,
        userId
      });
      return null;
    }
  }

  /**
   * Trigger parsing pipeline for a document
   * Calls Python API parsing endpoint to process the document
   */
  private async triggerParsingPipeline(documentId: string, userId: string): Promise<void> {
    try {
      logger.info('🔄 [GMAIL INGESTION] Triggering parsing pipeline', {
        documentId,
        userId
      });

      // Update document status to processing
      await supabase
        .from('evidence_documents')
        .update({
          processing_status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId);

      // Call Python API parsing endpoint
      // Use environment variable for Python API URL, fallback to localhost
      const pythonApiUrl = process.env.PYTHON_API_URL || process.env.API_URL || 'https://python-api-4-aukq.onrender.com';
      const parseEndpoint = `${pythonApiUrl}/api/v1/evidence/parse/${documentId}`;

      try {
        const response = await axios.post(
          parseEndpoint,
          {},
          {
            headers: {
              'Content-Type': 'application/json',
              // Forward user ID if available (Python API will authenticate)
              'X-User-Id': userId
            },
            timeout: 30000 // 30 second timeout
          }
        );

        if (response.status === 200 || response.status === 202) {
          const jobData = response.data;
          const jobId = jobData.job_id || jobData.id;
          
          logger.info('✅ [GMAIL INGESTION] Parsing pipeline triggered successfully', {
            documentId,
            userId,
            jobId,
            status: jobData.status
          });

          // Send SSE event for parsing started
          try {
            const sseHub = (await import('../utils/sseHub')).default;
            sseHub.sendEvent(userId, 'parsing_started', {
              documentId,
              jobId,
              userId,
              timestamp: new Date().toISOString()
            });
          } catch (sseError) {
            logger.debug('Failed to send SSE event for parsing started', { error: sseError });
          }
        } else {
          logger.warn('⚠️ [GMAIL INGESTION] Parsing pipeline returned unexpected status', {
            documentId,
            userId,
            status: response.status,
            statusText: response.statusText
          });
        }
      } catch (apiError: any) {
        // Log error but don't fail the ingestion
        // The document is stored, parsing can be retried later
        logger.warn('⚠️ [GMAIL INGESTION] Failed to trigger parsing pipeline (document stored, can retry later)', {
          documentId,
          userId,
          error: apiError?.message || String(apiError),
          endpoint: parseEndpoint,
          note: 'Document metadata stored successfully, parsing can be triggered manually later'
        });

        // Update document status back to pending so it can be retried
        await supabase
          .from('evidence_documents')
          .update({
            processing_status: 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);
      }
    } catch (error: any) {
      logger.error('❌ [GMAIL INGESTION] Error triggering parsing pipeline', {
        error: error?.message || String(error),
        documentId,
        userId
      });

      // Update document status to pending on error
      try {
        await supabase
          .from('evidence_documents')
          .update({
            processing_status: 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);
      } catch (updateError: any) {
        logger.error('❌ [GMAIL INGESTION] Failed to update document status', {
          error: updateError?.message,
          documentId
        });
      }
    }
  }

  /**
   * Get ingestion status for a user
   */
  async getIngestionStatus(userId: string): Promise<{
    hasConnectedSource: boolean;
    lastIngestion?: string;
    documentsCount: number;
    processingCount: number;
  }> {
    try {
      // Check if user has connected Gmail source
      const { data: source } = await supabase
        .from('evidence_sources')
        .select('id, last_sync_at')
        .eq('user_id', userId)
        .eq('provider', 'gmail')
        .eq('status', 'connected')
        .maybeSingle();

      // Get document counts
      const { count: totalCount } = await supabase
        .from('evidence_documents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      const { count: processingCount } = await supabase
        .from('evidence_documents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('processing_status', 'processing');

      return {
        hasConnectedSource: !!source,
        lastIngestion: source?.last_sync_at || undefined,
        documentsCount: totalCount || 0,
        processingCount: processingCount || 0
      };
    } catch (error: any) {
      logger.error('❌ [GMAIL INGESTION] Error getting ingestion status', {
        error: error?.message || String(error),
        userId
      });
      return {
        hasConnectedSource: false,
        documentsCount: 0,
        processingCount: 0
      };
    }
  }
}

export const gmailIngestionService = new GmailIngestionService();

