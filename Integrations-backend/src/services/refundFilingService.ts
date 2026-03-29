/**
 * Refund Filing Service
 * Wraps Python SP-API service for filing disputes
 * Handles retry logic, evidence collection, and status polling
 * 
 * IP CONTAMINATION PREVENTION:
 * Uses SellerHttpClient to route all API calls through seller-specific proxies.
 * Each seller has a dedicated IP to prevent chain bans.
 */

import axios from 'axios';
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import { buildPythonServiceAuthHeader } from '../utils/pythonServiceAuth';
import { createSellerHttpClient } from './sellerHttpClient';
import { briefGeneratorService } from './briefGeneratorService';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';

export interface FilingRequest {
    dispute_id: string;
    user_id: string;
    order_id: string;
    shipment_id?: string;
    asin?: string;
    sku?: string;
    claim_type: string;
    amount_claimed: number;
    currency: string;
    evidence_document_ids: string[];
    confidence_score: number;
    subject?: string;
    body?: string;
    metadata?: Record<string, any>;
}

interface EvidenceDocumentRecord {
    id: string;
    filename: string;
    content_type: string | null;
    size_bytes: number | null;
    file_url?: string | null;
    storage_path?: string | null;
    doc_type?: string | null;
    parsed_metadata?: Record<string, any>;
    extracted?: Record<string, any>;
    metadata?: Record<string, any>;
    source_provider?: string | null;
    created_at?: string | null;
    ingested_at?: string | null;
}

interface SubmissionAttachment {
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    docType: string;
    sourceProvider?: string | null;
    parsedMetadata: Record<string, any>;
    extracted: Record<string, any>;
    metadata: Record<string, any>;
    createdAt?: string | null;
    ingestedAt?: string | null;
    bytes: Buffer;
    sha256: string;
    categories: string[];
}

interface AttachmentPack {
    attachments: SubmissionAttachment[];
    manifest: Array<{
        id: string;
        filename: string;
        content_type: string;
        size_bytes: number;
        doc_type: string;
        categories: string[];
        sha256: string;
        source_provider?: string | null;
    }>;
    labels: string[];
}

type ClaimAttachmentProfile = {
    key: 'inbound' | 'fc_damage' | 'refund_return' | 'generic' | 'transfer_loss' | 'warehouse_damage' | 'fee_overcharge' | 'missing_return' | 'reimbursement_missing';
    requiredCategories: string[][];
};

export interface FilingResult {
    success: boolean;
    submission_id?: string;
    amazon_case_id?: string;
    status: 'pending' | 'submitted' | 'approved' | 'rejected' | 'failed';
    error_message?: string;
    retry_after?: Date;
}

export interface CaseStatus {
    success: boolean;
    status: 'open' | 'in_progress' | 'approved' | 'denied' | 'closed';
    amazon_case_id?: string;
    resolution?: string;
    amount_approved?: number;
    last_updated?: string;
    error?: string;
}

class RefundFilingService {
    private pythonApiUrl: string;
    private maxRetries: number = 3;
    private retryDelayMs: number = 5000; // 5 seconds base delay

