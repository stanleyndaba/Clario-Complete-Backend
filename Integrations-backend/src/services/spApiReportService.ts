/**
 * SP-API Report Service
 * 
 * Shared utility for requesting, polling, and downloading Amazon SP-API reports.
 * Used by returns, catalog, and inventory ledger sync services.
 * 
 * Report workflow: Request → Poll → Download → Parse
 * SP-API Reports v2021-06-30
 */

import axios from 'axios';
import logger from '../utils/logger';

// Lazy imports to avoid circular dependencies
const getAmazonService = () => import('./amazonService').then(m => m.default);

export interface ReportRequest {
    reportType: string;
    dataStartTime?: string;
    dataEndTime?: string;
    marketplaceIds?: string[];
}

export interface ReportStatus {
    reportId: string;
    status: 'CANCELLED' | 'DONE' | 'FATAL' | 'IN_PROGRESS' | 'IN_QUEUE';
    reportDocumentId?: string;
    processingEndTime?: string;
}

export interface ReportDocument {
    reportDocumentId: string;
    url: string;
    compressionAlgorithm?: string;
}

/**
 * Normalize a TSV header to lowercase-kebab-case for consistent access.
 * Amazon uses inconsistent casing: "FNSKU", "fnsku", "Fulfillment Center", "fulfillment-center-id"
 * This normalizes ALL of them so our services can use a single field name.
 */
