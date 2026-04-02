/**
 * Adobe Sign Ingestion Service
 * Handles ingestion of signed evidence documents from Adobe Sign
 * Uses Adobe Sign REST API v6 with metadata-first approach
 */

import logger from '../utils/logger';
import { supabase, convertUserIdToUuid } from '../database/supabaseClient';
import axios from 'axios';
import { resolveEvidenceSourceContext } from './evidenceSourceTruthService';

export interface AdobeSignIngestionResult {
    success: boolean;
    documentsIngested: number;
    agreementsProcessed: number;
    errors: string[];
    jobId?: string;
}

export interface AdobeSignAgreement {
    id: string;
    name: string;
    status: string;
    mimeType?: string;
    size: number;
    modifiedDate: string;
    createdDate: string;
    content?: Buffer;
}

export class AdobeSignIngestionService {
    private baseUrl = 'https://api.na1.adobesign.com/api/rest/v6';

    /**
     * Get access token for Adobe Sign from evidence_sources table
     */
    private async getAccessToken(userId: string, tenantId?: string): Promise<string | null> {
        try {
            if (!tenantId) {
                logger.warn('⚠️ [ADOBESIGN INGESTION] Missing tenant context for token lookup', {
                    userId,
                });
                return null;
            }

            const sourceContext = await resolveEvidenceSourceContext(userId, 'adobe_sign', tenantId);
            if (!sourceContext) {
                logger.warn('⚠️ [ADOBESIGN INGESTION] No ingestable Adobe Sign source found for tenant', {
                    userId,
                    tenantId
                });
                return null;
            }

            const metadata = sourceContext.metadata || {};
            const accessToken = metadata.access_token;

            // Check for custom API base URL (different data centers)
            if (metadata.api_access_point) {
                this.baseUrl = `${metadata.api_access_point}api/rest/v6`;
            }

            if (!accessToken) {
                logger.warn('⚠️ [ADOBESIGN INGESTION] No access token found in evidence source', {
                    userId
                });
                return null;
            }

            return accessToken;
        } catch (error: any) {
            logger.error('❌ [ADOBESIGN INGESTION] Error getting access token', {
                error: error?.message || String(error),
                userId
            });
            return null;
        }
    }

    /**
     * Ingest evidence documents from Adobe Sign
     * Metadata-first: list agreements, filter, then download signed PDFs
     */
    async ingestEvidenceFromAdobeSign(
        userId: string,
        options: {
            query?: string;
            maxResults?: number;
            autoParse?: boolean;
            tenantId?: string;
        } = {}
    ): Promise<AdobeSignIngestionResult> {
        const startTime = Date.now();
        const errors: string[] = [];
        let documentsIngested = 0;
        let agreementsProcessed = 0;

        try {
            const tenantId = options.tenantId;
            logger.info('🔍 [ADOBESIGN INGESTION] Starting evidence ingestion from Adobe Sign', {
                userId,
                tenantId,
                maxResults: options.maxResults || 50
            });

            if (!tenantId) {
                return {
                    success: false,
                    documentsIngested: 0,
                    agreementsProcessed: 0,
                    errors: ['Tenant context is required for Adobe Sign evidence ingestion']
                };
            }

            const accessToken = await this.getAccessToken(userId, tenantId);
            if (!accessToken) {
                return {
                    success: false,
                    documentsIngested: 0,
                    agreementsProcessed: 0,
                    errors: ['No connected Adobe Sign account or access token not available']
                };
            }

            // List agreements (signed documents)
            const agreements = await this.listAgreements(accessToken, options.maxResults || 50);

            logger.info(`✅ [ADOBESIGN INGESTION] Found ${agreements.length} agreements in Adobe Sign`, {
                userId,
                agreementCount: agreements.length
            });

            agreementsProcessed = agreements.length;

            // Process each agreement
            for (const agreement of agreements) {
                try {
                    if (!this.isRelevantAgreement(agreement, options.query)) {
                        logger.debug('⏭️ [ADOBESIGN INGESTION] Agreement not relevant, skipping', {
                            agreementId: agreement.id,
                            name: agreement.name,
                            status: agreement.status
                        });
                        continue;
                    }

                    // Download signed PDF
                    let pdfContent: Buffer | undefined;
                    try {
                        pdfContent = await this.downloadAgreementPdf(accessToken, agreement.id);
                    } catch (downloadError: any) {
                        logger.warn('⚠️ [ADOBESIGN INGESTION] Failed to download agreement PDF, storing metadata only', {
                            error: downloadError?.message,
                            agreementId: agreement.id,
                            name: agreement.name
                        });
                    }

                    const documentId = await this.storeEvidenceDocument(userId, agreement, pdfContent, tenantId);

                    if (documentId) {
                        documentsIngested++;
                        logger.info('✅ [ADOBESIGN INGESTION] Stored evidence document', {
                            documentId,
                            agreementId: agreement.id,
                            name: agreement.name,
                            userId,
                            hasContent: !!pdfContent
                        });

                        if (options.autoParse && pdfContent) {
                            await this.triggerParsingPipeline(documentId, userId);
                        }
                    }
                } catch (error: any) {
                    const errorMsg = `Failed to process agreement ${agreement.name}: ${error?.message || String(error)}`;
                    errors.push(errorMsg);
                    logger.error('❌ [ADOBESIGN INGESTION] Error processing agreement', {
                        error: errorMsg,
                        agreementId: agreement.id,
                        userId
                    });
                }
            }

            const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

            logger.info('✅ [ADOBESIGN INGESTION] Evidence ingestion completed', {
                userId,
                documentsIngested,
                agreementsProcessed,
                errors: errors.length,
                elapsedTime: `${elapsedTime}s`
            });

            return {
                success: errors.length === 0,
                documentsIngested,
                agreementsProcessed,
                errors
            };
        } catch (error: any) {
            logger.error('❌ [ADOBESIGN INGESTION] Critical error in evidence ingestion', {
                error: error?.message || String(error),
                stack: error?.stack,
                userId
            });

            return {
                success: false,
                documentsIngested,
                agreementsProcessed,
                errors: [error?.message || String(error)]
            };
        }
    }

