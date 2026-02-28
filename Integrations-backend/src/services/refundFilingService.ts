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
    asin?: string;
    sku?: string;
    claim_type: string;
    amount_claimed: number;
    currency: string;
    evidence_document_ids: string[];
    confidence_score: number;
    subject?: string;
    body?: string;
}

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
        this.pythonApiUrl = process.env.PYTHON_API_URL || 'https://docker-api-13.onrender.com';
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

    /**
    * File a dispute case via Python SP-API service (mock for MVP)
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

            // Prepare payload for Python API
            const context = {
                caseType: request.claim_type,
                amount: request.amount_claimed,
                currency: request.currency,
                orderId: request.order_id,
                shipmentId: (request as any).shipment_id || request.order_id, // Fallback if shipment_id not provided
                asin: request.asin,
                sku: request.sku,
                evidenceFilenames: evidenceDocuments.map(d => d.filename),
                quantity: (request as any).quantity || 1
            };

            const brief = briefGeneratorService.generateBrief(context);

            const payload = {
                dispute_id: request.dispute_id,
                user_id: request.user_id,
                order_id: request.order_id,
                asin: request.asin,
                sku: request.sku,
                claim_type: request.claim_type,
                amount_claimed: request.amount_claimed,
                currency: request.currency,
                evidence_documents: evidenceDocuments,
                confidence_score: request.confidence_score,
                subject: brief.subject,
                body: brief.body,
                policy_cited: brief.policyCited
            };

            // DRY RUN Support: Write to local file instead of calling API
            if (process.env.DRY_RUN === 'true' || (global as any).DRY_RUN === true) {
                const outputDir = path.join(process.cwd(), 'test_output');
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                const fileName = `case_payload_${request.dispute_id.slice(0, 8)}.json`;
                const filePath = path.join(outputDir, fileName);

                fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

                logger.info('[DRY RUN] Case payload saved safely', { filePath });

                return {
                    success: true,
                    submission_id: `DRY-RUN-${request.dispute_id.slice(0, 8)}`,
                    amazon_case_id: `MOCK-${request.dispute_id.slice(0, 8)}`,
                    status: 'submitted'
                };
            }

            // Use seller-specific HTTP client for IP isolation
            const httpClient = createSellerHttpClient(request.user_id);

            // IDEMPOTENCY KEY: Deterministic per dispute_id so crash-retries
            // send the same key and Amazon's SP-API rejects the duplicate.
            const idempotencyKey = crypto.createHash('sha256')
                .update(`filing_${request.dispute_id}`)
                .digest('hex');

            const response = await httpClient.post(
                `${this.pythonApiUrl}/api/v1/disputes/submit`,
                payload,
                {
                    headers: this.buildServiceHeaders(request.user_id, 'file-dispute', {
                        'Content-Type': 'application/json',
                        'X-User-Id': request.user_id,
                        'x-amzn-idempotency-key': idempotencyKey
                    }),
                    timeout: 120000 // 120 seconds
                }
            );

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
    private async getEvidenceDocuments(evidenceIds: string[], userId: string): Promise<any[]> {
        try {
            const { data: documents, error } = await supabaseAdmin
                .from('evidence_documents')
                .select('id, filename, content_type, size_bytes, file_url, parsed_metadata')
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
                download_url: doc.file_url,
                parsed_metadata: doc.parsed_metadata || {}
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
}

// Export singleton instance
const refundFilingService = new RefundFilingService();
export default refundFilingService;

