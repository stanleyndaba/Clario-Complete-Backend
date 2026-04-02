/**
 * Dropbox Ingestion Service
 * Handles ingestion of evidence documents from Dropbox
 * Uses Dropbox API with metadata-first approach
 */

import logger from '../utils/logger';
import { supabase, convertUserIdToUuid } from '../database/supabaseClient';
import axios from 'axios';
import tokenManager from '../utils/tokenManager';
import {
  buildIngestionMetadata,
  buildParsedMetadataForIngestion,
  createIngestionExplanation,
  extractEvidenceLinkHints,
  IngestionStrategy
} from './evidenceIngestionDecisionUtils';
import { resolveEvidenceSourceContext } from './evidenceSourceTruthService';

export interface DropboxIngestionResult {
  success: boolean;
  documentsIngested: number;
  filesProcessed: number;
  errors: string[];
  jobId?: string;
}

export interface DropboxFile {
  id: string;
  name: string;
  path: string;
  mimeType?: string;
  size: number;
  modifiedTime: string;
  content?: Buffer;
}

export class DropboxIngestionService {
  private baseUrl = 'https://api.dropboxapi.com/2';

  /**
   * Get access token for Dropbox from evidence_sources table
   */
  private async getAccessToken(userId: string, tenantId?: string): Promise<string | null> {
    try {
      if (!tenantId) {
        logger.warn('⚠️ [DROPBOX INGESTION] Missing tenant context for token lookup', {
          userId,
        });
        return null;
      }

      const sourceContext = await resolveEvidenceSourceContext(userId, 'dropbox', tenantId);
      if (!sourceContext) {
        logger.warn('⚠️ [DROPBOX INGESTION] No ingestable Dropbox source found for tenant', {
          userId,
          tenantId
        });
        return null;
      }

      const metadata = sourceContext.metadata || {};
      const accessToken = metadata.access_token;

      if (accessToken) {
        return accessToken;
      }

      try {
        const tokenData = await tokenManager.getRefreshableToken(userId, 'dropbox');
        if (tokenData?.accessToken) {
          return tokenData.accessToken;
        }
      } catch (tokenError: any) {
        logger.debug('Dropbox token manager fallback unavailable during ingestion', {
          userId,
          tenantId,
          error: tokenError?.message || String(tokenError)
        });
      }

      logger.warn('⚠️ [DROPBOX INGESTION] No Dropbox access token found for resolved source', {
        userId,
        tenantId,
        sourceId: sourceContext.id
      });
      return null;
    } catch (error: any) {
      logger.error('❌ [DROPBOX INGESTION] Error getting access token', {
        error: error?.message || String(error),
        userId
      });
      return null;
    }
  }

  /**
   * Ingest evidence documents from Dropbox
   * Metadata-first approach: Check metadata before downloading
   */
  async ingestEvidenceFromDropbox(
    userId: string,
    options: {
      query?: string;
      maxResults?: number;
      autoParse?: boolean;
      folderPath?: string;
      tenantId?: string;
    } = {}
  ): Promise<DropboxIngestionResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let documentsIngested = 0;
    let filesProcessed = 0;

