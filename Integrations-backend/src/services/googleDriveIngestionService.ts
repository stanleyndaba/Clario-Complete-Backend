/**
 * Google Drive Ingestion Service
 * Handles ingestion of evidence documents from Google Drive
 * Uses Google Drive API with metadata-first approach
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import axios from 'axios';

export interface GoogleDriveIngestionResult {
  success: boolean;
  documentsIngested: number;
  filesProcessed: number;
  errors: string[];
  jobId?: string;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  createdTime: string;
  webViewLink?: string;
  downloadUrl?: string;
  content?: Buffer;
}

export class GoogleDriveIngestionService {
  private baseUrl = 'https://www.googleapis.com/drive/v3';

  /**
   * Get access token for Google Drive from evidence_sources table
   */
  private async getAccessToken(userId: string): Promise<string | null> {
    try {
      // Get evidence source for Google Drive
      const { data: source, error } = await supabase
        .from('evidence_sources')
        .select('metadata, permissions')
        .eq('user_id', userId)
        .eq('provider', 'gdrive')
        .eq('status', 'connected')
        .maybeSingle();

      if (error || !source) {
        logger.warn('⚠️ [GDRIVE INGESTION] No connected Google Drive account found', {
          userId,
          error: error?.message
        });
        return null;
      }

      // Token should be stored in metadata or we can use Gmail token (same Google account)
      const metadata = source.metadata || {};
      let accessToken = metadata.access_token;

      // If no token in metadata, try to get from Gmail tokenManager (same Google account)
      if (!accessToken) {
        try {
          const { tokenManager } = await import('../utils/tokenManager');
          const gmailToken = await tokenManager.getToken(userId, 'gmail');
          if (gmailToken) {
            accessToken = gmailToken.accessToken;
            logger.info('✅ [GDRIVE INGESTION] Using Gmail token for Google Drive (same account)', {
              userId
            });
          }
        } catch (tokenError) {
          logger.debug('Could not get Gmail token for Google Drive', { error: tokenError });
        }
      }

      if (!accessToken) {
        logger.warn('⚠️ [GDRIVE INGESTION] No access token found', {
          userId
        });
        return null;
      }

      return accessToken;
    } catch (error: any) {
      logger.error('❌ [GDRIVE INGESTION] Error getting access token', {
        error: error?.message || String(error),
        userId
      });
      return null;
    }
  }

  /**
   * Ingest evidence documents from Google Drive
   * Metadata-first approach: Check metadata before downloading
   */
  async ingestEvidenceFromGoogleDrive(
    userId: string,
    options: {
      query?: string;
      maxResults?: number;
      autoParse?: boolean;
      folderId?: string;
    } = {}
  ): Promise<GoogleDriveIngestionResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let documentsIngested = 0;
    let filesProcessed = 0;

    try {
      logger.info('🔍 [GDRIVE INGESTION] Starting evidence ingestion from Google Drive', {
        userId,
        query: options.query,
        maxResults: options.maxResults || 50,
        folderId: options.folderId
      });

      const accessToken = await this.getAccessToken(userId);
      if (!accessToken) {
        return {
          success: false,
          documentsIngested: 0,
          filesProcessed: 0,
          errors: ['No connected Google Drive account or access token not available']
        };
      }

      // Build search query (metadata-first: search by name and MIME type)
      const defaultQuery = options.query || this.buildDefaultSearchQuery();
      const searchQuery = options.folderId 
        ? `'${options.folderId}' in parents and (${defaultQuery})`
        : defaultQuery;

      // List files with metadata only (metadata-first approach)
      const files = await this.listFiles(accessToken, searchQuery, options.maxResults || 50);

      logger.info(`✅ [GDRIVE INGESTION] Found ${files.length} files in Google Drive`, {
        userId,
        fileCount: files.length
      });

      filesProcessed = files.length;

      // Process each file (metadata-first: filter before downloading)
      for (const file of files) {
        try {
          // Metadata-first: Check if file is relevant before downloading
          if (!this.isRelevantDocument(file)) {
            logger.debug('⏭️ [GDRIVE INGESTION] File not relevant, skipping', {
              fileId: file.id,
              name: file.name,
              mimeType: file.mimeType
            });
            continue;
          }

          // Download file content only if needed
          let fileContent: Buffer | undefined;
          try {
            fileContent = await this.downloadFile(accessToken, file.id);
          } catch (downloadError: any) {
            logger.warn('⚠️ [GDRIVE INGESTION] Failed to download file, storing metadata only', {
              error: downloadError?.message,
              fileId: file.id,
              name: file.name
            });
            // Continue with metadata-only storage
          }

          // Store document (with or without content)
          const documentId = await this.storeEvidenceDocument(userId, file, fileContent);
          
          if (documentId) {
            documentsIngested++;
            logger.info('✅ [GDRIVE INGESTION] Stored evidence document', {
              documentId,
              fileId: file.id,
              filename: file.name,
              userId,
              hasContent: !!fileContent
            });

            // If auto-parse is enabled and we have content, trigger parsing pipeline
            if (options.autoParse && fileContent) {
              await this.triggerParsingPipeline(documentId, userId);
            }
          }
        } catch (error: any) {
          const errorMsg = `Failed to process file ${file.name}: ${error?.message || String(error)}`;
          errors.push(errorMsg);
          logger.error('❌ [GDRIVE INGESTION] Error processing file', {
            error: errorMsg,
            fileId: file.id,
            userId
          });
        }
      }

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('✅ [GDRIVE INGESTION] Evidence ingestion completed', {
        userId,
        documentsIngested,
        filesProcessed,
        errors: errors.length,
        elapsedTime: `${elapsedTime}s`
      });

      return {
        success: errors.length === 0,
        documentsIngested,
        filesProcessed,
        errors
      };
    } catch (error: any) {
      logger.error('❌ [GDRIVE INGESTION] Critical error in evidence ingestion', {
        error: error?.message || String(error),
        stack: error?.stack,
        userId
      });

      return {
        success: false,
        documentsIngested,
        filesProcessed,
        errors: [error?.message || String(error)]
      };
    }
  }

  /**
   * Build default search query for relevant documents
   */
  private buildDefaultSearchQuery(): string {
    // Metadata-first: Search by name patterns and MIME types
    const namePatterns = [
      'invoice', 'receipt', 'FBA', 'reimbursement', 'refund',
      'amazon', 'shipping', 'purchase order', 'PO', 'bill'
    ];
    
    const mimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // Excel
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // Word
    ];

    // Build query: (name contains pattern) OR (mimeType matches)
    const nameQueries = namePatterns.map(pattern => `name contains '${pattern}'`).join(' or ');
    const mimeQueries = mimeTypes.map(mime => `mimeType = '${mime}'`).join(' or ');
    
    return `(${nameQueries}) or (${mimeQueries})`;
  }

  /**
   * Check if file is a relevant document (metadata-first filtering)
   */
  private isRelevantDocument(file: GoogleDriveFile): boolean {
    const name = file.name.toLowerCase();
    const mimeType = file.mimeType.toLowerCase();

    // Check name patterns
    const relevantPatterns = [
      'invoice', 'receipt', 'fba', 'reimbursement', 'refund',
      'amazon', 'shipping', 'purchase order', 'po', 'bill',
      'packing slip', 'delivery', 'order confirmation'
    ];

    const hasRelevantName = relevantPatterns.some(pattern => name.includes(pattern));

    // Check MIME types
    const relevantMimeTypes = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/jpg',
      'application/vnd.openxmlformats-officedocument',
      'application/msword',
      'text/plain'
    ];

    const hasRelevantMimeType = relevantMimeTypes.some(mime => mimeType.includes(mime));

    // Check file size (reasonable limit: 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    const hasReasonableSize = file.size <= maxSize;

    return (hasRelevantName || hasRelevantMimeType) && hasReasonableSize;
  }

  /**
   * List files from Google Drive (metadata-only)
   */
  private async listFiles(
    accessToken: string,
    query: string,
    maxResults: number
  ): Promise<GoogleDriveFile[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/files`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          q: query,
          pageSize: maxResults,
          fields: 'files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink)',
          orderBy: 'modifiedTime desc'
        }
      });

      return (response.data.files || []).map((file: any) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: parseInt(file.size || '0'),
        modifiedTime: file.modifiedTime,
        createdTime: file.createdTime,
        webViewLink: file.webViewLink
      }));
    } catch (error: any) {
      logger.error('❌ [GDRIVE INGESTION] Error listing files', {
        error: error?.message || String(error)
      });
      return [];
    }
  }

  /**
   * Download file content from Google Drive
   */
  private async downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
    try {
      const response = await axios.get(`${this.baseUrl}/files/${fileId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          alt: 'media'
        },
        responseType: 'arraybuffer'
      });

      return Buffer.from(response.data);
    } catch (error: any) {
      logger.error('❌ [GDRIVE INGESTION] Error downloading file', {
        error: error?.message || String(error),
        fileId
      });
      throw error;
    }
  }

  /**
   * Store evidence document in database
   */
  private async storeEvidenceDocument(
    userId: string,
    file: GoogleDriveFile,
    content?: Buffer
  ): Promise<string | null> {
    try {
      // Check if document already exists
      const { data: existingDoc } = await supabase
        .from('evidence_documents')
        .select('id')
        .eq('user_id', userId)
        .eq('external_id', file.id)
        .eq('filename', file.name)
        .maybeSingle();

      if (existingDoc) {
        logger.debug('⏭️ [GDRIVE INGESTION] Document already exists, skipping', {
          documentId: existingDoc.id,
          filename: file.name
        });
        return existingDoc.id;
      }

      // Get or create evidence source (Google Drive)
      let sourceId: string;
      const { data: existingSource } = await supabase
        .from('evidence_sources')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'gdrive')
        .maybeSingle();

      if (existingSource) {
        sourceId = existingSource.id;
      } else {
        // Create evidence source
        const { data: newSource, error: sourceError } = await supabase
          .from('evidence_sources')
          .insert({
            user_id: userId,
            provider: 'gdrive',
            account_email: userId, // Will be updated when we have email
            status: 'connected',
            metadata: {
              connected_at: new Date().toISOString(),
              source: 'google_drive_api'
            }
          })
          .select('id')
          .single();

        if (sourceError || !newSource) {
          logger.error('❌ [GDRIVE INGESTION] Failed to create evidence source', {
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
        provider: 'gdrive',
        external_id: file.id,
        filename: file.name,
        size_bytes: file.size,
        content_type: file.mimeType,
        created_at: file.createdTime,
        modified_at: file.modifiedTime,
        metadata: {
          file_id: file.id,
          file_name: file.name,
          mime_type: file.mimeType,
          web_view_link: file.webViewLink,
          ingestion_method: 'google_drive_api',
          ingestion_timestamp: new Date().toISOString(),
          has_content: !!content
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
        logger.error('❌ [GDRIVE INGESTION] Failed to store document', {
          error: docError,
          filename: file.name,
          userId
        });
        return null;
      }

      // Store document content in Supabase Storage if available
      if (content) {
        try {
          const bucketName = 'evidence-documents';
          const filePath = `${userId}/${document.id}/${file.name}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, content, {
              contentType: file.mimeType,
              upsert: false
            });

          if (uploadError) {
            if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('not found')) {
              logger.warn('⚠️ [GDRIVE INGESTION] Storage bucket not found - file not stored', {
                bucket: bucketName,
                documentId: document.id
              });
            } else {
              logger.warn('⚠️ [GDRIVE INGESTION] Failed to upload file to storage', {
                error: uploadError.message,
                documentId: document.id
              });
            }
          } else {
            const { data: urlData } = supabase.storage
              .from(bucketName)
              .getPublicUrl(filePath);

            await supabase
              .from('evidence_documents')
              .update({
                file_url: urlData?.publicUrl || filePath,
                storage_path: filePath,
                metadata: {
                  ...documentData.metadata,
                  has_content: true,
                  content_size: content.length,
                  storage_path: filePath,
                  storage_bucket: bucketName
                }
              })
              .eq('id', document.id);

            logger.info('✅ [GDRIVE INGESTION] File stored in Supabase Storage', {
              documentId: document.id,
              filename: file.name,
              path: filePath
            });
          }
        } catch (storageError: any) {
          logger.warn('⚠️ [GDRIVE INGESTION] Error storing file content', {
            error: storageError?.message,
            documentId: document.id
          });
        }
      }

      return document.id;
    } catch (error: any) {
      logger.error('❌ [GDRIVE INGESTION] Error storing document', {
        error: error?.message || String(error),
        userId,
        filename: file.name
      });
      return null;
    }
  }

  /**
   * Trigger parsing pipeline for document
   */
  private async triggerParsingPipeline(documentId: string, userId: string): Promise<void> {
    try {
      const pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-9.onrender.com';
      
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

      logger.info('✅ [GDRIVE INGESTION] Triggered parsing pipeline', {
        documentId,
        userId
      });
    } catch (error: any) {
      logger.warn('⚠️ [GDRIVE INGESTION] Failed to trigger parsing pipeline', {
        error: error?.message,
        documentId,
        userId
      });
      // Non-blocking - parsing can be triggered manually if this fails
    }
  }
}

export const googleDriveIngestionService = new GoogleDriveIngestionService();
export default googleDriveIngestionService;

