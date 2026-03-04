/**
 * OneDrive Ingestion Service
 * Handles ingestion of evidence documents from Microsoft OneDrive
 * Uses Microsoft Graph API with metadata-first approach
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import axios from 'axios';

export interface OneDriveIngestionResult {
    success: boolean;
    documentsIngested: number;
    filesProcessed: number;
    errors: string[];
    jobId?: string;
}

export interface OneDriveFile {
    id: string;
    name: string;
    path: string;
    mimeType?: string;
    size: number;
    modifiedTime: string;
    downloadUrl?: string;
    content?: Buffer;
}

export class OneDriveIngestionService {
    private baseUrl = 'https://graph.microsoft.com/v1.0/me/drive';

    /**
     * Get access token for OneDrive from evidence_sources table
     */
    private async getAccessToken(userId: string): Promise<string | null> {
        try {
            const { data: source, error } = await supabase
                .from('evidence_sources')
                .select('metadata, permissions')
                .eq('user_id', userId)
                .eq('provider', 'onedrive')
                .eq('status', 'connected')
                .maybeSingle();

            if (error || !source) {
                logger.warn('⚠️ [ONEDRIVE INGESTION] No connected OneDrive account found', {
                    userId,
                    error: error?.message
                });
                return null;
            }

            const metadata = source.metadata || {};
            const accessToken = metadata.access_token;

            if (!accessToken) {
                logger.warn('⚠️ [ONEDRIVE INGESTION] No access token found in evidence source', {
                    userId
                });
                return null;
            }

            return accessToken;
        } catch (error: any) {
            logger.error('❌ [ONEDRIVE INGESTION] Error getting access token', {
                error: error?.message || String(error),
                userId
            });
            return null;
        }
    }

    /**
     * Ingest evidence documents from OneDrive
     * Metadata-first approach: Check metadata before downloading
     */
    async ingestEvidenceFromOneDrive(
        userId: string,
        options: {
            query?: string;
            maxResults?: number;
            autoParse?: boolean;
            folderId?: string;
        } = {}
    ): Promise<OneDriveIngestionResult> {
        const startTime = Date.now();
        const errors: string[] = [];
        let documentsIngested = 0;
        let filesProcessed = 0;

        try {
            logger.info('🔍 [ONEDRIVE INGESTION] Starting evidence ingestion from OneDrive', {
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
                    errors: ['No connected OneDrive account or access token not available']
                };
            }

            // List files with metadata (metadata-first approach)
            const files = await this.listFiles(accessToken, options.folderId, options.maxResults || 50, options.query);

            logger.info(`✅ [ONEDRIVE INGESTION] Found ${files.length} files in OneDrive`, {
                userId,
                fileCount: files.length
            });

            filesProcessed = files.length;

            // Process each file (metadata-first: filter before downloading)
            for (const file of files) {
                try {
                    if (!this.isRelevantDocument(file)) {
                        logger.debug('⏭️ [ONEDRIVE INGESTION] File not relevant, skipping', {
                            fileId: file.id,
                            name: file.name
                        });
                        continue;
                    }

                    // Download file content
                    let fileContent: Buffer | undefined;
                    try {
                        fileContent = await this.downloadFile(accessToken, file.id);
                    } catch (downloadError: any) {
                        logger.warn('⚠️ [ONEDRIVE INGESTION] Failed to download file, storing metadata only', {
                            error: downloadError?.message,
                            fileId: file.id,
                            name: file.name
                        });
                    }

                    const documentId = await this.storeEvidenceDocument(userId, file, fileContent);

                    if (documentId) {
                        documentsIngested++;
                        logger.info('✅ [ONEDRIVE INGESTION] Stored evidence document', {
                            documentId,
                            fileId: file.id,
                            filename: file.name,
                            userId,
                            hasContent: !!fileContent
                        });

                        if (options.autoParse && fileContent) {
                            await this.triggerParsingPipeline(documentId, userId);
                        }
                    }
                } catch (error: any) {
                    const errorMsg = `Failed to process file ${file.name}: ${error?.message || String(error)}`;
                    errors.push(errorMsg);
                    logger.error('❌ [ONEDRIVE INGESTION] Error processing file', {
                        error: errorMsg,
                        fileId: file.id,
                        userId
                    });
                }
            }

            const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

            logger.info('✅ [ONEDRIVE INGESTION] Evidence ingestion completed', {
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
            logger.error('❌ [ONEDRIVE INGESTION] Critical error in evidence ingestion', {
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
    private isRelevantDocument(file: OneDriveFile): boolean {
        const name = file.name.toLowerCase();
        const path = file.path.toLowerCase();

        const relevantPatterns = [
            'invoice', 'receipt', 'fba', 'reimbursement', 'refund',
            'amazon', 'shipping', 'purchase order', 'po', 'bill',
            'packing slip', 'delivery', 'order confirmation'
        ];

        const hasRelevantName = relevantPatterns.some(pattern =>
            name.includes(pattern) || path.includes(pattern)
        );

        const relevantExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.xls', '.doc', '.docx', '.txt', '.csv'];
        const hasRelevantExtension = relevantExtensions.some(ext =>
            name.endsWith(ext)
        );

        const maxSize = 50 * 1024 * 1024; // 50MB
        const hasReasonableSize = file.size <= maxSize;

        let hasRelevantMimeType = true;
        if (file.mimeType) {
            const relevantMimeTypes = [
                'application/pdf',
                'image/jpeg', 'image/png', 'image/jpg',
                'application/vnd.openxmlformats-officedocument',
                'application/msword',
                'text/plain', 'text/csv'
            ];
            hasRelevantMimeType = relevantMimeTypes.some(mime => file.mimeType?.includes(mime));
        }

        return (hasRelevantName || hasRelevantExtension || hasRelevantMimeType) && hasReasonableSize;
    }

    /**
     * List files from OneDrive using Microsoft Graph API
     */
    private async listFiles(
        accessToken: string,
        folderId?: string,
        maxResults: number = 50,
        query?: string
    ): Promise<OneDriveFile[]> {
        try {
            let url: string;

            if (query) {
                // Search for files
                url = `${this.baseUrl}/root/search(q='${encodeURIComponent(query)}')`;
            } else if (folderId) {
                // List files in specific folder
                url = `${this.baseUrl}/items/${folderId}/children`;
            } else {
                // List files in root
                url = `${this.baseUrl}/root/children`;
            }

            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    $top: maxResults,
                    $select: 'id,name,size,lastModifiedDateTime,file,parentReference,@microsoft.graph.downloadUrl'
                }
            });

            const items = response.data.value || [];

            // Filter to files only (not folders) and map
            return items
                .filter((item: any) => item.file) // Only items with file facet
                .slice(0, maxResults)
                .map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    path: item.parentReference?.path ? `${item.parentReference.path}/${item.name}` : `/${item.name}`,
                    mimeType: item.file?.mimeType || this.inferMimeType(item.name),
                    size: item.size || 0,
                    modifiedTime: item.lastModifiedDateTime || new Date().toISOString(),
                    downloadUrl: item['@microsoft.graph.downloadUrl']
                }));
        } catch (error: any) {
            logger.error('❌ [ONEDRIVE INGESTION] Error listing files', {
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
            'txt': 'text/plain',
            'csv': 'text/csv'
        };
        return mimeTypes[ext || ''] || 'application/octet-stream';
    }

    /**
     * Download file content from OneDrive
     */
    private async downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
        try {
            const response = await axios.get(
                `${this.baseUrl}/items/${fileId}/content`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    },
                    responseType: 'arraybuffer'
                }
            );

            return Buffer.from(response.data);
        } catch (error: any) {
            logger.error('❌ [ONEDRIVE INGESTION] Error downloading file', {
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
        file: OneDriveFile,
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
                logger.debug('⏭️ [ONEDRIVE INGESTION] Document already exists, skipping', {
                    documentId: existingDoc.id,
                    filename: file.name
                });
                return existingDoc.id;
            }

            // Get or create evidence source
            let sourceId: string;
            const { data: existingSource } = await supabase
                .from('evidence_sources')
                .select('id')
                .eq('user_id', userId)
                .eq('provider', 'onedrive')
                .maybeSingle();

            if (existingSource) {
                sourceId = existingSource.id;
            } else {
                const { data: newSource, error: sourceError } = await supabase
                    .from('evidence_sources')
                    .insert({
                        user_id: userId,
                        provider: 'onedrive',
                        account_email: userId,
                        status: 'connected',
                        metadata: {
                            connected_at: new Date().toISOString(),
                            source: 'onedrive_graph_api'
                        }
                    })
                    .select('id')
                    .single();

                if (sourceError || !newSource) {
                    logger.error('❌ [ONEDRIVE INGESTION] Failed to create evidence source', {
                        error: sourceError,
                        userId
                    });
                    return null;
                }

                sourceId = newSource.id;
            }

            // Store document metadata
            const documentData = {
                source_id: sourceId,
                user_id: userId,
                provider: 'onedrive',
                external_id: file.id,
                filename: file.name,
                size_bytes: file.size,
                content_type: file.mimeType || 'application/octet-stream',
                created_at: file.modifiedTime,
                modified_at: file.modifiedTime,
                metadata: {
                    file_id: file.id,
                    file_name: file.name,
                    file_path: file.path,
                    mime_type: file.mimeType,
                    ingestion_method: 'onedrive_graph_api',
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
                logger.error('❌ [ONEDRIVE INGESTION] Failed to store document', {
                    error: docError,
                    filename: file.name,
                    userId
                });
                return null;
            }

            // Store file content in Supabase Storage if available
            if (content) {
                try {
                    const bucketName = 'evidence-documents';
                    const filePath = `${userId}/${document.id}/${file.name}`;

                    const { data: uploadData, error: uploadError } = await supabase.storage
                        .from(bucketName)
                        .upload(filePath, content, {
                            contentType: file.mimeType || 'application/octet-stream',
                            upsert: false
                        });

                    if (uploadError) {
                        if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('not found')) {
                            logger.warn('⚠️ [ONEDRIVE INGESTION] Storage bucket not found - file not stored', {
                                bucket: bucketName,
                                documentId: document.id
                            });
                        } else {
                            logger.warn('⚠️ [ONEDRIVE INGESTION] Failed to upload file to storage', {
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

                        logger.info('✅ [ONEDRIVE INGESTION] File stored in Supabase Storage', {
                            documentId: document.id,
                            filename: file.name,
                            path: filePath
                        });
                    }
                } catch (storageError: any) {
                    logger.warn('⚠️ [ONEDRIVE INGESTION] Error storing file content', {
                        error: storageError?.message,
                        documentId: document.id
                    });
                }
            }

            return document.id;
        } catch (error: any) {
            logger.error('❌ [ONEDRIVE INGESTION] Error storing document', {
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
            const pythonApiUrl = process.env.PYTHON_API_URL || 'https://docker-api-13.onrender.com';

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

            logger.info('✅ [ONEDRIVE INGESTION] Triggered parsing pipeline', {
                documentId,
                userId
            });
        } catch (error: any) {
            logger.warn('⚠️ [ONEDRIVE INGESTION] Failed to trigger parsing pipeline', {
                error: error?.message,
                documentId,
                userId
            });
        }
    }
}

export const oneDriveIngestionService = new OneDriveIngestionService();
export default oneDriveIngestionService;