function normalizeHeader(header: string): string {
    return header
        .trim()
        .replace(/"/g, '')
        .toLowerCase()
        .replace(/\s+/g, '-')       // "Event Type" → "event-type"
        .replace(/_/g, '-');         // "order_id"   → "order-id"
}

/**
 * Parse a TSV (Tab-Separated Values) string into an array of objects.
 * 
 * Headers are normalized to lowercase-kebab-case so that downstream services
 * never need to worry about Amazon's inconsistent casing:
 *   "FNSKU" → "fnsku"
 *   "Event Type" → "event-type"
 *   "fulfillment_center_id" → "fulfillment-center-id"
 * 
 * Each record is keyed by BOTH the normalized header AND the original header
 * so that either access pattern works.
 */
export function parseTSV(content: string): Record<string, string>[] {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];

    const rawHeaders = lines[0].split('\t').map(h => h.trim().replace(/"/g, ''));
    const normalizedHeaders = rawHeaders.map(normalizeHeader);
    const results: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split('\t').map(v => v.trim().replace(/"/g, ''));
        const record: Record<string, string> = {};

        for (let j = 0; j < rawHeaders.length; j++) {
            const val = values[j] || '';
            // Store under both original and normalized keys
            record[rawHeaders[j]] = val;
            record[normalizedHeaders[j]] = val;
        }

        results.push(record);
    }

    return results;
}

class SPApiReportService {
    private reportsBaseUrl = '/reports/2021-06-30';

    // Production-safe limits
    private static readonly MAX_POLL_WAIT_MS = 45 * 60 * 1000;       // 45 minutes
    private static readonly INITIAL_POLL_INTERVAL_MS = 10_000;         // 10 seconds
    private static readonly MAX_POLL_INTERVAL_MS = 2 * 60 * 1000;     // 2 minutes (cap)
    private static readonly BACKOFF_MULTIPLIER = 2;                    // Double each time

    /**
     * Request a report from Amazon SP-API
     */
    async requestReport(
        userId: string,
        request: ReportRequest,
        storeId?: string
    ): Promise<string> {
        const amazonService = await getAmazonService();
        const accessToken = await amazonService.getAccessTokenForService(userId, storeId);
        const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
        const baseUrl = amazonService.getRegionalBaseUrl(marketplaceId);

        const body: any = {
            reportType: request.reportType,
            marketplaceIds: request.marketplaceIds || [marketplaceId],
        };

        if (request.dataStartTime) body.dataStartTime = request.dataStartTime;
        if (request.dataEndTime) body.dataEndTime = request.dataEndTime;

        logger.info('[SP-API REPORTS] Requesting report', {
            userId,
            reportType: request.reportType,
            startTime: request.dataStartTime,
            endTime: request.dataEndTime
        });

        const response = await axios.post(
            `${baseUrl}${this.reportsBaseUrl}/reports`,
            body,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'x-amz-access-token': accessToken,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const reportId = response.data?.reportId;
        if (!reportId) {
            throw new Error(`No reportId returned for ${request.reportType}`);
        }

        logger.info('[SP-API REPORTS] Report requested successfully', { userId, reportId, reportType: request.reportType });
        return reportId;
    }

    /**
     * Poll report status with exponential backoff.
     * 
     * Amazon SP-API reports can take 1–45 minutes depending on seller volume:
     * - Small seller (<$10k/mo):  1–3 minutes
     * - Mid seller ($50k–$500k):  5–15 minutes
     * - Large seller ($1M+):      15–45 minutes
     * 
     * Backoff schedule: 10s → 20s → 40s → 80s → 120s (cap) → 120s → ...
     * Total timeout: 45 minutes (configurable via maxWaitMs)
     */
    async pollReportStatus(
        userId: string,
        reportId: string,
        storeId?: string,
        maxWaitMs: number = SPApiReportService.MAX_POLL_WAIT_MS
    ): Promise<ReportStatus> {
        const amazonService = await getAmazonService();
        const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
        const baseUrl = amazonService.getRegionalBaseUrl(marketplaceId);
        const startTime = Date.now();
        let pollInterval = SPApiReportService.INITIAL_POLL_INTERVAL_MS;
        let pollCount = 0;

        logger.info('[SP-API REPORTS] 🔄 Starting poll with exponential backoff', {
            reportId,
            maxWaitMinutes: Math.round(maxWaitMs / 60000),
            initialIntervalSec: pollInterval / 1000
        });

        while (Date.now() - startTime < maxWaitMs) {
            pollCount++;
            const elapsedMs = Date.now() - startTime;

            const accessToken = await amazonService.getAccessTokenForService(userId, storeId);

            const response = await axios.get(
                `${baseUrl}${this.reportsBaseUrl}/reports/${reportId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'x-amz-access-token': accessToken,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const status: ReportStatus = {
                reportId,
                status: response.data?.processingStatus || 'IN_PROGRESS',
                reportDocumentId: response.data?.reportDocumentId,
                processingEndTime: response.data?.processingEndTime
            };

            logger.info('[SP-API REPORTS] 🔄 Poll #' + pollCount, {
                reportId,
                status: status.status,
                elapsedSec: Math.round(elapsedMs / 1000),
                nextIntervalSec: Math.round(pollInterval / 1000)
            });

            if (status.status === 'DONE') {
                logger.info('[SP-API REPORTS] ✅ Report ready', {
                    reportId,
                    totalPolls: pollCount,
                    totalTimeSec: Math.round(elapsedMs / 1000)
                });
                return status;
            }

            if (status.status === 'CANCELLED' || status.status === 'FATAL') {
                throw new Error(`Report ${reportId} failed with status: ${status.status}`);
            }

            // Wait with exponential backoff
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            // Increase interval: 10s → 20s → 40s → 80s → 120s (cap)
            pollInterval = Math.min(
                pollInterval * SPApiReportService.BACKOFF_MULTIPLIER,
                SPApiReportService.MAX_POLL_INTERVAL_MS
            );
        }

        const totalElapsed = Math.round((Date.now() - startTime) / 1000);
        throw new Error(`Report ${reportId} timed out after ${totalElapsed}s (${pollCount} polls). Seller may need a smaller date range.`);
    }

    /**
     * Download a report document
     */
    async downloadReport(
        userId: string,
        reportDocumentId: string,
        storeId?: string
    ): Promise<string> {
        const amazonService = await getAmazonService();
        const accessToken = await amazonService.getAccessTokenForService(userId, storeId);
        const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
        const baseUrl = amazonService.getRegionalBaseUrl(marketplaceId);

        // Step 1: Get the document URL
        const docResponse = await axios.get(
            `${baseUrl}${this.reportsBaseUrl}/documents/${reportDocumentId}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'x-amz-access-token': accessToken,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const documentUrl = docResponse.data?.url;
        if (!documentUrl) {
            throw new Error(`No download URL for document ${reportDocumentId}`);
        }

        // Step 2: Download the actual report content
        const contentResponse = await axios.get(documentUrl, {
            responseType: 'text',
            timeout: 60000
        });

        logger.info('[SP-API REPORTS] Report downloaded', {
            reportDocumentId,
            contentLength: contentResponse.data?.length || 0
        });

        return contentResponse.data;
    }

    /**
     * Full workflow: Request → Poll → Download → Parse
     * Returns parsed records from a TSV report
     */
    async requestAndDownloadReport(
        userId: string,
        reportType: string,
        startDate?: Date,
        endDate?: Date,
        storeId?: string
    ): Promise<Record<string, string>[]> {
        try {
            // Step 1: Request the report
            const reportId = await this.requestReport(userId, {
                reportType,
                dataStartTime: startDate?.toISOString(),
                dataEndTime: endDate?.toISOString()
            }, storeId);

            // Step 2: Poll until done
            const status = await this.pollReportStatus(userId, reportId, storeId);

            if (!status.reportDocumentId) {
                logger.warn('[SP-API REPORTS] Report completed but no document ID', { reportId });
                return [];
            }

            // Step 3: Download
            const content = await this.downloadReport(userId, status.reportDocumentId, storeId);

            if (!content || content.trim().length === 0) {
                logger.info('[SP-API REPORTS] Report downloaded but empty', { reportId });
                return [];
            }

            // Step 4: Parse TSV
            const records = parseTSV(content);
            logger.info('[SP-API REPORTS] Report parsed', {
                reportType,
                recordCount: records.length,
                reportId
            });

            return records;
        } catch (error: any) {
            logger.error('[SP-API REPORTS] Report workflow failed', {
                reportType,
                userId,
                error: error.message
            });
            throw error;
        }
    }
}

export const spApiReportService = new SPApiReportService();
export default spApiReportService;