    /**
     * Check if agreement is relevant for evidence collection
     */
    private isRelevantAgreement(agreement: AdobeSignAgreement, query?: string): boolean {
        const name = agreement.name.toLowerCase();

        // Only process completed/signed agreements
        const validStatuses = ['SIGNED', 'APPROVED', 'DELIVERED', 'ACCEPTED'];
        if (!validStatuses.includes(agreement.status.toUpperCase())) {
            return false;
        }

        // If a search query is provided, match against it
        if (query) {
            return name.includes(query.toLowerCase());
        }

        // Check name patterns for FBA-relevant documents
        const relevantPatterns = [
            'invoice', 'receipt', 'purchase order', 'po', 'bill',
            'agreement', 'contract', 'shipping', 'delivery',
            'amazon', 'fba', 'reimbursement', 'refund',
            'packing slip', 'order confirmation', 'cost', 'supplier'
        ];

        return relevantPatterns.some(pattern => name.includes(pattern));
    }

    /**
     * List agreements from Adobe Sign API
     */
    private async listAgreements(
        accessToken: string,
        maxResults: number
    ): Promise<AdobeSignAgreement[]> {
        try {
            const response = await axios.get(
                `${this.baseUrl}/agreements`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    params: {
                        pageSize: maxResults
                    }
                }
            );

            const agreements = response.data.userAgreementList || [];

            return agreements.slice(0, maxResults).map((agreement: any) => ({
                id: agreement.id || agreement.agreementId,
                name: agreement.name || agreement.displayName || 'Untitled Agreement',
                status: agreement.status || 'UNKNOWN',
                mimeType: 'application/pdf', // Adobe Sign agreements are always PDFs
                size: 0, // Size not available from list endpoint
                modifiedDate: agreement.lastEventDate || agreement.modifiedDate || new Date().toISOString(),
                createdDate: agreement.createdDate || new Date().toISOString()
            }));
        } catch (error: any) {
            logger.error('❌ [ADOBESIGN INGESTION] Error listing agreements', {
                error: error?.message || String(error)
            });
            return [];
        }
    }

    /**
     * Download signed agreement PDF from Adobe Sign
     */
    private async downloadAgreementPdf(accessToken: string, agreementId: string): Promise<Buffer> {
        try {
            const response = await axios.get(
                `${this.baseUrl}/agreements/${agreementId}/combinedDocument`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    },
                    responseType: 'arraybuffer'
                }
            );

            return Buffer.from(response.data);
        } catch (error: any) {
            logger.error('❌ [ADOBESIGN INGESTION] Error downloading agreement PDF', {
                error: error?.message || String(error),
                agreementId
            });
            throw error;
        }
    }

    /**
     * Store evidence document in database
     */
    private async storeEvidenceDocument(
        userId: string,
        agreement: AdobeSignAgreement,
        content?: Buffer,
        tenantId?: string
    ): Promise<string | null> {
        try {
            const dbUserId = convertUserIdToUuid(userId);
            if (!tenantId) {
                logger.warn('⚠️ [ADOBESIGN INGESTION] Cannot store document without tenant context', {
                    userId,
                    agreementId: agreement.id
                });
                return null;
            }

            const sourceContext = await resolveEvidenceSourceContext(userId, 'adobe_sign', tenantId);
            if (!sourceContext) {
                logger.warn('⚠️ [ADOBESIGN INGESTION] No ingestable Adobe Sign source resolved while storing document', {
                    userId,
                    tenantId,
                    agreementId: agreement.id
                });
                return null;
            }
            // Check if document already exists
            const { data: existingDoc } = await supabase
                .from('evidence_documents')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('user_id', dbUserId)
                .eq('external_id', agreement.id)
                .maybeSingle();

            if (existingDoc) {
                logger.debug('⏭️ [ADOBESIGN INGESTION] Document already exists, skipping', {
                    documentId: existingDoc.id,
                    name: agreement.name
                });
                return existingDoc.id;
            }

            const filename = `${agreement.name}.pdf`;

            const documentData = {
                source_id: sourceContext.id,
                tenant_id: tenantId,
                user_id: dbUserId,
                seller_id: dbUserId,
                provider: 'adobe_sign',
                external_id: agreement.id,
                filename: filename,
                size_bytes: content?.length || 0,
                content_type: 'application/pdf',
                created_at: agreement.createdDate,
                modified_at: agreement.modifiedDate,
                metadata: {
                    agreement_id: agreement.id,
                    agreement_name: agreement.name,
                    agreement_status: agreement.status,
                    ingestion_method: 'adobe_sign_api',
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
                logger.error('❌ [ADOBESIGN INGESTION] Failed to store document', {
                    error: docError,
                    name: agreement.name,
                    userId
                });
                return null;
            }

            // Store file content in Supabase Storage if available
            if (content) {
                try {
                    const bucketName = 'evidence-documents';
                    const filePath = `${dbUserId}/${document.id}/${filename}`;

                    const { data: uploadData, error: uploadError } = await supabase.storage
                        .from(bucketName)
                        .upload(filePath, content, {
                            contentType: 'application/pdf',
                            upsert: false
                        });

                    if (uploadError) {
                        if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('not found')) {
                            logger.warn('⚠️ [ADOBESIGN INGESTION] Storage bucket not found - file not stored', {
                                bucket: bucketName,
                                documentId: document.id
                            });
                        } else {
                            logger.warn('⚠️ [ADOBESIGN INGESTION] Failed to upload file to storage', {
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

                        logger.info('✅ [ADOBESIGN INGESTION] File stored in Supabase Storage', {
                            documentId: document.id,
                            filename,
                            path: filePath
                        });
                    }
                } catch (storageError: any) {
                    logger.warn('⚠️ [ADOBESIGN INGESTION] Error storing file content', {
                        error: storageError?.message,
                        documentId: document.id
                    });
                }
            }

            return document.id;
        } catch (error: any) {
            logger.error('❌ [ADOBESIGN INGESTION] Error storing document', {
                error: error?.message || String(error),
                userId,
                name: agreement.name
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

            logger.info('✅ [ADOBESIGN INGESTION] Triggered parsing pipeline', {
                documentId,
                userId
            });
        } catch (error: any) {
            logger.warn('⚠️ [ADOBESIGN INGESTION] Failed to trigger parsing pipeline', {
                error: error?.message,
                documentId,
                userId
            });
        }
    }
}

export const adobeSignIngestionService = new AdobeSignIngestionService();
export default adobeSignIngestionService;
