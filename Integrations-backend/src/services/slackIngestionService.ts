/**
 * Slack Ingestion Service
 * Handles ingestion of evidence documents shared via Slack
 * Uses Slack Web API to search messages with file attachments
 */

import logger from '../utils/logger';
import { supabase, convertUserIdToUuid } from '../database/supabaseClient';
import axios from 'axios';
import { resolveEvidenceSourceContext } from './evidenceSourceTruthService';

export interface SlackIngestionResult {
    success: boolean;
    documentsIngested: number;
    messagesProcessed: number;
    errors: string[];
    jobId?: string;
}

export interface SlackFile {
    id: string;
    name: string;
    title: string;
    mimeType: string;
    size: number;
    createdTime: string;
    downloadUrl: string;
    channelId?: string;
    channelName?: string;
    userId?: string;
    content?: Buffer;
}

export class SlackIngestionService {
    private baseUrl = 'https://slack.com/api';

    /**
     * Get access token for Slack from evidence_sources table
     */
    private async getAccessToken(userId: string, tenantId?: string): Promise<string | null> {
        try {
            if (!tenantId) {
                logger.warn('⚠️ [SLACK INGESTION] Missing tenant context for token lookup', {
                    userId,
                });
                return null;
            }

            const sourceContext = await resolveEvidenceSourceContext(userId, 'slack', tenantId);
            if (!sourceContext) {
                logger.warn('⚠️ [SLACK INGESTION] No ingestable Slack source found for tenant', {
                    userId,
                    tenantId
                });
                return null;
            }

            const metadata = sourceContext.metadata || {};
            const accessToken = metadata.access_token;

            if (!accessToken) {
                logger.warn('⚠️ [SLACK INGESTION] No access token found in evidence source', {
                    userId
                });
                return null;
            }

            return accessToken;
        } catch (error: any) {
            logger.error('❌ [SLACK INGESTION] Error getting access token', {
                error: error?.message || String(error),
                userId
            });
            return null;
        }
    }

