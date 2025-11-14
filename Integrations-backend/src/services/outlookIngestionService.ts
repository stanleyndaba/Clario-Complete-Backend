/**
 * Outlook Ingestion Service
 * Handles ingestion of evidence documents from Outlook/Microsoft 365
 * Uses Microsoft Graph API
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import axios from 'axios';

export interface OutlookIngestionResult {
  success: boolean;
  documentsIngested: number;
  emailsProcessed: number;
  errors: string[];
  jobId?: string;
}

export interface OutlookDocument {
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

export class OutlookIngestionService {
  private baseUrl = 'https://graph.microsoft.com/v1.0/me';

  /**
   * Get access token for Outlook from evidence_sources table
   */
  private async getAccessToken(userId: string): Promise<string | null> {
    try {
      // Get evidence source for Outlook
      const { data: source, error } = await supabase
        .from('evidence_sources')
        .select('metadata, permissions')
        .eq('user_id', userId)
        .eq('provider', 'outlook')
        .eq('status', 'connected')
        .maybeSingle();

      if (error || !source) {
        logger.warn('⚠️ [OUTLOOK INGESTION] No connected Outlook account found', {
          userId,
          error: error?.message
        });
        return null;
      }

      // Token should be stored in metadata or we need to retrieve it from tokenManager
      // For now, check if we can get it from tokenManager (if extended) or metadata
      const metadata = source.metadata || {};
      const accessToken = metadata.access_token;

      if (!accessToken) {
        logger.warn('⚠️ [OUTLOOK INGESTION] No access token found in evidence source', {
          userId
        });
        return null;
      }

      // TODO: Check token expiry and refresh if needed
      return accessToken;
    } catch (error: any) {
      logger.error('❌ [OUTLOOK INGESTION] Error getting access token', {
        error: error?.message || String(error),
        userId
      });
      return null;
    }
  }

  /**
   * Ingest evidence documents from Outlook
   * Searches for invoice/receipt emails and extracts attachments
   */
  async ingestEvidenceFromOutlook(
    userId: string,
    options: {
      query?: string;
      maxResults?: number;
      autoParse?: boolean;
    } = {}
  ): Promise<OutlookIngestionResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let documentsIngested = 0;
    let emailsProcessed = 0;

    try {
      logger.info('🔍 [OUTLOOK INGESTION] Starting evidence ingestion from Outlook', {
        userId,
        query: options.query,
        maxResults: options.maxResults || 50
      });

      const accessToken = await this.getAccessToken(userId);
      if (!accessToken) {
        return {
          success: false,
          documentsIngested: 0,
          emailsProcessed: 0,
          errors: ['No connected Outlook account or access token not available']
        };
      }

      // Default query: search for invoices, receipts, FBA reports
      const defaultQuery = options.query || 
        'from:amazon.com OR from:amazon.co.uk OR subject:(invoice OR receipt OR "FBA" OR "reimbursement" OR "refund") hasAttachments:true';

      // Fetch emails from Microsoft Graph API
      const emails = await this.fetchEmails(accessToken, defaultQuery, options.maxResults || 50);

      logger.info(`✅ [OUTLOOK INGESTION] Fetched ${emails.length} emails from Outlook`, {
        userId,
        emailCount: emails.length
      });

      emailsProcessed = emails.length;

      // Process each email
      for (const email of emails) {
        try {
          if (!email.hasAttachments) {
            logger.debug('⏭️ [OUTLOOK INGESTION] Email has no attachments, skipping', {
              emailId: email.id,
              subject: email.subject
            });
            continue;
          }

          // Extract attachments from email
          const attachments = await this.extractAttachmentsFromEmail(accessToken, email.id);

          if (attachments.length === 0) {
            logger.debug('⏭️ [OUTLOOK INGESTION] No attachments found in email', {
              emailId: email.id,
              subject: email.subject
            });
            continue;
          }

          logger.info(`📎 [OUTLOOK INGESTION] Found ${attachments.length} attachments in email`, {
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
                logger.info('✅ [OUTLOOK INGESTION] Stored evidence document', {
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
              logger.error('❌ [OUTLOOK INGESTION] Error storing attachment', {
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
          logger.error('❌ [OUTLOOK INGESTION] Error processing email', {
            error: errorMsg,
            emailId: email.id,
            userId
          });
        }
      }

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('✅ [OUTLOOK INGESTION] Evidence ingestion completed', {
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
      logger.error('❌ [OUTLOOK INGESTION] Critical error in evidence ingestion', {
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
   * Fetch emails from Microsoft Graph API
   */
  private async fetchEmails(
    accessToken: string,
    query: string,
    maxResults: number
  ): Promise<any[]> {
    try {
      // Microsoft Graph API search endpoint
      const response = await axios.post(
        `${this.baseUrl}/messages/search`,
        {
          requests: [{
            entityTypes: ['message'],
            query: {
              queryString: query
            },
            from: 0,
            size: maxResults
          }]
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Extract messages from search results
      const messages = response.data.value?.[0]?.hitsContainers?.[0]?.hits || [];

      // Fetch full message details for each result
      const emails = [];
      for (const hit of messages.slice(0, maxResults)) {
        try {
          const messageId = hit.resourceId;
          const messageResponse = await axios.get(
            `${this.baseUrl}/messages/${messageId}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              params: {
                $select: 'id,subject,from,receivedDateTime,hasAttachments,attachments'
              }
            }
          );

          const message = messageResponse.data;
          emails.push({
            id: message.id,
            subject: message.subject || 'No Subject',
            from: message.from?.emailAddress?.address || 'Unknown',
            date: message.receivedDateTime,
            hasAttachments: message.hasAttachments || false,
            attachments: message.attachments || []
          });
        } catch (error: any) {
          logger.warn('⚠️ [OUTLOOK INGESTION] Failed to fetch message details', {
            error: error?.message,
            messageId: hit.resourceId
          });
        }
      }

      return emails;
    } catch (error: any) {
      // Fallback: Use regular messages endpoint if search fails
      logger.warn('⚠️ [OUTLOOK INGESTION] Search API failed, using messages endpoint', {
        error: error?.message
      });

      try {
        const response = await axios.get(`${this.baseUrl}/messages`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            $filter: "hasAttachments eq true",
            $top: maxResults,
            $orderby: 'receivedDateTime desc',
            $select: 'id,subject,from,receivedDateTime,hasAttachments'
          }
        });

        return (response.data.value || []).map((msg: any) => ({
          id: msg.id,
          subject: msg.subject || 'No Subject',
          from: msg.from?.emailAddress?.address || 'Unknown',
          date: msg.receivedDateTime,
          hasAttachments: msg.hasAttachments || false,
          attachments: []
        }));
      } catch (fallbackError: any) {
        logger.error('❌ [OUTLOOK INGESTION] Failed to fetch emails', {
          error: fallbackError?.message || String(fallbackError)
        });
        return [];
      }
    }
  }

  /**
   * Extract attachments from an Outlook email
   */
  private async extractAttachmentsFromEmail(
    accessToken: string,
    emailId: string
  ): Promise<OutlookDocument[]> {
    try {
      // Get message with attachments
      const messageResponse = await axios.get(
        `${this.baseUrl}/messages/${emailId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            $expand: 'attachments'
          }
        }
      );

      const message = messageResponse.data;
      const attachments: OutlookDocument[] = [];

      if (!message.attachments || message.attachments.length === 0) {
        return [];
      }

      // Process each attachment
      for (const attachment of message.attachments) {
        try {
          // Download attachment content
          const attachmentResponse = await axios.get(
            `${this.baseUrl}/messages/${emailId}/attachments/${attachment.id}/$value`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              responseType: 'arraybuffer'
            }
          );

          const content = Buffer.from(attachmentResponse.data);
          const contentType = attachment.contentType || 'application/octet-stream';

          attachments.push({
            id: attachment.id,
            emailId: emailId,
            subject: message.subject || 'No Subject',
            from: message.from?.emailAddress?.address || 'Unknown',
            date: message.receivedDateTime,
            filename: attachment.name || 'unnamed',
            contentType: contentType,
            size: attachment.size || content.length,
            content: content,
            downloadUrl: `data:${contentType};base64,${content.toString('base64')}`
          });
        } catch (error: any) {
          logger.warn('⚠️ [OUTLOOK INGESTION] Failed to download attachment', {
            error: error?.message,
            attachmentId: attachment.id,
            emailId
          });
        }
      }

      return attachments;
    } catch (error: any) {
      logger.error('❌ [OUTLOOK INGESTION] Error extracting attachments', {
        error: error?.message || String(error),
        emailId
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
    attachment: OutlookDocument
  ): Promise<string | null> {
    try {
      // Check if document already exists
      const { data: existingDoc } = await supabase
        .from('evidence_documents')
        .select('id')
        .eq('user_id', userId)
        .eq('external_id', `${email.id}_${attachment.id}`)
        .eq('filename', attachment.filename)
        .maybeSingle();

      if (existingDoc) {
        logger.debug('⏭️ [OUTLOOK INGESTION] Document already exists, skipping', {
          documentId: existingDoc.id,
          filename: attachment.filename
        });
        return existingDoc.id;
      }

      // Get or create evidence source (Outlook)
      let sourceId: string;
      const { data: existingSource } = await supabase
        .from('evidence_sources')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'outlook')
        .maybeSingle();

      if (existingSource) {
        sourceId = existingSource.id;
      } else {
        // Create evidence source
        const { data: newSource, error: sourceError } = await supabase
          .from('evidence_sources')
          .insert({
            user_id: userId,
            provider: 'outlook',
            account_email: email.from,
            status: 'connected',
            metadata: {
              connected_at: new Date().toISOString(),
              source: 'microsoft_graph_api'
            }
          })
          .select('id')
          .single();

        if (sourceError || !newSource) {
          logger.error('❌ [OUTLOOK INGESTION] Failed to create evidence source', {
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
        provider: 'outlook',
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
          ingestion_method: 'microsoft_graph_api',
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
        logger.error('❌ [OUTLOOK INGESTION] Failed to store document', {
          error: docError,
          filename: attachment.filename,
          userId
        });
        return null;
      }

      // Store document content if available
      if (attachment.content) {
        logger.info('📦 [OUTLOOK INGESTION] Document content available for storage', {
          documentId: document.id,
          filename: attachment.filename,
          size: attachment.content.length
        });
      }

      return document.id;
    } catch (error: any) {
      logger.error('❌ [OUTLOOK INGESTION] Error storing document', {
        error: error?.message || String(error),
        userId,
        filename: attachment.filename
      });
      return null;
    }
  }

  /**
   * Trigger parsing pipeline for document
   */
  private async triggerParsingPipeline(documentId: string, userId: string): Promise<void> {
    try {
      const pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-4-aukq.onrender.com';
      
      await axios.post(
        `${pythonApiUrl}/api/documents/${documentId}/parse`,
        {},
        {
          headers: {
            'X-User-Id': userId,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      logger.info('✅ [OUTLOOK INGESTION] Triggered parsing pipeline', {
        documentId,
        userId
      });
    } catch (error: any) {
      logger.warn('⚠️ [OUTLOOK INGESTION] Failed to trigger parsing pipeline', {
        error: error?.message,
        documentId,
        userId
      });
      // Non-blocking - parsing can be triggered manually if this fails
    }
  }
}

export const outlookIngestionService = new OutlookIngestionService();
export default outlookIngestionService;