    constructor() {
        this.pythonApiUrl = process.env.PYTHON_API_URL || 'https://clario-complete-backend-6ca7.onrender.com';
        this.maxRetries = parseInt(process.env.REFUND_FILING_MAX_RETRIES || '3', 10);
        this.retryDelayMs = parseInt(process.env.REFUND_FILING_RETRY_DELAY_MS || '5000', 10);
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
                metadata: { source: `refund-filing:${context}` }
            })
        };
    }

    private resolveClaimAttachmentProfile(claimType: string): ClaimAttachmentProfile {
        const normalized = (claimType || '').toLowerCase();

        if (
            normalized.includes('fee') ||
            normalized.includes('overcharge') ||
            normalized.includes('dimension') ||
            normalized.includes('weight') ||
            normalized.includes('storage')
        ) {
            return {
                key: 'fee_overcharge',
                requiredCategories: [
                    ['invoice', 'inventory', 'reference']
                ]
            };
        }

        if (
            normalized.includes('return') ||
            normalized.includes('refund')
        ) {
            return {
                key: 'missing_return',
                requiredCategories: [
                    ['invoice', 'purchase_order'],
                    ['reference']
                ]
            };
        }

        if (
            normalized.includes('reimbursement') ||
            normalized.includes('adjustment')
        ) {
            return {
                key: 'reimbursement_missing',
                requiredCategories: [
                    ['inventory', 'reference']
                ]
            };
        }

        if (normalized.includes('transfer')) {
            return {
                key: 'transfer_loss',
                requiredCategories: [
                    ['invoice', 'purchase_order', 'inventory'],
                    ['shipping', 'reference']
                ]
            };
        }

        if (
            normalized.includes('warehouse') ||
            normalized.includes('damage') ||
            normalized.includes('fulfillment') ||
            normalized.includes('fc_')
        ) {
            return {
                key: 'warehouse_damage',
                requiredCategories: [
                    ['invoice', 'purchase_order', 'inventory']
                ]
            };
        }

        if (
            normalized.includes('inbound') ||
            normalized.includes('shipment') ||
            normalized.includes('lost') ||
            normalized.includes('missing')
        ) {
            return {
                key: 'inbound',
                requiredCategories: [
                    ['invoice', 'purchase_order'],
                    ['proof_of_delivery', 'shipping'],
                    ['inventory', 'reference']
                ]
            };
        }

        if (
            normalized.includes('warehouse') ||
            normalized.includes('damage') ||
            normalized.includes('fulfillment') ||
            normalized.includes('fc_')
        ) {
            return {
                key: 'fc_damage',
                requiredCategories: [
                    ['invoice', 'purchase_order'],
                    ['inventory']
                ]
            };
        }

        if (normalized.includes('refund') || normalized.includes('return')) {
            return {
                key: 'refund_return',
                requiredCategories: [
                    ['invoice', 'purchase_order'],
                    ['reference']
                ]
            };
        }

        return {
            key: 'generic',
            requiredCategories: [
                ['invoice', 'purchase_order']
            ]
        };
    }

    private classifyDocumentCategories(document: EvidenceDocumentRecord): string[] {
        const docType = String(document.doc_type || '').toLowerCase();
        const filename = String(document.filename || '').toLowerCase();
        const extracted = document.extracted || {};
        const parsed = document.parsed_metadata || {};
        const filenameAndType = `${filename} ${docType}`;

        const categories = new Set<string>();

        if (
            docType === 'invoice' ||
            /invoice|receipt|commercial invoice|tax invoice|vendor invoice|supplier/.test(filenameAndType)
        ) {
            categories.add('invoice');
        }

        if (
            docType === 'po' ||
            /purchase order|\bpo\b/.test(filenameAndType)
        ) {
            categories.add('purchase_order');
        }

        if (
            docType === 'shipping' ||
            /shipment|shipping|tracking|bill of lading|\bbol\b|awb|waybill|manifest/.test(filenameAndType) ||
            Boolean(extracted?.shipment_id || extracted?.fba_shipment_id || parsed?.tracking_numbers?.length)
        ) {
            categories.add('shipping');
        }

        if (
            /proof of delivery|\bpod\b|delivery confirmation/.test(filenameAndType) ||
            Boolean(parsed?.signed_by || parsed?.delivery_date || extracted?.signed_by)
        ) {
            categories.add('proof_of_delivery');
        }

        if (
            /inventory|ledger|adjustment|reconciliation/.test(filenameAndType) ||
            Boolean(extracted?.event_ids?.length || extracted?.calculated_stock !== undefined || parsed?.inventory_adjustment_id)
        ) {
            categories.add('inventory');
        }

        if (
            extracted?.shipment_id ||
            extracted?.fba_shipment_id ||
            extracted?.order_id ||
            extracted?.reference_id ||
            parsed?.shipment_id ||
            parsed?.order_id
        ) {
            categories.add('reference');
        }

        if (categories.size === 0) {
            categories.add('supporting');
        }

        return Array.from(categories);
    }

    private async downloadEvidenceBytes(document: EvidenceDocumentRecord): Promise<Buffer> {
        if (document.storage_path) {
            const { data, error } = await supabaseAdmin
                .storage
                .from('evidence-documents')
                .download(document.storage_path);

            if (error || !data) {
                throw new Error(`Failed to download storage object for ${document.filename}: ${error?.message || 'missing file'}`);
            }

            return Buffer.from(await data.arrayBuffer());
        }

        if (document.file_url) {
            const response = await axios.get(document.file_url, {
                responseType: 'arraybuffer',
                timeout: 60000
            });
            return Buffer.from(response.data);
        }

        throw new Error(`Evidence document ${document.id} has no storage path or file URL`);
    }

    private async buildAttachmentPack(
        evidenceDocuments: EvidenceDocumentRecord[],
        claimType: string,
        options?: {
            allowPartial?: boolean;
        }
    ): Promise<AttachmentPack> {
        const profile = this.resolveClaimAttachmentProfile(claimType);
        const attachments: SubmissionAttachment[] = [];

        for (const document of evidenceDocuments) {
            const bytes = await this.downloadEvidenceBytes(document);
            const contentType = document.content_type || 'application/octet-stream';
            const sizeBytes = document.size_bytes || bytes.length;
            const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
            const categories = this.classifyDocumentCategories(document);

            attachments.push({
                id: document.id,
                filename: document.filename,
                contentType,
                sizeBytes,
                docType: document.doc_type || 'other',
                sourceProvider: document.source_provider || null,
                parsedMetadata: document.parsed_metadata || {},
                extracted: document.extracted || {},
                metadata: document.metadata || {},
                createdAt: document.created_at || null,
                ingestedAt: document.ingested_at || null,
                bytes,
                sha256,
                categories
            });
        }

        const missingGroups = profile.requiredCategories.filter((group) =>
            !attachments.some((attachment) => group.some((category) => attachment.categories.includes(category)))
        );

        if (missingGroups.length > 0 && !options?.allowPartial) {
            const missing = missingGroups.map((group) => group.join('|')).join(', ');
            throw new Error(`Submission blocked: missing required attachment categories for ${profile.key}: ${missing}`);
        }

        return {
            attachments,
            manifest: attachments.map((attachment) => ({
                id: attachment.id,
                filename: attachment.filename,
                content_type: attachment.contentType,
                size_bytes: attachment.sizeBytes,
                doc_type: attachment.docType,
                categories: attachment.categories,
                sha256: attachment.sha256,
                source_provider: attachment.sourceProvider || null
            })),
            labels: attachments.map((attachment) =>
                `${attachment.filename} (${attachment.categories.join(', ')})`
            )
        };
    }

    private async postMultipartSubmission(
        payload: Record<string, any>,
        attachmentPack: AttachmentPack,
        userId: string,
        idempotencyKey: string,
        httpClient: ReturnType<typeof createSellerHttpClient>
    ) {
        const FormDataCtor = (globalThis as any).FormData;
        const BlobCtor = (globalThis as any).Blob;

        if (!FormDataCtor || !BlobCtor) {
            throw new Error('Runtime FormData/Blob support is unavailable');
        }

        const form = new FormDataCtor();

        for (const [key, value] of Object.entries(payload)) {
            if (value === undefined || value === null) continue;

            if (typeof value === 'object') {
                form.append(key, JSON.stringify(value));
            } else {
                form.append(key, String(value));
            }
        }

        for (const attachment of attachmentPack.attachments) {
            const blob = new BlobCtor([attachment.bytes], { type: attachment.contentType });
            form.append('attachments', blob, attachment.filename);
        }

        return httpClient.post(
            `${this.pythonApiUrl}/api/v1/disputes/submit`,
            form,
            {
                headers: this.buildServiceHeaders(userId, 'file-dispute-multipart', {
                    'X-User-Id': userId,
                    'x-amzn-idempotency-key': idempotencyKey
                }),
                timeout: 120000
            }
        );
    }

    private async postJsonSubmission(
        payload: Record<string, any>,
        attachmentPack: AttachmentPack,
        userId: string,
        idempotencyKey: string,
        httpClient: ReturnType<typeof createSellerHttpClient>
    ) {
        const evidenceDocuments = attachmentPack.attachments.map((attachment) => ({
            id: attachment.id,
            filename: attachment.filename,
            content_type: attachment.contentType,
            size_bytes: attachment.sizeBytes,
            doc_type: attachment.docType,
            categories: attachment.categories,
            parsed_metadata: attachment.parsedMetadata,
            extracted: attachment.extracted,
            metadata: attachment.metadata,
            source_provider: attachment.sourceProvider || null,
            created_at: attachment.createdAt || null,
            ingested_at: attachment.ingestedAt || null,
            sha256: attachment.sha256,
            file_bytes_base64: attachment.bytes.toString('base64')
        }));

        return httpClient.post(
            `${this.pythonApiUrl}/api/v1/disputes/submit`,
            {
                ...payload,
                evidence_documents: evidenceDocuments,
                attachment_manifest: attachmentPack.manifest
            },
            {
                headers: this.buildServiceHeaders(userId, 'file-dispute-json', {
                    'Content-Type': 'application/json',
                    'X-User-Id': userId,
                    'x-amzn-idempotency-key': idempotencyKey
                }),
                timeout: 120000
            }
        );
    }

    /**
    * File a dispute case via Python SP-API service
    */
    async fileDispute(request: FilingRequest): Promise<FilingResult> {
        try {
            logger.info('[REFUND FILING] Filing dispute case', {
                disputeId: request.dispute_id,
                userId: request.user_id,
                amount: request.amount_claimed,
                confidence: request.confidence_score
            });

            // Get evidence documents
            const evidenceDocuments = await this.getEvidenceDocuments(request.evidence_document_ids, request.user_id);
            const filingStrategy = String(request.metadata?.filing_strategy || '').toUpperCase();
            const attachmentPack = await this.buildAttachmentPack(evidenceDocuments, request.claim_type, {
                allowPartial: filingStrategy === 'SMART'
            });

            // Prepare payload for Python API
            const context = {
                caseType: request.claim_type,
                amount: request.amount_claimed,
                currency: request.currency,
                orderId: request.order_id,
                shipmentId: request.shipment_id || undefined,
                asin: request.asin,
                sku: request.sku,
                evidenceFilenames: attachmentPack.labels,
                quantity: (request.metadata?.quantity as number | undefined) || 1,
                strategyHints: Array.isArray(request.metadata?.strategy_hints)
                    ? (request.metadata?.strategy_hints as string[])
                    : []
            };

            const brief = briefGeneratorService.generateBrief(context);
            const explanationPayload = request.metadata?.explanation_payload || null;
            const explanationSuffix = explanationPayload
                ? `\n\nDecision note:\n${explanationPayload.justification}${Array.isArray(explanationPayload.missing_fields) && explanationPayload.missing_fields.length > 0 ? `\nMissing fields: ${explanationPayload.missing_fields.join(', ')}` : ''}${Array.isArray(explanationPayload.assumptions) && explanationPayload.assumptions.length > 0 ? `\nAssumptions: ${explanationPayload.assumptions.join('; ')}` : ''}`
                : '';

            const payload = {
                dispute_id: request.dispute_id,
                user_id: request.user_id,
                order_id: request.order_id,
                shipment_id: request.shipment_id,
                asin: request.asin,
                sku: request.sku,
                claim_type: request.claim_type,
                quantity: (request.metadata?.quantity as number | undefined) || 1,
                amount_claimed: request.amount_claimed,
                currency: request.currency,
                attachment_manifest: attachmentPack.manifest,
                confidence_score: request.confidence_score,
                subject: brief.subject,
                body: `${brief.body}${explanationSuffix}`,
                policy_cited: brief.policyCited,
                metadata: request.metadata || {}
            };

            // DRY RUN Support: persist the payload for inspection, but never pretend filing succeeded.
            if (process.env.DRY_RUN === 'true' || (global as any).DRY_RUN === true) {
                const outputDir = path.join(process.cwd(), 'test_output');
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                const fileName = `case_payload_${request.dispute_id.slice(0, 8)}.json`;
                const filePath = path.join(outputDir, fileName);

                fs.writeFileSync(filePath, JSON.stringify({
                    payload,
                    attachments: attachmentPack.manifest
                }, null, 2));

                logger.info('[DRY RUN] Case payload saved safely', { filePath });

                return {
                    success: false,
                    status: 'failed',
                    error_message: 'DRY_RUN is enabled. Submission payload was captured, but no real Amazon filing occurred.'
                };
            }

            // Use seller-specific HTTP client for IP isolation
            const httpClient = createSellerHttpClient(request.user_id);

            // IDEMPOTENCY KEY: Deterministic per dispute_id so crash-retries
            // send the same key and Amazon's SP-API rejects the duplicate.
            const idempotencyKey = crypto.createHash('sha256')
                .update(`filing_${request.dispute_id}`)
                .digest('hex');

            // --- CHAOS HOOK: TOKEN DECAY ---
            if (process.env.SIMULATE_TOKEN_EXPIRE === 'true') {
                logger.warn('[CHAOS] SIMULATE_TOKEN_EXPIRE active. Simulating stale token.');
                // We modify the payload directly to trigger fallback in the worker/service logic
                payload.body = "EXPIRED_TOKEN_SIMULATION_TRIGGER"; 
            }
            // -------------------------------

            let response;
            try {
                response = await this.postMultipartSubmission(payload, attachmentPack, request.user_id, idempotencyKey, httpClient);
            } catch (multipartError: any) {
                logger.warn('[REFUND FILING] Multipart submission failed, retrying with JSON attachment bytes', {
                    disputeId: request.dispute_id,
                    error: multipartError.message
                });
                response = await this.postJsonSubmission(payload, attachmentPack, request.user_id, idempotencyKey, httpClient);
            }

            // Log proxy info for audit
            logger.debug('[REFUND FILING] Request routed through proxy', {
                disputeId: request.dispute_id,
                usingProxy: httpClient.isUsingProxy(),
                proxyInfo: httpClient.getProxyInfo()
            });


            if (response.data?.ok && response.data?.data) {
                const data = response.data.data;
                return {
                    success: true,
                    submission_id: data.submission_id,
                    amazon_case_id: data.amazon_case_id,
                    status: this.mapStatus(data.status),
                    error_message: undefined
                };
            } else {
                throw new Error(`Python API returned unexpected response: ${JSON.stringify(response.data)}`);
            }

        } catch (error: any) {
            logger.error('[ERROR] [REFUND FILING] Failed to file dispute', {
                disputeId: request.dispute_id,
                userId: request.user_id,
                error: error.message,
                response: error.response?.data
            });

            return {
                success: false,
                status: 'failed',
                error_message: error.message || 'Unknown error'
            };
        }
    }

    /**
    * File dispute with retry logic
    */
    async fileDisputeWithRetry(request: FilingRequest, retryCount: number = 0): Promise<FilingResult> {
        let lastError: any;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const result = await this.fileDispute(request);

                if (result.success) {
                    return result;
                }

                lastError = new Error(result.error_message || 'Filing failed');

                // Don't retry if it's a non-retryable error
                if (result.status === 'rejected' && attempt === 0) {
                    // First attempt rejected - might need stronger evidence
                    logger.warn('[WARN] [REFUND FILING] Case rejected, may need stronger evidence', {
                        disputeId: request.dispute_id,
                        attempt: attempt + 1
                    });
                }

                if (attempt < this.maxRetries) {
                    const delay = this.retryDelayMs * Math.pow(2, attempt);
                    logger.warn(`[RETRY] [REFUND FILING] Retry attempt ${attempt + 1}/${this.maxRetries} after ${delay}ms`, {
                        disputeId: request.dispute_id,
                        delay
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error: any) {
                lastError = error;

                if (attempt < this.maxRetries) {
                    const delay = this.retryDelayMs * Math.pow(2, attempt);
                    logger.warn(`[RETRY] [REFUND FILING] Retry attempt ${attempt + 1}/${this.maxRetries} after ${delay}ms`, {
                        disputeId: request.dispute_id,
                        error: error.message,
                        delay
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        return {
            success: false,
            status: 'failed',
            error_message: lastError?.message || 'Max retries exceeded'
        };
    }

    /**
    * Check case status from Amazon (via Python API)
    */
    async checkCaseStatus(submissionId: string, userId: string): Promise<CaseStatus> {
        try {
            const response = await axios.get(
                `${this.pythonApiUrl}/api/v1/disputes/status/${submissionId}`,
                {
                    headers: this.buildServiceHeaders(userId, 'case-status', {
                        'X-User-Id': userId
                    }),
                    timeout: 30000
                }
            );

            if (response.data?.ok && response.data?.data) {
                const data = response.data.data;
                return {
                    success: true,
                    status: this.mapCaseStatus(data.status),
                    amazon_case_id: data.amazon_case_id,
                    resolution: data.resolution,
                    amount_approved: data.amount_approved,
                    last_updated: data.last_updated
                };
            } else {
                return {
                    success: false,
                    status: 'open',
                    error: `Unexpected response: ${JSON.stringify(response.data)}`
                };
            }

        } catch (error: any) {
            logger.error(' [REFUND FILING] Failed to check case status', {
                submissionId,
                userId,
                error: error.message
            });

            return {
                success: false,
                status: 'open',
                error: error.message || 'Unknown error'
            };
        }
    }

    /**
    * Collect additional evidence for retry (stronger evidence package)
    */
    async collectStrongerEvidence(disputeId: string, userId: string): Promise<string[]> {
        try {
            logger.info(' [REFUND FILING] Collecting stronger evidence for retry', {
                disputeId,
                userId
            });

            // Get all evidence documents linked to this dispute
            const { data: evidenceLinks, error } = await supabaseAdmin
                .from('dispute_evidence_links')
                .select('evidence_document_id')
                .eq('dispute_case_id', disputeId);

            if (error) {
                logger.error(' [REFUND FILING] Failed to get evidence links', { error: error.message });
                return [];
            }

            const evidenceIds = (evidenceLinks || []).map(link => link.evidence_document_id);

            // Also get any additional evidence documents for the same order/claim
            // Note: order_id, asin, sku come from detection_results.evidence JSONB, not dispute_cases
            const { data: disputeCase } = await supabaseAdmin
                .from('dispute_cases')
                .select(`
 detection_result_id,
 detection_results!inner (
 evidence
 )
 `)
                .eq('id', disputeId)
                .single();

            if (disputeCase) {
                // Extract order details from detection_results.evidence JSONB
                const detectionEvidence = (disputeCase as any).detection_results?.evidence || {};
                const orderId = detectionEvidence.order_id || '';
                const asin = detectionEvidence.asin || '';
                const sku = detectionEvidence.sku || '';

                // Get additional evidence documents that might match the same order
                // Note: evidence_documents doesn't have order_id column, so we search in extracted/parsed_metadata
                const { data: additionalEvidence } = await supabaseAdmin
                    .from('evidence_documents')
                    .select('id, extracted, parsed_metadata')
                    .eq('seller_id', userId)
                    .neq('parser_status', 'failed')
                    .limit(20);

                // Filter evidence that matches order details
                const matchingEvidence = (additionalEvidence || []).filter(doc => {
                    const extracted = doc.extracted || {};
                    const parsed = doc.parsed_metadata || {};
                    const items = extracted.items || parsed.line_items || [];

                    // Check if any item matches our order details
                    return items.some((item: any) =>
                        item.sku === sku || item.asin === asin || item.order_id === orderId
                    ) || extracted.order_id === orderId || parsed.invoice_number === orderId;
                });

                const additionalIds = matchingEvidence.map(doc => doc.id);

                const allIds = [...new Set([...evidenceIds, ...additionalIds])];

                logger.info(' [REFUND FILING] Collected stronger evidence', {
                    disputeId,
                    originalCount: evidenceIds.length,
                    additionalCount: additionalIds.length,
                    totalCount: allIds.length
                });

                return allIds;
            }

            return evidenceIds;

        } catch (error: any) {
            logger.error(' [REFUND FILING] Failed to collect stronger evidence', {
                disputeId,
                userId,
                error: error.message
            });
            return [];
        }
    }

    /**
    * Get evidence documents by IDs
    */
    private async getEvidenceDocuments(evidenceIds: string[], userId: string): Promise<EvidenceDocumentRecord[]> {
        try {
            const { data: documents, error } = await supabaseAdmin
                .from('evidence_documents')
                .select('id, filename, content_type, size_bytes, file_url, storage_path, doc_type, parsed_metadata, extracted, metadata, created_at')
                .in('id', evidenceIds)
                .eq('seller_id', userId);

            if (error) {
                logger.error(' [REFUND FILING] Failed to get evidence documents', { error: error.message });
                return [];
            }

            return (documents || []).map(doc => ({
                id: doc.id,
                filename: doc.filename,
                content_type: doc.content_type,
                size_bytes: doc.size_bytes,
                file_url: doc.file_url,
                storage_path: (doc as any).storage_path || null,
                doc_type: (doc as any).doc_type || null,
                parsed_metadata: doc.parsed_metadata || {},
                extracted: (doc as any).extracted || {},
                metadata: (doc as any).metadata || {},
                source_provider: null,
                created_at: (doc as any).created_at || null,
                ingested_at: null
            }));

        } catch (error: any) {
            logger.error(' [REFUND FILING] Failed to get evidence documents', { error: error.message });
            return [];
        }
    }

    /**
    * Map Python API status to internal status
    */
    private mapStatus(status: string): 'pending' | 'submitted' | 'approved' | 'rejected' | 'failed' {
        const statusMap: Record<string, 'pending' | 'submitted' | 'approved' | 'rejected' | 'failed'> = {
            'pending': 'pending',
            'submitted': 'submitted',
            'approved': 'approved',
            'rejected': 'rejected',
            'denied': 'rejected',
            'failed': 'failed',
            'retrying': 'pending'
        };

        return statusMap[status.toLowerCase()] || 'pending';
    }

    /**
    * Map Python API case status to internal case status
    */
    private mapCaseStatus(status: string): 'open' | 'in_progress' | 'approved' | 'denied' | 'closed' {
        const statusMap: Record<string, 'open' | 'in_progress' | 'approved' | 'denied' | 'closed'> = {
            'open': 'open',
            'pending': 'open',
            'in_progress': 'in_progress',
            'under_review': 'in_progress',
            'approved': 'approved',
            'rejected': 'denied',
            'denied': 'denied',
            'closed': 'closed',
            'paid': 'approved'
        };

        return statusMap[status.toLowerCase()] || 'open';
    }

    /**
     * Ghost Hunt Reconciliation:
     * Searches Amazon index for a case matching the idempotency key.
     */
    async findCaseByIdempotencyKey(sellerId: string, idempotencyKey: string): Promise<{ id: string } | null> {
        try {
            const httpClient = createSellerHttpClient(sellerId);
            const response = await httpClient.get(
                `${this.pythonApiUrl}/api/v1/disputes/search`,
                {
                    params: { idempotency_key: idempotencyKey },
                    headers: this.buildServiceHeaders(sellerId, 'search-disputes')
                }
            );

            if (response.data?.ok && response.data?.data?.case_id) {
                return { id: response.data.data.case_id };
            }

            return null;
        } catch (err: any) {
            logger.error(`[FORTRESS] Failed to search Amazon for idempotency key: ${idempotencyKey}`, { error: err.message });
            return null;
        }
    }
}

// Export singleton instance
const refundFilingService = new RefundFilingService();
export default refundFilingService;