    /**
     * Ingest evidence documents from Slack
     * Searches for shared files in channels the bot has access to
     */
    async ingestEvidenceFromSlack(
        userId: string,
        options: {
            query?: string;
            maxResults?: number;
            autoParse?: boolean;
            channelId?: string;
            tenantId?: string;
        } = {}
    ): Promise<SlackIngestionResult> {
        const startTime = Date.now();
        const errors: string[] = [];
        let documentsIngested = 0;
        let messagesProcessed = 0;

        try {
            const tenantId = options.tenantId;
            logger.info('🔍 [SLACK INGESTION] Starting evidence ingestion from Slack', {
                userId,
                tenantId,
                query: options.query,
                maxResults: options.maxResults || 50,
                channelId: options.channelId
            });

            if (!tenantId) {
                return {
                    success: false,
                    documentsIngested: 0,
                    messagesProcessed: 0,
                    errors: ['Tenant context is required for Slack evidence ingestion']
                };
            }

            const accessToken = await this.getAccessToken(userId, tenantId);
            if (!accessToken) {
                return {
                    success: false,
                    documentsIngested: 0,
                    messagesProcessed: 0,
                    errors: ['No connected Slack account or access token not available']
                };
            }

            // List shared files
            const files = await this.listFiles(accessToken, options.maxResults || 50, options.query, options.channelId);

            logger.info(`✅ [SLACK INGESTION] Found ${files.length} files in Slack`, {
                userId,
                fileCount: files.length
            });

            messagesProcessed = files.length;

            // Process each file
            for (const file of files) {
                try {
                    if (!this.isRelevantDocument(file)) {
                        logger.debug('⏭️ [SLACK INGESTION] File not relevant, skipping', {
                            fileId: file.id,
                            name: file.name
                        });
                        continue;
                    }

                    // Download file content
                    let fileContent: Buffer | undefined;
                    try {
                        fileContent = await this.downloadFile(accessToken, file.downloadUrl);
                    } catch (downloadError: any) {
                        logger.warn('⚠️ [SLACK INGESTION] Failed to download file, storing metadata only', {
                            error: downloadError?.message,
                            fileId: file.id,
                            name: file.name
                        });
                    }

                    const documentId = await this.storeEvidenceDocument(userId, file, fileContent, tenantId);

                    if (documentId) {
                        documentsIngested++;
                        logger.info('✅ [SLACK INGESTION] Stored evidence document', {
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
                    logger.error('❌ [SLACK INGESTION] Error processing file', {
                        error: errorMsg,
                        fileId: file.id,
                        userId
                    });
                }
            }

            const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

            logger.info('✅ [SLACK INGESTION] Evidence ingestion completed', {
                userId,
                documentsIngested,
                messagesProcessed,
                errors: errors.length,
                elapsedTime: `${elapsedTime}s`
            });

            return {
                success: errors.length === 0,
                documentsIngested,
                messagesProcessed,
                errors
            };
        } catch (error: any) {
            logger.error('❌ [SLACK INGESTION] Critical error in evidence ingestion', {
                error: error?.message || String(error),
                stack: error?.stack,
                userId
            });

            return {
                success: false,
                documentsIngested,
                messagesProcessed,
                errors: [error?.message || String(error)]
            };
        }
    }

    /**
     * Check if file is a relevant document (metadata-first filtering)
     */
    private isRelevantDocument(file: SlackFile): boolean {
        const name = file.name.toLowerCase();
        const title = (file.title || '').toLowerCase();

        const relevantPatterns = [
            'invoice', 'receipt', 'fba', 'reimbursement', 'refund',
            'amazon', 'shipping', 'purchase order', 'po', 'bill',
            'packing slip', 'delivery', 'order confirmation'
        ];

        const hasRelevantName = relevantPatterns.some(pattern =>
            name.includes(pattern) || title.includes(pattern)
        );

        // Check MIME types
        const relevantMimeTypes = [
            'application/pdf',
            'image/jpeg', 'image/png', 'image/jpg',
            'application/vnd.openxmlformats-officedocument',
            'application/vnd.ms-excel',
            'application/msword',
            'text/plain', 'text/csv'
        ];
        const hasRelevantMimeType = relevantMimeTypes.some(mime => file.mimeType?.includes(mime));

        // Check file extensions
        const relevantExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.xls', '.doc', '.docx', '.txt', '.csv'];
        const hasRelevantExtension = relevantExtensions.some(ext => name.endsWith(ext));

        // Check file size (max 50MB)
        const maxSize = 50 * 1024 * 1024;
        const hasReasonableSize = file.size <= maxSize;

        return (hasRelevantName || hasRelevantExtension || hasRelevantMimeType) && hasReasonableSize;
    }

    /**
     * List shared files from Slack using files.list API
     */
    private async listFiles(
        accessToken: string,
        maxResults: number,
        query?: string,
        channelId?: string
    ): Promise<SlackFile[]> {
        try {
            const params: any = {
                count: maxResults,
                types: 'all' // pdfs, images, docs, spreadsheets, etc.
            };

            if (channelId) {
                params.channel = channelId;
            }

            // Use files.list to get shared files
            const response = await axios.get(
                `${this.baseUrl}/files.list`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    params
                }
            );

            if (!response.data.ok) {
                logger.error('❌ [SLACK INGESTION] Slack API error listing files', {
                    error: response.data.error
                });
                return [];
            }

            const files = response.data.files || [];

            return files.slice(0, maxResults).map((file: any) => ({
                id: file.id,
                name: file.name || file.title || 'Untitled',
                title: file.title || file.name || '',
                mimeType: file.mimetype || 'application/octet-stream',
                size: file.size || 0,
                createdTime: file.created ? new Date(file.created * 1000).toISOString() : new Date().toISOString(),
                downloadUrl: file.url_private_download || file.url_private || '',
                channelId: file.channels?.[0],
                channelName: file.channel_name,
                userId: file.user
            }));
        } catch (error: any) {
            logger.error('❌ [SLACK INGESTION] Error listing files', {
                error: error?.message || String(error)
            });
            return [];
        }
    }

    /**
     * Download file content from Slack
     * Slack requires the bot token for private file downloads
     */
    private async downloadFile(accessToken: string, downloadUrl: string): Promise<Buffer> {
        try {
            if (!downloadUrl) {
                throw new Error('No download URL provided');
            }

            const response = await axios.get(downloadUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                },
                responseType: 'arraybuffer'
            });

            return Buffer.from(response.data);
        } catch (error: any) {
            logger.error('❌ [SLACK INGESTION] Error downloading file', {
                error: error?.message || String(error),
                downloadUrl: downloadUrl?.substring(0, 50) + '...'
            });
            throw error;
        }
    }

