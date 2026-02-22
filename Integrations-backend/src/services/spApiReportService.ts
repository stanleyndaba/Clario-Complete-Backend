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
 * Parse a TSV (Tab-Separated Values) string into an array of objects
 */
export function parseTSV(content: string): Record<string, string>[] {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split('\t').map(h => h.trim().replace(/"/g, ''));
    const results: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split('\t').map(v => v.trim().replace(/"/g, ''));
        const record: Record<string, string> = {};

        for (let j = 0; j < headers.length; j++) {
            record[headers[j]] = values[j] || '';
        }

        results.push(record);
    }

    return results;
}

class SPApiReportService {
    private reportsBaseUrl = '/reports/2021-06-30';

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
     * Poll report status until complete or timeout
     */
    async pollReportStatus(
        userId: string,
        reportId: string,
        storeId?: string,
        maxWaitMs: number = 120000,
        pollIntervalMs: number = 5000
    ): Promise<ReportStatus> {
        const amazonService = await getAmazonService();
        const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
        const baseUrl = amazonService.getRegionalBaseUrl(marketplaceId);
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
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

            logger.debug('[SP-API REPORTS] Poll status', { reportId, status: status.status });

            if (status.status === 'DONE') {
                return status;
            }

            if (status.status === 'CANCELLED' || status.status === 'FATAL') {
                throw new Error(`Report ${reportId} failed with status: ${status.status}`);
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        throw new Error(`Report ${reportId} timed out after ${maxWaitMs}ms`);
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