    try {
      const tenantId = options.tenantId;
      logger.info('🔍 [DROPBOX INGESTION] Starting evidence ingestion from Dropbox', {
        userId,
        tenantId,
        query: options.query,
        maxResults: options.maxResults || 50,
        folderPath: options.folderPath
      });

      if (!tenantId) {
        return {
          success: false,
          documentsIngested: 0,
          filesProcessed: 0,
          errors: ['Tenant context is required for Dropbox evidence ingestion']
        };
      }

      const accessToken = await this.getAccessToken(userId, tenantId);
      if (!accessToken) {
        return {
          success: false,
          documentsIngested: 0,
          filesProcessed: 0,
          errors: ['No connected Dropbox account or access token not available']
        };
      }

      // List files with metadata (metadata-first approach)
      const folderPath = options.folderPath || '';
      const files = await this.listFiles(accessToken, folderPath, options.maxResults || 50);

      logger.info(`✅ [DROPBOX INGESTION] Found ${files.length} files in Dropbox`, {
        userId,
        fileCount: files.length
      });

      filesProcessed = files.length;

      // Process each file (metadata-first: filter before downloading)
      for (const file of files) {
        try {
          // Metadata-first: Check if file is relevant before downloading
          if (!this.isRelevantDocument(file)) {
            logger.debug('📝 [DROPBOX INGESTION] File did not meet relevance threshold, preserving degraded metadata candidate', {
              fileId: file.id,
              name: file.name,
              path: file.path
            });

            const degradedDocumentId = await this.storeEvidenceDocument(userId, file, undefined, {
              strategy: 'DEGRADED',
              reason: 'metadata_relevance_threshold_not_met',
              missingFields: ['relevance_match'],
              preservedFields: ['file_id', 'file_name', 'file_path', 'mime_type', 'timestamps']
            }, tenantId);

            if (degradedDocumentId) {
              documentsIngested++;
            }
            continue;
          }

          // Download file content only if needed
          let fileContent: Buffer | undefined;
          try {
            fileContent = await this.downloadFile(accessToken, file.path);
          } catch (downloadError: any) {
            logger.warn('⚠️ [DROPBOX INGESTION] Failed to download file, storing metadata only', {
              error: downloadError?.message,
              fileId: file.id,
              name: file.name
            });
            // Continue with metadata-only storage
          }

          // Store document (with or without content)
          const documentId = await this.storeEvidenceDocument(userId, file, fileContent, undefined, tenantId);

          if (documentId) {
            documentsIngested++;
            logger.info('✅ [DROPBOX INGESTION] Stored evidence document', {
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
          logger.error('❌ [DROPBOX INGESTION] Error processing file', {
            error: errorMsg,
            fileId: file.id,
            userId
          });
        }
      }

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('✅ [DROPBOX INGESTION] Evidence ingestion completed', {
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
      logger.error('❌ [DROPBOX INGESTION] Critical error in evidence ingestion', {
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
   * Check if file is a relevant document (metadata-first filtering)
   */
  private isRelevantDocument(file: DropboxFile): boolean {
    const name = file.name.toLowerCase();
    const path = file.path.toLowerCase();

    // Check name patterns
    const relevantPatterns = [
      'invoice', 'receipt', 'fba', 'reimbursement', 'refund',
      'amazon', 'shipping', 'purchase order', 'po', 'bill',
      'packing slip', 'delivery', 'order confirmation'
    ];

    const hasRelevantName = relevantPatterns.some(pattern =>
      name.includes(pattern) || path.includes(pattern)
    );

    // Check file extensions
    const relevantExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.xls', '.doc', '.docx', '.txt'];
    const hasRelevantExtension = relevantExtensions.some(ext =>
      name.endsWith(ext) || path.endsWith(ext)
    );

    // Check file size (reasonable limit: 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    const hasReasonableSize = file.size <= maxSize;

    // Check MIME type if available
    let hasRelevantMimeType = true; // Default to true if MIME type not available
    if (file.mimeType) {
      const relevantMimeTypes = [
        'application/pdf',
        'image/jpeg', 'image/png', 'image/jpg',
        'application/vnd.openxmlformats-officedocument',
        'application/msword',
        'text/plain'
      ];
      hasRelevantMimeType = relevantMimeTypes.some(mime => file.mimeType?.includes(mime));
    }

    return (hasRelevantName || hasRelevantExtension || hasRelevantMimeType) && hasReasonableSize;
  }

  /**
   * List files from Dropbox (metadata-only)
   */
  private async listFiles(
    accessToken: string,
    folderPath: string,
    maxResults: number
  ): Promise<DropboxFile[]> {
    try {
      // Dropbox API: files/list_folder
      const response = await axios.post(
        `${this.baseUrl}/files/list_folder`,
        {
          path: folderPath || '',
          recursive: true,
          limit: maxResults
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const entries = response.data.entries || [];

      // Filter to only files (not folders) and map to our format
      return entries
        .filter((entry: any) => entry['.tag'] === 'file')
        .slice(0, maxResults)
        .map((entry: any) => ({
          id: entry.id,
          name: entry.name,
          path: entry.path_lower || entry.path_display || entry.path,
          mimeType: this.inferMimeType(entry.name),
          size: entry.size || 0,
          modifiedTime: entry.server_modified || entry.client_modified || new Date().toISOString()
        }));
    } catch (error: any) {
      logger.error('❌ [DROPBOX INGESTION] Error listing files', {
        error: error?.message || String(error)
      });
      return [];
    }
  }

  /**
   * Infer MIME type from file extension
   */
  private inferMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls': 'application/vnd.ms-excel',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain'
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  /**
   * Download file content from Dropbox
   */
  private async downloadFile(accessToken: string, filePath: string): Promise<Buffer> {
    try {
      // Dropbox API: files/download
      const response = await axios.post(
        `${this.baseUrl}/files/download`,
        null,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({ path: filePath })
          },
          responseType: 'arraybuffer'
        }
      );

      return Buffer.from(response.data);
    } catch (error: any) {
      logger.error('❌ [DROPBOX INGESTION] Error downloading file', {
        error: error?.message || String(error),
        filePath
      });
      throw error;
    }
  }

  /**
   * Store evidence document in database
   */
  private async storeEvidenceDocument(
    userId: string,
    file: DropboxFile,
    content?: Buffer,
    overrides?: {
      strategy?: IngestionStrategy;
      reason?: string;
      preservedFields?: string[];
      missingFields?: string[];
      metadata?: Record<string, any>;
    },
    tenantId?: string
  ): Promise<string | null> {
    try {
      const dbUserId = convertUserIdToUuid(userId);
      if (!tenantId) {
        logger.warn('⚠️ [DROPBOX INGESTION] Cannot store document without tenant context', {
          userId,
          filename: file.name
        });
        return null;
      }

      const sourceContext = await resolveEvidenceSourceContext(userId, 'dropbox', tenantId);
      if (!sourceContext) {
        logger.warn('⚠️ [DROPBOX INGESTION] No ingestable Dropbox source resolved while storing document', {
          userId,
          tenantId,
          filename: file.name
        });
        return null;
      }

      // Check if document already exists
      const { data: existingDoc } = await supabase
        .from('evidence_documents')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('user_id', dbUserId)
        .eq('external_id', file.id)
        .eq('filename', file.name)
        .maybeSingle();

      if (existingDoc) {
        logger.debug('⏭️ [DROPBOX INGESTION] Document already exists, skipping', {
          documentId: existingDoc.id,
          filename: file.name
        });
        return existingDoc.id;
      }

      const ingestionStrategy: IngestionStrategy = overrides?.strategy || (content ? 'FULL' : 'DEGRADED');
      const ingestionExplanation = createIngestionExplanation(
        overrides?.reason || (content
          ? 'file_preserved_with_content'
          : 'file_content_unavailable_metadata_preserved'),
        overrides?.preservedFields || ['file_id', 'file_name', 'file_path', 'mime_type', 'timestamps'],
        overrides?.missingFields || (content ? [] : ['file_content', 'storage_path'])
      );
      const extractedHints = extractEvidenceLinkHints(
        [file.name, file.path, file.mimeType],
        {}
      );

      // Store document metadata (metadata-first ingestion)
      const documentData = {
        source_id: sourceContext.id,
        tenant_id: tenantId,
        user_id: dbUserId,
        seller_id: dbUserId,
        provider: 'dropbox',
        external_id: file.id,
        filename: file.name,
        size_bytes: file.size,
        content_type: file.mimeType || 'application/octet-stream',
        created_at: file.modifiedTime,
        modified_at: file.modifiedTime,
        metadata: buildIngestionMetadata({
          file_id: file.id,
          file_name: file.name,
          file_path: file.path,
          mime_type: file.mimeType,
          ingestion_method: 'dropbox_api',
          ingestion_timestamp: new Date().toISOString(),
          has_content: !!content
        }, ingestionStrategy, ingestionExplanation, overrides?.metadata || {}),
        raw_text: [file.name, file.path].filter(Boolean).join('\n') || null,
        extracted: extractedHints,
        parsed_metadata: buildParsedMetadataForIngestion(extractedHints, ingestionStrategy, ingestionExplanation),
        parser_status: content ? 'pending' : 'completed',
        processing_status: 'pending',
        ingested_at: new Date().toISOString()
      };

      const { data: document, error: docError } = await supabase
        .from('evidence_documents')
        .insert(documentData)
        .select('id')
        .single();

      if (docError || !document) {
        logger.error('❌ [DROPBOX INGESTION] Failed to store document', {
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
          const filePath = `${dbUserId}/${document.id}/${file.name}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, content, {
              contentType: file.mimeType || 'application/octet-stream',
              upsert: false
            });

          if (uploadError) {
            if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('not found')) {
              logger.warn('⚠️ [DROPBOX INGESTION] Storage bucket not found - file not stored', {
                bucket: bucketName,
                documentId: document.id
              });
            } else {
              logger.warn('⚠️ [DROPBOX INGESTION] Failed to upload file to storage', {
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

            logger.info('✅ [DROPBOX INGESTION] File stored in Supabase Storage', {
              documentId: document.id,
              filename: file.name,
              path: filePath
            });
          }
        } catch (storageError: any) {
          logger.warn('⚠️ [DROPBOX INGESTION] Error storing file content', {
            error: storageError?.message,
            documentId: document.id
          });
        }
      }

      return document.id;
    } catch (error: any) {
      logger.error('❌ [DROPBOX INGESTION] Error storing document', {
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
      const pythonApiUrl = process.env.PYTHON_API_URL || 'https://clario-complete-backend-6ca7.onrender.com';

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

      logger.info('✅ [DROPBOX INGESTION] Triggered parsing pipeline', {
        documentId,
        userId
      });
    } catch (error: any) {
      logger.warn('⚠️ [DROPBOX INGESTION] Failed to trigger parsing pipeline', {
        error: error?.message,
        documentId,
        userId
      });
      // Non-blocking - parsing can be triggered manually if this fails
    }
  }
}

export const dropboxIngestionService = new DropboxIngestionService();
export default dropboxIngestionService;