    /**
     * Store evidence document in database
     */
    private async storeEvidenceDocument(
        userId: string,
        file: SlackFile,
        content?: Buffer,
        tenantId?: string
    ): Promise<string | null> {
        try {
            const dbUserId = convertUserIdToUuid(userId);
            if (!tenantId) {
                logger.warn('⚠️ [SLACK INGESTION] Cannot store document without tenant context', {
                    userId,
                    fileId: file.id
                });
                return null;
            }

            const sourceContext = await resolveEvidenceSourceContext(userId, 'slack', tenantId);
            if (!sourceContext) {
                logger.warn('⚠️ [SLACK INGESTION] No ingestable Slack source resolved while storing document', {
                    userId,
                    tenantId,
                    fileId: file.id
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
                logger.debug('⏭️ [SLACK INGESTION] Document already exists, skipping', {
                    documentId: existingDoc.id,
                    filename: file.name
                });
                return existingDoc.id;
            }

            const documentData = {
                source_id: sourceContext.id,
                tenant_id: tenantId,
                user_id: dbUserId,
                seller_id: dbUserId,
                provider: 'slack',
                external_id: file.id,
                filename: file.name,
                size_bytes: file.size,
                content_type: file.mimeType || 'application/octet-stream',
                created_at: file.createdTime,
                modified_at: file.createdTime,
                metadata: {
                    file_id: file.id,
                    file_name: file.name,
                    file_title: file.title,
                    channel_id: file.channelId,
                    channel_name: file.channelName,
                    slack_user_id: file.userId,
                    mime_type: file.mimeType,
                    ingestion_method: 'slack_web_api',
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
                logger.error('❌ [SLACK INGESTION] Failed to store document', {
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
                    const filePath = `${dbUserId}/${document.id}/${file.name}`;

                    const { data: uploadData, error: uploadError } = await supabase.storage
                        .from(bucketName)
                        .upload(filePath, content, {
                            contentType: file.mimeType || 'application/octet-stream',
                            upsert: false
                        });

                    if (uploadError) {
                        if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('not found')) {
                            logger.warn('⚠️ [SLACK INGESTION] Storage bucket not found - file not stored', {
                                bucket: bucketName,
                                documentId: document.id
                            });
                        } else {
                            logger.warn('⚠️ [SLACK INGESTION] Failed to upload file to storage', {
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

                        logger.info('✅ [SLACK INGESTION] File stored in Supabase Storage', {
                            documentId: document.id,
                            filename: file.name,
                            path: filePath
                        });
                    }
                } catch (storageError: any) {
                    logger.warn('⚠️ [SLACK INGESTION] Error storing file content', {
                        error: storageError?.message,
                        documentId: document.id
                    });
                }
            }

            return document.id;
        } catch (error: any) {
            logger.error('❌ [SLACK INGESTION] Error storing document', {
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

            logger.info('✅ [SLACK INGESTION] Triggered parsing pipeline', {
                documentId,
                userId
            });
        } catch (error: any) {
            logger.warn('⚠️ [SLACK INGESTION] Failed to trigger parsing pipeline', {
                error: error?.message,
                documentId,
                userId
            });
        }
    }
}

export const slackIngestionService = new SlackIngestionService();
export default slackIngestionService;
